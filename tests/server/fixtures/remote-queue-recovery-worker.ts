import { RemoteIdentityRegistry } from '../../../server/remote/identity-registry.js';
import { PrivateStore } from '../../../server/remote/private-store.js';
import { withRemoteOperation } from '../../../server/remote/operation-guard.js';
import { RemoteRuntimeStateStore } from '../../../server/remote/runtime-state.js';
import { performance } from 'node:perf_hooks';
const [directory, json] = process.argv.slice(2);
if (!directory || !json) throw new Error('需要显式隔离路径及冻结context');
const context = JSON.parse(json);
const registry = new RemoteIdentityRegistry(new PrivateStore(directory));
const active = await registry.readActive();
let allowed = false;
const deadline = performance.now() + 3000;
try {
  if (!active) throw new Error('not configured');
  await withRemoteOperation(() => { if (performance.now() >= deadline) throw new Error('deadline'); },
    () => registry.proveOperationRecovery(active.snapshot.generation, context.generation, context.managed, context.target));
  allowed = true;
} catch { /* 子进程只报告实际持久证明结果，不输出身份或路径。 */ }
const state = active ? await new RemoteRuntimeStateStore(active.store, active.snapshot.generation, active.snapshot.managed).read() : null;
console.log(JSON.stringify({ pid: process.pid, allowed, paused: state?.paused }));
