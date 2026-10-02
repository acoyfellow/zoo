import { z } from "zod";

export const Creature = z.object({
  id: z.string(),
  name: z.string(),
  hue: z.number(),
  x: z.number(),
  y: z.number(),
  energy: z.number(),
  said: z.string(),
  generation: z.number(),
});

export type Creature = z.infer<typeof Creature>;

export const WorldEvent = z.object({ at: z.number(), text: z.string() });

export type WorldEvent = z.infer<typeof WorldEvent>;

export const Encounter = z.object({
  at: z.number(),
  a: z.string(),
  b: z.string(),
  outcome: z.enum(["a_wins", "b_wins", "befriend"]),
  probabilities: z.object({ a_wins: z.number(), b_wins: z.number(), befriend: z.number() }),
});

export type Encounter = z.infer<typeof Encounter>;

export const WorldMessage = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("snapshot"),
    creatures: z.array(Creature),
    events: z.array(WorldEvent),
    encounters: z.array(Encounter).catch([]),
  }),
  z.object({ type: z.literal("event"), event: WorldEvent }),
  z.object({ type: z.literal("encounter"), encounter: Encounter }),
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
