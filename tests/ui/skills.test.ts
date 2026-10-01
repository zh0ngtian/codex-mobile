import { describe, expect, it, vi } from "vitest";
import {
  filterInstalledSkills,
  insertSkillMention,
  listInstalledSkills,
  skillMentionAt,
  skillsReferencedInText,
  type InstalledSkill,
} from "../../src/app-server/skills";

const skills: InstalledSkill[] = [
  {
    name: "skill-creator",
    description: "Create or update a Codex skill",
    path: "/skills/skill-creator/SKILL.md",
    scope: "system",
    enabled: true,
    interface: {
      displayName: "Skill Creator",
      shortDescription: "Build reusable skills",
    },
  },
  {
    name: "pdf",
    description: "Read and create PDF files",
    path: "/skills/pdf/SKILL.md",
    scope: "user",
    enabled: true,
  },
];

describe("Skill @ 提及", () => {
  it("按当前目录读取并只保留启用的已安装 Skill", async () => {
    const request = vi.fn().mockResolvedValue({
      data: [
        {
          cwd: "/tmp/project",
          skills: [skills[1], { ...skills[0], enabled: false }],
        },
      ],
    });
    const result = await listInstalledSkills(
      { request } as never,
      "/tmp/project",
      true,
    );

    expect(request).toHaveBeenCalledWith("skills/list", {
      cwds: ["/tmp/project"],
      forceReload: true,
    });
    expect(result).toEqual([skills[1]]);
  });

  it("只在光标前的独立 @ 标记上打开查询", () => {
    expect(skillMentionAt("请用 @ski", 7)).toEqual({
      start: 3,
      end: 7,
      query: "ski",
    });
    expect(skillMentionAt("mail@example.com", 16)).toBeNull();
    expect(skillMentionAt("@pdf 后续文字", 9)).toBeNull();
  });

  it("按名称、显示名称和描述过滤已安装 Skill", () => {
    expect(filterInstalledSkills(skills, "creator")).toEqual([skills[0]]);
    expect(filterInstalledSkills(skills, "reusable")).toEqual([skills[0]]);
    expect(filterInstalledSkills(skills, "PDF")).toEqual([skills[1]]);
  });

  it("选择后写入标准 $ 调用标记并返回新光标位置", () => {
    const result = insertSkillMention(
      "请用 @ski完成任务",
      { start: 3, end: 7, query: "ski" },
      skills[0],
    );
    expect(result).toEqual({
      text: "请用 $skill-creator 完成任务",
      cursor: 18,
    });
  });

  it("只把文本中实际保留的 Skill 标记解析为结构化输入", () => {
    expect(
      skillsReferencedInText("$skill-creator 处理后交给 $pdf。", skills),
    ).toEqual(skills);
    expect(skillsReferencedInText("已删除调用标记", skills)).toEqual([]);
  });
});
