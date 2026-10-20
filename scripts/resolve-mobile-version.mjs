#!/usr/bin/env node
import { readFile, appendFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export function versionCode(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) throw new Error("版本必须为 major.minor.patch");
  const [major, minor, patch] = version.split(".").map(Number);
  const code = major * 1_000_000 + minor * 1_000 + patch;
  if (minor > 999 || patch > 999 || !Number.isSafeInteger(code) || code <= 0 || code > 2_100_000_000) {
    throw new Error(`无效 Android versionCode：${version}`);
  }
  return code;
}

export function resolveVersion(tags, floor, requested) {
  if (!Array.isArray(tags)) throw new Error("Release 标签必须为数组");
  const versions = [floor];
  for (const tag of tags) {
    const match = typeof tag === "string" && /^(?:v)?(\d+\.\d+\.\d+)$|^unsigned-ipa-(\d+\.\d+\.\d+)-\d+-\d+$/.exec(tag);
    if (match) versions.push(match[1] || match[2]);
  }
  const highest = versions.sort((a, b) => versionCode(a) - versionCode(b)).at(-1);
  const maximumCode = versionCode(highest);
  let version = requested?.replace(/^v/, "");
  if (version) {
    if (versionCode(version) <= maximumCode) throw new Error(`指定版本必须高于 ${highest}`);
  } else {
    let [major, minor, patch] = highest.split(".").map(Number);
    if (++patch > 999) { patch = 0; if (++minor > 999) { minor = 0; major++; } }
    version = `${major}.${minor}.${patch}`;
  }
  return { app_version: version, app_version_code: String(versionCode(version)), release_tag: `v${version}` };
}

async function main() {
  const { values } = parseArgs({ options: { releases: { type: "string" }, requested: { type: "string" } } });
  if (!values.releases) throw new Error("必须提供 --releases JSON 文件");
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const floor = JSON.parse(await readFile(resolve(root, "mobile-version-floor.json"), "utf8")).version;
  const tags = JSON.parse(await readFile(values.releases, "utf8"));
  const result = resolveVersion(tags, floor, values.requested);
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, Object.entries(result).map(([key, value]) => `${key}=${value}\n`).join(""));
  }
  console.log(JSON.stringify(result));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
