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

export const WorldMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("snapshot"), creatures: z.array(Creature), events: z.array(WorldEvent) }),
  z.object({ type: z.literal("event"), event: WorldEvent }),
]);

export const SpawnReply = z.union([
  z.object({ id: z.string(), name: z.string(), code: z.string() }),
  z.object({ error: z.string() }),
]);
