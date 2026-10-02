import { BEHAVIOR_HEADER, type ValidationResult, validateBehavior } from "./behavior";
import { type ClefOutput, ClefOutput as ClefOutputSchema, ModelOutput } from "./schema";

export const CODE_MODEL = "@cf/moonshotai/kimi-k2.7-code";

export const JUDGE_MODEL = "@cf/cloudflare/clef";

const GATEWAY = { gateway: { id: "default" } };

export const CREATURE_API_PROMPT = `You write behavior modules for tiny glowing creatures in a 800x800 terrarium.
Output ONLY JavaScript, no prose, no comments. The module must be exactly one function starting with:
${BEHAVIOR_HEADER}
It is called once per tick. Available:
- api.move(dx, dy): step, clamped to 12 per axis per tick
- api.say(text): short speech bubble, max 80 chars
- api.remember(key, value): persist a string in the creature's own memory
- api.recall(key): read a remembered string or null
- view.tick: integer tick count
- view.self: { x, y, energy }
- view.neighbors: array of { name, x, y, dx, dy, distance } sorted nearest first
- view.size: 800
Rules: no imports, no fetch, no eval, no while loops, no globals, under 40 lines, deterministic or Math.random only.`;

function textOf(parsed: ReturnType<typeof ModelOutput.safeParse>): string {
  if (!parsed.success) return "";

  if ("response" in parsed.data) return parsed.data.response;

  return parsed.data.choices[0]?.message.content ?? "";
}

export async function writeBehavior(ai: Ai, description: string): Promise<ValidationResult> {
  let lastReason = "no attempt";

  for (let attempt = 0; attempt < 2; attempt++) {
    const output = await ai.run(
      CODE_MODEL,
      {
        messages: [
          { role: "system", content: CREATURE_API_PROMPT },
          {
            role: "user",
            content: `Creature: ${description}${attempt > 0 ? `\nPrevious attempt was rejected: ${lastReason}` : ""}`,
          },
        ],
        max_tokens: 4000,
        temperature: 0.4,
      },
      GATEWAY,
    );

    const text = textOf(ModelOutput.safeParse(output));
    const result = validateBehavior(text);

    if (result.ok) return result;
    lastReason = text.length === 0 ? `empty model output: ${JSON.stringify(output).slice(0, 300)}` : result.reason;
  }

  return { ok: false, reason: lastReason };
}

export type Fighter = {
  name: string;
  description: string;
  energy: number;
  memory: Record<string, string>;
  code: string;
};

export async function judgeEncounter(ai: Ai, a: Fighter, b: Fighter): Promise<ClefOutput["answers"]["outcome"]> {
  const output = await ai.run(
    JUDGE_MODEL,
    {
      model: "clef",
      state: { creature_a: a, creature_b: b },
      questions: {
        outcome: {
          type: "choice",
          instructions:
            "Two small creatures meet in a terrarium. Based on their descriptions, energy, memories and behavior code, decide what happens.",
          criteria: {
            a_wins: "creature_a overpowers or outwits creature_b",
            b_wins: "creature_b overpowers or outwits creature_a",
            befriend: "they are compatible and become friends",
          },
        },
      },
    },
    GATEWAY,
  );

  return ClefOutputSchema.parse(output).answers.outcome;
}
