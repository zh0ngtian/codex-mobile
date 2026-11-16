import { OperationScheduler } from '../../../server/operation-scheduler.js';
import { TargetResolver } from '../../../server/targets.js';
import { FollowUps } from '../../../server/follow-ups.js';
import { HttpSessions } from '../../../server/http-session.js';
import { join } from 'node:path';
const [root, upstreamUrl] = process.argv.slice(2); if (!root || !upstreamUrl) throw new Error('需要隔离home与LocalWS');
const identity = { version: 1 as const, gatewayId: 'h-gateway', localHostId: 'h-local' };
const scheduler = new OperationScheduler({ directory: join(root, 'ledger'), gatewayId: identity.gatewayId, gatewayCodexHome: root, resolver: new TargetResolver({ identity }), upstreamUrl, attemptTimeoutMs: 3000, remoteConsumers: () => { throw new Error('禁止Remote'); } });
const sessions = new HttpSessions({ codexHome: root, upstreamUrl });
try { const facade = await FollowUps.open(root, sessions, { scheduler }); await scheduler.runOnce(); console.log(JSON.stringify(await scheduler.listFollowUps(await new TargetResolver({ identity }).operationContext()))); await facade.close(); }
finally { await scheduler.close(); await sessions.close(); }
