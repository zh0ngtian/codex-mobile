import { MAX_FILE_BYTES, readFileAsDataUrl } from '../ui/attachments';
import { fetchImageGenerationError, type ImageGenerationError } from '../backends/image-generation-error';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { remoteFileDownloadUrl, remoteFilePreviewUrl, remoteImagePreviewUrl } from '../backends/file-upload';
import { groupConversationTurns, parseRemoteFileHref, summarizeFileChange } from '../ui/conversation';
import { isPreviewableImagePath, isPreviewableVideoPath, decodeBase64File, remoteMarkdownImage } from '../features/conversation/sheets/RemoteFileSheets';
import { renderMermaidSvg } from '../ui/mermaid';
import { nativeAction, nativeCommand, nativeItemText } from './projection';
import type { NativeWorkspaceController } from './workspace-adapter';
import type { NativePanelItem, NativeSnapshot, NativeHandlers } from './protocol';

export interface NativeAttachmentPreview { id: string; name: string; type: string; file: File; contextId: string; status: 'loading' | 'ready' | 'error'; value?: string; error?: string; kind?: string; text?: string; limited?: boolean }
export const NATIVE_ATTACHMENT_TEXT_PREVIEW_LIMIT = 2 * 1024 * 1024;
function localAttachmentKind(name: string, type: string): string {
 if (/^audio\//.test(type)) return 'audio';
 if (/^video\//.test(type)) return 'video';
 if (type === 'image/svg+xml' || /\.svg$/i.test(name)) return 'html';
 if (/^image\//.test(type)) return 'image';
 if (/\.(md|markdown)$/i.test(name) || type === 'text/markdown') return 'markdown';
 if (/\.(html?|xhtml)$/i.test(name) || ['text/html', 'application/xhtml+xml'].includes(type)) return 'html';
 if (/^text\//.test(type) || /^application\/(?:json|(?:[\w.-]+\+)?xml|javascript|x-javascript|yaml|toml)$/.test(type) || /\.(?:txt|csv|tsv|log|json|jsonl|ndjson|js|jsx|ts|tsx|swift|py|rb|go|rs|java|kt|kts|c|cc|cpp|h|hpp|m|mm|sh|bash|zsh|fish|yml|yaml|toml|ini|conf|config|css|scss|sass|less|xml|sql|graphql|gql|vue|svelte|r|pl|php|dart|lock|properties|gitignore|gitattributes|env)$/i.test(name)) return 'source';
 return 'file';
}
export interface NativeFileState { href: string; path: string; line: number | null; status: 'loading' | 'ready' | 'error'; text: string; bytes?: number; binary?: boolean; error?: string; mode: string }
const describe = (id: string, title: string, value: unknown, kind = 'text'): NativePanelItem => ({ id, kind, title, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) });
export function projectToolPanel(c: NativeWorkspaceController, id: string, diagnostics: Record<string, ImageGenerationError | null> = {}): NativeSnapshot['panel'] {
 const diffItems = (changes: any[], prefix: string): NativePanelItem[] => changes.map((change, i) => {
  const stats = summarizeFileChange(change);
  const rawPath = typeof change.path === 'string' ? change.path : '';
  let href = parseRemoteFileHref(rawPath) ? rawPath : null;
  const cwd = typeof c.active?.cwd === 'string' ? c.active.cwd : '';
  if (!href && rawPath && !rawPath.startsWith('/') && !/^[a-z][a-z\d+.-]*:/i.test(rawPath) && cwd.startsWith('/')) {
   const resolved = remoteMarkdownImage(`${cwd.replace(/\/+$/, '')}/__native_context__.md`, rawPath);
   if (resolved.local && parseRemoteFileHref(resolved.source)) href = resolved.source;
  }
  return { id: `${prefix}:${i}`, kind: 'disclosure', title: `${change.path || t('未命名文件')} +${stats.additions} −${stats.deletions}`, children: [
   ...(href ? [nativeAction(`${prefix}:${i}:file`, t('打开文件'), 'file.open', { href })] : []), { id: `${prefix}:${i}:diff`, kind: 'diff', text: change.diff || t('暂无 Diff 内容') },
  ] };
 });
 for (const turn of groupConversationTurns(c.active?.turns ?? [])) {
  if (id === `changes:${turn.id}`) {
   const changes = (turn.items ?? []).filter((item: any) => item.type === 'fileChange').flatMap((item: any) => item.changes ?? []);
   return { id, title: t('文件变更'), items: [...diffItems(changes, id), ...(turn.liveDiff ? [{ id: `${id}:live`, kind: 'diff', text: String(turn.liveDiff) }] : [])] };
  }
  for (const item of turn.items ?? []) if (id === `tool:${turn.id}:${item.id}`) {
   const items = [describe(`${id}:status`, t('状态'), item.status || t('已完成'))];
   if (item.type === 'commandExecution') items.unshift(describe(`${id}:command`, t('命令'), Array.isArray(item.command) ? item.command.join(' ') : item.command, 'code'));
   else if (item.type === 'fileChange') items.push(...diffItems(item.changes ?? [], id));
   else items.unshift(describe(`${id}:tool`, t('工具'), item.tool || item.type));
   for (const [field, label] of [['cwd', t('工作目录')], ['durationMs', t('耗时')], ['exitCode', t('退出码')]]) if (item[field] != null) items.push(describe(`${id}:${field}`, label, item[field]));
   if (item.arguments != null) items.push(describe(`${id}:arguments`, t('参数'), item.arguments, 'code'));
   if (item.type === 'imageGeneration' && item.status === 'failed') {
    const key = `${c.backend.id}:${c.active?.id}:${item.id}`; const diagnostic = diagnostics[key];
    items.push(describe(`${id}:failure`, t('图像生成未完成'), diagnostic === undefined ? t('正在获取失败原因…') : diagnostic?.code === 'moderation_blocked' ? `${t(diagnostic.stage === 'output' ? '生成结果被内容审核拦截' : '图像生成被内容审核拦截')}${diagnostic.categories.includes('sexual') ? t('（性相关内容）') : ''}。${t('系统未指出具体触发区域。')}` : t('服务端未提供具体原因')));
    if (diagnostic) items.push({ id: `${id}:diagnostic`, kind: 'disclosure', title: t('技术详情'), children: [describe(`${id}:code`, t('错误代码'), diagnostic.code), describe(`${id}:stage`, t('审核阶段'), diagnostic.stage), describe(`${id}:categories`, t('检测类别'), diagnostic.categories.join(', ')), ...(diagnostic.requestId ? [describe(`${id}:request`, t('请求 ID'), diagnostic.requestId)] : [])] });
   }
   const output = item.aggregatedOutput ?? item.result ?? item.error ?? item.contentItems ?? item.output;
   if (output != null) items.push(describe(`${id}:output`, t('输出'), output, 'code'));
   for (const [field, label] of [['summary', t('摘要')], ['content', t('内容')], ['query', t('搜索')], ['url', t('网址')], ['receiverThreadIds', t('目标会话')], ['agentsStates', t('智能体状态')]]) if (item[field] != null && !items.some(i => i.text === item[field])) items.push(describe(`${id}:${field}`, label, item[field], 'code'));
   return { id, title: t(item.type === 'commandExecution' ? '命令执行' : item.type === 'fileChange' ? '文件修改' : '工具调用'), items };
  }
 }
 return undefined;
}
export function projectFilePanel(c: NativeWorkspaceController, state?: NativeFileState | null): NativeSnapshot['panel'] {
 if (!state) return undefined;
 const { path } = state; const name = path.split('/').at(-1) || t('远程文件');
 const svg = /\.svg$/i.test(path);
 const image = isPreviewableImagePath(path) && !svg, video = isPreviewableVideoPath(path), audio = /\.(?:mp3|wav|m4a|aac|flac|oga|opus)$/i.test(path);
 const markdown = /\.(?:md|markdown)$/i.test(path), html = /\.(?:html?|xhtml)$/i.test(path);
 const items: NativePanelItem[] = [describe('file-path', name, `${path}${state.line ? `:${state.line}` : ''}${state.bytes != null ? ` · ${state.bytes} B` : ''}`)];
 if (state.status === 'loading') items.push(describe('file-loading', t('正在读取文件…'), ''));
 if (state.status === 'error') items.push(describe('file-error', t('读取失败'), state.error), nativeAction('file-retry', t('重试'), 'file.open', { href: state.href }));
 if (state.status === 'ready') {
  items.push({ id: 'file-download', kind: 'file', title: name, text: t('下载文件'), value: remoteFileDownloadUrl(c.backend, path) });
  if (svg) items.push({ id: 'file-svg', kind: 'html', title: name, value: state.text });
  else if (image) items.push({ id: 'file-image', kind: 'image', title: name, value: remoteImagePreviewUrl(c.backend, path), previewURL: remoteImagePreviewUrl(c.backend, path, false) });
  else if (video || audio) items.push({ id: 'file-media', kind: video ? 'video' : 'audio', title: name, value: remoteFilePreviewUrl(c.backend, path) });
  else if (state.binary) items.push(describe('file-binary', t('二进制文件，暂不支持文本预览'), ''));
  else {
   if (markdown || html) items.push({ id: 'file-mode', kind: 'singleChoice', title: t('显示模式'), value: state.mode, options: [{ id: 'preview', value: 'preview', title: t('预览') }, { id: 'source', value: 'source', title: t('源码') }], command: nativeCommand('file.mode', { path: state.path }) });
   items.push({ id: `file-content:${state.path}`, kind: state.mode === 'preview' && markdown ? 'markdown' : state.mode === 'preview' && html ? 'html' : 'source', title: name, ...(state.line ? { line: state.line } : {}), ...(state.mode === 'preview' && html ? { value: state.text } : { text: state.text }) });
  }
 }
 return { id: `file:${state.path}`, title: t('远程文件'), items };
}
/** 本地文件仅在用户点击后读取，下载保留原字节，源码/HTML不取得业务桥或文件路径。 */
export function projectAttachmentPreview(preview?: NativeAttachmentPreview | null): NativeSnapshot['panel'] {
 if (!preview) return undefined;
 const items: NativePanelItem[] = [];
 if (preview.status === 'ready') {
  items.push({ id: 'draft-download', kind: 'file', title: preview.name, text: t('下载原始文件'), value: preview.value });
  if (preview.limited) items.push({ id: 'draft-preview-limit', kind: 'text', text: t('文件超过 2 MB 文本预览上限，可下载原始文件查看') });
  else if (preview.kind === 'file') items.push({ id: 'draft-binary', kind: 'text', text: t('二进制或非 UTF-8 文件暂不支持文本预览，可下载原始文件查看') });
  else items.push({ id: 'draft-content', kind: preview.kind ?? 'file', title: preview.name, previewURL: preview.value,
    ...(['source', 'markdown'].includes(preview.kind ?? '') ? { text: preview.text ?? '' } : { value: preview.kind === 'html' ? preview.text ?? '' : preview.value }) });
 } else if (preview.status === 'error') items.push({ id: 'draft-media-error', kind: 'text', text: preview.error }, nativeAction('draft-media-retry', t('重试'), 'attachment.preview', { id: preview.id }));
 else items.push({ id: 'draft-media-loading', kind: 'text', title: t('正在读取文件…'), text: preview.name });
 return { id: `attachment:${preview.id}`, title: preview.name, items };
}
/** 只解析当前实际Markdown中的资源。复杂绘图复用既有strict引擎与离屏布局。 */
export function markdownResources(texts: Array<{ text: string; path?: string }>, c: NativeWorkspaceController): { images: NativePanelItem[]; diagrams: string[] } {
 const images = new Map<string, NativePanelItem>(); const diagrams = new Set<string>();
 for (const entry of texts) {
  let fence: { char: string; count: number; lang: string; lines: string[] } | undefined;
  const plain: string[] = [];
  for (const line of entry.text.replace(/\r\n/g, '\n').split('\n')) {
   const match = line.trimStart().match(/^(`{3,}|~{3,})(.*)$/);
   if (!fence && match) { fence = { char: match[1][0], count: match[1].length, lang: match[2].trim().toLowerCase(), lines: [] }; continue; }
   if (fence) { if (line.trim().length >= fence.count && [...line.trim()].every(ch => ch === fence!.char)) { if (fence.lang === 'mermaid') diagrams.add(fence.lines.join('\n')); fence = undefined; } else fence.lines.push(line); continue; }
   plain.push(line);
  }
  for (const m of plain.join('\n').matchAll(/!\[[^\]]*\]\(\s*(<[^>]+>|[^\s)]+)(?:\s+["'][^)]*["'])?\s*\)/g)) {
   const source = m[1].replace(/^<|>$/g, '');
   const image = entry.path ? remoteMarkdownImage(entry.path, source) : { source, local: !/^(data:|https?:)/i.test(source) };
   images.set(source, { id: `markdown-image:${source}`, kind: 'image', text: source, value: image.local ? remoteImagePreviewUrl(c.backend, image.source) : source, previewURL: image.local ? remoteImagePreviewUrl(c.backend, image.source, false) : source });
  }
 }
 return { images: [...images.values()], diagrams: [...diagrams] };
}
export function useNativeRichContent(c: NativeWorkspaceController, enabled: boolean, setPanel: (id: string | null) => void) {
 const [attachmentPreview, setAttachmentPreview] = useState<NativeAttachmentPreview | null>(null);
 const currentFiles = useRef(c.draftFiles);
 const attachmentReads = useRef(new WeakMap<File, Promise<string>>());
 const [file, setFile] = useState<(NativeFileState & { contextId: string }) | null>(null);
 const [diagnostics, setDiagnostics] = useState<Record<string, ImageGenerationError | null>>({});
 const diagnosticRequests = useRef(new Map<string, Promise<void>>());
 const [diagrams, setDiagrams] = useState<Record<string, string>>({});
 const pending = useRef(new Set<string>()); const epoch = useRef(0); const context = useRef(c.contextId);
 useLayoutEffect(() => {
  currentFiles.current = c.draftFiles;
  if (context.current !== c.contextId) { context.current = c.contextId; epoch.current++; setFile(null); setAttachmentPreview(null); }
  else if (attachmentPreview && !c.draftFiles.some(file => file.id === attachmentPreview.id && file.file === attachmentPreview.file)) { epoch.current++; setAttachmentPreview(null); }
 }, [c.contextId, c.draftFiles, attachmentPreview?.id, attachmentPreview?.file]);
 useEffect(() => () => { epoch.current++; }, []);
 const texts: Array<{ text: string; path?: string }> = enabled ? (c.active?.turns ?? []).flatMap((turn: any) => (turn.items ?? []).filter((i: any) => i.type === 'agentMessage' || i.type === 'userMessage').map((i: any) => ({ text: nativeItemText(i) }))) : [];
 if (enabled && file?.contextId === c.contextId && file.status === 'ready' && !file.binary) texts.push({ text: file.text, path: file.path });
 const resources = enabled ? markdownResources(texts, c) : { images: [], diagrams: [] };
 const render = async (source: string) => {
  if (pending.current.has(source) || diagrams[source]) return;
  pending.current.add(source);
  try { const svg = await renderMermaidSvg(source); setDiagrams(v => ({ ...Object.fromEntries(Object.entries(v).slice(-63)), [source]: svg })); }
  finally { pending.current.delete(source); }
 };
 const sourceKey = JSON.stringify(resources.diagrams);
 useEffect(() => { if (!enabled) return; const timer = setTimeout(() => { for (const source of resources.diagrams) void render(source).catch(() => {}); }, 150); return () => clearTimeout(timer); }, [enabled, sourceKey]);
 const loadDiagnostic = (itemId: string): Promise<void> => {
  const threadId = String(c.active?.id ?? ''); const key = `${c.backend.id}:${threadId}:${itemId}`;
  if (Object.hasOwn(diagnostics, key)) return Promise.resolve();
  if (diagnosticRequests.current.has(key)) return diagnosticRequests.current.get(key)!;
  const task = fetchImageGenerationError(c.backend, threadId, itemId).catch(() => null).then(value => { setDiagnostics(previous => ({ ...Object.fromEntries(Object.entries(previous).slice(-63)), [key]: value })); }).finally(() => { diagnosticRequests.current.delete(key); });
  diagnosticRequests.current.set(key, task); return task;
 };
 const handlers: NativeHandlers = {
  'attachment.preview': async p => {
   const draft = currentFiles.current.find(file => file.id === p.id);
   if (!draft) throw new Error(t('附件已移除'));
   if (draft.file.size > MAX_FILE_BYTES || draft.size > MAX_FILE_BYTES) throw new Error(t('{name} 超过 100 MB', { name: draft.name }));
   const token = ++epoch.current; const contextId = c.contextId;
   const preview: NativeAttachmentPreview = { id: draft.id, name: draft.name, type: draft.type, file: draft.file, contextId, status: 'loading' };
   const valid = () => token === epoch.current && context.current === contextId && currentFiles.current.some(file => file.id === draft.id && file.file === draft.file);
   setFile(null); setAttachmentPreview(preview); setPanel('attachment');
   try {
    let reading = attachmentReads.current.get(draft.file);
    if (!reading) { reading = readFileAsDataUrl(draft.file).finally(() => { attachmentReads.current.delete(draft.file); }); attachmentReads.current.set(draft.file, reading); }
    const value = await reading;
    if (!valid()) throw new Error(t('附件已变化，请重新打开'));
    let kind = localAttachmentKind(draft.name, draft.type);
    const textKind = ['source', 'markdown', 'html'].includes(kind);
    const limited = textKind && draft.file.size > NATIVE_ATTACHMENT_TEXT_PREVIEW_LIMIT;
    let text: string | undefined;
    if (textKind && !limited) {
     const encoded = value.match(/^data:[^,]*;base64,([A-Za-z0-9+/=]*)$/)?.[1];
     if (encoded === undefined) throw new Error(t('附件内容格式无效'));
     const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
     try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); if (bytes.includes(0)) kind = 'file'; }
     catch { kind = 'file'; }
    }
    setAttachmentPreview({ ...preview, status: 'ready', value, kind, text, limited });
   } catch (error) {
    if (valid()) setAttachmentPreview({ ...preview, status: 'error', error: error instanceof Error ? error.message : String(error) }); throw error;
   }
  },
  'file.open': async p => {
   const target = parseRemoteFileHref(String(p.href)); if (!target) throw new Error(t('文件链接无效'));
   const token = ++epoch.current; const contextId = c.contextId;
   const base: NativeFileState = { href: String(p.href), path: target.path, line: target.line, status: 'loading', text: '', mode: /\.(?:md|markdown|html?|xhtml)$/i.test(target.path) ? 'preview' : 'source' };
   setAttachmentPreview(null); setFile({ ...base, contextId }); setPanel('file');
   if ((isPreviewableImagePath(target.path) && !/\.svg$/i.test(target.path)) || isPreviewableVideoPath(target.path) || /\.(?:mp3|wav|m4a|aac|flac|oga|opus)$/i.test(target.path)) { setFile({ ...base, contextId, status: 'ready' }); return; }
   try {
    const read = c.extended?.callbacks.readRemoteFile; if (!read) throw new Error(t('尚未连接 app-server'));
    const result = await read(target.path);
    if (token !== epoch.current || context.current !== contextId) return;
    setFile({ ...base, ...decodeBase64File(result.dataBase64), status: 'ready', contextId });
   } catch (error) { if (token === epoch.current && context.current === contextId) setFile({ ...base, contextId, status: 'error', error: error instanceof Error ? error.message : String(error) }); throw error; }
  },
  'file.mode': p => { if (!file || (p.path !== undefined && p.path !== file.path) || file.contextId !== c.contextId || !['preview', 'source'].includes(String(p.value))) throw new Error(t('文件面板已关闭')); setFile({ ...file, mode: String(p.value) }); },
  'diagram.render': async p => { if (!resources.diagrams.includes(String(p.source))) throw new Error(t('图表已更新')); await render(String(p.source)); },
 };
 return { attachmentPreview: attachmentPreview?.contextId === c.contextId && c.draftFiles.some(file => file.id === attachmentPreview.id && file.file === attachmentPreview.file) ? attachmentPreview : null, diagnostics, loadDiagnostic, file: file?.contextId === c.contextId ? file : null, handlers, close: () => { epoch.current++; setFile(null); setAttachmentPreview(null); }, resources: [...resources.images, ...resources.diagrams.filter(source => diagrams[source]).map(source => ({ id: `mermaid:${source}`, kind: 'html', text: source, value: diagrams[source] }))] };
}
