export type EncounterResult = { outcome: string; probabilities: Record<string, number> | null };

import { DurableObject } from "cloudflare:workers";
import { z } from "zod";
import { type Fighter, judgeEncounter } from "./ai";
import { applyMove, creatureModule, hueFor, mergeBehaviors, WORLD_SIZE } from "./behavior";
import {
  CreatureState,
  type CreatureView,
  type NewCreature,
  NewCreature as NewCreatureSchema,
  TickResult,
  type WorldEvent,
  type WorldMessage,
} from "./schema";

const TICK_MS = 1500;
const MEET_DISTANCE = 24;
const MAX_ALIVE = 200;

const Row = z.object({
  id: z.string(),
  name: z.string(),
  code: z.string(),
  x: z.number(),
  y: z.number(),
  energy: z.number(),
  said: z.string(),
  generation: z.number(),
  cooldown_until: z.number(),
});
type Row = z.infer<typeof Row>;

export class World extends DurableObject<Env> {
  private tickCount = 0;
  private judging = false;
  private events: WorldEvent[] = [];

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS creatures (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, code TEXT NOT NULL,
      x REAL NOT NULL, y REAL NOT NULL, energy REAL NOT NULL,
      said TEXT NOT NULL DEFAULT '', generation INTEGER NOT NULL DEFAULT 0,
      cooldown_until INTEGER NOT NULL DEFAULT 0)`);
  }

  private rows(): Row[] {
    return this.ctx.storage.sql
      .exec("SELECT * FROM creatures")
      .toArray()
      .map((row) => Row.parse(row));
  }

  private view(row: Row): CreatureView {
    return {
      id: row.id,
      name: row.name,
      hue: hueFor(row.id),
      x: row.x,
      y: row.y,
      energy: row.energy,
      said: row.said,
      generation: row.generation,
    };
  }

  private broadcast(message: WorldMessage): void {
    const data = JSON.stringify(message);
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(data);
      } catch {
        socket.close(1011, "send failed");
      }
    }
  }

  private announce(text: string): void {
    const event = { at: Date.now(), text };
    this.events = [...this.events.slice(-29), event];
    this.broadcast({ type: "event", event });
  }

  private facet(row: Pick<Row, "id" | "code">): Fetcher {
    return this.ctx.facets.get(row.id, async () => {
      const worker = this.env.LOADER.get(`creature-${row.id}`, () => ({
        compatibilityDate: "2026-09-04",
        mainModule: "creature.js",
        modules: { "creature.js": creatureModule(row.code) },
        globalOutbound: null,
      }));
      return { class: worker.getDurableObjectClass("Creature") };
    });
  }

  private async ensureAlarm(): Promise<void> {
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + TICK_MS);
  }

  async addCreature(input: NewCreature): Promise<{ alive: number }> {
    const creature = NewCreatureSchema.parse(input);
    const alive = this.rows().length;
    if (alive >= MAX_ALIVE) throw new Error("world is full");
    this.ctx.storage.sql.exec(
      "INSERT INTO creatures (id, name, code, x, y, energy, generation) VALUES (?, ?, ?, ?, ?, ?, ?)",
      creature.id,
      creature.name,
      creature.code,
      Math.random() * WORLD_SIZE,
      Math.random() * WORLD_SIZE,
      10,
      creature.generation,
    );
    this.announce(`${creature.name} hatched`);
    await this.ensureAlarm();
    return { alive: alive + 1 };
  }

  async aliveCount(): Promise<number> {
    return this.rows().length;
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].send(
      JSON.stringify({ type: "snapshot", creatures: this.rows().map((r) => this.view(r)), events: this.events }),
    );
    await this.ensureAlarm();
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  override webSocketClose(socket: WebSocket): void {
    socket.close();
  }

  private neighborsOf(row: Row, all: Row[]) {
    return all
      .filter((other) => other.id !== row.id)
      .map((other) => ({
        name: other.name,
        x: other.x,
        y: other.y,
        dx: other.x - row.x,
        dy: other.y - row.y,
        distance: Math.hypot(other.x - row.x, other.y - row.y),
      }))
      .sort((p, q) => p.distance - q.distance)
      .slice(0, 5);
  }

  private async stepCreature(row: Row, all: Row[]): Promise<void> {
    const view = {
      tick: this.tickCount,
      self: { x: row.x, y: row.y, energy: row.energy },
      neighbors: this.neighborsOf(row, all),
      size: WORLD_SIZE,
    };
    let result: TickResult;
    try {
      const response = await this.facet(row).fetch("https://creature/tick", {
        method: "POST",
        body: JSON.stringify(view),
      });
      result = TickResult.parse(await response.json());
    } catch (error) {
      result = { ok: false, actions: [], error: String(error) };
    }
    let { x, y } = row;
    let said = row.said;
    for (const action of result.actions) {
      if (action.type === "move") ({ x, y } = applyMove(x, y, action.dx, action.dy));
      if (action.type === "say") said = action.text;
    }
    const energy = Math.max(0, row.energy - (result.ok ? 0.01 : 0.5));
    this.ctx.storage.sql.exec(
      "UPDATE creatures SET x = ?, y = ?, said = ?, energy = ? WHERE id = ?",
      x,
      y,
      said,
      energy,
      row.id,
    );
  }

  override async alarm(): Promise<void> {
    this.tickCount += 1;
    const before = this.rows();
    await Promise.all(before.map((row) => this.stepCreature(row, before)));
    const after = this.rows();
    for (const row of after.filter((r) => r.energy <= 0)) await this.fade(row, "ran out of energy");
    this.broadcast({ type: "snapshot", creatures: this.rows().map((r) => this.view(r)), events: [] });
    this.findEncounter(this.rows());
    if (this.rows().length > 0 || this.ctx.getWebSockets().length > 0)
      await this.ctx.storage.setAlarm(Date.now() + TICK_MS);
  }

  private findEncounter(all: Row[]): void {
    if (this.judging) return;
    const now = Date.now();
    const ready = all.filter((r) => r.cooldown_until < now);
    for (const a of ready) {
      for (const b of ready) {
        if (a.id < b.id && Math.hypot(a.x - b.x, a.y - b.y) < MEET_DISTANCE) {
          this.judging = true;
          this.ctx.waitUntil(this.encounter(a, b).finally(() => (this.judging = false)));
          return;
        }
      }
    }
  }

  async forceEncounter(): Promise<EncounterResult> {
    const [a, b] = this.rows();
    if (!a || !b) return { outcome: "need two creatures", probabilities: null };
    return this.encounter(a, b);
  }

  private async fighter(row: Row): Promise<Fighter> {
    const description = await this.env.DB.prepare("SELECT description FROM creatures WHERE id = ?")
      .bind(row.id)
      .first("description");
    let memory: Record<string, string> = {};
    try {
      const response = await this.facet(row).fetch("https://creature/state");
      memory = CreatureState.parse(await response.json()).memory;
    } catch {
      memory = {};
    }
    return {
      name: row.name,
      description: z.string().catch("").parse(description),
      energy: row.energy,
      memory,
      code: row.code,
    };
  }

  private async encounter(a: Row, b: Row): Promise<EncounterResult> {
    const cooldown = Date.now() + 20000;
    this.ctx.storage.sql.exec("UPDATE creatures SET cooldown_until = ? WHERE id IN (?, ?)", cooldown, a.id, b.id);
    this.announce(`${a.name} meets ${b.name}…`);
    let verdict: Awaited<ReturnType<typeof judgeEncounter>>;
    try {
      verdict = await judgeEncounter(this.env.AI, await this.fighter(a), await this.fighter(b));
    } catch (error) {
      this.announce(`the judge was silent (${String(error).slice(0, 60)})`);
      return { outcome: "judge failed", probabilities: null };
    }
    let childId: string | null = null;
    if (verdict.choice === "befriend") {
      this.announce(`${a.name} and ${b.name} befriend`);
      childId = await this.breed(a, b);
    } else {
      const [winner, loser] = verdict.choice === "a_wins" ? [a, b] : [b, a];
      this.announce(`${winner.name} defeats ${loser.name}`);
      this.ctx.storage.sql.exec("UPDATE creatures SET energy = energy + 5 WHERE id = ?", winner.id);
      await this.fade(loser, `lost to ${winner.name}`);
      if (winner.energy + 5 >= 20) childId = await this.breed(winner, winner);
    }
    await this.env.DB.prepare(
      "INSERT INTO encounters (id, a_id, b_id, outcome, probabilities, child_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(crypto.randomUUID(), a.id, b.id, verdict.choice, JSON.stringify(verdict.probabilities), childId, Date.now())
      .run();
    return { outcome: verdict.choice, probabilities: verdict.probabilities };
  }

  private async fade(row: Row, reason: string): Promise<void> {
    this.ctx.storage.sql.exec("DELETE FROM creatures WHERE id = ?", row.id);
    try {
      this.ctx.facets.delete(row.id);
    } catch {
      this.announce(`${row.name}'s memory lingers`);
    }
    await this.env.DB.prepare("UPDATE creatures SET fate = ? WHERE id = ?").bind(`faded: ${reason}`, row.id).run();
    this.announce(`${row.name} fades (${reason})`);
  }

  private async breed(a: Row, b: Row): Promise<string | null> {
    if (this.rows().length >= MAX_ALIVE) return null;
    const id = crypto.randomUUID();
    const code = mergeBehaviors(a.code, b.code, id.slice(0, 6));
    const name = `${a.name.slice(0, 4)}${b.name.slice(-3)}`;
    const generation = Math.max(a.generation, b.generation) + 1;
    await this.env.DB.prepare(
      "INSERT INTO creatures (id, name, description, code, model, parent_a, parent_b, ip_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(id, name, `offspring of ${a.name} and ${b.name}`, code, "merge", a.id, b.id, "breed", Date.now())
      .run();
    this.ctx.storage.sql.exec("UPDATE creatures SET energy = energy - 3 WHERE id IN (?, ?)", a.id, b.id);
    await this.addCreature({ id, name, code, generation });
    return id;
  }
}
