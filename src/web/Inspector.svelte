<script lang="ts">
import { highlight } from "./highlight";
import { EditReply, type Inspection, InspectorReply, Probabilities } from "./messages";

let { id, onclose }: { id: string; onclose: () => void } = $props();

let detail = $state<Inspection | null>(null);

let loadState = $state<"loading" | "ready" | "error">("loading");

let editing = $state(false);

let draft = $state("");

let saving = $state(false);

let message = $state("");

let messageKind = $state<"ok" | "error">("ok");

let panel: HTMLElement | undefined = $state();

const tokens = $derived(detail ? highlight(detail.code) : []);

const TOKEN_CLASS = {
  keyword: "text-fuchsia-300",
  string: "text-amber-200",
  number: "text-sky-300",
  comment: "text-emerald-700",
  plain: "text-emerald-200",
};

async function load(): Promise<void> {
  try {
    const response = await fetch(`/api/creature/${id}`);
    const parsed = InspectorReply.safeParse(await response.json());

    if (!response.ok || !parsed.success) throw new Error("bad reply");
    detail = parsed.data;
    loadState = "ready";
  } catch {
    loadState = "error";
  }
}

$effect(() => {
  loadState = "loading";
  editing = false;
  message = "";
  void id;
  void load();
});

$effect(() => {
  panel?.focus();
});

function age(createdAt: number): string {
  const minutes = Math.max(0, Math.round((Date.now() - createdAt) / 60_000));

  if (minutes < 60) return `${minutes} min`;

  return `${Math.round(minutes / 60)} h`;
}

function parents(): string {
  const record = detail?.record;

  if (!record?.parent_a_name) return "first generation";

  if (record.parent_a_name === record.parent_b_name) return `child of ${record.parent_a_name}`;

  return `child of ${record.parent_a_name} and ${record.parent_b_name ?? "an older creature"}`;
}

function percent(value: number | undefined): string {
  return `${Math.round((value ?? 0) * 100)}%`;
}

function probabilitiesOf(raw: string): Record<string, number> {
  try {
    return Probabilities.parse(JSON.parse(raw));
  } catch {
    return {};
  }
}

function outcomeText(encounter: Inspection["encounters"][number]): string {
  if (encounter.outcome === "befriend") return "became friends";
  const won = (encounter.outcome === "a_wins") === (encounter.a_id === id);

  return won ? "won" : "lost";
}

function otherName(encounter: Inspection["encounters"][number]): string {
  return (encounter.a_id === id ? encounter.b_name : encounter.a_name) ?? "an older creature";
}

function startEdit(): void {
  if (!detail) return;
  draft = detail.code;
  editing = true;
  message = "";
}

async function send(path: string, body: string): Promise<void> {
  saving = true;
  message = "Checking the code and running the 3-tick trial.";
  messageKind = "ok";

  try {
    const response = await fetch(`/api/creature/${id}/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });

    const reply = EditReply.safeParse(await response.json());

    if (!reply.success) {
      message = "The server sent an answer that the page cannot read.";
      messageKind = "error";
    } else if ("error" in reply.data) {
      message = reply.data.error;
      messageKind = "error";
    } else {
      message = `Saved as version ${reply.data.version}.`;
      messageKind = "ok";
      editing = false;
      await load();
    }
  } catch {
    message = "The request failed. Check your connection and try again.";
    messageKind = "error";
  } finally {
    saving = false;
  }
}

function save(): void {
  void send("code", JSON.stringify({ code: draft }));
}

function revert(version: number): void {
  void send("revert", JSON.stringify({ version }));
}

function onKey(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    onclose();
  }
}
</script>

<svelte:window onkeydown={onKey} />

<div class="fixed inset-0 z-40 bg-black/50" aria-hidden="true" onclick={onclose}></div>
<div
  bind:this={panel}
  tabindex="-1"
  role="dialog"
  aria-modal="true"
  aria-labelledby="inspector-title"
  data-inspector
  class="fixed z-50 inset-x-0 bottom-0 max-h-[85vh] rounded-t-3xl sm:inset-x-auto sm:right-4 sm:top-4 sm:bottom-4 sm:w-[28rem] sm:max-h-none sm:rounded-3xl overflow-auto bg-zinc-950/95 ring-1 ring-emerald-700 p-4 text-emerald-100 font-mono outline-none"
>
  <div class="mx-auto mb-2 h-1 w-12 rounded bg-emerald-800 sm:hidden" aria-hidden="true"></div>
  <div class="flex items-start gap-3">
    <img src={`/api/sprite/${id}`} alt="" class="size-20 rounded-xl bg-black object-contain" />
    <div class="min-w-0 flex-1">
      <h2 id="inspector-title" class="text-lg text-emerald-300 truncate">{detail?.name ?? "Creature"}</h2>
      {#if detail}
        <p class="text-xs text-emerald-400">Family {detail.family || "unknown"}, {parents()}</p>
        <p class="text-xs text-emerald-400">
          Generation {detail.generation}, age {detail.record ? age(detail.record.created_at) : "unknown"}, energy
          {detail.energy.toFixed(1)}, code version {detail.version}
        </p>
      {/if}
    </div>
    <button
      type="button"
      onclick={onclose}
      class="min-h-11 min-w-11 rounded-xl border border-emerald-700 hover:bg-emerald-500/20 focus-visible:outline-2 focus-visible:outline-emerald-300"
      aria-label="Close"
    >
      X
    </button>
  </div>

  {#if loadState === "loading"}
    <p class="mt-4 text-xs text-emerald-500">Loading the creature.</p>
  {:else if loadState === "error" || !detail}
    <p class="mt-4 text-xs text-amber-300">This creature did not load. It may have faded.</p>
  {:else}
    {#if detail.record?.description}
      <p class="mt-3 text-sm text-emerald-200">{detail.record.description}</p>
    {/if}

    <h3 class="mt-4 text-sm text-emerald-300">Speech</h3>
    {#if detail.speech.length === 0}
      <p class="text-xs text-emerald-500">It has said nothing yet.</p>
    {:else}
      <ol class="text-xs text-emerald-300/90 max-h-28 overflow-auto">
        {#each detail.speech as line, index (`${index}:${line.at}`)}
          <li>"{line.text}"</li>
        {/each}
      </ol>
    {/if}

    <h3 class="mt-4 text-sm text-emerald-300">Encounters</h3>
    {#if detail.encounters.length === 0}
      <p class="text-xs text-emerald-500">It has met no one yet.</p>
    {:else}
      <ol class="flex flex-col gap-1 text-xs max-h-40 overflow-auto">
        {#each detail.encounters as encounter, index (`${index}:${encounter.created_at}`)}
          {@const odds = probabilitiesOf(encounter.probabilities)}
          <li class="rounded-lg border border-emerald-900 p-1">
            Met {otherName(encounter)} and {outcomeText(encounter)}. Clef: A wins {percent(odds.a_wins)}, B wins
            {percent(odds.b_wins)}, friends {percent(odds.befriend)}.
          </li>
        {/each}
      </ol>
    {/if}

    <div class="mt-4 flex items-center justify-between">
      <h3 class="text-sm text-emerald-300">Behaviour code</h3>
      {#if !editing}
        <button
          type="button"
          onclick={startEdit}
          class="min-h-11 rounded-xl border border-emerald-500 px-3 text-xs hover:bg-emerald-500/20 focus-visible:outline-2 focus-visible:outline-emerald-300"
        >
          Edit
        </button>
      {/if}
    </div>
    {#if editing}
      <label for="code-draft" class="sr-only">Behaviour code</label>
      <textarea
        id="code-draft"
        bind:value={draft}
        spellcheck="false"
        class="mt-2 h-56 w-full rounded-xl bg-black border border-emerald-800 p-2 text-[11px] text-emerald-200 focus:outline-2 focus:outline-emerald-300"
      ></textarea>
      <div class="mt-2 flex gap-2">
        <button
          type="button"
          onclick={save}
          disabled={saving}
          class="min-h-11 flex-1 rounded-xl bg-emerald-500/20 border border-emerald-500 hover:bg-emerald-500/40 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-emerald-300"
        >
          {saving ? "Checking" : "Save"}
        </button>
        <button
          type="button"
          onclick={() => (editing = false)}
          class="min-h-11 rounded-xl border border-emerald-700 px-3 hover:bg-emerald-500/20 focus-visible:outline-2 focus-visible:outline-emerald-300"
        >
          Cancel
        </button>
      </div>
      <p class="mt-1 text-[11px] text-emerald-500">
        Edits are public. The server runs the same static check and 3-tick trial as a new creature before it swaps the
        code. 20 edits per hour from one address.
      </p>
    {:else}
      <pre class="mt-2 max-h-64 overflow-auto rounded-xl bg-black p-2 text-[11px]" data-code><code
          >{#each tokens as token, index (index)}<span class={TOKEN_CLASS[token.kind]}>{token.text}</span>{/each}</code
        ></pre>
    {/if}
    <p class={`mt-2 text-xs min-h-4 ${messageKind === "error" ? "text-amber-300" : "text-emerald-300"}`} role="status" data-edit-status>
      {message}
    </p>

    {#if detail.versions.length > 0}
      <h3 class="mt-2 text-sm text-emerald-300">Versions</h3>
      <ol class="flex flex-col gap-1 text-xs">
        {#each detail.versions as version (version.version)}
          <li class="flex items-center justify-between gap-2">
            <span>Version {version.version}: {version.source}</span>
            {#if version.version !== detail.version}
              <button
                type="button"
                onclick={() => revert(version.version)}
                disabled={saving}
                class="min-h-11 rounded-xl border border-emerald-700 px-3 hover:bg-emerald-500/20 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-emerald-300"
              >
                Revert
              </button>
            {:else}
              <span class="text-emerald-500">current</span>
            {/if}
          </li>
        {/each}
      </ol>
    {/if}
  {/if}
</div>
