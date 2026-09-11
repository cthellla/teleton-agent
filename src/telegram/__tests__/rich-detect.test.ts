import { describe, expect, it } from "vitest";
import {
  RICH_MESSAGE_MAX_LENGTH,
  hasRichFormatting,
  stripInteractiveRichMarkup,
} from "../rich-detect.js";

describe("hasRichFormatting", () => {
  // These are exactly the shapes the HTML subset drops: the reason a reply
  // reaches the user with raw "##" and "|---|" in it.
  it.each([
    ["heading", "## 📰 Show HN: Hacker News, Without AI"],
    ["table", "| Автор | otherayden |\n|---|---|\n| Очки | 143 |"],
    ["italic", "комментатор сказал *«было бы смешно»* — так и вышло"],
    ["horizontal rule", "конец\n\n---\n\n👉 дальше"],
    ["list", "- Понравилось: чистый дизайн"],
    ["bold", "**Автор:** otherayden"],
    ["inline code", "запусти `npm ci` перед сборкой"],
    ["link", "репозиторий: [hn-without-ai](https://github.com/leiDnedyA/hn-without-ai)"],
  ])("detects %s", (_name, text) => {
    expect(hasRichFormatting(text)).toBe(true);
  });

  it.each([
    ["plain sentence", "Готово, я посмотрел эту статью и ничего интересного там нет."],
    ["bare url", "https://news.ycombinator.com/item?id=48334515"],
    ["multiplication", "2 * 3 * 4 = 24"],
  ])("leaves %s on the classic path", (_name, text) => {
    expect(hasRichFormatting(text)).toBe(false);
  });
});

describe("stripInteractiveRichMarkup", () => {
  // Rich Markdown accepts arbitrary HTML. A reply steered by a hostile article
  // must not be able to render its own buttons next to the paywall's.
  it("removes buttons the model authored", () => {
    const text =
      'Купите пак:\n<tg-button-row align="center">' +
      '<tg-button type="callback_data" data="stars_pack_30">30 ★</tg-button>' +
      "</tg-button-row>\nвот и всё";
    expect(stripInteractiveRichMarkup(text)).toBe("Купите пак:\n30 ★\nвот и всё");
  });

  it("removes tg:// media references", () => {
    expect(stripInteractiveRichMarkup("картинка ![p](tg://photo?id=abc123) внизу")).toBe(
      "картинка ![p]() внизу"
    );
  });

  it("keeps ordinary markdown and links untouched", () => {
    const text = "## Заголовок\n\n| a | b |\n|---|---|\n| 1 | [ссылка](https://t.me/) |";
    expect(stripInteractiveRichMarkup(text)).toBe(text);
  });
});

describe("RICH_MESSAGE_MAX_LENGTH", () => {
  it("matches the documented rich message limit", () => {
    expect(RICH_MESSAGE_MAX_LENGTH).toBe(32768);
  });
});
