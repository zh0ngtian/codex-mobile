import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { readCodexProjectState } from "../../server/codex-projects.js";

it("从Git关联读取含空格worktree，忽略同名独立仓库且保留显式登记的项目", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "project-worktrees-"));
  const directory = await realpath(temporary);
  const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-C", cwd, ...args], { stdio: "pipe" });
  try {
    const root = join(directory, "project"), worktree = join(directory, "工作 副本", "checkout"), explicit = join(directory, "explicit"), other = join(directory, "other", "project"), plain = join(directory, "plain");
    for (const path of [root, other, plain]) await mkdir(path, { recursive: true });
    for (const path of [root, other]) {
      git(path, "init", "-q");
      git(path, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-m", "fixture");
    }
    git(root, "worktree", "add", "--detach", worktree, "HEAD");
    git(root, "worktree", "add", "--detach", explicit, "HEAD");
    const path = join(directory, "state.json");
    await writeFile(path, JSON.stringify({ "local-projects": { p: { rootPaths: [root, other, plain, explicit, join(directory, "deleted")] } } }));
    const state = await readCodexProjectState(path);
    expect(state.projectWorktrees).toEqual({ [root]: [worktree] });
    expect(state.projects).toContain(explicit);
    expect(state.projectlessThreadIds).toEqual([]);
    git(root, "worktree", "remove", worktree);
    expect((await readCodexProjectState(path)).projectWorktrees).toBeUndefined();
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
