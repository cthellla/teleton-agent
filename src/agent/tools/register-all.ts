/**
 * Central tool registration for the Teleton agent.
 *
 * Each category exports a `tools: ToolEntry[]` array with scope info co-located.
 * Built-in modules (ton-proxy, exec) are loaded separately via module-loader.ts.
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
import { tools as skillsTools } from "../skills/index.js";
import {
  toolResultReadExecutor,
  toolResultReadTool,
  toolSearchTool,
  createToolSearchExecutor,
} from "./search/index.js";
import { getBuiltinMinimumAccess } from "./security-policy.js";

const ALL_CATEGORIES: ToolEntry[][] = [
  telegramTools,
  // tonTools,
  // dnsTools,
  // stonfiTools,
  // dedustTools,
  // journalTools,
  // workspaceTools,
  webTools,
  skillsTools,
];

export function registerAllTools(registry: ToolRegistry): void {
  for (const category of ALL_CATEGORIES) {
    for (const { tool, executor, scope, mode, tags, minimumAccess } of category) {
      registry.register(
        tool,
        executor,
        scope,
        mode,
        tags,
        minimumAccess ?? getBuiltinMinimumAccess(tool, scope)
      );
    }
  }

  registry.register(toolResultReadTool, toolResultReadExecutor, "open", "both", ["core"], "all");

  // Register tool_search LAST so its executor closure captures a fully-populated registry.
  // scope "open" (always available), tags ["core"] so getCoreTools() includes it.
  // The executor lazily reads registry.getToolIndex() + registry.getEmbedder() at call time,
  // both of which are set during startAgent() — after this registration.
  const toolSearchExecutor = createToolSearchExecutor(registry);
  registry.register(toolSearchTool, toolSearchExecutor, "open", "both", ["core"], "all");
}
