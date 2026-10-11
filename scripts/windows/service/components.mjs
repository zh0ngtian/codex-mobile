export class SidecarSupervisor {
  constructor({ launchGateway, launchTunnel, now = Date.now, retryMs = 5000, onEvent = () => {} }) {
    Object.assign(this, { launchGateway, launchTunnel, now, retryMs, onEvent });
    this.gateway = null; this.tunnel = null; this.nextGateway = 0; this.nextTunnel = 0;
  }
  status() { return { gatewayRunning: !!this.gateway?.alive(), tunnelRunning: !!this.tunnel?.alive() }; }
  async tick() {
    for (const name of ['gateway', 'tunnel']) {
      const deadline = name === 'gateway' ? 'nextGateway' : 'nextTunnel';
      if (this[name]?.alive() || this.now() < this[deadline]) continue;
      this[deadline] = this.now() + this.retryMs;
      try {
        await this[name]?.stop();
        this[name] = await (name === 'gateway' ? this.launchGateway() : this.launchTunnel());
        this.onEvent(`${name}-started`);
      } catch { this[name] = null; this.onEvent(`${name}-unavailable`); }
    }
  }
  async stop() { await this.tunnel?.stop(); await this.gateway?.stop(); }
}
