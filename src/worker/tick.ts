export const TICK_MS = 1500;

export const WATCHDOG_MS = 5000;

export const MIN_TICK_GAP_MS = 100;

export function nextTickDelay(startedAt: number, now: number): number {
  return Math.max(MIN_TICK_GAP_MS, TICK_MS - (now - startedAt));
}

export const STEP_TIMEOUT_MS = 500;

export const STEP_CONCURRENCY = 8;

export const MAX_STEPPED_PER_TICK = 8;

export type StepOutcome = "stepped" | "failed" | "timed out";

export type TickReport = { stepped: number; failed: number; timedOut: number; skipped: number };

export class StepTimeout extends Error {
  constructor(ms: number) {
    super(`step took longer than ${ms} ms`);
  }
}

export function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new StepTimeout(ms)), ms);
  });

  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

export type Batch<T> = { batch: T[]; cursor: number };

export function nextBatch<T>(items: T[], cursor: number, cap: number): Batch<T> {
  if (items.length <= cap) return { batch: items, cursor: 0 } satisfies Batch<T>;
  const start = cursor % items.length;

  const batch = Array.from({ length: cap }, (_, offset) => items[(start + offset) % items.length]).flatMap((item) =>
    item === undefined ? [] : [item],
  );

  return { batch, cursor: (start + cap) % items.length } satisfies Batch<T>;
}

export function nextAlarmAt(now: number, current: number | null): number | null {
  if (current !== null && current > now - WATCHDOG_MS && current <= now + WATCHDOG_MS) return null;

  return now + TICK_MS;
}

export async function runSteps<T, R>(
  batch: T[],
  step: (item: T) => Promise<R>,
  onResult: (item: T, result: R) => void,
  onProblem: (item: T, outcome: StepOutcome, error: string) => void,
  timeoutMs = STEP_TIMEOUT_MS,
  concurrency = STEP_CONCURRENCY,
): Promise<Omit<TickReport, "skipped">> {
  const outcomes: StepOutcome[] = [];

  for (let start = 0; start < batch.length; start += concurrency) {
    const chunk = batch.slice(start, start + concurrency);
    outcomes.push(...(await Promise.all(chunk.map((item) => stepOne(item, step, onResult, onProblem, timeoutMs)))));
  }

  return {
    stepped: outcomes.filter((o) => o === "stepped").length,
    failed: outcomes.filter((o) => o === "failed").length,
    timedOut: outcomes.filter((o) => o === "timed out").length,
  };
}

async function stepOne<T, R>(
  item: T,
  step: (item: T) => Promise<R>,
  onResult: (item: T, result: R) => void,
  onProblem: (item: T, outcome: StepOutcome, error: string) => void,
  timeoutMs: number,
): Promise<StepOutcome> {
  try {
    onResult(item, await withTimeout(step(item), timeoutMs));

    return "stepped";
  } catch (error) {
    const outcome = error instanceof StepTimeout ? "timed out" : "failed";
    onProblem(item, outcome, String(error));

    return outcome;
  }
}

export const MAX_LIVE_FACETS = 12;

export function touchFacet(order: readonly string[], id: string): string[] {
  return [...order.filter((existing) => existing !== id), id];
}

export function facetsToRelease(order: readonly string[], keep: number): string[] {
  return order.slice(0, Math.max(0, order.length - keep));
}
