import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
function install() {
  const script = readFileSync('mobile/ios/AttachmentPickerBridge.swift', 'utf8').match(/static let script = """\n([\s\S]*?)\n\s*"""/)![1];
  const post = vi.fn(); (window as any).webkit = { messageHandlers: { attachmentPicker: { postMessage: post } } };
  new Function(script)();
  return { post, pick: (window as any).codexMobilePickAttachments, complete: (window as any).codexMobileAttachmentsComplete };
}
afterEach(() => { (window as any).codexMobileAttachmentsDispose?.(); delete (window as any).webkit; });
it('显式promise无需input或DOM点击返回真实File并与旧input路由隔离', async () => {
  const { post, pick, complete } = install(); expect(typeof pick).toBe('function');
  const pending = pick('photos'); expect(post.mock.calls[0][0]).toMatchObject({ kind: 'photos', multiple: true });
  complete({ id: post.mock.calls[0][0].id, files: [{ name: '照片.png', type: 'image/png', data: 'YQ==' }] });
  const files = await pending; expect(files[0]).toBeInstanceOf(File); expect(files[0].name).toBe('照片.png'); expect(files[0].size).toBe(1);
});
it('取消返回空列表，读取错误reject而非吞掉错误，dispose不悬挂promise', async () => {
  const { post, pick, complete } = install(); expect(typeof pick).toBe('function');
  const cancelled = pick('files'); complete({ id: post.mock.calls[0][0].id, files: [] }); expect(await cancelled).toEqual([]);
  const failed = pick('files'); const failure = expect(failed).rejects.toThrow('读取失败'); complete({ id: post.mock.calls[1][0].id, files: [], error: '读取失败' }); await failure;
  const disposed = pick('photos'); const disposal = expect(disposed).rejects.toThrow(); (window as any).codexMobileAttachmentsDispose(); await disposal;
});
