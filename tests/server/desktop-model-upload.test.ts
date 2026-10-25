import { afterEach, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, writeFile, chmod, rm, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { desktopAppServer, desktopConfigFlags, startDesktopModelUpload } from '../../server/desktop-model-upload.js';

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

it('只接入桌面持有工具管道的 canonical app-server，不接管其他 CLI 或独立 transport', () => {
  const env = { CODEX_APP_TOOLS_PIPE_PATH: '/private/tool-pipe' };
  expect(desktopAppServer(['-c', 'features.a=true', 'app-server', '--analytics-default-enabled'], env)).toBe(true);
  expect(desktopAppServer(['app-server'], {})).toBe(false);
  for (const args of [['exec', 'hello'], ['exec', 'app-server'], ['help', 'app-server'], ['app-server', '--listen', 'stdio://'], ['app-server', 'daemon', 'version'], ['app-server', 'generate-ts'], ['app-server', '--help'], ['app-server', '--print-startup-config']]) {
    expect(desktopAppServer(args, env)).toBe(false);
  }
  expect(desktopAppServer(['app-server', '--profile', 'help'], env)).toBe(true);
});

it('配置读取保留原 config/profile/feature 覆盖，过滤服务 transport 和 analytics 参数', () => {
  expect(desktopConfigFlags(['-c', 'a=1', '--profile=work', 'app-server', '--analytics-default-enabled', '--enable', 'x', '--disable=y', '--config', 'b="中"']))
    .toEqual(['-c', 'a=1', '--profile=work', '--enable', 'x', '--disable=y', '--config', 'b="中"']);
  expect(desktopConfigFlags(['-copenai_base_url="http://127.0.0.1:54321/compact"', '-pwork', 'app-server']))
    .toEqual(['-copenai_base_url="http://127.0.0.1:54321/compact"', '-pwork']);
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'desktop-model-')); cleanup.push(() => rm(root, { recursive: true, force: true }));
  const adapter = join(root, 'adapter.cjs'); const configCli = join(root, 'config-cli'); const output = join(root, 'out.json');
  await writeFile(adapter, `const fs=require('node:fs');fs.writeFileSync(process.env.PROBE_OUTPUT,JSON.stringify({args:process.argv.slice(2),pipe:process.env.CODEX_APP_TOOLS_PIPE_PATH,base:process.env.OPENAI_BASE_URL}));process.exit(23);`);
  await writeFile(configCli, `#!${process.execPath}\nconst rl=require('node:readline').createInterface({input:process.stdin});rl.on('line',l=>{const m=JSON.parse(l);if(m.id!=null)process.stdout.write(JSON.stringify({id:m.id,result:m.method==='config/read'?{config:{}}:{}})+'\\n');});`);
  await chmod(configCli, 0o700);
  return { root, adapter, configCli, output, options: { originalAdapter: adapter, codexExecutable: configCli, nodeExecutable: process.execPath,
    socketPath: join(root, 'private/meter.sock'), upstreamUrl: 'ws://127.0.0.1:14550/rpc' } };
}

it('非 canonical 调用原样传参和环境，不启动配置读取或计量 socket', async () => {
  const f = await fixture();
  const run = await startDesktopModelUpload(f.options, ['exec', 'hello'], { ...process.env, PROBE_OUTPUT: f.output, OPENAI_BASE_URL: 'http://original' });
  cleanup.push(() => run.close());
  expect(await run.exited).toBe(23);
  const record = JSON.parse(await readFile(f.output, 'utf8'));
  expect(record).toMatchObject({ args: ['exec', 'hello'], base: 'http://original' });
  expect(record.pipe).toBe(process.env.CODEX_APP_TOOLS_PIPE_PATH);
  await expect(stat(f.options.socketPath)).rejects.toThrow();
});

it('非 canonical 的 SIGINT 保留原中断信号，不转换为 SIGTERM', async () => {
  const f = await fixture();
  await writeFile(f.adapter, `const fs=require('node:fs');for(const [signal,code] of [['SIGINT',42],['SIGTERM',43]])process.on(signal,()=>process.exit(code));fs.writeFileSync(process.env.PROBE_OUTPUT,'ready');setInterval(()=>{},1000);`);
  const run = await startDesktopModelUpload(f.options, ['exec', 'hello'], { ...process.env, PROBE_OUTPUT: f.output });
  cleanup.push(() => run.close());
  await expect.poll(async () => { try { return await readFile(f.output, 'utf8'); } catch { return ''; } }).toBe('ready');
  await run.close('SIGINT');
  expect(await run.exited).toBe(42);
});

it('canonical 保留原参数和工具管道，只覆盖子进程模型出口，载荷原样计量并随桌面结束关闭', async () => {
  const f = await fixture(); const received: Buffer[] = [];
  const upstream = createServer(async (req, res) => { for await (const chunk of req) received.push(chunk); res.end('ok'); });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  cleanup.push(() => new Promise<void>(resolve => upstream.close(() => resolve())));
  const originalBase = `http://127.0.0.1:${(upstream.address() as any).port}/v1`;
  const payload = '{"input":"中文🙂"}';
  await writeFile(f.adapter, `const fs=require('node:fs');const args=process.argv.slice(2);fs.writeFileSync(process.env.PROBE_OUTPUT,JSON.stringify({args,pipe:process.env.CODEX_APP_TOOLS_PIPE_PATH,base:process.env.OPENAI_BASE_URL}));const value=args.findLast(x=>x.startsWith('openai_base_url='));const url=JSON.parse(value.slice(value.indexOf('=')+1));fetch(url+'/responses',{method:'POST',headers:{'x-codex-turn-metadata':JSON.stringify({thread_id:'thread-a',turn_id:'turn-a'})},body:${JSON.stringify(payload)}}).then(()=>setTimeout(()=>process.exit(23),500));`);
  const args = ['-c', 'features.a=true', 'app-server', '--analytics-default-enabled'];
  const run = await startDesktopModelUpload(f.options, args, { ...process.env, PROBE_OUTPUT: f.output,
    CODEX_APP_TOOLS_PIPE_PATH: '/private/tool-pipe', OPENAI_BASE_URL: originalBase });
  cleanup.push(() => run.close());
  await expect.poll(() => Buffer.concat(received).byteLength).toBe(Buffer.byteLength(payload));
  expect((await stat(f.options.socketPath)).mode & 0o777).toBe(0o600);
  expect(Buffer.concat(received).toString()).toBe(payload);
  const record = JSON.parse(await readFile(f.output, 'utf8'));
  expect(record.args.slice(0, args.length)).toEqual(args); expect(record.pipe).toBe('/private/tool-pipe'); expect(record.base).toBeUndefined();
  expect(await run.exited).toBe(23);
  await expect(stat(f.options.socketPath)).rejects.toThrow();
});
