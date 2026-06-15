/**
 * Structured Answer Parser — Target State Architect-Persona Conversation
 * (Spec 3, Commit 2)
 *
 * Spec: 2026-05-24-target-state-architect-conversation
 *
 * Per-shape parsers for the four `expectedAnswerShape` values declared on
 * `QuestionLibraryEntry`: `free-text`, `single-choice`, `multi-choice`,
 * `structured`. Each parser returns a discriminated `{ ok: true, value }` or
 * `{ ok: false, reason }` result so the loop runner can decide whether to
 * accept the answer or feed the rejection back to the LLM for another round
 * (within the round budget).
 *
 * Per the spec §"Question library config" and Q2:
 * - `single-choice`/`multi-choice` values MUST be members of the entry's
 *   `choices` array; values outside the closed set are rejected.
 * - `free-text` accepts any non-empty string.
 * - `structured` accepts any plain-object payload (per-question shapes are
 *   the LLM's responsibility; the v1 library has no `structured` entries —
 *   the path exists for forward-compat with Group J or future additions).
 *
 * IMPORTANT: This file is pure validation. No I/O, no LLM, no orchestration.
 */

import type {
  ExpectedAnswerShape,
  QuestionLibraryEntry,
} from '../../config/architect-conversation/questionLibrary';

// ---------------------------------------------------------------------------
// Result discriminator
// ---------------------------------------------------------------------------

export type ParsedAnswerOk<T = unknown> = {
  ok: true;
  value: T;
};

export type ParsedAnswerErr = {
  ok: false;
  reason: string;
};

export type ParsedAnswer<T = unknown> = ParsedAnswerOk<T> | ParsedAnswerErr;

// ---------------------------------------------------------------------------
// Per-shape parsers
// ---------------------------------------------------------------------------

function parseFreeText(raw: unknown): ParsedAnswer<string> {
  if (typeof raw !== 'string') {
    return { ok: false, reason: `Expected free-text string, received ${typeof raw}.` };
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: 'Free-text answer was empty after trimming.' };
  }
  return { ok: true, value: trimmed };
}

function parseSingleChoice(
  raw: unknown,
  choices: readonly string[] | undefined,
): ParsedAnswer<string> {
  if (!choices || choices.length === 0) {
    return {
      ok: false,
      reason: 'Library entry declared single-choice but has no choices array.',
    };
  }
  if (typeof raw !== 'string') {
    return {
      ok: false,
      reason: `Expected single-choice string from ${JSON.stringify(choices)}, received ${typeof raw}.`,
    };
  }
  if (!choices.includes(raw)) {
    return {
      ok: false,
      reason: `Value '${raw}' is not a member of allowed choices ${JSON.stringify(choices)}.`,
    };
  }
  return { ok: true, value: raw };
}

function parseMultiChoice(
  raw: unknown,
  choices: readonly string[] | undefined,
): ParsedAnswer<string[]> {
  if (!choices || choices.length === 0) {
    return {
      ok: false,
      reason: 'Library entry declared multi-choice but has no choices array.',
    };
  }
  if (!Array.isArray(raw)) {
    return {
      ok: false,
      reason: `Expected multi-choice array of strings, received ${typeof raw}.`,
    };
  }
  const arr = raw as unknown[];
  if (arr.length === 0) {
    return { ok: false, reason: 'Multi-choice answer was empty.' };
  }
  const offenders: unknown[] = [];
  for (const candidate of arr) {
    if (typeof candidate !== 'string' || !choices.includes(candidate)) {
      offenders.push(candidate);
    }
  }
  if (offenders.length > 0) {
    return {
      ok: false,
      reason: `Multi-choice contains values outside allowed choices: ${JSON.stringify(offenders)}.`,
    };
  }
  return { ok: true, value: arr as string[] };
}

function parseStructured(raw: unknown): ParsedAnswer<Record<string, unknown>> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      ok: false,
      reason: `Expected structured payload (plain object), received ${
        Array.isArray(raw) ? 'array' : typeof raw
      }.`,
    };
  }
  return { ok: true, value: raw as Record<string, unknown> };
}

// ---------------------------------------------------------------------------
// Public dispatcher
// ---------------------------------------------------------------------------

/**
 * Validate `raw` against `entry.expectedAnswerShape`. Returns a discriminated
 * `ParsedAnswer` — `{ ok: true, value }` on success, `{ ok: false, reason }`
 * for the runner to feed back to the LLM for retry.
 *
 * For `single-choice`/`multi-choice` the validator enforces membership of the
 * entry's `choices` array per the closed-set contract in spec §"Question
 * library config".
 */
export function parseStructuredAnswer(
  raw: unknown,
  entry: Pick<QuestionLibraryEntry, 'expectedAnswerShape' | 'choices' | 'code'>,
): ParsedAnswer {
  const shape: ExpectedAnswerShape = entry.expectedAnswerShape;
  switch (shape) {
    case 'free-text':
      return parseFreeText(raw);
    case 'single-choice':
      return parseSingleChoice(raw, entry.choices);
    case 'multi-choice':
      return parseMultiChoice(raw, entry.choices);
    case 'structured':
      return parseStructured(raw);
    default: {
      // Exhaustiveness guard.
      const exhaustive: never = shape;
      return {
        ok: false,
        reason: `Unknown expectedAnswerShape '${exhaustive}' on entry '${entry.code}'.`,
      };
    }
  }
}
