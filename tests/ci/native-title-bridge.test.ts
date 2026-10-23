// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { build } from 'vite';
import { expect, it } from 'vitest';

it.skipIf(process.platform !== 'darwin')('模型总结回执通过真实WebKit对象桥与Foundation解析，不闪退且保留字段语义', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'native-title-bridge-'));
  try {
    const output = await build({ configFile: false, logLevel: 'silent', define: { 'process.env.NODE_ENV': '"production"' }, build: {
      write: false, minify: false,
      lib: { entry: resolve('tests/ci/native-title-bridge-entry.ts'), name: 'TitleBridge', formats: ['iife'] },
    } });
    const chunks = (Array.isArray(output) ? output : [output]).flatMap(result => 'output' in result ? result.output : []);
    const script = chunks.find(chunk => chunk.type === 'chunk');
    if (!script || script.type !== 'chunk') throw new Error('缺少桥接夹具脚本');
    const html = join(directory, 'index.html'); const entry = join(directory, 'entry.js'); const executable = join(directory, 'smoke');
    writeFileSync(html, '<!doctype html><meta charset="utf-8"><title>桥接回归</title>');
    writeFileSync(entry, script.code);
    const names = ['NativeJSONValue', 'NativeCommand', 'NativeCommandResult', 'NativeUITrust'];
    const compile = spawnSync('xcrun', ['swiftc', ...names.map(name => `mobile/ios/NativeUI/${name}.swift`), 'tests/ci/native-title-bridge-smoke.swift', '-o', executable], { encoding: 'utf8', timeout: 90_000 });
    expect(compile.status, compile.error?.message ?? compile.stderr).toBe(0);
    const result = spawnSync(executable, [html, entry], { encoding: 'utf8', timeout: 30_000 });
    expect(result.status, `${result.signal ?? ''}\n${result.error?.message ?? result.stderr}`).toBe(0);
    expect(result.stdout).toContain('Native title WebKit bridge passed: 4 receipts');
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 120_000);
