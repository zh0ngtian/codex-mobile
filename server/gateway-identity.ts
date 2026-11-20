import { randomUUID, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { PrivateStore } from './remote/private-store.js';

export interface GatewayIdentity {
  readonly version: 1;
  readonly gatewayId: string;
  readonly localHostId: string;
}
export class GatewayIdentityError extends Error {
  constructor(readonly code: 'storage' | 'machine-mismatch' | 'machine-unavailable' | 'unsupported-platform') {
    super(code === 'machine-mismatch' ? '网关数据属于另一台机器，请使用新数据目录；旧记录已保留' : '网关固定身份不可用，不能自动重建或继承旧数据');
    this.name = 'GatewayIdentityError';
  }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const exec = promisify(execFile);
type MachineExecution = (file: string, args: string[], options: { encoding: 'utf8'; timeout: number; maxBuffer: number; shell: false }) => Promise<{ stdout: string }>;
/** 仅可信宿主/测试可注入执行边界；不启动shell，不输出或保存原始硬件ID。 */
export async function readMacMachineIdentity(options: { platform?: string; execute?: MachineExecution } = {}): Promise<string> {
  if ((options.platform ?? process.platform) !== 'darwin') throw new GatewayIdentityError('unsupported-platform');
  try {
    const { stdout } = await (options.execute ?? exec)('/usr/sbin/ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], {
      encoding: 'utf8', timeout: 2000, maxBuffer: 65536, shell: false,
    });
    if (typeof stdout !== 'string' || Buffer.byteLength(stdout) > 65536) throw new Error();
    const values = [...stdout.matchAll(/"IOPlatformUUID"\s*=\s*"([^"\r\n]*)"/g)];
    if (values.length !== 1 || !UUID.test(values[0]![1]!)) throw new Error();
    return values[0]![1]!.toLowerCase();
  } catch { throw new GatewayIdentityError('machine-unavailable'); }
}
function parse(value: unknown): GatewayIdentity & { machineFingerprint: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new GatewayIdentityError('storage');
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).length !== 4 || Object.keys(raw).some(key => !['version', 'gatewayId', 'localHostId', 'machineFingerprint'].includes(key)) ||
    raw.version !== 1 || typeof raw.gatewayId !== 'string' || !UUID.test(raw.gatewayId) || typeof raw.localHostId !== 'string' || !UUID.test(raw.localHostId) ||
    raw.gatewayId === raw.localHostId || typeof raw.machineFingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(raw.machineFingerprint))
    throw new GatewayIdentityError('storage');
  return { version: 1, gatewayId: raw.gatewayId, localHostId: raw.localHostId, machineFingerprint: raw.machineFingerprint };
}
async function privateEntry(path: string, directory: boolean): Promise<void> {
  try {
    const stat = await lstat(path);
    if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1) ||
      (process.getuid && stat.uid !== process.getuid()) || (stat.mode & 0o777) !== (directory ? 0o700 : 0o600)) throw new Error();
  } catch (error) { if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw new GatewayIdentityError('storage'); }
}
/** 保留此目录即保留网关随机身份；Remote重授权及显示名称都不参与归属。 */
export async function loadGatewayIdentity(
  directory = join(homedir(), '.codex-mobile', 'gateway-identity'),
  options: { readMachineIdentity?: () => Promise<string> } = {},
): Promise<Readonly<GatewayIdentity>> {
  let machine: string;
  try {
    machine = await (options.readMachineIdentity ?? readMacMachineIdentity)();
    if (typeof machine !== 'string' || !UUID.test(machine)) throw new Error();
  } catch (error) {
    if (error instanceof GatewayIdentityError) throw error;
    throw new GatewayIdentityError('machine-unavailable');
  }
  const fingerprint = createHash('sha256').update(JSON.stringify(['codex-mobile-gateway-machine-v1', machine.toLowerCase()])).digest('hex');
  try {
    await privateEntry(directory, true);
    const store = new PrivateStore(directory);
    return await store.withInitialization('gateway-identity', async () => {
      await privateEntry(directory, true); await privateEntry(join(directory, 'identity.json'), false);
      let value = await store.readJson('identity.json');
      if (value === null) {
        await store.createJson('identity.json', { version: 1, gatewayId: randomUUID(), localHostId: randomUUID(), machineFingerprint: fingerprint });
        await privateEntry(join(directory, 'identity.json'), false);
        value = await store.readJson('identity.json');
      }
      const identity = parse(value);
      if (identity.machineFingerprint !== fingerprint) throw new GatewayIdentityError('machine-mismatch');
      // record已fsync仍不足以证明新数据目录的父项耐久；并发读者也在交付前完成同一屏障。
      for (let parent = dirname(store.directory); ; parent = dirname(parent)) {
        const handle = await open(parent, constants.O_RDONLY | constants.O_NOFOLLOW);
        try { if (!(await handle.stat()).isDirectory()) throw new Error(); await handle.sync(); }
        finally { await handle.close(); }
        if (parent === dirname(parent)) break;
      }
      return Object.freeze({ version: 1 as const, gatewayId: identity.gatewayId, localHostId: identity.localHostId });
    });
  } catch (error) {
    if (error instanceof GatewayIdentityError) throw error;
    throw new GatewayIdentityError('storage');
  }
}
