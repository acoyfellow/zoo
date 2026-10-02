import { describe, expect, test } from "bun:test";
import {
  applyMove,
  clampToWorld,
  EDGE_MARGIN,
  extractCode,
  mergeBehaviors,
  nameFrom,
  validateBehavior,
} from "../src/worker/behavior";
import { ClefOutput, TickResult } from "../src/worker/schema";
import { STARTERS } from "../src/worker/starters";

const good = `export default function behave(api, view) {
  api.move(view.tick % 2 ? 5 : -5, 3);
  api.say("hi");
}`;

describe("validateBehavior", () => {
  test("accepts a minimal module", () => {
    expect(validateBehavior(good).ok).toBe(true);
  });
  test("extracts fenced code", () => {
    expect(extractCode(`Here:\n\`\`\`js\n${good}\n\`\`\``)).toBe(good);
  });
  test("rejects forbidden tokens", () => {
    const bad = good.replace('api.say("hi");', 'fetch("https://x");');
    expect(validateBehavior(bad)).toEqual({ ok: false, reason: "forbidden token: fetch" });
  });
  test("allows view.self but rejects bare self", () => {
    expect(validateBehavior(good.replace("3);", "view.self.x);")).ok).toBe(true);
    expect(validateBehavior(good.replace("3);", "self.x);")).ok).toBe(false);
  });
  test("rejects missing header", () => {
    expect(validateBehavior("function x() {}").ok).toBe(false);
  });
  test("strips comments before validating", () => {
    expect(validateBehavior(good.replace("{\n", "{\n  // fetch me\n")).ok).toBe(true);
  });
});

describe("mergeBehaviors", () => {
  test("produces a valid module that runs both parents", () => {
    const merged = mergeBehaviors(good, good.replace("hi", "yo"), "abc123");
    expect(validateBehavior(merged).ok).toBe(true);
    const said: string[] = [];
    const run = new Function("api", "view", `${merged.replace("export default ", "")}\nreturn behave(api, view);`);
    run({ move: () => {}, say: (t: string) => said.push(t) }, { tick: 0 });
    run({ move: () => {}, say: (t: string) => said.push(t) }, { tick: 1 });
    expect(said).toEqual(["hi", "yo"]);
  });
});

describe("world math", () => {
  test("moves are clamped", () => {
    expect(applyMove(0, 790, -100, 100)).toEqual({ x: EDGE_MARGIN, y: 800 - EDGE_MARGIN });
    expect(applyMove(100, 100, 100, 0)).toEqual({ x: 112, y: 100 });
  });
  test("clampToWorld keeps creatures inside the edge margin", () => {
    expect(clampToWorld(-50, 9000)).toEqual({ x: EDGE_MARGIN, y: 800 - EDGE_MARGIN });
    expect(clampToWorld(Number.NaN, 400)).toEqual({ x: 400, y: 400 });
  });
  test("names come from description", () => {
    expect(nameFrom("a shy blue moth")).toBe("Moth");
  });
});

describe("starter creatures", () => {
  test("every starter passes the validator and has a distinct behavior", () => {
    expect(STARTERS.length).toBe(4);

    for (const starter of STARTERS) expect(validateBehavior(starter.code)).toEqual({ ok: true, code: starter.code });
    expect(new Set(STARTERS.map((s) => s.code)).size).toBe(4);
  });
});

describe("schemas", () => {
  test("clef output parses", () => {
    const parsed = ClefOutput.parse({
      answers: { outcome: { type: "choice", choice: "befriend", probabilities: { befriend: 0.7 }, confidence: 0.6 } },
    });

    expect(parsed.answers.outcome.choice).toBe("befriend");
  });
  test("tick result rejects unknown actions", () => {
    expect(TickResult.safeParse({ ok: true, actions: [{ type: "explode" }] }).success).toBe(false);
  });
});
