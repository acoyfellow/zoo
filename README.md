# Facet Zoo

Live: https://zoo.coey.dev

Facet Zoo is a shared world where each creature runs JavaScript that a model wrote from one sentence.

![Facet Zoo live world with creatures, encounters, and lineage](docs/screenshot.png)

## How It Works

1. You write a description of 3 to 400 characters.
2. Cloudflare Clef (`@cf/cloudflare/clef`) scores whether the description is safe to draw. Below 0.7 the hatch is refused.
3. Moonshot AI Kimi (`@cf/moonshotai/kimi-k2.7-code`) on Workers AI writes a `behave(api, view)` function. The API has four calls: `move`, `say`, `remember`, `recall`.
4. A static check rejects code with tokens such as `fetch`, `eval`, `import`, and `while`.
5. The code runs 3 trial ticks in a Dynamic Worker with `globalOutbound: null`, so it has no network access.
6. The creature becomes a Durable Object facet of the `World` Durable Object. It has its own SQLite memory. Black Forest Labs FLUX.1 [schnell] (`@cf/black-forest-labs/flux-1-schnell`) draws its sprite. All three models run on Workers AI.
7. An alarm ticks the world every 1.5 seconds. Moves are limited to 12 pixels per tick and positions are clamped 40 pixels inside the 800 by 800 world.
8. When two creatures come within 80 pixels, `@cf/cloudflare/clef` answers one choice question: `a_wins`, `b_wins`, or `befriend`. The page shows the three probabilities and the result.
9. A loser fades and its facet is deleted. A winner gains 5 energy. Friends breed. The child code alternates between the parents' functions on each tick.
10. Four starter creatures (Seeker, Orbit, Shadow, Drifter) each found a family. When a family has no living member, the world adds that starter again.
11. D1 database `zoo-lineage` stores each creature, its parents, its fate, and each encounter. `GET /api/lineage` returns the last 50.
12. Tap a creature to open its inspector: sprite, family, parents, age, energy, speech, encounters with Clef probabilities, and its code. Anyone can edit the code. The server runs the same static check and the 3-tick trial before it swaps the code, and keeps every version in D1 so you can revert.
13. The world ticks on an in-memory loop every 1.5 seconds, with a 5 second alarm as a watchdog that restarts it. Each tick steps at most 8 creatures at once, rotating through the rest on later ticks, and gives each creature 500 ms. A creature that throws or runs slow loses energy, and the other creatures keep moving.

## Evidence

- [receipts/001-first-deploy.json](receipts/001-first-deploy.json): first deploy.
- [receipts/002-coey-dev.json](receipts/002-coey-dev.json): split into a public front Worker and a private core Worker. One encounter returned `befriend` at 0.4662 against `a_wins` at 0.4356.
- [receipts/003-marketing-pass.json](receipts/003-marketing-pass.json): live checks after this pass. The first live encounter arrived 9.6 seconds after the WebSocket opened.
- [receipts/004-deploy-button.json](receipts/004-deploy-button.json): the Deploy button test was blocked before any resource was created, so this repository has no Deploy button.
- [receipts/004-truth-audit.json](receipts/004-truth-audit.json): each claim in this README and on the page, with the file and line that proves it.
- [receipts/005-adversarial-review.json](receipts/005-adversarial-review.json): review findings and live hostile hatch tests.
- [receipts/008-world-ticks.json](receipts/008-world-ticks.json): 20 world snapshots in 30 seconds after the tick fix.
- [receipts/009-inspector.json](receipts/009-inspector.json): one accepted and two rejected code edits on the live site, then cleanup.
- [receipts/lighthouse-mobile.json](receipts/lighthouse-mobile.json): mobile Lighthouse scores 100 for accessibility, best practices, and SEO.

## Limits and Costs

- Per address: 3 hatch or code-edit requests per minute together, 20 code edits per hour, 10 creatures per hour, 5 forced encounters per minute, 60 reads per minute.
- At most 200 creatures are alive.
- Descriptions, names, generated code, code edits, and lineage are public.
- The code model can write code that fails the check or the trial. Then the hatch fails and you must try a different description.
- Clef probabilities are a model guess from names, descriptions, energy, memory, and code. They are not a simulation.
- Each hatch and each encounter is a Workers AI call on the owner's account, which costs money.
- `POST /api/encounter` forces the first two creatures to meet. Only the rate limit protects it.

## Self-Host

Production at zoo.coey.dev uses two Workers: `wrangler.prod.jsonc` (front) and `core/wrangler.prod.jsonc` (core, no public route). To copy that split, change `account_id`, the D1 `database_id`, and the route in both files, then run `bun run deploy:prod`. Facet Zoo needs no secrets. `vars.example` lists none on purpose.

## Develop Locally

```sh
git clone --recurse-submodules https://github.com/acoyfellow/zoo
cd zoo
bun install
bun run verify
```

`bun run verify` runs `tsc`, `svelte-check`, Biome, oxlint with the anti-slop rules, `scripts/copy-check.ts`, and `bun test`.

## Operate

- Logs: `wrangler tail zoo-core -c core/wrangler.prod.jsonc` for the core and `wrangler tail zoo -c wrangler.prod.jsonc` for the front. Both have observability on, so the same logs are in the Cloudflare dashboard.
- `clef judge failed` with a context length error: Clef got too much text for one encounter. The encounter is skipped and the world keeps ticking. If it repeats, shorten what `compactFighter` in `src/worker/ai.ts` sends.
- `sprite failed`: FLUX.1 [schnell] or the R2 write failed twice. The creature is drawn as a letter glyph. No action is needed unless every sprite fails; then check Workers AI status and the R2 bucket.
- 429 from `/api/*`: the per-address rate limit in `wrangler.prod.jsonc` or the 10 per hour hatch cap. Wait one minute. Raise the limits there only if real visitors hit them.
- 422 on a hatch: Clef refused the description, or the code failed the check or trial. The visitor tries another description.
- Bad deploy: `wrangler rollback -c wrangler.prod.jsonc` or `wrangler rollback -c core/wrangler.prod.jsonc`.

## Stack

- Front Worker `zoo` (`wrangler.prod.jsonc`, `src/front`): static assets, per-address rate limits, security headers, service binding `CORE`.
- `src/standalone.ts`: the same app as one Worker, kept for a future Deploy button.
- Core Worker `zoo-core` (`core/wrangler.prod.jsonc`, `src/worker`): Workers AI, D1, the `World` Durable Object, Worker Loader. It has no public route.
- UI: Svelte 5, Tailwind CSS 4, Vite, canvas 2D.

## License

MIT. See [LICENSE](LICENSE).
