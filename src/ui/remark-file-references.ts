import type { Link, Nodes, PhrasingContent, Root, Text } from "mdast";

type FileReferencesOptions = {
  parseFileHref: (href: string) => {
    path: string;
    line: number | null;
    column: number | null;
  } | null;
};

function fileLink(path: string, name: string, options: FileReferencesOptions): Link | null {
  // 只接受现有文件读取入口支持的绝对路径，编码后必须逐字往返。
  if (!path.startsWith("/") || /[\u0000-\u001f\u007f]/.test(path)) return null;
  if (path.slice(1).split("/").some(part => !part || part === "." || part === "..")) return null;
  let href: string;
  try {
    href = path.split("/").map(part => encodeURIComponent(part)).join("/");
  } catch {
    return null;
  }
  const target = options.parseFileHref(href);
  if (!target || target.path !== path || target.line !== null || target.column !== null) return null;
  return { type: "link", url: href, children: [{ type: "text", value: name }] };
}

function citationPath(attributes: string): string | null {
  const attribute = /\s*([A-Za-z_][A-Za-z0-9_-]*)\s*=\s*(?:"([^"\r\n]*)"|'([^'\r\n]*)')/y;
  let offset = 0;
  let path: string | null = null;
  while (offset < attributes.length) {
    if (!attributes.slice(offset).trim()) break;
    attribute.lastIndex = offset;
    const match = attribute.exec(attributes);
    if (!match) return null;
    if (match[1] === "path") {
      if (path !== null) return null;
      path = match[2] ?? match[3];
    }
    offset = attribute.lastIndex;
    if (offset < attributes.length && !/\s/.test(attributes[offset])) return null;
  }
  return path;
}

function citationNodes(text: Text, options: FileReferencesOptions): PhrasingContent[] {
  const directive = /:{1,2}codex-file-citation\{/g;
  const nodes: PhrasingContent[] = [];
  let offset = 0;
  let match: RegExpExecArray | null;
  while ((match = directive.exec(text.value))) {
    if (match.index > 0 && text.value[match.index - 1] === ":") continue;
    const attributesStart = directive.lastIndex;
    let end = attributesStart;
    let depth = 1;
    let quote = "";
    for (; end < text.value.length; end++) {
      const character = text.value[end];
      if (character === "\n" || character === "\r") break;
      if (quote) {
        if (character === quote) quote = "";
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === "{") {
        depth++;
      } else if (character === "}" && --depth === 0) {
        break;
      }
    }
    // 一个候选整体解析失败时，也不能从其残缺属性中识别嵌套引用。
    directive.lastIndex = end + 1;
    if (depth !== 0) continue;
    const path = citationPath(text.value.slice(attributesStart, end));
    const link = path ? fileLink(path, path.split("/").at(-1)!, options) : null;
    if (!link) continue;
    if (match.index > offset) nodes.push({ type: "text", value: text.value.slice(offset, match.index) });
    nodes.push(link);
    offset = end + 1;
  }
  if (!offset) return [text];
  if (offset < text.value.length) nodes.push({ type: "text", value: text.value.slice(offset) });
  return nodes;
}

function updateHtmlScope(value: string, tags: string[]) {
  // 先消费非标签 HTML 内容，避免其中的伪标签影响真实标签范围。
  const tokens = /<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[[\s\S]*?(?:\]\]>|$)|<\?[\s\S]*?(?:\?>|$)|<![^>]*(?:>|$)|<(\/?)([A-Za-z][A-Za-z0-9-]*)\b(?:"[^"]*"|'[^']*'|[^"'<>])*>/g;
  for (const token of value.matchAll(tokens)) {
    if (!token[2]) continue;
    const name = token[2].toLowerCase();
    if (token[1]) {
      const index = tags.lastIndexOf(name);
      if (index >= 0) tags.splice(index);
    } else if (!/\/\s*>$/.test(token[0]) && !/^(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/.test(name)) {
      tags.push(name);
    }
  }
}

type ReferenceState = { htmlTags: string[]; attachments: boolean };

function transformReferences(
  node: Nodes,
  options: FileReferencesOptions,
  state: ReferenceState,
  parentType?: Nodes["type"],
  convertText = true,
) {
  if (node.type === "html") {
    updateHtmlScope(node.value, state.htmlTags);
    return;
  }
  if (["code", "inlineCode"].includes(node.type) || !("children" in node)) return;
  const convertChildren = convertText && node.type !== "link" && node.type !== "linkReference";

  if (parentType === "root" && node.type === "heading" && !state.htmlTags.length) {
    const plain = node.children.length === 1 && node.children[0].type === "text"
      ? node.children[0].value : null;
    if (node.depth === 1) state.attachments = plain?.trim() === "Files mentioned by the user:";
    if (node.depth === 2 && plain?.trim() === "My request:") state.attachments = false;
    if (state.attachments && node.depth === 2 && plain !== null) {
      const file = plain.match(/^(.+?):\s+(\/[^\r\n]+)$/);
      const link = file ? fileLink(file[2], file[1], options) : null;
      if (link) node.children = [link];
    }
  }

  const children: Nodes[] = [];
  for (const child of node.children) {
    if (child.type === "text" && convertChildren && !state.htmlTags.length) {
      children.push(...citationNodes(child, options));
    } else {
      // 链接及 HTML 内仍扫描真实标签；链接文本和代码示例始终保持原样。
      transformReferences(child, options, state, node.type, convertChildren);
      children.push(child);
    }
  }
  node.children = children as typeof node.children;
}

/** 将桌面消息的文件元数据转换为现有 Markdown 文件链接，不修改消息原文。 */
export function remarkFileReferences(options: FileReferencesOptions) {
  return (tree: Root) => {
    // 整篇文档按 mdast 顺序共用范围状态，不在段落或格式节点边界重置。
    transformReferences(tree, options, { htmlTags: [], attachments: false });
  };
}
