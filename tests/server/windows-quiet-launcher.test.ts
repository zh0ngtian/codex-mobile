import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

async function run(file: string, args: string[], cwd: string, windowsHide = false) {
  const child = spawn(file, args, { cwd, windowsHide, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (bytes) => { output += bytes; });
  child.stderr.on("data", (bytes) => { output += bytes; });
  return await new Promise<{ code: number | null; output: string }>((accept, reject) => {
    child.once("error", reject);
    child.once("close", (code) => accept({ code, output }));
  });
}

async function fixture(check: (root: string, launcher: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "codex-quiet-launcher-"));
  const deployment = join(root, "service root with spaces");
  try {
    const builder = resolve("scripts/windows/build-quiet-launcher.ps1");
    const build = await run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "RemoteSigned", "-File", builder,
      "-OutputDirectory", deployment], root, true);
    expect(build.code, build.output).toBe(0);
    const launcher = build.output.trim();
    // A console-subsystem executable can open Windows Terminal before hiding its child.
    const pe = await readFile(launcher);
    const peOffset = pe.readUInt32LE(0x3c);
    expect(pe.readUInt16LE(peOffset + 24 + 68)).toBe(2);
    await check(deployment, launcher);
  } finally {
    if (!resolve(root).startsWith(resolve(tmpdir()) + sep) || !root.includes("codex-quiet-launcher-")) throw new Error("Unsafe test cleanup");
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

const consoleProbe = String.raw`
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class ConsoleProbe { [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow(); }'
`;

describe.skipIf(process.platform !== "win32")("Windows 无终端启动入口", () => {
  // Removing CreateNoWindow, dropping a quoted path, or leaving the launcher running breaks this.
  it("启动界面时不分配控制台，并传递带空格的服务路径后退出", async () => {
    await fixture(async (root, launcher) => {
      await writeFile(join(root, "manage-service.ps1"), `param([string]$ServiceRoot,[string]$Action)
${consoleProbe}
@{root=$ServiceRoot;action=$Action;console=[ConsoleProbe]::GetConsoleWindow().ToInt64()} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $ServiceRoot 'result.json')
`);
      const result = await run(launcher, ["ui"], root);
      expect(result.code, result.output).toBe(0);
      const receipt = JSON.parse(await readFile(join(root, "result.json"), "utf8"));
      expect(receipt).toEqual({ root, action: "ui", console: 0 });
    });
  }, 20_000);

  // Swallowing the child exit code disables Task Scheduler's configured retry behavior.
  it("后台宿主也不分配控制台，并保留失败退出码供计划任务重试", async () => {
    await fixture(async (root, launcher) => {
      await writeFile(join(root, "start-independent-service.ps1"), `param([string]$ConfigPath)
${consoleProbe}
@{config=$ConfigPath;console=[ConsoleProbe]::GetConsoleWindow().ToInt64()} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path (Split-Path $ConfigPath) 'result.json')
exit 23
`);
      const result = await run(launcher, ["backend"], root);
      expect(result.code, result.output).toBe(23);
      const receipt = JSON.parse(await readFile(join(root, "result.json"), "utf8"));
      expect(receipt).toEqual({ config: join(root, "service.json"), console: 0 });
    });
  }, 20_000);
});
