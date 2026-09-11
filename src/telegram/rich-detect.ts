/**
 * Shared Rich Message helpers.
 *
 * Telegram's classic HTML subset has no headings, tables or italics, so a reply
 * written in ordinary Markdown reaches the user with raw `##` and `|---|` in it.
 * Rich Messages (Bot API 10.1+, MTProto InputRichMessageMarkdown) render all of
 * it natively. Both bridges need the same answer to "is this worth sending as a
 * rich message?", so the patterns live here rather than in one bridge.
 */

/** Telegram's cap for one rich message, counted in UTF-8 bytes. */
export const RICH_MESSAGE_MAX_BYTES = 32768;

/**
 * The limit is bytes, not JS characters, and Russian text costs two bytes per
 * character — a 20000-character answer is 40000 bytes. Measuring characters
 * would send it anyway and take the rejection.
 */
export function richMessageBytes(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

export function richMessageFits(text: string): boolean {
  return richMessageBytes(text) <= RICH_MESSAGE_MAX_BYTES;
}

const RICH_FORMATTING_PATTERNS = [
  /(?:^|\n)\s{0,3}#{1,6}\s+\S/, // heading
  /(?:^|\n)\s{0,3}(?:>\s*|[-+*]\s+|\d+[.)]\s+)\S/, // quote or list
  /(?:^|\n)\s{0,3}-\s+\[[ xX]\]\s+\S/, // task list
  /(?:^|\n)\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*(?:\n|$)/, // horizontal rule
  /(?:^|\n)\s*\|?(?:\s*:?-{3,}:?\s*\|){1,}\s*:?-{3,}:?\s*\|?\s*(?:\n|$)/, // table
  /```[\s\S]*?```|~~~[\s\S]*?~~~/, // fenced code
  /`[^`\n]+`/, // inline code
  /!?\[[^\]\n]+\]\([^) \n]+(?:\s+"[^"]*")?\)/, // link or image
  /<https?:\/\/[^>\s]+>/, // autolink
  /\*\*\S(?:[\s\S]*?\S)?\*\*/, // bold
  /(?<![\w_])__(?!_)(?=[^_\n]*\s)[^_\n]*?\S__(?![\w_])/, // underscore bold with spaces
  /~~\S(?:[\s\S]*?\S)?~~|\|\|\S(?:[\s\S]*?\S)?\|\|/, // strike or spoiler
  /(?:^|[^\w])\*\S(?:[^*\n]*?\S)?\*(?!\w)/, // italic with asterisks
  /(?<![\w_])_(?!_)\S(?:[^_\n]*?\S)?_(?![\w_])/, // italic with underscores
  /\\(?:\(|\[)[\s\S]+?\\(?:\)|\])|\$\$[\s\S]+?\$\$/, // display LaTeX
  /(?<![$\\])\$(?![$\s])[^$\n]+?(?<![\s\\])\$(?![\w$])/, // inline LaTeX
  /<\/?(?:a|b|blockquote|code|del|details|em|i|pre|s|strong|sub|summary|sup|tg-spoiler|u)(?:\s[^>]*)?>/i, // supported HTML
];

export function hasRichFormatting(text: string): boolean {
  return RICH_FORMATTING_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Rich Markdown accepts arbitrary HTML, which includes `<tg-button>` and
 * `tg://…?id=` media references. Model-authored text must never carry those:
 * an answer steered by a hostile article could otherwise render a button that
 * looks like the paywall's own "buy a pack" button, or point at a file the
 * model does not own. Callback buttons stay the caller's job (`inlineKeyboard`).
 */
const INTERACTIVE_RICH_MARKUP =
  /<\/?tg-(?:button-row|button|collage|slideshow|document|map|emoji|thinking)[^>]*>|tg:\/\/(?:photo|video|audio|document)\?id=[^\s")]*/gi;

export function stripInteractiveRichMarkup(text: string): string {
  // One pass is not enough: removing the inner tag of a nested pair splices the
  // outer halves back into a working tag, so
  // `<tg-<tg-button>button data="pack_1">Buy</...>` would come out as a real
  // button. Each pass can only shorten the text, so this terminates.
  let stripped = text;
  for (let previous = ""; previous !== stripped; ) {
    previous = stripped;
    stripped = stripped.replace(INTERACTIVE_RICH_MARKUP, "");
  }
  return stripped;
}
