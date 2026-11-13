// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import childProcess, { type ChildProcess } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { startManagedAppServer } from '../../server/app-server-manager.js';
import { readModelUploadRoutes } from '../../server/model-upload-routing.js';
const roots: string[] = [];
const children: ChildProcess[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  syncBuiltinESMExports();
  vi.unstubAllEnvs();
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
      child.kill('SIGKILL');
      await exited;
    }
  }
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'mstart-'));
  roots.push(root);
  const bin = join(root, 'bin');
  await mkdir(bin);
  const executable = join(bin, 'codex');
  await writeFile(executable, `#!${process.execPath}
const {createInterface}=require('node:readline');
if(process.argv.includes('stdio://')){createInterface({input:process.stdin}).on('line',line=>{const v=JSON.parse(line);if(v.id)process.stdout.write(JSON.stringify({id:v.id,result:v.method==='config/read'?{config:{}}:{}})+'\\n');});}
else{const port=Number(new URL(process.argv[process.argv.indexOf('--listen')+1]).port);require('node:http').createServer((_req,res)=>res.end('ready')).listen(port,'127.0.0.1');}
`);
  await chmod(executable, 0o700);
  vi.stubEnv('PATH', `${bin}:${process.env.PATH}`);
  vi.stubEnv('CODEX_HOME', root);
  vi.stubEnv('OPENAI_BASE_URL', 'http://127.0.0.1:1');
  const probe = createServer();
  await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = (probe.address() as import('node:net').AddressInfo).port;
  await new Promise<void>(resolve => probe.close(() => resolve()));
  return { root, executable, port };
}
function observe(abort?: AbortController, stage?: 'config' | 'app') {
  const spawn = childProcess.spawn;
  vi.spyOn(childProcess, 'spawn').mockImplementation(((...args: Parameters<typeof spawn>) => {
    const child = Reflect.apply(spawn, childProcess, args);
    children.push(child);
    const config = (args[1] as string[]).includes('stdio://');
    if (abort && (stage === 'config') === config) {
      abort.abort();
    }
    return child;
  }) as typeof spawn);
  syncBuiltinESMExports();
}
function dead(child: ChildProcess) {
  expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
}
it('已取消的managed入口和路由探针均不创建任何子进程', async () => {
  const f = await fixture();
  observe();
  const signal = AbortSignal.abort();
  await expect(startManagedAppServer(f.port, signal)).rejects.toBeDefined();
  await expect(readModelUploadRoutes({ ...process.env, CODEX_HOME: f.root }, { executable: f.executable, signal })).rejects.toBeDefined();
  expect(children).toHaveLength(0);
});
it.each(['config', 'app'] as const)('%s同步spawn之后收到取消也等待自有进程实际退出，不交付资源', async (stage) => {
  const f = await fixture();
  const abort = new AbortController();
  observe(abort, stage);
  await expect(startManagedAppServer(f.port, abort.signal)).rejects.toBeDefined();
  expect(children).toHaveLength(stage === 'config' ? 1 : 2);
  for (const child of children) {
    dead(child);
  }
});
it('ready响应交付窗口取消不返回managed资源，close仍等待实际exit', async () => {
  const f = await fixture();
  const abort = new AbortController();
  observe();
  const fetch = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (...args) => {
    const response = await fetch(...args);
    abort.abort();
    return response;
  });
  await expect(startManagedAppServer(f.port, abort.signal)).rejects.toBeDefined();
  expect(children).toHaveLength(2);
  for (const child of children) {
    dead(child);
  }
});
it('原有无signal调用仍可启动并关闭，异常exit立即可见', async () => {
  const f = await fixture();
  observe();
  const managed = await startManagedAppServer(f.port);
  managed.child.kill('SIGKILL');
  await managed.exited;
  await managed.close();
  for (const child of children) {
    dead(child);
  }
});
