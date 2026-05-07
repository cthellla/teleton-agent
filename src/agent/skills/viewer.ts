import type { ToolContext } from "../tools/types.js";
import type { SkillViewer } from "./types.js";

/** Build a SkillViewer from a tool execution context. */
export function viewerFromContext(context: ToolContext): SkillViewer {
  const adminIds = context.config?.telegram?.admin_ids ?? [];
  const senderId = context.senderId;
  return {
    senderId,
    isAdmin: senderId !== undefined && adminIds.includes(senderId),
  };
}
