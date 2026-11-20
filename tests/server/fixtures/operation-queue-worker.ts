import { OperationQueue } from '../../../server/operation-queue.js';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const [directory, mode, id = randomUUID(), conversationId = 'thread'] = process.argv.slice(2);
if (!directory) throw new Error('需要独立临时队列目录');
const queue = new OperationQueue({ directory, gatewayId: 'gateway', authorize: async () => () => {} });
const input = { id, conversationId, context: { mode: 'local' as const, gatewayId: 'gateway', businessKey: 'mac', authorizationKey: 'local-auth', localHostId: 'host' }, body: { text: 'first' }, settings: { model: 'test' }, attachmentRefs: ['ref'] };
const hold = async () => { setInterval(() => {}, 1000); await new Promise<void>(() => {}); };
if (mode === 'before-rename' || mode === 'after-rename') {
  const original = fs.rename;
  fs.rename = async (...args: Parameters<typeof original>) => {
    const own = String(args[1]) === join(directory, 'operations.json');
    if (own && mode === 'before-rename') { console.log('before-rename'); await hold(); }
    await Reflect.apply(original, fs, args);
    if (own && mode === 'after-rename') { console.log('after-rename'); await hold(); }
  }; syncBuiltinESMExports();
}
if (['claim', 'mark', 'mark-hold'].includes(mode ?? '')) {
  const claim = await queue.claimNext('mac');
  if (!claim) { console.log('null'); process.exit(0); }
  if (mode !== 'claim') await queue.markPotentialSend(claim.id, claim.revision, claim.claimToken!);
  console.log(JSON.stringify(await queue.read(claim.id)));
  if (mode === 'mark-hold' || mode === 'claim') await hold();
} else console.log(JSON.stringify(await queue.submit(input)));
