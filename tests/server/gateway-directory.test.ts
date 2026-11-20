// @vitest-environment node
import { expect, it } from 'vitest';
import { TargetResolver } from '../../server/targets.js';
import { fixture, until } from './remote-session-fixture.js';

const identity = { version: 1 as const, gatewayId: 'gateway', localHostId: 'gateway-local' };
it('未配置 Remote 时目录明确未授权，Local 固定身份仍可用', async () => {
  const f = await fixture(); const resolver = new TargetResolver({ identity, remoteRuntime: f.runtime });
  const result = await resolver.directory();
  expect(result.data).toMatchObject({ gatewayId: 'gateway', configured: false, authorized: false, paired: false, targets: [] });
  result.assertCurrent();
  expect((await resolver.operationContext()).mode).toBe('local');
  expect(f.keys()).toBe(0); expect(f.connections).toHaveLength(0);
});
it('目录只公开已接受且当前可见目标，网关本机也给出 Remote 引用', async () => {
  const f = await fixture(); await f.runtime.authorize(); await until(() => f.runtime.status().state === 'online');
  f.setTargets([
    { env_id: 'local-env', installation_id: 'local-install', kind: 'single', online: true, busy: false, display_name: 'gateway Mac' } as any,
    { env_id: 'visible-only', installation_id: 'unaccepted', kind: 'single', online: true, busy: false },
  ]);
  await f.runtime.refreshTargets();
  const resolver = new TargetResolver({ identity, remoteRuntime: f.runtime });
  const result = await resolver.directory(); result.assertCurrent();
  expect(result.data.authorized).toBe(true); expect(result.data.paired).toBe(true);
  expect(result.data.targets).toHaveLength(1);
  expect(result.data.targets[0]).toMatchObject({ name: 'gateway Mac', isGatewayHost: true, online: true,
    reference: { mode: 'remote', gatewayId: 'gateway', target: { environmentId: 'local-env', installationId: 'local-install' } } });
  expect(JSON.stringify(result.data)).not.toMatch(/codexHome|generation|clientId|private|authorizationKey/);
  expect(() => (result.data.targets as any).splice(0)).toThrow();
  expect(() => { (result.data.targets[0]!.reference.target as any).environmentId = 'other'; }).toThrow();
  expect(() => { (result.data.targets[0]!.reference.account as any).accountUserId = 'other'; }).toThrow();
  result.assertCurrent();
  await f.runtime.close(); expect(() => result.assertCurrent()).toThrow();
});
it('身份变化不能读取旧目录，Local 仍可用且不新建 Relay', async () => {
  const f = await fixture(); await f.runtime.authorize(); await until(() => f.runtime.status().state === 'online');
  const resolver = new TargetResolver({ identity, remoteRuntime: f.runtime });
  const before = await resolver.directory(); const count = f.connections.length;
  f.setManaged({ accountUserId: 'other-user' });
  await expect(resolver.directory()).rejects.toThrow();
  expect(() => before.assertCurrent()).toThrow();
  expect((await resolver.operationContext()).mode).toBe('local'); expect(f.connections.length).toBe(count);
});
