import { telegramUpdateProfileTool, telegramUpdateProfileExecutor } from "./update-profile.js";
import { telegramSetBioTool, telegramSetBioExecutor } from "./set-bio.js";
import { telegramSetUsernameTool, telegramSetUsernameExecutor } from "./set-username.js";
import {
  telegramSetPersonalChannelTool,
  telegramSetPersonalChannelExecutor,
} from "./set-personal-channel.js";
import type { ToolEntry } from "../../types.js";

export { telegramUpdateProfileTool, telegramUpdateProfileExecutor };
export { telegramSetBioTool, telegramSetBioExecutor };
export { telegramSetUsernameTool, telegramSetUsernameExecutor };
export { telegramSetPersonalChannelTool, telegramSetPersonalChannelExecutor };

export const tools: ToolEntry[] = [
  {
    tool: telegramUpdateProfileTool,
    executor: telegramUpdateProfileExecutor,
    scope: "dm-only",
    requiredMode: "user",
  },
  {
    tool: telegramSetBioTool,
    executor: telegramSetBioExecutor,
    scope: "dm-only",
    requiredMode: "user",
  },
  {
    tool: telegramSetUsernameTool,
    executor: telegramSetUsernameExecutor,
    scope: "dm-only",
    requiredMode: "user",
  },
  {
    tool: telegramSetPersonalChannelTool,
    executor: telegramSetPersonalChannelExecutor,
    scope: "dm-only",
    requiredMode: "user",
  },
];
