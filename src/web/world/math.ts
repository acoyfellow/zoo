export interface Spring {
  value: number;
  velocity: number;
}

export interface Vec {
  x: number;
  y: number;
}

export interface Squash {
  along: number;
  across: number;
}

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));

  return t * t * (3 - 2 * t);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function interpolate(from: Vec, to: Vec, alpha: number): Vec {
  const t = clamp01(alpha);

  return { x: lerp(from.x, to.x, t), y: lerp(from.y, to.y, t) };
}

export function squashFor(speed: number, maxStretch: number): Squash {
  const along = 1 + Math.min(Math.abs(speed) * 0.012, maxStretch);

  return { along, across: 1 / along };
}

export function springStep(spring: Spring, target: number, omega: number, dt: number): Spring {
  const offset = spring.value - target;
  const decay = Math.exp(-omega * dt);
  const drift = (spring.velocity + omega * offset) * dt;

  return {
    value: target + (offset + drift) * decay,
    velocity: (spring.velocity - omega * drift) * decay,
  };
}

export function wrapAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

export function angleSpringStep(spring: Spring, target: number, omega: number, dt: number): Spring {
  const nearest = spring.value + wrapAngle(target - spring.value);

  return springStep(spring, nearest, omega, dt);
}

export function hashUnit(id: string, salt: number): number {
  let hash = 2166136261 ^ salt;

  for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);

  return ((hash >>> 0) % 10000) / 10000;
}

export function breathScale(id: string, seconds: number): number {
  const phase = hashUnit(id, 1) * Math.PI * 2;
  const rate = 0.6 + hashUnit(id, 2) * 0.6;

  return 1 + Math.sin(seconds * rate * Math.PI * 2 + phase) * 0.035;
}

export function easeOutCubic(t: number): number {
  return 1 - (1 - clamp01(t)) ** 3;
}

export function easeOutBack(t: number): number {
  const c = 1.70158;
  const x = clamp01(t) - 1;

  return 1 + (c + 1) * x ** 3 + c * x ** 2;
}

export function alphaFromColor(r: number, g: number, b: number): number {
  return smoothstep(0.04, 0.25, Math.max(r, g, b) / 255);
}

export interface MeshPoint {
  x: number;
  y: number;
}

export const GRID = 4;

export function meshVertices(size: number, sway: number): MeshPoint[] {
  const points: MeshPoint[] = [];

  for (let row = 0; row < GRID; row++) {
    const lag = (row / (GRID - 1)) ** 2;

    for (let column = 0; column < GRID; column++) {
      const x = (column / (GRID - 1) - 0.5) * size + sway * lag;
      const y = (row / (GRID - 1) - 0.5) * size;
      points.push({ x, y });
    }
  }

  return points;
}
