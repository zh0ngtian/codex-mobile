import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { readLocalThreadMetadata } from "../../server/local-thread-metadata.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
const id = "01a12457-49bd-79c3-abdb-cfdf41878cfc";
async function fixture(line: string, archived = false) {
  const root = await mkdtemp(join(tmpdir(), "thread-classification-")); roots.push(root);
  const directory = archived ? join(root, "archived_sessions") : join(root, "sessions", "2026", "10", "10");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, `rollout-2026-10-10T13-44-22-${id}.jsonl`), line);
  return root;
}
it.each([false, true])("只读取活动/归档首行分类字段 archived=%s", async (archived) => {
  const payload = { id, source: { subagent: "review" }, thread_source: "subagent", parent_thread_id: "parent", ephemeral: true, cwd: "/private", base_instructions: "private instructions" };
  const root = await fixture(JSON.stringify({ type: "session_meta", payload }) + '\n{"type":"event_msg","payload":"private body"}\n', archived);
  expect(await readLocalThreadMetadata(root, id)).toEqual({ id, source: payload.source, threadSource: "subagent", parentThreadId: "parent", ephemeral: true });
});
it.each([
  '{invalid}\n',
  JSON.stringify({ type: "session_meta", payload: { id: "wrong", thread_source: "subagent" } }) + '\n',
  JSON.stringify({ type: "event_msg", payload: { id, thread_source: "subagent" } }) + '\n',
  JSON.stringify({ type: "session_meta", payload: { id, thread_source: "subagent", extra: 'x'.repeat(65536) } }) + '\n',
])("无效或超大元数据不作为分类依据", async (line) => {
  const root = await fixture(line);
  expect(await readLocalThreadMetadata(root, id)).toBeUndefined();
});
it("未知线程和路径输入不提供分类", async () => {
  const root = await fixture('\n');
  expect(await readLocalThreadMetadata(root, '../archived_sessions')).toBeUndefined();
  expect(await readLocalThreadMetadata(root, '01a12457-49bd-79c3-abdb-cfdf41878cff')).toBeUndefined();
});
