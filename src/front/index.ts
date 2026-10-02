import { type ApiLimits, isWithinLimit, tooManyRequests } from "./guard";

type FrontEnv = ApiLimits & {
  ASSETS: Fetcher;
  CORE: Fetcher;
};

export default {
  async fetch(request: Request, env: FrontEnv): Promise<Response> {
    const url = new URL(request.url);

    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

    if (!(await isWithinLimit(request, env))) return tooManyRequests();

    return env.CORE.fetch(request);
  },
} satisfies ExportedHandler<FrontEnv>;
