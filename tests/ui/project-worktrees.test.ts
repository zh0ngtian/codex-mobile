import { expect, it } from "vitest";
import { withProjectWorktree } from "../../src/features/threads/project-worktrees";
import { aggregateThreads, groupThreadsByProject } from "../../src/features/threads/thread-list-model";

it("worktree、运行与未读摘要和搜索共用主项目归属，保留真实执行目录及设备隔离", () => {
  const worktree = "/worktrees/task/checkout", root = "/projects/codex-mobile";
  const aliases = { [root]: [worktree] };
  const records = [
    { id: "main", cwd: root, recencyAt: 1 },
    { id: "running", cwd: worktree, recencyAt: 3, status: { type: "active" } },
    { id: "unread", cwd: worktree, recencyAt: 2, isUnread: true },
    { id: "different", cwd: "/another/codex-mobile", recencyAt: 0 },
  ].map(thread => withProjectWorktree(thread, aliases));
  const aggregated = aggregateThreads([{ id: "a", name: "A" }], { a: records });
  const groups = groupThreadsByProject(aggregated, [root]);
  expect(groups).toHaveLength(2);
  expect(groups[0].threads.map(thread => thread.threadId)).toEqual(["running", "unread", "main"]);
  expect(groups[0].threads[0]).toMatchObject({ cwd: worktree, projectName: "codex-mobile", thread: { cwd: worktree } });
  expect(groups[1].cwd).toBe("/another/codex-mobile");
  // 另一设备没有该网关的映射，同路径不能沿用设备 A 的归属。
  expect(withProjectWorktree({ ...records[1] }, {})).not.toHaveProperty("projectCwd");
  expect(withProjectWorktree({ ...records[1], isProjectless: true }, aliases)).not.toHaveProperty("projectCwd");
});
