import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, writeFile, rename, rm, lstat, readdir, open } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";

const execute = promisify(execFile);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Counts = { additions: number; deletions: number; source?: string };
type Entry = { baseline?: string; cwd?: string; trusted?: boolean; completed?: boolean; counts?: Counts };
type Thread = { cwd?: string; pending?: Entry; active?: string; turns: Record<string, Entry> };

async function git(cwd: string, args: string[], index?: string): Promise<string> {
  return (await execute("git", args, { cwd, timeout: 10_000, maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", ...(index ? { GIT_INDEX_FILE: index } : {}) } })).stdout;
}

async function snapshot(cwd: string): Promise<string | undefined> {
  if (!isAbsolute(cwd)) return;
  const temporary = await mkdtemp(join(tmpdir(), "codex-turn-index-"));
  const index = join(temporary, "index");
  try {
    cwd = (await git(cwd, ["rev-parse", "--show-toplevel"])).trim();
    const cached = new Set((await git(cwd, ["ls-files", "--cached", "-z"])).split("\0").filter(Boolean));
    const paths = [...cached, ...(await git(cwd, ["ls-files", "--others", "--exclude-standard", "-z"])).split("\0").filter(Boolean)];
    if (paths.length > 5_000) return;
    const existingCached: string[] = [];
    let bytes = 0;
    for (const path of new Set(paths)) {
      try {
        const info = await lstat(join(cwd, path));
        if (cached.has(path)) existingCached.push(path);
        if (info.isFile()) { bytes += info.size; if (info.size > 16 * 1024 * 1024 || bytes > 64 * 1024 * 1024) return; }
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") return; }
    }
    let head: string | undefined;
    try { head = (await git(cwd, ["rev-parse", "--verify", "HEAD"])).trim(); } catch { /* Unborn repository. */ }
    await git(cwd, head ? ["read-tree", head] : ["read-tree", "--empty"], index);
    await git(cwd, ["add", "-A", "--", "."], index);
    // User index paths are tracked even when HEAD lacks a force-added ignored file.
    // Force only these exact existing paths; ignored untracked files stay excluded.
    for (let offset = 0; offset < existingCached.length; offset += 128) {
      await git(cwd, ["--literal-pathspecs", "add", "-f", "--", ...existingCached.slice(offset, offset + 128)], index);
    }
    return (await git(cwd, ["write-tree"], index)).trim();
  } catch { return; }
  finally { await rm(temporary, { recursive: true, force: true }); }
}

function numstat(output: string): Counts | null {
  let additions = 0; let deletions = 0;
  const records = output.split("\0");
  for (let i = 0; i < records.length; i++) {
    const record = records[i]; if (!record) continue;
    const match = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(record);
    if (!match) return null;
    if (match[1] !== "-" && match[2] !== "-") { additions += Number(match[1]); deletions += Number(match[2]); }
    if (match[3] === "") i += 2; // -z rename records include old and new paths.
  }
  return { additions, deletions };
}

function validCounts(value: unknown): value is Counts {
  const counts = value as Counts | undefined;
  return !!counts && Number.isSafeInteger(counts.additions) && counts.additions >= 0 &&
    Number.isSafeInteger(counts.deletions) && counts.deletions >= 0;
}

// Hunk lengths establish completeness; counting +/- on a truncated patch would under-report.
export function countCompleteDiff(diff: unknown): Counts | null {
  if (typeof diff !== "string" || diff.length > 8 * 1024 * 1024) return null;
  if (diff === "") return { additions: 0, deletions: 0 };
  let additions = 0; let deletions = 0; let oldLeft = 0; let newLeft = 0; let file = false; let complete = false; let textHeader = false; let hasHunk = false;
  const lines = diff.split("\n"); if (diff.endsWith("\n")) lines.pop();
  for (const line of lines) {
    if (oldLeft || newLeft) {
      if (line.startsWith("\\ No newline at end of file")) continue;
      if (line[0] === " ") { oldLeft--; newLeft--; }
      else if (line[0] === "+") { additions++; newLeft--; }
      else if (line[0] === "-") { deletions++; oldLeft--; }
      else return null;
      if (oldLeft < 0 || newLeft < 0) return null;
      continue;
    }
    if (line.startsWith("diff --git ")) {
      if (file && (!complete || (textHeader && !hasHunk))) return null;
      file = true; complete = false; textHeader = false; hasHunk = false; continue;
    }
    if (line.startsWith("--- ") && (!file || hasHunk)) {
      file = true; complete = false; textHeader = true; hasHunk = false;
    }
    const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunk) { file = true; complete = true; hasHunk = true; oldLeft = Number(hunk[2] ?? 1); newLeft = Number(hunk[4] ?? 1); continue; }
    if (!file) return null;
    if (/^(--- |\+\+\+ )/.test(line)) textHeader = true;
    if (/^(new mode |rename to |copy to |Binary files .* differ$)/.test(line) ||
      /^index (?:0+\.\.e69de29[0-9a-f]*|e69de29[0-9a-f]*\.\.0+)(?:\s|$)/.test(line)) complete = true;
    if (/^(index |--- |\+\+\+ |new file mode |deleted file mode |old mode |new mode |similarity index |dissimilarity index |rename from |rename to |copy from |copy to |Binary files .* differ$|\\ No newline at end of file$)/.test(line)) continue;
    return null;
  }
  return oldLeft || newLeft || !complete || (textHeader && !hasHunk) ? null : { additions, deletions };
}

function seconds(value: unknown): number | null {
  const time = typeof value === "number" ? value : typeof value === "string" ? Date.parse(value) / 1000 : NaN;
  return Number.isFinite(time) ? (time > 1e11 ? time / 1000 : time) : null;
}

async function committedCounts(cwd: string, turn: Record<string, any>): Promise<Counts | null> {
  const start = seconds(turn.startedAt); const end = seconds(turn.completedAt);
  if (start === null || end === null || start > end || !Array.isArray(turn.items)) return null;
  const hashes: string[] = [];
  for (const item of turn.items) {
    if (item?.type !== "commandExecution" || item.exitCode !== 0 || (item.status !== undefined && item.status !== "completed") || typeof item.aggregatedOutput !== "string") continue;
    if (item.aggregatedOutput.length > 8 * 1024 * 1024) return null;
    for (const match of item.aggregatedOutput.matchAll(/^\[[^\]\s]{1,200} (?:\(root-commit\) )?([0-9a-f]{7,64})\] [^\r\n]+\r?$/gm)) hashes.push(match[1]);
  }
  if (!hashes.length || hashes.length > 64) return null;
  try {
    const commits: { hash: string; parent?: string }[] = [];
    for (const hash of hashes) {
      const full = (await git(cwd, ["rev-parse", "--verify", `${hash}^{commit}`])).trim();
      if (commits.some((commit) => commit.hash === full)) continue;
      const info = (await git(cwd, ["show", "-s", "--format=%ct%x09%P", full, "--"])).trim().split("\t");
      const timestamp = Number(info[0]); const parents = (info[1] ?? "").split(" ").filter(Boolean);
      if (!Number.isFinite(timestamp) || timestamp < start || timestamp > end || parents.length > 1) return null;
      commits.push({ hash: full, parent: parents[0] });
    }
    for (let i = 1; i < commits.length; i++) {
      // An omitted/interleaved commit could belong to another turn; require the complete parent chain.
      if (commits[i].parent !== commits[i - 1].hash) return null;
      await git(cwd, ["merge-base", "--is-ancestor", commits[i - 1].hash, commits[i].hash]);
    }
    const first = commits[0]; const last = commits[commits.length - 1];
    const base = first.parent ?? (await git(cwd, ["hash-object", "-w", "-t", "tree", "--", "/dev/null"])).trim();
    const counts = numstat(await git(cwd, ["diff", "--numstat", "-z", base, last.hash, "--"]));
    return counts ? { ...counts, source: "git-commit" } : null;
  } catch { return null; }
}

/** One shared instance serializes all notifications for each thread. Git failures are unknown, never zero. */
export class TurnChangeHistory {
  private readonly states = new Map<string, Thread>();
  private readonly queues = new Map<string, Promise<void>>();
  private readonly metadata = new Map<string, Promise<string | undefined>>();
  constructor(private readonly codexHome: string) {}

  private enqueue(threadId: string, action: () => Promise<void>): Promise<void> {
    if (!UUID.test(threadId)) return Promise.resolve();
    const task = (this.queues.get(threadId) ?? Promise.resolve()).then(action).catch(() => {});
    this.queues.set(threadId, task);
    return task;
  }
  private async state(threadId: string): Promise<Thread> {
    let state = this.states.get(threadId);
    if (!state) {
      try {
        const value = JSON.parse(await readFile(join(this.codexHome, "codex-mobile-turn-changes", `${threadId}.json`), "utf8"));
        if (value && value.turns && typeof value.turns === "object" && !Array.isArray(value.turns)) {
          state = { ...value, turns: Object.assign(Object.create(null), value.turns) };
        }
      } catch { /* Missing or invalid cache. */ }
      state ??= { turns: Object.create(null) }; this.states.set(threadId, state);
    }
    return state;
  }
  private localCwd(threadId: string): Promise<string | undefined> {
    let lookup = this.metadata.get(threadId);
    if (!lookup) {
      lookup = this.readLocalCwd(threadId).catch(() => undefined); this.metadata.set(threadId, lookup);
    }
    return lookup;
  }
  private async readLocalCwd(threadId: string): Promise<string | undefined> {
    const directories = [join(this.codexHome, "archived_sessions")];
    if (threadId[14] === "7") {
      const stamp = Number.parseInt(threadId.replaceAll("-", "").slice(0, 12), 16);
      for (const offset of [0, -86_400_000, 86_400_000]) {
        const date = new Date(stamp + offset);
        for (const utc of [false, true]) {
          const year = utc ? date.getUTCFullYear() : date.getFullYear();
          const month = (utc ? date.getUTCMonth() : date.getMonth()) + 1;
          const day = utc ? date.getUTCDate() : date.getDate();
          directories.push(join(this.codexHome, "sessions", String(year), String(month).padStart(2, "0"), String(day).padStart(2, "0")));
        }
      }
    }
    for (const directory of new Set(directories)) {
      let names: string[];
      try { names = await readdir(directory); } catch { continue; }
      if (names.length > 10_000) continue;
      for (const name of names) {
        if (!name.startsWith("rollout-") || !name.endsWith(`-${threadId}.jsonl`)) continue;
        const file = await open(join(directory, name), "r");
        try {
          const buffer = Buffer.alloc(64 * 1024); const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
          const text = buffer.subarray(0, bytesRead).toString("utf8");
          for (const line of text.split("\n").slice(0, -1)) {
            try {
              const record = JSON.parse(line);
              if (record?.type === "session_meta" && record.payload?.id === threadId &&
                typeof record.payload.cwd === "string" && isAbsolute(record.payload.cwd)) return record.payload.cwd;
            } catch { /* Malformed rollout metadata is not trusted. */ }
          }
        } finally { await file.close(); }
      }
    }
    return undefined;
  }
  private async save(threadId: string, state: Thread): Promise<void> {
    const directory = join(this.codexHome, "codex-mobile-turn-changes");
    await mkdir(directory, { recursive: true });
    const path = join(directory, `${threadId}.json`); const temporary = `${path}.${randomUUID()}.tmp`;
    try { await writeFile(temporary, JSON.stringify(state)); await rename(temporary, path); }
    finally { await rm(temporary, { force: true }); }
  }
  async beforeStart(threadId: string, cwd?: string): Promise<void> {
    await this.enqueue(threadId, async () => {
      const state = await this.state(threadId);
      if (cwd && isAbsolute(cwd)) state.cwd = cwd;
      state.cwd ??= await this.localCwd(threadId);
      if (!state.pending) state.pending = { cwd: state.cwd, trusted: true,
        baseline: state.cwd ? await snapshot(state.cwd) : undefined };
      await this.save(threadId, state);
    });
  }
  async cancelStart(threadId: string): Promise<void> {
    await this.enqueue(threadId, async () => {
      const state = await this.state(threadId); state.pending = undefined; await this.save(threadId, state);
    });
  }
  observe(message: { method?: string; params?: Record<string, any>; result?: unknown }): void {
    if (!["thread/started", "turn/started", "turn/completed", "turn/diff/updated"].includes(message.method ?? "")) return;
    const params = message.params; if (!params) return;
    const threadId = params.threadId ?? params.thread?.id;
    if (typeof threadId !== "string") return;
    void this.enqueue(threadId, async () => {
      const state = await this.state(threadId);
      if (message.method === "thread/started") {
        const cwd = params.thread?.cwd ?? params.cwd;
        if (typeof cwd === "string" && isAbsolute(cwd)) state.cwd = cwd;
      }
      const id = params.turn?.id ?? params.turnId;
      if (typeof id === "string" && id.length > 0 && id.length <= 200) {
        if (message.method === "turn/started" && !Object.hasOwn(state.turns, id)) {
          state.cwd ??= await this.localCwd(threadId);
          const entry = state.pending ?? { cwd: state.cwd, trusted: false,
            baseline: state.cwd ? await snapshot(state.cwd) : undefined };
          state.turns[id] = entry; state.pending = undefined; state.active = id;
        }
        if (message.method === "turn/diff/updated") {
          const counts = countCompleteDiff(params.diff);
          const entry = state.turns[id] ??= { cwd: state.cwd, trusted: false };
          if (!entry.completed && entry.counts?.source !== "git-snapshot") {
            entry.counts = counts ? { ...counts, source: "live-diff" } : undefined;
          }
        }
        if (message.method === "turn/completed") {
          const entry = state.turns[id];
          if (entry && !entry.completed) {
            entry.completed = true;
            if (entry.trusted && entry.baseline && entry.cwd) {
              const after = await snapshot(entry.cwd);
              if (after) { const counts = numstat(await git(entry.cwd, ["diff", "--numstat", "-z", entry.baseline, after, "--"]));
                if (counts) entry.counts = { ...counts, source: "git-snapshot" }; }
            }
            if (state.active === id) state.active = undefined;
          }
        }
      }
      await this.save(threadId, state);
    });
  }
  async get(threadId: string, turn: Record<string, any>): Promise<Counts | null> {
    if (!UUID.test(threadId) || typeof turn.id !== "string" || !turn.id || turn.id.length > 200) return null;
    let result: Counts | null = null;
    await this.enqueue(threadId, async () => {
      const state = await this.state(threadId);
      const counts = state.turns[turn.id]?.counts;
      if (validCounts(counts)) { result = counts; return; }
      const raw = countCompleteDiff(turn.diff ?? turn.liveDiff);
      if (raw) result = { ...raw, source: "live-diff" };
      else {
        state.cwd ??= await this.localCwd(threadId);
        if (state.cwd) result = await committedCounts(state.cwd, turn);
      }
      if (result) {
        const entry = state.turns[turn.id] ??= { cwd: state.cwd, trusted: false };
        entry.counts = result; await this.save(threadId, state);
      }
    });
    return result;
  }
  async flush(): Promise<void> {
    while (true) {
      const tasks = [...this.queues.values()]; await Promise.all(tasks);
      if (tasks.length === this.queues.size && tasks.every((task, i) => task === [...this.queues.values()][i])) return;
    }
  }
}
