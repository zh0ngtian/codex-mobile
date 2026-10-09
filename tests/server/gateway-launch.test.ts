import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";

it("跨平台启动 External 网关，退出时不关闭上游", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-gateway-launch-"));
  const runtime = join(root, "runtime.json");
  const upstream = createServer((_request, response) => response.end("ok"));
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const upstreamUrl = `ws://127.0.0.1:${(upstream.address() as { port: number }).port}`;
  const child = spawn(process.execPath, ["--import", "tsx", "scripts/start-gateway.mjs"], {
    cwd: resolve("."),
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NODE_ENV: "test", CODEX_HOME: root, HOST: "127.0.0.1", PORT: "0",
      CODEX_APP_SERVER_MODE: "external", CODEX_APP_SERVER_URL: upstreamUrl,
      CODEX_MOBILE_SERVE_STATIC: "false", CODEX_MOBILE_TOKEN: "launch-test-token",
      CODEX_MOBILE_RUNTIME_FILE: runtime },
  });
  let errors = "";
  child.stderr!.on("data", (chunk) => { errors += chunk; });
  const exited = once(child, "exit");
  try {
    let port: number | undefined;
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline && child.exitCode === null) {
      try { port = JSON.parse(await readFile(runtime, "utf8")).port; break; }
      catch { await new Promise((resolve) => setTimeout(resolve, 30)); }
    }
    expect(port, errors || "启动超时").toBeGreaterThan(0);
    const response = await fetch(`http://127.0.0.1:${port}/api/status?token=launch-test-token`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ mode: "external", upstreamUrl });
    expect((await fetch(`http://127.0.0.1:${port}/api/status`)).status).toBe(401);
  } finally {
    if (child.exitCode === null) child.kill();
    await exited;
    const stillListening = upstream.listening;
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
    expect(stillListening).toBe(true);
  }
}, 15_000);
