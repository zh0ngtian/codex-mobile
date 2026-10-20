import { decodeUserMessage, encodeUserMessage } from "../../server/user-message-format";
import { stripConversationTitleRequest } from "./conversation-title";

type MessageRecord = Record<string, any>;
export type UserMessageMatchOptions = { allowImageSourceChange?: boolean; alignUserOrder?: boolean };
type AttachmentIdentity = { kind: string; source: string };

function isImagePart(part: MessageRecord) {
  return part.type === "image" || part.type === "localImage";
}

function contentParts(item: MessageRecord): MessageRecord[] {
  if (Array.isArray(item.content)) {
    return item.content.filter((part: unknown): part is MessageRecord =>
      Boolean(part && typeof part === "object"),
    );
  }
  const text = typeof item.text === "string" ? item.text
    : typeof item.content === "string" ? item.content : "";
  return text ? [{ type: "text", text }] : [];
}

function userInput(item: MessageRecord) {
  const parts = contentParts(item);
  const raw = stripConversationTitleRequest(parts
    .filter(part => part.type === "text")
    .map(part => stripConversationTitleRequest(String(part.text ?? "")))
    .join("\n"));
  const envelope = decodeUserMessage(raw);
  const attachments: AttachmentIdentity[] = envelope.attachments.map(file => ({
    kind: file.isImage ? "image" : "file", source: file.path,
  }));
  // Skill、插件 mention 属于指令；乐观气泡可能省略它们，不能作为附件身份。
  for (const part of parts.filter(part => !["text", "skill", "mention"].includes(part.type))) {
    attachments.push(isImagePart(part)
      ? { kind: "image", source: String(part.url ?? part.path ?? "") }
      : { kind: String(part.type ?? ""), source: JSON.stringify(part) });
  }
  return {
    text: envelope.body.trim(),
    references: JSON.stringify(envelope.references),
    attachments: attachments.filter((attachment, index) =>
      attachment.source && attachments.findIndex(other =>
        other.kind === attachment.kind && other.source === attachment.source) === index),
    envelope,
    parts,
  };
}

export function userMessagesMatch(
  left: MessageRecord,
  right: MessageRecord,
  options: UserMessageMatchOptions = {},
) {
  if (left.type !== "userMessage" || right.type !== "userMessage") return false;
  if (left.clientId && right.clientId) return left.clientId === right.clientId;
  const previous = userInput(left);
  const incoming = userInput(right);
  if (previous.text !== incoming.text || previous.references !== incoming.references) return false;
  // 空正文必须有明确相同的附件身份；缺失媒体的旧回填只能用非空正文确认。
  if (!previous.attachments.length || !incoming.attachments.length) return Boolean(previous.text);
  if (previous.attachments.length !== incoming.attachments.length) return false;
  return previous.attachments.every((attachment, index) => {
    const other = incoming.attachments[index];
    if (attachment.kind !== other.kind) return false;
    if (attachment.source === other.source) return true;
    // 只在 pending 首次认领时兼容上传前 data URL 转换为宿主图片路径。
    return Boolean(options.allowImageSourceChange && previous.text && attachment.kind === "image" &&
      ((attachment.source.startsWith("data:") && other.source.startsWith("/")) ||
        (other.source.startsWith("data:") && attachment.source.startsWith("/"))));
  });
}

export function mergeConfirmedUserMessage(current: MessageRecord, incoming: MessageRecord): MessageRecord {
  const merged = { ...current, ...incoming };
  if (current.clientId || incoming.clientId) merged.clientId = current.clientId || incoming.clientId;
  const aliases = [...new Set([...(current._mobileUserMessageAliases ?? []), ...(incoming._mobileUserMessageAliases ?? [])])];
  if (aliases.length) merged._mobileUserMessageAliases = aliases;
  const previous = userInput(current);
  const next = userInput(incoming);
  let content = next.parts;
  let restored = false;
  if (!content.length && previous.parts.length) {
    content = previous.parts;
    restored = true;
  } else {
    // 同一身份的简略回填可能省略引用或文件包装，已确认的上下文不能因此丢失。
    const missingFiles = previous.envelope.attachments.length && !next.envelope.attachments.length;
    const missingReferences = previous.envelope.references.length && !next.envelope.references.length;
    if ((missingFiles || missingReferences) && previous.text === next.text) {
      const text = encodeUserMessage(next.envelope.body,
        next.envelope.attachments.length ? next.envelope.attachments : previous.envelope.attachments,
        next.envelope.references.length ? next.envelope.references : previous.envelope.references);
      content = [{ type: "text", text }, ...content.filter(part => part.type !== "text")];
      restored = true;
    }
    // 纯文本回填保留原有额外输入；回填带指令时，仍需独立补回缺失图片。
    const hasExtraInput = content.some(part => part.type !== "text");
    const media = previous.parts.filter(part => hasExtraInput ? isImagePart(part) : part.type !== "text");
    if (media.length && !content.some(isImagePart)) {
      content = [...content, ...media];
      restored = true;
    }
  }
  return restored ? { ...merged, content } : merged;
}

const placeholder = (id: unknown) => /^item-\d+$/.test(String(id ?? ""));
const stable = (id: unknown) => Boolean(id) && !placeholder(id) && !String(id).startsWith("local-");

/** 同回合完整用户顺序提供占位身份的证据；两个正式 ID 永远不会按正文合并。 */
export function reconcileUserMessageAliases(
  currentItems: MessageRecord[], incomingItems: MessageRecord[], alignUserOrder = false,
) {
  const aliases = new Map<string, string>();
  const canonical = new Map<string, MessageRecord>();
  for (const item of [...currentItems, ...incomingItems]) {
    if (item.type !== "userMessage" || !stable(item.id)) continue;
    canonical.set(item.id, mergeConfirmedUserMessage(canonical.get(item.id) ?? item, item));
    for (const alias of item._mobileUserMessageAliases ?? []) if (placeholder(alias)) aliases.set(alias, item.id);
  }
  for (const item of incomingItems) {
    const id = aliases.get(item.id);
    if (id && canonical.has(id) && !userMessagesMatch(item, canonical.get(id)!)) aliases.delete(item.id);
  }
  const byRequest = new Map<string, string | null>();
  for (const item of canonical.values()) if (item.clientId) {
    const known = byRequest.get(item.clientId);
    byRequest.set(item.clientId, known === undefined || known === item.id ? item.id : null);
  }
  for (const item of [...currentItems, ...incomingItems]) {
    const id = item.clientId && byRequest.get(item.clientId);
    if (placeholder(item.id) && id) aliases.set(item.id, id);
  }
  const users = (items: MessageRecord[]) => items.filter(item => item.type === "userMessage");
  if (alignUserOrder) {
    const previous = users(currentItems);
    const incoming = users(incomingItems);
    for (let index = 0; index < Math.min(previous.length, incoming.length); index++) {
      const left = previous[index]; const right = incoming[index];
      const leftId = aliases.get(left.id) ?? left.id;
      const rightId = aliases.get(right.id) ?? right.id;
      if (leftId === rightId) continue;
      const provisional = placeholder(leftId) && stable(rightId) ? left
        : placeholder(rightId) && stable(leftId) ? right : null;
      const confirmed = provisional === left ? right : left;
      if (!provisional || !userMessagesMatch(left, right)) break;
      aliases.set(provisional.id, confirmed.id);
    }
  }
  const normalize = (items: MessageRecord[]) => {
    const result: MessageRecord[] = [];
    for (const original of items) {
      if (original.type !== "userMessage") { result.push(original); continue; }
      const id = aliases.get(original.id) ?? original.id;
      const names = [...aliases].filter(([, target]) => target === id).map(([alias]) => alias);
      const known = canonical.get(id);
      const item = id === original.id && !names.length ? original : {
        ...original, id,
        ...(known?.clientId ? { clientId: known.clientId } : {}),
        _mobileUserMessageAliases: [...new Set([...(original._mobileUserMessageAliases ?? []), ...names])],
      };
      const index = result.findIndex(entry => entry.type === "userMessage" && entry.id === id);
      if (index < 0) result.push(item);
      else result[index] = mergeConfirmedUserMessage(result[index], item);
    }
    return result;
  };
  return { current: normalize(currentItems), incoming: normalize(incomingItems), aliases };
}

export function hasUserMessageContent(item: MessageRecord) {
  if (item.type !== "userMessage") return true;
  const input = userInput(item);
  return Boolean(input.text || input.envelope.references.length || input.attachments.length);
}

export function confirmLocalUserMessages(
  currentItems: MessageRecord[],
  incomingItems: MessageRecord[],
  options: UserMessageMatchOptions = {},
): MessageRecord[] {
  const items = [...currentItems];
  const confirmedIds = new Set<string>();
  for (const incoming of incomingItems) {
    const id = String(incoming.id ?? "");
    if (incoming.type !== "userMessage" || !id || id.startsWith("local-") || confirmedIds.has(id)) continue;
    confirmedIds.add(id);
    const existingIndex = items.findIndex(item => item.id === incoming.id);
    const known = existingIndex < 0 ? incoming : mergeConfirmedUserMessage(items[existingIndex], incoming);
    const localIndex = items.findIndex(item => item.type === "userMessage" &&
      String(item.id ?? "").startsWith("local-") && userMessagesMatch(item, known, options));
    if (localIndex < 0) continue;
    const local = items[localIndex];
    if (existingIndex >= 0) {
      items[existingIndex] = mergeConfirmedUserMessage(local, items[existingIndex]);
      items.splice(localIndex, 1);
    } else {
      // 在原位置升级身份，避免把用户消息移到已到达的过程/回复之后。
      items[localIndex] = mergeConfirmedUserMessage(local, incoming);
    }
  }
  return items;
}
