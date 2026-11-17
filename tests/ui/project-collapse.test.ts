import { beforeEach, describe, expect, it } from "vitest";
import {
  projectCollapseKey,
  collapseNewBackendProjects,
  isProjectCollapsed,
  toggleProjectCollapsedKeys,
  readCollapsedProjectKeys,
  writeCollapsedProjectKeys,
} from "../../src/features/threads/project-collapse";

describe("项目折叠缓存", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("按照机器和目录生成稳定的项目键", () => {
    expect(projectCollapseKey("mini", "/tmp/project")).toBe(
      "mini:/tmp/project",
    );
  });

  it("首次使用没有缓存时所有设备和后续出现的项目默认折叠，手动展开跨重启保留", () => {
    let keys = readCollapsedProjectKeys(localStorage);
    for (const device of ["first", "second"]) {
      for (const cwd of ["/a", "/future", "codex-mobile://projectless"]) {
        expect(isProjectCollapsed(keys, device, cwd)).toBe(true);
      }
    }
    keys = toggleProjectCollapsedKeys(keys, "first", "/a");
    writeCollapsedProjectKeys(localStorage, keys);
    keys = readCollapsedProjectKeys(localStorage);
    expect(isProjectCollapsed(keys, "first", "/a")).toBe(false);
    expect(isProjectCollapsed(keys, "second", "/a")).toBe(true);
    expect(isProjectCollapsed(keys, "first", "/future")).toBe(true);
    expect(isProjectCollapsed(toggleProjectCollapsedKeys(keys, "first", "/a"), "first", "/a")).toBe(true);
  });

  it("已有空缓存明确表示全部展开，不因重启重置", () => {
    writeCollapsedProjectKeys(localStorage, new Set());
    expect(isProjectCollapsed(readCollapsedProjectKeys(localStorage), "existing", "/a")).toBe(false);
  });

  it("新设备所有分组默认折叠，显式展开和重启记忆只影响该分组", () => {
    let keys = collapseNewBackendProjects(new Set(["old:/closed"]), ["new"]);
    expect(isProjectCollapsed(keys, "old", "/open")).toBe(false);
    expect(isProjectCollapsed(keys, "old", "/closed")).toBe(true);
    for (const cwd of ["/a", "/future", "codex-mobile://projectless"]) expect(isProjectCollapsed(keys, "new", cwd)).toBe(true);
    keys = toggleProjectCollapsedKeys(keys, "new", "/a");
    writeCollapsedProjectKeys(localStorage, keys);
    keys = readCollapsedProjectKeys(localStorage);
    expect(isProjectCollapsed(keys, "new", "/a")).toBe(false);
    expect(isProjectCollapsed(keys, "new", "/future")).toBe(true);
    expect(isProjectCollapsed(toggleProjectCollapsedKeys(keys, "new", "/a"), "new", "/a")).toBe(true);
    expect(isProjectCollapsed(collapseNewBackendProjects(keys, ["second"]), "new", "/a")).toBe(false);
  });

  it("写入并恢复折叠项目集合", () => {
    writeCollapsedProjectKeys(
      window.localStorage,
      new Set(["mini:/tmp/a", "mac:/tmp/b"]),
    );

    expect(readCollapsedProjectKeys(window.localStorage)).toEqual(
      new Set(["mini:/tmp/a", "mac:/tmp/b"]),
    );
  });

  it("忽略损坏或非字符串数组缓存", () => {
    window.localStorage.setItem(
      "codex-mobile:collapsed-projects",
      "{\"bad\":true}",
    );
    expect(readCollapsedProjectKeys(window.localStorage)).toEqual(new Set());

    window.localStorage.setItem(
      "codex-mobile:collapsed-projects",
      "[\"mini:/tmp/a\",2]",
    );
    expect(readCollapsedProjectKeys(window.localStorage)).toEqual(new Set());
  });
});
