import { expect, test, type Page } from '@playwright/test';

async function mockGateway(page: Page) {
  const calls: any[] = [];
  const uploads: Buffer[] = [];
  let failSend = true;
  let modelDelay = 0;
  await page.addInitScript(() => {
    localStorage.setItem('codex-mobile:language', 'zh-CN');
    const nativeFetch = window.fetch.bind(window);
    (window as any).__draftUploadBytes = [];
    window.fetch = async (input, init) => {
      if (new URL(String(input), location.href).pathname === '/api/uploads/file' && init?.body instanceof File) {
        (window as any).__draftUploadBytes.push(Array.from(new Uint8Array(await init.body.arrayBuffer())));
      }
      return nativeFetch(input, init);
    };
    if (!localStorage.getItem('codex-mobile.backend-registry.v1')) localStorage.setItem('codex-mobile.backend-registry.v1', JSON.stringify({ version: 1, selectedBackendId: 'test', backends: [{ id: 'test', name: '测试设备', baseUrl: location.origin, token: '', enabled: true, order: 0 }] }));
  });
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/host') return route.fulfill({ json: { hostId: 'test', gatewayVersion: '0.2.0', appServerReady: true, httpPolling: true } });
    if (url.pathname === '/api/projects') return route.fulfill({ json: { projects: ['/work/project'], projectlessThreadIds: [] } });
    if (url.pathname === '/api/events') return route.fulfill({ json: { epoch: 'drafts', cursor: 0, messages: [], requests: [], active: false, updatedAt: Date.now(), reset: false } });
    if (url.pathname === '/api/uploads/file') {
      const buffer = route.request().postDataBuffer();
      if (buffer) uploads.push(buffer);
      return route.fulfill({ json: { path: '/uploaded/notes.txt', name: 'notes.txt', type: 'text/plain', size: buffer?.length ?? 16 } });
    }
    if (url.pathname !== '/api/rpc') return route.fulfill({ json: {} });
    const { message } = route.request().postDataJSON();
    calls.push(message);
    if (message.method === "model/list" && modelDelay) await new Promise(resolve => setTimeout(resolve, modelDelay));
    if (message.method === 'turn/start' && failSend) return route.fulfill({ json: { id: message.id, error: { code: -1, message: '发送失败测试' } } });
    const responses: Record<string, unknown> = {
      'thread/list': { data: [], nextCursor: null },
      'model/list': { data: [{ id: 'test', model: 'test', displayName: 'Test', isDefault: true, defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: '平衡' }, { reasoningEffort: 'high', description: '更深入' }], serviceTiers: [{ id: "fast", name: "Fast", description: "更快" }] }] },
      'permissionProfile/list': { data: [{ id: ':workspace', allowed: true }, { id: ':danger-full-access', allowed: true }] },
      'config/read': { config: { model: 'test', sandbox_mode: 'workspace-write', model_reasoning_effort: 'medium' } },
      'thread/start': { thread: { id: 'new-thread', cwd: message.params?.cwd, status: { type: 'idle' }, turns: [] } },
      'turn/start': { turn: { id: 'new-turn', status: 'inProgress', items: [] } },
      'thread/turns/list': { data: [], nextCursor: null },
    };
    return route.fulfill({ json: { id: message.id, result: responses[message.method] ?? {} } });
  });
  return { calls, uploads, succeed: () => { failSend = false; }, delayModels: () => { modelDelay = 1500; } };
}

const openSidebar = async (page: Page) => page.getByRole('button', { name: '打开会话列表' }).click();
const openDrafts = async (page: Page) => {
  await page.getByRole('button', { name: '草稿', exact: true }).click();
  return page.getByRole('dialog', { name: '草稿', exact: true });
};

test('保存真实附件，重启恢复、更新原草稿，失败保留，确认发送后移除', async ({ page }, testInfo) => {
  const gateway = await mockGateway(page);
  await page.goto('/');
  await page.getByRole('button', { name: '聊天', exact: true }).click();
  const editor = page.getByRole('textbox', { name: '向 Codex 提问' });
  await expect(page.getByRole('button', { name: '保存草稿' })).toBeDisabled();
  await editor.fill('本地附件草稿');
  await page.getByLabel('选择文件', { exact: true }).setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('local attachment') });
  await page.getByLabel('选择图片', { exact: true }).setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jH1kAAAAASUVORK5CYII=', 'base64') });
  await page.getByRole('button', { name: '保存草稿' }).click();
  await expect(page.getByText('草稿已保存到本地', { exact: true })).toBeVisible();
  expect(gateway.uploads).toHaveLength(0);
  expect(gateway.calls.filter(call => ['thread/start', 'turn/start'].includes(call.method))).toHaveLength(0);
  await page.reload();
  const sheet = await openDrafts(page);
  await expect(sheet.getByText('本地附件草稿', { exact: true })).toBeVisible();
  await expect(sheet.getByText('1 张图片 · 1 个文件', { exact: true })).toBeVisible();
  await page.screenshot({ path: `.mobile-build/drafts-${testInfo.project.name}-list.png` });
  await sheet.getByRole('button', { name: '恢复草稿：本地附件草稿', exact: true }).click();
  await expect(editor).toHaveValue('本地附件草稿');
  await expect(page.locator('.draft-images img')).toHaveAttribute('src', /^data:image\/png;base64,/);
  await expect(page.locator('.draft-files')).toContainText('notes.txt');
  await editor.fill('修改后的草稿');
  await page.getByRole('button', { name: '保存草稿' }).click();
  await expect(page.getByText('草稿已保存到本地', { exact: true })).toBeVisible();
  await openSidebar(page);
  const updatedSheet = await openDrafts(page);
  await expect(updatedSheet.locator('.saved-draft-row')).toHaveCount(1);
  await updatedSheet.getByRole('button', { name: '恢复草稿：修改后的草稿', exact: true }).click();
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.getByRole('alert').getByText('发送失败测试', { exact: true })).toBeVisible();
  await openSidebar(page);
  const failedSheet = await openDrafts(page);
  await expect(failedSheet.locator('.saved-draft-row')).toHaveCount(1);
  await failedSheet.getByRole('button', { name: '恢复草稿：修改后的草稿', exact: true }).click();
  gateway.succeed();
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect.poll(() => gateway.calls.filter(call => call.method === 'turn/start').length).toBe(2);
  expect(await page.evaluate(() => (window as any).__draftUploadBytes.map((bytes: number[]) => new TextDecoder().decode(new Uint8Array(bytes))))).toEqual(['local attachment', 'local attachment']);
  const turn = gateway.calls.filter(call => call.method === 'turn/start').at(-1);
  expect(turn.params.input).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'image', url: expect.stringMatching(/^data:image\/png;base64,/) })]));
  await openSidebar(page);
  await openDrafts(page);
  await expect(page.getByText('暂无草稿', { exact: true })).toBeVisible();
});


test('无项目草稿恢复全部发送配置，迟到的初始化不会覆盖，并支持单条删除', async ({ page }, testInfo) => {
  const gateway = await mockGateway(page);
  await page.goto('/');
  await page.getByRole('button', { name: '聊天', exact: true }).click();
  await page.getByLabel('选择项目').selectOption('');
  await page.getByRole('textbox', { name: '向 Codex 提问' }).fill('无项目完整配置');
  await page.getByRole('button', { name: '选择模型、智能与速度' }).click();
  await page.locator('.effort-options').getByRole('button', { name: /高/ }).click();
  await page.getByRole('button', { name: '选择模型、智能与速度' }).click();
  await page.locator('.composer-popover').getByRole('button', { name: /速度/ }).click();
  await page.getByLabel('速度列表').getByRole('button', { name: /更快/ }).click();
  await page.getByRole('button', { name: '选择审批与权限模式' }).click();
  await page.locator('.permission-options').getByRole('button', { name: /自动审核/ }).click();
  await page.getByRole('button', { name: '保存草稿' }).click();
  await expect(page.getByText('草稿已保存到本地', { exact: true })).toBeVisible();
  await openSidebar(page);
  await page.getByRole('button', { name: '聊天', exact: true }).click();
  await page.getByRole('textbox', { name: '向 Codex 提问' }).fill('另一个草稿');
  await page.getByRole('button', { name: '保存草稿' }).click();
  await expect(page.getByText('草稿已保存到本地', { exact: true })).toBeVisible();
  // 模拟上次新聊天选择了项目，恢复无项目草稿仍须使用 null。
  await page.evaluate(() => localStorage.setItem('codex-mobile:new-chat-project:test', '/work/project'));
  gateway.delayModels();
  await page.reload();
  const sheet = await openDrafts(page);
  await expect(sheet.locator('.saved-draft-row')).toHaveCount(2);
  await sheet.getByRole('button', { name: '删除草稿：另一个草稿', exact: true }).click();
  await expect(sheet.locator('.saved-draft-row')).toHaveCount(1);
  await sheet.getByRole('button', { name: '恢复草稿：无项目完整配置', exact: true }).click();
  await expect(page.getByLabel('选择项目')).toHaveValue('');
  await expect(page.getByRole('button', { name: '选择审批与权限模式' })).toHaveText('自动审核');
  await expect(page.getByRole('button', { name: '选择模型、智能与速度' })).toContainText('高');
  await expect.poll(() => gateway.calls.filter(call => call.method === 'model/list').length).toBe(2);
  await page.waitForTimeout(1800);
  await expect(page.getByRole('button', { name: '选择审批与权限模式' })).toHaveText('自动审核');
  for (const width of [280, 320, 393]) {
    await page.setViewportSize({ width, height: 812 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.screenshot({ path: `.mobile-build/drafts-${testInfo.project.name}-composer.png` });
  gateway.succeed();
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect.poll(() => gateway.calls.filter(call => call.method === 'turn/start').length).toBe(1);
  expect(gateway.calls.find(call => call.method === 'thread/start').params).toMatchObject({ cwd: null, model: 'test', serviceTier: 'fast', permissions: ':workspace', approvalPolicy: 'on-request', approvalsReviewer: 'auto_review' });
  expect(gateway.calls.find(call => call.method === 'turn/start').params).toMatchObject({ effort: 'high', serviceTier: 'fast', permissions: ':workspace', approvalPolicy: 'on-request', approvalsReviewer: 'auto_review' });
});

test('设备已移除时保留草稿并提示，不发送到其他设备', async ({ page }) => {
  const gateway = await mockGateway(page);
  await page.goto('/');
  await page.getByRole('button', { name: '聊天', exact: true }).click();
  await page.getByRole('textbox', { name: '向 Codex 提问' }).fill('旧设备草稿');
  await page.getByRole('button', { name: '保存草稿' }).click();
  await expect(page.getByText('草稿已保存到本地', { exact: true })).toBeVisible();
  await page.evaluate(() => localStorage.setItem('codex-mobile.backend-registry.v1', JSON.stringify({ version: 1, selectedBackendId: 'replacement', backends: [{ id: 'replacement', name: '其他设备', baseUrl: location.origin, token: '', enabled: true, order: 0 }] })));
  await page.reload();
  const sheet = await openDrafts(page);
  await sheet.getByRole('button', { name: '恢复草稿：旧设备草稿', exact: true }).click();
  await expect(sheet.getByRole('alert')).toContainText('草稿的设备已移除');
  await expect(sheet.locator('.saved-draft-row')).toHaveCount(1);
  expect(gateway.calls.filter(call => call.method === 'thread/start')).toHaveLength(0);
});

test('存储写入失败明确提示并保留输入，附件单独也能保存', async ({ page }) => {
  await mockGateway(page);
  await page.goto('/');
  await page.getByRole('button', { name: '聊天', exact: true }).click();
  const editor = page.getByRole('textbox', { name: '向 Codex 提问' });
  await editor.fill('写入失败时保留');
  await page.evaluate(() => {
    const originalPut = IDBObjectStore.prototype.put;
    (window as any).__restoreDraftPut = () => { IDBObjectStore.prototype.put = originalPut; };
    IDBObjectStore.prototype.put = function () { throw new DOMException('Storage full', 'QuotaExceededError'); };
  });
  await page.getByRole('button', { name: '保存草稿' }).click();
  await expect(page.getByRole('alert')).toContainText('无法保存草稿');
  await expect(editor).toHaveValue('写入失败时保留');
  await expect(page.getByText('草稿已保存到本地', { exact: true })).toHaveCount(0);
  await page.evaluate(() => (window as any).__restoreDraftPut());
  await editor.fill('');
  await page.getByLabel('选择文件', { exact: true }).setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('local attachment') });
  await page.getByRole('button', { name: '保存草稿' }).click();
  await expect(page.getByText('草稿已保存到本地', { exact: true })).toBeVisible();
  await openSidebar(page);
  const sheet = await openDrafts(page);
  await expect(sheet.getByText('附件草稿', { exact: true })).toBeVisible();
  await sheet.getByRole('button', { name: '恢复草稿：附件草稿', exact: true }).click();
  await expect(editor).toHaveValue('');
  await expect(page.locator('.draft-files')).toContainText('notes.txt');
});

test('恢复停用设备的草稿时切换至原设备，新编辑不会误显示已保存', async ({ page }) => {
  await mockGateway(page);
  await page.goto('/');
  await page.getByRole('button', { name: '聊天', exact: true }).click();
  const editor = page.getByRole('textbox', { name: '向 Codex 提问' });
  await editor.fill('原设备草稿');
  await page.getByLabel('选择文件', { exact: true }).setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('local attachment') });
  await page.evaluate(() => {
    const original = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = async function () {
      const bytes = await original.call(this);
      await new Promise(resolve => setTimeout(resolve, 800));
      return bytes;
    };
  });
  await page.getByRole('button', { name: '保存草稿' }).click();
  await editor.fill('保存期间的新编辑');
  await expect(page.getByRole('button', { name: '保存草稿' })).toBeEnabled();
  await expect(page.getByText('草稿已保存到本地', { exact: true })).toHaveCount(0);
  await page.evaluate(() => localStorage.setItem('codex-mobile.backend-registry.v1', JSON.stringify({ version: 1, selectedBackendId: 'other', backends: [
    { id: 'test', hostId: 'test', name: '测试设备', baseUrl: location.origin, token: '', enabled: false, order: 0 },
    { id: 'other', hostId: 'other', name: '另一设备', baseUrl: 'http://other.local', token: '', enabled: true, order: 1 },
  ] })));
  await page.reload();
  const sheet = await openDrafts(page);
  await sheet.getByRole('button', { name: '恢复草稿：原设备草稿', exact: true }).click();
  await expect(editor).toHaveValue('原设备草稿');
  await expect(page.getByLabel('选择机器')).toHaveValue('test');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('codex-mobile.backend-registry.v1')!).backends.find((backend: any) => backend.id === 'test').enabled)).toBe(true);
});
