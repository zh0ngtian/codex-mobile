import { describe, expect, it, vi } from "vitest";
import {
  filterInstalledPlugins,
  insertPluginMention,
  listInstalledPlugins,
  pluginsReferencedInText,
  type InstalledPlugin,
} from "../../src/app-server/plugins";

const plugins: InstalledPlugin[] = [
  {
    id: "creative-production@openai-curated",
    name: "creative-production",
    installed: true,
    enabled: true,
    availability: "AVAILABLE",
    interface: {
      displayName: "Creative Production",
      shortDescription: "Create polished visual assets",
    },
  },
  {
    id: "pages@openai-curated",
    name: "pages",
    installed: true,
    enabled: true,
    availability: "AVAILABLE",
    interface: {
      displayName: "Pages",
      shortDescription: "Write and organize Pages",
    },
  },
];

describe("插件 @ 提及", () => {
  it("按当前目录读取并只保留可用的已安装插件", async () => {
    const request = vi.fn().mockResolvedValue({
      marketplaces: [
        {
          name: "openai-curated",
          plugins: [
            plugins[1],
            { ...plugins[0], installed: false },
            { ...plugins[0], id: "disabled", enabled: false },
          ],
        },
      ],
      marketplaceLoadErrors: [],
    });

    const result = await listInstalledPlugins(
      { request } as never,
      "/tmp/project",
    );

    expect(request).toHaveBeenCalledWith("plugin/installed", {
      cwds: ["/tmp/project"],
    });
    expect(result).toEqual([plugins[1]]);
  });

  it("按插件名称、显示名称和描述过滤", () => {
    expect(filterInstalledPlugins(plugins, "creative")).toEqual([plugins[0]]);
    expect(filterInstalledPlugins(plugins, "visual")).toEqual([plugins[0]]);
    expect(filterInstalledPlugins(plugins, "PAGES")).toEqual([plugins[1]]);
  });

  it("选择后保留 @ 插件标记并返回新光标位置", () => {
    expect(
      insertPluginMention(
        "请用 @cre完成素材",
        { start: 3, end: 7, query: "cre" },
        plugins[0],
      ),
    ).toEqual({
      text: "请用 @creative-production 完成素材",
      cursor: 24,
    });
  });

  it("把文本中的插件标记解析为结构化提及", () => {
    expect(
      pluginsReferencedInText("请用 @creative-production 再交给 @pages。", plugins),
    ).toEqual(plugins);
    expect(pluginsReferencedInText("已删除插件标记", plugins)).toEqual([]);
  });
});
