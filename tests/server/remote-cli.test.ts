// @vitest-environment node
import { expect, it } from 'vitest';
// @ts-expect-error CLI is a published ESM module
import { runRemoteCli } from '../../bin/remote.mjs';
it('固定CLI动作保留完整tuple及显式根，url只能使用已证明实例的访问参数', async () => {
  const calls: any[] = [];
  let output = '';
  const deps = { call: async (v: any) => {
      calls.push(v);
      return { host: '192.0.2.10', port: 22334, token: 'running-token' };
    }, stdout: (s: string) => output += s, stderr: () => {
    } };
  expect(await runRemoteCli(['pair', '--root', '/private/example', '--code', '123', '--environment-id', 'env', '--installation-id', 'install'], deps)).toBe(0);
  expect(calls[0]).toMatchObject({ directory: '/private/example', method: 'pair', params: { code: '123', target: { environmentId: 'env', installationId: 'install' } } });
  output = '';
  expect(await runRemoteCli(['url', '--plain'], deps)).toBe(0);
  expect(output.trim()).toBe('http://192.0.2.10:22334/?token=running-token');
});
it('无效、重复、缺失参数不调用网关且不回显敏感argv或原始错误', async () => {
  let calls = 0;
  let error = '';
  const deps = { call: async () => {
      calls++;
      throw new Error('https://secret-auth?code=private');
    }, stdout: () => {
    }, stderr: (s: string) => error += s };
  for (const args of [['unknown-secret'], ['pair', '--code', 'private'], ['status', '--code', 'private'], ['resume', '--environment-id', 'env'], ['status', '--root', '/one', '--root', '/two']]) {
    expect(await runRemoteCli(args, deps)).toBe(1);
  }
  expect(calls).toBe(0);
  expect(error).not.toContain('private');
  expect(error).not.toContain('unknown-secret');
  expect(await runRemoteCli(['login'], deps)).toBe(1);
  expect(error).not.toContain('https://');
});
