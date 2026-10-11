import { expect, test } from '@playwright/test';

for (const acknowledgement of ['retry', 'cancel'] as const) {
test(`网关托管队列支持刷新恢复、编辑保留附件、取消与引导：${acknowledgement}`, async ({ page }) => {
  const thread = { id: 'hosted-thread', name: '托管队列会话', cwd: '/tmp/project', status: { type: 'active' }, turns: [{ id: 'running', status: 'inProgress', items: [] }] };
  let items: any[] = [];
  const submitted: any[] = [];
  const acceptedIds = new Set<string>();
  let loseAck = true;
  let uploads = 0;
  await page.addInitScript(() => localStorage.setItem('codex-mobile:language', 'zh-CN'));
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/follow-ups') {
      if (route.request().method() === 'GET') return route.fulfill({ json: { items } });
      const action = route.request().postDataJSON();
      submitted.push(action);
      const existing = items.find((item) => item.id === action.id);
      if (action.action === 'enqueue') {
        if (!acceptedIds.has(action.id)) { acceptedIds.add(action.id); items.push({ ...action, state: 'queued', revision: 1 }); }
        if (loseAck) { loseAck = false; return route.abort('internetdisconnected'); }
      } else if (action.action === 'edit') {
        Object.assign(existing, { inputText: action.inputText, text: action.text, revision: existing.revision + 1 });
      } else if (action.action === 'cancel' || action.action === 'steer') items = items.filter((item) => item.id !== action.id);
      return route.fulfill({ json: { items, ...(action.action === 'steer' ? { turnId: 'running' } : {}) } });
    }
    if (url.pathname === '/api/uploads/file') { uploads++; return route.fulfill({ json: { name: 'keep.txt', path: `/tmp/keep-${uploads}.txt`, type: 'text/plain', size: 3 } }); }
    if (url.pathname === '/api/projects') return route.fulfill({ json: { projects: ['/tmp/project'], projectlessThreadIds: [] } });
    if (url.pathname === '/api/host') return route.fulfill({ json: { hostId: 'hosted', appServerReady: true, httpPolling: true, followUpQueue: true } });
    if (url.pathname === '/api/events') return route.fulfill({ json: { epoch: 'hosted', cursor: 0, messages: [], requests: [], active: true, updatedAt: Date.now(), reset: false } });
    if (url.pathname !== '/api/rpc') return route.fulfill({ json: {} });
    const { message } = route.request().postDataJSON();
    const responses: Record<string, any> = {
      initialize: {},
      'model/list': { data: [{ model: 'gpt-test', displayName: 'GPT Test', isDefault: true, supportedReasoningEfforts: [], serviceTiers: [] }] },
      'permissionProfile/list': { data: [{ id: ':workspace', allowed: true }] },
      'config/read': { config: { sandbox_mode: 'workspace-write' } },
      'thread/list': { data: [thread], nextCursor: null },
      'thread/resume': { thread, initialTurnsPage: { data: thread.turns, nextCursor: null }, model: 'gpt-test', approvalPolicy: 'on-request', approvalsReviewer: 'user' },
      'thread/turns/list': { data: thread.turns, nextCursor: null },
      'thread/read': { thread },
    };
    if (message.method === 'turn/start' || message.method === 'turn/steer') throw new Error('客户端不应直接调度托管队列');
    return route.fulfill({ json: { id: message.id, result: responses[message.method] ?? {} } });
  });
  const openThread = async () => page.getByRole('button', { name: /托管队列会话/ }).first().click();
  await page.goto('/'); await openThread();
  const composer = page.getByRole('textbox', { name: '向 Codex 提问' });
  await composer.fill('等待后续执行');
  await page.locator('input[aria-label="选择文件"]').setInputFiles({ name: 'keep.txt', mimeType: 'text/plain', buffer: Buffer.from('abc') });
  await page.getByRole('button', { name: '排队', exact: true }).click();
  await expect(composer).toHaveValue('等待后续执行');
  await expect(page.getByRole('status', { name: '排队消息' })).toContainText('等待后续执行');
  if (acknowledgement === 'cancel') {
    await page.getByRole('button', { name: '取消排队消息' }).click();
    await expect(page.getByRole('status', { name: '排队消息' })).toHaveCount(0);
    await expect(composer).toHaveValue('等待后续执行');
  }
  // 未取消时原 UUID 重试；明确取消后再次提交必须使用新的身份。
  await page.getByRole('button', { name: '排队', exact: true }).click();
  await expect(composer).toHaveValue('');
  expect(items).toHaveLength(1);
  expect(uploads).toBe(acknowledgement === 'cancel' ? 2 : 1);
  const enqueues = submitted.filter((action) => action.action === 'enqueue');
  if (acknowledgement === 'cancel') expect(enqueues[0].id).not.toBe(enqueues[1].id);
  else expect(enqueues[0].id).toBe(enqueues[1].id);
  await page.reload(); await openThread();
  await expect(page.getByRole('status', { name: '排队消息' })).toContainText('等待后续执行');
  await page.getByRole('button', { name: '编辑排队消息' }).click();
  await page.getByRole('textbox', { name: '编辑排队消息内容' }).fill('修改托管正文');
  await page.getByRole('button', { name: '保存排队消息' }).click();
  await expect(page.getByRole('status', { name: '排队消息' })).toContainText('修改托管正文');
  await page.getByRole('button', { name: '取消排队消息' }).click();
  await expect(page.getByRole('status', { name: '排队消息' })).toHaveCount(0);
  await composer.fill('即时调整方向');
  await page.locator('input[aria-label="选择文件"]').setInputFiles({ name: 'keep.txt', mimeType: 'text/plain', buffer: Buffer.from('abc') });
  await page.getByRole('button', { name: '排队', exact: true }).click();
  await expect(page.getByRole('status', { name: '排队消息' })).toContainText('即时调整方向');
  const enqueued = submitted.filter((action) => action.action === 'enqueue').at(-1);
  expect(JSON.stringify(enqueued.extraInput)).toContain(`/tmp/keep-${acknowledgement === 'cancel' ? 3 : 2}.txt`);
  expect(enqueued.settings.model).toBe('gpt-test');
  await page.getByRole('button', { name: '编辑排队消息' }).click();
  await page.getByRole('textbox', { name: '编辑排队消息内容' }).fill('附件保持不变');
  await page.getByRole('button', { name: '保存排队消息' }).click();
  await expect(page.getByRole('status', { name: '排队消息' })).toContainText('附件保持不变');
  expect(items[0].attachmentCount).toBe(1);
  expect(JSON.stringify(items[0].extraInput)).toContain(`/tmp/keep-${acknowledgement === 'cancel' ? 3 : 2}.txt`);
  await page.getByRole('button', { name: '改为引导', exact: true }).click();
  await expect(page.getByRole('status', { name: '排队消息' })).toHaveCount(0);
  expect(submitted.at(-1)).toMatchObject({ action: 'steer', revision: 2 });
});

}

for (const delay of ['ack', 'upload'] as const) {
test(`入队未确认时切换会话保留草稿；回合结束后重试仍复用队列 ID：${delay}`, async ({ page }) => {
  const thread: any = { id: 'pending-hosted', name: '未确认托管', cwd: '/tmp/project', status: { type: 'active' }, turns: [{ id: 'old', status: 'inProgress', items: [] }] };
  const other = { id: 'other', name: '其他会话', cwd: '/tmp/project', status: { type: 'idle' }, turns: [] };
  const items: any[] = [];
  const submissions: any[] = [];
  let release: (() => void) | undefined;
  let uploads = 0;
  let completed = false;
  let archives = 0;
  await page.addInitScript(() => localStorage.setItem('codex-mobile:language', 'zh-CN'));
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/follow-ups') {
      if (route.request().method() === 'GET') return route.fulfill({ json: { items } });
      const action = route.request().postDataJSON(); submissions.push(action);
      if (!items.length) items.push({ ...action, state: 'queued', revision: 1 });
      if (submissions.length === 1) {
        if (delay === 'ack') await new Promise<void>((resolve) => { release = resolve; });
        return route.abort('internetdisconnected');
      }
      return route.fulfill({ json: { items } });
    }
    if (url.pathname === '/api/uploads/file') { uploads++; if (delay === 'upload' && uploads === 1) await new Promise<void>((resolve) => { release = resolve; }); return route.fulfill({ json: { name: 'retain.txt', path: `/tmp/upload-${uploads}.txt`, type: 'text/plain', size: 3 } }); }
    if (url.pathname === '/api/projects') return route.fulfill({ json: { projects: ['/tmp/project'], projectlessThreadIds: [] } });
    if (url.pathname === '/api/host') return route.fulfill({ json: { hostId: 'switch', appServerReady: true, httpPolling: true, followUpQueue: true } });
    if (url.pathname === '/api/events') return route.fulfill({ json: { epoch: 'switch', cursor: completed ? 1 : 0, messages: completed && Number(url.searchParams.get('after')) < 1 ? [{ method: 'turn/completed', params: { threadId: thread.id, turn: { id: 'old', status: 'completed', items: [] } } }] : [], requests: [], active: !completed, updatedAt: Date.now(), reset: false } });
    if (url.pathname !== '/api/rpc') return route.fulfill({ json: {} });
    const { message } = route.request().postDataJSON();
    const target = message.params?.threadId === other.id ? other : thread;
    const responses: Record<string, any> = {
      initialize: {}, 'model/list': { data: [{ model: 'gpt-test', displayName: 'GPT Test', isDefault: true, supportedReasoningEfforts: [], serviceTiers: [] }] },
      'permissionProfile/list': { data: [{ id: ':workspace', allowed: true }] },
      'config/read': { config: { sandbox_mode: 'workspace-write' } },
      'thread/list': { data: [thread, other], nextCursor: null },
      'thread/resume': { thread: target, initialTurnsPage: { data: target.turns, nextCursor: null }, model: 'gpt-test' },
      'thread/read': { thread: target }, 'thread/turns/list': { data: target.turns, nextCursor: null },
    };
    if (message.method === 'thread/archive') archives++;
    if (['turn/start', 'turn/steer'].includes(message.method)) throw new Error('未确认入队不能改走直接发送');
    return route.fulfill({ json: { id: message.id, result: responses[message.method] ?? {} } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: /未确认托管/ }).first().click();
  const composer = page.getByRole('textbox', { name: '向 Codex 提问' });
  await composer.fill('原始待确认输入');
  await page.locator('input[aria-label="选择文件"]').setInputFiles({ name: 'retain.txt', mimeType: 'text/plain', buffer: Buffer.from('abc') });
  await page.getByRole('button', { name: '排队', exact: true }).click();
  await expect.poll(() => Boolean(release)).toBe(true);
  await page.getByRole('button', { name: '打开会话列表' }).click();
  await page.getByRole('button', { name: /其他会话/ }).first().click();
  if (delay === 'upload') {
    await page.getByRole('button', { name: '打开会话列表' }).click();
    await page.getByRole('button', { name: /未确认托管/ }).first().click();
    await expect(page.getByRole('button', { name: '排队', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: '会话操作', exact: true }).click();
    await page.getByRole('button', { name: '归档', exact: true }).click();
    await expect(page.getByText('排队消息正在同步，请稍后重试', { exact: true })).toBeVisible();
    expect(archives).toBe(0);
    await page.getByRole('button', { name: '关闭会话操作', exact: true }).click({ position: { x: 5, y: 5 } });
    await page.getByRole('button', { name: '打开会话列表' }).click();
    await page.getByRole('button', { name: /其他会话/ }).first().click();
  }
  release!();
  await expect.poll(() => submissions.length).toBe(1);
  completed = true; thread.status = { type: 'idle' }; thread.turns[0].status = 'completed';
  await page.getByRole('button', { name: '打开会话列表' }).click();
  await page.getByRole('button', { name: /未确认托管/ }).first().click();
  await expect(composer).toHaveValue('原始待确认输入');
  await expect(page.getByText('retain.txt', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(composer).toHaveValue('');
  expect(submissions).toHaveLength(2);
  expect(submissions[1]).toEqual(submissions[0]);
  expect(uploads).toBe(1);
});

}
