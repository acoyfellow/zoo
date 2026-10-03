import { expect, test } from "bun:test";
import { highlight } from "../src/web/highlight";

test("highlight keeps every character and marks keywords, strings, and numbers", () => {
  const code = 'export default function behave(api, view) {\n  api.say("hi");\n  api.move(5, 2);\n}';
  const tokens = highlight(code);

  expect(tokens.map((t) => t.text).join("")).toBe(code);
  expect(tokens.find((t) => t.text === "function")?.kind).toBe("keyword");
  expect(tokens.find((t) => t.text === '"hi"')?.kind).toBe("string");
  expect(tokens.find((t) => t.text === "5")?.kind).toBe("number");
  expect(tokens.find((t) => t.text === "api")?.kind).toBe("plain");
});
