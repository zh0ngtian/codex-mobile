import { spawn } from 'node:child_process';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { chmod, lstat, readFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { PrivateStore } from './private-store.js';
import { RemoteAuthRequiredError } from './relay.js';

export interface DeviceIdentity {
  keyId: string;
  algorithm: 'ecdsa_p256_sha256';
  protectionClass: 'hardware_secure_enclave';
  publicKeySpkiDerBase64: string;
}
export interface DeviceKeySigner {
  getIdentity(): Promise<DeviceIdentity>;
  sign(bytes: Uint8Array): Promise<string>;
}
export interface KeyRecord { keyId: string; sealedKeyBase64: string }
type HelperRunner = (operation: string, input: Record<string, unknown>) => Promise<unknown>;
const MAX_HELPER_BYTES = 65536;
const SELFTEST_MESSAGE = 'Codex Mobile own Secure Enclave key persistence test';
function keyError(): RemoteAuthRequiredError { return new RemoteAuthRequiredError('自己的 Secure Enclave 密钥不可用'); }
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function base64(value: unknown, max = 32768): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && /^[A-Za-z0-9+/]+={0,2}$/.test(value) && Buffer.from(value, 'base64').toString('base64') === value;
}
function record(value: unknown): KeyRecord {
  if (!object(value) || typeof value.keyId !== 'string' || !/^[A-Za-z0-9._-]{1,256}$/.test(value.keyId) || !base64(value.sealedKeyBase64)) throw keyError();
  return { keyId: value.keyId, sealedKeyBase64: value.sealedKeyBase64 };
}
export function validateDeviceIdentity(value: unknown): DeviceIdentity {
  if (!object(value) || typeof value.keyId !== 'string' || !/^[A-Za-z0-9._-]{1,256}$/.test(value.keyId) || value.algorithm !== 'ecdsa_p256_sha256' || value.protectionClass !== 'hardware_secure_enclave' || !base64(value.publicKeySpkiDerBase64, 1024)) throw keyError();
  try {
    const key = createPublicKey({ key: Buffer.from(value.publicKeySpkiDerBase64, 'base64'), format: 'der', type: 'spki' });
    if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') throw keyError();
  } catch { throw keyError(); }
  return { keyId: value.keyId, algorithm: value.algorithm, protectionClass: value.protectionClass, publicKeySpkiDerBase64: value.publicKeySpkiDerBase64 };
}
export function verifyDeviceSignature(identity: DeviceIdentity, bytes: Uint8Array, signature: unknown): signature is string {
  try {
    return base64(signature, 256) && verify('sha256', bytes, { key: Buffer.from(identity.publicKeySpkiDerBase64, 'base64'), format: 'der', type: 'spki' }, Buffer.from(signature, 'base64'));
  } catch { return false; }
}
/** 不继承 stderr/stdout；超时、超限及非零退出均只返回固定错误。 */
export function runBoundedProcess(file: string, args: string[], input: string, timeoutMs: number): Promise<string> {
  if (Buffer.byteLength(input) > MAX_HELPER_BYTES || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 180000) return Promise.reject(keyError());
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    let done = false; let bytes = 0; const output: Buffer[] = [];
    const finish = (error?: Error) => {
      if (done) return; done = true; clearTimeout(timer);
      if (error) {
        // swiftc 可能派生 frontend/linker；整个独立进程组一起终止。
        if (child.pid && process.platform !== 'win32') { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already exited */ } }
        child.kill('SIGKILL'); reject(error);
      } else resolve(Buffer.concat(output).toString('utf8'));
    };
    const timer = setTimeout(() => finish(new Error('Secure Enclave helper 超时')), timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > MAX_HELPER_BYTES) finish(keyError()); else output.push(chunk); });
    child.stderr.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > MAX_HELPER_BYTES) finish(keyError()); });
    child.on('error', () => finish(keyError()));
    child.on('close', code => finish(code === 0 ? undefined : keyError()));
    child.stdin.on('error', () => finish(keyError()));
    child.stdin.end(input);
  });
}

export class SecureEnclaveDeviceKey implements DeviceKeySigner {
  private creating?: Promise<DeviceIdentity>;
  private helperReady?: Promise<string>;
  private readonly runner: HelperRunner;
  constructor(private readonly options: { store: PrivateStore; runHelper?: HelperRunner; processTimeoutMs?: number; compileTimeoutMs?: number }) {
    this.runner = options.runHelper ?? ((operation, input) => this.invoke(operation, input));
  }
  private async call(operation: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
    try {
      this.options.store.assertOwnership();
      if (Buffer.byteLength(JSON.stringify(input)) > MAX_HELPER_BYTES) throw keyError();
      const output = await this.runner(operation, input);
      this.options.store.assertOwnership();
      if (!object(output) || 'error' in output) throw keyError();
      return output;
    } catch { throw keyError(); }
  }
  private async loadRecord(): Promise<KeyRecord> {
    try { return record(await this.options.store.readJson('device-key.json')); } catch { throw keyError(); }
  }
  async create(): Promise<DeviceIdentity> {
    if (this.creating) return this.creating;
    this.creating = this.options.store.withInitialization('device-key', () => this.createOnce()).finally(() => { this.creating = undefined; });
    return this.creating;
  }
  private async createOnce(): Promise<DeviceIdentity> {
    const existing = await this.options.store.readJson('device-key.json');
    if (existing !== null) { record(existing); return this.getIdentity(); }
    const output = await this.call('create', {});
    const ownRecord = record(output.keyRecord);
    const identity = validateDeviceIdentity(output);
    if (identity.keyId !== ownRecord.keyId) throw keyError();
    if (!await this.options.store.createJson('device-key.json', ownRecord)) throw keyError();
    const persisted = await this.loadRecord();
    if (JSON.stringify(persisted) !== JSON.stringify(ownRecord)) throw keyError();
    const authoritative = await this.getIdentity();
    if (JSON.stringify(authoritative) !== JSON.stringify(identity)) throw keyError();
    return authoritative;
  }
  async getIdentity(): Promise<DeviceIdentity> {
    const keyRecord = await this.loadRecord();
    const identity = validateDeviceIdentity(await this.call('public', { keyRecord }));
    if (identity.keyId !== keyRecord.keyId || JSON.stringify(await this.loadRecord()) !== JSON.stringify(keyRecord)) throw keyError();
    return identity;
  }
  async sign(bytes: Uint8Array): Promise<string> {
    const keyRecord = await this.loadRecord();
    const identity = await this.getIdentity();
    const output = await this.call('sign', { keyRecord, messageBase64: Buffer.from(bytes).toString('base64') });
    if (JSON.stringify(validateDeviceIdentity(output)) !== JSON.stringify(identity) || !verifyDeviceSignature(identity, bytes, output.signatureDerBase64)) throw keyError();
    return output.signatureDerBase64;
  }
  async selftest(): Promise<{ restoredKeySigned: true; tamperedMessageRejected: true }> {
    const keyRecord = await this.loadRecord();
    const identity = await this.getIdentity();
    const output = await this.call('selftest', { keyRecord });
    const bytes = Buffer.from(SELFTEST_MESSAGE);
    if (output.restoredKeySigned !== true || output.tamperedMessageRejected !== true || !verifyDeviceSignature(identity, bytes, output.signatureDerBase64) || verifyDeviceSignature(identity, Buffer.concat([bytes, Buffer.from([0])]), output.signatureDerBase64)) throw keyError();
    return { restoredKeySigned: true, tamperedMessageRejected: true };
  }
  private async invoke(operation: string, input: Record<string, unknown>): Promise<unknown> {
    const helper = await this.compiledHelper();
    this.options.store.assertOwnership();
    const encoded = await runBoundedProcess(helper, [operation], JSON.stringify(input), this.options.processTimeoutMs ?? 10000);
    try { return JSON.parse(encoded) as unknown; } catch { throw keyError(); }
  }
  private compiledHelper(): Promise<string> {
    this.helperReady ??= this.compile().catch(error => { this.helperReady = undefined; throw error; });
    return this.helperReady;
  }
  private async compile(): Promise<string> {
    if (process.platform !== 'darwin') throw keyError();
    const source = fileURLToPath(new URL('./device-key.swift', import.meta.url));
    const hash = createHash('sha256').update(await readFile(source)).digest('hex');
    const cache = this.options.store.fork(join(this.options.store.directory, 'helper-cache', hash));
    await cache.readJson('cache-marker.json');
    const executable = join(cache.directory, 'device-key-helper');
    try {
      const stat = await lstat(executable);
      cache.assertOwnership();
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || (process.getuid && stat.uid !== process.getuid())) throw keyError();
      await chmod(executable, 0o700); cache.assertOwnership(); return executable;
    } catch (error) { if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw keyError(); }
    const temporary = join(cache.directory, `.compile-${randomUUID()}`);
    try {
      cache.assertOwnership();
      await runBoundedProcess('/usr/bin/xcrun', ['swiftc', source, '-o', temporary], '', this.options.compileTimeoutMs ?? 120000);
      cache.assertOwnership(); await chmod(temporary, 0o700); cache.assertOwnership(); await rename(temporary, executable); cache.assertOwnership();
      return executable;
    } finally { try { cache.assertOwnership(); await unlink(temporary); } catch { /* 失效root不按旧路径清理。 */ } }
  }
}
