// @vitest-environment node
import { IDBFactory } from 'fake-indexeddb';
import { expect, it } from 'vitest';
import { NativeSwitchStore, restoreSwitchWorkspace } from '../../src/native-ui/switch-store';
import { NewChatDraftStore } from '../../src/features/drafts/new-chat-drafts';
const workspace = (backendId: string) => ({ backendId, backendName: backendId, cwd: '/project', text: `草稿 ${backendId}`, thread: { id: 'thread', cwd: '/project', preview: '已有线程' },
 settings: { model: 'model', effort: 'high', serviceTier: null, permissions: ':workspace', approvalPolicy: 'on-request' as const, approvalsReviewer: 'user' as const },
 images: [{ id: 'image', name: 'a.png', type: 'image/png', size: 3, url: 'data:image/png;base64,YWJj' }],
 files: [{ id: 'f', name: 'a.bin', type: 'application/octet-stream', size: 3, file: new File([new Uint8Array([0, 255, 1])], 'a.bin'), previewUrl: 'blob:old' }] });
it('检查点原子保存全部workspace与设置，冷启动恢复实际二进制且不进入手动草稿列表', async () => {
 const factory = new IDBFactory(); const store = new NativeSwitchStore(factory);
 await store.save({ version: 1, registry: { version: 1, selectedBackendId: 'b', backends: [] }, storage: { 'codex-mobile:font-size': 'large' }, workspaces: [workspace('a'), workspace('b')] });
 const saved = await new NativeSwitchStore(factory).load();
 expect(saved?.registry.selectedBackendId).toBe('b'); expect(saved?.workspaces.map(w => w.text)).toEqual(['草稿 a', '草稿 b']);
 const restored = restoreSwitchWorkspace(saved!.workspaces[0]);
 expect([...new Uint8Array(await restored.files[0].file.arrayBuffer())]).toEqual([0, 255, 1]);
 expect(restored.files[0].previewUrl).not.toBe('blob:old'); URL.revokeObjectURL(restored.files[0].previewUrl);
 expect(await new NewChatDraftStore(factory).list()).toEqual([]);
 await store.remove(); expect(await store.load()).toBeNull();
});
it('文件读取失败不覆盖已有完整检查点', async () => {
 const store = new NativeSwitchStore(new IDBFactory());
 const input = { version: 1 as const, registry: { version: 1 as const, selectedBackendId: 'a', backends: [] }, storage: {}, workspaces: [workspace('a')] };
 await store.save(input); const bad = workspace('b'); bad.files[0].file.arrayBuffer = async () => { throw new Error('无法读附件'); };
 await expect(store.save({ ...input, workspaces: [bad] })).rejects.toThrow('无法读附件');
 expect((await store.load())?.workspaces[0].backendId).toBe('a');
});
