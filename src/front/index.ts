type FrontEnv = {
  ASSETS: Fetcher;
  CORE: Fetcher;
  SPAWN_LIMIT: RateLimit;
  ENCOUNTER_LIMIT: RateLimit;
  READ_LIMIT: RateLimit;
};

function limiterFor(env: FrontEnv, pathname: string): RateLimit {
  if (pathname === "/api/creatures") return env.SPAWN_LIMIT;

  if (pathname === "/api/encounter") return env.ENCOUNTER_LIMIT;

  return env.READ_LIMIT;
}

export default {
  async fetch(request: Request, env: FrontEnv): Promise<Response> {
    const url = new URL(request.url);

    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
    const { success } = await limiterFor(env, url.pathname).limit({ key: `${url.pathname}:${ip}` });

    if (!success) return Response.json({ error: "Too many requests. Wait one minute and try again." }, { status: 429 });

    return env.CORE.fetch(request);
  },
} satisfies ExportedHandler<FrontEnv>;
