// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { GatewayAttachments } from '../../server/gateway-attachments.js';
import { GatewayRemoteServices } from '../../server/gateway-remote-services.js';
import { gatewayRemote } from './fixtures/gateway-remote.js';

it('附件 bytes 和原 context 先耐久，重开后上传到原 Remote 并可按原上传收据对账', async () => {
  const f = await gatewayRemote(); const context = await f.resolver.operationContext(f.reference);
  const services = await GatewayRemoteServices.create(await f.resolver.resolve(f.reference), f.gatewayHome);
  const options = { directory: join(f.gatewayHome, 'attachments'), resolver: f.resolver, services: async () => services };
  try {
    const id = randomUUID(); const attachments = new GatewayAttachments(options);
    const receipt = await attachments.retain(id, context, Readable.from([Buffer.from('retained bytes')]), { name: 'sample.txt', type: 'text/plain' });
    expect(receipt).toMatchObject({ id, name: 'sample.txt', size: 14 });
    const reopened = new GatewayAttachments(options);
    const uploaded = await reopened.upload(id, context);
    expect(uploaded.path).toContain(f.targetHome); expect(uploaded.path).not.toContain(f.gatewayHome);
    expect(await reopened.reconcile(id, context)).toEqual(uploaded);
    const before = f.frames.filter(frame => frame.method === 'command/exec').length;
    expect(await reopened.upload(id, context)).toEqual(uploaded);
    expect(f.frames.filter(frame => frame.method === 'command/exec').length).toBe(before);
    await expect(reopened.retain(id, context, Readable.from([Buffer.from('different')]), { name: 'sample.txt', type: 'text/plain' })).rejects.toThrow();
    f.setManaged({ accountUserId: 'other-user' });
    await expect(reopened.upload(id, context)).rejects.toThrow();
  } finally { await services.close(); }
}, 20000);
