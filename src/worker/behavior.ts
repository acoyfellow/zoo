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

export function clampToWorld(x: number, y: number): { x: number; y: number } {
  const safeX = Number.isFinite(x) ? x : WORLD_SIZE / 2;
  const safeY = Number.isFinite(y) ? y : WORLD_SIZE / 2;
  return {
    x: clamp(safeX, EDGE_MARGIN, WORLD_SIZE - EDGE_MARGIN),
    y: clamp(safeY, EDGE_MARGIN, WORLD_SIZE - EDGE_MARGIN),
  };
}

export function applyMove(x: number, y: number, dx: number, dy: number): { x: number; y: number } {
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
