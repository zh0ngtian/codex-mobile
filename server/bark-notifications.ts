import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { FinalAnswerCompletionTracker } from "./final-answer-completion.js";
import { readLocalThreadMetadata } from "./local-thread-metadata.js";
import { isVisibleThread } from "./thread-visibility.js";
import { parseBarkPushUrl } from "./notification-settings.js";

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const MAX_SUBSCRIPTIONS = 128;
const MAX_DEDUPLICATION = 4096;
const MAX_STATE_BYTES = 1024 * 1024;
const MAX_PENDING_PUSHES = 128;
type Subscription = { clientId: string; backendId: string; barkUrl: string };
type State = { subscriptions: Subscription[]; delivered: string[] };

/** 全网关共用订阅和去重记录，HTTP 与流式连接只提交实时事件。 */
export class BarkNotifications {
  private titles = new Map<string, { name?: string | null; preview?: string | null }>();
  private completions = new FinalAnswerCompletionTracker();
  private subscriptions = new Map<string, Subscription>();
  private delivered = new Set<string>();
  private queue: Promise<void> = Promise.resolve();
  private ready: Promise<void>;
  private jobs = new Set<Promise<void>>();
  private controllers = new Set<AbortController>();
  private closed = false;
  private root: string;
  constructor(private options: { codexHome: string; displayName: string; fetch?: typeof fetch }) {
    this.root = join(options.codexHome, "codex-mobile-notifications");
    this.ready = this.load();
    this.ready.catch(() => {});
  }
  get subscribed() { return this.subscriptions.size > 0; }
  private key(subscription: Pick<Subscription, "clientId" | "backendId">) { return JSON.stringify([subscription.clientId, subscription.backendId]); }
  private async load() {
    const path = join(this.root, "state.json");
    try {
      if ((await stat(path)).size > MAX_STATE_BYTES) throw new Error("通知设置文件过大");
      const state = JSON.parse(await readFile(path, "utf8")) as State;
      if (!Array.isArray(state.subscriptions) || state.subscriptions.length > MAX_SUBSCRIPTIONS || !Array.isArray(state.delivered) || state.delivered.length > MAX_DEDUPLICATION) throw new Error("通知设置无效");
      for (const subscription of state.subscriptions) {
        if (!UUID.test(subscription.clientId) || typeof subscription.backendId !== "string" || !subscription.backendId.trim() || subscription.backendId.length > 256) throw new Error("通知订阅无效");
        this.subscriptions.set(this.key(subscription), { ...subscription, barkUrl: parseBarkPushUrl(subscription.barkUrl) });
      }
      for (const id of state.delivered) { if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("通知去重记录无效"); this.delivered.add(id); }
      await chmod(this.root, 0o700); await chmod(path, 0o600);
    } catch (error: any) { if (error.code !== "ENOENT") throw error; }
  }
  private enqueue(work: () => Promise<void>) {
    const result = this.queue.then(() => this.ready).then(work);
    this.queue = result.catch(() => {});
    return result;
  }
  private async save() {
    const state: State = { subscriptions: [...this.subscriptions.values()], delivered: [...this.delivered] };
    const raw = JSON.stringify(state);
    if (Buffer.byteLength(raw) > MAX_STATE_BYTES) throw new Error("通知设置容量已满");
    await mkdir(this.root, { recursive: true, mode: 0o700 }); await chmod(this.root, 0o700);
    const temporary = join(this.root, `.state-${randomUUID()}.tmp`);
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(raw); await file.sync(); await file.close();
      await rename(temporary, join(this.root, "state.json"));
      const directory = await open(this.root, "r"); try { await directory.sync(); } finally { await directory.close(); }
    } finally { await file.close().catch(() => {}); await unlink(temporary).catch(() => {}); }
  }
  async handle(request: IncomingMessage, response: ServerResponse) {
    response.setHeader("content-type", "application/json; charset=utf-8"); response.setHeader("cache-control", "no-store");
    if (request.method !== "POST") { response.statusCode = 405; response.end(JSON.stringify({ error: "仅支持 POST" })); return; }
    try {
      let size = 0; const parts: Buffer[] = [];
      for await (const chunk of request) { const part = Buffer.from(chunk); size += part.length; if (size > 8192) throw new Error("通知设置请求过大"); parts.push(part); }
      let body: any; try { body = JSON.parse(Buffer.concat(parts).toString("utf8")); } catch { throw new Error("通知设置必须为有效 JSON"); }
      if (!body || !UUID.test(body.clientId ?? "") || typeof body.backendId !== "string" || !body.backendId.trim() || body.backendId.length > 256 || /[\u0000-\u001f\u007f]/.test(body.backendId) || !["system", "bark"].includes(body.mode)) throw new Error("通知设置需要安装 ID、后端 ID 和有效通知方式");
      const subscription: Subscription = { clientId: body.clientId.toLowerCase(), backendId: body.backendId, barkUrl: body.mode === "bark" ? parseBarkPushUrl(body.barkUrl) : "" };
      await this.enqueue(async () => {
        const key = this.key(subscription); const previous = this.subscriptions.get(key);
        if ((body.mode === "bark" && previous?.barkUrl === subscription.barkUrl) || (body.mode === "system" && !previous)) return;
        if (body.mode === "bark" && !previous && this.subscriptions.size >= MAX_SUBSCRIPTIONS) throw new Error("通知订阅数量已满");
        if (body.mode === "system") this.subscriptions.delete(key); else this.subscriptions.set(key, subscription);
        try { await this.save(); } catch (error) { if (previous) this.subscriptions.set(key, previous); else this.subscriptions.delete(key); throw error; }
      });
      response.end(JSON.stringify({ saved: true }));
    } catch (error) { response.statusCode = 400; response.end(JSON.stringify({ error: error instanceof Error ? error.message : "无法保存通知设置" })); }
  }
  private rememberThread(thread: any) {
    this.completions.rememberThread(thread);
    if (typeof thread?.id !== "string" || !thread.id || thread.id.length > 1024) return;
    const title = { ...this.titles.get(thread.id) };
    let changed = false;
    for (const field of ["name", "preview"] as const) {
      if (typeof thread[field] === "string" || thread[field] === null) {
        title[field] = thread[field]?.trim().slice(0, 4096) ?? null;
        changed = true;
      }
    }
    if (!changed) return;
    this.titles.delete(thread.id); this.titles.set(thread.id, title);
    while (this.titles.size > 2048) this.titles.delete(this.titles.keys().next().value!);
  }
  /** RPC 历史只登记标题，不参与实时完成判定。 */
  observeRpc(request: { method?: string; params?: Record<string, any> }, response: { error?: unknown; result?: unknown }) {
    if (this.closed || response.error != null) return;
    const result = response.result as Record<string, any> | undefined;
    this.rememberThread(result?.thread);
    if (request.method === "thread/list" && Array.isArray(result?.data)) {
      for (const thread of result.data) this.rememberThread(thread);
    }
    if (request.method === "thread/name/set") {
      this.rememberThread({ id: request.params?.threadId, name: request.params?.name });
    }
  }
  observe(message: { method?: string; params?: Record<string, any>; id?: unknown }) {
    if (this.closed) return;
    if (message.id == null) {
      if (message.method === "thread/started") this.rememberThread(message.params?.thread);
      if (message.method === "thread/name/updated") this.rememberThread({
        id: message.params?.threadId, name: message.params?.threadName,
      });
    }
    const completed = this.completions.observe(message);
    if (!completed) return;
    const title = this.titles.get(completed.threadId);
    const body = title?.name || title?.preview || "新对话";
    // 不等待网络；磁盘登记成功后才发送，避免跨连接和重启重复通知。
    void this.enqueue(async () => {
      if (this.closed || !this.subscribed) return;
      const metadata = await readLocalThreadMetadata(this.options.codexHome, completed.threadId);
      if (this.closed) return;
      if (metadata && !isVisibleThread(metadata)) {
        this.completions.rememberThread(metadata);
        return;
      }
      for (const subscription of this.subscriptions.values()) {
        const id = createHash("sha256").update(JSON.stringify([subscription.clientId, subscription.backendId, completed.threadId, completed.turnId])).digest("hex");
        if (this.delivered.has(id) || this.jobs.size >= MAX_PENDING_PUSHES) continue;
        this.delivered.add(id);
        while (this.delivered.size > MAX_DEDUPLICATION) this.delivered.delete(this.delivered.values().next().value!);
        try { await this.save(); } catch (error) { this.delivered.delete(id); throw error; }
        const job = this.send(subscription, { title: "Codex 运行结束", body, group: this.options.displayName, url: `codexmobile://thread?backendId=${encodeURIComponent(subscription.backendId)}&threadId=${encodeURIComponent(completed.threadId)}`, id });
        this.jobs.add(job); void job.finally(() => this.jobs.delete(job));
      }
    }).catch(() => {});
  }
  private async send(subscription: Subscription, payload: Record<string, string>) {
    for (let attempt = 0; attempt < 3 && !this.closed; attempt++) {
      if (this.subscriptions.get(this.key(subscription)) !== subscription) return;
      const controller = new AbortController(); this.controllers.add(controller);
      const timeout = setTimeout(() => controller.abort(), 5000); timeout.unref();
      try {
        const response = await (this.options.fetch ?? fetch)(subscription.barkUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload), signal: controller.signal, redirect: "error" });
        void response.body?.cancel().catch(() => {});
        if (response.ok) return;
      } catch { /* Bark 故障不影响会话 RPC。 */ }
      finally { clearTimeout(timeout); this.controllers.delete(controller); }
      if (attempt < 2 && !this.closed) {
        const delay = new AbortController(); this.controllers.add(delay);
        await new Promise<void>((resolve) => { const timer = setTimeout(resolve, 250 * (attempt + 1)); delay.signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true }); });
        this.controllers.delete(delay);
      }
    }
  }
  async close() { this.closed = true; for (const controller of this.controllers) controller.abort(); await this.queue; await Promise.all(this.jobs); }
}
