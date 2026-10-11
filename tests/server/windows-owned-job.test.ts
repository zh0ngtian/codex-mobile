import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

function running(pid: number) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}
async function until(predicate: () => boolean | Promise<boolean>, ms = 12_000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("等待测试进程状态超时");
}

describe.skipIf(process.platform !== "win32")("Windows 所属进程 Job", () => {
  it.each([false, true])("宿主退出时清理子进程和孙进程（异常退出=%s）", async (abrupt) => {
    const source = resolve("scripts/windows/OwnedProcessJob.cs");
    // 仅启动本测试创建的 Node 进程，不启动/终止桌面 Codex 或实际 app-server。
    await readFile(source, "utf8");
    const root = await mkdtemp(join(tmpdir(), "codex-owned-job-"));
    const marker = join(root, "pids.json");
    const worker = join(root, "worker.cjs");
    await writeFile(worker, `const cp=require('node:child_process');const fs=require('node:fs');
const leaf=cp.spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
fs.writeFileSync(process.argv[2],JSON.stringify({parent:process.pid,leaf:leaf.pid,arg:process.argv[3]}));
setInterval(()=>{},1000);`);
    const controller = join(root, "controller.ps1");
    await writeFile(controller, String.raw`param([string]$Source,[string]$Node,[string]$Worker,[string]$Marker)
$ErrorActionPreference='Stop'
Add-Type -Path $Source
$job=New-Object CodexMobile.OwnedProcessJob
try {
  $null=$job.Start($Node,[string[]]@($Worker,$Marker,'space "quote" trailing\'),(Split-Path $Worker),$false)
  while (-not (Test-Path -LiteralPath ($Marker+'.release'))) { Start-Sleep -Milliseconds 50 }
} finally { $job.Dispose() }
`);
    const host = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "RemoteSigned", "-File", controller, "-Source", source,
      "-Node", process.execPath, "-Worker", worker, "-Marker", marker], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    host.stderr!.on("data", (chunk) => { stderr += chunk; });
    const exited = once(host, "exit");
    let pids: { parent: number; leaf: number; arg: string } | undefined;
    try {
      await until(async () => {
        if (host.exitCode !== null) throw new Error(stderr || `控制器退出 ${host.exitCode}`);
        try { pids = JSON.parse(await readFile(marker, "utf8")); return true; } catch { return false; }
      });
      expect(pids!.arg).toBe('space "quote" trailing\\');
      expect(running(pids!.parent) && running(pids!.leaf)).toBe(true);
      if (abrupt) host.kill();
      else await writeFile(marker + ".release", "exit");
      await exited;
      await until(() => !running(pids!.parent) && !running(pids!.leaf));
    } finally {
      if (host.exitCode === null && host.signalCode === null) host.kill();
      await exited;
      if (pids) for (const pid of [pids.parent, pids.leaf]) if (running(pid)) process.kill(pid);
      await rm(root, { recursive: true, force: true });
    }
  }, 20_000);
});
