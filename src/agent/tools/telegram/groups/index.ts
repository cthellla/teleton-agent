import { telegramGetMeTool, telegramGetMeExecutor } from "./get-me.js";
import {
  telegramGetParticipantsTool,
  telegramGetParticipantsExecutor,
} from "./get-participants.js";
import {
  telegramKickUserTool,
  telegramKickUserExecutor,
  telegramBanUserTool,
  telegramBanUserExecutor,
  telegramUnbanUserTool,
  telegramUnbanUserExecutor,
} from "./moderation.js";
import { telegramCreateGroupTool, telegramCreateGroupExecutor } from "./create-group.js";
import { telegramSetChatPhotoTool, telegramSetChatPhotoExecutor } from "./set-chat-photo.js";
import type { ToolEntry } from "../../types.js";

export { telegramGetMeTool, telegramGetMeExecutor };
export { telegramGetParticipantsTool, telegramGetParticipantsExecutor };
export {
  telegramKickUserTool,
  telegramKickUserExecutor,
  telegramBanUserTool,
  telegramBanUserExecutor,
  telegramUnbanUserTool,
  telegramUnbanUserExecutor,
};
export { telegramCreateGroupTool, telegramCreateGroupExecutor };
export { telegramSetChatPhotoTool, telegramSetChatPhotoExecutor };

export const tools: ToolEntry[] = [
  { tool: telegramGetMeTool, executor: telegramGetMeExecutor },
  {
    tool: telegramGetParticipantsTool,
    executor: telegramGetParticipantsExecutor,
    requiredMode: "user",
  },
  {
    tool: telegramKickUserTool,
    executor: telegramKickUserExecutor,
    scope: "group-only",
    requiredMode: "user",
  },
  {
    tool: telegramBanUserTool,
    executor: telegramBanUserExecutor,
    scope: "group-only",
    requiredMode: "user",
  },
  {
    tool: telegramUnbanUserTool,
    executor: telegramUnbanUserExecutor,
    scope: "group-only",
    requiredMode: "user",
  },
  {
    tool: telegramCreateGroupTool,
    executor: telegramCreateGroupExecutor,
    scope: "dm-only",
    requiredMode: "user",
  },
  {
    tool: telegramSetChatPhotoTool,
    executor: telegramSetChatPhotoExecutor,
    scope: "group-only",
    requiredMode: "user",
  },
];
