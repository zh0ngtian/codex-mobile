import { afterEach, expect, it, vi } from 'vitest';
import { AutomaticThreadNames } from '../../server/automatic-thread-names.js';

afterEach(() => vi.useRealTimers());
it('只等已登记的命名，候选未保存时不释放，成功保存后释放', async () => {
  const names = new AutomaticThreadNames(); const ticket = names.begin('a'); let done = false;
  void names.wait('a').then(() => { done = true; });
  ticket.candidate('候选'); await Promise.resolve(); expect(done).toBe(false);
  await names.wait('other'); names.saved('a'); await Promise.resolve(); expect(done).toBe(true);
  names.close();
});
it('失败或超时释放，匹配候选的保存失败不采用候选名', async () => {
  vi.useFakeTimers(); const names = new AutomaticThreadNames(125_000);
  const first = names.begin('failure'); first.fail(); await names.wait('failure');
  names.begin('save').candidate('自动候选'); let saved = false;
  void names.wait('save').then(() => { saved = true; });
  names.failedSave('save', '别的手工名称'); await Promise.resolve(); expect(saved).toBe(false);
  names.failedSave('save', '自动候选'); await Promise.resolve(); expect(saved).toBe(true);
  names.begin('timeout'); let timedOut = false; void names.wait('timeout').then(() => { timedOut = true; });
  await vi.advanceTimersByTimeAsync(124_999); expect(timedOut).toBe(false);
  await vi.advanceTimersByTimeAsync(1); expect(timedOut).toBe(true); expect(vi.getTimerCount()).toBe(0);
  names.close();
});
it('旧请求迟到不能结束新一轮命名，关闭取消全部等待及定时器', async () => {
  vi.useFakeTimers(); const names = new AutomaticThreadNames(); const old = names.begin('a');
  names.saved('a'); names.begin('a'); let done = false; void names.wait('a').then(() => { done = true; });
  old.fail(); await Promise.resolve(); expect(done).toBe(false);
  names.close(); await Promise.resolve(); expect(done).toBe(true); expect(vi.getTimerCount()).toBe(0);
  names.begin('closed'); await names.wait('closed'); expect(vi.getTimerCount()).toBe(0);
});
