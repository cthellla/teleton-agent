/**
 * Central tool registration for the Teleton agent.
 *
 * Each category exports a `tools: ToolEntry[]` array with scope info co-located.
 * Deals tools are loaded separately via module-loader.ts.
 */

import type { ToolRegistry } from "./registry.js";
import type { ToolEntry } from "./types.js";

import { tools as telegramTools } from "./telegram/index.js";
// import { tools as tonTools } from "./ton/index.js";        // Disabled: payment via plugin API
// import { tools as dnsTools } from "./dns/index.js";        // Disabled: not needed for HN bot
// import { tools as stonfiTools } from "./stonfi/index.js";  // Disabled: no DEX swaps
// import { tools as dedustTools } from "./dedust/index.js";  // Disabled: no DEX swaps
// import { tools as journalTools } from "./journal/index.js";  // Disabled: not needed for HN bot
// import { tools as workspaceTools } from "./workspace/index.js"; // Disabled: no file management
import { tools as webTools } from "./web/index.js";
import { tools as botTools } from "./bot/index.js";
import { tools as skillsTools } from "../skills/index.js";

const ALL_CATEGORIES: ToolEntry[][] = [
  telegramTools,
  // tonTools,
  // dnsTools,
  // stonfiTools,
  // dedustTools,
  // journalTools,
  // workspaceTools,
  webTools,
  botTools,
  skillsTools,
];

export function registerAllTools(registry: ToolRegistry): void {
  for (const category of ALL_CATEGORIES) {
    for (const { tool, executor, scope, requiredMode, tags } of category) {
      registry.register(tool, executor, scope, requiredMode, tags);
    }
  }
}
