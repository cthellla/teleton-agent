/**
 * `skill_invoke` tool — fetches the full body of a registered skill on demand.
 *
 * The system prompt advertises only `name + description` for each skill.
 * When the model decides a skill is relevant it calls this tool to load the
 * full SKILL.md body into the conversation. Resource files referenced by the
 * skill are not auto-loaded — the model reads them via `workspace_read` when
 * the body instructs it to.
 *
 * Visibility: only skills visible to the calling user (shared, plus admin if
 * they're an admin, plus their own personal skills) can be invoked.
 */

import { Type } from "@sinclair/typebox";
import type { Tool, ToolEntry, ToolExecutor, ToolResult } from "../tools/types.js";
import { getSkillRegistry } from "./registry.js";
import { viewerFromContext } from "./viewer.js";

interface SkillInvokeParams {
  name: string;
}

const MAX_SUGGESTIONS = 5;

export const skillInvokeTool: Tool = {
  name: "skill_invoke",
  description:
    "Load the full body of a skill listed under '## Available Skills' in the system prompt. " +
    "Returns the SKILL.md instructions and a list of resource files in the skill directory. " +
    "Call this when a skill's description matches the user's request.",
  category: "data-bearing",
  parameters: Type.Object({
    name: Type.String({
      description:
        "Exact skill name (e.g. 'hn-digest'). Must match an entry under Available Skills.",
    }),
  }),
};

export const skillInvokeExecutor: ToolExecutor<SkillInvokeParams> = async (
  params,
  context
): Promise<ToolResult> => {
  const registry = getSkillRegistry();
  const viewer = viewerFromContext(context);
  const skill = registry.getVisible(params.name, viewer);

  if (!skill) {
    const visible = registry.listVisible(viewer).map((s) => s.name);
    const suggestions = visible.slice(0, MAX_SUGGESTIONS);
    const hint =
      visible.length === 0
        ? "No skills are currently available to you."
        : `Available to you: ${suggestions.join(", ")}${visible.length > MAX_SUGGESTIONS ? ", ..." : ""}`;
    return {
      success: false,
      error: `Unknown or inaccessible skill '${params.name}'. ${hint}`,
    };
  }

  return {
    success: true,
    data: {
      name: skill.name,
      description: skill.description,
      version: skill.version,
      owner: skill.owner,
      directory: skill.dir,
      resources: skill.resources,
      body: skill.body,
    },
  };
};

export const tools: ToolEntry[] = [
  { tool: skillInvokeTool, executor: skillInvokeExecutor, tags: ["core"] },
];
