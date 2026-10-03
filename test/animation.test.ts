import { describe, expect, test } from "bun:test";
import {
  alphaFromColor,
  angleSpringStep,
  breathScale,
  easeOutBack,
  interpolate,
  meshVertices,
  type Spring,
  springStep,
  squashFor,
} from "../src/web/world/math";
import { isSafeEnough, mergedDescription, SAFETY_THRESHOLD, spritePrompt } from "../src/worker/art";

describe("squash and stretch", () => {
  test("conserves area at every speed", () => {
    for (const speed of [0, 1, 10, 40, 200, 5000]) {
      const squash = squashFor(speed, 0.3);
      expect(squash.along * squash.across).toBeCloseTo(1, 10);
    }
  });
  test("stretches more when faster, up to the cap", () => {
    expect(squashFor(20, 0.3).along).toBeGreaterThan(squashFor(5, 0.3).along);
    expect(squashFor(1e6, 0.3).along).toBeCloseTo(1.3, 10);
  });
});

describe("critically damped spring", () => {
  test("settles on the target without overshoot", () => {
    let spring: Spring = { value: 0, velocity: 0 };
    let peak = 0;

    for (let i = 0; i < 240; i++) {
      spring = springStep(spring, 10, 8, 1 / 60);
      peak = Math.max(peak, spring.value);
    }

    expect(spring.value).toBeCloseTo(10, 3);
    expect(Math.abs(spring.velocity)).toBeLessThan(1e-3);
    expect(peak).toBeLessThanOrEqual(10 + 1e-9);
  });
  test("result does not depend on frame rate", () => {
    let fast: Spring = { value: 0, velocity: 0 };
    let slow: Spring = { value: 0, velocity: 0 };

    for (let i = 0; i < 120; i++) fast = springStep(fast, 1, 6, 1 / 120);

    for (let i = 0; i < 30; i++) slow = springStep(slow, 1, 6, 1 / 30);
    expect(fast.value).toBeCloseTo(slow.value, 6);
  });
  test("heading turns the short way around", () => {
    let heading: Spring = { value: Math.PI - 0.1, velocity: 0 };

    for (let i = 0; i < 300; i++) heading = angleSpringStep(heading, -Math.PI + 0.1, 6, 1 / 60);
    expect(heading.value).toBeCloseTo(Math.PI + 0.1, 3);
  });
});

describe("interpolation between ticks", () => {
  test("hits both ends and the midpoint", () => {
    const from = { x: 0, y: 100 };
    const to = { x: 12, y: 88 };
    expect(interpolate(from, to, 0)).toEqual(from);
    expect(interpolate(from, to, 1)).toEqual(to);
    expect(interpolate(from, to, 0.5)).toEqual({ x: 6, y: 94 });
  });
  test("clamps alpha so late frames do not overshoot", () => {
    expect(interpolate({ x: 0, y: 0 }, { x: 10, y: 0 }, 3)).toEqual({ x: 10, y: 0 });
  });
});

describe("sprite helpers", () => {
  test("black becomes transparent and bright stays opaque", () => {
    expect(alphaFromColor(0, 0, 0)).toBe(0);
    expect(alphaFromColor(8, 8, 8)).toBe(0);
    expect(alphaFromColor(255, 40, 10)).toBe(1);
  });
  test("breathing stays within 4 percent", () => {
    for (let t = 0; t < 10; t += 0.1) {
      const scale = breathScale("abc", t);
      expect(Math.abs(scale - 1)).toBeLessThanOrEqual(0.035 + 1e-9);
    }
  });
  test("overshoot ease ends at 1 and passes it on the way", () => {
    expect(easeOutBack(1)).toBeCloseTo(1, 10);
    expect(Math.max(easeOutBack(0.6), easeOutBack(0.7), easeOutBack(0.8))).toBeGreaterThan(1);
  });
  test("mesh sway moves only the back rows", () => {
    const still = meshVertices(100, 0);
    const swayed = meshVertices(100, 20);
    expect(swayed[0]).toEqual(still[0]);
    expect((swayed[15]?.x ?? 0) - (still[15]?.x ?? 0)).toBeCloseTo(20, 10);
  });
  test("safety threshold and prompts", () => {
    expect(isSafeEnough(SAFETY_THRESHOLD)).toBe(true);
    expect(isSafeEnough(SAFETY_THRESHOLD - 0.01)).toBe(false);
    expect(spritePrompt("blue moth")).toContain("a single small blue moth creature");
    expect(mergedDescription("a", "b")).toBe("a crossed with b");
  });
});
