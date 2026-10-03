import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import { createInterface } from "node:readline";
import { join } from "node:path";

export interface ImageGenerationError {
  code: string;
  stage: string;
  categories: string[];
  requestId: string | null;
}

function moderationError(output: unknown): ImageGenerationError | null {
  if (!Array.isArray(output)) return null;
  for (const part of output) {
    const text = typeof part?.text === "string" ? part.text : "";
    const quoted = text.match(/Some\(("(?:\\.|[^"\\])*")\)/s)?.[1];
    if (!quoted) continue;
    try {
      const parsed = JSON.parse(JSON.parse(quoted));
      const error = parsed?.error;
      if (error?.code !== "moderation_blocked") continue;
      const details = error.moderation_details;
      const categories = Array.isArray(details?.categories)
        ? details.categories.filter((value: unknown) => typeof value === "string" && value.length <= 40)
        : [];
      const stage = typeof details?.moderation_stage === "string" ? details.moderation_stage : "unknown";
      const requestId = typeof error.message === "string"
        ? error.message.match(/request ID ([A-Za-z0-9_-]+)/)?.[1] ?? null
        : null;
      return { code: "moderation_blocked", stage, categories, requestId };
    } catch {
      // An unrecognized tool error cannot be labeled as a moderation failure.
    }
  }
  return null;
}

export async function readImageGenerationError(
  codexHome: string,
  threadId: string,
  itemId: string,
): Promise<ImageGenerationError | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(threadId) ||
      !/^[A-Za-z0-9_-]{1,100}$/.test(itemId)) return null;
  const created = new Date(Number.parseInt(threadId.replaceAll("-", "").slice(0, 12), 16));
  if (!Number.isFinite(created.getTime())) return null;
  const directory = join(codexHome, "sessions", String(created.getFullYear()),
    String(created.getMonth() + 1).padStart(2, "0"), String(created.getDate()).padStart(2, "0"));
  let files: string[];
  try { files = await readdir(directory); } catch { return null; }
  const filename = files.find((name) => name.startsWith("rollout-") && name.endsWith(`-${threadId}.jsonl`));
  if (!filename) return null;
  const lines = createInterface({ input: createReadStream(join(directory, filename)), crlfDelay: Infinity });
  let found = false;
  try {
    for await (const line of lines) {
      if (!found) {
        if (!line.includes(itemId) || !line.includes("image_gen.generation")) continue;
        try {
          const entry = JSON.parse(line);
          const item = entry?.payload?.item;
          found = entry.type === "event_msg" && entry.payload?.type === "item_completed" &&
            item?.kind === "image_gen.generation" && item?.id === itemId && item?.status === "failed";
        } catch { /* Ignore malformed rollout lines. */ }
        continue;
      }
      if (!line.includes("custom_tool_call_output")) continue;
      try {
        const entry = JSON.parse(line);
        if (entry.type === "response_item" && entry.payload?.type === "custom_tool_call_output") {
          return moderationError(entry.payload.output);
        }
      } catch { return null; }
    }
  } finally {
    lines.close();
  }
  return null;
}
