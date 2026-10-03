import type { BackendConfig } from "./types";

export interface ImageGenerationError {
  code: string;
  stage: string;
  categories: string[];
  requestId: string | null;
}

export async function fetchImageGenerationError(
  backend: BackendConfig,
  threadId: string,
  itemId: string,
): Promise<ImageGenerationError | null> {
  const url = new URL("/api/image-generation-error", `${backend.baseUrl}/`);
  url.searchParams.set("threadId", threadId);
  url.searchParams.set("itemId", itemId);
  if (backend.token) url.searchParams.set("token", backend.token);
  const response = await fetch(url);
  if (!response.ok) return null;
  const body = await response.json();
  const error = body?.error;
  if (!error || typeof error.code !== "string") return null;
  return error as ImageGenerationError;
}
