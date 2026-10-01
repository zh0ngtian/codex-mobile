import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

function rule(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return styles.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
}

describe("Skill 选择器名称布局", () => {
  it("完整展示长 Skill 名称并允许自然换行", () => {
    const buttonRule = rule(".skill-mention-menu > button");
    const textRule = rule(".skill-mention-menu strong, .skill-mention-menu small");
    const codeRule = rule(".skill-mention-menu code");

    expect(buttonRule).toContain("display: block");
    expect(textRule).toContain("white-space: normal");
    expect(textRule).not.toContain("text-overflow: ellipsis");
    expect(codeRule).toContain("white-space: normal");
    expect(codeRule).toContain("overflow-wrap: anywhere");
    expect(codeRule).not.toContain("max-width");
    expect(codeRule).not.toContain("text-overflow: ellipsis");
  });
});
