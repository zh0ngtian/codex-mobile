import type { BackendConfig } from "./types";
import type { DraftImage, UploadedFile } from "../ui/attachments";
import { t } from "../i18n";

type Fetcher = typeof fetch;

export function remoteFileDownloadUrl(backend: BackendConfig, path: string) {
  const name = path.split("/").at(-1) || "download";
  const url = new URL(`/api/files/download/${encodeURIComponent(name)}`, `${backend.baseUrl}/`);
  if (backend.token) url.searchParams.set("token", backend.token);
  url.searchParams.set("path", path);
  return url.toString();
}

export function remoteFilePreviewUrl(
  backend: BackendConfig,
  path: string,
) {
  const url = new URL("/api/files/preview", `${backend.baseUrl}/`);
  if (backend.token) url.searchParams.set("token", backend.token);
  url.searchParams.set("path", path);
  return url.toString();
}

export function remoteImagePreviewUrl(
  backend: BackendConfig,
  path: string,
  thumbnail = true,
) {
  const url = new URL("/api/images/preview", `${backend.baseUrl}/`);
  if (backend.token) url.searchParams.set("token", backend.token);
  url.searchParams.set("path", path);
  if (thumbnail) url.searchParams.set("thumbnail", "1");
  return url.toString();
}

export async function uploadFile(
  backend: BackendConfig,
  file: File,
  fetcher: Fetcher = fetch,
): Promise<UploadedFile> {
  const url = new URL("/api/uploads/file", `${backend.baseUrl}/`);
  if (backend.token) url.searchParams.set("token", backend.token);
  const response = await fetcher(url.toString(), {
    method: "POST",
    credentials: "include",
    headers: {
      "content-type": file.type || "application/octet-stream",
      "x-codex-file-name": encodeURIComponent(file.name),
    },
    body: file,
  });
  if (!response.ok) {
    if (response.status === 413) throw new Error(t("文件不能超过 100 MB"));
    throw new Error(t("文件上传失败（{status}）", { status: response.status }));
  }
  const result = (await response.json()) as Partial<UploadedFile>;
  if (
    typeof result.path !== "string" ||
    typeof result.name !== "string" ||
    typeof result.type !== "string" ||
    typeof result.size !== "number"
  ) {
    throw new Error(t("文件上传响应无效"));
  }
  return result as UploadedFile;
}

/** 图片先保存到当前网关宿主，再用同一路径声明附件与localImage，桌面刷新后也能恢复。 */
export async function uploadDraftImages(backend: BackendConfig, images: DraftImage[], fetcher: Fetcher = fetch): Promise<DraftImage[]> {
  return Promise.all(images.map(async image => {
    if (image.path) return image;
    const encoded = image.url.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/);
    if (!encoded || encoded[1] !== image.type) throw new Error(t('附件内容格式无效'));
    const bytes = Uint8Array.from(atob(encoded[2]), character => character.charCodeAt(0));
    const file = await uploadFile(backend, new File([bytes], image.name, { type: image.type }), fetcher);
    return { ...image, path: file.path };
  }));
}
