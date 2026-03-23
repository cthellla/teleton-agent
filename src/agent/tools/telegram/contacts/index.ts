import { telegramBlockUserTool, telegramBlockUserExecutor } from "./block-user.js";
import { telegramGetBlockedTool, telegramGetBlockedExecutor } from "./get-blocked.js";
import { telegramGetCommonChatsTool, telegramGetCommonChatsExecutor } from "./get-common-chats.js";
import { telegramGetUserInfoTool, telegramGetUserInfoExecutor } from "./get-user-info.js";
import { telegramCheckUsernameTool, telegramCheckUsernameExecutor } from "./check-username.js";
import type { ToolEntry } from "../../types.js";

export { telegramBlockUserTool, telegramBlockUserExecutor };
export { telegramGetBlockedTool, telegramGetBlockedExecutor };
export { telegramGetCommonChatsTool, telegramGetCommonChatsExecutor };
export { telegramGetUserInfoTool, telegramGetUserInfoExecutor };
export { telegramCheckUsernameTool, telegramCheckUsernameExecutor };

export const tools: ToolEntry[] = [
  {
    tool: telegramBlockUserTool,
    executor: telegramBlockUserExecutor,
    scope: "dm-only",
    requiredMode: "user",
  },
  {
    tool: telegramGetBlockedTool,
    executor: telegramGetBlockedExecutor,
    scope: "dm-only",
    requiredMode: "user",
  },
  {
    tool: telegramGetCommonChatsTool,
    executor: telegramGetCommonChatsExecutor,
    requiredMode: "user",
  },
  { tool: telegramGetUserInfoTool, executor: telegramGetUserInfoExecutor, requiredMode: "user" },
  {
    tool: telegramCheckUsernameTool,
    executor: telegramCheckUsernameExecutor,
    requiredMode: "user",
  },
];
