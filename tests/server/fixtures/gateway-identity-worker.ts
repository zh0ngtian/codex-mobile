import { loadGatewayIdentity } from '../../../server/gateway-identity.js';
import { PrivateStore } from '../../../server/remote/private-store.js';
const [directory, mode] = process.argv.slice(2);
if (!directory) throw new Error('Missing isolated directory');
const hold = () => new Promise<void>(() => {});
if (mode === 'before') {
  await new PrivateStore(directory).withInitialization('gateway-identity', async () => { console.log('locked'); await hold(); });
} else {
  console.log(JSON.stringify(await loadGatewayIdentity(directory, { readMachineIdentity: async () => 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' })));
  if (mode === 'after') { setInterval(() => {}, 1000); await hold(); }
}
