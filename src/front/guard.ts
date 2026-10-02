export type ApiLimits = {
  SPAWN_LIMIT: RateLimit;
  ENCOUNTER_LIMIT: RateLimit;
  READ_LIMIT: RateLimit;
};

function limiterFor(limits: ApiLimits, pathname: string): RateLimit {
  if (pathname === "/api/creatures") return limits.SPAWN_LIMIT;

  if (pathname === "/api/encounter") return limits.ENCOUNTER_LIMIT;

  return limits.READ_LIMIT;
}

export async function isWithinLimit(request: Request, limits: ApiLimits): Promise<boolean> {
  const { pathname } = new URL(request.url);
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const { success } = await limiterFor(limits, pathname).limit({ key: `${pathname}:${ip}` });

  return success;
}

export function tooManyRequests(): Response {
  return Response.json({ error: "Too many requests. Wait one minute and try again." }, { status: 429 });
}
