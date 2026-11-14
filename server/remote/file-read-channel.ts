import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { RemoteRpcError, type RemoteRpcSession } from './rpc-session.js';
import { assertRemoteOperation, withRemoteOperation } from './operation-guard.js';
import { reserveFileBudget } from './file-budget.js';
import { RemoteFileError, fileExecEnded, fileFailure, fileSha, fileText, record, type RemoteFileFailure } from './file-channel.js';
import { REMOTE_FILE_READ_PYTHON } from './file-read-python.js';
import type { JsonValue } from './envelope.js';

const OUTPUT_CAP = 3 * 1024 * 1024;
interface Process { id: string; sent: boolean; ended: boolean; execution: Promise<boolean>; stopping?: Promise<boolean> }

/** 一次文件操作保有一个额度；每窗仅使用一个自然退出的buffered exec。 */
export class RemoteFileReadChannel {
  sent = false;
  error?: RemoteFileError;
  private current?: Process;
  private releaseRequested = false;
  private released = false;
  private window?: () => void;
  private readonly permit: () => void;
  private timer: NodeJS.Timeout;
  private readonly failure: Promise<never>;
  private rejectFailure!: (error: RemoteFileError) => void;
  constructor(private readonly session: RemoteRpcSession, private readonly binding: { python: string; metadata: { codexHome: string } }, readonly deadline: number, private readonly signal?: AbortSignal, private readonly onRelease?: () => void) {
    this.assert(); const permit = reserveFileBudget();
    if (!permit) throw new RemoteFileError('capacity', false);
    this.permit = permit;
    this.failure = new Promise((_resolve, reject) => { this.rejectFailure = reject; }); void this.failure.catch(() => undefined);
    this.timer = setTimeout(this.expired, Math.max(1, Math.ceil(deadline - performance.now())));
    signal?.addEventListener('abort', this.cancelled, { once: true });
    session.on('disconnect', this.disconnected); session.on('close', this.disconnected);
  }
  assert(checkParents = true): void {
    if (this.error) throw this.error;
    if (checkParents) assertRemoteOperation();
    if (!this.session.ready) throw new RemoteFileError('disconnected', this.sent);
    if (performance.now() >= this.deadline) throw new RemoteFileError('timeout', this.sent);
    if (this.signal?.aborted) throw new RemoteFileError('cancelled', this.sent);
  }
  private remaining(): number { this.assert(); return Math.max(1, Math.floor(this.deadline - performance.now())); }
  private cancelled = () => this.fail('cancelled');
  private disconnected = () => this.fail('disconnected');
  private expired = (): void => {
    const remaining = this.deadline - performance.now();
    if (remaining > 0) { this.timer = setTimeout(this.expired, Math.max(1, Math.ceil(remaining))); return; }
    this.fail('timeout'); this.tryRelease();
  };
  fail(code: RemoteFileFailure): void {
    if (this.error || this.released) return;
    this.error = new RemoteFileError(code, this.sent); this.rejectFailure(this.error); this.clearWindow();
    this.releaseRequested = true; void this.stop(); this.tryRelease();
  }
  holdWindow(...arrays: unknown[][]): void { this.window = () => { for (const array of arrays) array.length = 0; }; }
  clearWindow(): void { this.window?.(); this.window = undefined; }
  async read(request: Record<string, unknown>): Promise<Record<string, unknown>[]> {
    return withRemoteOperation(() => this.assert(false), async () => {
      this.assert();
      if (this.current && !this.current.ended) throw new RemoteFileError('protocol', this.sent);
      const nonce = randomUUID(); const budget = this.remaining(); const previousSent = this.sent;
      const current: Process = { id: 'codex-mobile-file:' + randomUUID(), sent: true, ended: false, execution: Promise.resolve(false) };
      this.current = current;
      const params: Record<string, JsonValue> = { command: [this.binding.python, '-I', '-u', '-c', REMOTE_FILE_READ_PYTHON, nonce, String(budget), JSON.stringify(request)], cwd: this.binding.metadata.codexHome, processId: current.id, streamStdin: false, streamStdoutStderr: false, outputBytesCap: OUTPUT_CAP, timeoutMs: this.remaining() };
      const execution = this.session.call('command/exec', params, { timeoutMs: this.remaining() }); this.sent = true;
      // 不取消原exec的RPC等待：terminate ACK不能证明目标已结束。取消立即拒绝调用者，
      // 仍观察原exec的实际终结，或到原绝对期限才回收活动进程的额度。
      let output: unknown;
      const completion = execution.then(value => {
        current.ended = fileExecEnded(value);
        if (!this.error) output = value;
        this.tryRelease();
      }, (error: unknown) => {
        if (error instanceof RemoteRpcError && !error.mayHaveBeenSent) { current.sent = false; current.ended = true; this.sent = previousSent; }
        this.tryRelease(); throw error;
      });
      current.execution = completion.then(() => current.ended, () => current.ended);
      try {
        // 未决failure的reaction会保留race的兑现值；race只能兑现void，
        // 避免已消费窗口的大RPC结果随整次文件操作存活。
        await Promise.race([completion, this.failure]); this.assert();
        const result = this.decode(output, nonce); this.assert(); return result;
      } catch (error) {
        const failure = fileFailure(this.error ?? error, this.sent); this.fail(failure.code); throw failure;
      } finally { output = undefined; }
    });
  }
  private decode(value: unknown, nonce: string): Record<string, unknown>[] {
    if (!record(value) || Object.keys(value).sort().join(',') !== 'exitCode,stderr,stdout' || value.exitCode !== 0 || typeof value.stdout !== 'string' || typeof value.stderr !== 'string' || Buffer.byteLength(value.stdout) > OUTPUT_CAP || Buffer.byteLength(value.stderr) > 256) throw new RemoteFileError('protocol', true);
    const proof = /^CMFILE_READ1_DONE:([a-z0-9-]+):([1-9][0-9]{0,7}):([a-f0-9]{64})\n$/.exec(value.stderr);
    if (!proof || proof[1] !== nonce || Number(proof[2]) !== Buffer.byteLength(value.stdout) || fileSha(Buffer.from(value.stdout)) !== proof[3]) throw new RemoteFileError('integrity', true);
    if (!value.stdout.endsWith('\n')) throw new RemoteFileError('protocol', true);
    const lines = value.stdout.slice(0, -1).split('\n');
    if (!lines.length || lines.length > 6) throw new RemoteFileError('protocol', true);
    const records = lines.map((line, index) => {
      if (Buffer.byteLength(line) >= 710000) throw new RemoteFileError('capacity', true);
      const item: unknown = JSON.parse(fileText(Buffer.from(line)), (key, value: unknown) => { if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error(); return value; });
      if (!record(item) || item.v !== 1 || item.n !== nonce || item.end !== nonce || item.seq !== index + 1 || typeof item.kind !== 'string') throw new RemoteFileError('protocol', true);
      return item;
    });
    const failure = records.find(item => item.kind === 'failure');
    if (failure) {
      const codes: RemoteFileFailure[] = ['protocol', 'integrity', 'version', 'capacity', 'invalid-input', 'not-found', 'permission', 'timeout'];
      if (Object.keys(failure).sort().join(',') !== 'code,end,kind,n,seq,v' || !codes.includes(failure.code as RemoteFileFailure)) throw new RemoteFileError('protocol', true);
      throw new RemoteFileError(failure.code as RemoteFileFailure, true);
    }
    return records;
  }
  stop(): Promise<boolean> {
    const current = this.current;
    if (!current || current.ended || !current.sent) return Promise.resolve(true);
    if (current.stopping) return current.stopping;
    current.stopping = (async () => {
      let timer: NodeJS.Timeout | undefined;
      try {
        if (!this.session.ready) return false;
        const termination = this.session.call('command/exec/terminate', { processId: current.id }, { timeoutMs: 1000 });
        const finished = Promise.all([termination, current.execution]).then(([, ended]) => ended);
        return await Promise.race([finished, new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), 1000); })]);
      } catch { return false; }
      finally { if (timer) clearTimeout(timer); this.tryRelease(); }
    })();
    return current.stopping;
  }
  release(): void { this.releaseRequested = true; this.clearWindow(); this.tryRelease(); }
  private tryRelease(): void {
    if (this.released || !this.releaseRequested || (this.current?.sent && !this.current.ended && performance.now() < this.deadline)) return;
    this.released = true; clearTimeout(this.timer); this.signal?.removeEventListener('abort', this.cancelled);
    this.session.off('disconnect', this.disconnected); this.session.off('close', this.disconnected);
    this.clearWindow(); this.permit(); this.onRelease?.();
  }
}
