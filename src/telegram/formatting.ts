function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function sanitizeUrl(url: string): string {
  const trimmed = url.trim().toLowerCase();
  if (/^(javascript|data|vbscript|file):/i.test(trimmed)) return "#";
  return url.replace(/"/g, "&quot;");
}

export function markdownToTelegramHtml(markdown: string): string {
  if (!markdown) return "";

  let html = markdown;

  const codeBlocks: string[] = [];
  const inlineCodes: string[] = [];
  const blockquotes: string[] = [];
  const dateTimes: string[] = [];

  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_match, lang, code) => {
    const index = codeBlocks.length;
    const escapedCode = escapeHtml(code.trim());
    if (lang) {
      codeBlocks.push(`<pre><code class="language-${lang}">${escapedCode}</code></pre>`);
    } else {
      codeBlocks.push(`<pre>${escapedCode}</pre>`);
    }
    return `\x00CODEBLOCK${index}\x00`;
  });

  html = html.replace(/`([^`]+)`/g, (_match, code) => {
    const index = inlineCodes.length;
    inlineCodes.push(`<code>${escapeHtml(code)}</code>`);
    return `\x00INLINECODE${index}\x00`;
  });

  // Carry <tg-time> through unescaped so Telegram renders the timestamp in each
  // reader's own timezone. Everything else stays escaped: model output reaches
  // this function, so an unrestricted passthrough would be an HTML injection
  // hole. Attributes are validated against the Bot API spec — unix must be
  // digits and format must match r|w?[dD]?[tT]? — and anything failing that is
  // left alone to be escaped as ordinary text.
  html = html.replace(
    /<tg-time\s+unix="(\d+)"(?:\s+format="([^"]*)")?\s*>([\s\S]*?)<\/tg-time>/g,
    (match, unix: string, format: string | undefined, label: string) => {
      if (format !== undefined && !/^(r|w?[dD]?[tT]?)$/.test(format)) return match;
      // Code inside the label was already extracted to a placeholder, and a tg-time
      // entity cannot contain code anyway. Leave the whole tag as text so the code
      // restores below put the code back and no placeholder can escape.
      if (label.includes("\x00")) return match;
      const index = dateTimes.length;
      const attrs = format === undefined ? ` unix="${unix}"` : ` unix="${unix}" format="${format}"`;
      dateTimes.push(`<tg-time${attrs}>${escapeHtml(label)}</tg-time>`);
      return `\x00DATETIME${index}\x00`;
    }
  );

  const listPattern = /^(- .+(?:\n- .+){2,})/gm;
  html = html.replace(listPattern, (match) => {
    const index = blockquotes.length;
    const lineCount = match.split("\n").length;

    const content = escapeHtml(match)
      .replace(/\|\|([^|]+)\|\|/g, "<tg-spoiler>$1</tg-spoiler>")
      .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
      .replace(/~~([^~]+)~~/g, "<s>$1</s>")
      .replace(
        /\[([^\]]+)\]\(([^)]+)\)/g,
        (_, text, url) => `<a href="${sanitizeUrl(url)}">${text}</a>`
      );

    const tag = lineCount >= 15 ? "<blockquote expandable>" : "<blockquote>";
    blockquotes.push(`${tag}${content}</blockquote>`);
    return `\x00BLOCKQUOTE${index}\x00`;
  });

  html = html.replace(/^(>.*(?:\n>.*)*)/gm, (match) => {
    const index = blockquotes.length;
    const lineCount = match.split("\n").length;

    let content = escapeHtml(
      match
        .split("\n")
        .map((line) => line.replace(/^>\s?/, ""))
        .join("\n")
    );

    content = content
      .replace(/\|\|([^|]+)\|\|/g, "<tg-spoiler>$1</tg-spoiler>")
      .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
      .replace(/~~([^~]+)~~/g, "<s>$1</s>")
      .replace(
        /\[([^\]]+)\]\(([^)]+)\)/g,
        (_, text, url) => `<a href="${sanitizeUrl(url)}">${text}</a>`
      );

    const tag = lineCount >= 15 ? "<blockquote expandable>" : "<blockquote>";
    blockquotes.push(`${tag}${content}</blockquote>`);
    return `\x00BLOCKQUOTE${index}\x00`;
  });

  html = escapeHtml(html);

  html = html.replace(/\|\|([^|]+)\|\|/g, "<tg-spoiler>$1</tg-spoiler>");

  html = html.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  html = html.replace(/~~([^~]+)~~/g, "<s>$1</s>");

  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_, text, url) => `<a href="${sanitizeUrl(url)}">${text}</a>`
  );

  blockquotes.forEach((quote, index) => {
    html = html.replace(`\x00BLOCKQUOTE${index}\x00`, quote);
  });

  codeBlocks.forEach((block, index) => {
    html = html.replace(`\x00CODEBLOCK${index}\x00`, block);
  });

  inlineCodes.forEach((code, index) => {
    html = html.replace(`\x00INLINECODE${index}\x00`, code);
  });

  // Last: a tg-time can sit inside a blockquote or list, whose text is only put
  // back into `html` by the restores above. Running earlier left a raw NUL
  // placeholder in the message for exactly the digest-shaped input we care about.
  // Function form — a string replacement would treat $& / $1 in the payload as
  // substitution patterns (the restores above still have that bug, teletonhnplugin#16).
  dateTimes.forEach((tag, index) => {
    html = html.replace(`\x00DATETIME${index}\x00`, () => tag);
  });

  return html;
}
