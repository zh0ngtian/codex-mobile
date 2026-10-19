import { describe, expect, it } from 'vitest';
import { decodeUserMessage, encodeUserMessage, replaceUserMessageBody } from '../../server/user-message-format';
import { buildTurnInput, buildOptimisticUserContent } from '../../src/ui/attachments';
import { createHistoricalMessageEditTarget, buildEditedHistoryInput } from '../../src/app-server/history-edit';
import { projectConversation } from '../../src/native-ui/projection';

const file = { name: '说明 中文 (1).txt', path: '/tmp/说明 中文 (1).txt', type: 'text/plain', size: 10 };
const image = { id: 'photo', name: '照片.jpg', type: 'image/jpeg', size: 3, url: 'data:image/jpeg;base64,YWJj', path: '/tmp/photo.jpg' };
const references = [{ text: '中文😀\n## My request:\n被引用内容', source: { messageId: 'source', startOffset: 0, endOffset: 4 } }];

describe('桌面新消息格式', () => {
  it('混合引用附件组装后严格往返，正文中的同名标记不截断正文', () => {
    const body = '检查附件\n## My request:\n仍属于问题';
    const raw = encodeUserMessage(body, [file], references);
    expect(raw).toContain('\n# Response annotations:\n');
    expect(raw).toContain('\n# Files mentioned by the user:\n');
    expect(decodeUserMessage(raw)).toMatchObject({ body, attachments: [{ name: file.name, path: file.path }], references });
    expect(decodeUserMessage(replaceUserMessageBody(raw, '新问题'))).toMatchObject({ body: '新问题', references, attachments: [{ path: file.path }] });
  });
  it('损坏包装、代码示例和普通标题不吞掉用户内容', () => {
    for (const text of ['开头\n## My request:\n正文', '```\n# Files mentioned by the user:\n## a: /tmp/a\n## My request:\n```', '\n# Response annotations:\n<response-annotations>\nINVALID\n</response-annotations>\n\n## My request:\n问题']) {
      expect(decodeUserMessage(text)).toMatchObject({ body: text, attachments: [], references: [] });
    }
  });
  it('图片文件与引用使用单个文本包装，原生即时和回读投影相同', () => {
    const input = buildTurnInput(encodeUserMessage('问题', [], references), [image], [file]);
    expect(input.filter(part => part.type === 'text')).toHaveLength(1);
    expect(input).toContainEqual({ type: 'localImage', path: image.path });
    const raw = String((input[0] as any).text);
    expect(decodeUserMessage(raw)).toMatchObject({ body: '问题', references });
    const project = (content: unknown[]) => projectConversation({ id: 'thread', turns: [{ id: 'turn', items: [{ id: 'user', type: 'userMessage', content }] }] }, p => `thumbnail:${p}`, p => `original:${p}`, p => `download:${p}`);
    const before = project(buildOptimisticUserContent(encodeUserMessage('问题', [], references), [image], [file]))[0];
    const after = project(input)[0];
    expect(after.text).toBe('问题');
    expect(after.references).toMatchObject(references);
    expect(after.blocks).toHaveLength(2);
    expect(after).toEqual(before);
  });
  it('历史编辑只改问题并保留附件、引用和结构化图片', () => {
    const input = buildTurnInput(encodeUserMessage('原问题', [], references), [image], [file]);
    const target = createHistoricalMessageEditTarget([{ id: 'turn', items: [{ id: 'message', type: 'userMessage', content: input }] }], 'turn')!;
    expect(target.text).toBe('原问题');
    expect(target.attachmentCount).toBe(2);
    const edited = buildEditedHistoryInput(target, '新问题');
    expect(decodeUserMessage(String(edited[0].text))).toMatchObject({ body: '新问题', references });
    expect(edited).toContainEqual({ type: 'localImage', path: image.path });
    expect(decodeUserMessage(String(edited[0].text)).attachments).toHaveLength(2);
  });
});

it('托管队列按去重的结构化图片和文件声明计数', async () => {
 const { messageAttachmentCount } = await import('../../server/user-message-format');
 const input = buildTurnInput('问题', [image], [file, { ...file, path: '/tmp/another.txt' }]);
 expect(messageAttachmentCount((input[0] as any).text, input.filter(part => part.type !== 'text'))).toBe(3);
});
it('引用标记只在正文转换，代码样例和无效序号保持原样', async () => {
 const { responseAnnotationDisplay } = await import('../../src/features/conversation/response-annotations');
 const text = '回答 :codex-annotation{index="1"}\n\n`:codex-annotation{index="1"}`\n\n```\n:codex-annotation{index="1"}\n```\n\n:codex-annotation{index="9"}';
 const display = responseAnnotationDisplay(text, references);
 expect(display).toContain('回答 [引用 1](#codex-annotation-1)');
 expect(display.match(/#codex-annotation-1/g)).toHaveLength(1);
 expect(display).toContain(':codex-annotation{index="9"}');
});
it('精确来源使用UTF16位置，渲染转换过的片段只保留快照', async () => {
 const { quoteSource, validateMessageQuote, quoteInput } = await import('../../src/features/conversation/message-quotes');
 const item = { id: 'source-emoji', type: 'agentMessage', text: '前文😀后文' };
 const thread = { id: 'thread', turns: [{ id: 'turn', items: [item] }] };
 const quote = validateMessageQuote({ source: quoteSource('backend', 'thread', 'turn', item), renderedText: item.text, start: 2, end: 4, text: '😀' }, 'backend', thread);
 expect(decodeUserMessage(quoteInput('问题', [quote])).references[0].source).toEqual({ messageId: item.id, startOffset: 2, endOffset: 4 });
 const formatted = { ...item, text: '**重点**' };
 const snapshot = validateMessageQuote({ source: quoteSource('backend', 'thread', 'turn', formatted), renderedText: '重点', start: 0, end: 2, text: '重点' }, 'backend', { ...thread, turns: [{ id: 'turn', items: [formatted] }] });
 expect(decodeUserMessage(quoteInput('问题', [snapshot])).references[0].source).toBeUndefined();
});
it('带引用标记的回答仍能按实际显示文字继续选文', async () => {
 const { quoteSource, validateMessageQuote } = await import('../../src/features/conversation/message-quotes');
 const user = { id: 'user', type: 'userMessage', content: [{ type: 'text', text: encodeUserMessage('问题', [], references) }] };
 const item = { id: 'answer', type: 'agentMessage', text: '回答 :codex-annotation{index="1"}' };
 const thread = { id: 'thread', turns: [{ id: 'turn', items: [user, item] }] };
 const renderedText = '回答 引用 1';
 expect(validateMessageQuote({ source: quoteSource('backend', 'thread', 'turn', item), renderedText, start: 0, end: renderedText.length, text: renderedText }, 'backend', thread).text).toBe(renderedText);
});

it.each(['我', ''])('首条带图片消息在自动标题请求回读后仍与即时显示一致：%s', async body => {
 const { appendConversationTitleRequest } = await import('../../src/app-server/conversation-title');
 const input = buildTurnInput(appendConversationTitleRequest(body), [image]);
 const project = (content: unknown[]) => projectConversation({ id: 'first-thread', turns: [{ id: 'first-turn', items: [{ id: 'first-message', type: 'userMessage', content }] }] }, path => `thumbnail:${path}`, path => `original:${path}`);
 const optimistic = project(buildOptimisticUserContent(body, [image]))[0];
 const restored = project(input)[0];
 expect(restored.text).toBe(body);
 expect(restored.rawText).not.toContain('conversation_title_request');
 expect(restored.blocks).toEqual(optimistic.blocks);
 expect(restored.text).toBe(optimistic.text);
 const target = createHistoricalMessageEditTarget([{ id: 'first-turn', items: [{ id: 'first-message', type: 'userMessage', content: input }] }], 'first-turn')!;
 expect(target.text).toBe(body);
 expect(target.attachmentCount).toBe(1);
});
