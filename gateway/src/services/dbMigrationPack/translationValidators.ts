/**
 * Hand-rolled validators for the DB object translation LLM responses.
 *
 * Spec: 2026-06-11 LLM-Assisted DB Object Translation Drafts — Task 3.4/3.5.
 *
 * Modelled on `migrationBookOfWorkExpansionValidators.ts` /
 * `architectConversation/techStackPrefillResponseValidator.ts`: explicit
 * per-rule checks, the `{ ok, value | errors }` return shape, NO JSON-schema
 * library (the gateway carries none).
 *
 * Two response surfaces:
 *   1. `validateTranslationResponse` — the per-object translation call:
 *      `{ draft_sql: string, notes?: string[] }`.
 *   2. `validateJudgeVerdict` — the verdict-only judge call:
 *      `{ verdict, confidence, flags: [{ construct, concern, severity }] }`.
 *      The verdict is judge INFORMATION, never a rewrite — a verdict WITH
 *      flags is still valid (flags inform the reviewer; only judge-call
 *      failure blocks review).
 */

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

// ---------------------------------------------------------------------------
// 1) Translation response
// ---------------------------------------------------------------------------

export interface TranslationDraftResponse {
  /** The translated PostgreSQL draft SQL (PL/pgSQL function / trigger / view). */
  draftSql: string;
  /** Optional translator notes (carried into nothing executable — info only). */
  notes: string[];
}

export function validateTranslationResponse(
  payload: unknown
): ValidationResult<TranslationDraftResponse> {
  const errors: string[] = [];
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, errors: ['response must be a JSON object'] };
  }
  const obj = payload as Record<string, unknown>;
  const draftSql = obj['draft_sql'];
  if (typeof draftSql !== 'string' || draftSql.trim().length === 0) {
    errors.push('draft_sql must be a non-empty string');
  }
  let notes: string[] = [];
  if (obj['notes'] !== undefined && obj['notes'] !== null) {
    if (!Array.isArray(obj['notes'])) {
      errors.push('notes must be an array of strings when present');
    } else {
      const bad = (obj['notes'] as unknown[]).some((n) => typeof n !== 'string');
      if (bad) {
        errors.push('notes must contain only strings');
      } else {
        notes = obj['notes'] as string[];
      }
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { draftSql: (draftSql as string).trim(), notes } };
}

// ---------------------------------------------------------------------------
// 2) Judge verdict (verdict-only — the judge NEVER rewrites the draft)
// ---------------------------------------------------------------------------

export const JUDGE_VERDICT_VALUES = [
  'equivalent',
  'equivalent_with_concerns',
  'not_equivalent',
] as const;

export interface JudgeVerdictFlag {
  construct: string;
  concern: string;
  severity: string;
}

export interface JudgeVerdict {
  verdict: (typeof JUDGE_VERDICT_VALUES)[number];
  confidence: number;
  flags: JudgeVerdictFlag[];
}

export function validateJudgeVerdict(payload: unknown): ValidationResult<JudgeVerdict> {
  const errors: string[] = [];
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, errors: ['judge response must be a JSON object'] };
  }
  const obj = payload as Record<string, unknown>;

  const verdict = obj['verdict'];
  if (
    typeof verdict !== 'string' ||
    !(JUDGE_VERDICT_VALUES as readonly string[]).includes(verdict)
  ) {
    errors.push(`verdict must be one of ${JUDGE_VERDICT_VALUES.join(' | ')}`);
  }

  const confidence = obj['confidence'];
  if (typeof confidence !== 'number' || !Number.isFinite(confidence)) {
    errors.push('confidence must be a finite number');
  } else if (confidence < 0 || confidence > 1) {
    errors.push('confidence must be between 0 and 1 inclusive');
  }

  const flags: JudgeVerdictFlag[] = [];
  const rawFlags = obj['flags'];
  if (rawFlags !== undefined && rawFlags !== null) {
    if (!Array.isArray(rawFlags)) {
      errors.push('flags must be an array when present');
    } else {
      rawFlags.forEach((f, i) => {
        if (f === null || typeof f !== 'object' || Array.isArray(f)) {
          errors.push(`flags[${i}] must be an object`);
          return;
        }
        const flag = f as Record<string, unknown>;
        const construct = flag['construct'];
        const concern = flag['concern'];
        const severity = flag['severity'];
        if (typeof construct !== 'string' || construct.trim().length === 0) {
          errors.push(`flags[${i}].construct must be a non-empty string`);
          return;
        }
        if (typeof concern !== 'string' || concern.trim().length === 0) {
          errors.push(`flags[${i}].concern must be a non-empty string`);
          return;
        }
        if (typeof severity !== 'string' || severity.trim().length === 0) {
          errors.push(`flags[${i}].severity must be a non-empty string`);
          return;
        }
        flags.push({ construct, concern, severity });
      });
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      verdict: verdict as JudgeVerdict['verdict'],
      confidence: confidence as number,
      flags,
    },
  };
}
