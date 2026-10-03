import { z } from "zod";
import { CODE_MODEL, writeBehavior } from "./ai";
import { FLOOR_KEY, isSafeEnough, SAFETY_THRESHOLD, safetyScore, serveObject, smallSpriteKey, spriteKey } from "./art";
import { nameFrom, trialModule } from "./behavior";
import { SpawnRequest, TickResult } from "./schema";

export { World } from "./world";

const MAX_PER_IP_PER_HOUR = 10;

const MAX_ALIVE = 200;

function world(env: Env) {
  return env.WORLD.getByName("terrarium");
}

async function hashIp(ip: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`zoo:${ip}`));

  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

async function trial(env: Env, code: string): Promise<TickResult> {
  const worker = env.LOADER.load({
    compatibilityDate: "2026-09-04",
    mainModule: "trial.js",
    modules: { "trial.js": trialModule(code) },
    globalOutbound: null,
  });

  const response = await worker.getEntrypoint().fetch("https://trial/");

  return TickResult.parse(await response.json());
}

async function spawn(request: Request, env: Env): Promise<Response> {
  const body = SpawnRequest.safeParse(await request.json().catch(() => null));

  if (!body.success) return Response.json({ error: "Write a description of 3 to 400 characters." }, { status: 400 });
  const ipHash = await hashIp(request.headers.get("CF-Connecting-IP") ?? "unknown");

  const recent = z.number().parse(
    await env.DB.prepare("SELECT COUNT(*) AS n FROM creatures WHERE ip_hash = ? AND created_at > ?")
      .bind(ipHash, Date.now() - 3600_000)
      .first("n"),
  );

  if (recent >= MAX_PER_IP_PER_HOUR)
    return Response.json(
      { error: "Limit reached: 10 creatures per hour from one address. Try again later." },
      { status: 429 },
    );
  const stub = world(env);

  if ((await stub.aliveCount()) >= MAX_ALIVE)
    return Response.json(
      { error: "The world has 200 creatures, which is the limit. Try again later." },
      { status: 429 },
    );
  const safety = await safetyScore(env.AI, body.data.description).catch(() => 0);

  if (!isSafeEnough(safety))
    return Response.json(
      {
        error: `The safety check scored this description ${safety.toFixed(2)}. It must reach ${SAFETY_THRESHOLD} to be drawn. Try a different description.`,
      },
      { status: 422 },
    );
  const behavior = await writeBehavior(env.AI, body.data.description);

  if (!behavior.ok)
    return Response.json(
      { error: "The model did not write a valid behavior. Try a different description." },
      { status: 422 },
    );
  const result = await trial(env, behavior.code);

  if (!result.ok)
    return Response.json({ error: "The behavior failed its trial run. Try a different description." }, { status: 422 });
  const id = crypto.randomUUID();
  const name = nameFrom(body.data.description);
  await env.DB.prepare(
    "INSERT INTO creatures (id, name, description, code, model, ip_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(id, name, body.data.description, behavior.code, CODE_MODEL, ipHash, Date.now())
    .run();
  await stub.addCreature({ id, name, code: behavior.code, generation: 0 }, body.data.description);

  return Response.json({ id, name, code: behavior.code, safety });
}

async function lineage(env: Env): Promise<Response> {
  const creatures = await env.DB.prepare(
    "SELECT id, name, description, model, parent_a, parent_b, fate, created_at FROM creatures ORDER BY created_at DESC LIMIT 50",
  ).all();

  const encounters = await env.DB.prepare("SELECT * FROM encounters ORDER BY created_at DESC LIMIT 50").all();

  return Response.json({ creatures: creatures.results, encounters: encounters.results });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/world") return world(env).fetch(request);

    if (url.pathname === "/api/creatures" && request.method === "POST") return spawn(request, env);

    if (url.pathname === "/api/lineage") return lineage(env);

    if (url.pathname === "/api/floor") return serveObject(env, [FLOOR_KEY]);
    const sprite = url.pathname.match(/^\/api\/sprite\/([0-9a-f-]{36})$/);

    if (sprite?.[1]) {
      const id = sprite[1];
      const keys = url.searchParams.get("size") === "full" ? [spriteKey(id)] : [smallSpriteKey(id), spriteKey(id)];

      return serveObject(env, keys);
    }

    if (url.pathname === "/api/encounter" && request.method === "POST") {
      return Response.json(await world(env).forceEncounter());
    }

    return Response.json({ error: "Not found." }, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
