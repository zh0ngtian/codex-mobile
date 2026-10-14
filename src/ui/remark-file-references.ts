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

function transformCitations(node: Nodes, options: FileReferencesOptions) {
  if (["link", "linkReference", "code", "inlineCode", "html"].includes(node.type) || !("children" in node)) return;
  const children: Nodes[] = [];
  const htmlTags: string[] = [];
  for (const child of node.children) {
    if (child.type === "html") {
      // 行内 HTML 的正文在 mdast 中仍是 text，保留标签范围内的全部内容。
      for (const tag of child.value.matchAll(/<(\/?)([A-Za-z][A-Za-z0-9-]*)\b(?:"[^"]*"|'[^']*'|[^"'<>])*>/g)) {
        const name = tag[2].toLowerCase();
        if (tag[1]) {
          const index = htmlTags.lastIndexOf(name);
          if (index >= 0) htmlTags.splice(index);
        } else if (!/\/\s*>$/.test(tag[0]) && !/^(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/.test(name)) {
          htmlTags.push(name);
        }
      }
      children.push(child);
    } else if (htmlTags.length) {
      children.push(child);
    } else if (child.type === "text") {
      children.push(...citationNodes(child, options));
    } else {
      transformCitations(child, options);
      children.push(child);
    }
  }
  node.children = children as typeof node.children;
}

/** 将桌面消息的文件元数据转换为现有 Markdown 文件链接，不修改消息原文。 */
export function remarkFileReferences(options: FileReferencesOptions) {
  return (tree: Root) => {
    let attachments = false;
    for (const node of tree.children) {
      if (node.type !== "heading") continue;
      const plain = node.children.length === 1 && node.children[0].type === "text"
        ? node.children[0].value : null;
      if (node.depth === 1) attachments = plain?.trim() === "Files mentioned by the user:";
      if (node.depth === 2 && plain?.trim() === "My request:") attachments = false;
      if (!attachments || node.depth !== 2 || plain === null) continue;
      const file = plain.match(/^(.+?):\s+(\/[^\r\n]+)$/);
      if (!file) continue;
      const link = fileLink(file[2], file[1], options);
      if (link) node.children = [link];
    }
    transformCitations(tree, options);
  };
}
