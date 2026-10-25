// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { chmod, lstat, mkdtemp, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { createServer, createConnection, type Socket } from 'node:net';
import { join } from 'node:path';
import { ModelUploadMeter, type ModelUploadUsage } from '../../server/model-upload-meter.js';

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
const upstreamUrl = 'ws://127.0.0.1:14550/rpc?credential=never-send-this';
const hello = { type: 'hello', version: 1, sourceHash: createHash('sha256').update(upstreamUrl).digest('hex') };
const usage = (revision = 1, epoch = 'epoch-a'): ModelUploadUsage => ({
  epoch, revision, turnId: 'turn-a', lastRequestBytes: revision * 10, turnBytes: revision * 10, requestCount: 1,
});
const frame = (value: unknown) => JSON.stringify(value) + '\n';
const update = (value = usage(), threadId = 'thread-a') => ({ type: 'usage', threadId, usage: value });
async function ipc() {
  const modulePath = '../../server/model-upload-ipc.js';
  const module = await import(modulePath).catch(() => null);
  expect(module, '桌面计量 IPC 模块应存在').not.toBeNull();
  return module as typeof import('../../server/model-upload-ipc.js');
}
async function location() {
  const directory = await mkdtemp('/tmp/cmui-');
  await chmod(directory, 0o700);
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  return { directory, socketPath: join(directory, 'meter.sock') };
}
async function peer(socketPath: string, onConnection: (socket: Socket) => void) {
  const sockets = new Set<Socket>();
  const server = createServer(socket => {
    sockets.add(socket); socket.on('error', () => {}); socket.on('close', () => sockets.delete(socket));
    onConnection(socket);
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve); });
  await chmod(socketPath, 0o600);
  let closed = false;
  const close = async () => {
    if (closed) return; closed = true;
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
  };
  cleanup.push(close);
  return { close, sockets };
}
async function rawConnect(socketPath: string) {
  const socket = createConnection(socketPath); socket.on('error', () => {});
  cleanup.push(async () => { socket.destroy(); });
  await once(socket, 'connect');
  return socket;
}
async function waitFor(predicate: () => boolean) {
  await expect.poll(predicate, { timeout: 2500, interval: 10 }).toBe(true);
}

describe('桌面模型计量本机 IPC', () => {
  it('计量快照复制最新线程数据并最多保留2048项', () => {
    const meter = new ModelUploadMeter();
    expect(meter.snapshot).toBeTypeOf('function');
    for (let index = 0; index < 2050; index++) meter.begin({ threadId: `thread-${index}`, turnId: 'turn' })(10);
    const snapshot = meter.snapshot();
    expect(snapshot.size).toBe(2048); expect(snapshot.has('thread-0')).toBe(false);
    snapshot.get('thread-2049')!.turnBytes = 999; snapshot.clear();
    expect(meter.read('thread-2049')?.turnBytes).toBe(10);
  });

  it('同步快照与实时数据，线缆上只出现白名单字段与来源散列', async () => {
    const { publishDesktopModelUsage, connectDesktopModelUsage } = await ipc();
    const { directory, socketPath } = await location(); const meter = new ModelUploadMeter();
    const add = meter.begin({ threadId: 'thread-a', turnId: 'turn-a' }); add(23);
    const publisher = await publishDesktopModelUsage({ socketPath, upstreamUrl, meter }); cleanup.push(() => publisher.close());
    expect((await lstat(directory)).mode & 0o777).toBe(0o700);
    expect((await lstat(socketPath)).mode & 0o777).toBe(0o600);
    const source = connectDesktopModelUsage({ socketPath, upstreamUrl, retryMs: 10 }); cleanup.push(() => source.close());
    const notifications: ModelUploadUsage[] = []; const unsubscribe = source.subscribe((_threadId, value) => notifications.push(value));
    await waitFor(() => source.read('thread-a')?.turnBytes === 23);
    add(7); await waitFor(() => source.read('thread-a')?.turnBytes === 30);
    expect(notifications.at(-1)?.turnBytes).toBe(30);
    const copy = source.read('thread-a')!; copy.turnBytes = 555;
    expect(source.read('thread-a')?.turnBytes).toBe(30); unsubscribe();
    const raw = await rawConnect(socketPath); let received = '';
    raw.on('data', chunk => { received += chunk.toString(); });
    await waitFor(() => received.split('\n').length >= 3);
    const frames = received.trim().split('\n').map(line => JSON.parse(line));
    expect(frames[0]).toEqual(hello);
    expect(Object.keys(frames[1]).sort()).toEqual(['threadId', 'type', 'usage']);
    expect(Object.keys(frames[1].usage).sort()).toEqual(['epoch', 'lastRequestBytes', 'requestCount', 'revision', 'turnBytes', 'turnId']);
    expect(received).not.toContain(upstreamUrl); expect(received).not.toContain('never-send-this');
    for (const line of received.trim().split('\n')) expect(Buffer.byteLength(line + '\n')).toBeLessThanOrEqual(4096);
  });

  it('没有成功传输字节的请求不发布0B，已计量回合允许最近请求尚未发字节', async () => {
    const { publishDesktopModelUsage, connectDesktopModelUsage } = await ipc();
    const { socketPath } = await location(); const meter = new ModelUploadMeter();
    const add = meter.begin({ threadId: 'thread-a', turnId: 'turn-a' });
    const publisher = await publishDesktopModelUsage({ socketPath, upstreamUrl, meter }); cleanup.push(() => publisher.close());
    const source = connectDesktopModelUsage({ socketPath, upstreamUrl, retryMs: 10 }); cleanup.push(() => source.close());
    const raw = await rawConnect(socketPath); let received = ''; raw.on('data', chunk => { received += chunk.toString(); });
    await waitFor(() => received.includes('hello')); expect(source.read('thread-a')).toBeNull();
    expect(received.trim().split('\n')).toHaveLength(1);
    add(10); await waitFor(() => source.read('thread-a')?.turnBytes === 10);
    meter.begin({ threadId: 'thread-a', turnId: 'turn-a' });
    const reconnect = connectDesktopModelUsage({ socketPath, upstreamUrl, retryMs: 10 }); cleanup.push(() => reconnect.close());
    await waitFor(() => reconnect.read('thread-a')?.lastRequestBytes === 0);
  });

  it('断线立即失效，桌面源重建和网关重新连接后从快照恢复', async () => {
    const { publishDesktopModelUsage, connectDesktopModelUsage } = await ipc();
    const { socketPath } = await location(); const meter = new ModelUploadMeter();
    meter.begin({ threadId: 'thread-a', turnId: 'turn-a' })(10);
    let publisher = await publishDesktopModelUsage({ socketPath, upstreamUrl, meter }); cleanup.push(() => publisher.close());
    let source = connectDesktopModelUsage({ socketPath, upstreamUrl, retryMs: 10 }); cleanup.push(() => source.close());
    await waitFor(() => source.read('thread-a')?.turnBytes === 10);
    await source.close(); expect(source.read('thread-a')).toBeNull();
    source = connectDesktopModelUsage({ socketPath, upstreamUrl, retryMs: 10 });
    await waitFor(() => source.read('thread-a')?.turnBytes === 10);
    await publisher.close(); await waitFor(() => source.read('thread-a') === null);
    const restarted = new ModelUploadMeter(); restarted.begin({ threadId: 'thread-a', turnId: 'turn-a' })(80);
    publisher = await publishDesktopModelUsage({ socketPath, upstreamUrl, meter: restarted });
    await waitFor(() => source.read('thread-a')?.turnBytes === 80);
  });

  it.each([
    { name: '来源不匹配', initial: { ...hello, sourceHash: 'a'.repeat(64) } },
    { name: '未知版本', initial: { ...hello, version: 2 } },
    { name: '首帧不是身份帧', initial: update() },
  ])('$name时不接受任何数字', async ({ initial }) => {
    const { connectDesktopModelUsage } = await ipc(); const { socketPath } = await location();
    let disconnected = false;
    await peer(socketPath, socket => { socket.on('close', () => { disconnected = true; }); socket.write(frame(initial) + frame(update())); });
    const source = connectDesktopModelUsage({ socketPath, upstreamUrl, retryMs: 1000 }); cleanup.push(() => source.close());
    await waitFor(() => disconnected); expect(source.read('thread-a')).toBeNull();
  });

  it('同epoch旧revision不能覆盖新值，不同epoch可重新计量', async () => {
    const { connectDesktopModelUsage } = await ipc(); const { socketPath } = await location(); let writer!: Socket;
    await peer(socketPath, socket => { writer = socket; socket.write(frame(hello) + frame(update(usage(5)))); });
    const source = connectDesktopModelUsage({ socketPath, upstreamUrl, retryMs: 1000 }); cleanup.push(() => source.close());
    await waitFor(() => source.read('thread-a')?.revision === 5);
    writer.write(frame(update(usage(2))) + frame(update(usage(5))));
    writer.write(frame(update(usage(1), 'barrier')));
    await waitFor(() => source.read('barrier') !== null); expect(source.read('thread-a')?.revision).toBe(5);
    writer.write(frame(update(usage(1, 'epoch-b'))));
    await waitFor(() => source.read('thread-a')?.epoch === 'epoch-b');
  });

  it.each([
    { name: '非法JSON', invalid: '{broken\n' },
    { name: '超长且未结束的帧', invalid: 'x'.repeat(4097) },
    { name: '超长ID', invalid: frame(update(usage(), 't'.repeat(257))) },
    { name: '非正revision', invalid: frame(update(usage(0))) },
    { name: '非安全整数', invalid: frame(update({ ...usage(), turnBytes: Number.MAX_SAFE_INTEGER + 1 })) },
    { name: '负数', invalid: frame(update({ ...usage(), lastRequestBytes: -1 })) },
    { name: '额外字段', invalid: frame({ ...update(), prompt: 'never-retain' }) },
  ])('拒绝$name并清除已接收数字', async ({ invalid }) => {
    const { connectDesktopModelUsage } = await ipc(); const { socketPath } = await location(); let writer!: Socket;
    await peer(socketPath, socket => { writer = socket; socket.write(frame(hello) + frame(update())); });
    const source = connectDesktopModelUsage({ socketPath, upstreamUrl, retryMs: 1000 }); cleanup.push(() => source.close());
    await waitFor(() => source.read('thread-a') !== null); writer.write(invalid);
    await waitFor(() => source.read('thread-a') === null);
  });

  it('接收端最多保留2048个线程', async () => {
    const { connectDesktopModelUsage } = await ipc(); const { socketPath } = await location();
    await peer(socketPath, socket => { socket.write(frame(hello)); for (let index = 0; index < 2050; index++) socket.write(frame(update(usage(), `thread-${index}`))); });
    const source = connectDesktopModelUsage({ socketPath, upstreamUrl, retryMs: 1000 }); cleanup.push(() => source.close());
    await waitFor(() => source.read('thread-2049') !== null);
    expect(source.read('thread-0')).toBeNull(); expect(source.read('thread-1')).toBeNull();
    expect(source.read('thread-2')).not.toBeNull();
  });

  it('拒绝宽权限目录、socket与符号链接，不修改其权限', async () => {
    const { publishDesktopModelUsage, connectDesktopModelUsage } = await ipc(); const { directory, socketPath } = await location();
    const options = { socketPath, upstreamUrl, meter: new ModelUploadMeter() };
    await chmod(directory, 0o755); await expect(publishDesktopModelUsage(options)).rejects.toThrow();
    expect((await lstat(directory)).mode & 0o777).toBe(0o755); await chmod(directory, 0o700);
    let accepted = false; const existing = await peer(socketPath, () => { accepted = true; });
    await chmod(socketPath, 0o666); await expect(publishDesktopModelUsage(options)).rejects.toThrow();
    const source = connectDesktopModelUsage({ socketPath, upstreamUrl, retryMs: 1000 }); cleanup.push(() => source.close());
    await new Promise(resolve => setTimeout(resolve, 40)); expect(accepted).toBe(false);
    await existing.close();
    const other = join(directory, 'other'); await writeFile(other, 'owned', { mode: 0o600 }); await symlink(other, socketPath);
    await expect(publishDesktopModelUsage(options)).rejects.toThrow(); expect(await readFile(other, 'utf8')).toBe('owned');
    await unlink(socketPath); const alias = join(directory, 'alias'); await symlink(directory, alias);
    await expect(publishDesktopModelUsage({ ...options, socketPath: join(alias, 'meter.sock') })).rejects.toThrow();
  });

  it('不顶替活跃socket，允许回收确认拒绝连接的崩溃遗留socket', async () => {
    const { publishDesktopModelUsage } = await ipc(); const { socketPath } = await location();
    const existing = await peer(socketPath, socket => socket.end());
    const before = await lstat(socketPath);
    await expect(publishDesktopModelUsage({ socketPath, upstreamUrl, meter: new ModelUploadMeter() })).rejects.toThrow();
    expect((await lstat(socketPath)).ino).toBe(before.ino); await existing.close();
    // libuv 会在正常 close 时移除路径；子进程被杀死才能留下真实的崩溃socket。
    const { spawn } = await import('node:child_process');
    const child = spawn(process.execPath, ['-e', 'const n=require("node:net"),f=require("node:fs");n.createServer().listen(process.argv[1],()=>{f.chmodSync(process.argv[1],0o600);process.stdout.write("ready\\n")})', socketPath]);
    cleanup.push(async () => { child.kill('SIGKILL'); }); await once(child.stdout, 'data'); child.kill('SIGKILL'); await once(child, 'exit');
    expect((await lstat(socketPath)).isSocket()).toBe(true);
    const publisher = await publishDesktopModelUsage({ socketPath, upstreamUrl, meter: new ModelUploadMeter() }); cleanup.push(() => publisher.close());
    const connected = await rawConnect(socketPath); expect(connected.destroyed).toBe(false);
  });

  it('较大的合法快照遵循背压，正常读者可恢复全部2048个线程', async () => {
    const { publishDesktopModelUsage, connectDesktopModelUsage } = await ipc(); const { socketPath } = await location();
    const meter = new ModelUploadMeter(); const threadId = (index: number) => `thread-${String(index).padStart(4, '0')}${'t'.repeat(240)}`;
    for (let index = 0; index < 2048; index++) meter.begin({ threadId: threadId(index), turnId: 'v'.repeat(256) })(1);
    const publisher = await publishDesktopModelUsage({ socketPath, upstreamUrl, meter }); cleanup.push(() => publisher.close());
    const source = connectDesktopModelUsage({ socketPath, upstreamUrl, retryMs: 1000 }); cleanup.push(() => source.close());
    await waitFor(() => source.read(threadId(2047))?.turnBytes === 1);
    expect(source.read(threadId(0))?.turnBytes).toBe(1);
  });

  it('慢读者写缓存超限时断开，正常接收端可继续读数', async () => {
    const { publishDesktopModelUsage, connectDesktopModelUsage } = await ipc(); const { socketPath } = await location(); const meter = new ModelUploadMeter();
    const publisher = await publishDesktopModelUsage({ socketPath, upstreamUrl, meter }); cleanup.push(() => publisher.close());
    const slow = await rawConnect(socketPath); slow.pause();
    const add = meter.begin({ threadId: 'thread-a', turnId: 'turn-a' });
    for (let index = 0; index < 20000; index++) add(1);
    let closed = false; slow.on('close', () => { closed = true; }); slow.resume();
    await waitFor(() => closed);
    const source = connectDesktopModelUsage({ socketPath, upstreamUrl, retryMs: 10 }); cleanup.push(() => source.close());
    await waitFor(() => source.read('thread-a')?.turnBytes === 20000);
  });

  it('关闭清理连接和自己的socket，不删除后来替换的文件且停止重连', async () => {
    const { publishDesktopModelUsage, connectDesktopModelUsage } = await ipc(); const { socketPath } = await location();
    const publisher = await publishDesktopModelUsage({ socketPath, upstreamUrl, meter: new ModelUploadMeter() });
    cleanup.push(() => publisher.close()); const socket = await rawConnect(socketPath); let closed = false; socket.on('close', () => { closed = true; }); socket.resume();
    await unlink(socketPath); await writeFile(socketPath, 'replacement', { mode: 0o600 });
    await publisher.close(); await waitFor(() => closed); expect(await readFile(socketPath, 'utf8')).toBe('replacement');
    await unlink(socketPath); const source = connectDesktopModelUsage({ socketPath, upstreamUrl, retryMs: 10 });
    await source.close(); let connected = false; await peer(socketPath, () => { connected = true; });
    await new Promise(resolve => setTimeout(resolve, 40)); expect(connected).toBe(false);
  });
});
