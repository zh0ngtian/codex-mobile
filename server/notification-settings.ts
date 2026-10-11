export type NotificationPreference = { mode: "system" | "bark"; barkUrl: string };

const RESERVED_PATHS = new Set(["push", "register", "ping", "health", "healthz", "info", "get_key", "update", "v1"]);

/** 验证 Bark 服务器与设备 Key，避免误把公共 API 或带消息内容的 URL 保存为推送地址。 */
export function parseBarkPushUrl(value: string): string {
  if (typeof value !== "string" || /[\u0000-\u001f\u007f]/.test(value)) throw new Error("Bark 地址不能包含控制字符");
  const input = value.trim().replace(/\/+$/, "");
  if (!input || input.length > 2048 || /\s/.test(input) || input.includes("\\")) throw new Error("请输入有效的 Bark 推送地址，地址中不能包含空白");
  let url: URL;
  try { url = new URL(input); } catch { throw new Error("请输入完整的 HTTP 或 HTTPS Bark 地址"); }
  if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash || input.includes("?") || input.includes("#")) throw new Error("Bark 地址只允许 HTTP 或 HTTPS 服务器和设备 Key，不能带凭据、查询或片段");
  const rawPath = input.replace(/^https?:\/\/[^/]+/i, "");
  const segments = rawPath.split("/").slice(1);
  if (!segments.length || segments.some((part) => !/^[A-Za-z0-9_-]{1,256}$/.test(part) || RESERVED_PATHS.has(part.toLowerCase()))) throw new Error("Bark 地址需要有效的设备 Key，不能使用公共接口路径");
  if (url.hostname.toLowerCase().replace(/\.$/, "") === "api.day.app" && segments.length !== 1) throw new Error("api.day.app 地址只能包含一个设备 Key");
  return url.toString().replace(/\/+$/, "");
}
