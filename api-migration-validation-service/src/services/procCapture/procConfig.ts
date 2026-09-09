/**
 * Env knobs for proc behaviour capture (Spec 3, 2026-09-09). All optional;
 * per-session `capture_tuning_json` overrides win.
 */

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const PROC_LLM_ROUND_LIMIT = (): number => envInt('PROC_LLM_ROUND_LIMIT', 12);
export const PROC_LLM_RESEARCH_ROUND_CEILING = (): number => envInt('PROC_LLM_RESEARCH_ROUND_CEILING', 60);
export const PROC_LLM_TOOL_CALL_TIMEOUT_MS = (): number => envInt('PROC_LLM_TOOL_CALL_TIMEOUT_MS', 180_000);
export const PROC_LLM_SCENARIO_WALL_CLOCK_MS = (): number => envInt('PROC_LLM_SCENARIO_WALL_CLOCK_MS', 20 * 60_000);
export const PROC_LLM_ATTEMPTS_PER_ROUTINE = (): number => envInt('PROC_LLM_ATTEMPTS_PER_ROUTINE', 15);
export const PROC_CALL_MAX_ROWS_PER_RESULT_SET = (): number => envInt('PROC_CALL_MAX_ROWS_PER_RESULT_SET', 1000);
export const PROC_CALL_MAX_RESULT_SETS = (): number => envInt('PROC_CALL_MAX_RESULT_SETS', 10);
export const PROC_CALL_TIMEOUT_SECONDS = (): number => envInt('PROC_CALL_TIMEOUT_SECONDS', 300);
export const PROC_CAPTURE_QUIET_WINDOW_SECONDS = (): number => envInt('PROC_CAPTURE_QUIET_WINDOW_SECONDS', 120);

/** Session SET list override: semicolon-separated (`set nocount off;set rowcount 0`). */
export function procCallSessionSetOverride(): string[] | null {
  const raw = process.env.PROC_CALL_SESSION_SET;
  if (!raw || raw.trim() === '') return null;
  return raw.split(';').map((s) => s.trim()).filter((s) => s.length > 0);
}
