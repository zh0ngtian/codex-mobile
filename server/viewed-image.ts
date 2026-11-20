/** Tool screenshots may arrive as device paths or local file URLs. */
export function viewedImagePath(value: unknown): string | undefined {
  if (typeof value !== "string" || !value || value.includes("\0")) return;
  if (/^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(value)) return value;
  if (!/^file:\/\/\//i.test(value)) return;
  try {
    const url = new URL(value);
    if (url.host || url.search || url.hash || /%2f|%5c/i.test(url.pathname)) return;
    const path = decodeURIComponent(url.pathname);
    if (path.length > 1 && !path.includes("\0")) return path.replace(/^\/(?=[A-Za-z]:\/)/, "");
  } catch {
    return;
  }
}
