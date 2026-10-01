import { AppServerClient } from "./client";

export interface InstalledSkill {
  name: string;
  description: string;
  path: string;
  scope: "user" | "repo" | "system" | "admin";
  enabled: boolean;
  interface?: {
    displayName?: string | null;
    shortDescription?: string | null;
  } | null;
}

interface SkillsListResponse {
  data: Array<{
    cwd: string;
    skills: InstalledSkill[];
  }>;
}

export interface SkillMentionQuery {
  start: number;
  end: number;
  query: string;
}

export async function listInstalledSkills(
  client: AppServerClient,
  cwd: string | null,
  forceReload = false,
) {
  const result = await client.request<SkillsListResponse>("skills/list", {
    ...(cwd ? { cwds: [cwd] } : {}),
    ...(forceReload ? { forceReload: true } : {}),
  });
  const byPath = new Map<string, InstalledSkill>();
  for (const entry of result.data ?? []) {
    for (const skill of entry.skills ?? []) {
      if (skill.enabled && skill.name && skill.path) {
        byPath.set(skill.path, skill);
      }
    }
  }
  return [...byPath.values()].sort((left, right) =>
    skillDisplayName(left).localeCompare(skillDisplayName(right)),
  );
}

export function skillDisplayName(skill: InstalledSkill) {
  return skill.interface?.displayName?.trim() || skill.name;
}

export function skillDescription(skill: InstalledSkill) {
  return (
    skill.interface?.shortDescription?.trim() ||
    skill.description.trim()
  );
}

export function skillMentionAt(
  text: string,
  cursor: number,
): SkillMentionQuery | null {
  const beforeCursor = text.slice(0, Math.max(0, cursor));
  const match = /(^|\s)@([^\s@]*)$/u.exec(beforeCursor);
  if (!match) return null;
  const start = match.index + match[1].length;
  return {
    start,
    end: beforeCursor.length,
    query: match[2],
  };
}

export function filterInstalledSkills(
  skills: InstalledSkill[],
  query: string,
) {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return skills;
  return skills.filter((skill) =>
    [skill.name, skillDisplayName(skill), skillDescription(skill)].some(
      (value) => value.toLocaleLowerCase().includes(normalized),
    ),
  );
}

export function insertSkillMention(
  text: string,
  mention: SkillMentionQuery,
  skill: InstalledSkill,
) {
  const marker = `$${skill.name} `;
  return {
    text: `${text.slice(0, mention.start)}${marker}${text.slice(mention.end)}`,
    cursor: mention.start + marker.length,
  };
}

export function skillsReferencedInText(
  text: string,
  skills: InstalledSkill[],
) {
  const names = new Set(
    [...text.matchAll(/(?:^|\s)\$([^\s$]+)/gu)].map((match) =>
      match[1].replace(/[.,!?;:，。！？；：]+$/u, ""),
    ),
  );
  return skills.filter((skill) => names.has(skill.name));
}
