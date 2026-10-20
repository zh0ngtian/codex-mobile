import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, copyFile, rename, readFile, writeFile, rm, stat, lstat, readdir, realpath } from 'node:fs/promises';
import { join, resolve, sep, basename } from 'node:path';

const names = ['codex.exe', 'codex-code-mode-host.exe', 'codex-command-runner.exe', 'codex-windows-sandbox-setup.exe', 'codex-windows-sandbox-service.exe', 'rg.exe'];
async function digest(path) { const hash = createHash('sha256'); for await (const chunk of createReadStream(path)) hash.update(chunk); return hash.digest('hex'); }
function fileIdentity(info) {
  return [info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs, info.birthtimeNs].map(String).join(':');
}

// 仅保存于已有 ACL 保护的服务目录。缓存是性能索引，不是签名或权限边界。
export function createVersionInspector({ cachePath, onHash = () => {} }) {
  let cache, loading;
  async function load() {
    const entries = new Map();
    try {
      const saved = JSON.parse(await readFile(cachePath, 'utf8'));
      if (saved.schema === 1 && Array.isArray(saved.entries)) {
        for (const entry of saved.entries) {
          if (Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1]?.identity === 'string' && /^[a-f0-9]{64}$/.test(entry[1]?.sha256)) entries.set(entry[0], entry[1]);
        }
      }
    } catch { /* 缓存缺失或损坏时重新校验。 */ }
    return entries;
  }
  return async (candidate) => {
    cache ??= await (loading ??= load());
    let changed = false;
    const result = await inspectVersion(candidate, { cache, onHash, onChange: () => { changed = true; } });
    if (changed) {
      const temporary = `${cachePath}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify({ schema: 1, entries: [...cache].slice(-256) }), { mode: 0o600 });
        await rename(temporary, cachePath);
      } catch { /* 写缓存失败不影响已完成的内容校验。 */ }
      finally { await rm(temporary, { force: true }).catch(() => {}); }
    }
    return result;
  };
}

export async function inspectVersion(candidate, { cache, onHash = () => {}, onChange = () => {} } = {}) {
  const files = [];
  for (const name of names) {
    const path = join(candidate.resourcesDirectory, name);
    let details;
    try { details = await stat(path, { bigint: true }); } catch (error) { if (error.code === 'ENOENT' && !names.slice(0, 2).includes(name)) continue; throw error; }
    if (!details.isFile() || details.size <= 0) throw new Error('无效的配套文件');
    const actualPath = await realpath(path), identity = fileIdentity(details), saved = cache?.get(actualPath);
    let sha256 = saved?.identity === identity ? saved.sha256 : null;
    if (!sha256) {
      await onHash(path, Number(details.size));
      sha256 = await digest(path);
    }
    if (fileIdentity(await stat(path, { bigint: true })) !== identity || await realpath(path) !== actualPath) throw new Error('校验期间文件已变化');
    if (!saved || saved.identity !== identity) { cache?.set(actualPath, { identity, sha256 }); onChange(); }
    files.push({ name, size: Number(details.size), sha256 });
  }
  const fingerprint = createHash('sha256').update(JSON.stringify(files)).digest('hex');
  return { ...candidate, files, fingerprint, executable: join(candidate.resourcesDirectory, 'codex.exe') };
}
function assertOwnedDirectory(path, root, staging = false) {
  const target = resolve(path), base = resolve(root);
  if (!target.startsWith(base + sep) || (staging ? !basename(target).startsWith('.staging-') : !/^[a-f0-9]{64}$/.test(basename(target)))) throw new Error('版本目录超出私有目录');
}
export async function snapshotVersion(candidate, versionsRoot, inspect = inspectVersion) {
  const fresh = await inspect(candidate);
  if (fresh.fingerprint !== candidate.fingerprint) throw new Error('安装包文件已变化，延后更新');
  const root = resolve(versionsRoot); await mkdir(root, { recursive: true });
  const directory = join(root, candidate.fingerprint); assertOwnedDirectory(directory, root);
  try {
    const info = await lstat(directory);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('无效的版本目录');
    const existing = await inspect({ ...candidate, resourcesDirectory: directory });
    if (existing.fingerprint !== candidate.fingerprint) throw new Error('已保存的版本校验失败');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const staging = await mkdtemp(join(root, '.staging-')); assertOwnedDirectory(staging, root, true);
    try {
      for (const file of candidate.files) await copyFile(join(candidate.resourcesDirectory, file.name), join(staging, file.name));
      const copied = await inspect({ ...candidate, resourcesDirectory: staging });
      if (copied.fingerprint !== candidate.fingerprint) throw new Error('复制期间文件已变化');
      await writeFile(join(staging, 'receipt.json'), JSON.stringify({ version: candidate.version, fingerprint: candidate.fingerprint, files: candidate.files }, null, 2));
      await rename(staging, directory);
    } finally { assertOwnedDirectory(staging, root, true); await rm(staging, { recursive: true, force: true }); }
  }
  return { ...candidate, directory, resourcesDirectory: directory, executable: join(directory, 'codex.exe') };
}

export async function bundleSignature(resourcesDirectory) {
  const values = [];
  for (const name of names) {
    try { const info = await stat(join(resourcesDirectory, name)); values.push([name, info.size, info.mtimeMs]); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return JSON.stringify(values);
}

export async function retainVersions(versionsRoot, keep) {
  const root = await realpath(versionsRoot);
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || !/^[a-f0-9]{64}$/.test(entry.name) || keep.includes(entry.name)) continue;
    const target = join(root, entry.name); assertOwnedDirectory(target, root);
    const actual = await realpath(target);
    if (dirnameSafe(actual) !== root.toLowerCase()) throw new Error('旧版本路径超出私有目录');
    let receipt; try { receipt = JSON.parse(await readFile(join(target, 'receipt.json'), 'utf8')); } catch { continue; }
    if (receipt.fingerprint !== entry.name) continue;
    await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}
function dirnameSafe(path) { return resolve(path, '..').toLowerCase(); }
