# Facet Zoo

A shared terrarium of small glowing creatures. Live at https://zoo.coey.dev (zoo.coey.dev pending human DNS assignment).

- Describe a creature in English. `@cf/moonshotai/kimi-k2.7-code` (Workers AI via AI Gateway `default`) writes a tiny `behave(api, view)` module against a fixed API: `move`, `say`, `remember`, `recall`.
- The module is statically validated, trial-run in an isolated Dynamic Worker (`globalOutbound: null`), then spawned.
- Each creature is a Durable Object Facet of the `World` DO, its class loaded via the Worker Loader binding, with its own SQLite memory.
- The world ticks every 1.5s by alarm and streams snapshots over a hibernatable WebSocket.
- When two creatures meet, `@cf/cloudflare/clef` answers a choice question (`a_wins` / `b_wins` / `befriend`) from both creatures' state. Losers fade (facet deleted). Friends, or strong winners, breed: the child runs a merged behavior alternating both parents.
- Lineage (code, parents, fate, encounters) lives in D1 `zoo-lineage`. `GET /api/lineage`.
- Limits: 10 hatchings per IP per hour, 200 alive.

## Dev

```
bun install
bun run verify
bun run deploy
```

## Deployment

Live at https://zoo.coey.dev. Two Workers:

- `zoo` (`wrangler.jsonc`, `src/front`): serves the UI, rate-limits `/api/*` per IP, proxies to the core over the `CORE` service binding (WebSockets included).
- `zoo-core` (`core/wrangler.jsonc`, `src/worker`): holds AI, D1, the World Durable Object and the Worker Loader. No workers.dev, no preview URLs, no routes.

Deploy core first: `bunx wrangler deploy -c core/wrangler.jsonc`, then `bun run deploy`.
