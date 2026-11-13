import { createHash } from 'node:crypto';
import { validateDeviceIdentity, type DeviceIdentity } from './device-key.js';
import { RemoteAuthRequiredError } from './relay.js';

export const REMOTE_ORIGIN = 'https://chatgpt.com';
export const REMOTE_CLIENT_PATH = '/backend-api/codex/remote/control/client';
export const REMOTE_SCOPE = 'remote_control_controller_websocket';
const AUTH_NAMESPACE = 'https://api.openai.com/auth';
export interface ManagedAuth { accessToken: string; accountId: string; accountUserId: string; userId?: string }
export interface EnrollmentRecord {
  version: 1; clientId: string; accountId: string; accountUserId: string; managedAccountUserId: string;
  identityHash: string; identity: DeviceIdentity;
}
export interface RemoteSession { token: string; expiresAt: number }
export interface RestChallenge { token: string; payload: Record<string, unknown> }
export function invalid(): never { throw new RemoteAuthRequiredError('Remote 认证绑定或证明无效，需要重新认证'); }
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
export function text(value: unknown, max = 1024): string {
  if (typeof value !== 'string' || !value.length || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) invalid();
  return value;
}
export function sha256Base64url(value: string): string { return createHash('sha256').update(value).digest('base64url'); }
export function deviceIdentityHash(identity: DeviceIdentity): string {
  return sha256Base64url(JSON.stringify({ algorithm: identity.algorithm, keyId: identity.keyId, protectionClass: identity.protectionClass, publicKeySpkiDerBase64: identity.publicKeySpkiDerBase64 }));
}
function jwt(token: unknown): Record<string, unknown> {
  const encoded = text(token, 65536);
  const parts = encoded.split('.');
  if (parts.length !== 3 || !parts.every(part => /^[A-Za-z0-9_-]+$/.test(part))) invalid();
  try { return object(JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8'))); } catch { return invalid(); }
}
function authClaims(claims: Record<string, unknown>): { accountId: string; accountUserId: string; userId?: string } {
  const scope = object(claims[AUTH_NAMESPACE]);
  return {
    accountId: text(scope.chatgpt_account_id ?? scope.account_id),
    accountUserId: text(scope.chatgpt_account_user_id ?? scope.account_user_id),
    ...(scope.user_id === undefined ? {} : { userId: text(scope.user_id) }),
  };
}
/** 只解析普通账号已有 access token，从不消费 refresh_token 或猜测 API key。 */
export function parseManagedAuthRecord(value: unknown): ManagedAuth {
  const raw = object(value);
  if (raw.auth_mode === 'apikey' || raw.OPENAI_API_KEY != null) invalid();
  const tokens = object(raw.tokens);
  const accessToken = text(tokens.access_token, 65536);
  const claims = authClaims(jwt(accessToken));
  if (text(tokens.account_id) !== claims.accountId) invalid();
  return { accessToken, ...claims };
}
export function validateManagedAuth(value: unknown): ManagedAuth {
  const raw = object(value);
  const accessToken = text(raw.accessToken, 65536);
  const claims = authClaims(jwt(accessToken));
  if (text(raw.accountId) !== claims.accountId || text(raw.accountUserId) !== claims.accountUserId || raw.userId !== claims.userId) invalid();
  return { accessToken, ...claims };
}
export function assertAccount(auth: ManagedAuth, binding: { accountId: string; managedAccountUserId: string; accountUserId?: string }): void {
  if (auth.accountId !== binding.accountId || auth.accountUserId !== binding.managedAccountUserId) invalid();
  if (binding.accountUserId !== undefined && binding.accountUserId !== auth.accountUserId && binding.accountUserId !== auth.userId) invalid();
}
export function validateStepUp(token: string, auth: ManagedAuth, nowMs: number): void {
  const claims = jwt(token); const identity = authClaims(claims);
  if (identity.accountId !== auth.accountId || identity.accountUserId !== auth.accountUserId) invalid();
  if (claims.scope !== undefined && typeof claims.scope !== 'string') invalid();
  if (claims.scp !== undefined && (!Array.isArray(claims.scp) || !claims.scp.every(scope => typeof scope === 'string'))) invalid();
  const scopes = [...new Set([...(typeof claims.scope === 'string' ? claims.scope.split(/\s+/).filter(Boolean) : []), ...(Array.isArray(claims.scp) ? claims.scp : [])])];
  if (scopes.length !== 1 || scopes[0] !== 'codex.remote_control.enroll') invalid();
  if (!Number.isSafeInteger(claims.iat) || (claims.iat as number) > nowMs / 1000 || nowMs / 1000 - (claims.iat as number) > 300) invalid();
  if (!Number.isSafeInteger(claims.pwd_auth_time) || (claims.pwd_auth_time as number) > nowMs || nowMs - (claims.pwd_auth_time as number) > 300000) invalid();
  if (!Number.isSafeInteger(claims.exp) || (claims.exp as number) <= nowMs / 1000) invalid();
}
export function parseEnrollment(value: unknown): EnrollmentRecord {
  const record = object(value); const identity = validateDeviceIdentity(record.identity);
  if (record.version !== 1 || record.identityHash !== deviceIdentityHash(identity)) invalid();
  return { version: 1, clientId: text(record.clientId), accountId: text(record.accountId), accountUserId: text(record.accountUserId), managedAccountUserId: text(record.managedAccountUserId), identityHash: text(record.identityHash), identity };
}
export function validateRestStart(value: unknown, expected: { clientId?: string; accountUserId?: string; identityHash: string; auth: ManagedAuth; operation: 'enroll' | 'refresh' }, nowMs: number): { clientId: string; accountUserId: string; challenge: RestChallenge } {
  const start = object(value); const challenge = object(start.device_key_challenge);
  const clientId = text(start.client_id); const accountUserId = text(start.account_user_id);
  if (expected.clientId !== undefined && clientId !== expected.clientId) invalid();
  if (expected.accountUserId !== undefined && accountUserId !== expected.accountUserId) invalid();
  if (accountUserId !== expected.auth.accountUserId && accountUserId !== expected.auth.userId) invalid();
  if (challenge.client_id !== clientId || challenge.account_user_id !== accountUserId || challenge.purpose !== 'remote_control_client_enrollment' || challenge.audience !== 'remote_control_client_enrollment' || challenge.target_origin !== REMOTE_ORIGIN || challenge.target_path !== `${REMOTE_CLIENT_PATH}/${expected.operation}/finish`) invalid();
  if (challenge.device_identity_hash !== undefined ? challenge.device_identity_hash !== expected.identityHash : expected.operation === 'refresh') invalid();
  if (!Number.isSafeInteger(challenge.challenge_expires_at) || (challenge.challenge_expires_at as number) <= nowMs / 1000 || (challenge.challenge_expires_at as number) > nowMs / 1000 + 300) invalid();
  return { clientId, accountUserId, challenge: {
    token: text(challenge.challenge_token, 16384),
    payload: { accountUserId, audience: challenge.audience, challengeExpiresAt: challenge.challenge_expires_at, challengeId: text(challenge.challenge_id), clientId, deviceIdentitySha256Base64url: expected.identityHash, nonce: text(challenge.nonce, 4096), targetOrigin: challenge.target_origin, targetPath: challenge.target_path, type: 'remoteControlClientEnrollment' },
  } };
}
function scopes(value: unknown): void { if (!Array.isArray(value) || value.length !== 1 || value[0] !== REMOTE_SCOPE) invalid(); }
export function validateSession(value: unknown, binding: { clientId: string; accountUserId: string }, nowMs: number): RemoteSession {
  const response = object(value);
  if (response.client_id !== binding.clientId || response.account_user_id !== binding.accountUserId) invalid();
  scopes(response.scopes);
  const expiresAt = Date.parse(text(response.expires_at));
  if (!Number.isFinite(expiresAt) || Math.floor(expiresAt / 1000) <= nowMs / 1000) invalid();
  return { token: text(response.remote_control_token, 65536), expiresAt };
}
export function websocketPayload(value: unknown, record: EnrollmentRecord, session: RemoteSession, nowMs: number): Record<string, unknown> {
  const c = object(value);
  if (c.type !== 'device_key_challenge' || c.clientId !== record.clientId || c.accountUserId !== record.accountUserId || c.purpose !== 'remote_control_client_websocket' || c.audience !== 'remote_control_client_websocket' || c.targetOrigin !== REMOTE_ORIGIN || c.targetPath !== REMOTE_CLIENT_PATH || c.tokenSha256Base64url !== sha256Base64url(session.token) || c.tokenExpiresAt !== Math.floor(session.expiresAt / 1000) || (c.tokenExpiresAt as number) <= nowMs / 1000) invalid();
  scopes(c.scopes);
  return { accountUserId: record.accountUserId, audience: c.audience, clientId: record.clientId, nonce: text(c.nonce, 4096), scopes: [REMOTE_SCOPE], sessionId: text(c.sessionId, 4096), targetOrigin: REMOTE_ORIGIN, targetPath: REMOTE_CLIENT_PATH, tokenExpiresAt: c.tokenExpiresAt, tokenSha256Base64url: c.tokenSha256Base64url, type: 'remoteControlClientConnection' };
}
