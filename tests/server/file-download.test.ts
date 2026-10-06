import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createGateway } from "../../server/gateway.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "codex-download-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const gateway = await createGateway({ host: "127.0.0.1", port: 0, mode: "external",
    upstreamUrl: "ws://127.0.0.1:9", staticDir: null, accessToken: "secret", codexHome: root });
  cleanups.push(() => gateway.close());
  const url = (path: string) => `http://127.0.0.1:${gateway.port}/api/files/download/${encodeURIComponent(path.split("/").at(-1)!)}?${new URLSearchParams({ path, token: "secret" })}`;
  return { root, url };
}
describe("电脑文件下载", () => {
  it("中文照片经鉴权返回原文件字节、大小、文件名和 HEAD", async () => {
    const { root, url } = await setup();
    const path = join(root, "斗兽场照片_裙摆加长.png");
    const bytes = Buffer.from([137, 80, 78, 71, 0, 1, 2, 255]);
    await writeFile(path, bytes);
    const unauthenticated = new URL(url(path)); unauthenticated.searchParams.delete("token");
    expect((await fetch(unauthenticated)).status).toBe(401);
    const response = await fetch(url(path), { headers: { origin: "http://phone" } });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe(`attachment; filename*=UTF-8''${encodeURIComponent("斗兽场照片_裙摆加长.png")}`);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("content-length")).toBe(String(bytes.length));
    expect(response.headers.get("access-control-allow-origin")).toBe("http://phone");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
    const head = await fetch(url(path), { method: "HEAD" });
    expect(head.status).toBe(200); expect(head.headers.get("content-length")).toBe(String(bytes.length));
    expect((await head.arrayBuffer()).byteLength).toBe(0);
  });
  it("下载通用二进制文件并拒绝非法路径、目录和缺失文件", async () => {
    const { root, url } = await setup();
    const path = join(root, "file.bin"); await writeFile(path, Buffer.from([0, 255]));
    expect(Buffer.from(await (await fetch(url(path))).arrayBuffer())).toEqual(Buffer.from([0, 255]));
    expect((await fetch(url("relative.png"))).status).toBe(400);
    expect((await fetch(url(join(root, "missing.png")))).status).toBe(404);
    const directory = join(root, "directory.png"); await mkdir(directory);
    expect((await fetch(url(directory))).status).toBe(404);
    const preflight = await fetch(url(path), { method: "OPTIONS", headers: { origin: "http://phone" } });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-methods")).toContain("HEAD");
  });
});
