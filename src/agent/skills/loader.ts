/**
 * Skill loader — discovers and parses SKILL.md files.
 *
 * Layout under skillsRoot:
 *   shared/<name>/SKILL.md          owner: shared (visible to all)
 *   admin/<name>/SKILL.md            owner: admin (visible to telegram admins)
 *   users/<userId>/<name>/SKILL.md   owner: user (visible only to userId)
 *   <name>/SKILL.md                  legacy flat layout, treated as shared
 *
 * Frontmatter format:
 *
 *   ---
 *   name: my-skill
 *   description: One-line trigger so the model knows when to invoke this.
 *   version: 1.0.0           # optional
 *   ---
 *
 *   # Body
 *
 * Validation rules:
 *   - The skill directory name MUST equal the frontmatter `name`.
 *   - `name` must match /^[a-z0-9][a-z0-9_-]{0,63}$/ (kebab-case, no spaces).
 *   - `description` is required, 1-1024 chars, single line.
 *   - SKILL.md must start with `---\n`. Skills with no frontmatter are rejected.
 *   - Skill names are globally unique across owners; later duplicates are skipped.
 *
 * Invalid skills are skipped with a warning — they never crash the loader.
 */

import { readdirSync, readFileSync, statSync } from "fs";
import { basename, join } from "path";
import { parse as parseYaml } from "yaml";
import { createLogger } from "../../utils/logger.js";
import { getErrorMessage } from "../../utils/errors.js";
import type { Skill, SkillFrontmatter, SkillOwner } from "./types.js";

const log = createLogger("Skills");

const NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const DESCRIPTION_MAX_LENGTH = 1024;
const MAX_FILE_SIZE = 1_000_000;
const SKILL_FILE = "SKILL.md";

const SHARED_DIR = "shared";
const ADMIN_DIR = "admin";
const USERS_DIR = "users";

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/;

export { NAME_PATTERN };

export function parseSkillFile(
  content: string
): { frontmatter: SkillFrontmatter; body: string } | { error: string } {
  if (content.length > MAX_FILE_SIZE) {
    return { error: `SKILL.md exceeds ${MAX_FILE_SIZE} bytes` };
  }

  const stripped = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  const match = FRONTMATTER.exec(stripped);
  if (!match) {
    return { error: "missing or malformed '---' frontmatter block" };
  }

  const yamlText = match[1];
  const body = stripped.slice(match[0].length);

  let parsed: unknown;
  try {
    parsed = parseYaml(yamlText);
  } catch (error) {
    return { error: `invalid YAML frontmatter: ${getErrorMessage(error)}` };
  }

  if (!parsed || typeof parsed !== "object") {
    return { error: "frontmatter must be a YAML mapping" };
  }

  const fm = parsed as Record<string, unknown>;

  if (typeof fm.name !== "string" || !NAME_PATTERN.test(fm.name)) {
    return {
      error: `frontmatter 'name' must match ${NAME_PATTERN} (kebab-case, 1-64 chars)`,
    };
  }

  if (typeof fm.description !== "string" || fm.description.trim().length === 0) {
    return { error: "frontmatter 'description' is required" };
  }

  if (fm.description.length > DESCRIPTION_MAX_LENGTH) {
    return {
      error: `frontmatter 'description' exceeds ${DESCRIPTION_MAX_LENGTH} chars`,
    };
  }

  if (fm.description.includes("\n")) {
    return { error: "frontmatter 'description' must be a single line" };
  }

  const frontmatter: SkillFrontmatter = {
    name: fm.name,
    description: fm.description.trim(),
  };

  if (typeof fm.version === "string") {
    frontmatter.version = fm.version;
  }

  if (Array.isArray(fm.allowed_tools)) {
    const tools = fm.allowed_tools.filter((v): v is string => typeof v === "string");
    if (tools.length > 0) frontmatter.allowed_tools = tools;
  }

  return { frontmatter, body: body.trimStart() };
}

function isENOENT(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { code?: string }).code === "ENOENT"
  );
}

function safeStatDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch (error) {
    if (!isENOENT(error)) log.warn(`stat ${path} failed: ${getErrorMessage(error)}`);
    return false;
  }
}

function safeListDir(path: string): string[] {
  try {
    return readdirSync(path);
  } catch (error) {
    if (!isENOENT(error)) log.warn(`Failed to read ${path}: ${getErrorMessage(error)}`);
    return [];
  }
}

export function loadSkillFromDir(dir: string, owner: SkillOwner): Skill | null {
  const dirName = basename(dir);
  const skillPath = join(dir, SKILL_FILE);

  let stat;
  try {
    stat = statSync(skillPath);
  } catch (error) {
    if (!isENOENT(error)) log.warn(`stat ${skillPath} failed: ${getErrorMessage(error)}`);
    return null;
  }
  if (!stat.isFile()) return null;

  let raw: string;
  try {
    raw = readFileSync(skillPath, "utf-8");
  } catch (error) {
    log.warn(`Failed to read ${skillPath}: ${getErrorMessage(error)}`);
    return null;
  }

  const result = parseSkillFile(raw);
  if ("error" in result) {
    log.warn(`Skill "${dirName}" rejected: ${result.error}`);
    return null;
  }

  if (result.frontmatter.name !== dirName) {
    log.warn(
      `Skill at ${dir} has frontmatter name '${result.frontmatter.name}' but directory is '${dirName}' — names must match`
    );
    return null;
  }

  let resources: string[] = [];
  try {
    resources = readdirSync(dir).filter((entry) => entry !== SKILL_FILE);
  } catch (error) {
    log.warn(`Failed to list resources in ${dir}: ${getErrorMessage(error)}`);
  }

  return {
    name: result.frontmatter.name,
    description: result.frontmatter.description,
    version: result.frontmatter.version,
    owner,
    dir,
    path: skillPath,
    body: result.body,
    resources,
  };
}

/**
 * Scan a single namespace directory (shared/, admin/, users/<id>/) for skills.
 * Returns skills tagged with the given owner.
 */
function loadFromNamespace(namespaceDir: string, owner: SkillOwner): Skill[] {
  if (!safeStatDir(namespaceDir)) return [];

  const skills: Skill[] = [];
  for (const entry of safeListDir(namespaceDir)) {
    const sub = join(namespaceDir, entry);
    if (!safeStatDir(sub)) continue;
    const skill = loadSkillFromDir(sub, owner);
    if (skill) skills.push(skill);
  }
  return skills;
}

/**
 * Scan the skills root and return all valid skills tagged with their owner.
 *
 * Reads:
 *   - {root}/shared/-name-/SKILL.md         owner: shared
 *   - {root}/admin/-name-/SKILL.md          owner: admin
 *   - {root}/users/<userId>/-name-/SKILL.md owner: user
 *   - {root}/<name>/SKILL.md                owner: shared (legacy flat layout)
 *
 * Skill names are globally unique. Later duplicates are skipped with a warning.
 */
export function loadSkillsFromDir(skillsRoot: string): Skill[] {
  if (!safeStatDir(skillsRoot)) return [];

  const all: Skill[] = [];

  all.push(...loadFromNamespace(join(skillsRoot, SHARED_DIR), { kind: "shared" }));
  all.push(...loadFromNamespace(join(skillsRoot, ADMIN_DIR), { kind: "admin" }));

  const usersRoot = join(skillsRoot, USERS_DIR);
  if (safeStatDir(usersRoot)) {
    for (const entry of safeListDir(usersRoot)) {
      const userDir = join(usersRoot, entry);
      if (!safeStatDir(userDir)) continue;
      const userId = Number(entry);
      if (!Number.isInteger(userId) || userId <= 0) {
        log.warn(`Skipping users/${entry} — directory name must be a positive integer user ID`);
        continue;
      }
      all.push(...loadFromNamespace(userDir, { kind: "user", userId }));
    }
  }

  for (const entry of safeListDir(skillsRoot)) {
    if (entry === SHARED_DIR || entry === ADMIN_DIR || entry === USERS_DIR) continue;
    const sub = join(skillsRoot, entry);
    if (!safeStatDir(sub)) continue;
    const skill = loadSkillFromDir(sub, { kind: "shared" });
    if (skill) all.push(skill);
  }

  const seen = new Set<string>();
  const unique: Skill[] = [];
  for (const skill of all) {
    if (seen.has(skill.name)) {
      log.warn(
        `Duplicate skill name '${skill.name}' (in ${skill.dir}) — keeping first, ignoring this one`
      );
      continue;
    }
    seen.add(skill.name);
    unique.push(skill);
  }

  unique.sort((a, b) => a.name.localeCompare(b.name));
  return unique;
}
