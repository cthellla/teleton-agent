// Re-export shim for backward compatibility
export { GramJSUserBridge as TelegramBridge } from "./bridges/user.js";
export type {
  TelegramMessage,
  InlineButton,
  SendMessageOptions,
  SentMessage,
  EditMessageOptions,
  ReplyContext,
  BotInfo,
  ChatInfo,
  ITelegramBridge,
} from "./bridge-interface.js";
