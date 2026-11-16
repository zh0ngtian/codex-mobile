// @vitest-environment node
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { GatewayRemoteServices } from '../../server/gateway-remote-services.js';
import { gatewayRemote } from './fixtures/gateway-remote.js';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

it('真实 Remote 消费者从目标读取项目和文件，不读取网关同名数据，复用一个 Relay', async () => {
  const f = await gatewayRemote(); const target = await f.resolver.resolve(f.reference);
  const services = await GatewayRemoteServices.create(target, f.gatewayHome); cleanups.push(() => services.close());
  await writeFile(join(f.targetHome, '.codex-global-state.json'), JSON.stringify({ 'local-projects': { remote: { id: 'remote', rootPaths: ['/remote/project'] } } }));
  await writeFile(join(f.gatewayHome, '.codex-global-state.json'), JSON.stringify({ 'local-projects': { local: { id: 'local', rootPaths: ['/local/decoy'] } } }));
  expect((await services.projectState()).projects).toEqual(['/remote/project']);
  const file = join(f.targetHome, 'sample.txt'); await writeFile(file, 'remote bytes');
  const opened = await services.media.open(file); const chunks: Buffer[] = [];
  try { for await (const chunk of opened.read()) chunks.push(chunk); } finally { await opened.close(); }
  expect(Buffer.concat(chunks).toString()).toBe('remote bytes');
  expect(f.connections).toHaveLength(1);
  expect(services.projections.changeHistory).toBeTruthy(); expect(services.projections.timestamps).toBeTruthy();
  await services.close(); expect(f.processes).toBe(0);
}, 15000);

it('媒体缓存引用只能解析到本授权自己的缓存，身份变更后旧消费者拒绝读取', async () => {
  const f = await gatewayRemote(); const target = await f.resolver.resolve(f.reference);
  const services = await GatewayRemoteServices.create(target, f.gatewayHome); cleanups.push(() => services.close());
  const reference = await services.projections.images.result({ data: [{ type: 'userMessage', content: [{ type: 'image', url: 'data:image/png;base64,aGVsbG8=' }] }] });
  const cached = services.resolveReference(reference.data[0].content[0].url);
  expect(cached?.origin).toBe('gateway-cache');
  expect(cached?.source.kind).toBe('local');
  expect(services.resolveReference(reference.data[0].content[0].url.replace(target.descriptor.transportNamespace, 'other'))).toBeNull();
  expect(services.resolveReference('/etc/passwd')?.source.kind).toBe('remote');
  expect(services.resolveReference('codex-cache:../../etc/passwd')).toBeNull();
  f.setManaged({ accountUserId: 'another-user' });
  await expect(services.projectState()).rejects.toThrow();
}, 15000);
