import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TurnChangeHistory, countCompleteDiff } from "../../server/turn-change-history.js";

const run = promisify(execFile);
const threadId = "01a10355-60cd-70f2-8063-17d3a5626be4";
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function fixture(initial = true) {
  const root = await mkdtemp(join(tmpdir(), "turn-changes-")); roots.push(root);
  const cwd = join(root, "repo"); const home = join(root, "home");
  await mkdir(cwd); await mkdir(home);
  await git(cwd, "init"); await git(cwd, "config", "user.name", "Test"); await git(cwd, "config", "user.email", "test@example.com");
  if (initial) { await writeFile(join(cwd, "a.txt"), "keep\nold\n"); await git(cwd, "add", "."); await git(cwd, "commit", "-m", "initial"); }
  return { cwd, home, service: new TurnChangeHistory(home) };
}
async function git(cwd: string, ...args: string[]) { return (await run("git", args, { cwd })).stdout; }
function event(service: TurnChangeHistory, method: string, params: Record<string, unknown>) { service.observe({ method, params }); }
async function begin(service: TurnChangeHistory, cwd: string, id = "turn-1") {
  await service.beforeStart(threadId, cwd); event(service, "turn/started", { threadId, turn: { id } }); await service.flush();
}
async function end(service: TurnChangeHistory, id = "turn-1") { event(service, "turn/completed", { threadId, turn: { id } }); await service.flush(); }
const change = (additions: number, deletions: number) => expect.objectContaining({ additions, deletions });

describe("回合 Git 改动统计", () => {
  it("命令写文件并提交后仍统计 +2/-1，并保持用户 index", async () => {
    const { cwd, service } = await fixture();
    await begin(service, cwd);
    await writeFile(join(cwd, "a.txt"), "keep\nnew\nextra\n");
    await git(cwd, "add", "."); await git(cwd, "commit", "-m", "change");
    const index = await readFile(join(cwd, ".git/index"));
    await end(service);
    await expect(service.get(threadId, { id: "turn-1" })).resolves.toEqual(change(2, 1));
    expect(await readFile(join(cwd, ".git/index"))).toEqual(index);
  });
  it("包含 untracked、binary，排除 ignored，并可在重启后读取", async () => {
    const { cwd, home, service } = await fixture(); await begin(service, cwd);
    await writeFile(join(cwd, ".git/info/exclude"), "ignored.txt\n");
    await writeFile(join(cwd, "ignored.txt"), "ignored\n");
    await writeFile(join(cwd, "new.txt"), "one\ntwo\n");
    await writeFile(join(cwd, "binary.dat"), Buffer.from([0, 255, 1]));
    await end(service);
    await expect(new TurnChangeHistory(home).get(threadId, { id: "turn-1" })).resolves.toEqual(change(2, 0));
    expect((await git(cwd, "status", "--porcelain")).trim()).toContain("?? new.txt");
  });
  it("无修改的可信快照返回真实零，未初始化 HEAD 的 Git 仓库也可统计", async () => {
    const { cwd, service } = await fixture(false); await begin(service, cwd); await end(service);
    await expect(service.get(threadId, { id: "turn-1" })).resolves.toEqual(change(0, 0));
    await begin(service, cwd, "turn-2"); await writeFile(join(cwd, "first.txt"), "first\n"); await end(service, "turn-2");
    await expect(service.get(threadId, { id: "turn-2" })).resolves.toEqual(change(1, 0));
  });
  it("重复开始和完成不覆盖首次基线和结果", async () => {
    const { cwd, service } = await fixture(); await begin(service, cwd);
    await writeFile(join(cwd, "a.txt"), "keep\nnew\nextra\n");
    event(service, "turn/started", { threadId, turn: { id: "turn-1" } });
    await end(service);
    await writeFile(join(cwd, "a.txt"), "later\n"); await end(service);
    await expect(service.get(threadId, { id: "turn-1" })).resolves.toEqual(change(2, 1));
  });
  it("外部开始缺少前置捕获时不声称精确零或精确快照", async () => {
    const { cwd, service } = await fixture();
    event(service, "thread/started", { thread: { id: threadId, cwd } });
    event(service, "turn/started", { threadId, turn: { id: "turn-1" } });
    await service.flush(); await writeFile(join(cwd, "a.txt"), "changed\n"); await end(service);
    await expect(service.get(threadId, { id: "turn-1" })).resolves.toBeNull();
  });
  it("非 Git、相对路径、越界线程 ID 和不存在的目录返回未知", async () => {
    const { home, service } = await fixture();
    await begin(service, home); await end(service);
    await expect(service.get(threadId, { id: "turn-1" })).resolves.toBeNull();
    await service.beforeStart("../../evil", home);
    await expect(service.get("../../evil", { id: "turn-1" })).resolves.toBeNull();
    await begin(service, "relative", "turn-2"); await end(service, "turn-2");
    await expect(service.get(threadId, { id: "turn-2" })).resolves.toBeNull();
    await begin(service, join(home, "missing"), "turn-3"); await end(service, "turn-3");
    await expect(service.get(threadId, { id: "turn-3" })).resolves.toBeNull();
  });
  it("完整 live diff 持久化计数，截断和缺失 diff 保持未知", async () => {
    const { home, service } = await fixture();
    const diff = "diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1,2 +1,3 @@\n keep\n-old\n+new\n+extra\n";
    event(service, "turn/diff/updated", { threadId, turnId: "live", diff }); await service.flush();
    await expect(new TurnChangeHistory(home).get(threadId, { id: "live" })).resolves.toEqual(change(2, 1));
    await expect(service.get(threadId, { id: "raw", diff })).resolves.toEqual(change(2, 1));
    await expect(service.get(threadId, { id: "cut", diff: diff.slice(0, -7) })).resolves.toBeNull();
    await expect(service.get(threadId, { id: "none", items: [{ type: "commandExecution", exitCode: 0, aggregatedOutput: "Done" }] })).resolves.toBeNull();
  });

  it("从成功 commandExecution 的真实提交输出恢复，并验证回合时间", async () => {
    const { cwd, home, service } = await fixture();
    const startedAt = Math.floor(Date.now() / 1000) - 5;
    await writeFile(join(cwd, "a.txt"), "keep\nnew\nextra\n"); await git(cwd, "add", ".");
    const output = await git(cwd, "commit", "-m", "perf(图片): 改善加载");
    event(service, "thread/started", { thread: { id: threadId, cwd } }); await service.flush();
    const turn = { id: "historic", startedAt, completedAt: startedAt + 20,
      items: [{ type: "commandExecution", exitCode: 0, aggregatedOutput: output }] };
    await expect(service.get(threadId, turn)).resolves.toEqual(change(2, 1));
    await expect(new TurnChangeHistory(home).get(threadId, { id: "historic" })).resolves.toEqual(change(2, 1));
    await expect(service.get(threadId, { ...turn, id: "late", startedAt: startedAt + 30, completedAt: startedAt + 60 })).resolves.toBeNull();
    await expect(service.get(threadId, { ...turn, id: "failed", items: [{ ...turn.items[0], exitCode: 1 }] })).resolves.toBeNull();
    const hash = (await git(cwd, "rev-parse", "HEAD")).trim();
    await expect(service.get(threadId, { ...turn, id: "mention", items: [{ ...turn.items[0], aggregatedOutput: `Mentioned ${hash}` }] })).resolves.toBeNull();
    await expect(service.get(threadId, { ...turn, id: "invalid", items: [{ ...turn.items[0], aggregatedOutput: "[main deadbeef] fake\n" }] })).resolves.toBeNull();
  });
  it("多个去重提交统计首次父提交到末提交的净差异", async () => {
    const { cwd, service } = await fixture(); const startedAt = Math.floor(Date.now() / 1000) - 5;
    await writeFile(join(cwd, "a.txt"), "keep\nnew\nextra\n"); await git(cwd, "add", "."); const first = await git(cwd, "commit", "-m", "first");
    await writeFile(join(cwd, "a.txt"), "keep\nfinal\n"); await git(cwd, "add", "."); const last = await git(cwd, "commit", "-m", "last");
    event(service, "thread/started", { thread: { id: threadId, cwd } }); await service.flush();
    await expect(service.get(threadId, { id: "multi", startedAt, completedAt: startedAt + 20,
      items: [first, first, last].map((aggregatedOutput) => ({ type: "commandExecution", exitCode: 0, aggregatedOutput })) })).resolves.toEqual(change(1, 1));
  });
  it("根提交也可从 archived_sessions 的 session_meta cwd 恢复", async () => {
    const { cwd, home, service } = await fixture(false); const startedAt = Math.floor(Date.now() / 1000) - 5;
    await writeFile(join(cwd, "a.txt"), "one\ntwo\n"); await git(cwd, "add", "."); const output = await git(cwd, "commit", "-m", "root");
    const directory = join(home, "archived_sessions"); await mkdir(directory);
    await writeFile(join(directory, `rollout-2026-10-04T00-00-00-${threadId}.jsonl`), JSON.stringify({ type: "session_meta", payload: { id: threadId, cwd } }) + "\n");
    await expect(service.get(threadId, { id: "root", startedAt, completedAt: startedAt + 20,
      items: [{ type: "commandExecution", exitCode: 0, aggregatedOutput: output }] })).resolves.toEqual(change(2, 0));
  });

  it("cwd 位于子目录也捕获整个 Git 仓库的修改", async () => {
    const { cwd, service } = await fixture(); await mkdir(join(cwd, "sub")); await begin(service, join(cwd, "sub"));
    await writeFile(join(cwd, "a.txt"), "keep\nnew\nextra\n"); await end(service);
    await expect(service.get(threadId, { id: "turn-1" })).resolves.toEqual(change(2, 1));
  });
  it("更新的截断 diff 不能沿用之前的旧统计", async () => {
    const { service } = await fixture();
    const diff = "diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-old\n+new\n";
    event(service, "turn/diff/updated", { threadId, turnId: "live", diff }); await service.flush();
    await expect(service.get(threadId, { id: "live" })).resolves.toEqual(change(1, 1));
    event(service, "turn/diff/updated", { threadId, turnId: "live", diff: diff + "@@ -3,1 +3,2 @@\n context\n" }); await service.flush();
    await expect(service.get(threadId, { id: "live" })).resolves.toBeNull();
  });
  it("并发的请求和通知按线程串行，不覆盖其他线程或首次结果", async () => {
    const { cwd, service } = await fixture(); const second = "01a10355-60cd-70f2-8063-17d3a5626be5";
    await Promise.all([service.beforeStart(threadId, cwd), service.beforeStart(threadId, cwd), service.beforeStart(second, cwd)]);
    for (const id of [threadId, second]) event(service, "turn/started", { threadId: id, turn: { id: "same" } });
    await service.flush(); await writeFile(join(cwd, "a.txt"), "keep\nnew\nextra\n");
    for (const id of [threadId, second, threadId]) event(service, "turn/completed", { threadId: id, turn: { id: "same" } });
    const results = await Promise.all([service.get(threadId, { id: "same" }), service.get(second, { id: "same" })]);
    expect(results).toEqual([change(2, 1), change(2, 1)]);
  });
  it("文件尺寸超过限制时保持未知且不改写用户 index", async () => {
    const { cwd, service } = await fixture(); await writeFile(join(cwd, "huge.dat"), Buffer.alloc(17 * 1024 * 1024, 1));
    const index = await readFile(join(cwd, ".git/index")); await begin(service, cwd); await end(service);
    await expect(service.get(threadId, { id: "turn-1" })).resolves.toBeNull();
    expect(await readFile(join(cwd, ".git/index"))).toEqual(index);
  });
  it("sessions 日期目录的元数据可作为 beforeStart 的 cwd", async () => {
    const { cwd, home, service } = await fixture();
    const date = new Date(Number.parseInt(threadId.replaceAll("-", "").slice(0, 12), 16));
    const directory = join(home, "sessions", String(date.getFullYear()), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0"));
    await mkdir(directory, { recursive: true }); await writeFile(join(directory, `rollout-date-${threadId}.jsonl`), JSON.stringify({ type: "session_meta", payload: { id: threadId, cwd } }) + "\n");
    await service.beforeStart(threadId); event(service, "turn/started", { threadId, turn: { id: "turn-1" } }); await service.flush();
    await writeFile(join(cwd, "a.txt"), "keep\nnew\nextra\n"); await end(service);
    await expect(service.get(threadId, { id: "turn-1" })).resolves.toEqual(change(2, 1));
  });

  it("hunk 行数完整时接受没有末尾换行的 liveDiff", async () => {
    const { service } = await fixture();
    const liveDiff = "diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-old\n+new";
    await expect(service.get(threadId, { id: "no-newline", liveDiff })).resolves.toEqual(change(1, 1));
    await expect(service.get(threadId, { id: "header-only", diff: "diff --git a/a b/a\nindex abc..def 100644\n" })).resolves.toBeNull();
  });

  it("保留既有 staged 修改；只统计回合中新增的修改", async () => {
    const { cwd, service } = await fixture();
    await writeFile(join(cwd, "a.txt"), "keep\nstaged\n"); await git(cwd, "add", ".");
    const index = await readFile(join(cwd, ".git/index")); await begin(service, cwd);
    await writeFile(join(cwd, "a.txt"), "keep\nstaged\nadded\n"); await end(service);
    await expect(service.get(threadId, { id: "turn-1" })).resolves.toEqual(change(1, 0));
    expect(await readFile(join(cwd, ".git/index"))).toEqual(index);
  });
  it("failed 状态和缺失退出码都不能从提交输出声称成功", async () => {
    const { cwd, service } = await fixture(); const startedAt = Math.floor(Date.now() / 1000) - 5;
    await writeFile(join(cwd, "a.txt"), "changed\n"); await git(cwd, "add", "."); const output = await git(cwd, "commit", "-m", "change");
    event(service, "thread/started", { thread: { id: threadId, cwd } }); await service.flush();
    for (const item of [{ type: "commandExecution", status: "failed", exitCode: 0, aggregatedOutput: output },
      { type: "commandExecution", aggregatedOutput: output }]) {
      await expect(service.get(threadId, { id: "failed-status", startedAt, completedAt: startedAt + 20, items: [item] })).resolves.toBeNull();
    }
  });
  it("多提交不在连续祖先链上时保持未知", async () => {
    const { cwd, service } = await fixture(); const startedAt = Math.floor(Date.now() / 1000) - 5;
    await writeFile(join(cwd, "a.txt"), "first\n"); await git(cwd, "add", "."); const first = await git(cwd, "commit", "-m", "first");
    await writeFile(join(cwd, "a.txt"), "gap\n"); await git(cwd, "add", "."); await git(cwd, "commit", "-m", "other turn");
    await writeFile(join(cwd, "a.txt"), "last\n"); await git(cwd, "add", "."); const last = await git(cwd, "commit", "-m", "last");
    event(service, "thread/started", { thread: { id: threadId, cwd } }); await service.flush();
    await expect(service.get(threadId, { id: "gap", startedAt, completedAt: startedAt + 20,
      items: [first, last].map((aggregatedOutput) => ({ type: "commandExecution", exitCode: 0, aggregatedOutput })) })).resolves.toBeNull();
  });
  it("损坏和负数缓存不能当作有效统计", async () => {
    const { home } = await fixture(); const directory = join(home, "codex-mobile-turn-changes"); await mkdir(directory);
    const path = join(directory, `${threadId}.json`); await writeFile(path, "broken");
    await expect(new TurnChangeHistory(home).get(threadId, { id: "turn-1" })).resolves.toBeNull();
    await writeFile(path, JSON.stringify({ turns: { "turn-1": { counts: { additions: -1, deletions: 0 } } } }));
    await expect(new TurnChangeHistory(home).get(threadId, { id: "turn-1" })).resolves.toBeNull();
  });
  it("特殊 turn ID 不使用对象原型而且可重启读取", async () => {
    const { cwd, home, service } = await fixture(); await begin(service, cwd, "__proto__");
    await writeFile(join(cwd, "a.txt"), "keep\nnew\nextra\n"); await end(service, "__proto__");
    await expect(new TurnChangeHistory(home).get(threadId, { id: "__proto__" })).resolves.toEqual(change(2, 1));
  });

  it("统一完整 diff 校验支持 fileChange 的 hunk-only 格式", () => {
    expect(countCompleteDiff("@@ -1,2 +1,3 @@\n keep\n-old\n+new\n+extra")).toEqual(change(2, 1));
    expect(countCompleteDiff("@@ -1,2 +1,3 @@\n keep\n-old\n+new")).toBeNull();
    expect(countCompleteDiff("+new\n-old")).toBeNull();
    expect(countCompleteDiff("diff --git a/a b/a\nold mode 100644\nnew mode 100755\n")).toEqual(change(0, 0));
  });
  it("取消失败的启动会清除 pending 基线，下一次开始重新捕获", async () => {
    const { cwd, service } = await fixture(); await service.beforeStart(threadId, cwd);
    await service.cancelStart(threadId);
    await writeFile(join(cwd, "a.txt"), "keep\nfailed request change\n");
    await begin(service, cwd); await writeFile(join(cwd, "a.txt"), "keep\nfailed request change\nnew\n"); await end(service);
    await expect(service.get(threadId, { id: "turn-1" })).resolves.toEqual(change(1, 0));
  });

  it("文件头被截断在 hunk 前不能误报零", () => {
    expect(countCompleteDiff("diff --git a/a b/a\nnew file mode 100644\nindex 0000000..abcd123\n--- /dev/null\n+++ b/a\n")).toBeNull();
    expect(countCompleteDiff("diff --git a/a b/a\nnew file mode 100644\n")).toBeNull();
    expect(countCompleteDiff("diff --git a/a b/a\nnew file mode 100644\nindex 0000000..e69de29\n")).toEqual(change(0, 0));
  });

  it("标准 unified 文件头无 diff --git 也可验证完整 hunk", () => {
    expect(countCompleteDiff("--- a/a\n+++ b/a\n@@ -1 +1 @@\n-a\n+b")).toEqual(change(1, 1));
    expect(countCompleteDiff("--- a/a\n+++ b/a\n@@ -1 +1,2 @@\n-a\n+b")).toBeNull();
    expect(countCompleteDiff("--- a/a\n+++ b/a\n")).toBeNull();
  });

  it("无关 token 和 delta 通知不会创建持久缓存", async () => {
    const { home, service } = await fixture();
    for (const method of ["item/agentMessage/delta", "thread/tokenUsage/updated", "item/started", "item/completed"]) {
      event(service, method, { threadId, turnId: "turn-1", delta: "text", item: { id: "item-1" } });
    }
    await service.flush();
    await expect(stat(join(home, "codex-mobile-turn-changes"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("用户强制 stage 的 ignored 新文件仍统计，其他 ignored 文件不加入快照", async () => {
    const { cwd, service } = await fixture(false);
    await writeFile(join(cwd, ".gitignore"), "*.txt\n"); await git(cwd, "add", ".gitignore"); await git(cwd, "commit", "-m", "ignore text files");
    await writeFile(join(cwd, "a.txt"), "old\n"); await git(cwd, "add", "-f", "a.txt");
    await writeFile(join(cwd, "untracked.txt"), "ignored\n"); const index = await readFile(join(cwd, ".git/index"));
    await begin(service, cwd); await writeFile(join(cwd, "a.txt"), "new\nextra\n");
    await writeFile(join(cwd, "untracked.txt"), "ignored\nmore ignored\n"); await end(service);
    await expect(service.get(threadId, { id: "turn-1" })).resolves.toEqual(change(2, 1));
    expect(await readFile(join(cwd, ".git/index"))).toEqual(index);
    expect(await git(cwd, "ls-files", "--", "untracked.txt")).toBe("");
  });

  it("强制 stage 文件名含 pathspec 字符时只包含确切的 tracked 路径", async () => {
    const { cwd, service } = await fixture(false);
    await writeFile(join(cwd, ".gitignore"), "*.txt\n"); await git(cwd, "add", ".gitignore"); await git(cwd, "commit", "-m", "ignore text files");
    await writeFile(join(cwd, "a*.txt"), "old\n"); await git(cwd, "--literal-pathspecs", "add", "-f", "--", "a*.txt");
    await writeFile(join(cwd, "a-other.txt"), "ignored\n"); await begin(service, cwd);
    await writeFile(join(cwd, "a*.txt"), "new\nextra\n"); await writeFile(join(cwd, "a-other.txt"), "changed ignored\nmore ignored\n"); await end(service);
    await expect(service.get(threadId, { id: "turn-1" })).resolves.toEqual(change(2, 1));
  });

});
