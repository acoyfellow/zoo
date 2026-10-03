import { expect, test } from "bun:test";
import { hasStoredSprite } from "../src/web/messages";

test("only ready sprites are fetched, so pending and glyph creatures cause no 404", () => {
  expect(hasStoredSprite("ready")).toBe(true);
  expect(hasStoredSprite("pending")).toBe(false);
  expect(hasStoredSprite("glyph")).toBe(false);
});
