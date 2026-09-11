import { describe, it, expect } from "vitest";
import { markdownToTelegramHtml } from "../formatting.js";

describe("markdownToTelegramHtml", () => {
  // Core fix: underscores in addresses/identifiers must NOT trigger formatting
  it("should not break underscores inside addresses", () => {
    const address = "EQBGar1Y7j_W4lnk_6P9abc";
    const result = markdownToTelegramHtml(`Your address: ${address}`);
    expect(result).toContain("EQBGar1Y7j_W4lnk_6P9abc");
    expect(result).not.toContain("<i>");
    expect(result).not.toContain("<b>");
  });

  it("should not break underscores in TON DNS names", () => {
    const result = markdownToTelegramHtml("Send to my_wallet_name.ton");
    expect(result).toContain("my_wallet_name.ton");
    expect(result).not.toContain("<i>");
  });

  it("should not break email-like strings with underscores", () => {
    const result = markdownToTelegramHtml("contact user_name_123@example.com");
    expect(result).not.toContain("<i>");
  });

  it("should not break underscored identifiers", () => {
    const result = markdownToTelegramHtml("use my_function_name to call it");
    expect(result).not.toContain("<i>");
    expect(result).toContain("my_function_name");
  });

  it("should treat standalone _text_ as literal underscores (not italic)", () => {
    // Underscore-based formatting is intentionally disabled to protect addresses
    const result = markdownToTelegramHtml("this is _italic_ text");
    expect(result).toContain("_italic_");
    expect(result).not.toContain("<i>italic</i>");
  });

  it("should treat __text__ as literal underscores (not bold)", () => {
    const result = markdownToTelegramHtml("this is __bold__ text");
    expect(result).toContain("__bold__");
    expect(result).not.toContain("<b>bold</b>");
  });

  // Asterisk-based formatting still works
  it("should handle asterisk bold", () => {
    const result = markdownToTelegramHtml("**bold** text");
    expect(result).toContain("<b>bold</b>");
  });

  it("should not convert single asterisk to italic (disabled like underscore)", () => {
    const result = markdownToTelegramHtml("*italic* text");
    expect(result).not.toContain("<i>");
    expect(result).toContain("*italic*");
  });

  it("should handle bold but not single-asterisk italic", () => {
    const result = markdownToTelegramHtml("**bold** and *italic*");
    expect(result).toContain("<b>bold</b>");
    expect(result).not.toContain("<i>");
  });

  it("should preserve code blocks with underscores", () => {
    const result = markdownToTelegramHtml("check `my_var_name` here");
    expect(result).toContain("<code>my_var_name</code>");
  });

  it("should handle strikethrough", () => {
    const result = markdownToTelegramHtml("~~deleted~~ text");
    expect(result).toContain("<s>deleted</s>");
  });

  it("should handle spoilers", () => {
    const result = markdownToTelegramHtml("this is ||secret|| content");
    expect(result).toContain("<tg-spoiler>secret</tg-spoiler>");
  });

  it("should handle links", () => {
    const result = markdownToTelegramHtml("[click here](https://example.com)");
    expect(result).toContain('<a href="https://example.com">click here</a>');
  });

  it("should handle multiple underscored words on same line", () => {
    const address = "addr_part1_part2_part3";
    const result = markdownToTelegramHtml(`Here: ${address}`);
    expect(result).toContain(address);
  });

  it("should escape HTML entities", () => {
    const result = markdownToTelegramHtml("1 < 2 & 3 > 0");
    expect(result).toContain("&lt;");
    expect(result).toContain("&amp;");
    expect(result).toContain("&gt;");
  });

  // ─── <tg-time> passthrough (date_time entity, Bot API 9.5) ───────────────
  describe("tg-time passthrough", () => {
    it("carries a valid tag through unescaped", () => {
      const out = markdownToTelegramHtml(
        'Posted <tg-time unix="1647531900" format="r">4h ago</tg-time>'
      );
      expect(out).toBe('Posted <tg-time unix="1647531900" format="r">4h ago</tg-time>');
    });

    it("accepts a tag without a format", () => {
      const out = markdownToTelegramHtml('<tg-time unix="1647531900">22:45</tg-time>');
      expect(out).toBe('<tg-time unix="1647531900">22:45</tg-time>');
    });

    it("accepts every control character the spec allows, unchanged", () => {
      // Assert the exact tag: toContain("<tg-time") would pass even if unix or
      // format came out wrong or were dropped entirely.
      for (const format of ["r", "w", "d", "D", "t", "T", "wDT", "wdt", ""]) {
        const tag = `<tg-time unix="1" format="${format}">x</tg-time>`;
        expect(markdownToTelegramHtml(tag)).toBe(tag);
      }
    });

    it("escapes a tag whose format violates r|w?[dD]?[tT]?", () => {
      // "r" cannot be combined, and "zz" is not a control character at all.
      for (const format of ["zz", "rt", "rw", "tw"]) {
        const out = markdownToTelegramHtml(`<tg-time unix="1" format="${format}">x</tg-time>`);
        expect(out).toContain("&lt;tg-time");
        expect(out).not.toContain("<tg-time");
      }
    });

    it("escapes a tag whose unix is not digits", () => {
      const out = markdownToTelegramHtml('<tg-time unix="abc" format="r">x</tg-time>');
      expect(out).toContain("&lt;tg-time");
      expect(out).not.toContain("<tg-time");
    });

    // Model output reaches this converter, so the passthrough must not become a
    // general HTML hole.
    it("escapes markup nested inside the label", () => {
      const out = markdownToTelegramHtml(
        '<tg-time unix="1" format="r"><b onclick=x>evil</b></tg-time>'
      );
      expect(out).toContain('<tg-time unix="1" format="r">');
      expect(out).toContain("&lt;b onclick=x&gt;evil&lt;/b&gt;");
      expect(out).not.toContain("<b onclick");
    });

    it("still escapes every other tag", () => {
      expect(markdownToTelegramHtml("<script>alert(1)</script>")).toBe(
        "&lt;script&gt;alert(1)&lt;/script&gt;"
      );
    });

    // Every test above puts the tag in plain text. The first implementation
    // restored placeholders before the blockquote/code restores, so a tag inside
    // a quote, a list or a code region emitted a raw NUL placeholder instead —
    // and a 3+ item bullet list is exactly the digest shape we want timestamps in.
    it("survives inside a blockquote", () => {
      const out = markdownToTelegramHtml('> Posted <tg-time unix="16" format="r">4h</tg-time> ok');
      expect(out).toBe(
        '<blockquote>Posted <tg-time unix="16" format="r">4h</tg-time> ok</blockquote>'
      );
    });

    it("survives inside a bullet list", () => {
      const out = markdownToTelegramHtml(
        '- a <tg-time unix="16" format="r">4h</tg-time>\n- b\n- c'
      );
      expect(out).toContain('<tg-time unix="16" format="r">4h</tg-time>');
      expect(out).not.toContain("DATETIME");
    });

    it("stays literal inside a fenced code block", () => {
      const out = markdownToTelegramHtml('```\n<tg-time unix="1" format="r">x</tg-time>\n```');
      expect(out).toBe('<pre>&lt;tg-time unix="1" format="r"&gt;x&lt;/tg-time&gt;</pre>');
    });

    it("stays literal inside inline code", () => {
      const out = markdownToTelegramHtml('use `<tg-time unix="1" format="r">x</tg-time>` here');
      expect(out).toContain("&lt;tg-time");
      expect(out).not.toContain("<tg-time unix");
    });

    it("never emits a placeholder", () => {
      const inputs = [
        '<tg-time unix="1" format="r">x</tg-time>',
        '> q <tg-time unix="1" format="r">x</tg-time>',
        '- a <tg-time unix="1">x</tg-time>\n- b\n- c',
        '`<tg-time unix="1">x</tg-time>`',
      ];
      for (const input of inputs) {
        expect(markdownToTelegramHtml(input)).not.toMatch(/\x00|DATETIME/);
      }
    });

    it("keeps an explicitly empty format rather than dropping it", () => {
      const tag = '<tg-time unix="1" format="">x</tg-time>';
      expect(markdownToTelegramHtml(tag)).toBe(tag);
    });

    // Code inside a label: code is extracted before tg-time, so the label already
    // holds a placeholder. The tests above never put code in a label, so the
    // "never emits a placeholder" sweep did not cover this — found in review.
    it("leaves a tag whose label contains inline code as text, without leaking", () => {
      const out = markdownToTelegramHtml('<tg-time unix="1" format="r">see `x`</tg-time>');
      expect(out).toBe('&lt;tg-time unix="1" format="r"&gt;see <code>x</code>&lt;/tg-time&gt;');
      expect(out).not.toMatch(/\x00|INLINECODE|DATETIME/);
    });

    it("leaves a tag whose label contains a code fence as text, without leaking", () => {
      const out = markdownToTelegramHtml('<tg-time unix="1" format="r">```\ncode\n```</tg-time>');
      expect(out).toBe('&lt;tg-time unix="1" format="r"&gt;<pre>code</pre>&lt;/tg-time&gt;');
      expect(out).not.toMatch(/\x00|CODEBLOCK|DATETIME/);
    });

    it("does not treat $-sequences in the label as replacement patterns", () => {
      const out = markdownToTelegramHtml('<tg-time unix="1" format="r">$& cost</tg-time>');
      expect(out).toBe('<tg-time unix="1" format="r">$&amp; cost</tg-time>');
    });
  });
});

describe("placeholder restore", () => {
  // The restores passed the payload to String.replace as the replacement string,
  // so $&, $', $` and $1 inside code acted as substitution patterns: the snippet
  // came back corrupted, and repeated it expanded until the reply was lost.
  it("keeps $& and $1 in a code block verbatim", () => {
    const html = markdownToTelegramHtml("```sh\ncost $& and $1\n```");

    expect(html).toContain("cost $&amp; and $1");
    expect(html).not.toContain("\u0000");
  });

  it.each([
    ["inline code", "цена `$& и $1` в строке"],
    ["dollar-quote", '```sh\necho "$\'"\n```'],
    ["dollar-backtick", '```sh\necho "$`"\n```'],
    ["blockquote with code", "> цитата с `$&` внутри"],
    ["blockquote plain text", "> цена $& рублей за $1 запрос"],
  ])("does not corrupt %s", (_case, markdown) => {
    const html = markdownToTelegramHtml(markdown);

    expect(html).not.toContain("\u0000");
    expect(html.length).toBeLessThan(markdown.length * 4);
  });

  it("does not explode on a fence full of $'", () => {
    const markdown = "```sh\n" + 'echo "$\'"\n'.repeat(400) + "```";

    const html = markdownToTelegramHtml(markdown);

    expect(html.length).toBeLessThan(markdown.length * 3);
    expect(html).not.toContain("\u0000");
  });
});
