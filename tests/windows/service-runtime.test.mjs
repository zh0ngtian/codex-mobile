import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ServiceRuntime } from '../../scripts/windows/service/runtime.mjs';
import { SharedEndpoint } from '../../scripts/windows/service/shared-endpoint.mjs';

async function setup({ delayedStop = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'codex-service-runtime-')), state = join(root, 'state.json');
  await writeFile(state, JSON.stringify({ busy: false }));
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; await new Promise((r) => probe.close(r));
  const endpoint = new SharedEndpoint({ port: 0, upstreamUrl: `ws://127.0.0.1:${port}` });
  let target = { fingerprint: 'old', version: 'old' }, now = 0;
  const children = [];
  const runtime = new ServiceRuntime({ endpoint, upstreamUrl: `ws://127.0.0.1:${port}`, idleMs: 30, now: () => now,
    resolveVersion: async () => target, prepareVersion: async (v) => v,
    readyTimeoutMs: 700,
    launchServer: async (v) => {
      const child = spawn(process.execPath, [resolve('tests/windows/fixtures/app-server.mjs'), String(port), state, v.version, v.fail ? 'fail' : 'ok'], { stdio: 'ignore', windowsHide: true });
      children.push(child); const exited = once(child, 'exit');
      return { pid: child.pid, alive: () => child.exitCode === null && child.signalCode === null,
        stop: async () => {
          if (delayedStop && child.exitCode === null && child.signalCode === null) { setTimeout(() => child.kill(), 150); return; }
          if (child.exitCode === null && child.signalCode === null) child.kill(); await exited;
        } };
    },
  });
  await runtime.start();
  return { runtime, endpoint, children, target: (v) => { target = v; }, now: (v) => { now = v; }, busy: (v) => writeFile(state, JSON.stringify({ busy: v })),
    close: async () => { await runtime.stop(); await rm(root, { recursive: true, force: true }); } };
}

test('后台独立存在，忙时等待，持续空闲后使用目标版本切换', async () => {
  const x = await setup();
  try {
    x.target({ fingerprint: 'new', version: 'new' }); await x.busy(true);
    await x.runtime.checkUpdate(); x.now(100); await x.runtime.checkUpdate();
    assert.equal(x.runtime.status().currentVersion, 'old'); assert.equal(x.children.length, 1);
    await x.busy(false); await x.runtime.checkUpdate(); x.now(130); await x.runtime.checkUpdate();
    assert.equal(x.runtime.status().currentVersion, 'new'); assert.equal(x.children.length, 2);
    assert.notEqual(x.runtime.status().pid, x.children[0].pid);
    x.now(1000); await x.runtime.checkUpdate(); assert.equal(x.children.length, 2);
  } finally { await x.close(); }
});

test('旧进程控制器退出但端口尚未释放时等待，避免连到旧服务并误报更新成功', async () => {
  const x = await setup({ delayedStop: true });
  try {
    x.target({ fingerprint: 'new', version: 'new' }); await x.runtime.checkUpdate(); x.now(30); await x.runtime.checkUpdate();
    assert.equal(x.runtime.status().currentVersion, 'new');
    assert.equal(x.children[0].exitCode !== null || x.children[0].signalCode !== null, true);
    await new Promise((r) => setTimeout(r, 250));
    assert.equal(x.runtime.status().ready, true);
  } finally { await x.close(); }
});

test('新版本启动失败后恢复上一可用版本，不循环重启', async () => {
  const x = await setup();
  try {
    x.target({ fingerprint: 'bad', version: 'bad', fail: true }); await x.runtime.checkUpdate(); x.now(30); await x.runtime.checkUpdate();
    assert.equal(x.runtime.status().currentVersion, 'old'); assert.equal(x.runtime.status().updateState, 'rollback');
    assert.equal(x.children.length, 3);
    x.now(100); await x.runtime.checkUpdate(); assert.equal(x.children.length, 3);
    assert.equal((await fetch(x.endpoint.url.replace('ws:', 'http:') + '/readyz')).status, 200);
  } finally { await x.close(); }
});

test('屏障后复查发现任务变忙时取消切换', async () => {
  const x = await setup();
  try {
    x.target({ fingerprint: 'new', version: 'new' }); await x.runtime.checkUpdate(); x.now(30);
    const drain = x.endpoint.drain.bind(x.endpoint);
    x.endpoint.drain = async () => { await drain(); await x.busy(true); };
    await x.runtime.checkUpdate();
    assert.equal(x.runtime.status().currentVersion, 'old'); assert.equal(x.children.length, 1);
    assert.equal(x.endpoint.accepting, true);
  } finally { await x.close(); }
});
