<script lang="ts">
import { onMount } from "svelte";
import {
  type Creature,
  type Encounter,
  type LineageCreature,
  LineageReply,
  SpawnReply,
  type WorldEvent,
  WorldMessage,
} from "./messages";

const WORLD = 800;
const MARGIN = 40;

type Connection = "connecting" | "open" | "lost";

let creatures = $state<Creature[]>([]);
let events = $state<WorldEvent[]>([]);
let encounters = $state<Encounter[]>([]);
let lineage = $state<LineageCreature[]>([]);
let lineageState = $state<"idle" | "loading" | "ready" | "error">("idle");
let connection = $state<Connection>("connecting");
let description = $state("");
let status = $state("");
let busy = $state(false);
let lastCode = $state("");
let canvas: HTMLCanvasElement | undefined = $state();

function clampPixel(value: number): number {
  return Math.min(WORLD - MARGIN, Math.max(MARGIN, value));
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function outcomeText(encounter: Encounter): string {
  if (encounter.outcome === "befriend") return `${encounter.a} and ${encounter.b} became friends`;
  return encounter.outcome === "a_wins" ? `${encounter.a} won` : `${encounter.b} won`;
}

function parseMessage(data: unknown): ReturnType<typeof WorldMessage.safeParse> | null {
  try {
    return WorldMessage.safeParse(JSON.parse(String(data)));
  } catch {
    return null;
  }
}

function connect(): void {
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  const socket = new WebSocket(`${protocol}://${location.host}/api/world`);
  socket.onopen = () => {
    connection = "open";
  };
  socket.onmessage = (message) => {
    const parsed = parseMessage(message.data);
    if (!parsed?.success) return;
    const data = parsed.data;
    if (data.type === "snapshot") {
      creatures = data.creatures;
      if (data.events.length > 0) events = data.events;
      if (data.encounters.length > 0) encounters = data.encounters;
    } else if (data.type === "event") {
      events = [...events.slice(-29), data.event];
    } else {
      encounters = [...encounters.slice(-9), data.encounter];
      void loadLineage();
    }
  };
  socket.onclose = () => {
    connection = "lost";
    setTimeout(connect, 2000);
  };
}

function draw(time: number): void {
  const context = canvas?.getContext("2d");
  if (canvas && context) {
    const scale = canvas.width / WORLD;
    context.fillStyle = "rgba(2, 8, 6, 0.35)";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.font = `${11 * scale}px ui-monospace, monospace`;
    for (const creature of creatures) {
      const pulse = 1 + Math.sin(time / 300 + creature.hue) * 0.15;
      const radius = (6 + Math.min(creature.energy, 20) * 0.5) * pulse * scale;
      const x = clampPixel(creature.x) * scale;
      const y = clampPixel(creature.y) * scale;
      const glow = context.createRadialGradient(x, y, 0, x, y, radius * 3);
      glow.addColorStop(0, `hsla(${creature.hue}, 100%, 70%, 0.9)`);
      glow.addColorStop(1, `hsla(${creature.hue}, 100%, 50%, 0)`);
      context.fillStyle = glow;
      context.beginPath();
      context.arc(x, y, radius * 3, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = `hsl(${creature.hue}, 100%, 85%)`;
      const right = x + radius + context.measureText(creature.name).width < canvas.width;
      context.textAlign = right ? "left" : "right";
      const labelX = right ? x + radius : x - radius;
      context.fillText(creature.name, labelX, Math.max(12 * scale, y - radius));
      if (creature.said) context.fillText(`"${creature.said}"`, labelX, y + radius + 10 * scale);
    }
  }
  requestAnimationFrame(draw);
}

async function loadLineage(): Promise<void> {
  if (lineageState === "idle") lineageState = "loading";
  try {
    const response = await fetch("/api/lineage");
    const parsed = LineageReply.safeParse(await response.json());
    if (!response.ok || !parsed.success) throw new Error("bad lineage");
    lineage = parsed.data.creatures;
    lineageState = "ready";
  } catch {
    lineageState = "error";
  }
}

function nameOf(id: string | null): string {
  if (!id) return "";
  return lineage.find((c) => c.id === id)?.name ?? "an older creature";
}

function parentsOf(creature: LineageCreature): string {
  if (!creature.parent_a) return "first generation";
  if (creature.parent_a === creature.parent_b) return `child of ${nameOf(creature.parent_a)}`;
  return `child of ${nameOf(creature.parent_a)} and ${nameOf(creature.parent_b)}`;
}

async function hatch(): Promise<void> {
  busy = true;
  status = "The model is writing a behavior. This can take up to one minute.";
  try {
    const response = await fetch("/api/creatures", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ description }),
    });
    const reply = SpawnReply.safeParse(await response.json());
    if (!reply.success) {
      status = "The server sent an answer that the page cannot read. Try again.";
    } else if ("error" in reply.data) {
      status = reply.data.error;
    } else {
      status = `${reply.data.name} hatched. Look for its name in the world.`;
      lastCode = reply.data.code;
      description = "";
      void loadLineage();
    }
  } catch {
    status = "The request failed. Check your connection and try again.";
  } finally {
    busy = false;
  }
}

onMount(() => {
  connect();
  void loadLineage();
  requestAnimationFrame(draw);
});
</script>

<div aria-hidden="true" class="pointer-events-none fixed inset-0 z-0 bg-[url(/backdrop.jpg)] bg-cover bg-center opacity-35"></div>
<div aria-hidden="true" class="pointer-events-none fixed inset-0 z-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,rgba(0,0,0,0.85)_75%)]"></div>
<main class="relative z-10 min-h-screen overflow-x-hidden text-emerald-100 font-mono p-4 flex flex-col lg:flex-row gap-4">
  <section class="flex-1 min-w-0 flex flex-col items-center gap-2">
    <h1 class="text-2xl tracking-widest text-emerald-300 drop-shadow-[0_0_8px_rgba(52,211,153,0.8)]">FACET ZOO</h1>
    <p class="max-w-xl text-center text-sm text-emerald-200/90">
      Write one sentence about a creature. A model writes its behavior code. The code runs in its own sandbox and moves
      the creature in this shared world. When two creatures meet, a second model picks the result.
    </p>
    <canvas
      bind:this={canvas}
      width="800"
      height="800"
      aria-label={`Shared world with ${creatures.length} creatures: ${creatures.map((c) => c.name).join(", ")}`}
      class="w-full max-w-[80vh] aspect-square rounded-3xl border border-emerald-900 bg-[radial-gradient(circle_at_center,#052e1a,#000)] shadow-[0_0_60px_rgba(16,185,129,0.25)]"
    ></canvas>
    <p class="text-xs text-emerald-500" aria-live="polite">
      {#if connection === "connecting"}
        Connecting to the world.
      {:else if connection === "lost"}
        Connection lost. The page tries again every 2 seconds.
      {:else if creatures.length === 0}
        The world is empty. Starter creatures appear in the next tick.
      {:else}
        {creatures.length} alive. Each creature is a Durable Object facet that runs model-written code.
      {/if}
    </p>
  </section>
  <aside class="lg:w-96 min-w-0 flex flex-col gap-4">
    <form class="flex flex-col gap-2" onsubmit={(e) => { e.preventDefault(); hatch(); }}>
      <label for="description" class="text-sm text-emerald-300">Describe a creature</label>
      <textarea
        id="description"
        bind:value={description}
        maxlength="400"
        placeholder="a shy blue moth that circles the edges and whispers when crowded"
        class="h-24 rounded-xl bg-emerald-950/40 border border-emerald-800 p-2 text-sm focus:outline-2 focus:outline-emerald-300 focus:border-emerald-400"
      ></textarea>
      <button
        type="submit"
        disabled={busy || description.trim().length < 3}
        class="rounded-xl bg-emerald-500/20 border border-emerald-500 py-2 hover:bg-emerald-500/40 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300"
      >
        {busy ? "Hatching" : "Hatch creature"}
      </button>
      <p class="text-xs text-emerald-300 min-h-4" role="status">{status}</p>
      <p class="text-[11px] text-emerald-500">
        Limits: 3 hatch requests per minute and 10 creatures per hour from one address. 200 creatures alive at most.
        Descriptions, names, and code are public.
      </p>
    </form>
    {#if lastCode}
      <details class="rounded-xl bg-emerald-950/30 p-2">
        <summary class="cursor-pointer text-xs text-emerald-300 focus-visible:outline-2 focus-visible:outline-emerald-300">Code the model wrote</summary>
        <pre class="mt-2 text-[10px] max-h-48 overflow-auto text-emerald-300">{lastCode}</pre>
      </details>
    {/if}

    <section aria-labelledby="encounters-title" class="flex flex-col gap-2">
      <h2 id="encounters-title" class="text-sm text-emerald-300">Encounters</h2>
      {#if encounters.length === 0}
        <p class="text-xs text-emerald-500">No encounter yet. Creatures meet when they come within 24 pixels.</p>
      {:else}
        <ol class="flex flex-col gap-2">
          {#each [...encounters].reverse() as encounter (encounter.at + encounter.a + encounter.b)}
            <li class="rounded-lg border border-emerald-900 bg-black/40 p-2 text-xs">
              <p class="text-emerald-200">{encounter.a} met {encounter.b}</p>
              <dl class="mt-1 grid grid-cols-3 gap-1 text-emerald-400">
                <div><dt>{encounter.a} wins</dt><dd>{percent(encounter.probabilities.a_wins)}</dd></div>
                <div><dt>{encounter.b} wins</dt><dd>{percent(encounter.probabilities.b_wins)}</dd></div>
                <div><dt>Friends</dt><dd>{percent(encounter.probabilities.befriend)}</dd></div>
              </dl>
              <p class="mt-1 text-emerald-300">Result: {outcomeText(encounter)}</p>
            </li>
          {/each}
        </ol>
      {/if}
      <p class="text-[11px] text-emerald-500">The judge is the Clef model. It reads names, descriptions, energy, and code. Its probabilities are a model guess.</p>
    </section>

    <section aria-labelledby="events-title" class="flex flex-col gap-1">
      <h2 id="events-title" class="text-sm text-emerald-300">World log</h2>
      {#if events.length === 0}
        <p class="text-xs text-emerald-500">No events yet.</p>
      {:else}
        <ol class="flex flex-col gap-1 text-xs overflow-auto max-h-48">
          {#each [...events].reverse() as event (event.at + event.text)}
            <li class="text-emerald-300/80">{event.text}</li>
          {/each}
        </ol>
      {/if}
    </section>

    <section aria-labelledby="lineage-title" class="flex flex-col gap-1">
      <h2 id="lineage-title" class="text-sm text-emerald-300">Lineage</h2>
      {#if lineageState === "loading" || lineageState === "idle"}
        <p class="text-xs text-emerald-500">Loading lineage.</p>
      {:else if lineageState === "error"}
        <p class="text-xs text-amber-300">The lineage did not load. It loads again after the next encounter.</p>
      {:else if lineage.length === 0}
        <p class="text-xs text-emerald-500">No creatures recorded yet.</p>
      {:else}
        <ol class="flex flex-col gap-1 text-xs overflow-auto max-h-64">
          {#each lineage.slice(0, 20) as creature (creature.id)}
            <li class="text-emerald-300/90">
              <span class="text-emerald-100">{creature.name}</span>: {parentsOf(creature)}, {creature.fate ?? "alive"}
            </li>
          {/each}
        </ol>
      {/if}
    </section>
  </aside>
</main>
