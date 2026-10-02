# Findings

- Durable Object Facets (`ctx.facets.get`) plus Worker Loader `getDurableObjectClass` work on account bfcb6ac5…; no per-creature DO fallback was needed.
- Kimi K2 is on Workers AI as `@cf/moonshotai/kimi-k2.7-code`; it returns OpenAI-style `choices`. It often uses `view.self`, so the validator only rejects bare `self`.
- A Dynamic Worker module must not keep the model's `export default`; the behavior is renamed to a local `const behave` before embedding.
- Clef's first real verdict was close (a_wins 0.42 vs befriend 0.44) — the judge is genuinely uncertain on mismatched creatures.
- Cloudflare Artifacts was not used; D1 holds lineage.
- `bun add wrangler` failed resolving `@cloudflare/*` from the local registry config; the global wrangler 4.110.0 was used for deploy.
- `/api/encounter` (POST) forces the first two creatures to meet; it has no auth and is a cheap abuse vector worth gating later.
