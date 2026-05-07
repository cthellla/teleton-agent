import { getSkillRegistry } from "./registry.js";
import type { SkillViewer } from "./types.js";

export const MAX_SKILLS_IN_PROMPT = 100;

/**
 * Renders the "## Available Skills" block injected into the system prompt.
 *
 * Filters by viewer visibility:
 *   - shared skills: shown to everyone
 *   - admin skills: shown only when viewer.isAdmin === true
 *   - personal skills: shown only when their userId === viewer.senderId
 *
 * Returns null when the viewer would see zero skills.
 */
export function renderSkillsPromptSection(viewer: SkillViewer): string | null {
  const skills = getSkillRegistry().listVisible(viewer);
  if (skills.length === 0) return null;

  const lines: string[] = [
    "## Available Skills",
    "",
    "Skills are reusable playbooks for specific tasks. Each entry below shows the skill name and a one-line trigger description.",
    "When a user request matches a skill's description, call `skill_invoke` with the skill name to load the full instructions.",
    "Do NOT pre-load skills speculatively — only invoke when the trigger description clearly applies.",
    "",
  ];

  const limited = skills.slice(0, MAX_SKILLS_IN_PROMPT);
  for (const skill of limited) {
    const tag = ownerTag(skill.owner);
    lines.push(`- **${skill.name}**${tag}: ${skill.description}`);
  }

  if (skills.length > MAX_SKILLS_IN_PROMPT) {
    lines.push(
      `- _...${skills.length - MAX_SKILLS_IN_PROMPT} more skill(s) not shown — consider consolidating._`
    );
  }

  return lines.join("\n");
}

function ownerTag(owner: { kind: "shared" | "admin" | "user" }): string {
  switch (owner.kind) {
    case "shared":
      return "";
    case "admin":
      return " _(admin)_";
    case "user":
      return " _(personal)_";
  }
}
