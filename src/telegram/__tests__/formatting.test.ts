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

    it("accepts every control character the spec allows", () => {
      for (const format of ["r", "w", "d", "D", "t", "T", "wDT", "wdt", ""]) {
        const tag = `<tg-time unix="1" format="${format}">x</tg-time>`;
        expect(markdownToTelegramHtml(tag)).toContain("<tg-time");
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

    it("does not treat $-sequences in the label as replacement patterns", () => {
      const out = markdownToTelegramHtml('<tg-time unix="1" format="r">$& cost</tg-time>');
      expect(out).toBe('<tg-time unix="1" format="r">$&amp; cost</tg-time>');
    });
  });
});
