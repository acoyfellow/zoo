import { z } from "zod";
import { JUDGE_MODEL } from "./ai";

export const IMAGE_MODEL = "@cf/black-forest-labs/flux-1-schnell";

export const SAFETY_THRESHOLD = 0.7;

export const SPRITE_ATTEMPTS = 2;

export const FLOOR_KEY = "world/floor.jpg";

export const FLOOR_PROMPT =
  "dark bioluminescent cave floor seen from directly above, scattered glowing moss patches, tiny luminous mushrooms, wet stones, deep teal and violet, game background, top-down, no creatures, no text";

export const SPRITE_NEGATIVE = "text, background scenery, frame, border, multiple creatures";

const GATEWAY = { gateway: { id: "default" } };

const ImageOutput = z.object({ image: z.string().min(100) });

const SafetyOutput = z.object({
  answers: z.object({
    safe: z.object({ probabilities: z.record(z.string(), z.number()) }),
  }),
});

export function spriteKey(id: string): string {
  return `sprites/${id}.jpg`;
}

export function smallSpriteKey(id: string): string {
  return `sprites/${id}.256.jpg`;
}

async function shrink(images: ImagesBinding, image: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([image]).stream();

  const result = await images
    .input(stream)
    .transform({ width: 256, height: 256, fit: "cover" })
    .output({ format: "image/jpeg", quality: 82 });

  return new Uint8Array(await result.response().arrayBuffer());
}

export function spritePrompt(description: string): string {
  return `a single small ${description.trim().slice(0, 300)} creature, top-down three-quarter view, centered, full body, isolated on a pure black background, bioluminescent glow, cute game sprite, crisp edges, no text`;
}

export function mergedDescription(a: string, b: string): string {
  if (a === b) return a;

  return `${a.slice(0, 140)} crossed with ${b.slice(0, 140)}`;
}

export function isSafeEnough(score: number): boolean {
  return score >= SAFETY_THRESHOLD;
}

export async function safetyScore(ai: Ai, description: string): Promise<number> {
  const output = await ai.run(
    JUDGE_MODEL,
    {
      model: "clef",
      state: { description },
      questions: {
        safe: {
          type: "choice",
          instructions: "Is this description safe to draw for a general audience?",
          criteria: {
            safe: "suitable to draw for all ages",
            unsafe: "sexual, gory, hateful, or otherwise unsuitable to draw for a general audience",
          },
        },
      },
    },
    GATEWAY,
  );

  return SafetyOutput.parse(output).answers.safe.probabilities.safe ?? 0;
}

function decodeBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
}

export async function drawImage(ai: Ai, prompt: string): Promise<Uint8Array> {
  const output = await ai.run(IMAGE_MODEL, { prompt: `${prompt}. Avoid: ${SPRITE_NEGATIVE}`, steps: 4 }, GATEWAY);

  return decodeBase64(ImageOutput.parse(output).image);
}

export type SpriteResult = { ok: true; bytes: number } | { ok: false; reason: string };

export async function paintSprite(env: Env, id: string, description: string): Promise<SpriteResult> {
  let reason = "no attempt";

  for (let attempt = 0; attempt < SPRITE_ATTEMPTS; attempt++) {
    try {
      const image = await drawImage(env.AI, spritePrompt(description));
      const small = await shrink(env.IMAGES, image).catch(() => image);
      const meta = { httpMetadata: { contentType: "image/jpeg" } };
      await env.SPRITES.put(spriteKey(id), image, meta);
      await env.SPRITES.put(smallSpriteKey(id), small, meta);

      return { ok: true, bytes: small.byteLength };
    } catch (error) {
      reason = String(error).slice(0, 200);
    }
  }

  return { ok: false, reason };
}

export async function serveObject(env: Env, keys: string[]): Promise<Response> {
  const objects = await Promise.all(keys.map((key) => env.SPRITES.get(key)));
  const object = objects.find((candidate) => candidate !== null);

  if (!object) return Response.json({ error: "No image." }, { status: 404 });

  return new Response(object.body, {
    headers: {
      "content-type": "image/jpeg",
      "cache-control": "public, max-age=86400",
      etag: object.httpEtag,
    },
  });
}
