// @vitest-environment node
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtemp, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, expect, it } from 'vitest';
import { downloadFile } from '../../server/file-download.js';
import { ImagePreviews } from '../../server/image-preview.js';
import { InlineImages } from '../../server/inline-images.js';
import { sidechatReplayItems } from '../../server/sidechat-replay.js';
import { mediaRemote } from './fixtures/media-remote.js';

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); }, 30000);
const svg = (color: string) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="16"><rect width="100%" height="100%" fill="${color}"/></svg>`);
const pngData = 'data:' + 'image/png;base64,';
const jpegData = 'data:' + 'image/jpeg;base64,';
const body = async (response: Response) => Buffer.from(await response.arrayBuffer());
async function until(test: () => boolean, timeout = 5000) { const start = Date.now(); while (!test()) { if (Date.now() - start > timeout) throw new Error('条件未在期限内成立'); await new Promise(resolve => setTimeout(resolve, 5)); } }
async function target(options?: Parameters<typeof mediaRemote>[0]) { const f = await mediaRemote(options); cleanup.push(() => f.close()); return f; }
async function api() {
  const value = await import('../../server/media-file-source.js').catch(() => null);
  expect(value?.remoteMediaFiles, '缺少可信目标媒体文件注入').toBeTypeOf('function'); return value!;
}
async function http(handle: (req: IncomingMessage, res: ServerResponse, url: URL) => unknown) {
  const server = createServer((req, res) => { void Promise.resolve(handle(req, res, new URL(req.url!, 'http://temporary'))).catch(error => res.destroy(error)); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); }));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('临时HTTP未就绪');
  return (path: string, extra: Record<string, string> = {}) => `http://127.0.0.1:${address.port}/?${new URLSearchParams({ path, ...extra })}`;
}

it('临时RPC目标的同名文件下载隔离字节，保留GET/HEAD、UTF8名称和完整下载语义', async () => {
  const implementation = await api(); const a = await target(); const b = await target();
  const path = '/media/中文照片.png'; const first = Buffer.from('target-A'); const second = Buffer.from('target-BB');
  await writeFile(join(a.root, '中文照片.png'), first); await writeFile(join(b.root, '中文照片.png'), second);
  const sources = { a: implementation.remoteMediaFiles(a.files, 'gateway-one'), b: implementation.remoteMediaFiles(b.files, 'gateway-one') };
  const url = await http((req, res, url) => downloadFile(req, res, url, sources[url.searchParams.get('target') as 'a' | 'b']));
  for (const [id, bytes] of [['a', first], ['b', second]] as const) {
    const result = await fetch(url(path, { target: id }), { headers: { range: 'bytes=0-1' } });
    expect(result.status).toBe(200); expect(result.headers.get('content-length')).toBe(String(bytes.length));
    expect(result.headers.get('content-disposition')).toBe(`attachment; filename*=UTF-8''${encodeURIComponent('中文照片.png')}`);
    expect(result.headers.get('content-type')).toBe('image/png'); expect(await body(result)).toEqual(bytes);
    const readCount = (id === 'a' ? a : b).reads.length;
    const head = await fetch(url(path, { target: id }), { method: 'HEAD' });
    expect(head.status).toBe(200); expect(head.headers.get('content-length')).toBe(String(bytes.length)); expect((await body(head)).length).toBe(0);
    expect((id === 'a' ? a : b).reads.length).toBe(readCount);
  }
  expect((await fetch(url('relative.png', { target: 'a' }))).status).toBe(400);
  expect((await fetch(url('/media/bad\0.png', { target: 'a' }))).status).toBe(400);
});

it('图片缩略图按可信网关和完整目标隔离缓存，原图/HEAD/ETag/304使用目标版本', async () => {
  const implementation = await api(); const a = await target(); const b = await target();
  const path = '/media/shared.svg'; await writeFile(join(a.root, 'shared.svg'), svg('red')); await writeFile(join(b.root, 'shared.svg'), svg('blue'));
  const sources = { a: implementation.remoteMediaFiles(a.files, 'gateway-one'), b: implementation.remoteMediaFiles(b.files, 'gateway-one'),
    c: implementation.remoteMediaFiles(a.files, 'gateway-two') };
  await expect(sources.c.open(path, (await sources.a.stat(path)).version)).rejects.toThrow('File changed');
  const images = new ImagePreviews();
  const url = await http((req, res, url) => images.handle(req, res, url, sources[url.searchParams.get('target') as keyof typeof sources]));
  const first = await fetch(url(path, { target: 'a', thumbnail: '1' })); expect(first.status).toBe(200); const firstBytes = await body(first);
  expect(await sharp(firstBytes).metadata()).toMatchObject({ width: 32, height: 16, format: 'jpeg' });
  const second = await fetch(url(path, { target: 'b', thumbnail: '1' })); expect(second.status).toBe(200); expect(await body(second)).not.toEqual(firstBytes);
  const head = await fetch(url(path, { target: 'a', thumbnail: '1' }), { method: 'HEAD' }); expect(head.status).toBe(200);
  expect(head.headers.get('etag')).toBe(first.headers.get('etag')); expect((await body(head)).length).toBe(0);
  const cached = await fetch(url(path, { target: 'a', thumbnail: '1' }), { headers: { 'if-none-match': first.headers.get('etag')! } }); expect(cached.status).toBe(304);
  const otherGateway = await fetch(url(path, { target: 'c', thumbnail: '1' })); expect(otherGateway.status).toBe(200);
  expect(otherGateway.headers.get('etag')).not.toBe(first.headers.get('etag')); expect(await body(otherGateway)).toEqual(firstBytes);
  const original = await fetch(url(path, { target: 'b' })); expect(original.status).toBe(200); expect(await body(original)).toEqual(svg('blue'));
  await writeFile(join(a.root, 'shared.svg'), svg('green'));
  const changed = await fetch(url(path, { target: 'a', thumbnail: '1' }), { headers: { 'if-none-match': first.headers.get('etag')! } });
  expect(changed.status).toBe(200); expect(await body(changed)).not.toEqual(firstBytes);
});

it('视频注入保留单Range、suffix/open、206/416与原有404/415及空文件语义', async () => {
  const implementation = await api(); const f = await target();
  const video = await import('../../server/video-preview.js').catch(() => null);
  expect(video?.previewVideo, '缺少可注入的视频Range处理器').toBeTypeOf('function');
  const source = implementation.remoteMediaFiles(f.files, 'gateway'); const bytes = Buffer.from('0123456789');
  await writeFile(join(f.root, 'movie.mp4'), bytes); await writeFile(join(f.root, 'empty.mp4'), '');
  const url = await http((req, res, url) => video!.previewVideo(req, res, url, source));
  for (const [range, expected, contentRange] of [['bytes=2-4', '234', 'bytes 2-4/10'], ['bytes=-3', '789', 'bytes 7-9/10'], ['bytes=8-', '89', 'bytes 8-9/10'], ['bytes=0-999', '0123456789', 'bytes 0-9/10']]) {
    const result = await fetch(url('/media/movie.mp4'), { headers: { range } }); expect(result.status).toBe(206);
    expect(result.headers.get('content-range')).toBe(contentRange); expect(result.headers.get('content-length')).toBe(String(expected.length)); expect((await body(result)).toString()).toBe(expected);
  }
  for (const range of ['bytes=10-', 'bytes=5-4', 'bytes=-0', 'bytes=0-1,3-4', 'garbage']) {
    const result = await fetch(url('/media/movie.mp4'), { headers: { range } }); expect(result.status).toBe(416); expect(result.headers.get('content-range')).toBe('bytes */10'); await body(result);
  }
  expect((await fetch(url('/media/missing.mp4'))).status).toBe(404); expect((await fetch(url('relative.mp4'))).status).toBe(415);
  expect((await fetch(url('/media/file.txt'))).status).toBe(415);
  const empty = await fetch(url('/media/empty.mp4')); expect(empty.status).toBe(200); expect((await body(empty)).length).toBe(0);
  const emptyRange = await fetch(url('/media/empty.mp4'), { headers: { range: 'bytes=0-' } }); expect(emptyRange.status).toBe(416); expect(emptyRange.headers.get('content-range')).toBe('bytes */0');
});

it('Sidechat从目标读取历史图片，保留网络/dataURL并仅以文字还原历史工具', async () => {
  const implementation = await api(); const f = await target(); const source = implementation.remoteMediaFiles(f.files, 'gateway');
  await writeFile(join(f.root, 'history.jpg'), 'target-private-history');
  const data = 'data:image/png;base64,YWxyZWFkeS1oZWxk'; const network = 'https://invalid.example/do-not-fetch.png';
  const turns = [{ items: [{ type: 'userMessage', content: [{ type: 'localImage', path: '/media/history.jpg' }, { type: 'image', url: data }, { type: 'image', url: network }] },
    { type: 'commandExecution', command: 'must-not-execute', aggregatedOutput: 'historical' }] }];
  const result = await sidechatReplayItems(turns, { files: source });
  expect(result[0].content).toEqual([{ type: 'input_image', image_url: `data:image/jpeg;base64,${Buffer.from('target-private-history').toString('base64')}` },
    { type: 'input_image', image_url: data }, { type: 'input_image', image_url: network }]);
  expect(result[1]).toMatchObject({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: expect.stringContaining('must-not-execute') }] });
  await expect(sidechatReplayItems([{ items: [{ type: 'userMessage', content: [{ type: 'localImage', path: '/media/missing.jpg' }] }] }], { files: source })).rejects.toThrow();
});

it('InlineImages可信引用区分网关缓存与目标savedPath，历史重建显式解析而不信任上游origin', async () => {
  const implementation = await api(); const f = await target(); const source = implementation.remoteMediaFiles(f.files, 'gateway');
  const root = await mkdtemp(join(tmpdir(), 'codex-media-inline-')); cleanup.push(() => rm(root, { recursive: true, force: true }));
  const refs = new Map<string, import('../../server/media-file-source.js').MediaFileReference>();
  const images = new InlineImages(root, undefined, { files: source, reference(ref) { const id = `opaque-${refs.size}`; refs.set(id, ref); return id; } });
  const data = Buffer.from('gateway-owned-data'); await writeFile(join(f.root, 'saved.png'), 'target-saved-data');
  const original = { data: [{ items: [
    { type: 'userMessage', content: [{ type: 'image', url: `data:image/png;base64,${data.toString('base64')}`, origin: 'target' }] },
    { type: 'imageGeneration', savedPath: '/media/saved.png', result: `data:image/png;base64,${data.toString('base64')}`, origin: 'gateway-cache' },
  ] }] };
  const result = await images.result(original); const cacheRef = result.data[0].items[0].content[0].url; const targetRef = result.data[0].items[1].savedPath;
  expect(refs.get(cacheRef)?.origin).toBe('gateway-cache'); expect(refs.get(cacheRef)?.source.kind).toBe('local');
  expect(refs.get(targetRef)).toMatchObject({ path: '/media/saved.png', origin: 'target', source });
  const replay = await sidechatReplayItems([{ items: [{ type: 'userMessage', content: [{ type: 'image', url: cacheRef }, { type: 'localImage', path: targetRef }] }] }],
    { files: source, resolveReference: value => refs.get(value) ?? null });
  expect(replay[0].content.map((part: any) => part.image_url)).toEqual([`data:image/png;base64,${data.toString('base64')}`, `data:image/png;base64,${Buffer.from('target-saved-data').toString('base64')}`]);
  await expect(sidechatReplayItems([{ items: [{ type: 'userMessage', content: [{ type: 'image', url: 'opaque-unknown', origin: 'gateway-cache' }] }] }], { files: source })).rejects.toThrow();
  expect(() => new InlineImages(root, undefined, { files: source } as any)).toThrow();
  expect(original.data[0].items[0].content![0].url.startsWith('data:')).toBe(true);
});

it.each([
  { mode: 'resolver-only', missing: 'gateway-cache' }, { mode: 'resolver-only', missing: 'target' },
  { mode: 'explicit-local', missing: 'gateway-cache' }, { mode: 'explicit-local', missing: 'target' },
] as const)('显式引用解析在$mode中丢失$missing时拒绝历史重建', async ({ mode, missing }) => {
  const implementation = await api(); const f = await target(); const source = implementation.remoteMediaFiles(f.files, 'gateway');
  const root = await mkdtemp(join(tmpdir(), 'codex-media-reference-')); cleanup.push(() => rm(root, { recursive: true, force: true }));
  const refs = new Map<string, import('../../server/media-file-source.js').MediaFileReference>();
  const images = new InlineImages(root, undefined, { files: source, reference(ref) { const id = `opaque-${refs.size}`; refs.set(id, ref); return id; } });
  const cacheBytes = await sharp(svg('red')).png().toBuffer(); const targetBytes = await sharp(svg('blue')).png().toBuffer();
  await writeFile(join(f.root, 'saved.png'), targetBytes);
  const original = { data: [{ items: [
    { type: 'userMessage', content: [{ type: 'image', url: pngData + cacheBytes.toString('base64'), origin: 'target' }] },
    { type: 'imageGeneration', savedPath: '/media/saved.png', origin: 'gateway-cache' },
  ] }] };
  let turns: Parameters<typeof sidechatReplayItems>[0] = [];
  const url = await http(async (_req, res, url) => {
    try {
      const result = url.searchParams.get('path') === 'inline' ? await images.result(original) : await sidechatReplayItems(turns, {
        ...(mode === 'explicit-local' ? { files: implementation.localMediaFiles } : {}), resolveReference: value => refs.get(value) ?? null,
      });
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(result));
    } catch (error) { res.writeHead(422, { 'content-type': 'application/json' }).end(JSON.stringify({ error: (error as Error).message })); }
  });
  const encodedResponse = await fetch(url('inline')); expect(encodedResponse.status).toBe(200);
  const encoded = await encodedResponse.json() as { data: [{ items: [{ content: [{ url: string }] }, { savedPath: string }] }] };
  const cacheRef = encoded.data[0].items[0].content[0].url; const targetRef = encoded.data[0].items[1].savedPath;
  expect(refs.get(cacheRef)).toMatchObject({ origin: 'gateway-cache', source: implementation.localMediaFiles });
  expect(refs.get(targetRef)).toMatchObject({ origin: 'target', source, path: '/media/saved.png' });
  turns = [{ items: [{ type: 'userMessage', content: [{ type: 'image', url: cacheRef }, { type: 'localImage', path: targetRef }] }] }];
  const valid = await fetch(url('replay')); expect(valid.status).toBe(200);
  const replay = await valid.json() as Array<{ content: Array<{ image_url: string }> }>;
  expect(replay[0].content.map(part => part.image_url)).toEqual([pngData + cacheBytes.toString('base64'), pngData + targetBytes.toString('base64')]);
  expect(f.reads.length).toBeGreaterThan(0);
  refs.delete(missing === 'gateway-cache' ? cacheRef : targetRef);
  const rejected = await fetch(url('replay')); expect(rejected.status).toBe(422);
  expect(await rejected.json()).toEqual({ error: 'Unresolved target image reference' });
});

it('显式解析保留Local绝对文件和data/http(s)URL，默认Local继续兼容相对图片值', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codex-media-reference-local-')); cleanup.push(() => rm(root, { recursive: true, force: true }));
  const file = join(root, 'history.jpg'); const bytes = Buffer.from('local-history'); await writeFile(file, bytes);
  const urls = [pngData + bytes.toString('base64'), 'http://invalid.example/no-fetch.png', 'https://invalid.example/no-fetch.png'];
  const turns = (values: string[]) => [{ items: [{ type: 'userMessage', content: values.map(url => ({ type: 'image', url })) }] }];
  const resolved: string[] = [];
  const result = await sidechatReplayItems(turns([file, ...urls]), { resolveReference(value) { resolved.push(value); return null; } });
  expect(resolved).toEqual([file]);
  expect(result[0].content.map((part: any) => part.image_url)).toEqual([jpegData + bytes.toString('base64'), ...urls]);
  const defaults = await sidechatReplayItems(turns(['legacy-relative.png', ...urls]));
  expect(defaults[0].content.map((part: any) => part.image_url)).toEqual(['legacy-relative.png', ...urls]);
});

it('Remote失败不读取网关同名文件，缺失与断连不能成为本地媒体成功', async () => {
  const implementation = await api(); const root = await mkdtemp(join(tmpdir(), 'codex-media-gateway-')); cleanup.push(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'collision.svg'); await writeFile(path, svg('blue')); const f = await target({ prefix: root + '/' });
  await writeFile(join(f.root, 'collision.svg'), svg('red')); const source = implementation.remoteMediaFiles(f.files, 'gateway');
  const images = new ImagePreviews(); const url = await http((req, res, url) => url.searchParams.has('image') ? images.handle(req, res, url, source) : downloadFile(req, res, url, source));
  expect(await body(await fetch(url(path)))).toEqual(svg('red'));
  expect(await body(await fetch(url(path, { image: '1' })))).toEqual(svg('red'));
  await rm(join(f.root, 'collision.svg'));
  expect((await fetch(url(path))).status).toBe(404); expect((await fetch(url(path, { image: '1' }))).status).toBe(404);
  f.session.close(); expect((await fetch(url(path))).status).toBe(500); expect((await fetch(url(path, { image: '1' }))).status).toBe(500);
  expect(await readFile(path)).toEqual(svg('blue'));
});

it('Windows仅协议夹具按目标规则识别路径、UTF8名称、缩略图与历史图片，拒绝盘符相对路径', async () => {
  const implementation = await api(); const f = await target({ windows: true }); const source = implementation.remoteMediaFiles(f.files, 'gateway');
  await writeFile(join(f.root, '中文照片.svg'), svg('red')); const path = 'C:\\media\\中文照片.svg'; const images = new ImagePreviews();
  const url = await http((req, res, url) => url.searchParams.has('image') ? images.handle(req, res, url, source) : downloadFile(req, res, url, source));
  const result = await fetch(url(path)); expect(result.status).toBe(200); expect(await body(result)).toEqual(svg('red'));
  expect(result.headers.get('content-disposition')).toBe(`attachment; filename*=UTF-8''${encodeURIComponent('中文照片.svg')}`);
  expect((await fetch(url(path, { image: '1', thumbnail: '1' }))).status).toBe(200);
  const replay = await sidechatReplayItems([{ items: [{ type: 'userMessage', content: [{ type: 'localImage', path }] }] }], { files: source });
  expect(replay[0].content[0].image_url).toBe(`${pngData}${svg('red').toString('base64')}`);
  expect((await fetch(url('C:relative.svg'))).status).toBe(400); expect((await fetch(url('\\rooted.svg'))).status).toBe(400);
});

it('Remote已有savedPath且无dataURL的生成图仍显式编码为目标引用', async () => {
  const implementation = await api(); const f = await target(); const source = implementation.remoteMediaFiles(f.files, 'gateway'); const refs: import('../../server/media-file-source.js').MediaFileReference[] = [];
  const images = new InlineImages(f.root, undefined, { files: source, reference(ref) { refs.push(ref); return 'trusted-saved-reference'; } });
  const original = { data: [{ items: [{ type: 'imageGeneration', savedPath: '/media/already-saved.png', status: 'completed' }] }] };
  const result = await images.result(original); expect(result.data[0].items[0].savedPath).toBe('trusted-saved-reference');
  expect(refs).toMatchObject([{ path: '/media/already-saved.png', origin: 'target', source }]);
  expect(original.data[0].items[0].savedPath).toBe('/media/already-saved.png');
});

it('可信引用编码失败或缓存不可写时保留完整内联协议消息', async () => {
  const implementation = await api(); const f = await target(); const source = implementation.remoteMediaFiles(f.files, 'gateway');
  const original = { data: [{ items: [
    { type: 'userMessage', content: [{ type: 'image', url: pngData + Buffer.from('complete-user-image').toString('base64'), detail: 'original' }] },
    { type: 'imageGeneration', result: pngData + Buffer.from('complete-generated-image').toString('base64'), savedPath: '/media/saved.png' },
  ] }] };
  const images = new InlineImages(join(f.root, 'cache'), undefined, { files: source, reference() { throw new Error('encoder unavailable'); } });
  expect(await images.result(original)).toEqual(original);
  await writeFile(join(f.root, 'blocked'), 'not-directory');
  const blocked = new InlineImages(join(f.root, 'blocked', 'cache'), undefined, { files: source, reference() { throw new Error('must not need encoder'); } });
  expect(await blocked.result(original)).toEqual(original);
});

it('读取或转换期间替换目标图片时返回409且不污染缓存，同文件符号链接仍可读取', async () => {
  const implementation = await api(); const f = await target(); const source = implementation.remoteMediaFiles(f.files, 'gateway'); const images = new ImagePreviews();
  const file = join(f.root, 'replace.svg'); await writeFile(file, svg('red'));
  const url = await http((req, res, url) => images.handle(req, res, url, source)); let swapped = false;
  f.beforeRead(async () => { if (swapped) return; swapped = true; const replacement = join(f.root, 'next.svg'); await writeFile(replacement, svg('blue')); await rename(replacement, file); });
  const rejected = await fetch(url('/media/replace.svg', { thumbnail: '1' })); expect(rejected.status).toBe(409); await body(rejected);
  f.beforeRead(); const accepted = await fetch(url('/media/replace.svg', { thumbnail: '1' })); expect(accepted.status).toBe(200);
  expect((await sharp(await body(accepted)).stats()).channels[2].mean).toBeGreaterThan(200);
  const { symlink } = await import('node:fs/promises'); await symlink(file, join(f.root, 'link.svg'));
  expect(await body(await fetch(url('/media/link.svg')))).toEqual(svg('blue'));
});

it('大于100MiB下载以同一版本分段流式传输，Range跨分段边界不截断', async () => {
  const implementation = await api(); const f = await target(); const source = implementation.remoteMediaFiles(f.files, 'gateway');
  const size = 101 * 1024 * 1024 + 17; const file = await open(join(f.root, 'large.mp4'), 'w');
  await file.truncate(size); await file.write(Buffer.from('start'), 0, 5, 0); await file.write(Buffer.from('cross-boundary-end'), 0, 18, 100 * 1024 * 1024 - 9); await file.close();
  const expected = createHash('sha256'); const { createReadStream } = await import('node:fs');
  for await (const chunk of createReadStream(join(f.root, 'large.mp4'))) expected.update(chunk);
  const video = await import('../../server/video-preview.js');
  const url = await http((req, res, url) => url.searchParams.has('video') ? video.previewVideo(req, res, url, source) : downloadFile(req, res, url, source));
  const response = await fetch(url('/media/large.mp4')); expect(response.status).toBe(200); expect(response.headers.get('content-length')).toBe(String(size));
  const actual = createHash('sha256'); let count = 0;
  for await (const chunk of response.body!) { actual.update(chunk); count += chunk.length; }
  expect(count).toBe(size); expect(actual.digest('hex')).toBe(expected.digest('hex'));
  expect(f.reads.some(read => read.offset === 100 * 1024 * 1024 && read.length === 1024 * 1024 + 17)).toBe(true);
  expect(f.reads.every(read => read.length! <= 100 * 1024 * 1024)).toBe(true);
  expect(new Set(f.reads.map(read => JSON.stringify(read.expected))).size).toBe(1);
  const boundary = await fetch(url('/media/large.mp4', { video: '1' }), { headers: { range: `bytes=${100 * 1024 * 1024 - 9}-${100 * 1024 * 1024 + 8}` } });
  expect(boundary.status).toBe(206); expect((await body(boundary)).toString()).toBe('cross-boundary-end');
}, 30000);

it('HTTP慢消费者产生真实背压，取消只终止自身读取并保留共享RPC可用', async () => {
  const implementation = await api(); const f = await target(); const source = implementation.remoteMediaFiles(f.files, 'gateway');
  const file = await open(join(f.root, 'slow.mp4'), 'w'); await file.truncate(64 * 1024 * 1024); await file.close(); await writeFile(join(f.root, 'next.txt'), 'still-ready');
  const url = await http((req, res, url) => downloadFile(req, res, url, source));
  const response = await new Promise<IncomingMessage>((resolve, reject) => { const request = httpRequest(url('/media/slow.mp4'), resolve); request.on('error', reject); request.end(); });
  response.pause(); await until(() => f.reads.length >= 3); await new Promise(resolve => setTimeout(resolve, 300)); const count = f.reads.length;
  await new Promise(resolve => setTimeout(resolve, 200)); expect(f.reads.length - count).toBeLessThanOrEqual(2); expect(f.reads.length).toBeLessThan(64);
  response.destroy(); await until(() => f.active === 0); const stopped = f.reads.length; await new Promise(resolve => setTimeout(resolve, 50)); expect(f.reads.length).toBe(stopped);
  expect(f.session.ready).toBe(true); expect((await body(await fetch(url('/media/next.txt')))).toString()).toBe('still-ready');
});

it('同缩略图合并任务保留其他waiter，最后取消后不缓存且新请求可重试', async () => {
  const implementation = await api(); const f = await target(); const remote = implementation.remoteMediaFiles(f.files, 'gateway'); const images = new ImagePreviews();
  let completedStats = 0;
  const source = { ...remote, async stat(...args: Parameters<typeof remote.stat>) { const value = await remote.stat(...args); completedStats++; return value; } };
  await writeFile(join(f.root, 'coalesce.svg'), svg('red')); f.delayReads(500);
  const url = await http((req, res, url) => images.handle(req, res, url, source));
  const firstAbort = new AbortController(); const first = fetch(url('/media/coalesce.svg', { thumbnail: '1' }), { signal: firstAbort.signal }).catch(() => null);
  // 第二个 stat 返回后才会加入共享任务；发起 stat 本身还不是第二个 waiter。
  await until(() => f.reads.length === 1); const second = fetch(url('/media/coalesce.svg', { thumbnail: '1' })); await until(() => completedStats >= 2);
  firstAbort.abort(); await first; const accepted = await second; expect(accepted.status).toBe(200); await body(accepted); expect(f.reads.length).toBe(1);
  await writeFile(join(f.root, 'coalesce.svg'), svg('blue')); const lastAbort = new AbortController(); const last = fetch(url('/media/coalesce.svg', { thumbnail: '1' }), { signal: lastAbort.signal }).catch(() => null);
  await until(() => f.reads.length === 2); await until(() => f.active > 0); lastAbort.abort(); await last; await until(() => f.active === 0);
  f.delayReads(0); const retried = await fetch(url('/media/coalesce.svg', { thumbnail: '1' })); expect(retried.status).toBe(200); await body(retried); expect(f.reads.length).toBe(3);
});

it('Remote图片排队最多16项且仅两个active读取，取消后队列与能力均可恢复', async () => {
  const implementation = await api(); const f = await target(); const source = implementation.remoteMediaFiles(f.files, 'gateway'); const images = new ImagePreviews();
  for (let index = 0; index < 20; index++) await writeFile(join(f.root, `queued-${index}.svg`), svg('red'));
  f.delayReads(10000); const url = await http((req, res, url) => images.handle(req, res, url, source));
  const controllers: AbortController[] = []; const requests: Array<Promise<Response | null>> = []; const statuses: number[] = [];
  const start = (index: number) => {
    const controller = new AbortController(); controllers.push(controller);
    requests.push(fetch(url(`/media/queued-${index}.svg`, { thumbnail: '1' }), { signal: controller.signal }).then(response => { statuses.push(response.status); return response; }, () => null));
  };
  try {
    start(0); await until(() => f.reads.length === 1); start(1); await until(() => f.reads.length === 2);
    for (let index = 2; index < 20; index++) { const count = f.stats; start(index); await until(() => f.stats > count); await new Promise(resolve => setTimeout(resolve, 10)); }
    await until(() => statuses.length === 2); expect(statuses).toEqual([503, 503]); expect(f.reads.length).toBe(2);
  } finally { for (const controller of controllers) controller.abort(); await Promise.all(requests); }
  await until(() => f.active === 0); f.delayReads(0);
  const retry = await fetch(url('/media/queued-19.svg', { thumbnail: '1' })); expect(retry.status).toBe(200); await body(retry);
}, 20000);

it('图片转换结束后的目标替换同样拒绝且不缓存旧转换结果', async () => {
  const implementation = await api(); const f = await target(); const source = implementation.remoteMediaFiles(f.files, 'gateway'); const images = new ImagePreviews();
  await writeFile(join(f.root, 'after-convert.svg'), svg('red'));
  f.beforeStat(async () => { if (f.stats === 5) { const replacement = join(f.root, 'replacement.svg'); await writeFile(replacement, svg('blue')); await rename(replacement, join(f.root, 'after-convert.svg')); } });
  const url = await http((req, res, url) => images.handle(req, res, url, source));
  const response = await fetch(url('/media/after-convert.svg', { thumbnail: '1' })); expect(response.status).toBe(409); await body(response);
  f.beforeStat(); const retry = await fetch(url('/media/after-convert.svg', { thumbnail: '1' })); expect(retry.status).toBe(200);
  expect((await sharp(await body(retry)).stats()).channels[2].mean).toBeGreaterThan(200);
});

it('排队期间目标图片替换在active复核时拒绝，未为等待项提前读取目标字节', async () => {
  const implementation = await api(); const f = await target(); const source = implementation.remoteMediaFiles(f.files, 'gateway'); const images = new ImagePreviews();
  for (const name of ['active-a.svg', 'active-b.svg', 'queued.svg']) await writeFile(join(f.root, name), svg('red'));
  f.delayReads(10000); const url = await http((req, res, url) => images.handle(req, res, url, source));
  const controllers = [new AbortController(), new AbortController()];
  const a = fetch(url('/media/active-a.svg', { thumbnail: '1' }), { signal: controllers[0].signal }).catch(() => null);
  await until(() => f.reads.length === 1);
  const b = fetch(url('/media/active-b.svg', { thumbnail: '1' }), { signal: controllers[1].signal }).catch(() => null);
  await until(() => f.reads.length === 2);
  const count = f.stats; const waiting = fetch(url('/media/queued.svg', { thumbnail: '1' })); await until(() => f.stats > count); await new Promise(resolve => setTimeout(resolve, 20));
  await writeFile(join(f.root, 'replacement.svg'), svg('blue')); await rename(join(f.root, 'replacement.svg'), join(f.root, 'queued.svg'));
  controllers.forEach(controller => controller.abort()); await Promise.all([a, b]);
  const rejected = await waiting; expect(rejected.status).toBe(409); await body(rejected); expect(f.reads.length).toBe(2);
  f.delayReads(0); const retry = await fetch(url('/media/queued.svg', { thumbnail: '1' })); expect(retry.status).toBe(200); await body(retry);
});

it('超过分段边界前目标替换会中断HTTP，不能以Content-Length伪装完整下载', async () => {
  const implementation = await api(); const f = await target(); const source = implementation.remoteMediaFiles(f.files, 'gateway');
  const file = await open(join(f.root, 'replace-large.mp4'), 'w'); await file.truncate(100 * 1024 * 1024 + 1); await file.close(); let replaced = false;
  f.beforeRead(async request => {
    if (request.offset === 100 * 1024 * 1024 && !replaced) {
      replaced = true; const replacement = await open(join(f.root, 'new-large.mp4'), 'w'); await replacement.truncate(100 * 1024 * 1024 + 1); await replacement.close();
      await rename(join(f.root, 'new-large.mp4'), join(f.root, 'replace-large.mp4'));
    }
  });
  const url = await http((req, res, url) => downloadFile(req, res, url, source)); const response = await fetch(url('/media/replace-large.mp4'));
  expect(response.status).toBe(200); let received = 0; let failed = false;
  try { for await (const bytes of response.body!) received += bytes.length; } catch { failed = true; }
  expect(replaced).toBe(true); expect(failed).toBe(true); expect(received).toBeLessThan(100 * 1024 * 1024 + 1);
  expect(f.session.ready).toBe(true);
}, 30000);

it('Remote图片保留64MiB/40M像素上限，HEAD和304不读取原图字节', async () => {
  const implementation = await api(); const f = await target(); const source = implementation.remoteMediaFiles(f.files, 'gateway'); const images = new ImagePreviews();
  await writeFile(join(f.root, 'valid.svg'), svg('red')); const big = await open(join(f.root, 'oversize.png'), 'w'); await big.truncate(64 * 1024 * 1024 + 1); await big.close();
  await writeFile(join(f.root, 'pixels.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="10000" height="10000"/>');
  const url = await http((req, res, url) => images.handle(req, res, url, source));
  const head = await fetch(url('/media/valid.svg'), { method: 'HEAD' }); expect(head.status).toBe(200); expect(f.reads.length).toBe(0);
  const unchanged = await fetch(url('/media/valid.svg'), { headers: { 'if-none-match': head.headers.get('etag')! } }); expect(unchanged.status).toBe(304); expect(f.reads.length).toBe(0);
  const oversized = await fetch(url('/media/oversize.png')); expect(oversized.status).toBe(413); expect(f.reads.length).toBe(0);
  const pixels = await fetch(url('/media/pixels.svg', { thumbnail: '1' })); expect(pixels.status).toBe(413); await body(pixels);
});
