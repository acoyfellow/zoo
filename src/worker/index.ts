import { z } from "zod";
import { CODE_MODEL, writeBehavior } from "./ai";
import { FLOOR_KEY, isSafeEnough, SAFETY_THRESHOLD, safetyScore, serveObject, smallSpriteKey, spriteKey } from "./art";
import { nameFrom, trialModule, type ValidationResult } from "./behavior";
import { checkEdit, MAX_EDITS_PER_IP_PER_HOUR } from "./edit";
import { CodeEdit, type EggStage, RevertRequest, SpawnRequest, TickResult } from "./schema";

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
    limits: { cpuMs: 50 },
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
  const egg = body.data.egg;
  const description = body.data.description;

  const stage = async (next: EggStage, error?: string): Promise<void> => {
    if (egg) await stub.incubate(egg, description, next, error ? { error } : {});
  };

  const fail = async (error: string, status: number): Promise<Response> => {
    await stage("failed", error);

    return Response.json({ error }, { status });
  };

  if ((await stub.aliveCount()) >= MAX_ALIVE)
    return Response.json(
      { error: "The world has 200 creatures, which is the limit. Try again later." },
      { status: 429 },
    );
  await stage("safety");

  const safety = await safetyScore(env.AI, description).catch((error) => {
    console.error("safety check failed", String(error).slice(0, 300));

    return 0;
  });

  if (!isSafeEnough(safety))
    return fail(
      `Clef refused this description. Its safety score was ${safety.toFixed(2)} and it must reach ${SAFETY_THRESHOLD}. Try a different description.`,
      422,
    );
  await stage("code");

  const behavior = await writeBehavior(env.AI, description).catch(
    (): ValidationResult => ({ ok: false, reason: "model error" }),
  );

  if (!behavior.ok) return fail("The model did not write a valid behavior. Try a different description.", 422);
  const result = await trial(env, behavior.code).catch((): TickResult => ({ ok: false, actions: [] }));

  if (!result.ok) return fail("The behavior failed its trial run. Try a different description.", 422);
  const id = crypto.randomUUID();
  const name = nameFrom(body.data.description);
  await env.DB.prepare(
    "INSERT INTO creatures (id, name, description, code, model, ip_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(id, name, body.data.description, behavior.code, CODE_MODEL, ipHash, Date.now())
    .run();
  await stub.addCreature({ id, name, code: behavior.code, generation: 0 }, description, egg, egg);

  return Response.json({ id, name, code: behavior.code, safety });
}

async function lineage(env: Env): Promise<Response> {
  const creatures = await env.DB.prepare(
    "SELECT id, name, description, model, parent_a, parent_b, fate, created_at FROM creatures ORDER BY created_at DESC LIMIT 50",
  ).all();

  const encounters = await env.DB.prepare("SELECT * FROM encounters ORDER BY created_at DESC LIMIT 50").all();

  return Response.json({ creatures: creatures.results, encounters: encounters.results });
}

const VersionRow = z.object({ version: z.number(), code: z.string(), source: z.string(), created_at: z.number() });

async function versionsOf(env: Env, id: string): Promise<z.infer<typeof VersionRow>[]> {
  const rows = await env.DB.prepare(
    "SELECT version, code, source, created_at FROM code_versions WHERE creature_id = ? ORDER BY version DESC LIMIT 50",
  )
    .bind(id)
    .all();

  return rows.results.map((row) => VersionRow.parse(row));
}

async function inspect(env: Env, id: string): Promise<Response> {
  const live = await world(env).inspect(id);

  if (!live) return Response.json({ error: "No living creature has this id." }, { status: 404 });

  const record = await env.DB.prepare(
    "SELECT c.description, c.created_at, c.parent_a, c.parent_b, a.name AS parent_a_name, b.name AS parent_b_name FROM creatures c LEFT JOIN creatures a ON a.id = c.parent_a LEFT JOIN creatures b ON b.id = c.parent_b WHERE c.id = ?",
  )
    .bind(id)
    .first();

  const encounters = await env.DB.prepare(
    "SELECT e.a_id, e.b_id, e.outcome, e.probabilities, e.created_at, a.name AS a_name, b.name AS b_name FROM encounters e LEFT JOIN creatures a ON a.id = e.a_id LEFT JOIN creatures b ON b.id = e.b_id WHERE e.a_id = ? OR e.b_id = ? ORDER BY e.created_at DESC LIMIT 20",
  )
    .bind(id, id)
    .all();

  return Response.json({ ...live, record, encounters: encounters.results, versions: await versionsOf(env, id) });
}

async function editsInLastHour(env: Env, ipHash: string): Promise<number> {
  return z.number().parse(
    await env.DB.prepare("SELECT COUNT(*) AS n FROM code_versions WHERE ip_hash = ? AND created_at > ?")
      .bind(ipHash, Date.now() - 3600_000)
      .first("n"),
  );
}

async function saveVersion(env: Env, id: string, code: string, source: string, ipHash: string): Promise<Response> {
  const live = await world(env).inspect(id);

  if (!live) return Response.json({ error: "No living creature has this id." }, { status: 404 });

  if (live.version === 1)
    await env.DB.prepare(
      "INSERT OR IGNORE INTO code_versions (creature_id, version, code, source, ip_hash, created_at) VALUES (?, 1, ?, 'original', 'original', ?)",
    )
      .bind(id, live.code, Date.now())
      .run();

  const latest = z
    .number()
    .parse(
      await env.DB.prepare("SELECT COALESCE(MAX(version), 1) AS v FROM code_versions WHERE creature_id = ?")
        .bind(id)
        .first("v"),
    );

  const version = latest + 1;
  await env.DB.prepare(
    "INSERT INTO code_versions (creature_id, version, code, source, ip_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(id, version, code, source, ipHash, Date.now())
    .run();
  await env.DB.prepare("UPDATE creatures SET code = ? WHERE id = ?").bind(code, id).run();
  await world(env).replaceCode(id, code, version);

  return Response.json({ ok: true, version, code, versions: await versionsOf(env, id) });
}

async function limitedIp(request: Request, env: Env): Promise<{ ipHash: string; limited: boolean }> {
  const ipHash = await hashIp(request.headers.get("CF-Connecting-IP") ?? "unknown");

  return { ipHash, limited: (await editsInLastHour(env, ipHash)) >= MAX_EDITS_PER_IP_PER_HOUR };
}

const LIMITED = { error: `Limit reached: ${MAX_EDITS_PER_IP_PER_HOUR} code edits per hour from one address.` };

async function editCode(request: Request, env: Env, id: string): Promise<Response> {
  const body = CodeEdit.safeParse(await request.json().catch(() => null));

  if (!body.success) return Response.json({ error: "Send code as a string of 1 to 8000 characters." }, { status: 400 });
  const { ipHash, limited } = await limitedIp(request, env);

  if (limited) return Response.json(LIMITED, { status: 429 });
  const verdict = await checkEdit(body.data.code, (code) => trial(env, code));

  if (!verdict.ok) return Response.json({ error: verdict.reason }, { status: 422 });

  return saveVersion(env, id, verdict.code, "edit", ipHash);
}

async function revert(request: Request, env: Env, id: string): Promise<Response> {
  const body = RevertRequest.safeParse(await request.json().catch(() => null));

  if (!body.success) return Response.json({ error: "Send a version number." }, { status: 400 });
  const { ipHash, limited } = await limitedIp(request, env);

  if (limited) return Response.json(LIMITED, { status: 429 });
  const target = (await versionsOf(env, id)).find((v) => v.version === body.data.version);

  if (!target) return Response.json({ error: "This creature has no such version." }, { status: 404 });

  return saveVersion(env, id, target.code, `revert to ${target.version}`, ipHash);
}

function creatureRoute(request: Request, env: Env, pathname: string): Promise<Response> | null {
  const match = pathname.match(/^\/api\/creature\/([0-9a-f-]{36})(\/code|\/revert)?$/);
  const id = match?.[1];

  if (!id) return null;

  if (!match[2] && request.method === "GET") return inspect(env, id);

  if (match[2] === "/code" && request.method === "POST") return editCode(request, env, id);

  if (match[2] === "/revert" && request.method === "POST") return revert(request, env, id);

  return null;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/world") return world(env).fetch(request);

    if (url.pathname === "/api/creatures" && request.method === "POST") return spawn(request, env);

    if (url.pathname === "/api/lineage") return lineage(env);
    const creature = creatureRoute(request, env, url.pathname);

    if (creature) return creature;

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
