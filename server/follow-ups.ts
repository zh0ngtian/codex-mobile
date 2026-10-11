import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink, chmod } from "node:fs/promises";
import { join, dirname } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { HttpSessions, type RpcMessage } from "./http-session.js";

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const MAX_REQUEST_BYTES = 16 * 1024 * 1024;
const MAX_STORAGE_BYTES = 64 * 1024 * 1024;
const MAX_ITEMS = 128;
const MAX_RECORDS = 65_536;
type Input = Record<string, unknown>;
type State = "queued" | "sending" | "failed" | "uncertain" | "sent" | "cancelled";
type RecordItem = {
  id: string; fingerprint: string; threadId: string; state: State; revision: number;
  inputText?: string; text?: string; attachmentCount?: number; extraInput?: Input[]; settings?: Input;
  operationId: string; restoreState?: "queued" | "failed"; method?: "turn/start" | "turn/steer"; error?: string;
};
class QueueError extends Error { constructor(public status: number, message: string) { super(message); } }
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return "{" + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",") + "}";
  return JSON.stringify(value) ?? "null";
}
const visible = (item: RecordItem) => item.state !== "sent" && item.state !== "cancelled";
const object = (value: unknown): value is Input => !!value && typeof value === "object" && !Array.isArray(value);
const rpcFailure = (error: unknown, fallback: string) => {
  const message = String((error as any)?.message ?? fallback);
  return new QueueError(/not found|does not exist|unknown thread|archived|不存在|已归档/i.test(message) ? 404 : 503, message);
};
const errorText = (error: unknown) => error instanceof Error ? error.message : "追问发送失败";
function validateText(inputText: unknown, text: unknown) {
  if (typeof inputText !== "string" || typeof text !== "string" || inputText.length > 32_768 || text.length > 32_768) throw new QueueError(400, "追问正文或预览无效");
}
function validateInputs(input: unknown, mentions = false): asserts input is Input[] {
  if (!Array.isArray(input) || input.length > 128) throw new QueueError(400, "追问附件或引用无效");
  for (const item of input) {
    if (!object(item)) throw new QueueError(400, "追问输入无效");
    if (["skill", "mention"].includes(String(item.type))) {
      if (typeof item.name !== "string" || typeof item.path !== "string" || !item.path || item.path.length > 8192) throw new QueueError(400, "追问引用无效");
    } else if (mentions) throw new QueueError(400, "编辑只允许修改技能或插件引用");
    else if (item.type === "image") { if (typeof item.url !== "string" || !item.url) throw new QueueError(400, "图片无效"); }
    else if (item.type === "localImage") { if (typeof item.path !== "string" || !item.path) throw new QueueError(400, "图片路径无效"); }
    else if (item.type === "text") { if (typeof item.text !== "string" || !item.text) throw new QueueError(400, "文件输入无效"); }
    else throw new QueueError(400, "不支持的追问输入类型");
  }
}
function validateSettings(settings: unknown): asserts settings is Input {
  if (!object(settings)) throw new QueueError(400, "追问设置无效");
  const keys = new Set(["model", "effort", "serviceTier", "permissions", "approvalPolicy", "approvalsReviewer"]);
  for (const [key, value] of Object.entries(settings)) {
    if (!keys.has(key) || (value !== null && typeof value !== "string" && !(["permissions", "approvalPolicy"].includes(key) && object(value)))) throw new QueueError(400, "不支持的追问设置");
  }
}

/** Gateway-owned global queue. Both API mutations and state transitions commit by fsync before acknowledgement. */
export class FollowUps {
  private records: RecordItem[] = [];
  private serial: Promise<unknown> = Promise.resolve();
  private workers = new Map<string, Promise<void>>();
  private timer?: NodeJS.Timeout;
  private closed = false;
  private resumed = new Map<string, string>();
  private eligible = new Map<string, number>();
  private unsubscribe?: () => void;
  private manualSends = new Set<string>();
  private actions = new Set<Promise<unknown>>();
  private constructor(private directory: string, private sessions: HttpSessions) {}

  static async open(codexHome: string, sessions: HttpSessions) {
    const queue = new FollowUps(join(codexHome, "codex-mobile-follow-ups"), sessions);
    try {
      const data = JSON.parse(await readFile(join(queue.directory, "queue.json"), "utf8"));
      if (data.version !== 1 || !Array.isArray(data.records)) throw new Error("Invalid follow-up storage");
      queue.records = data.records;
      for (const item of queue.records) if (!UUID.test(item.id) || !UUID.test(item.operationId) || !["queued", "sending", "failed", "uncertain", "sent", "cancelled"].includes(item.state) || typeof item.threadId !== "string") throw new Error("Invalid follow-up record");
    } catch (error: any) { if (error.code !== "ENOENT") throw error; }
    queue.unsubscribe = sessions.subscribeHosted((message) => {
      if (message.method === "turn/completed" || (message.method === "thread/status/changed" && ["idle", "notLoaded", "systemError"].includes(String(message.params?.status?.type ?? message.params?.status)))) {
        queue.eligible.delete(String(message.params?.threadId ?? "")); queue.tick();
      }
    });
    queue.timer = setInterval(() => queue.tick(), 250); queue.timer.unref(); queue.tick();
    return queue;
  }

  private list() {
    return { items: this.records.filter(visible).map((item) => ({ id: item.id, threadId: item.threadId, inputText: item.inputText, text: item.text, attachmentCount: item.attachmentCount, state: item.state, revision: item.revision, ...(item.error ? { error: item.error } : {}) })) };
  }
  private lock<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.serial.then(fn); this.serial = next.catch(() => {}); return next;
  }
  private async persist(records: RecordItem[]) {
    const data = JSON.stringify({ version: 1, records });
    if (Buffer.byteLength(data) > MAX_STORAGE_BYTES || records.length > MAX_RECORDS) throw new QueueError(507, "追问持久化存储已满");
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await chmod(this.directory, 0o700);
    const temporary = join(this.directory, `${randomUUID()}.tmp`);
    try {
      const file = await open(temporary, "wx", 0o600);
      try { await file.writeFile(data); await file.sync(); } finally { await file.close(); }
      await rename(temporary, join(this.directory, "queue.json"));
      const directory = await open(this.directory, "r"); try { await directory.sync(); } finally { await directory.close(); }
      const parent = await open(dirname(this.directory), "r"); try { await parent.sync(); } finally { await parent.close(); }
      this.records = records;
    } finally { await unlink(temporary).catch(() => {}); }
  }
  private async transition(id: string, update: (item: RecordItem) => RecordItem) {
    return this.lock(async () => {
      const index = this.records.findIndex((item) => item.id === id); if (index < 0) throw new QueueError(404, "追问不存在");
      const next = [...this.records]; next[index] = update(next[index]); await this.persist(next); return next[index];
    });
  }
  private finish(item: RecordItem, response: RpcMessage): RecordItem {
    if (response.error != null) return { ...item, state: "failed", revision: item.revision + 1, error: String((response.error as any)?.message ?? "追问发送失败") };
    // Keep the original fingerprint and operation identity indefinitely for enqueue/recovery idempotency.
    return { id: item.id, fingerprint: item.fingerprint, threadId: item.threadId, state: "sent", revision: item.revision + 1, operationId: item.operationId, method: item.method };
  }
  private async recover(item: RecordItem) {
    try {
      const operation = await this.sessions.hostedOperation(item.operationId);
      await this.transition(item.id, (current) => operation.status === "completed" && operation.message
        ? this.finish(current, operation.message)
        : { ...current, state: "uncertain", revision: current.revision + 1, error: "发送结果待确认，请检查会话，勿重复发送" });
    } catch (error: any) {
      if (error.status === 404) await this.transition(item.id, (current) => ({ ...current, state: current.method === "turn/steer" ? current.restoreState ?? "failed" : "queued", restoreState: undefined, revision: current.revision + 1, method: undefined, error: undefined }));
      // Storage unavailable is not proof of absence: leave sending and retry lookup only.
    }
  }
  private tick() {
    if (this.closed) return;
    const threads = new Set<string>();
    for (const item of this.records) {
      if (!visible(item) || threads.has(item.threadId)) continue;
      threads.add(item.threadId);
      if ((this.eligible.get(item.threadId) ?? 0) > Date.now() || this.workers.has(item.threadId) || this.manualSends.has(item.id) || !["queued", "sending"].includes(item.state)) continue;
      const worker = this.dispatch(item).catch(() => {}).finally(() => { this.workers.delete(item.threadId); });
      this.workers.set(item.threadId, worker);
    }
  }
  private async inspect(threadId: string, needTurn = false) {
    const epoch = await this.sessions.hostedReady();
    if (this.resumed.get(threadId) !== epoch) {
      const response = await this.sessions.hostedRpc({ id: randomUUID(), method: "thread/resume", params: { threadId, excludeTurns: true, initialTurnsPage: { limit: 1, itemsView: "summary" } } });
      if (response.error != null) throw rpcFailure(response.error, "无法恢复会话");
      this.resumed.set(threadId, epoch);
    }
    const read = await this.sessions.hostedRpc({ id: randomUUID(), method: "thread/read", params: { threadId, includeTurns: false } });
    if (read.error != null) throw rpcFailure(read.error, "无法读取会话");
    const thread = (read.result as any)?.thread;
    if (!thread || thread.id !== threadId) throw new QueueError(503, "无法确认会话运行状态");
    const status = thread.status?.type ?? thread.status;
    if (["idle", "notLoaded", "systemError"].includes(status)) return { active: false, turnId: undefined };
    if (status === "active" && !needTurn) return { active: true, turnId: undefined };
    const turns = await this.sessions.hostedRpc({ id: randomUUID(), method: "thread/turns/list", params: { threadId, limit: 1, sortDirection: "desc", itemsView: "summary" } });
    if (turns.error != null || !Array.isArray((turns.result as any)?.data)) throw new QueueError(503, "无法确认运行回合");
    const turn = (turns.result as any).data.find((entry: any) => ["inProgress", "in_progress", "running"].includes(entry.status));
    return { active: status === "active" || !!turn, turnId: turn?.id as string | undefined };
  }
  private input(item: RecordItem) {
    return [...(item.inputText ? [{ type: "text", text: item.inputText, text_elements: [] }] : []), ...(item.extraInput ?? [])];
  }
  private async send(item: RecordItem, turnId?: string) {
    const method = turnId ? "turn/steer" : "turn/start";
    const response = await this.sessions.hostedRpc({ id: item.operationId, method, params: {
      threadId: item.threadId, input: this.input(item), ...(turnId ? { expectedTurnId: turnId, clientUserMessageId: item.id } : item.settings),
    } }, item.operationId);
    await this.transition(item.id, (current) => this.finish(current, response));
    if (response.error != null) throw new QueueError(502, String((response.error as any)?.message ?? "追问发送失败"));
    return (response.result as any)?.turnId ?? (response.result as any)?.turn?.id ?? turnId;
  }
  private async sendingFailure(item: RecordItem, error: unknown) {
    // A pre-send failure leaves no operation; only that proof permits a future automatic attempt.
    try {
      const operation = await this.sessions.hostedOperation(item.operationId);
      await this.transition(item.id, (current) => operation.status === "completed" && operation.message ? this.finish(current, operation.message)
        : { ...current, state: "uncertain", revision: current.revision + 1, error: "发送结果待确认，请检查会话，勿重复发送" });
    } catch (lookup: any) {
      await this.transition(item.id, (current) => ({ ...current, state: lookup.status === 404 ? item.method === "turn/steer" ? item.restoreState ?? "failed" : "queued" : "uncertain", restoreState: undefined, revision: current.revision + 1, error: errorText(error) }));
    }
  }
  private async dispatch(snapshot: RecordItem) {
    if (snapshot.state === "sending") { await this.recover(snapshot); return; }
    let status: { active: boolean; turnId?: string };
    try { status = await this.inspect(snapshot.threadId); } catch (error) {
      if (error instanceof QueueError && error.status === 404) await this.transition(snapshot.id, (current) => {
        if (current.state !== "queued" || current.revision !== snapshot.revision) return current;
        return { ...current, state: "failed", revision: current.revision + 1, error: error.message };
      });
      else this.eligible.set(snapshot.threadId, Date.now() + 2000);
      return;
    } // queued + offline: reconnect on next tick
    if (status.active || this.closed) { this.eligible.set(snapshot.threadId, Date.now() + 2000); return; }
    let item: RecordItem;
    try {
      item = await this.transition(snapshot.id, (current) => {
        if (current.state !== "queued" || current.revision !== snapshot.revision) throw new QueueError(409, "追问已变更");
        return { ...current, state: "sending", method: "turn/start", revision: current.revision + 1, error: undefined };
      });
    } catch { return; }
    try { await this.send(item); } catch (error) { await this.sendingFailure(item, error); }
  }

  private async mutate(body: any): Promise<{ items: any[]; turnId?: string }> {
    if (!object(body) || !UUID.test(String(body.id ?? ""))) throw new QueueError(400, "追问 ID 必须为 UUID");
    if (body.action === "enqueue") {
      validateText(body.inputText, body.text); validateInputs(body.extraInput); validateSettings(body.settings);
      if (typeof body.threadId !== "string" || !body.threadId.trim() || body.threadId.length > 256) throw new QueueError(400, "会话 ID 无效");
      const count = body.extraInput.filter((entry) => ["image", "localImage", "text"].includes(String(entry.type))).length;
      if (body.attachmentCount !== count) throw new QueueError(400, "附件数量与输入不一致");
      if (!(body.inputText as string).trim() && !body.extraInput.length) throw new QueueError(400, "追问不能为空");
      const content = { threadId: body.threadId, inputText: body.inputText as string, text: body.text as string, attachmentCount: count, extraInput: body.extraInput, settings: body.settings };
      const fingerprint = createHash("sha256").update(canonical(content)).digest("hex");
      return this.lock(async () => {
        if (this.closed) throw new QueueError(503, "追问队列已关闭");
        const existing = this.records.find((item) => item.id === body.id);
        if (existing) { if (existing.fingerprint !== fingerprint) throw new QueueError(409, "追问 ID 已被不同内容使用"); return this.list(); }
        if (this.records.filter(visible).length >= MAX_ITEMS) throw new QueueError(429, "追问队列已满");
        await this.persist([...this.records, { ...content, id: String(body.id), fingerprint, state: "queued", revision: 1, operationId: randomUUID() }]);
        return this.list();
      });
    }
    if (!["edit", "cancel", "retry", "steer"].includes(String(body.action))) throw new QueueError(400, "不支持的追问操作");
    if (!Number.isSafeInteger(body.revision)) throw new QueueError(400, "追问 revision 无效");
    if (body.action === "edit") { validateText(body.inputText, body.text); validateInputs(body.mentions, true); }
    let prior: RecordItem | undefined;
    const item = await this.transition(String(body.id), (current) => {
      if (this.closed) throw new QueueError(503, "追问队列已关闭");
      if (!visible(current) || current.revision !== body.revision || current.state === "sending" || (current.state === "uncertain" && body.action !== "cancel")) throw new QueueError(409, "追问状态或版本已变更，请刷新后重试");
      const revision = current.revision + 1;
      if (body.action === "cancel") return { ...current, state: "cancelled", revision, extraInput: undefined, settings: undefined, inputText: undefined, text: undefined };
      if (body.action === "edit") {
        const extraInput = [...(current.extraInput ?? []).filter((entry) => !["skill", "mention"].includes(String(entry.type))), ...(body.mentions as Input[])];
        if (!(body.inputText as string).trim() && !extraInput.length) throw new QueueError(400, "追问不能为空");
        return { ...current, revision, inputText: body.inputText as string, text: body.text as string, extraInput };
      }
      if (body.action === "retry") {
        if (current.state !== "failed") throw new QueueError(409, "只能重试失败追问");
        return { ...current, revision, state: "queued", error: undefined, operationId: randomUUID(), method: undefined };
      }
      prior = current; this.manualSends.add(current.id);
      return { ...current, revision, state: "sending", operationId: randomUUID(), restoreState: current.state as "queued" | "failed", method: "turn/steer", error: undefined };
    }).catch((error) => { if (body.action === "steer") this.manualSends.delete(String(body.id)); throw error; });
    this.eligible.delete(item.threadId);
    if (body.action !== "steer") return this.list();
    let submitting = false;
    try {
      const status = await this.inspect(item.threadId, true);
      if (!status.turnId) throw new QueueError(409, "当前会话没有可插入的运行回合");
      submitting = true;
      const turnId = await this.send(item, status.turnId); return { ...this.list(), turnId };
    } catch (error) {
      if (!submitting && prior) await this.transition(item.id, (current) => ({ ...prior!, revision: current.revision + 1, error: errorText(error) }));
      else await this.sendingFailure(item, error);
      throw error;
    } finally { this.manualSends.delete(item.id); }
  }
  async handle(request: IncomingMessage, response: ServerResponse) {
    response.setHeader("content-type", "application/json; charset=utf-8"); response.setHeader("cache-control", "no-store");
    try {
      let result: unknown;
      if (request.method === "GET") { await this.serial; result = this.list(); }
      else if (request.method === "POST") {
        const chunks: Buffer[] = []; let bytes = 0;
        for await (const chunk of request) { const part = Buffer.from(chunk); bytes += part.length; if (bytes <= MAX_REQUEST_BYTES) chunks.push(part); }
        if (bytes > MAX_REQUEST_BYTES) throw new QueueError(413, "追问请求超过 16 MiB");
        let body: unknown; try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new QueueError(400, "JSON 无效"); }
        const action = this.mutate(body); this.actions.add(action);
        try { result = await action; } finally { this.actions.delete(action); }
      } else throw new QueueError(405, "不支持的请求方法");
      response.end(JSON.stringify(result));
    } catch (error) {
      response.statusCode = error instanceof QueueError ? error.status : 503;
      response.end(JSON.stringify({ error: { message: errorText(error) } }));
    }
  }
  async close() {
    if (this.closed) return;
    this.closed = true; clearInterval(this.timer); this.unsubscribe?.();
    await Promise.allSettled([...this.workers.values(), ...this.actions]); await this.serial;
  }
}
