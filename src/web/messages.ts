import { z } from "zod";

export const SpriteState = z.enum(["pending", "ready", "glyph"]);

export type SpriteState = z.infer<typeof SpriteState>;

export function hasStoredSprite(state: SpriteState): boolean {
  return state === "ready";
}

export const Creature = z.object({
  id: z.string(),
  name: z.string(),
  hue: z.number(),
  x: z.number(),
  y: z.number(),
  energy: z.number(),
  said: z.string(),
  generation: z.number(),
  sprite: SpriteState.catch("pending"),
});

export type Creature = z.infer<typeof Creature>;

export const WorldEvent = z.object({ at: z.number(), text: z.string() });

export type WorldEvent = z.infer<typeof WorldEvent>;

export const Encounter = z.object({
  at: z.number(),
  a: z.string(),
  b: z.string(),
  aId: z.string().catch(""),
  bId: z.string().catch(""),
  childId: z.string().nullable().catch(null),
  outcome: z.enum(["a_wins", "b_wins", "befriend"]),
  probabilities: z.object({ a_wins: z.number(), b_wins: z.number(), befriend: z.number() }),
});

export type Encounter = z.infer<typeof Encounter>;

export const EggStage = z.enum(["laid", "safety", "code", "sprite", "ready", "failed"]);

export type EggStage = z.infer<typeof EggStage>;

export const Egg = z.object({
  id: z.string(),
  x: z.number(),
  y: z.number(),
  seed: z.string(),
  stage: EggStage,
  creatureId: z.string().nullable(),
  error: z.string().nullable(),
  at: z.number(),
});

export type Egg = z.infer<typeof Egg>;

export const WorldMessage = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("snapshot"),
    creatures: z.array(Creature),
    events: z.array(WorldEvent),
    encounters: z.array(Encounter).catch([]),
    eggs: z.array(Egg).catch([]),
  }),
  z.object({ type: z.literal("egg"), egg: Egg }),
  z.object({ type: z.literal("event"), event: WorldEvent }),
  z.object({ type: z.literal("encounter"), encounter: Encounter }),
  z.object({ type: z.literal("sprite"), id: z.string(), sprite: SpriteState }),
  z.object({ type: z.literal("meeting"), aId: z.string(), bId: z.string() }),
]);

export const LineageCreature = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable().catch(null),
  parent_a: z.string().nullable().catch(null),
  parent_b: z.string().nullable().catch(null),
  fate: z.string().nullable().catch(null),
  created_at: z.number(),
});

export type LineageCreature = z.infer<typeof LineageCreature>;

export const LineageReply = z.object({ creatures: z.array(LineageCreature) });

export const SpawnReply = z.union([
  z.object({ id: z.string(), name: z.string(), code: z.string() }),
  z.object({ error: z.string() }),
]);
