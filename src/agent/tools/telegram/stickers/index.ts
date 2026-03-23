import { telegramSearchStickersTool, telegramSearchStickersExecutor } from "./search-stickers.js";
import { telegramSearchGifsTool, telegramSearchGifsExecutor } from "./search-gifs.js";
import { telegramGetMyStickersTool, telegramGetMyStickersExecutor } from "./get-my-stickers.js";
import { telegramAddStickerSetTool, telegramAddStickerSetExecutor } from "./add-sticker-set.js";
import type { ToolEntry } from "../../types.js";

export { telegramSearchStickersTool, telegramSearchStickersExecutor };
export { telegramSearchGifsTool, telegramSearchGifsExecutor };
export { telegramGetMyStickersTool, telegramGetMyStickersExecutor };
export { telegramAddStickerSetTool, telegramAddStickerSetExecutor };

export const tools: ToolEntry[] = [
  {
    tool: telegramSearchStickersTool,
    executor: telegramSearchStickersExecutor,
    requiredMode: "user",
  },
  { tool: telegramSearchGifsTool, executor: telegramSearchGifsExecutor, requiredMode: "user" },
  {
    tool: telegramGetMyStickersTool,
    executor: telegramGetMyStickersExecutor,
    requiredMode: "user",
  },
  {
    tool: telegramAddStickerSetTool,
    executor: telegramAddStickerSetExecutor,
    requiredMode: "user",
  },
];
