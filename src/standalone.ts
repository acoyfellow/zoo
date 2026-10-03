import { type ApiLimits, isWithinLimit, tooManyRequests } from "./front/guard";
import { withSecurityHeaders } from "./front/headers";
import core from "./worker/index";

export { World } from "./worker/index";

type StandaloneEnv = Env & ApiLimits & { ASSETS: Fetcher };

async function route(request: Request, env: StandaloneEnv, pathname: string): Promise<Response> {
  if (!pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

  if (!(await isWithinLimit(request, env))) return tooManyRequests();

  return core.fetch(request, env);
}

export default {
  async fetch(request: Request, env: StandaloneEnv): Promise<Response> {
    const url = new URL(request.url);

    return withSecurityHeaders(await route(request, env, url.pathname), url.host);
  },
} satisfies ExportedHandler<StandaloneEnv>;
