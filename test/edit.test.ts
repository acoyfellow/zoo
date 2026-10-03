import { describe, expect, test } from "bun:test";
import { checkEdit } from "../src/worker/edit";
import type { TickResult } from "../src/worker/schema";

const passing = async (): Promise<TickResult> => ({ ok: true, actions: [] });

const good = `export default function behave(api, view) {
  api.move(1, 0);
}`;

describe("checkEdit", () => {
  test("accepts code that passes the static check and the trial", async () => {
    expect(await checkEdit(good, passing)).toEqual({ ok: true, code: good });
  });
  test("rejects fetch before the trial runs", async () => {
    let ran = false;

    const verdict = await checkEdit(
      `export default function behave(api, view) {\n  fetch("https://evil.example");\n}`,
      async () => {
        ran = true;

        return { ok: true, actions: [] };
      },
    );

    expect(verdict).toEqual({ ok: false, reason: "The static check rejected the code: forbidden token: fetch." });
    expect(ran).toBe(false);
  });
  test("rejects globalThis", async () => {
    const verdict = await checkEdit(`export default function behave(api, view) {\n  globalThis.x = 1;\n}`, passing);

    expect(verdict).toEqual({ ok: false, reason: "The static check rejected the code: forbidden token: globalThis." });
  });
  test("rejects a while loop statically", async () => {
    const verdict = await checkEdit(`export default function behave(api, view) {\n  while (true) {}\n}`, passing);

    expect(verdict).toEqual({ ok: false, reason: "The static check rejected the code: forbidden token: while." });
  });
  test("rejects an infinite for loop when the trial never finishes", async () => {
    const verdict = await checkEdit(
      `export default function behave(api, view) {\n  for (;;) {}\n}`,
      () => new Promise<TickResult>(() => undefined),
      10,
    );

    expect(verdict.ok).toBe(false);
    expect(verdict.ok ? "" : verdict.reason).toContain("The 3-tick trial did not finish");
  });
  test("reports the trial error", async () => {
    const verdict = await checkEdit(good, async () => ({ ok: false, actions: [], error: "TypeError: x" }));

    expect(verdict).toEqual({ ok: false, reason: "The 3-tick trial threw: TypeError: x" });
  });
  test("rejects code without the behave header", async () => {
    const verdict = await checkEdit("function x() {}", passing);

    expect(verdict.ok).toBe(false);
  });
});
