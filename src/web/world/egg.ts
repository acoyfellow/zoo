import { clamp01, easeOutBack, hashUnit } from "./math";

export type IncubationStage = "laid" | "safety" | "code" | "sprite" | "ready" | "failed";

export interface Speckle {
  angle: number;
  radius: number;
  size: number;
}

export interface Crack {
  points: { x: number; y: number }[];
}

export interface StageLook {
  wobbleRate: number;
  wobbleAngle: number;
  crackCount: number;
  crackGlow: number;
}

export const STAGE_LABELS: Record<IncubationStage, string> = {
  laid: "Laying the egg",
  safety: "Checking the description",
  code: "Writing behaviour",
  sprite: "Drawing the creature",
  ready: "Hatching",
  failed: "The egg did not hatch",
};

const STAGE_LOOKS: Record<IncubationStage, StageLook> = {
  laid: { wobbleRate: 1.2, wobbleAngle: 0.05, crackCount: 0, crackGlow: 0 },
  safety: { wobbleRate: 2, wobbleAngle: 0.08, crackCount: 0, crackGlow: 0 },
  code: { wobbleRate: 3.4, wobbleAngle: 0.12, crackCount: 3, crackGlow: 0.25 },
  sprite: { wobbleRate: 5, wobbleAngle: 0.16, crackCount: 6, crackGlow: 0.85 },
  ready: { wobbleRate: 7, wobbleAngle: 0.2, crackCount: 6, crackGlow: 1 },
  failed: { wobbleRate: 0, wobbleAngle: 0, crackCount: 5, crackGlow: 0 },
};

export function stageLook(stage: IncubationStage): StageLook {
  return STAGE_LOOKS[stage];
}

export function eggHue(seed: string): number {
  return Math.floor(hashUnit(seed, 41) * 360);
}

export function speckles(seed: string, count: number): Speckle[] {
  return Array.from({ length: count }, (_, index) => ({
    angle: hashUnit(`${seed}:${index}`, 11) * Math.PI * 2,
    radius: Math.sqrt(hashUnit(`${seed}:${index}`, 12)) * 0.85,
    size: 0.03 + hashUnit(`${seed}:${index}`, 13) * 0.06,
  }));
}

export function cracks(seed: string, count: number): Crack[] {
  return Array.from({ length: count }, (_, index) => {
    const startAngle = hashUnit(`${seed}c${index}`, 21) * Math.PI * 2;
    let x = Math.cos(startAngle) * 0.2;
    let y = Math.sin(startAngle) * 0.25;
    const points = [{ x, y }];

    for (let step = 0; step < 4; step++) {
      const turn = (hashUnit(`${seed}c${index}s${step}`, 22) - 0.5) * 1.6;
      x += Math.cos(startAngle + turn) * 0.18;
      y += Math.sin(startAngle + turn) * 0.22;
      points.push({ x, y });
    }

    return { points };
  });
}

export interface HatchProgress {
  split: number;
  spriteScale: number;
}

export function hatchProgress(sinceMs: number): HatchProgress {
  return {
    split: clamp01(sinceMs / 700),
    spriteScale: easeOutBack(clamp01((sinceMs - 250) / 650)),
  };
}
