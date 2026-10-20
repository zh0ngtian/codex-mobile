// @vitest-environment node
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { NewChatDraftStore, restoreNewChatDraft, type NewChatDraftInput } from '../../src/features/drafts/new-chat-drafts';

const input = (): NewChatDraftInput => ({
  backendId: 'mini', backendName: 'Mac mini', cwd: '/work/project', text: 'draft @pdf',
  settings: { model: 'gpt-test', effort: 'high', serviceTier: 'fast', permissions: ':workspace', approvalPolicy: 'on-request', approvalsReviewer: 'auto_review' },
  images: [{ id: 'image', name: 'photo.png', type: 'image/png', size: 3, url: 'data:image/png;base64,YWJj' }],
  files: [{ id: 'file', name: 'notes.txt', type: 'text/plain', size: 16, file: new File(['local attachment'], 'notes.txt', { type: 'text/plain', lastModified: 10 }), previewUrl: 'blob:temporary' }],
});

describe('新对话持久草稿', () => {
  it('另一个实例恢复全部配置、图片和文件实际内容，不保存临时预览地址', async () => {
    const factory = new IDBFactory();
    const first = new NewChatDraftStore(factory);
    const record = await first.save(input());
    const [saved] = await new NewChatDraftStore(factory).list();
    expect(saved).toEqual(record);
    expect(saved.settings).toEqual(input().settings);
    expect(saved.files[0]).not.toHaveProperty('previewUrl');
    const restored = restoreNewChatDraft(saved);
    expect(restored.images).toEqual(input().images);
    expect(await restored.files[0].file.text()).toBe('local attachment');
    expect(restored.files[0].file.lastModified).toBe(10);
    expect(restored.files[0].previewUrl).toMatch(/^blob:/);
    URL.revokeObjectURL(restored.files[0].previewUrl);
  });

  it('编辑恢复的草稿更新原记录，过期的发送确认不会删除新版本', async () => {
    const store = new NewChatDraftStore(new IDBFactory());
    const original = await store.save(input());
    const updated = await store.save({ ...input(), text: 'updated', cwd: null }, original.id);
    expect(updated.id).toBe(original.id);
    expect(updated.revision).not.toBe(original.revision);
    await store.remove(original.id, original.revision);
    expect((await store.list()).map(draft => draft.text)).toEqual(['updated']);
    await store.remove(updated.id, updated.revision);
    expect(await store.list()).toEqual([]);
  });

  it('草稿跨设备汇总，单条删除不影响其他草稿', async () => {
    const store = new NewChatDraftStore(new IDBFactory());
    const one = await store.save(input());
    const two = await store.save({ ...input(), backendId: 'laptop', text: 'second' });
    expect(new Set((await store.list()).map(draft => draft.backendId))).toEqual(new Set(['mini', 'laptop']));
    await store.remove(one.id);
    expect((await store.list()).map(draft => draft.id)).toEqual([two.id]);
  });

  it('存储拒绝访问时明确失败，不伪报保存成功', async () => {
    const factory = { open: () => { throw new Error('storage denied'); } } as unknown as IDBFactory;
    await expect(new NewChatDraftStore(factory).save(input())).rejects.toThrow('storage denied');
  });
});
