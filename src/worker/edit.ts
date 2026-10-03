import { type ValidationResult, validateBehavior } from "./behavior";
import type { TickResult } from "./schema";
import { withTimeout } from "./tick";

export const TRIAL_TIMEOUT_MS = 3000;

export const MAX_EDITS_PER_IP_PER_HOUR = 20;

export type EditVerdict = { ok: true; code: string } | { ok: false; reason: string };

export type TrialRunner = (code: string) => Promise<TickResult>;

function staticReason(result: ValidationResult): string {
  return result.ok ? "" : `The static check rejected the code: ${result.reason}.`;
}

export async function checkEdit(
  raw: string,
  runTrial: TrialRunner,
  timeoutMs = TRIAL_TIMEOUT_MS,
): Promise<EditVerdict> {
  const checked = validateBehavior(raw);

  if (!checked.ok) return { ok: false, reason: staticReason(checked) };

  let trial: TickResult;

  try {
    trial = await withTimeout(runTrial(checked.code), timeoutMs);
  } catch (error) {
    return { ok: false, reason: `The 3-tick trial did not finish: ${String(error).slice(0, 200)}` };
  }

  if (!trial.ok) return { ok: false, reason: `The 3-tick trial threw: ${trial.error ?? "unknown error"}` };

  return { ok: true, code: checked.code };
}
