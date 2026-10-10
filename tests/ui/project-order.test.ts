import { describe, expect, it } from "vitest";
import { applyProjectOrder, moveProject, readProjectOrders, writeProjectOrders } from "../../src/features/threads/project-order";
import { PROJECTLESS_GROUP_ID } from "../../src/app-server/thread-list-loader";

describe("本机项目顺序", () => {
  it("未识别目录的现有会话分组仍然显示", () => {
    expect(applyProjectOrder(["/a", ""], [])).toEqual(["/a", ""]);
  });

  it("沿用已保存顺序，去重并追加新目录，忽略失效目录", () => {
    expect(applyProjectOrder(["/a", "/b", "/a", "/c"], ["/gone", "/b", "/a", "/b"]))
      .toEqual(["/b", "/a", "/c"]);
  });
  it("无项目始终在前且不能被移动", () => {
    expect(applyProjectOrder(["/a", PROJECTLESS_GROUP_ID, "/b"], ["/b", PROJECTLESS_GROUP_ID, "/a"]))
      .toEqual([PROJECTLESS_GROUP_ID, "/b", "/a"]);
    expect(moveProject([PROJECTLESS_GROUP_ID, "/a", "/b"], PROJECTLESS_GROUP_ID, "/b", "after"))
      .toEqual([PROJECTLESS_GROUP_ID, "/a", "/b"]);
  });
  it("向上向下移动保留其他目录的相对顺序", () => {
    expect(moveProject(["/a", "/b", "/c"], "/a", "/c", "after")).toEqual(["/b", "/c", "/a"]);
    expect(moveProject(["/a", "/b", "/c"], "/c", "/a", "before")).toEqual(["/c", "/a", "/b"]);
    expect(moveProject(["/a", "/b"], "/gone", "/b", "before")).toEqual(["/a", "/b"]);
  });
  it("不同后端即使同一路径也保留独立偏好", () => {
    const storage = { value: "", getItem() { return this.value; }, setItem(_key: string, value: string) { this.value = value; } };
    writeProjectOrders(storage, { mini: ["/b", "/a"], studio: ["/a", "/b"] });
    expect(readProjectOrders(storage)).toEqual({ mini: ["/b", "/a"], studio: ["/a", "/b"] });
  });
  it.each(["broken", "null", "[]", '{"mini":[42]}'])("存储损坏 %s 时使用默认顺序", (value) => {
    expect(readProjectOrders({ getItem: () => value })).toEqual({});
  });
});
