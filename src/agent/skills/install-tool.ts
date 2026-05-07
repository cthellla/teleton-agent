/**
 * `skill_install` tool — creates a new SKILL.md in the workspace skills directory.
 *
 * Scope rules:
 *   - "shared" / "admin": require config.telegram.admin_ids membership
 *   - "personal": writes to users/<senderId>/<name>/SKILL.md
 *
 * Default scope: "admin" if the caller is an admin, otherwise "personal".
 *
 * The body the user supplies is wrapped with a frontmatter block built from
 * (name, description, optional version, optional allowed_tools) and re-parsed
 * via the loader's `parseSkillFile` so the same validation runs at install
 * time as at load time. This guarantees the file we write is one the loader
 * will accept on the next watcher rescan.
 *
 * Path traversal is prevented by NAME_PATTERN which forbids '/', '..', etc.
 *
 * `overwrite: false` (default) refuses to clobber an existing file with the
 * same name in the same scope.
 */

import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { stringify as stringifyYaml } from "yaml";
import { Type } from "@sinclair/typebox";
import type { Tool, ToolEntry, ToolExecutor, ToolResult } from "../tools/types.js";
import { WORKSPACE_PATHS } from "../../workspace/paths.js";
import { createLogger } from "../../utils/logger.js";
import { getErrorMessage } from "../../utils/errors.js";
import { NAME_PATTERN, parseSkillFile } from "./loader.js";
import { getSkillRegistry } from "./registry.js";
import { viewerFromContext } from "./viewer.js";
import type { SkillOwner, SkillScope, SkillViewer } from "./types.js";

const log = createLogger("Skills");

interface SkillInstallParams {
  name: string;
  description: string;
  body: string;
  version?: string;
  allowed_tools?: string[];
  scope?: SkillScope;
  overwrite?: boolean;
}

export const skillInstallTool: Tool = {
  name: "skill_install",
  description:
    "Install a new skill (SKILL.md) into the workspace. Validates frontmatter and writes the file; the watcher picks it up automatically. " +
    "scope='personal' (default for non-admins) writes a skill visible only to the calling user. " +
    "scope='shared' or 'admin' require the caller to be a configured admin.",
  category: "action",
  parameters: Type.Object({
    name: Type.String({
      description: "Skill name (kebab-case, 1-64 chars, [a-z0-9_-]). Must be globally unique.",
    }),
    description: Type.String({
      description:
        "One-line trigger description shown to the model. Write it as a clear, specific trigger so the model knows exactly when to call skill_invoke for this skill.",
    }),
    body: Type.String({
      description:
        "Markdown body of SKILL.md (everything after the frontmatter). Use this to write the playbook itself.",
    }),
    version: Type.Optional(Type.String({ description: "Free-form version string." })),
    allowed_tools: Type.Optional(
      Type.Array(Type.String(), {
        description: "Informational list of tools this skill expects. Not enforced.",
      })
    ),
    scope: Type.Optional(
      Type.Union([Type.Literal("personal"), Type.Literal("shared"), Type.Literal("admin")], {
        description:
          "Where to install. 'personal' = visible only to the caller. 'shared' = visible to all (admin-only). 'admin' = visible only to admins (admin-only). Defaults to 'admin' for admins, 'personal' otherwise.",
      })
    ),
    overwrite: Type.Optional(
      Type.Boolean({
        description: "Overwrite an existing skill at the target path. Default false.",
      })
    ),
  }),
};

export const skillInstallExecutor: ToolExecutor<SkillInstallParams> = async (
  params,
  context
): Promise<ToolResult> => {
  const viewer = viewerFromContext(context);

  if (!NAME_PATTERN.test(params.name)) {
    return {
      success: false,
      error: `Invalid skill name '${params.name}': must match ${NAME_PATTERN} (kebab-case, 1-64 chars).`,
    };
  }

  const scope: SkillScope = params.scope ?? (viewer.isAdmin ? "admin" : "personal");

  if ((scope === "shared" || scope === "admin") && !viewer.isAdmin) {
    return {
      success: false,
      error: `scope '${scope}' requires admin privileges. Use scope='personal' to install for yourself only.`,
    };
  }

  if (
    scope === "personal" &&
    (viewer.senderId === undefined || !Number.isInteger(viewer.senderId) || viewer.senderId <= 0)
  ) {
    return {
      success: false,
      error: "scope 'personal' requires a positive integer sender ID.",
    };
  }

  const existing = getSkillRegistry().get(params.name);
  if (existing) {
    if (!params.overwrite) {
      return {
        success: false,
        error: `Skill '${params.name}' already exists (owner: ${ownerLabel(existing.owner)}). Pass overwrite=true to replace it.`,
      };
    }
    if (!canOverwrite(existing.owner, scope, viewer)) {
      return {
        success: false,
        error: `Cannot overwrite skill '${params.name}' — it belongs to a different owner.`,
      };
    }
  }

  const fileText = buildSkillFile(params);

  const validation = parseSkillFile(fileText);
  if ("error" in validation) {
    return { success: false, error: `Generated SKILL.md failed validation: ${validation.error}` };
  }
  if (validation.frontmatter.name !== params.name) {
    return {
      success: false,
      error: "Internal error: generated frontmatter name does not match input name.",
    };
  }

  const targetDir = scopeDir(scope, viewer.senderId);
  const skillDir = join(targetDir, params.name);
  const skillPath = join(skillDir, "SKILL.md");

  try {
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(skillPath, fileText, { encoding: "utf-8", mode: 0o600 });
  } catch (error) {
    return { success: false, error: `Failed to write ${skillPath}: ${getErrorMessage(error)}` };
  }

  log.info(
    `🆕 Skill installed: ${params.name} (scope=${scope}${
      scope === "personal" ? `, user=${viewer.senderId}` : ""
    })`
  );

  getSkillRegistry().reloadFromDisk(WORKSPACE_PATHS.SKILLS_DIR);

  return {
    success: true,
    data: {
      name: params.name,
      scope,
      path: skillPath,
      directory: skillDir,
      overwritten: existing !== undefined,
    },
  };
};

function buildSkillFile(params: SkillInstallParams): string {
  const fm: Record<string, unknown> = {
    name: params.name,
    description: params.description,
  };
  if (params.version) fm.version = params.version;
  if (params.allowed_tools && params.allowed_tools.length > 0) {
    fm.allowed_tools = params.allowed_tools;
  }
  const yaml = stringifyYaml(fm).trimEnd();
  const body = params.body.endsWith("\n") ? params.body : `${params.body}\n`;
  return `---\n${yaml}\n---\n\n${body}`;
}

function scopeDir(scope: SkillScope, senderId: number | undefined): string {
  const root = WORKSPACE_PATHS.SKILLS_DIR;
  switch (scope) {
    case "shared":
      return join(root, "shared");
    case "admin":
      return join(root, "admin");
    case "personal":
      return join(root, "users", String(senderId));
  }
}

function ownerLabel(owner: SkillOwner): string {
  if (owner.kind === "user") return `personal user=${owner.userId}`;
  return owner.kind;
}

function canOverwrite(existing: SkillOwner, newScope: SkillScope, viewer: SkillViewer): boolean {
  if (existing.kind === "shared" && newScope === "shared") return viewer.isAdmin;
  if (existing.kind === "admin" && newScope === "admin") return viewer.isAdmin;
  if (existing.kind === "user" && newScope === "personal") {
    return existing.userId === viewer.senderId;
  }
  return false;
}

export const tools: ToolEntry[] = [
  { tool: skillInstallTool, executor: skillInstallExecutor, tags: ["core"] },
];
