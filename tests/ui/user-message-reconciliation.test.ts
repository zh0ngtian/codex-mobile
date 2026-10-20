import { describe, expect, it } from 'vitest';
import { applyTurnCommentary } from '../../src/app-server/thread-session';
import { appendConversationTitleRequest } from '../../src/app-server/conversation-title';
import { applyCompletedTurn, applyTurnItem, applyTurnStarted, createPendingTurn, reconcileRecentTurns } from '../../src/ui/conversation';
import { projectConversation } from '../../src/native-ui/projection';
import { decodeUserMessage, encodeUserMessage } from '../../server/user-message-format';
import { buildOptimisticUserContent, buildTurnInput, type DraftImage, type UploadedFile } from '../../src/ui/attachments';
import type { InstalledSkill } from '../../src/app-server/skills';
import type { InstalledPlugin } from '../../src/app-server/plugins';

const threadId = 'thread';
const turnId = 'turn';
const text = '一方面做你前面的1和2，如果整轮时间仍在1s之外，再尝试增大并发';
const user = (id: string, body = text, extra: Record<string, unknown> = {}) => ({ id, type: 'userMessage', content: [{ type: 'text', text: body }], ...extra });
const turn = (items: Record<string, any>[]) => ({ id: turnId, status: 'inProgress', items });
const userBubbles = (turns: Record<string, any>[]) => projectConversation({ id: threadId, turns }, path => path).filter(message => message.role === 'user');
const confirmations = [
  { name: '过程回填', apply: (items: Record<string, any>[], confirmed: Record<string, any>) => applyTurnCommentary([turn(items)], { turnId, items: [confirmed], messageOrder: [confirmed.id] }) },
  { name: '摘要对账', apply: (items: Record<string, any>[], confirmed: Record<string, any>) => reconcileRecentTurns([turn(items)], [turn([confirmed])]) },
  { name: '实时事件', apply: (items: Record<string, any>[], confirmed: Record<string, any>) => applyTurnItem({ id: threadId, turns: [turn(items)] }, { threadId, turnId, item: confirmed }).turns },
];
const photo: DraftImage = { id: 'photo', name: 'photo.jpg', type: 'image/jpeg', size: 100, url: 'data:image/jpeg;base64,photo', path: '/tmp/photo.jpg' };
const document: UploadedFile = { name: '需求.pdf', type: 'application/pdf', size: 100, path: '/tmp/request.pdf' };
const reviewSkill: InstalledSkill = { name: 'review', description: '检查附件', path: '/skills/review/SKILL.md', scope: 'user', enabled: true };
const photoPlugin: InstalledPlugin = { id: 'photo-tool', name: 'photo-tool', installed: true, enabled: true, availability: 'AVAILABLE' };
const instructionCases = [
  { label: 'Skill', skills: [reviewSkill], plugins: [] as InstalledPlugin[] },
  { label: '插件', skills: [] as InstalledSkill[], plugins: [photoPlugin] },
  { label: 'Skill 和插件', skills: [reviewSkill], plugins: [photoPlugin] },
];

describe('本地用户消息与服务端确认', () => {
  it('开始回执为空且用户事件缺失时，过程回填确认临时气泡并保持幂等', () => {
    const pending = { id: threadId, turns: [{ id: 'pending-one', status: 'inProgress', items: [user('local-one')] }] };
    const started = applyTurnStarted(pending, { threadId, turn: turn([]) });
    const detail = { turnId, items: [user('confirmed')], messageOrder: ['confirmed'] };
    const restored = applyTurnCommentary(started.turns, detail);
    expect(userBubbles(restored)).toHaveLength(1);
    expect(restored[0].items.map((item: any) => item.id)).toEqual(['confirmed']);
    expect(applyTurnCommentary(restored, detail)).toEqual(restored);
  });

  it('摘要精确命中正式消息后清理同回合已确认的临时副本', () => {
    const restored = reconcileRecentTurns([turn([user('confirmed'), user('local-one')])], [turn([user('confirmed')])]);
    expect(userBubbles(restored)).toHaveLength(1);
    expect(restored[0].items.map((item: any) => item.id)).toEqual(['confirmed']);
  });

  it('实时用户事件到达时也能收敛已经残留的临时副本', () => {
    const updated = applyTurnItem({ id: threadId, turns: [turn([user('confirmed'), user('local-one')])] }, { threadId, turnId, item: user('confirmed') });
    expect(userBubbles(updated.turns)).toHaveLength(1);
  });

  it('迟到运行摘要清理已完成回合残留副本，保留完成状态和较长回复', () => {
    const confirmed = user('confirmed');
    const reply = { id: 'reply', type: 'agentMessage', phase: 'final_answer', text: '已收到的完整最终回复' };
    const completed = { ...turn([user('local-one'), confirmed, reply]), status: 'completed', completedAt: 150 };
    const stale = turn([confirmed, { ...reply, phase: 'commentary', text: '已收到' }]);
    const restored = reconcileRecentTurns([completed], [stale]);
    expect(restored).toEqual([{ ...completed, items: [confirmed, reply] }]);
    expect(userBubbles(restored)).toHaveLength(1);
    expect(reconcileRecentTurns(restored, [stale])).toEqual(restored);
  });

  it('空开始回执后先无详情完成再收到旧运行摘要，首次确认仍收敛为单气泡', () => {
    const pending = { id: threadId, turns: [createPendingTurn('pending-one', user('local-one'))] };
    const started = applyTurnStarted(pending, { threadId, turn: turn([]) });
    const completed = applyCompletedTurn(started, { threadId, turnId });
    const confirmed = user('confirmed');
    const reply = { id: 'reply', type: 'agentMessage', phase: 'commentary', text: '处理完成前的过程' };
    const restored = reconcileRecentTurns(completed.turns, [turn([confirmed, reply])]);
    expect(restored).toEqual([{ ...completed.turns[0], items: [confirmed, reply] }]);
    expect(userBubbles(restored)).toHaveLength(1);
  });

  it('正式消息不与本地副本混淆，两条真实相同正文和后续插话均保留', () => {
    const items = [user('confirmed'), user('steer'), user('other', '另一个问题')];
    const restored = applyTurnCommentary([turn(items)], { turnId, items, messageOrder: items.map(item => item.id) });
    expect(userBubbles(restored)).toHaveLength(3);
    expect(restored[0].items).toEqual(items);
  });

  it('不同回合和未得到相同内容确认的本地消息继续保留', () => {
    const current = [turn([user('local-one', '正在发送的新问题')]), { id: 'older', items: [user('old', text)] }];
    const restored = applyTurnCommentary(current, { turnId, items: [user('confirmed', text)], messageOrder: ['confirmed'] });
    expect(restored[0].items.some((item: any) => item.id === 'local-one')).toBe(true);
    expect(restored[1]).toEqual(current[1]);
  });

  it('首条标题请求不影响关联，回填缺少图片时保留本地附件', () => {
    const local = user('local-one', text);
    local.content.push({ type: 'localImage', path: '/tmp/photo.jpg' } as any);
    const confirmed = user('confirmed', appendConversationTitleRequest(text));
    const restored = applyTurnCommentary([turn([local])], { turnId, items: [confirmed], messageOrder: ['confirmed'] });
    expect(userBubbles(restored)).toHaveLength(1);
    expect(restored[0].items[0].id).toBe('confirmed');
    expect(restored[0].items[0].content).toContainEqual({ type: 'localImage', path: '/tmp/photo.jpg' });
    expect(userBubbles(restored)[0].text).toBe(text);
  });

  it('相同正文但不同附件的两个输入不能误认为同一次发送', () => {
    const local = user('local-one', text, { content: [{ type: 'text', text }, { type: 'localImage', path: '/tmp/new.jpg' }] });
    const confirmed = user('confirmed', text, { content: [{ type: 'text', text }, { type: 'localImage', path: '/tmp/old.jpg' }] });
    const restored = reconcileRecentTurns([turn([confirmed, local])], [turn([confirmed])]);
    expect(userBubbles(restored)).toHaveLength(2);
  });

  it.each(confirmations)('$name 按完整分片正文确认本地输入，并保留正式 ID', ({ apply }) => {
    const local = user('local-one', '第一段\n第二段');
    const confirmed = user('confirmed', '', { content: [{ type: 'text', text: '第一段' }, { type: 'text', text: '第二段', text_elements: [] }] });
    const restored = apply([local], confirmed);
    expect(restored[0].items).toEqual([confirmed]);
    expect(apply(restored[0].items, confirmed)).toEqual(restored);
  });

  it.each(confirmations)('$name 不把分片正文拼接成另一个用户输入', ({ apply }) => {
    const local = user('local-one', '第一段第二段');
    const confirmed = user('confirmed', '', { content: [{ type: 'text', text: '第一段' }, { type: 'text', text: '第二段' }] });
    expect(apply([local], confirmed)[0].items).toHaveLength(2);
  });

  it.each(confirmations)('$name 保留相同正文但不同图片的本地消息', ({ apply }) => {
    const local = user('local-one', text, { content: [{ type: 'text', text }, { type: 'localImage', path: '/tmp/new.jpg' }] });
    const confirmed = user('confirmed', text, { content: [{ type: 'text', text }, { type: 'localImage', path: '/tmp/old.jpg' }] });
    expect(apply([local], confirmed)[0].items).toHaveLength(2);
  });

  it.each(confirmations)('$name 用图片身份确认无正文的同一次输入', ({ apply }) => {
    const content = [{ type: 'localImage', path: '/tmp/photo.jpg' }];
    const confirmed = user('confirmed', '', { content });
    const restored = apply([user('local-one', '', { content })], confirmed);
    expect(restored[0].items).toEqual([confirmed]);
  });

  it.each(confirmations)('$name 不按空正文吞并另一张图片', ({ apply }) => {
    const local = user('local-one', '', { content: [{ type: 'localImage', path: '/tmp/new.jpg' }] });
    const confirmed = user('confirmed', '', { content: [{ type: 'localImage', path: '/tmp/old.jpg' }] });
    expect(apply([local], confirmed)[0].items).toHaveLength(2);
  });

  it.each(confirmations)('$name 缺少正文与图片身份时不猜测确认关系', ({ apply }) => {
    const local = user('local-one', '', { content: [{ type: 'localImage', path: '/tmp/photo.jpg' }] });
    expect(apply([local], user('confirmed', '', { content: [] }))[0].items).toHaveLength(2);
  });

  it.each(confirmations)('$name 保留另一条相同正文的正式插话', ({ apply }) => {
    const previous = user('previous');
    const confirmed = user('confirmed');
    const items = apply([previous], confirmed)[0].items;
    expect(items).toHaveLength(2);
    expect(items).toContainEqual(previous);
    expect(items).toContainEqual(confirmed);
  });

  it.each(confirmations)('$name 能确认带附件包装和标题请求的首条输入', ({ apply }) => {
    const files = [{ name: '设计稿.jpg', path: '/tmp/photo.jpg', isImage: true }];
    const local = user('local-one', encodeUserMessage(text, files));
    local.content.push({ type: 'localImage', path: '/tmp/photo.jpg' } as any);
    const confirmed = user('confirmed', encodeUserMessage(appendConversationTitleRequest(text), files));
    const restored = apply([local], confirmed);
    expect(restored[0].items).toHaveLength(1);
    expect(restored[0].items[0].id).toBe('confirmed');
    expect(restored[0].items[0].content).toContainEqual({ type: 'localImage', path: '/tmp/photo.jpg' });
    expect(userBubbles(restored)[0].text).toBe(text);
  });

  it.each(confirmations)('$name 重复收到省略媒体的确认仍保留已确认附件', ({ apply }) => {
    const image = { type: 'localImage', path: '/tmp/photo.jpg' };
    const local = user('local-one', text, { content: [{ type: 'text', text }, image] });
    const confirmed = user('confirmed');
    const once = apply([local], confirmed);
    expect(once[0].items).toHaveLength(1);
    const twice = apply(once[0].items, confirmed);
    expect(twice[0].items[0].content).toContainEqual(image);
    expect(twice).toEqual(once);
  });

  it.each(confirmations)('$name 正式项已有图片身份时不误认同文的另一份本地附件', ({ apply }) => {
    const previousImage = { type: 'localImage', path: '/tmp/previous.jpg' };
    const previous = user('confirmed', text, { content: [{ type: 'text', text }, previousImage] });
    const local = user('local-one', text, { content: [{ type: 'text', text }, { type: 'localImage', path: '/tmp/new.jpg' }] });
    const restored = apply([previous, local], user('confirmed'));
    expect(restored[0].items).toHaveLength(2);
    expect(restored[0].items.find((item: any) => item.id === 'confirmed').content).toContainEqual(previousImage);
    expect(restored[0].items).toContainEqual(local);
  });

  it.each(confirmations)('$name 可以剥离独立文本分片中的内部标题请求', ({ apply }) => {
    const confirmed = user('confirmed', '', { content: [{ type: 'text', text }, { type: 'text', text: appendConversationTitleRequest('') }] });
    const restored = apply([user('local-one')], confirmed);
    expect(restored[0].items.map((item: any) => item.id)).toEqual(['confirmed']);
  });

  it.each(confirmations)('$name 省略文件包装时仍保留本地附件声明', ({ apply }) => {
    const raw = encodeUserMessage(text, [{ name: '需求.pdf', path: '/tmp/request.pdf' }]);
    const restored = apply([user('local-one', raw)], user('confirmed'));
    expect(restored[0].items).toHaveLength(1);
    expect(restored[0].items[0].id).toBe('confirmed');
    expect(restored[0].items[0].content).toContainEqual({ type: 'text', text: raw });
  });

  it.each(confirmations)('$name 不合并相同正文但不同文件的输入', ({ apply }) => {
    const local = user('local-one', encodeUserMessage(text, [{ name: '新需求.pdf', path: '/tmp/new.pdf' }]));
    const confirmed = user('confirmed', encodeUserMessage(text, [{ name: '旧需求.pdf', path: '/tmp/old.pdf' }]));
    expect(apply([local], confirmed)[0].items).toHaveLength(2);
  });

  it.each(confirmations.flatMap(confirmation => instructionCases.map(instructions => ({ ...confirmation, ...instructions }))))('$name 确认主聊天图片和文件加 $label 的实际发送输入', ({ apply, skills, plugins }) => {
    const body = '$review @photo-tool 请检查图片和文档';
    const local = user('local-one', '', { content: buildOptimisticUserContent(body, [photo], [document]) });
    const confirmed = user('confirmed', '', { content: buildTurnInput(body, [photo], [document], skills, plugins) });
    const restored = apply([local], confirmed);
    expect(restored[0].items).toEqual([confirmed]);
    expect(userBubbles(restored)).toHaveLength(1);
    expect(apply(restored[0].items, confirmed)).toEqual(restored);
  });

  it.each(confirmations)('$name 确认 Sidechat 完整指令输入的纯文本回填时保留图片和文件', ({ apply }) => {
    const entryInput = buildTurnInput('$review @photo-tool 请检查附件', [photo], [document], [reviewSkill], [photoPlugin]);
    const local = user('local-one', '', { content: entryInput });
    const confirmed = user('confirmed', '', { content: entryInput.filter(part => part.type === 'text') });
    const restored = apply([local], confirmed);
    expect(restored[0].items).toHaveLength(1);
    const content = restored[0].items[0].content;
    expect(restored[0].items[0].id).toBe('confirmed');
    expect(content).toContainEqual({ type: 'localImage', path: photo.path });
    expect(content).toContainEqual({ type: 'skill', name: reviewSkill.name, path: reviewSkill.path });
    expect(content).toContainEqual({ type: 'mention', name: photoPlugin.name, path: `plugin://${photoPlugin.id}` });
    const raw = content.filter((part: any) => part.type === 'text').map((part: any) => part.text).join('\n');
    expect(decodeUserMessage(raw).attachments).toContainEqual({ name: document.name, path: document.path });
  });

  it.each(confirmations)('$name 正式输入只省略图片但保留 Skill 和插件时仍恢复本地图片', ({ apply }) => {
    const body = '$review @photo-tool 请检查附件';
    const local = user('local-one', '', { content: buildOptimisticUserContent(body, [photo], [document]) });
    const input = buildTurnInput(body, [photo], [document], [reviewSkill], [photoPlugin]);
    const confirmed = user('confirmed', '', { content: input.filter(part => part.type !== 'image' && part.type !== 'localImage') });
    const restored = apply([local], confirmed);
    expect(restored[0].items).toHaveLength(1);
    expect(restored[0].items[0].content).toContainEqual({ type: 'localImage', path: photo.path });
  });

  it('未知输入片段的身份不同仍保留本地消息', () => {
    const local = user('local-one', text, { content: [{ type: 'text', text }, { type: 'futureAttachment', path: '/tmp/new.bin' }] });
    const confirmed = user('confirmed', text, { content: [{ type: 'text', text }, { type: 'futureAttachment', path: '/tmp/old.bin' }] });
    const restored = applyTurnCommentary([turn([local])], { turnId, items: [confirmed] });
    expect(restored[0].items).toHaveLength(2);
    expect(restored[0].items).toContainEqual(local);
  });

  it('已获空开始回执的同一回合按去除标题请求后的正文确认', () => {
    const pending = { ...turn([user('local-one')]), id: 'pending-one' };
    const started = applyTurnStarted({ id: threadId, turns: [pending] }, { threadId, turn: turn([]) });
    const confirmed = turn([user('confirmed', appendConversationTitleRequest(text))]);
    const restored = reconcileRecentTurns(started.turns, [confirmed]);
    expect(restored).toHaveLength(1);
    expect(restored[0].id).toBe(turnId);
    expect(restored[0].items[0].id).toBe('confirmed');
  });

  it('连续两次发送同一正文按各自回合确认，不进行全文去重', () => {
    const pending = [
      { ...turn([user('local-one')]), id: 'pending-one' },
      { ...turn([user('local-two')]), id: 'pending-two' },
    ];
    const confirmed = [
      { ...turn([user('confirmed-one')]), id: 'turn-one' },
      { ...turn([user('confirmed-two')]), id: 'turn-two' },
    ];
    const restored = reconcileRecentTurns(pending, confirmed);
    expect(restored).toEqual(confirmed);
    expect(userBubbles(restored)).toHaveLength(2);
  });
});
