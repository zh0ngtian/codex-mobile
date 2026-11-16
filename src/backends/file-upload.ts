import { gatewayOutbox, type OutboxEntry } from './outbox';
import { transportUuid } from './http-transport';
import { transportNamespace } from './gateway-route';
import { gatewayUrl } from './gateway-route';
import type { BackendConfig } from "./types";
import type { DraftImage, UploadedFile } from "../ui/attachments";
import { t } from "../i18n";

type Fetcher = typeof fetch;

export function remoteFileDownloadUrl(backend: BackendConfig, path: string) {
  const name = path.split("/").at(-1) || "download";
  const url = gatewayUrl(backend, `/api/files/download/${encodeURIComponent(name)}`);
  if (backend.token) url.searchParams.set("token", backend.token);
  url.searchParams.set("path", path);
  return url.toString();
}

export function remoteFilePreviewUrl(
  backend: BackendConfig,
  path: string,
) {
  const url = gatewayUrl(backend, "/api/files/preview");
  if (backend.token) url.searchParams.set("token", backend.token);
  url.searchParams.set("path", path);
  return url.toString();
}

export function remoteImagePreviewUrl(
  backend: BackendConfig,
  path: string,
  thumbnail = true,
) {
  const url = gatewayUrl(backend, "/api/images/preview");
  if (backend.token) url.searchParams.set("token", backend.token);
  url.searchParams.set("path", path);
  if (thumbnail) url.searchParams.set("thumbnail", "1");
  return url.toString();
}

export async function uploadFile(
  backend: BackendConfig,
  file: File,
  fetcher: Fetcher = fetch,
  options: { sourceId?: string; memoryOnly?: boolean } = {},
): Promise<UploadedFile> {
  const url = gatewayUrl(backend, "/api/uploads/file");
  if (backend.token) url.searchParams.set("token", backend.token);
  let operation: OutboxEntry | undefined;
  if (backend.gatewayMode === 'remote' && !options.memoryOnly) {
    const sourceId = options.sourceId;
    if (sourceId) operation = (await gatewayOutbox.list()).find(entry => entry.kind === 'upload' && entry.sourceId === sourceId && transportNamespace(entry.route) === transportNamespace(backend));
    if (operation) {
      const actual = new Uint8Array(await file.arrayBuffer()); const saved = operation.bytes && new Uint8Array(operation.bytes);
      if (!saved || saved.length !== actual.length || saved.some((value, index) => value !== actual[index])) throw new Error(t('附件内容已变化，请重新选择附件'));
    }
    if (operation?.uploaded && operation.state === 'completed') return operation.uploaded;
    if (!operation) {
      operation = { id: transportUuid(), kind: 'upload', route: { ...backend }, sourceId, state: 'retained', name: file.name, type: file.type || 'application/octet-stream', bytes: await file.arrayBuffer() };
      await gatewayOutbox.put(operation);
    }
    if (operation.name !== file.name || operation.bytes?.byteLength !== file.size || operation.type !== (file.type || 'application/octet-stream')) throw new Error(t('附件内容已变化，请重新选择附件'));
  }
  const query = async () => {
    const endpoint = gatewayUrl(operation!.route, '/api/uploads/operations'); endpoint.searchParams.set('requestId', operation!.id);
    const response = await fetcher(endpoint.toString(), { credentials: 'include', cache: 'no-store' });
    if (!response.ok) throw new Error(t('附件上传结果待确认，请稍后重试'));
    const body = await response.json();
    return body?.status === 'completed' ? body.message?.result : body;
  };
  let result: any;
  if (operation?.state === 'submitted') result = await query();
  else {
  if (operation && globalThis.navigator?.onLine === false) throw new Error(t('待提交：附件已保存在本机，请在网络恢复后发送'));
  if (operation) { operation.state = 'submitted'; await gatewayOutbox.put(operation); }
  const response = await fetcher(url.toString(), {
    method: "POST",
    credentials: "include",
    headers: {
      "content-type": file.type || "application/octet-stream",
      "x-codex-file-name": encodeURIComponent(file.name),
      ...(operation ? { 'x-codex-upload-id': operation.id } : {}),
      ...(options.memoryOnly ? { 'x-codex-memory-only': 'true' } : {}),
    },
    body: file,
  });
  if (!response.ok) {
    if (response.status === 413) throw new Error(t("文件不能超过 100 MB"));
    throw new Error(t("文件上传失败（{status}）", { status: response.status }));
  }
  result = await response.json();
  }
  if (result?.accepted === true && operation) {
    // ACK 只证明网关已耐久受理；手机只查询原 UUID，不再次上传。
    const until = Date.now() + 15000;
    do { await new Promise(resolve => setTimeout(resolve, 500)); result = await query(); } while (result?.accepted === true && Date.now() < until);
    if (result?.accepted === true) throw new Error(t('附件已排队，连接恢复后上传，请稍后重试'));
  }
  if (
    typeof result.path !== "string" ||
    typeof result.name !== "string" ||
    typeof result.type !== "string" ||
    typeof result.size !== "number"
  ) {
    throw new Error(t("文件上传响应无效"));
  }
  if (operation) { operation.state = 'completed'; operation.uploaded = result as UploadedFile; await gatewayOutbox.put(operation); }
  return result as UploadedFile;
}

/** 图片先保存到当前网关宿主，再用同一路径声明附件与localImage，桌面刷新后也能恢复。 */
export async function uploadDraftImages(backend: BackendConfig, images: DraftImage[], fetcher: Fetcher = fetch, options: { memoryOnly?: boolean } = {}): Promise<DraftImage[]> {
  return Promise.all(images.map(async image => {
    if (image.path) return image;
    const encoded = image.url.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/);
    if (!encoded || encoded[1] !== image.type) throw new Error(t('附件内容格式无效'));
    const bytes = Uint8Array.from(atob(encoded[2]), character => character.charCodeAt(0));
    const file = await uploadFile(backend, new File([bytes], image.name, { type: image.type }), fetcher, { ...options, sourceId: image.id });
    return { ...image, path: file.path };
  }));
}
