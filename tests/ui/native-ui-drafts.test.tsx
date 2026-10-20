import { act, render, waitFor, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { NativeRuntime } from '../../src/native-ui/runtime';
import { DraftsSheet } from '../../src/features/drafts/DraftsSheet';
import { newChatDraftStore } from '../../src/features/drafts/new-chat-drafts';
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('草稿面板只投影元数据并将原IDB二进制记录交回现有恢复回调且删除原记录', async () => {
 const saved = { id: 'd', text: '原草稿', backendName: 'Mac', images: [], files: [{ bytes: new ArrayBuffer(3) }], updatedAt: Date.now() } as any;
 vi.spyOn(newChatDraftStore, 'list').mockResolvedValue([saved]); const remove = vi.spyOn(newChatDraftStore, 'remove').mockResolvedValue();
 const restored: unknown[] = []; const runtime = new NativeRuntime(() => {});
 render(<DraftsSheet nativeRuntime={runtime} onClose={() => {}} onOpenDraft={v => restored.push(v)} />);
 await waitFor(() => expect(JSON.stringify(runtime.snapshot().panel)).toContain('原草稿'));
 expect(JSON.stringify(runtime.snapshot().panel)).not.toContain('bytes');
 await act(async () => { await runtime.dispatch({ id: 'restore', name: 'drafts.restore', params: { id: 'd' } }); }); expect(restored).toEqual([saved]);
 await act(async () => { await runtime.dispatch({ id: 'remove', name: 'drafts.remove', params: { id: 'd' } }); }); expect(remove).toHaveBeenCalledWith('d'); runtime.dispose();
});
