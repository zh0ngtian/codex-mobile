// 仅在生成的隔离 UI 测试宿主里预置夹具设备；不修改 dist 或正式构建配置。
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const [file, address] = process.argv.slice(2);
if (!file || !address) throw new Error('用法：node seed.mjs <生成测试宿主的 index.html> <夹具 gateway URL>');
const target = resolve(file), url = new URL(address);
if (!target.includes('/.mobile-build/') || !target.endsWith('/PakePlus/index.html') || url.hostname !== '127.0.0.1') throw new Error('只能预置隔离构建目录与本机夹具');
const registry = { version: 1, selectedBackendId: 'desktop-pin-fixture', backends: [{ id: 'desktop-pin-fixture', hostId: 'local', name: '验收 Mac', baseUrl: url.origin, token: url.searchParams.get('token') ?? '', enabled: true, order: 0 }] };
let source = await readFile(target, 'utf8');
source = source.replace(/<script data-desktop-pin-fixture>[\s\S]*?<\/script>/, '');
const script = `<script data-desktop-pin-fixture>localStorage.setItem('codex-mobile.backend-registry.v1', ${JSON.stringify(JSON.stringify(registry))});</script>`;
source = source.replace('<head>', '<head>\n'+script);
await writeFile(target, source);
