<script lang="ts">
import { onMount } from "svelte";
import { type Creature, SpawnReply, type WorldEvent, WorldMessage } from "./messages";

let creatures = $state<Creature[]>([]);
let events = $state<WorldEvent[]>([]);
let description = $state("");
let status = $state("");
let busy = $state(false);
let lastCode = $state("");
let canvas: HTMLCanvasElement | undefined = $state();

function connect(): void {
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  const socket = new WebSocket(`${protocol}://${location.host}/api/world`);
  socket.onmessage = (message) => {
    const parsed = WorldMessage.safeParse(JSON.parse(String(message.data)));
    if (!parsed.success) return;
    if (parsed.data.type === "snapshot") {
      creatures = parsed.data.creatures;
      if (parsed.data.events.length > 0) events = parsed.data.events;
    } else {
      events = [...events.slice(-29), parsed.data.event];
    }
  };
  socket.onclose = () => setTimeout(connect, 2000);
}

function draw(time: number): void {
  const context = canvas?.getContext("2d");
  if (canvas && context) {
    const scale = canvas.width / 800;
    context.fillStyle = "rgba(2, 8, 6, 0.35)";
    context.fillRect(0, 0, canvas.width, canvas.height);
    for (const creature of creatures) {
      const pulse = 1 + Math.sin(time / 300 + creature.hue) * 0.15;
      const radius = (6 + Math.min(creature.energy, 20) * 0.5) * pulse * scale;
      const x = creature.x * scale;
      const y = creature.y * scale;
      const glow = context.createRadialGradient(x, y, 0, x, y, radius * 3);
      glow.addColorStop(0, `hsla(${creature.hue}, 100%, 70%, 0.9)`);
      glow.addColorStop(1, `hsla(${creature.hue}, 100%, 50%, 0)`);
      context.fillStyle = glow;
      context.beginPath();
      context.arc(x, y, radius * 3, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = `hsl(${creature.hue}, 100%, 85%)`;
      context.font = `${11 * scale}px ui-monospace, monospace`;
      context.fillText(creature.name, x + radius, y - radius);
      if (creature.said) context.fillText(`“${creature.said}”`, x + radius, y + radius + 10 * scale);
    }
  }
  requestAnimationFrame(draw);
}

async function hatch(): Promise<void> {
  busy = true;
  status = "the model is writing a behavior…";
  try {
    const response = await fetch("/api/creatures", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ description }),
    });
    const reply = SpawnReply.parse(await response.json());
    if ("error" in reply) {
      status = reply.error;
    } else {
      status = `${reply.name} hatched`;
      lastCode = reply.code;
      description = "";
    }
  } catch {
    status = "hatching failed";
  } finally {
    busy = false;
  }
}

onMount(() => {
  connect();
  requestAnimationFrame(draw);
});
</script>

<main class="min-h-screen bg-black text-emerald-100 font-mono p-4 flex flex-col lg:flex-row gap-4">
  <section class="flex-1 flex flex-col items-center gap-2">
    <h1 class="text-2xl tracking-widest text-emerald-300 drop-shadow-[0_0_8px_rgba(52,211,153,0.8)]">FACET ZOO</h1>
    <canvas
      bind:this={canvas}
      width="800"
      height="800"
      class="w-full max-w-[80vh] aspect-square rounded-3xl border border-emerald-900 bg-[radial-gradient(circle_at_center,#052e1a,#000)] shadow-[0_0_60px_rgba(16,185,129,0.25)]"
    ></canvas>
    <p class="text-xs text-emerald-700">{creatures.length} alive · each creature is a Durable Object facet running model-written code</p>
  </section>
  <aside class="lg:w-96 flex flex-col gap-3">
    <form class="flex flex-col gap-2" onsubmit={(e) => { e.preventDefault(); hatch(); }}>
      <textarea
        bind:value={description}
        maxlength="400"
        placeholder="a shy blue moth that circles the edges and whispers when crowded"
        class="h-24 rounded-xl bg-emerald-950/40 border border-emerald-800 p-2 text-sm outline-none focus:border-emerald-400"
      ></textarea>
      <button disabled={busy || description.trim().length < 3} class="rounded-xl bg-emerald-500/20 border border-emerald-500 py-2 hover:bg-emerald-500/40 disabled:opacity-40">
        {busy ? "hatching…" : "hatch creature"}
      </button>
      <p class="text-xs text-emerald-400 min-h-4">{status}</p>
    </form>
    {#if lastCode}
      <pre class="text-[10px] max-h-48 overflow-auto rounded-xl bg-emerald-950/30 p-2 text-emerald-300">{lastCode}</pre>
    {/if}
    <ol class="flex flex-col gap-1 text-xs overflow-auto max-h-[50vh]">
      {#each [...events].reverse() as event (event.at + event.text)}
        <li class="text-emerald-300/80">· {event.text}</li>
      {/each}
    </ol>
    <a href="/api/lineage" class="text-xs text-emerald-700 underline">lineage</a>
  </aside>
</main>
