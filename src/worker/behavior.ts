export const WORLD_SIZE = 800;

export const MAX_CODE_LENGTH = 4000;

export const BEHAVIOR_HEADER = "export default function behave(api, view) {";

const FORBIDDEN = [
  "import",
  "require",
  "fetch",
  "eval",
  "Function",
  "globalThis",
  "constructor",
  "prototype",
  "__proto__",
  "process",
  "WebSocket",
  "while",
];

export type ValidationResult = { ok: true; code: string } | { ok: false; reason: string };

export function extractCode(raw: string): string {
  const fenced = raw.match(/```(?:js|javascript)?\s*\n([\s\S]*?)```/);
  const body = fenced?.[1] ?? raw;
  const start = body.indexOf("export default function");

  return (start >= 0 ? body.slice(start) : body).trim();
}

export function stripComments(code: string): string {
  const slash = String.fromCharCode(47);
  const star = String.fromCharCode(42);
  const block = new RegExp(`\\${slash}\\${star}[\\s\\S]*?\\${star}\\${slash}`, "g");
  const line = new RegExp(`(^|[^:"'])\\${slash}\\${slash}.*$`, "gm");

  return code.replace(block, "").replace(line, "$1");
}

export function validateBehavior(raw: string): ValidationResult {
  const code = stripComments(extractCode(raw)).trim();

  if (code.length === 0) return { ok: false, reason: "empty" };

  if (code.length > MAX_CODE_LENGTH) return { ok: false, reason: "too long" };

  if (!code.startsWith(BEHAVIOR_HEADER)) return { ok: false, reason: "missing behave header" };

  if (!code.endsWith("}")) return { ok: false, reason: "unterminated" };
  const hit = FORBIDDEN.find((word) => code.includes(word)) ?? (/(^|[^.\w])self\b/.test(code) ? "self" : undefined);

  if (hit) return { ok: false, reason: `forbidden token: ${hit}` };

  if ((code.match(/export /g) ?? []).length !== 1) return { ok: false, reason: "multiple exports" };

  return { ok: true, code };
}

export function asNamedFunction(code: string, name: string): string {
  return code.replace("export default function behave(", `const ${name} = function (`);
}

export function mergeBehaviors(a: string, b: string, suffix: string): string {
  const left = `pa_${suffix}`;
  const right = `pb_${suffix}`;

  return [
    BEHAVIOR_HEADER,
    `  ${asNamedFunction(a, left)};`,
    `  ${asNamedFunction(b, right)};`,
    `  return (view.tick % 2 === 0 ? ${left} : ${right})(api, view);`,
    "}",
  ].join("\n");
}

export function creatureModule(code: string): string {
  return `import { DurableObject } from "cloudflare:workers";
${asNamedFunction(code, "behave")}
export class Creature extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS memory (k TEXT PRIMARY KEY, v TEXT NOT NULL)");
  }
  memory() {
    const out = {};
    for (const row of this.ctx.storage.sql.exec("SELECT k, v FROM memory LIMIT 50")) out[row.k] = row.v;
    return out;
  }
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/state") return Response.json({ memory: this.memory() });
    const view = await request.json();
    const actions = [];
    const sql = this.ctx.storage.sql;
    const api = {
      move: (dx, dy) => { if (actions.length < 20) actions.push({ type: "move", dx: Number(dx) || 0, dy: Number(dy) || 0 }); },
      say: (text) => { if (actions.length < 20) actions.push({ type: "say", text: String(text).slice(0, 80) }); },
      remember: (key, value) => {
        const k = String(key).slice(0, 40);
        const v = String(value).slice(0, 200);
        sql.exec("INSERT INTO memory (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", k, v);
        if (actions.length < 20) actions.push({ type: "remember", key: k, value: v });
      },
      recall: (key) => {
        for (const row of sql.exec("SELECT v FROM memory WHERE k = ?", String(key))) return row.v;
        return null;
      },
    };
    try {
      behave(api, view);
      return Response.json({ ok: true, actions });
    } catch (error) {
      return Response.json({ ok: false, actions: [], error: String(error).slice(0, 200) });
    }
  }
}
export default { fetch() { return new Response("creature"); } };
`;
}

export function trialModule(code: string): string {
  return `${asNamedFunction(code, "behave")}
export default {
  fetch() {
    const actions = [];
    const memory = {};
    const api = {
      move: (dx, dy) => actions.push({ type: "move", dx: Number(dx) || 0, dy: Number(dy) || 0 }),
      say: (text) => actions.push({ type: "say", text: String(text).slice(0, 80) }),
      remember: (k, v) => { memory[String(k)] = String(v); actions.push({ type: "remember", key: String(k).slice(0, 40), value: String(v).slice(0, 200) }); },
      recall: (k) => memory[String(k)] ?? null,
    };
    try {
      for (let tick = 0; tick < 3; tick++) {
        behave(api, { tick, self: { x: 400, y: 400, energy: 10 }, neighbors: [{ name: "moss", x: 420, y: 390, dx: 20, dy: -10, distance: 22 }], size: 800 });
      }
      return Response.json({ ok: true, actions: actions.slice(0, 20) });
    } catch (error) {
      return Response.json({ ok: false, actions: [], error: String(error).slice(0, 200) });
    }
  },
};
`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export const EDGE_MARGIN = 40;

export interface WorldPoint {
  x: number;
  y: number;
}

export function clampToWorld(x: number, y: number): WorldPoint {
  const safeX = Number.isFinite(x) ? x : WORLD_SIZE / 2;
  const safeY = Number.isFinite(y) ? y : WORLD_SIZE / 2;

  return {
    x: clamp(safeX, EDGE_MARGIN, WORLD_SIZE - EDGE_MARGIN),
    y: clamp(safeY, EDGE_MARGIN, WORLD_SIZE - EDGE_MARGIN),
  };
}

export function applyMove(x: number, y: number, dx: number, dy: number): WorldPoint {
  const step = 12;

  return clampToWorld(x + clamp(dx, -step, step), y + clamp(dy, -step, step));
}

export function hueFor(id: string): number {
  let hash = 0;

  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) % 360;

  return hash;
}

export function nameFrom(description: string): string {
  const words = description.match(/[A-Za-z]{3,}/g) ?? ["glim"];
  const pick = words.slice(-1)[0] ?? "glim";

  return pick.slice(0, 1).toUpperCase() + pick.slice(1, 10).toLowerCase();
}

const NAME_STARTS = [
  "Bo",
  "Ka",
  "Mi",
  "Lu",
  "Ze",
  "Ta",
  "Ri",
  "No",
  "Pe",
  "Su",
  "Vi",
  "Ju",
  "Fen",
  "Gro",
  "Ish",
  "Wren",
];

const NAME_MIDDLES = ["ba", "lo", "mi", "ra", "ku", "te", "zo", "vi"];

const NAME_ENDS = ["x", "n", "ra", "ble", "pip", "sk", "mo", "tt", "lin", "wick"];

function digit(seed: string, salt: number, size: number): number {
  return hueFor(`${salt}:${seed}`) % size;
}

export function childName(seed: string): string {
  const start = NAME_STARTS[digit(seed, 1, NAME_STARTS.length)] ?? "Bo";
  const middle = NAME_MIDDLES[digit(seed, 2, NAME_MIDDLES.length)] ?? "ba";
  const end = NAME_ENDS[digit(seed, 3, NAME_ENDS.length)] ?? "x";

  return `${start}${middle}${end}`;
}

export const PERSONAL_SPACE = 72;

export function separate<T extends WorldPoint & { id: string }>(points: T[]): Map<string, WorldPoint> {
  const moved = new Map<string, WorldPoint>(points.map((p) => [p.id, { x: p.x, y: p.y }]));

  for (const a of points) {
    for (const b of points) {
      if (a.id >= b.id) continue;
      const pa = moved.get(a.id);
      const pb = moved.get(b.id);

      if (!pa || !pb) continue;
      const dx = pb.x - pa.x || hueFor(a.id + b.id) / 360 - 0.5;
      const dy = pb.y - pa.y || hueFor(b.id + a.id) / 360 - 0.5;
      const distance = Math.hypot(dx, dy);

      if (distance >= PERSONAL_SPACE) continue;
      const push = (PERSONAL_SPACE - distance) / 2 / distance;
      moved.set(a.id, clampToWorld(pa.x - dx * push, pa.y - dy * push));
      moved.set(b.id, clampToWorld(pb.x + dx * push, pb.y + dy * push));
    }
  }

  return moved;
}

export const MEET_DISTANCE = 80;

export function pickEncounter<T extends { id: string; x: number; y: number; family: string; cooldown_until: number }>(
  all: T[],
  now: number,
): [T, T] | null {
  const ready = all.filter((r) => r.cooldown_until < now);
  let kin: [T, T] | null = null;

  for (const a of ready) {
    for (const b of ready) {
      if (a.id >= b.id || Math.hypot(a.x - b.x, a.y - b.y) >= MEET_DISTANCE) continue;

      if (a.family !== b.family) return [a, b];
      kin ??= [a, b];
    }
  }

  return kin;
}
