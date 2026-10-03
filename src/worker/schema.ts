import { z } from "zod";

export const EggPlacement = z.object({
  id: z.string().uuid(),
  x: z.number().finite(),
  y: z.number().finite(),
});

export type EggPlacement = z.infer<typeof EggPlacement>;

export const SpawnRequest = z.object({
  description: z.string().trim().min(3).max(400),
  egg: EggPlacement.optional(),
});

export const EggStage = z.enum(["laid", "safety", "code", "sprite", "ready", "failed"]);

export type EggStage = z.infer<typeof EggStage>;

export const EggView = z.object({
  id: z.string(),
  x: z.number(),
  y: z.number(),
  seed: z.string(),
  stage: EggStage,
  creatureId: z.string().nullable(),
  error: z.string().nullable(),
  at: z.number(),
});

export type EggView = z.infer<typeof EggView>;

export const ActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("move"), dx: z.number().finite(), dy: z.number().finite() }),
  z.object({ type: z.literal("say"), text: z.string().max(80) }),
  z.object({ type: z.literal("remember"), key: z.string().max(40), value: z.string().max(200) }),
]);

export type Action = z.infer<typeof ActionSchema>;

export const TickResult = z.object({
  ok: z.boolean(),
  actions: z.array(ActionSchema).max(20),
  error: z.string().optional(),
});

export type TickResult = z.infer<typeof TickResult>;

export const CreatureState = z.object({
  memory: z.record(z.string(), z.string()),
});

export const ModelOutput = z.union([
  z.object({ response: z.string() }),
  z.object({
    choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }) })).min(1),
  }),
]);

export const ClefOutput = z.object({
  answers: z.object({
    outcome: z.object({
      choice: z.enum(["a_wins", "b_wins", "befriend"]),
      probabilities: z.record(z.string(), z.number()),
      confidence: z.number().optional(),
    }),
  }),
});

export type ClefOutput = z.infer<typeof ClefOutput>;

export const SpriteState = z.enum(["pending", "ready", "glyph"]);

export const CreatureView = z.object({
  id: z.string(),
  name: z.string(),
  hue: z.number(),
  x: z.number(),
  y: z.number(),
  energy: z.number(),
  said: z.string(),
  generation: z.number(),
  sprite: SpriteState,
});

export type CreatureView = z.infer<typeof CreatureView>;

export const WorldEvent = z.object({
  at: z.number(),
  text: z.string(),
});

export type WorldEvent = z.infer<typeof WorldEvent>;

export const EncounterView = z.object({
  at: z.number(),
  a: z.string(),
  b: z.string(),
  aId: z.string(),
  bId: z.string(),
  childId: z.string().nullable(),
  outcome: z.enum(["a_wins", "b_wins", "befriend"]),
  probabilities: z.object({ a_wins: z.number(), b_wins: z.number(), befriend: z.number() }),
});

export type EncounterView = z.infer<typeof EncounterView>;

export const WorldMessage = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("snapshot"),
    creatures: z.array(CreatureView),
    events: z.array(WorldEvent),
    encounters: z.array(EncounterView),
    eggs: z.array(EggView),
  }),
  z.object({ type: z.literal("egg"), egg: EggView }),
  z.object({ type: z.literal("event"), event: WorldEvent }),
  z.object({ type: z.literal("encounter"), encounter: EncounterView }),
  z.object({ type: z.literal("sprite"), id: z.string(), sprite: SpriteState }),
  z.object({ type: z.literal("meeting"), aId: z.string(), bId: z.string() }),
]);

export type WorldMessage = z.infer<typeof WorldMessage>;

export const NewCreature = z.object({
  id: z.string(),
  name: z.string(),
  code: z.string(),
  generation: z.number().int(),
});

export type NewCreature = z.infer<typeof NewCreature>;

export const SpawnResponse = z.object({
  id: z.string(),
  name: z.string(),
  code: z.string(),
});
