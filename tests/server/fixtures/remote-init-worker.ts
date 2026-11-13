import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { SecureEnclaveDeviceKey } from '../../../server/remote/device-key.js';
import { RemoteAuthProviderImpl, deviceIdentityHash, parseManagedAuthRecord } from '../../../server/remote/auth.js';
import { PrivateStore } from '../../../server/remote/private-store.js';

let release!: () => void; let begin!: () => void;
const gate = new Promise<void>(resolve => { release = resolve; });
const start = new Promise<void>(resolve => { begin = resolve; });
process.on('message', message => { if (message === 'release') release(); if (message === 'start') begin(); });
const [action, directory, id] = process.argv.slice(2) as [string, string, string];
const send = (value: object) => process.send?.(value);
const store = new PrivateStore(directory);
const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const identity = { keyId: action === 'key' ? `own-${id}` : 'shared-own-key', algorithm: 'ecdsa_p256_sha256' as const, protectionClass: 'hardware_secure_enclave' as const, publicKeySpkiDerBase64: pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64') };
async function run() {
  send({ event: 'ready' }); await start;
  if (action === 'key') {
    const key = new SecureEnclaveDeviceKey({ store, runHelper: async (operation, input) => {
      if (operation === 'create') { send({ event: 'entered' }); await gate; return { ...identity, keyRecord: { keyId: identity.keyId, sealedKeyBase64: Buffer.from(JSON.stringify(identity)).toString('base64') } }; }
      const record = input.keyRecord as { sealedKeyBase64: string };
      return JSON.parse(Buffer.from(record.sealedKeyBase64, 'base64').toString());
    } });
    const result = await key.create(); return { identity: result.keyId };
  }
  if (action === 'enroll') {
    const jwt = (claims: object) => `e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.c2ln`;
    const namespace = { chatgpt_account_id: 'workspace', chatgpt_account_user_id: 'account-user' };
    const now = Date.now(); const seconds = Math.floor(now / 1000);
    const auth = parseManagedAuthRecord({ auth_mode: 'chatgpt', tokens: { access_token: jwt({ exp: seconds + 3600, 'https://api.openai.com/auth': namespace }), account_id: 'workspace' } });
    // Same test identity in both processes, with a synthetic private key supplied by parent over IPC.
    let shared!: { publicKeySpkiDerBase64: string; privatePem: string };
    const supplied = new Promise<void>(resolve => process.on('message', value => {
      if (value && typeof value === 'object' && 'privatePem' in value) { shared = value as typeof shared; resolve(); }
    }));
    send({ event: 'need-key' }); await supplied;
    identity.publicKeySpkiDerBase64 = shared.publicKeySpkiDerBase64;
    for (const method of ['writeJson', 'createJson'] as const) {
      const original = store[method]?.bind(store);
      if (original) Object.defineProperty(store, method, { value: async (name: string, value: unknown) => {
        if (name === 'enrollment.json') { send({ event: 'entered' }); await gate; }
        return original(name, value);
      } });
    }
    const clientId = `client-${id}`;
    const provider = new RemoteAuthProviderImpl({ store, now: () => now, deviceKey: { getIdentity: async () => identity, sign: async bytes => sign('sha256', bytes, shared.privatePem).toString('base64') }, loadManagedAuth: async () => auth, fetch: (async (input: string | URL | Request) => {
      if (String(input).endsWith('/start')) {
        send({ event: 'rest-start' });
        return new Response(JSON.stringify({ client_id: clientId, account_user_id: 'account-user', device_key_challenge: { client_id: clientId, account_user_id: 'account-user', purpose: 'remote_control_client_enrollment', audience: 'remote_control_client_enrollment', target_origin: 'https://chatgpt.com', target_path: '/backend-api/codex/remote/control/client/enroll/finish', challenge_expires_at: seconds + 120, challenge_id: randomUUID(), nonce: 'nonce', challenge_token: 'synthetic-challenge', device_identity_hash: deviceIdentityHash(identity) } }));
      }
      return new Response(JSON.stringify({ client_id: clientId, account_user_id: 'account-user', scopes: ['remote_control_controller_websocket'], expires_at: new Date(now + 3600000).toISOString(), remote_control_token: 'synthetic-session' }));
    }) as typeof fetch });
    return { identity: (await provider.enroll(jwt({ exp: seconds + 300, iat: seconds, pwd_auth_time: now, scope: 'codex.remote_control.enroll', 'https://api.openai.com/auth': namespace }))).clientId };
  }
  if (action === 'publish') {
    // Fault-injection gate between the real atomic publish and parent-directory
    // fsync. Keep all filesystem calls real; the parent may kill this process.
    const internal = store as unknown as { syncDirectory(path?: string): Promise<void> };
    const sync = internal.syncDirectory.bind(store); let paused = false;
    internal.syncDirectory = async path => {
      if (!paused && (path ?? store.directory) === store.directory && await access(join(store.directory, 'published.json')).then(() => true, () => false)) {
        paused = true; send({ event: 'entered' }); await gate;
      }
      await sync(path);
    };
    await store.createJson('published.json', { complete: true, payload: 'x'.repeat(50000) });
    return { identity: 'published' };
  }
  if (action === 'lock') {
    return store.withInitialization('held', async () => { send({ event: 'entered' }); await gate; return { identity: 'lock-completed' }; });
  }
  throw new Error('unknown action');
}
try { send({ event: 'result', ok: true, ...(await run()) }); }
catch { send({ event: 'result', ok: false }); }
finally { process.disconnect?.(); }
