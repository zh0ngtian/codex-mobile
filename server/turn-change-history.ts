import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, writeFile, rename, rm, lstat, readdir, open } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, isAbsolute, posix, win32 } from "node:path";
import { randomUUID } from "node:crypto";
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { RemoteCommands, decodeRemoteCommandText } from './remote/commands.js';
import { RemoteRpcSession } from './remote/rpc-session.js';
import { runRemoteCleanup } from './remote/operation-guard.js';
import type { RemoteRolloutSource } from './rollout-source.js';

const execute = promisify(execFile);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Counts = { additions: number; deletions: number; source?: string };
type Entry = { baseline?: string; cwd?: string; trusted?: boolean; completed?: boolean; counts?: Counts };
type Thread = { cwd?: string; pending?: Entry; active?: string; turns: Record<string, Entry> };
export interface RemoteTurnChangeSource {
  session: RemoteRpcSession; commands: RemoteCommands; rollouts: RemoteRolloutSource; gatewayId: string; signal?: AbortSignal;
}
// 专用Git业务代码；普通目标权限、每条Git命令10秒/8MiB，与Local相同。
// snapshot只写自有临时index与原有Git对象库，不读取或替换用户index。
const REMOTE_GIT_PYTHON = String.raw`import base64,hashlib,json,os,re,shutil,signal,stat,subprocess,sys,tempfile,threading,time
q=json.loads(sys.argv[1]);deadline=time.monotonic()+q['timeout']/1000
def terminated(signum,frame):raise SystemExit(1)
if hasattr(signal,'SIGTERM'):signal.signal(signal.SIGTERM,terminated)
class GitFailure(Exception):
    def __init__(self,code,stderr):self.code=code;self.stderr=stderr
def git(cwd,args,index=None):
    env=os.environ.copy();env['GIT_OPTIONAL_LOCKS']='0'
    if index is not None: env['GIT_INDEX_FILE']=index
    remaining=min(10,deadline-time.monotonic())
    if remaining<=0: raise TimeoutError()
    gitDeadline=time.monotonic()+remaining
    p=subprocess.Popen(['git']+args,cwd=cwd,env=env,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    outputs=[bytearray(),bytearray()];bad=threading.Event()
    def capture(i,pipe):
        try:
            while True:
                b=pipe.read1(min(16384,8388609-len(outputs[i])))
                if not b: break
                outputs[i].extend(b)
                if len(outputs[i])>8388608: bad.set();p.kill();break
        except OSError: bad.set()
    threads=[threading.Thread(target=capture,args=(i,pipe),daemon=True) for i,pipe in enumerate([p.stdout,p.stderr])]
    for t in threads:t.start()
    try: p.wait(timeout=remaining)
    except BaseException: p.kill();p.wait();raise
    finally:
        for t in threads:t.join(timeout=max(0,gitDeadline-time.monotonic()))
    if bad.is_set() or any(t.is_alive() for t in threads): raise RuntimeError()
    if p.returncode: raise GitFailure(p.returncode,bytes(outputs[1]))
    return bytes(outputs[0])
def snapshot():
    cwd=git(q['cwd'],['rev-parse','--show-toplevel']).decode('utf-8').strip()
    cached=set(filter(None,git(cwd,['ls-files','--cached','-z']).decode('utf-8').split('\0')))
    paths=list(cached)+list(filter(None,git(cwd,['ls-files','--others','--exclude-standard','-z']).decode('utf-8').split('\0')))
    if len(paths)>5000:return None
    existing=[];size=0
    for path in set(paths):
        try: info=os.lstat(os.path.join(cwd,path))
        except FileNotFoundError: continue
        if path in cached:existing.append(path)
        if stat.S_ISREG(info.st_mode):
            size+=info.st_size
            if info.st_size>16777216 or size>67108864:return None
    temporary=owned_directory()
    try:
        os.mkdir(temporary,0o700)
        index=os.path.join(temporary,'index')
        try:head=git(cwd,['rev-parse','--verify','HEAD']).decode('ascii').strip()
        except GitFailure as e:
            if e.code!=128 or b'Needed a single revision' not in e.stderr:raise
            ref=git(cwd,['symbolic-ref','-q','HEAD']).decode('utf-8').strip()
            if not ref.startswith('refs/heads/'):raise
            try:git(cwd,['show-ref','--verify','--quiet',ref])
            except GitFailure as missing:
                if missing.code!=1 or missing.stderr:raise
            else:raise
            head=None
        git(cwd,['read-tree',head] if head else ['read-tree','--empty'],index)
        git(cwd,['add','-A','--','.'],index)
        for offset in range(0,len(existing),128):git(cwd,['--literal-pathspecs','add','-f','--']+existing[offset:offset+128],index)
        return git(cwd,['write-tree'],index).decode('ascii').strip()
    finally:
        if os.path.isdir(temporary):shutil.rmtree(temporary)
def owned_directory():
    if not re.fullmatch(r'[a-f0-9-]{36}',q['operation']):raise ValueError()
    return os.path.join(tempfile.gettempdir(),'codex-turn-index-'+q['operation'])
try:
    if q['mode']=='cleanup':
        path=owned_directory()
        if os.path.exists(path):shutil.rmtree(path)
        print(json.dumps(dict(cleaned=True)))
    elif q['mode']=='snapshot': print(json.dumps(dict(tree=snapshot())))
    else:
        args=q['args']
        if args[0] not in ['rev-parse','show','merge-base','hash-object','diff']:raise ValueError()
        if args[0]=='hash-object' and args[-1]=='/dev/null':args[-1]=os.devnull
        raw=git(q['cwd'],args)
        print(json.dumps(dict(total=len(raw),offset=q['offset'],sha256=hashlib.sha256(raw).hexdigest(),base64=base64.b64encode(raw[q['offset']:q['offset']+1048576]).decode('ascii'))))
except Exception:print(json.dumps(dict(error='git')))
`;

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

async function committedCounts(cwd: string, turn: Record<string, any>, runGit = git): Promise<Counts | null> {
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
      const full = (await runGit(cwd, ["rev-parse", "--verify", `${hash}^{commit}`])).trim();
      if (commits.some((commit) => commit.hash === full)) continue;
      const info = (await runGit(cwd, ["show", "-s", "--format=%ct%x09%P", full, "--"])).trim().split("\t");
      const timestamp = Number(info[0]); const parents = (info[1] ?? "").split(" ").filter(Boolean);
      if (!Number.isFinite(timestamp) || timestamp < start || timestamp > end || parents.length > 1) return null;
      commits.push({ hash: full, parent: parents[0] });
    }
    for (let i = 1; i < commits.length; i++) {
      // An omitted/interleaved commit could belong to another turn; require the complete parent chain.
      if (commits[i].parent !== commits[i - 1].hash) return null;
      await runGit(cwd, ["merge-base", "--is-ancestor", commits[i - 1].hash, commits[i].hash]);
    }
    const first = commits[0]; const last = commits[commits.length - 1];
    const base = first.parent ?? (await runGit(cwd, ["hash-object", "-w", "-t", "tree", "--", "/dev/null"])).trim();
    const counts = numstat(await runGit(cwd, ["diff", "--numstat", "-z", base, last.hash, "--"]));
    return counts ? { ...counts, source: "git-commit" } : null;
  } catch { return null; }
}

/** One shared instance serializes all notifications for each thread. Git failures are unknown, never zero. */
export class TurnChangeHistory {
  private readonly states = new Map<string, Thread>();
  private readonly queues = new Map<string, Promise<void>>();
  private readonly metadata = new Map<string, Promise<string | undefined>>();
  private readonly directory: string;
  private readonly paths: typeof posix;
  constructor(private readonly codexHome: string, private readonly remote?: RemoteTurnChangeSource) {
    if (remote) {
      if (!(remote.session instanceof RemoteRpcSession) || !(remote.commands instanceof RemoteCommands)) throw new Error('Remote Git来源无效');
      remote.rollouts.assertBinding(remote.session, remote.commands, remote.gatewayId);
    }
    this.directory = join(codexHome, 'codex-mobile-turn-changes', ...(remote ? ['remote', remote.rollouts.namespace] : []));
    this.paths = remote?.commands.metadata.platformFamily === 'windows' ? win32 : posix;
  }
  private absolute(cwd: string): boolean {
    if (!this.remote) return isAbsolute(cwd);
    return this.paths === win32 ? /^(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+(?:[\\/]|$))/.test(cwd) : posix.isAbsolute(cwd);
  }
  private async remoteCall(request: Record<string, unknown>, deadline: number, cleanup = false): Promise<Record<string, any>> {
    const source = this.remote!; source.rollouts.assertBinding(source.session, source.commands, source.gatewayId);
    const binding = source.commands.fileTransportBinding(source.session); const remaining = Math.floor(deadline - performance.now());
    if (remaining < 1) throw new Error('Remote Git读取超时');
    const result = await source.commands.execute({ argv: [binding.python, '-I', '-c', REMOTE_GIT_PYTHON, JSON.stringify({ ...request, timeout: remaining })],
      cwd: binding.metadata.codexHome, timeoutMs: remaining, stdoutBytesCap: 2 * 1024 * 1024, stderrBytesCap: 16384, signal: cleanup ? undefined : source.signal });
    if (result.exitCode !== 0 || result.stderr.length) throw new Error('Remote Git执行失败');
    const value = JSON.parse(decodeRemoteCommandText(result.stdout));
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.error) throw new Error('Remote Git执行失败');
    return value;
  }
  private async git(cwd: string, args: string[]): Promise<string> {
    if (!this.remote) return git(cwd, args);
    const deadline = performance.now() + 10000; const parts: Buffer[] = []; const digest = createHash('sha256'); let offset = 0; let signature: string | undefined;
    for (;;) {
      const value = await this.remoteCall({ mode: 'git', cwd, args, offset }, deadline);
      if (!Number.isSafeInteger(value.total) || value.total < offset || value.total > 8 * 1024 * 1024 || value.offset !== offset || typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256) || typeof value.base64 !== 'string') throw new Error('Remote Git响应无效');
      const current = JSON.stringify([value.total, value.sha256]); if (signature !== undefined && current !== signature) throw new Error('Remote Git读取期间已变化'); signature = current;
      const bytes = Buffer.from(value.base64, 'base64'); if (bytes.length !== Math.min(1048576, value.total - offset) || bytes.toString('base64') !== value.base64) throw new Error('Remote Git响应无效');
      parts.push(bytes); digest.update(bytes); offset += bytes.length;
      if (offset === value.total) { if (digest.digest('hex') !== value.sha256) throw new Error('Remote Git校验失败'); return decodeRemoteCommandText(Buffer.concat(parts)); }
    }
  }
  private async snapshot(cwd: string): Promise<string | undefined> {
    if (!this.remote) return snapshot(cwd);
    if (!this.absolute(cwd)) return;
    const operation = randomUUID(); let completed = false;
    try {
      const value = await this.remoteCall({ mode: 'snapshot', cwd, operation }, performance.now() + 180000);
      if (value.tree === null) { completed = true; return; }
      if (typeof value.tree !== 'string' || !/^[a-f0-9]{40,64}$/.test(value.tree)) throw new Error('Remote Git快照响应无效');
      completed = true; return value.tree;
    } finally {
      // Commands已负责终止自有命令组；再用不可猜测的自有名字清理被强制终止时未运行的Python finally。
      if (!completed && this.remote.session.ready) await runRemoteCleanup(() => this.remoteCall({ mode: 'cleanup', operation }, performance.now() + 1000, true)).catch(() => {});
    }
  }

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
        const value = JSON.parse(await readFile(join(this.directory, `${threadId}.json`), "utf8"));
        if (value && value.turns && typeof value.turns === "object" && !Array.isArray(value.turns)) {
          state = { ...value, turns: Object.assign(Object.create(null), value.turns) };
        }
      } catch { /* Missing or invalid cache. */ }
      state ??= { turns: Object.create(null) }; this.states.set(threadId, state);
    }
    return state;
  }
  private async remoteCwd(threadId: string): Promise<string | undefined> {
    const source = this.remote!; source.rollouts.assertBinding(source.session, source.commands, source.gatewayId);
    const read = source.rollouts.begin(source.signal);
    for await (const path of read.files(threadId)) {
      let cwd: string | undefined;
      for await (const part of read.project(path, threadId, 'cwd', [])) {
        if ('reset' in part) cwd = undefined;
        else if (part.value.id === threadId && typeof part.value.cwd === 'string' && this.absolute(part.value.cwd)) cwd = part.value.cwd;
      }
      if (cwd) return cwd;
    }
  }
  private localCwd(threadId: string): Promise<string | undefined> {
    if (this.remote) return this.remoteCwd(threadId);
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
    const directory = this.directory;
    await mkdir(directory, { recursive: true });
    const path = join(directory, `${threadId}.json`); const temporary = `${path}.${randomUUID()}.tmp`;
    try { await writeFile(temporary, JSON.stringify(state)); await rename(temporary, path); }
    finally { await rm(temporary, { force: true }); }
  }
  async beforeStart(threadId: string, cwd?: string): Promise<void> {
    await this.enqueue(threadId, async () => {
      const state = await this.state(threadId);
      if (!this.remote && cwd && isAbsolute(cwd)) state.cwd = cwd;
      state.cwd ??= await this.localCwd(threadId);
      if (!state.pending) state.pending = { cwd: state.cwd, trusted: true,
        baseline: state.cwd ? await this.snapshot(state.cwd) : undefined };
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
        if (!this.remote && typeof cwd === "string" && isAbsolute(cwd)) state.cwd = cwd;
      }
      const id = params.turn?.id ?? params.turnId;
      if (typeof id === "string" && id.length > 0 && id.length <= 200) {
        if (message.method === "turn/started" && !Object.hasOwn(state.turns, id)) {
          state.cwd ??= await this.localCwd(threadId);
          const entry = state.pending ?? { cwd: state.cwd, trusted: false,
            baseline: state.cwd ? await this.snapshot(state.cwd) : undefined };
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
              const after = await this.snapshot(entry.cwd);
              if (after) { const counts = numstat(await this.git(entry.cwd, ["diff", "--numstat", "-z", entry.baseline, after, "--"]));
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
        if (state.cwd) result = await committedCounts(state.cwd, turn, (cwd, args) => this.git(cwd, args));
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
