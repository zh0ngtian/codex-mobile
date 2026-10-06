import { mkdtemp, readFile, readdir, rm, writeFile, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { InlineImages } from "../../server/inline-images.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function setup(maxBytes?: number) {
  const root = await mkdtemp(join(tmpdir(), "codex-inline-images-")); roots.push(root);
  return { root, images: new InlineImages(join(root, "images"), maxBytes) };
}
const page = (data: Buffer) => ({ data: [{ id: "turn", items: [{ type: "userMessage", content: [
  { type: "image", url: `data:image/png;base64,${data.toString("base64")}`, detail: "original" },
] }] }], nextCursor: "older" });
const path = (result: any) => result.data[0].items[0].content[0].url as string;

describe("内联历史图片缓存", () => {
  it("并发重复图片和网关重启复用同一原文件，不修改上游对象", async () => {
    const { root, images } = await setup(); const data = Buffer.from("original image bytes"); const original = page(data);
    const replies = await Promise.all([images.result(original), images.result(original)]);
    expect(path(replies[0])).toBe(path(replies[1])); expect(path(replies[0]).startsWith("data:")).toBe(false);
    expect(await readFile(path(replies[0]))).toEqual(data);
    expect(original.data[0].items[0].content[0].url.startsWith("data:")).toBe(true);
    expect(replies[0].nextCursor).toBe("older"); expect(replies[0].data[0].items[0].content[0].detail).toBe("original");
    expect(await readdir(join(root, "images"))).toHaveLength(1);
    expect(path(await new InlineImages(join(root, "images")).result(original))).toBe(path(replies[0]));
  });
  it("生成图片原字节保留，有文件引用时不重复携带 data URL", async () => {
    const { images } = await setup(); const data = Buffer.from("generated image");
    const result = await images.result({ data: [{ items: [
      { id: "i", type: "imageGeneration", result: `data:image/png;base64,${data.toString("base64")}` },
      { id: "saved", type: "imageGeneration", savedPath: "/tmp/original.png", result: `data:image/png;base64,${data.toString("base64")}` },
    ] }] });
    expect(await readFile(result.data[0].items[0].savedPath)).toEqual(data);
    expect(result.data[0].items[0].result).toBeUndefined(); expect(result.data[0].items[1].savedPath).toBe("/tmp/original.png");
    expect(result.data[0].items[1].result).toBeUndefined();
  });
  it("容量上限淘汰旧缓存，仅删除本缓存文件", async () => {
    const { root, images } = await setup(25); const first = path(await images.result(page(Buffer.alloc(20, 1))));
    await utimes(first, new Date(0), new Date(0)); await writeFile(join(root, "images", "keep.txt"), "keep");
    const second = path(await images.result(page(Buffer.alloc(20, 2))));
    await expect(readFile(first)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(second)).toEqual(Buffer.alloc(20, 2)); expect(await readFile(join(root, "images", "keep.txt"), "utf8")).toBe("keep");
  });
  it("写入失败、无效 data URL 和超过缓存上限时保留原响应", async () => {
    const { root, images } = await setup(4); await writeFile(join(root, "not-directory"), "blocked");
    const original = page(Buffer.from("more than four bytes"));
    expect(await images.result(original)).toEqual(original);
    expect(await new InlineImages(join(root, "not-directory", "images")).result(original)).toEqual(original);
    const invalid = { data: [{ items: [{ type: "userMessage", content: [{ type: "image", url: "data:image/png;base64,invalid!" }, { type: "text", text: "data:image/png;base64,aabb" }] }] }] };
    expect(await images.result(invalid)).toEqual(invalid);
  });
});
