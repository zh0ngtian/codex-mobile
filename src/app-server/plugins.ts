import { AppServerClient } from "./client";
import type { SkillMentionQuery } from "./skills";

export interface InstalledPlugin {
  id: string;
  name: string;
  installed: boolean;
  enabled: boolean;
  availability: string;
  interface?: {
    displayName?: string | null;
    shortDescription?: string | null;
    longDescription?: string | null;
  } | null;
}

interface PluginsInstalledResponse {
  marketplaces: Array<{
    name: string;
    plugins: InstalledPlugin[];
  }>;
}

export async function listInstalledPlugins(
  client: AppServerClient,
  cwd: string | null,
) {
  const result = await client.request<PluginsInstalledResponse>(
    "plugin/installed",
    cwd ? { cwds: [cwd] } : {},
  );
  const byId = new Map<string, InstalledPlugin>();
  for (const marketplace of result.marketplaces ?? []) {
    for (const plugin of marketplace.plugins ?? []) {
      if (
        plugin.id &&
        plugin.name &&
        plugin.installed &&
        plugin.enabled &&
        plugin.availability === "AVAILABLE"
      ) {
        byId.set(plugin.id, plugin);
      }
    }
  }
  return [...byId.values()].sort((left, right) =>
    pluginDisplayName(left).localeCompare(pluginDisplayName(right)),
  );
}

export function pluginDisplayName(plugin: InstalledPlugin) {
  return plugin.interface?.displayName?.trim() || plugin.name;
}

export function pluginDescription(plugin: InstalledPlugin) {
  return plugin.interface?.shortDescription?.trim() || "";
}

export function filterInstalledPlugins(
  plugins: InstalledPlugin[],
  query: string,
) {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return plugins;
  return plugins.filter((plugin) =>
    [plugin.name, pluginDisplayName(plugin), pluginDescription(plugin)].some(
      (value) => value.toLocaleLowerCase().includes(normalized),
    ),
  );
}

export function insertPluginMention(
  text: string,
  mention: SkillMentionQuery,
  plugin: InstalledPlugin,
) {
  const marker = `@${plugin.name} `;
  return {
    text: `${text.slice(0, mention.start)}${marker}${text.slice(mention.end)}`,
    cursor: mention.start + marker.length,
  };
}

export function pluginsReferencedInText(
  text: string,
  plugins: InstalledPlugin[],
) {
  const names = new Set(
    [...text.matchAll(/(?:^|\s)@([^\s@]+)/gu)].map((match) =>
      match[1].replace(/[.,!?;:，。！？；：]+$/u, ""),
    ),
  );
  return plugins.filter((plugin) => names.has(plugin.name));
}

export function pluginMentionInput(plugin: InstalledPlugin) {
  return {
    type: "mention" as const,
    name: pluginDisplayName(plugin),
    path: `plugin://${plugin.id}`,
  };
}
