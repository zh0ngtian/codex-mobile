import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { dirname } from "node:path";
import { promisify } from "node:util";
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { inflateSync } from 'node:zlib';
import { RemoteCommandError, RemoteCommands, decodeRemoteCommandText } from './remote/commands.js';
import { RemoteRpcSession } from './remote/rpc-session.js';

const execute = promisify(execFile);

interface CodexLocalProject {
  id?: unknown;
  rootPaths?: unknown;
}

interface CodexGlobalState {
  "local-projects"?: unknown;
  "project-order"?: unknown;
  "projectless-thread-ids"?: unknown;
  "thread-project-assignments"?: unknown;
  "thread-project-membership-host-ids"?: unknown;
  "app-server-project-id-by-legacy-project-id-by-host"?: unknown;
}

export interface DesktopProjectMembership {
  byThreadId: Record<string, string>;
  byProjectId: Record<string, string>;
  extraRoots: Record<string, string[]>;
}

export interface CodexProjectState {
  projects: string[];
  projectlessThreadIds: string[];
  projectWorktrees?: Record<string, string[]>;
  projectMembership?: DesktopProjectMembership;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

export function parseCodexProjectState(globalState: string, codexHome?: string): CodexProjectState {
  const state = JSON.parse(globalState) as CodexGlobalState;
  const localProjects = state["local-projects"];
  const localProjectRecords =
    localProjects &&
    typeof localProjects === "object" &&
    !Array.isArray(localProjects)
      ? (Object.values(localProjects) as CodexLocalProject[])
      : [];
  const localProjectsById = new Map(
    localProjectRecords.flatMap((project) =>
      typeof project?.id === "string" ? [[project.id, project] as const] : [],
    ),
  );
  const projectOrder = Array.isArray(state["project-order"])
    ? state["project-order"].filter(
        (projectId): projectId is string => typeof projectId === "string",
      )
    : [];
  const orderedProjectIds = new Set(projectOrder);
  const orderedLocalProjects = [
    ...localProjectRecords.filter(
      (project) =>
        typeof project?.id !== "string" || !orderedProjectIds.has(project.id),
    ),
    ...projectOrder.flatMap((projectId) => {
      const project = localProjectsById.get(projectId);
      return project ? [project] : [];
    }),
  ];

  const projects = new Set<string>();
  const byProjectId = new Map<string, string>();
  const extraRoots = new Map<string, string[]>();
  for (const project of orderedLocalProjects) {
    if (!project || typeof project !== "object" || !Array.isArray(project.rootPaths)) {
      continue;
    }
    const roots = [...new Set(project.rootPaths.filter(
      (rootPath): rootPath is string => typeof rootPath === "string" && Boolean(rootPath.trim()),
    ))];
    for (const rootPath of roots) projects.add(rootPath);
    const [primary, ...additional] = roots;
    if (!primary || typeof project.id !== "string" || !project.id.trim()) continue;
    byProjectId.set(project.id, primary);
    if (additional.length) {
      extraRoots.set(primary, [...new Set([...(extraRoots.get(primary) ?? []), ...additional])]);
    }
  }
  const projectlessThreadIds = new Set(
    Array.isArray(state["projectless-thread-ids"])
      ? state["projectless-thread-ids"].filter(
          (threadId): threadId is string =>
            typeof threadId === "string" && Boolean(threadId.trim()),
        )
      : [],
  );
  const byThreadId = new Map<string, string>();
  const hosts = record(state["thread-project-membership-host-ids"]);
  const localHostKey = codexHome ? `local:${codexHome}` : undefined;
  for (const [threadId, value] of Object.entries(record(state["thread-project-assignments"]))) {
    const host = hosts[threadId];
    if (!threadId.trim() || projectlessThreadIds.has(threadId) ||
      (host !== undefined && host !== "local" && host !== localHostKey)) continue;
    const assignment = record(value);
    if (assignment.projectKind !== "local" || typeof assignment.projectId !== "string") continue;
    const root = byProjectId.get(assignment.projectId);
    if (root) byThreadId.set(threadId, root);
  }
  if (localHostKey) {
    const aliases = record(record(state["app-server-project-id-by-legacy-project-id-by-host"])[localHostKey]);
    for (const [legacyId, nativeId] of Object.entries(aliases)) {
      const root = byProjectId.get(legacyId);
      if (root && typeof nativeId === "string" && nativeId.trim() && !byProjectId.has(nativeId)) {
        byProjectId.set(nativeId, root);
      }
    }
  }
  return {
    projects: [...projects],
    projectlessThreadIds: [...projectlessThreadIds],
    ...(byProjectId.size ? { projectMembership: {
      byThreadId: Object.fromEntries(byThreadId),
      byProjectId: Object.fromEntries(byProjectId),
      extraRoots: Object.fromEntries(extraRoots),
    } } : {}),
  };
}

export function parseCodexProjectDirectories(globalState: string) {
  return parseCodexProjectState(globalState).projects;
}

export async function readCodexProjectDirectories(globalStatePath: string) {
  return parseCodexProjectDirectories(await readFile(globalStatePath, "utf8"));
}

export interface RemoteProjectSource { session: RemoteRpcSession; commands: RemoteCommands; signal?: AbortSignal }
// 命令结果还会多次 base64 编码，32 KiB 压缩页可在单条 Relay 消息内交付。
const PROJECT_STATE_WIRE_PAGE_BYTES = 32 * 1024;
const PROJECT_STATE_RAW_PAGE_BYTES = 1024 * 1024;
// 只投影既有解析器需要的字段；无关的大型全局状态不会进入Commands捕获。
const PROJECT_STATE_PYTHON = String.raw`import base64,hashlib,json,os,sys,zlib
q=json.loads(sys.argv[1])
def invalid(value):raise ValueError()
# 原子由标准decoder解码；容器仅用显式栈定位并完整验证，避免Python递归深度成为产品限制。
# 必要字段保留原始JSON片段，不把数值转成Python数值再编码。
decoder=json.JSONDecoder(parse_int=lambda value:None,parse_float=lambda value:None,parse_constant=invalid)
with open(os.path.join(os.getcwd(),'.codex-global-state.json'),'r',encoding='utf-8',errors='replace') as f: text=f.read()
def space(i):
    while i<len(text) and text[i] in ' \t\r\n':i+=1
    return i
def end_value(start):
 i=start;states=['value']
 while states:
  state=states.pop();i=space(i);c=text[i:i+1]
  if state=='value':
   if c=='{':states.append('object-first');i+=1
   elif c=='[':states.append('array-first');i+=1
   else:_,i=decoder.raw_decode(text,i)
  elif state=='key':
   if c!='"':raise ValueError()
   _,i=decoder.raw_decode(text,i)
  elif state=='colon':
   if c!=':':raise ValueError()
   i+=1
  elif state=='object-first':
   if c=='}':i+=1
   else:states.extend(['object-end','value','colon','key'])
  elif state=='array-first':
   if c==']':i+=1
   else:states.extend(['array-end','value'])
  elif state=='object-end':
   if c=='}':i+=1
   elif c==',':i+=1;states.extend(['object-end','value','colon','key'])
   else:raise ValueError()
  elif state=='array-end':
   if c==']':i+=1
   elif c==',':i+=1;states.extend(['array-end','value'])
   else:raise ValueError()
 return i
start=space(0);end=end_value(start)
if space(end)!=len(text):raise ValueError()
if text[start:start+4]=='null':raise ValueError()
keys=['local-projects','project-order','projectless-thread-ids','thread-project-assignments','thread-project-membership-host-ids','app-server-project-id-by-legacy-project-id-by-host'];selected={}
if text[start]=='{':
    i=space(start+1)
    while text[i]!='}':
        key,i=decoder.raw_decode(text,i);i=space(i)+1;i=space(i);begin=i;i=end_value(i)
        if key in keys:selected[key]=text[begin:i]
        i=space(i)
        if text[i]=='}':break
        i=space(i+1)
raw=('{'+','.join(json.dumps(k)+':'+v for k,v in selected.items())+'}').encode('utf-8')
page=raw[q['offset']:q['offset']+${PROJECT_STATE_RAW_PAGE_BYTES}]
compressed=zlib.compress(page,1)
while len(compressed)>${PROJECT_STATE_WIRE_PAGE_BYTES}:
    page=page[:len(page)//2]
    compressed=zlib.compress(page,1)
print(json.dumps(dict(total=len(raw),sha256=hashlib.sha256(raw).hexdigest(),offset=q['offset'],size=len(page),base64=base64.b64encode(compressed).decode('ascii'))))
`;
async function remoteProjectState(source: RemoteProjectSource): Promise<CodexProjectState> {
  if (!(source.session instanceof RemoteRpcSession) || !(source.commands instanceof RemoteCommands)) throw new Error('Remote项目来源无效');
  const binding = source.commands.fileTransportBinding(source.session); const deadline = performance.now() + 20000;
  const parts: Buffer[] = []; const digest = createHash('sha256'); let offset = 0; let signature: string | undefined;
  for (;;) {
    const remaining = Math.floor(deadline - performance.now()); if (remaining < 1) throw new Error('Remote项目读取超时');
    const result = await source.commands.execute({ argv: [binding.python, '-I', '-c', PROJECT_STATE_PYTHON, JSON.stringify({ offset })],
      cwd: binding.metadata.codexHome, timeoutMs: remaining, stdoutBytesCap: 48 * 1024, stderrBytesCap: 16384, signal: source.signal }, 'inline');
    if (result.exitCode !== 0 || result.stderr.length) throw new Error('Remote项目状态读取失败');
    const value = JSON.parse(decodeRemoteCommandText(result.stdout));
    if (!Number.isSafeInteger(value.total) || value.total < offset || value.offset !== offset || typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256) || typeof value.base64 !== 'string') throw new Error('Remote项目状态响应无效');
    const current = JSON.stringify([value.total, value.sha256]); if (signature !== undefined && current !== signature) throw new Error('Remote项目状态读取期间已变化'); signature = current;
    const compressed = Buffer.from(value.base64, 'base64');
    if (!Number.isSafeInteger(value.size) || value.size < 1 || value.size > Math.min(PROJECT_STATE_RAW_PAGE_BYTES, value.total - offset) ||
      compressed.length > PROJECT_STATE_WIRE_PAGE_BYTES || compressed.toString('base64') !== value.base64) throw new Error('Remote项目状态响应无效');
    const part = inflateSync(compressed, { maxOutputLength: value.size });
    if (part.length !== value.size) throw new Error('Remote项目状态响应无效');
    parts.push(part); digest.update(part); offset += part.length;
    if (offset === value.total) { if (digest.digest('hex') !== value.sha256) throw new Error('Remote项目状态校验失败'); break; }
  }
  return parseCodexProjectState(decodeRemoteCommandText(Buffer.concat(parts)), binding.metadata.codexHome);
}

// 固定只读git在目标内合批；输出分页，保持每个仓库原有1MiB边界。
const WORKTREES_PYTHON = String.raw`import base64,hashlib,json,subprocess,sys,threading
q=json.loads(sys.argv[1]);result=[]
for root in sys.argv[2:]:
 p=subprocess.Popen(['git','--no-optional-locks','-C',root,'worktree','list','--porcelain','-z'],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 out=[];err=[];overflow=[]
 def capture(stream,parts):
  size=0
  while True:
   chunk=stream.read(65536)
   if not chunk:break
   size+=len(chunk)
   if size>1048576:overflow.append(True);p.kill();break
   parts.append(chunk)
 threads=[threading.Thread(target=capture,args=(p.stdout,out)),threading.Thread(target=capture,args=(p.stderr,err))]
 for t in threads:t.start()
 try:p.wait(timeout=20)
 except BaseException:p.kill();p.wait();raise
 finally:
  for t in threads:t.join()
 if overflow:raise ValueError('worktree output too large')
 result.append(dict(root=root,code=p.returncode,stdout=base64.b64encode(b''.join(out)).decode('ascii'),stderr=base64.b64encode(b''.join(err)).decode('ascii')))
raw=json.dumps(result).encode('utf-8')
print(json.dumps(dict(total=len(raw),sha256=hashlib.sha256(raw).hexdigest(),offset=q['offset'],base64=base64.b64encode(raw[q['offset']:q['offset']+1048576]).decode('ascii'))))
`;
async function remoteWorktrees(source: RemoteProjectSource, roots: string[]) {
  const binding = source.commands.fileTransportBinding(source.session); const outputs = new Map<string, { code: number; stdout: string; stderr: string }>();
  // 参数小于Commands单参数16KiB；超出时拆分，不丢项目。
  const batches: string[][] = []; let batch: string[] = [];
  for (const root of roots) { if (batch.length && (batch.length >= 200 || Buffer.byteLength(JSON.stringify([...batch, root])) > 12000)) { batches.push(batch); batch = []; } batch.push(root); }
  if (batch.length) batches.push(batch);
  for (const roots of batches) {
    const deadline = performance.now() + 20000; const parts: Buffer[] = []; let offset = 0; let signature: string | undefined;
    for (;;) {
      const remaining = Math.floor(deadline - performance.now()); if (remaining < 1) throw new Error('Remote项目worktree读取超时');
      const result = await source.commands.execute({ argv: [binding.python, '-I', '-c', WORKTREES_PYTHON, JSON.stringify({ offset }), ...roots], cwd: binding.metadata.codexHome, timeoutMs: remaining, stdoutBytesCap: 2 * 1024 * 1024, stderrBytesCap: 16384, signal: source.signal });
      if (result.exitCode !== 0 || result.stderr.length) throw new Error('Remote项目worktree读取失败');
      const value = JSON.parse(decodeRemoteCommandText(result.stdout));
      if (!Number.isSafeInteger(value.total) || value.total < offset || value.offset !== offset || typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256) || typeof value.base64 !== 'string') throw new Error('Remote worktree响应无效');
      const current = JSON.stringify([value.total, value.sha256]); if (signature !== undefined && signature !== current) throw new Error('Remote worktree读取期间已变化'); signature = current;
      const part = Buffer.from(value.base64, 'base64'); if (part.toString('base64') !== value.base64 || part.length !== Math.min(1048576, value.total - offset)) throw new Error('Remote worktree响应无效');
      parts.push(part); offset += part.length;
      if (offset === value.total) { const raw = Buffer.concat(parts); if (createHash('sha256').update(raw).digest('hex') !== value.sha256) throw new Error('Remote worktree校验失败');
        const rows = JSON.parse(decodeRemoteCommandText(raw));
        if (!Array.isArray(rows) || rows.length !== roots.length) throw new Error('Remote worktree响应无效');
        rows.forEach((row, i) => { if (row.root !== roots[i] || !Number.isInteger(row.code) || typeof row.stdout !== 'string' || typeof row.stderr !== 'string') throw new Error('Remote worktree响应无效'); outputs.set(row.root, { code: row.code, stdout: decodeRemoteCommandText(Buffer.from(row.stdout, 'base64')), stderr: decodeRemoteCommandText(Buffer.from(row.stderr, 'base64')) }); }); break;
      }
    }
  }
  return outputs;
}

export class RemoteProjectReadError extends Error {
  readonly code: string;
  readonly commandStage?: RemoteCommandError["stage"];
  constructor(readonly stage: "project-file" | "worktrees", cause: unknown) {
    super("Remote 项目目录读取失败", { cause });
    this.code = cause instanceof RemoteCommandError ? cause.code : "invalid-result";
    this.commandStage = cause instanceof RemoteCommandError ? cause.stage : undefined;
  }
}

export async function readCodexProjectState(globalStatePath: string, source?: RemoteProjectSource) {
  const state = source
    ? await remoteProjectState(source).catch(cause => { throw new RemoteProjectReadError("project-file", cause); })
    : parseCodexProjectState(await readFile(globalStatePath, "utf8"), dirname(globalStatePath));
  const projectWorktrees: Record<string, string[]> = {};
  const registered = new Set(state.projects);
  const remoteOutputs = source
    ? await remoteWorktrees(source, state.projects).catch(cause => { throw new RemoteProjectReadError("worktrees", cause); })
    : undefined;
  for (const root of state.projects) {
    let output: string;
    try {
      const args = ["--no-optional-locks", "-C", root, "worktree", "list", "--porcelain", "-z"];
      if (source) {
        const result = remoteOutputs!.get(root)!;
        if (result.code !== 0) throw Object.assign(new Error('Remote项目worktree读取失败'), { code: result.code, stderr: result.stderr });
        output = result.stdout;
      } else ({ stdout: output } = await execute("git", args, { timeout: 3_000, maxBuffer: 1024 * 1024 }));
    } catch (error: any) {
      // 普通文件夹及已删除的项目没有 Git worktree；其他读取故障必须报告。
      if (error.code === 128 && /not a git repository|cannot change to .*No such file or directory/.test(error.stderr ?? "")) continue;
      throw source ? new RemoteProjectReadError("worktrees", error) : error;
    }
    const paths = output.split("\0").filter(part => part.startsWith("worktree ")).map(part => part.slice(9));
    // 以已登记的主工作区为归属；显式登记的另一个工作区仍保持独立项目。
    if (paths[0] !== root) continue;
    const worktrees = paths.slice(1).filter(path => !registered.has(path));
    if (worktrees.length) projectWorktrees[root] = worktrees;
  }
  return Object.keys(projectWorktrees).length ? { ...state, projectWorktrees } : state;
}
