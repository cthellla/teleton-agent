import type { ToolEntry } from "../tools/types.js";
import { tools as invokeTools } from "./tool.js";
import { tools as installTools } from "./install-tool.js";

export { initializeSkills, type SkillsHandle, type InitializeSkillsOptions } from "./init.js";
export { renderSkillsPromptSection } from "./prompt.js";
export type { Skill, SkillFrontmatter, SkillOwner, SkillViewer } from "./types.js";

export const tools: ToolEntry[] = [...invokeTools, ...installTools];
