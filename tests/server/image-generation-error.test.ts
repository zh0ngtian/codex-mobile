import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readImageGenerationError } from "../../server/image-generation-error.js";

const threadId = "01a10355-60cd-70f2-8063-17d3a5626be4";
const itemId = "exec-5c1162b3-3aba-455b-85d8-0b59d9bbb28b";
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function sessionRoot(lines: unknown[]) {
  const root = await mkdtemp(join(tmpdir(), "codex-image-error-"));
  roots.push(root);
  const created = new Date(Number.parseInt(threadId.replaceAll("-", "").slice(0, 12), 16));
  const directory = join(root, "sessions", String(created.getFullYear()),
    String(created.getMonth() + 1).padStart(2, "0"), String(created.getDate()).padStart(2, "0"));
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, `rollout-2026-10-04T03-54-49-${threadId}.jsonl`),
    lines.map((line) => JSON.stringify(line)).join("\n") + "\n");
  return root;
}

describe("图像生成失败诊断", () => {
  it("只提取匹配条目的审核类别、阶段和请求 ID", async () => {
    const error = { error: {
      code: "moderation_blocked",
      message: "Your request was rejected by the safety system. Include the request ID req-image-1. safety_violations=[sexual].",
      moderation_details: { moderation_stage: "output", categories: ["sexual"] },
    } };
    const root = await sessionRoot([
      { type: "event_msg", payload: { type: "item_completed", item: {
        type: "Extension", kind: "image_gen.generation", id: "other", status: "failed",
      } } },
      { type: "response_item", payload: { type: "custom_tool_call_output", output: [{ type: "input_text", text: "unrelated" }] } },
      { type: "event_msg", payload: { type: "item_completed", item: {
        type: "Extension", kind: "image_gen.generation", id: itemId, status: "failed",
      } } },
      { type: "response_item", payload: { type: "custom_tool_call_output", output: [{
        type: "input_text", text: `Script error: image generation failed: Some(${JSON.stringify(JSON.stringify(error))})`,
      }] } },
    ]);

    await expect(readImageGenerationError(root, threadId, itemId)).resolves.toEqual({
      code: "moderation_blocked", stage: "output", categories: ["sexual"], requestId: "req-image-1",
    });
    await expect(readImageGenerationError(root, threadId, "missing-item")).resolves.toBeNull();
  });

  it("没有结构化错误时不猜测审核原因", async () => {
    const root = await sessionRoot([
      { type: "event_msg", payload: { type: "item_completed", item: {
        type: "Extension", kind: "image_gen.generation", id: itemId, status: "failed",
      } } },
      { type: "response_item", payload: { type: "custom_tool_call_output", output: [{ type: "input_text", text: "Script failed" }] } },
    ]);
    await expect(readImageGenerationError(root, threadId, itemId)).resolves.toBeNull();
  });
});
