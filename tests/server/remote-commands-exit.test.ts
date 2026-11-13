// @vitest-environment node
// 仅模拟已证明的Windows/Unix返回协议，不代表Windows实机验收。
import { createHash } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { RemoteCommands } from '../../server/remote/commands.js';
import { RemoteRpcSession } from '../../server/remote/rpc-session.js';
import { RemoteStream } from '../../server/remote/relay.js';
import type { JsonValue, RpcMessage } from '../../server/remote/envelope.js';

const cleanups: (() => void | Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.reverse()) await cleanup(); cleanups.length = 0; });
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const captured = () => ({ base64: '', size: 0, sha256: hash(Buffer.alloc(0)) });

async function fixture(family: 'unix' | 'windows', exitCode: number, outerExitCode = -1) {
  const pending = new Map<string, { message: RpcMessage; nonce: string; input: Buffer[] }>(); let sequence = 0;
  const reply = (message: RpcMessage, result: JsonValue) => stream.emit('message', { id: message.id!, result }, { seqId: ++sequence });
  const output = (id: string, streamName: string, raw: Buffer) => stream.emit('message', { method: 'command/exec/outputDelta', params: { processId: id, stream: streamName, deltaBase64: raw.toString('base64'), capReached: false } }, { seqId: ++sequence });
  const home = family === 'windows' ? 'C:\\Users\\owner\\.codex' : '/synthetic/.codex';
  const python = family === 'windows' ? 'C:\\Python3\\python.exe' : '/synthetic/python3';
  const stream = new RemoteStream('environment', 'exit-test', async (_stream, message) => {
    if (!message) return { seqId: 0 };
    const params = (message.params ?? {}) as Record<string, JsonValue>; const id = params.processId as string;
    if (message.method === 'initialize') queueMicrotask(() => reply(message, { codexHome: home, platformFamily: family, platformOs: family === 'windows' ? 'windows' : 'linux', userAgent: 'synthetic-exit-test' }));
    if (message.method === 'command/exec') {
      const nonce = (params.command as string[])[5]!; pending.set(id, { message, nonce, input: [] });
      queueMicrotask(() => output(id, 'stdout', Buffer.from(`CMDC1_READY:${nonce}\n`)));
    }
    if (message.method === 'command/exec/write') {
      const record = pending.get(id)!; record.input.push(Buffer.from(params.deltaBase64 as string, 'base64'));
      queueMicrotask(() => {
        reply(message, {});
        if (!params.closeStdin) return;
        const request = JSON.parse(Buffer.concat(record.input).toString('utf8'));
        const wire = Buffer.from(JSON.stringify({ ...(request.mode === 'probe' ? { kind: 'probe', python, major: 3 } : { kind: 'result', exitCode, stdout: captured(), stderr: captured() }), version: 1, nonce: record.nonce, end: record.nonce }) + '\n');
        output(id, 'stdout', wire);
        if (request.mode === 'probe') { reply(record.message, { exitCode: 0, stdout: '', stderr: '' }); pending.delete(id); }
        else output(id, 'stderr', Buffer.from(`CMDC1_DONE:${record.nonce}:${wire.length}:${hash(wire)}\n`));
      });
    }
    if (message.method === 'command/exec/terminate') queueMicrotask(() => {
      const record = pending.get(id)!; reply(message, {});
      reply(record.message, { exitCode: outerExitCode, stdout: '', stderr: '' }); pending.delete(id);
    });
    return { seqId: sequence };
  }, () => {});
  const session = RemoteRpcSession.fromRemoteStream(stream); cleanups.push(() => session.close()); await session.initialize();
  const adapter = await RemoteCommands.create(session, { managed: { codexHome: '/managed/canonical', accountId: 'account', accountUserId: 'member' }, target: { environmentId: 'environment', installationId: 'installation' } }); cleanups.push(() => adapter.close());
  return { adapter, session, options: { argv: [python, 'business-data'], cwd: home } };
}

it.each([
  ['unix', -2147483648], ['unix', -1], ['unix', 0], ['unix', 2147483647],
  ['windows', 0], ['windows', 2147483647], ['windows', 2147483648], ['windows', 3221225477], ['windows', 4294967295],
] as const)('QUALITY复现：完整证明后保留%s业务退出码%i', async (family, code) => {
  const f = await fixture(family, code); const result = await f.adapter.execute(f.options);
  expect(result.exitCode).toBe(code); expect(result.stdout).toEqual(Buffer.alloc(0)); expect(result.stderr).toEqual(Buffer.alloc(0));
  expect(f.session.ready).toBe(true);
});

it.each([
  ['unix', -2147483649], ['unix', 2147483648], ['unix', 4294967295], ['unix', .5],
  ['windows', -2147483648], ['windows', -1], ['windows', 4294967296], ['windows', .5],
] as const)('完整证明仍拒绝%s越界或非整数业务退出码%s', async (family, code) => {
  const f = await fixture(family, code);
  await expect(f.adapter.execute(f.options)).rejects.toMatchObject({ code: 'protocol', mayHaveBeenSent: true, outcome: 'unknown' });
});

it.each(['unix', 'windows'] as const)('%s的外层官方exec退出码仍严格限制为signed int32', async family => {
  const f = await fixture(family, 0, 2147483648);
  await expect(f.adapter.execute(f.options)).rejects.toMatchObject({ code: 'protocol', mayHaveBeenSent: true, outcome: 'unknown' });
});
