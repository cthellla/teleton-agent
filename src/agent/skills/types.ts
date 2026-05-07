/**
 * Skills — agent-callable Markdown playbooks with lazy loading.
 *
 * Layout (under ~/.teleton/workspace/skills/):
 *   shared/<name>/SKILL.md          visible to every user
 *   admin/<name>/SKILL.md            visible only to telegram admins
 *   users/<userId>/<name>/SKILL.md   visible only to user <userId>
 *   <name>/SKILL.md                  legacy flat layout, treated as shared
 *
 * Only the frontmatter (name + description) is injected into the system prompt.
 * Bodies are fetched on demand by the `skill_invoke` tool.
 */

/** Where a skill came from — drives visibility. */
export type SkillOwner = { kind: "shared" } | { kind: "admin" } | { kind: "user"; userId: number };

/** Scope label used by the install tool — corresponds 1:1 with SkillOwner kinds. */
export type SkillScope = "personal" | "shared" | "admin";

/** Parsed YAML frontmatter from a SKILL.md file. */
export interface SkillFrontmatter {
  /** Unique skill name. Must match the directory name. */
  name: string;
  /** One-line trigger description shown to the model in the system prompt. */
  description: string;
  /** Optional version string for the skill author's bookkeeping. */
  version?: string;
  /** Optional list of allowed tools — informational, not enforced. */
  allowed_tools?: string[];
}

/** A skill loaded from disk. */
export interface Skill {
  /** Name from frontmatter (must equal the containing directory name). */
  name: string;
  /** Trigger description from frontmatter. */
  description: string;
  /** Visibility group. */
  owner: SkillOwner;
  /** Absolute path to the skill's directory. */
  dir: string;
  /** Absolute path to SKILL.md. */
  path: string;
  /** Full SKILL.md body (without frontmatter). */
  body: string;
  /** Names of files in the skill directory other than SKILL.md. */
  resources: string[];
  /** Optional version from frontmatter. */
  version?: string;
}

/** Caller context used when filtering skills for visibility. */
export interface SkillViewer {
  senderId?: number;
  isAdmin: boolean;
}

/** Returns true if `viewer` is allowed to see `skill`. */
export function isVisibleTo(skill: Skill, viewer: SkillViewer): boolean {
  switch (skill.owner.kind) {
    case "shared":
      return true;
    case "admin":
      return viewer.isAdmin;
    case "user":
      return viewer.senderId !== undefined && skill.owner.userId === viewer.senderId;
  }
}
