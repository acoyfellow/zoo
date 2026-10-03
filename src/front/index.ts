import { type ApiLimits, isWithinLimit, tooManyRequests } from "./guard";
import { withSecurityHeaders } from "./headers";

type FrontEnv = ApiLimits & {
  ASSETS: Fetcher;
  CORE: Fetcher;
};

async function route(request: Request, env: FrontEnv, pathname: string): Promise<Response> {
  if (!pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

  if (!(await isWithinLimit(request, env))) return tooManyRequests();

  return env.CORE.fetch(request);
}

export default {
  async fetch(request: Request, env: FrontEnv): Promise<Response> {
    const url = new URL(request.url);

    return withSecurityHeaders(await route(request, env, url.pathname), url.host);
  },
} satisfies ExportedHandler<FrontEnv>;
