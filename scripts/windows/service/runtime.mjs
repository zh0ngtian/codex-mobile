import { IdleUpdatePolicy, readIdleState } from './idle-state.mjs';
import { RpcClient } from './rpc.mjs';
import { createServer } from 'node:net';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export class ServiceRuntime {
  constructor({ endpoint, upstreamUrl, resolveVersion, prepareVersion, launchServer, now = Date.now, idleMs = 30_000, cooldownMs = 300_000, readyTimeoutMs = 30_000, onEvent = () => {} }) {
    Object.assign(this, { endpoint, upstreamUrl, resolveVersion, prepareVersion, launchServer, now, readyTimeoutMs, onEvent });
    this.policy = new IdleUpdatePolicy({ idleMs, cooldownMs });
    this.current = null; this.previous = null; this.target = null; this.server = null; this.monitor = null;
    this.updateState = 'stopped'; this.operation = null; this.stopping = false;
    endpoint.onActivity = () => this.policy.invalidate();
  }
  status() {
    return { updateState: this.updateState, currentVersion: this.current?.version ?? null, targetVersion: this.target?.version ?? null,
      currentFingerprint: this.current?.fingerprint ?? null, targetFingerprint: this.target?.fingerprint ?? null,
      pid: this.server?.pid ?? null, ready: !!this.server?.alive() && this.monitor?.socket.readyState === 1 && this.endpoint.accepting };
  }
  async lock(fn) {
    if (this.operation || this.stopping) return { changed: false, reason: 'operation-in-progress' };
    const operation = Promise.resolve().then(fn); this.operation = operation;
    try { return await operation; } finally { if (this.operation === operation) this.operation = null; }
  }
  async launch(version) {
    const endpoint = new URL(this.upstreamUrl), freeDeadline = Date.now() + this.readyTimeoutMs;
    let free = false;
    while (Date.now() < freeDeadline) {
      free = await new Promise((resolve) => {
        const probe = createServer();
        probe.once('error', () => resolve(false));
        probe.listen(Number(endpoint.port), '127.0.0.1', () => probe.close(() => resolve(true)));
      });
      if (free) break;
      await sleep(50);
    }
    if (!free) throw new Error('旧服务端口尚未释放或被其他进程占用');
    this.server = await this.launchServer(version);
    const deadline = Date.now() + this.readyTimeoutMs;
    while (Date.now() < deadline) {
      if (!this.server.alive()) throw new Error('服务提前退出');
      try {
        const response = await fetch(this.upstreamUrl.replace(/^ws:/, 'http:') + '/readyz', { signal: AbortSignal.timeout(1500) });
        if (response.ok) {
          const monitor = await RpcClient.connect(this.upstreamUrl);
          try {
            const models = await monitor.request('model/list', { includeHidden: false });
            if (!Array.isArray(models?.data)) throw new Error('上游校验失败');
            this.monitor = monitor; this.current = version; return;
          } catch (error) { monitor.close(); throw error; }
        }
      } catch { }
      await sleep(50);
    }
    throw new Error('服务就绪超时');
  }
  async start() {
    this.updateState = 'starting'; this.endpoint.accepting = false;
    try {
      this.target = await this.resolveVersion();
      await this.launch(await this.prepareVersion(this.target));
      await this.endpoint.listen(); this.endpoint.resume(); this.updateState = 'aligned';
      this.onEvent('started', this.status());
    } catch (error) {
      await this.server?.stop(); this.server = null; this.updateState = 'failed'; throw error;
    }
  }
  async idle() {
    if (!this.monitor || this.endpoint.runningWorkCount > 0) return { idle: false, reason: 'process-active-or-unavailable' };
    return readIdleState(this.monitor.request.bind(this.monitor));
  }
  async checkUpdate({ refresh = true } = {}) {
    return this.lock(async () => {
      try {
        const candidate = refresh || !this.target ? await this.resolveVersion() : this.target; this.target = candidate;
        if (candidate.fingerprint === this.current?.fingerprint) { this.updateState = 'aligned'; this.policy.invalidate(); return { changed: false, reason: 'aligned' }; }
        const idle = await this.idle();
        if (!this.policy.observe({ current: this.current?.fingerprint, target: candidate.fingerprint, idle: idle.idle, now: this.now() })) {
          if (this.updateState !== 'rollback') this.updateState = 'waiting-idle';
          return { changed: false, reason: idle.idle ? 'waiting-idle-window-or-backoff' : idle.reason };
        }
        return this.switchTo(candidate, false);
      } catch {
        this.policy.invalidate(); this.updateState = 'monitor-unavailable';
        return { changed: false, reason: 'monitor-unavailable' };
      }
    });
  }
  async restart({ force = false } = {}) {
    return this.lock(async () => {
      const candidate = await this.resolveVersion(); this.target = candidate;
      if (!force && !(await this.idle()).idle) return { changed: false, reason: 'work-active-or-unknown' };
      return this.switchTo(candidate, true, force);
    });
  }
  async switchTo(candidate, manual, force = false) {
    let stopped = false;
    const previous = this.current;
    try {
      const prepared = await this.prepareVersion(candidate);
      const latest = await this.resolveVersion();
      if (latest.fingerprint !== candidate.fingerprint || this.stopping) { this.policy.invalidate(); return { changed: false, reason: 'target-changed-or-stopping' }; }
      await this.endpoint.drain();
      const idle = await this.idle();
      if (!force && (!idle.idle || this.endpoint.runningWorkCount || this.endpoint.pendingCount)) { this.policy.invalidate(); return { changed: false, reason: 'work-active-after-drain' }; }
      if (!manual && !this.policy.observe({ current: previous.fingerprint, target: candidate.fingerprint, idle: true, now: this.now() })) return { changed: false, reason: 'activity-during-prepare' };
      this.updateState = 'restarting'; this.onEvent('restarting', this.status());
      this.monitor?.close(); this.monitor = null; this.endpoint.disconnectClients();
      await this.server.stop(); this.server = null; stopped = true;
      this.endpoint.resetGeneration();
      await this.launch(prepared); this.previous = previous; this.updateState = 'aligned'; this.policy.invalidate();
      this.onEvent('updated', this.status()); return { changed: true };
    } catch {
      this.policy.failed(candidate.fingerprint, this.now());
      if (stopped) {
        await this.server?.stop(); this.server = null;
        try { await this.launch(previous); this.updateState = 'rollback'; this.onEvent('rollback', this.status()); }
        catch { this.updateState = 'failed'; this.onEvent('failed', this.status()); }
      } else this.updateState = 'update-deferred';
      return { changed: false, reason: 'update-failed' };
    } finally { if (this.server?.alive() && this.monitor) this.endpoint.resume(); }
  }
  async stop() {
    this.stopping = true;
    try { await this.operation; } catch { }
    this.monitor?.close(); this.monitor = null;
    await this.server?.stop(); this.server = null;
    await this.endpoint.close(); this.updateState = 'stopped';
  }
  async prepareStop({ force = false } = {}) {
    return this.lock(async () => {
      try {
        await this.endpoint.drain();
        if (!force && (!(await this.idle()).idle || this.endpoint.pendingCount || this.endpoint.runningWorkCount)) {
          this.endpoint.resume(); return { changed: false, reason: 'work-active-or-unknown' };
        }
        this.updateState = 'stopping'; return { changed: true };
      } catch { this.endpoint.resume(); return { changed: false, reason: 'work-active-or-unknown' }; }
    });
  }
}
