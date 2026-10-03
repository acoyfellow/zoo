import { type ApiLimits, isWithinLimit, tooManyRequests } from "./front/guard";
import core from "./worker/index";

export { World } from "./worker/index";

type StandaloneEnv = Env & ApiLimits & { ASSETS: Fetcher };

export default {
  async fetch(request: Request, env: StandaloneEnv): Promise<Response> {
    const url = new URL(request.url);

    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

    if (!(await isWithinLimit(request, env))) return tooManyRequests();

    return core.fetch(request, env);
  },
} satisfies ExportedHandler<StandaloneEnv>;
