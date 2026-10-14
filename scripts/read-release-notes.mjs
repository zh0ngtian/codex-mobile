#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const notesPath = "release/notes.md";

// GitHub Release、LAN 和 OTA 共用同一冻结来源，不能用构建模板补齐用户更新内容。
export async function readReleaseNotes(root, manifest) {
  let notes;
  if (Object.hasOwn(manifest, "releaseNotes")) {
    notes = manifest.releaseNotes;
  } else {
    const committed = spawnSync("git", ["show", `HEAD:${notesPath}`], { cwd: root, encoding: "utf8" });
    if (committed.error || committed.status !== 0) throw new Error(`更新日志必须提交到冻结仓库：${notesPath}`);
    notes = await readFile(join(root, notesPath), "utf8");
    if (notes !== committed.stdout) throw new Error(`更新日志工作区与冻结提交不一致：${notesPath}`);
  }
  if (typeof notes !== "string" || !notes.trim()) throw new Error("更新日志不能为空，必须提供本版本实际用户变化");
  return notes.trim();
}

async function main() {
  const { values } = parseArgs({ options: { root: { type: "string" } } });
  const root = resolve(values.root || process.cwd());
  const manifest = JSON.parse(await readFile(join(root, ".release-batch.json"), "utf8"));
  console.log(await readReleaseNotes(root, manifest));
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
