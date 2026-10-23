import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { pendingAsyncQuestions, asyncQuestionText, isAsyncQuestion, sendAsyncQuestionAnswer } from '../../src/features/approvals/async-questions';
import { useApprovalRequests } from '../../src/features/approvals/useApprovalRequests';
import { applyTurnChangeStats } from '../../src/app-server/thread-session';
import { HttpOperationPendingError } from '../../src/backends/http-transport';

it('详情回填恢复问题结构，按消息顺序核对已回答的问题', () => {
  const question = { id: 'async-call', type: 'agentMessage', text: '选择方案？', phase: 'final_answer', delivery: 'async', questions: [{ title: '选择方案？', options: ['A', 'B'] }] };
  const detail = { images: [], questionItems: [question], messageOrder: ['async-call'] };
  const turns = applyTurnChangeStats([{ id: 't', items: [] }], { t: detail });
  expect(pendingAsyncQuestions({ id: 'thread', turns })).toHaveLength(1);
  const summary = applyTurnChangeStats([{ id: 't', items: [{ ...question, text: '保留更完整的实时正文', delivery: null, questions: null }] }], { t: detail });
  expect(pendingAsyncQuestions({ id: 'thread', turns: summary })).toHaveLength(1);
  expect(summary[0].items[0].text).toBe('保留更完整的实时正文');
  const answered = applyTurnChangeStats([{ id: 't', items: [{ id: 'user', type: 'userMessage' }] }], { t: { ...detail, messageOrder: ['async-call', 'user'] } });
  expect(pendingAsyncQuestions({ id: 'thread', turns: answered })).toEqual([]);
});

const item = { id: 'call-question', type: 'agentMessage', delivery: 'async', phase: 'final_answer', text: '实际问题\n- 方案 A\n- 方案 B', questions: [{ title: '实际问题', options: ['方案 A', '方案 B'] }, { title: '补充限制', options: null }] };
const thread = (items: any[] = [item]) => ({ id: 't', turns: [{ id: 'turn', status: 'inProgress', items }] });

it('运行中立即引导，结束后开启新回合，答案与原问题关联且不经过审批回复或草稿', async () => {
  const active = thread(); const [question] = pendingAsyncQuestions(active);
  const result = { answers: { q0: { answers: ['方案 B'] }, q1: { answers: ['保留数据'] } } };
  const client = { request: vi.fn().mockResolvedValue({}) };
  await sendAsyncQuestionAnswer(question, result, active, client, 'answer-uuid');
  expect(client.request).toHaveBeenLastCalledWith('turn/steer', expect.objectContaining({ threadId: 't', expectedTurnId: 'turn', clientUserMessageId: 'answer-uuid', input: [{ type: 'text', text: '实际问题\n方案 B\n\n补充限制\n保留数据', text_elements: [] }] }));
  active.turns[0].status = 'completed';
  await sendAsyncQuestionAnswer(question, result, active, client, 'next-uuid');
  expect(client.request).toHaveBeenLastCalledWith('turn/start', expect.not.objectContaining({ expectedTurnId: expect.anything() }));
  await expect(sendAsyncQuestionAnswer(question, result, { ...active, id: 'other' }, client, 'wrong')).rejects.toThrow('问题已变化');
  expect(client.request).toHaveBeenCalledTimes(2);
});

it('把真实异步消息的问题和选项映射到既有表单，保留自由填写', () => {
  const [request] = pendingAsyncQuestions(thread());
  expect(isAsyncQuestion(request)).toBe(true);
  expect(request.params).toMatchObject({ threadId: 't', turnId: 'turn', itemId: item.id, questions: [
    { id: 'q0', question: '实际问题', isOther: true, options: [{ label: '方案 A' }, { label: '方案 B' }] },
    { id: 'q1', question: '补充限制', isOther: true, options: null },
  ] });
  expect(asyncQuestionText(request, { answers: { q0: { answers: ['方案 B'] }, q1: { answers: ['保留数据\n不改配置'] } } }))
    .toBe('实际问题\n方案 B\n\n补充限制\n保留数据\n不改配置');
});

it('只接结构化异步问题，后续真实用户回答解除旧问题，乐观发送不能提前解除', () => {
  expect(pendingAsyncQuestions(thread([{ ...item, delivery: null }]))).toEqual([]);
  expect(pendingAsyncQuestions(thread([{ ...item, questions: [] }]))).toEqual([]);
  expect(pendingAsyncQuestions(thread([{ ...item, questions: [{ title: '', options: [] }] }]))).toEqual([]);
  expect(pendingAsyncQuestions(thread([item, { id: 'local-draft', type: 'userMessage' }]))).toHaveLength(1);
  expect(pendingAsyncQuestions(thread([item, { id: 'user-answer', type: 'userMessage' }]))).toEqual([]);
});

it('轮询真实审批不会清掉异步问题，稍后恢复草稿，成功后历史快照不再弹出', async () => {
  const { result } = renderHook(useApprovalRequests);
  act(() => result.current.syncAsyncQuestions(thread()));
  act(() => result.current.answer('q0', '方案 B'));
  act(() => result.current.dismiss());
  act(() => result.current.onNotification({ method: 'mobile/requests', params: { requests: [] } }));
  act(() => result.current.syncAsyncQuestions(thread()));
  expect(result.current.approval).toBeNull();
  act(() => result.current.reopen());
  expect(result.current.userAnswers).toEqual({ q0: '方案 B' });
  const respond = vi.fn().mockRejectedValueOnce(new Error('发送失败')).mockResolvedValue(undefined);
  await act(() => result.current.submit({}, { respond }, vi.fn()));
  expect(result.current.userAnswers.q0).toBe('方案 B');
  expect(result.current.error).toBe('发送失败');
  await act(() => result.current.submit({}, { respond }, vi.fn()));
  act(() => result.current.syncAsyncQuestions(thread()));
  expect(result.current.requests).toEqual([]);
});

it('异步问题提交中收到用户回显也保留提交锁，真实审批仍优先显示', async () => {
  const { result } = renderHook(useApprovalRequests);
  act(() => result.current.syncAsyncQuestions(thread()));
  let done!: () => void; let sending!: Promise<unknown>;
  act(() => { sending = result.current.submit({}, { respond: () => new Promise<void>(resolve => { done = resolve; }) }, vi.fn()); });
  act(() => result.current.syncAsyncQuestions(thread([item, { id: 'confirmed-user', type: 'userMessage' }])));
  expect(result.current.submitting).toBe(true);
  await act(async () => { done(); await sending; });
  act(() => result.current.syncAsyncQuestions(thread([{ ...item, id: 'second' }])));
  act(() => result.current.receive({ id: 7, method: 'item/commandExecution/requestApproval' }));
  expect(result.current.approval?.id).toBe(7);
});

it('异步回答结果未知时保留答案和锁，旧快照及审批轮询不触发第二次发送', async () => {
  const { result } = renderHook(useApprovalRequests);
  act(() => result.current.syncAsyncQuestions(thread()));
  act(() => result.current.answer('q0', '保留的回答'));
  const respond = vi.fn().mockRejectedValue(new HttpOperationPendingError('answer-op', { method: 'turn/steer' }));
  let confirmed!: (response: any) => void;
  await act(() => result.current.submit({}, { respond }, (_id, callback) => { confirmed = callback; }));
  act(() => result.current.onNotification({ method: 'mobile/requests', params: { requests: [{ id: 7, method: 'item/commandExecution/requestApproval' }] } }));
  act(() => result.current.syncAsyncQuestions(thread()));
  act(() => result.current.answer('q0', '不能覆盖'));
  act(() => result.current.dismiss());
  await act(() => result.current.submit({}, { respond }, vi.fn()));
  expect(result.current.submitting).toBe(true);
  expect(result.current.userAnswers.q0).toBe('保留的回答');
  expect(respond).toHaveBeenCalledOnce();
  act(() => confirmed({ result: {} }));
  expect(result.current.approval?.id).toBe(7);
});
