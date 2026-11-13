// @vitest-environment node
import { createHash, generateKeyPairSync, sign, verify } from 'node:crypto';
import { access, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PrivateStore } from '../../server/remote/private-store.js';
import { SecureEnclaveDeviceKey, runBoundedProcess, type DeviceIdentity } from '../../server/remote/device-key.js';

const roots: string[] = [];
async function fixture() {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'remote-key-test-')); roots.push(root);
  const store = new PrivateStore(join(root, 'remote'));
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const identity: DeviceIdentity = { keyId: 'own-key', algorithm: 'ecdsa_p256_sha256', protectionClass: 'hardware_secure_enclave', publicKeySpkiDerBase64: pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64') };
  const calls: string[] = [];
  const runHelper = async (op: string, input: Record<string, unknown>) => {
    calls.push(op);
    if (op === 'create') return { ...identity, keyRecord: { keyId: identity.keyId, sealedKeyBase64: 'c2VhbGVk' } };
    if (op === 'sign') return { ...identity, signatureDerBase64: sign('sha256', Buffer.from(input.messageBase64 as string, 'base64'), pair.privateKey).toString('base64') };
    return identity;
  };
  return { root, store, pair, identity, calls, runHelper, key: new SecureEnclaveDeviceKey({ store, runHelper }) };
}
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
describe('自己的 Secure Enclave 密钥', () => {
  it('显式创建并持久化sealed record，重启后复用而不创建新身份', async () => {
    const { key, store, runHelper, identity, calls } = await fixture();
    expect(await key.create()).toEqual(identity);
    expect(await key.create()).toEqual(identity);
    expect(await store.readJson('device-key.json')).toEqual({ keyId: 'own-key', sealedKeyBase64: 'c2VhbGVk' });
    expect(await new SecureEnclaveDeviceKey({ store, runHelper }).getIdentity()).toEqual(identity);
    expect(calls.filter(op => op === 'create')).toHaveLength(1);
  });
  it('未创建和损坏的密钥需要认证，不静默替换', async () => {
    const { key, store, calls } = await fixture();
    await expect(key.getIdentity()).rejects.toThrow();
    await store.writeJson('device-key.json', { keyId: 'bad' });
    await expect(key.create()).rejects.toThrow();
    expect(calls).toEqual([]);
  });
  it('独立ECDSA验签并拒绝错误签名和超限stdin', async () => {
    const { key, store, runHelper, identity } = await fixture();
    await key.create();
    const bytes = Buffer.from('own-key-signature');
    const signature = await key.sign(bytes);
    expect(verify('sha256', bytes, { key: Buffer.from(identity.publicKeySpkiDerBase64, 'base64'), format: 'der', type: 'spki' }, Buffer.from(signature, 'base64'))).toBe(true);
    const bad = new SecureEnclaveDeviceKey({ store, runHelper: async (op, input) => op === 'sign' ? { ...identity, signatureDerBase64: 'YmFk' } : runHelper(op, input) });
    await expect(bad.sign(bytes)).rejects.toThrow();
    await expect(key.sign(Buffer.alloc(65537))).rejects.toThrow();
  });
  it('helper错误脱敏且不创建软件回退', async () => {
    const { store } = await fixture();
    const key = new SecureEnclaveDeviceKey({ store, runHelper: async () => { throw new Error('secret token /private/user'); } });
    await expect(key.create()).rejects.toThrow('Secure Enclave');
    await expect(key.create()).rejects.not.toThrow('secret');
    expect(await store.readJson('device-key.json')).toBeNull();
  });
  it('进程超时终止并限制输出', async () => {
    await expect(runBoundedProcess(process.execPath, ['-e', 'setInterval(()=>{},100)'], '', 30)).rejects.toThrow('超时');
    await expect(runBoundedProcess(process.execPath, ['-e', 'process.stdout.write("x".repeat(70000))'], '', 1000)).rejects.toThrow();
    expect(await runBoundedProcess(process.execPath, ['-e', 'process.stdout.write("ok")'], '', 1000)).toBe('ok');
  });
  it.skipIf(process.platform === 'win32')('超时同时终止编译器派生的子进程', async () => {
    const { root } = await fixture(); const marker = join(root, 'orphan-marker');
    const worker = `setTimeout(()=>require('node:fs').writeFileSync(${JSON.stringify(marker)},'orphan'),250)`;
    const parent = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(worker)}]);setInterval(()=>{},100)`;
    await expect(runBoundedProcess(process.execPath, ['-e', parent], '', 100)).rejects.toThrow('超时');
    await new Promise(resolve => setTimeout(resolve, 350));
    await expect(access(marker)).rejects.toThrow();
  });
  it.runIf(process.env.CODEX_MOBILE_SECURE_ENCLAVE_SELFTEST === '1')('真实Mac用临时自己的新密钥完成创建、恢复与独立验签', async () => {
    const { store } = await fixture();
    const key = new SecureEnclaveDeviceKey({ store });
    const identity = await key.create();
    const restored = new SecureEnclaveDeviceKey({ store });
    expect(await restored.getIdentity()).toEqual(identity);
    const bytes = createHash('sha256').update('temporary own identity').digest();
    const signature = await restored.sign(bytes);
    expect(verify('sha256', bytes, { key: Buffer.from(identity.publicKeySpkiDerBase64, 'base64'), format: 'der', type: 'spki' }, Buffer.from(signature, 'base64'))).toBe(true);
    expect(await restored.selftest()).toEqual({ restoredKeySigned: true, tamperedMessageRejected: true });
  }, 180000);
});
