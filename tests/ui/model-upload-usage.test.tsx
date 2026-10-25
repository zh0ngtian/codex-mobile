import { createRef } from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { ConversationUsagePopover } from '../../src/features/conversation/ConversationUsagePopover';
import { formatByteCount } from '../../src/features/conversation/usage-metrics';
import { validUploadUsage, mergeUploadUsage } from '../../src/app-server/upload-usage';

afterEach(cleanup);

it('上传用量独立于 Token：显示实测值、实时更新，并保持缺失数据为空', () => {
  const props = { open: true, anchorRef: createRef<HTMLButtonElement>(), tokenUsage: null, rateLimits: null, onClose() {} };
  const view = render(<ConversationUsagePopover {...props} uploadUsage={{ lastRequestBytes: 320000, turnBytes: 1800000 }} />);
  const card = screen.getByRole('dialog', { name: '用量与额度' });
  expect(within(card).getByText('最近请求上传').nextElementSibling).toHaveTextContent('320 KB');
  expect(within(card).getByText('本轮累计上传').nextElementSibling).toHaveTextContent('1.8 MB');
  view.rerender(<ConversationUsagePopover {...props} uploadUsage={{ lastRequestBytes: 0, turnBytes: 0 }} />);
  expect(within(card).getAllByText('0 B')).toHaveLength(2);
  view.rerender(<ConversationUsagePopover {...props} uploadUsage={null} />);
  expect(within(card).getByText('最近请求上传').nextElementSibling).toHaveTextContent('暂无数据');
  expect(within(card).getByText('本轮累计上传').nextElementSibling).toHaveTextContent('暂无数据');
});

it('字节按十进制格式化，边界进位，无效值不生成统计', () => {
  for (const [value, text] of [[0, '0 B'], [999, '999 B'], [1000, '1 KB'], [128450, '128.5 KB'], [999999, '1 MB'], [1000000000, '1 GB']] as const) expect(formatByteCount(value)).toBe(text);
  for (const value of [null, undefined, NaN, Infinity, -1, 0.5, '1000', Number.MAX_SAFE_INTEGER + 1]) expect(formatByteCount(value)).toBeNull();
});

it('迟到的只读回填不覆盖实时事件，网关重启后的新计量周期可接管', () => {
  const usage = { epoch: 'a', revision: 3, turnId: 'turn-a', lastRequestBytes: 200, turnBytes: 500, requestCount: 2 };
  expect(validUploadUsage(usage)).toBe(true);
  expect(validUploadUsage({ ...usage, lastRequestBytes: 600 })).toBe(false);
  expect(mergeUploadUsage(usage, { ...usage, revision: 2, turnBytes: 300 })).toEqual(usage);
  expect(mergeUploadUsage(usage, { ...usage, epoch: 'new', revision: 1, turnBytes: 200 }).epoch).toBe('new');
});
