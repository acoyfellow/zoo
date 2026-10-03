import { describe, expect, test } from "bun:test";
import {
  MIN_TICK_GAP_MS,
  nextAlarmAt,
  nextBatch,
  nextTickDelay,
  runSteps,
  StepTimeout,
  TICK_MS,
  WATCHDOG_MS,
  withTimeout,
} from "../src/worker/tick";

describe("nextAlarmAt", () => {
  test("arms when no alarm exists", () => {
    expect(nextAlarmAt(1000, null)).toBe(1000 + TICK_MS);
  });
  test("keeps a pending watchdog alarm", () => {
    expect(nextAlarmAt(1000, 1000 + WATCHDOG_MS)).toBeNull();
  });
  test("re-arms a stale alarm far in the past", () => {
    expect(nextAlarmAt(100_000, 1000)).toBe(100_000 + TICK_MS);
  });
  test("re-arms an alarm too far in the future", () => {
    expect(nextAlarmAt(1000, 1000 + 60_000)).toBe(1000 + TICK_MS);
  });
});

describe("nextBatch", () => {
  test("returns everything under the cap", () => {
    expect(nextBatch([1, 2, 3], 2, 5)).toEqual({ batch: [1, 2, 3], cursor: 0 });
  });
  test("rotates through items over the cap", () => {
    const items = [1, 2, 3, 4, 5];
    const first = nextBatch(items, 0, 2);
    const second = nextBatch(items, first.cursor, 2);
    const third = nextBatch(items, second.cursor, 2);

    expect([first.batch, second.batch, third.batch]).toEqual([
      [1, 2],
      [3, 4],
      [5, 1],
    ]);
  });
});

describe("runSteps", () => {
  test("a throwing or slow creature does not stop the others", async () => {
    const applied: string[] = [];
    const problems: string[] = [];

    const report = await runSteps(
      ["fast", "throws", "slow"],
      async (name) => {
        if (name === "throws") throw new Error("boom");

        if (name === "slow") await new Promise((resolve) => setTimeout(resolve, 200));

        return name;
      },
      (_name, result) => applied.push(result),
      (name, outcome) => problems.push(`${name}:${outcome}`),
      20,
    );

    expect(applied).toEqual(["fast"]);
    expect(problems.sort()).toEqual(["slow:timed out", "throws:failed"]);
    expect(report).toEqual({ stepped: 1, failed: 1, timedOut: 1 });
  });
});

test("withTimeout rejects with StepTimeout", async () => {
  const never = new Promise<number>(() => undefined);

  expect(withTimeout(never, 5)).rejects.toBeInstanceOf(StepTimeout);
});

test("runSteps never runs more than the concurrency limit at once", async () => {
  let active = 0;
  let peak = 0;

  await runSteps(
    Array.from({ length: 20 }, (_, i) => i),
    async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
    },
    () => undefined,
    () => undefined,
    100,
    8,
  );

  expect(peak).toBe(8);
});

describe("nextTickDelay", () => {
  test("subtracts the time the tick took", () => {
    expect(nextTickDelay(0, 400)).toBe(TICK_MS - 400);
  });
  test("never waits less than the minimum gap after an overrun", () => {
    expect(nextTickDelay(0, TICK_MS * 3)).toBe(MIN_TICK_GAP_MS);
  });
});
