import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { sidechatReplayItems } from '../../server/sidechat-replay.js';

it('历史重建保留问题、图片、引用封装和工具结果，不生成待执行工具调用', async () => {
 const root = await mkdtemp(join(tmpdir(), 'sidechat-image-replay-'));
 try {
  const image = join(root, 'image.jpg'); await writeFile(image, Buffer.from('private-image'));
  const items = await sidechatReplayItems([{ items: [
   { type: 'userMessage', content: [{ type: 'text', text: '冻结引用与问题 $skill' }, { type: 'localImage', path: image }, { type: 'text', text: '已上传文件：report.txt\n本机路径：/tmp/report.txt' }] },
   { type: 'commandExecution', command: 'echo previous', aggregatedOutput: '原工具结果' },
   { type: 'agentMessage', text: '原回复' },
  ] }]);
  expect(items[0]).toMatchObject({ type: 'message', role: 'user', content: [{ type: 'input_text', text: '冻结引用与问题 $skill' }, { type: 'input_image', image_url: 'data:image/jpeg;base64,cHJpdmF0ZS1pbWFnZQ==' }, { type: 'input_text', text: expect.stringContaining('report.txt') }] });
  expect(items[1]).toMatchObject({ role: 'assistant', content: [{ type: 'output_text', text: expect.stringContaining('原工具结果') }] });
  expect(items.every(item => item.type === 'message')).toBe(true);
 } finally { await rm(root, { recursive: true, force: true }); }
});

it('原图片不可读取时明确失败，不能丢掉附件后继续重发', async () => {
 await expect(sidechatReplayItems([{ items: [{ type: 'userMessage', content: [{ type: 'localImage', path: '/does-not-exist/sidechat-image.png' }] }] }])).rejects.toThrow();
});
