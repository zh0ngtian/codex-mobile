import { describe, expect, it } from "vitest";
import {
  mergeProjectlessThreadIds,
  readLocalProjectlessThreadIds,
  writeLocalProjectlessThreadIds,
} from "../../src/features/threads/projectless-threads";

describe("无项目会话本地标记", () => {
  it("按设备持久化并合并服务端会话 ID", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };

    writeLocalProjectlessThreadIds(storage, "mini", ["local-1", "local-1"]);

    expect(readLocalProjectlessThreadIds(storage, "mini")).toEqual(["local-1"]);
    expect(
      mergeProjectlessThreadIds(["server-1", "local-1"], ["local-1"]),
    ).toEqual(["server-1", "local-1"]);
  });
});
