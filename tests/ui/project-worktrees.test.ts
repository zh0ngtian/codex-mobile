import { expect, it, vi } from "vitest";
import { withProjectWorktree } from "../../src/features/threads/project-worktrees";
import { aggregateThreads, groupThreadsByProject } from "../../src/features/threads/thread-list-model";
import { loadProjectThreadRecords } from "../../src/app-server/thread-list-loader";

const membership = {
  byThreadId: { moved: "/cad", migrated: "/cad" },
  byProjectId: { "native-mobile": "/mobile" },
  extraRoots: { "/cad": ["/mobile"] },
};

it("显式项目优先于执行目录与旧迁移记录，无项目优先级保持", () => {
  expect(withProjectWorktree({ id: "moved", cwd: "/mobile" }, {}, membership))
    .toEqual({ id: "moved", cwd: "/mobile", projectCwd: "/cad" });
  expect(withProjectWorktree({ id: "migrated", cwd: "/mobile", projectId: "native-mobile" }, {}, membership))
    .toMatchObject({ projectCwd: "/mobile" });
  expect(withProjectWorktree({ id: "moved", cwd: "/mobile", isProjectless: true }, {}, membership))
    .not.toHaveProperty("projectCwd");
});

it("共享执行目录的会话只进入所属项目，分页继续补齐过滤掉的名额", async () => {
  const records = [
    { id: "mobile-1", cwd: "/mobile", recencyAt: 10 },
    { id: "moved", cwd: "/mobile", recencyAt: 9 },
    ...Array.from({ length: 6 }, (_, index) => ({ id: `cad-${index}`, cwd: "/cad", recencyAt: 8 - index })),
  ];
  const request = vi.fn(async (_method: string, params: { cwd: string | string[]; limit: number; cursor?: string }) => {
    const scoped = records.filter(thread => [params.cwd].flat().includes(thread.cwd));
    const offset = Number(params.cursor ?? 0);
    const end = offset + params.limit;
    return { data: scoped.slice(offset, end), nextCursor: end < scoped.length ? String(end) : null };
  });
  const client = { request, projectMembership: membership };
  const first = await loadProjectThreadRecords(client, "/cad");
  expect(first.threads.map(thread => thread.id)).toEqual(["moved", "cad-0", "cad-1", "cad-2", "cad-3"]);
  expect((await loadProjectThreadRecords(client, "/cad", first.nextCursor)).threads.map(thread => thread.id))
    .toEqual(["cad-4", "cad-5"]);
  expect((await loadProjectThreadRecords(client, "/mobile")).threads.map(thread => thread.id)).toEqual(["mobile-1"]);
});

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
