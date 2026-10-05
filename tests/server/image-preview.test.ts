import { mkdtemp, open, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { createGateway } from "../../server/gateway.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "codex-mobile-images-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const gateway = await createGateway({ host: "127.0.0.1", port: 0, mode: "external",
    upstreamUrl: "ws://127.0.0.1:9", staticDir: null, accessToken: "secret" });
  cleanups.push(() => gateway.close());
  const url = (path: string, thumbnail = true) => {
    const params = new URLSearchParams({ path, token: "secret" });
    if (thumbnail) params.set("thumbnail", "1");
    return `http://127.0.0.1:${gateway.port}/api/images/preview?${params}`;
  };
  return { root, url };
}

function svg(width: number, height: number, color = "red") {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${color}"/></svg>`;
}

async function body(response: Response) {
  return Buffer.from(await response.arrayBuffer());
}

describe("本地图片预览", () => {
  it("要求鉴权，并保留 CORS 和 cookie 鉴权", async () => {
    const { root, url } = await setup();
    const path = join(root, "private.svg");
    await writeFile(path, svg(80, 40));
    const endpoint = new URL(url(path));
    endpoint.searchParams.delete("token");
    const unauthenticated = await fetch(endpoint, { headers: { origin: "http://localhost:5173" } });
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    const authenticated = await fetch(endpoint, { headers: { cookie: "codex_mobile_token=secret" } });
    expect(authenticated.status).toBe(200);
    expect(authenticated.headers.get("x-codex-image-preview")).toBe("1");
    expect(authenticated.headers.get("content-type")).toBe("image/jpeg");
  });

  it.each([[1600, 800, 640, 320], [800, 1600, 320, 640], [80, 40, 80, 40]])(
    "将 %ix%i 等比缩放到 %ix%i，保留全图并避免放大", async (width, height, expectedWidth, expectedHeight) => {
      const { root, url } = await setup();
      const path = join(root, "image.svg");
      await writeFile(path, svg(width, height));
      const response = await fetch(url(path));
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("image/jpeg");
      const image = await body(response);
      expect(image.length).toBe(Number(response.headers.get("content-length")));
      expect(await sharp(image).metadata()).toMatchObject({ format: "jpeg", width: expectedWidth, height: expectedHeight });
    },
  );

  it.each(["png", "jpg", "jpeg", "gif", "webp", "avif", "svg"])("原样返回 %s 二进制内容", async (extension) => {
    const { root, url } = await setup();
    const path = join(root, `image.${extension}`);
    const source = extension === "svg" ? Buffer.from(svg(30, 20)) : await sharp({ create: {
      width: 30, height: 20, channels: 3, background: "red" } }).toFormat(extension === "jpg" ? "jpeg" : extension as "png").toBuffer();
    await writeFile(path, source);
    const response = await fetch(url(path, false));
    expect(response.status).toBe(200);
    expect(await body(response)).toEqual(source);
    const thumbnail = await fetch(url(path));
    expect(thumbnail.status).toBe(200);
    expect(await sharp(await body(thumbnail)).metadata()).toMatchObject({ format: "jpeg", width: 30, height: 20 });
    expect(response.headers.get("content-type")).toBe(extension === "svg" ? "image/svg+xml" : `image/${extension === "jpg" ? "jpeg" : extension}`);
  });

  it("对缺失、非绝对路径、不支持的格式及无效图片返回明确错误", async () => {
    const { root, url } = await setup();
    const missing = await fetch(url(join(root, "missing.png")), { headers: { origin: "http://localhost:5173" } });
    expect(missing.status).toBe(404);
    expect(missing.headers.get("x-codex-image-preview")).toBe("1");
    expect(missing.headers.get("access-control-expose-headers")).toContain("x-codex-image-preview");
    expect((await fetch(url("relative.png"))).status).toBe(415);
    expect((await fetch(url(join(root, "file.txt")))).status).toBe(415);
    const invalid = join(root, "invalid.png");
    await writeFile(invalid, "not an image");
    expect((await fetch(url(invalid))).status).toBe(415);
  });

  it("空文件返回 415，原图请求同样拒绝", async () => {
    const { root, url } = await setup();
    const path = join(root, "empty.png");
    await writeFile(path, "");
    expect((await fetch(url(path))).status).toBe(415);
    expect((await fetch(url(path, false))).status).toBe(415);
  });

  it("预检允许 HEAD 与条件缓存请求", async () => {
    const { root, url } = await setup();
    const response = await fetch(url(join(root, "image.png")), { method: "OPTIONS", headers: {
      origin: "http://localhost:5173", "access-control-request-method": "HEAD",
      "access-control-request-headers": "if-none-match",
    } });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-methods")).toContain("HEAD");
    expect(response.headers.get("access-control-allow-headers")).toContain("if-none-match");
  });

  it("拒绝超过输入字节或像素上限的图片", async () => {
    const { root, url } = await setup();
    const oversized = join(root, "large.png");
    const file = await open(oversized, "w");
    await file.truncate(64 * 1024 * 1024 + 1);
    await file.close();
    expect((await fetch(url(oversized))).status).toBe(413);
    expect((await fetch(url(oversized, false))).status).toBe(413);
    const pixels = join(root, "pixels.svg");
    await writeFile(pixels, svg(10000, 10000));
    expect((await fetch(url(pixels))).status).toBe(413);
  });

  it("私有缓存支持条件请求，覆盖同一路径后返回新缩略图", async () => {
    const { root, url } = await setup();
    const path = join(root, "overwrite.svg");
    await writeFile(path, svg(1000, 500));
    const first = await fetch(url(path));
    expect(first.status).toBe(200);
    const firstBytes = await body(first);
    const etag = first.headers.get("etag");
    expect(etag).toBeTruthy();
    expect(first.headers.get("cache-control")).toContain("private");
    expect(first.headers.get("cache-control")).toContain("no-cache");
    const cached = await fetch(url(path), { headers: { "if-none-match": etag! } });
    expect(cached.status).toBe(304);
    expect((await body(cached)).length).toBe(0);
    await writeFile(path, svg(500, 1000, "blue"));
    const next = await fetch(url(path), { headers: { "if-none-match": etag! } });
    expect(next.status).toBe(200);
    expect(next.headers.get("etag")).not.toBe(etag);
    const nextBytes = await body(next);
    expect(nextBytes).not.toEqual(firstBytes);
    expect(await sharp(nextBytes).metadata()).toMatchObject({ width: 320, height: 640 });
  });

  it("缩略图保留左右边缘内容", async () => {
    const { root, url } = await setup();
    const path = join(root, "edges.svg");
    await writeFile(path, `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="800"><rect width="800" height="800" fill="red"/><rect x="800" width="800" height="800" fill="blue"/></svg>`);
    const response = await fetch(url(path));
    expect(response.status).toBe(200);
    const { data, info } = await sharp(await body(response)).raw().toBuffer({ resolveWithObject: true });
    const pixel = (x: number) => Array.from(data.subarray((160 * info.width + x) * info.channels, (160 * info.width + x) * info.channels + 3));
    expect(pixel(1)[0]).toBeGreaterThan(240);
    expect(pixel(638)[2]).toBeGreaterThan(240);
  });

  it("原图缓存也能识别保留大小和 mtime 的覆盖", async () => {
    const { root, url } = await setup();
    const path = join(root, "original.svg");
    const firstSource = svg(80, 40, "red");
    const nextSource = svg(80, 40, "tan");
    await writeFile(path, firstSource);
    const before = await stat(path);
    const first = await fetch(url(path, false));
    const etag = first.headers.get("etag")!;
    expect((await body(first)).toString()).toBe(firstSource);
    expect((await fetch(url(path, false), { headers: { "if-none-match": etag } })).status).toBe(304);
    await writeFile(path, nextSource);
    await utimes(path, before.atime, before.mtime);
    expect((await stat(path)).size).toBe(before.size);
    const next = await fetch(url(path, false), { headers: { "if-none-match": etag } });
    expect(next.status).toBe(200);
    expect(next.headers.get("etag")).not.toBe(etag);
    expect((await body(next)).toString()).toBe(nextSource);
  });

  it("客户端取消原图下载后网关仍可处理后续请求", async () => {
    const { root, url } = await setup();
    const path = join(root, "stream.png");
    await writeFile(path, Buffer.alloc(16 * 1024 * 1024));
    const response = await fetch(url(path, false));
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    expect((await reader.read()).done).toBe(false);
    await reader.cancel();
    await writeFile(join(root, "next.svg"), svg(30, 20));
    expect((await fetch(url(join(root, "next.svg")))).status).toBe(200);
  });

  it("独立缩略图过载请求返回 503，避免无限排队", async () => {
    const { root, url } = await setup();
    const paths = Array.from({ length: 48 }, (_, index) => join(root, `busy-${index}.svg`));
    await Promise.all(paths.map((path) => writeFile(path, svg(5000, 5000))));
    const responses = await Promise.all(paths.map((path) => fetch(url(path))));
    expect(responses.some((response) => response.status === 503)).toBe(true);
    for (const response of responses) expect([200, 503]).toContain(response.status);
    await Promise.all(responses.map(body));
  }, 15_000);

  it("取消大量排队请求后后续缩略图可正常加载", async () => {
    const { root, url } = await setup();
    const paths = Array.from({ length: 18 }, (_, index) => join(root, `cancel-${index}.svg`));
    await Promise.all(paths.map((path) => writeFile(path, svg(5000, 5000))));
    const controllers = paths.map(() => new AbortController());
    const requests = paths.map((path, index) => fetch(url(path), { signal: controllers[index].signal }).catch(() => null));
    await new Promise((resolve) => setTimeout(resolve, 10));
    for (const controller of controllers) controller.abort();
    await Promise.all(requests);
    const next = join(root, "after-cancel.svg");
    await writeFile(next, svg(30, 20));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect((await fetch(url(next))).status).toBe(200);
  }, 15_000);

  it("同一路径的首个请求取消不会破坏其他等待者", async () => {
    const { root, url } = await setup();
    const path = join(root, "shared-cancel.svg");
    await writeFile(path, svg(5000, 5000));
    const controller = new AbortController();
    const first = fetch(url(path), { signal: controller.signal }).catch(() => null);
    const second = fetch(url(path));
    await new Promise((resolve) => setTimeout(resolve, 5));
    controller.abort();
    await first;
    const response = await second;
    expect(response.status).toBe(200);
    expect(await sharp(await body(response)).metadata()).toMatchObject({ width: 640, height: 640 });
  });

  it("同时请求同一路径可得到相同缩略图，HEAD 返回元数据", async () => {
    const { root, url } = await setup();
    const path = join(root, "parallel.svg");
    await writeFile(path, svg(1600, 800));
    const responses = await Promise.all(Array.from({ length: 8 }, () => fetch(url(path))));
    for (const response of responses) expect(response.status).toBe(200);
    const bodies = await Promise.all(responses.map(body));
    for (const bytes of bodies) expect(bytes).toEqual(bodies[0]);
    const head = await fetch(url(path), { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(Number(head.headers.get("content-length"))).toBe(bodies[0].length);
    expect((await body(head)).length).toBe(0);
  });
});
