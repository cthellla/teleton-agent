import { tools as messagingTools } from "./messaging/index.js";
import { tools as mediaTools } from "./media/index.js";
import { tools as chatsTools } from "./chats/index.js";
import { tools as groupsTools } from "./groups/index.js";
import { tools as interactiveTools } from "./interactive/index.js";
// import { tools as stickersTools } from "./stickers/index.js";     // Disabled: no stickers
// import { tools as foldersTools } from "./folders/index.js";       // Disabled: no folder management
// import { tools as profileTools } from "./profile/index.js";       // Disabled: no profile editing
// import { tools as starsTools } from "./stars/index.js";           // Disabled: payment via plugin
// import { tools as giftsTools } from "./gifts/index.js";           // Disabled: no gifts
import { tools as contactsTools } from "./contacts/index.js";
// import { tools as storiesTools } from "./stories/index.js";       // Disabled: no stories
import { tools as memoryTools } from "./memory/index.js";
import { tools as tasksTools } from "./tasks/index.js";
import { sendButtonsEntry } from "./send-buttons.js";
import type { ToolEntry } from "../types.js";

// Messaging
export * from "./messaging/index.js";

// Chats
export * from "./chats/index.js";

// Groups & Members
export * from "./groups/index.js";

// Contacts
export * from "./contacts/index.js";

// Memory (agent self-memory management)
export * from "./memory/index.js";

// Tasks (scheduled task management)
export * from "./tasks/index.js";

// Media
export * from "./media/index.js";

// Interactive (polls, quizzes, keyboards, reactions)
export * from "./interactive/index.js";

export const tools: ToolEntry[] = [
  ...messagingTools,
  ...mediaTools,
  ...chatsTools,
  ...groupsTools,
  ...interactiveTools,
  // ...stickersTools,
  // ...foldersTools,
  // ...profileTools,
  // ...starsTools,
  // ...giftsTools,
  ...contactsTools,
  // ...storiesTools,
  ...memoryTools,
  ...tasksTools,
  sendButtonsEntry,
];
