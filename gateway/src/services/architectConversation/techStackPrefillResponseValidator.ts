/**
 * Tech-Stack Pre-fill Response Validator — Tech-Stack.md Pre-fill + Target-Tech-Stack.md Write
 * (Spec 2026-05-25, Task Group 2).
 *
 * Hand-rolled validator for the JSON response produced by the single-shot
 * pre-fill LLM call (see `prefillFromTechStack.ts`). Mirrors the pattern set
 * by `migrationDeliverySequencingResponseValidator.ts` — no JSON-schema
 * library, explicit per-rule checks, `{ ok, value | errors }` return shape.
 *
 * Rules enforced:
 *   1. Payload is a plain object.
 *   2. `preFilledAnswers` is an array (may be empty when no matches were
 *      found, but the type must be array).
 *   3. `unmatchedCodes` is an array of strings.
 *   4. `summary` is a string (may be empty).
 *   5. Each pre-fill answer has:
 *       - `decisionCode`: non-empty string, MUST exist in the library entry
 *         set passed to the validator.
 *       - `value`: non-empty string.
 *       - `sourceQuote`: non-empty string that loose-contains-checks against
 *         the supplied org + project markdown blobs after whitespace
 *         normalisation (collapse all whitespace runs to single spaces, then
 *         contains-check).
 *       - `sourceFile`: must be 'organisation' or 'project'.
 *   6. No `decisionCode` appears twice in `preFilledAnswers`.
 *   7. No `decisionCode` appears in both `preFilledAnswers` and
 *      `unmatchedCodes`.
 *   8. Every entry in `unmatchedCodes` is a non-empty string (membership in
 *      the library set is NOT enforced because the LLM may legitimately
 *      surface codes the operator did not ask about — we only assert
 *      structural correctness for the unmatched list).
 *
 * Returns `{ ok: true, value }` when every rule passes, or `{ ok: false,
 * errors: [...] }` otherwise. The caller (the pre-fill orchestrator) routes
 * validation failure to the failure-variant banner and writes zero rows.
 */

// ---------------------------------------------------------------------------
// Typed shapes
// ---------------------------------------------------------------------------

export type PreFillSourceFile = 'organisation' | 'project';

export interface PreFillAnswerEntry {
  decisionCode: string;
  value: string;
  sourceQuote: string;
  sourceFile: PreFillSourceFile;
}

export interface PreFillResponse {
  preFilledAnswers: PreFillAnswerEntry[];
  unmatchedCodes: string[];
  summary: string;
}

// ---------------------------------------------------------------------------
// Validation result types — mirror specGenerationResponseValidator
// ---------------------------------------------------------------------------

export interface ValidationOk<T> {
  ok: true;
  value: T;
}

export interface ValidationFail {
  ok: false;
  errors: string[];
}

export type ValidationResult<T> = ValidationOk<T> | ValidationFail;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Collapse runs of whitespace to a single space so the contains-check tolerates
 * Markdown table re-flow and minor whitespace drift between the LLM's quoted
 * text and the source file.
 */
function normaliseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Loose contains-check: returns true when the (normalised) needle appears in
 * the (normalised) haystack. Used to validate that the LLM's `sourceQuote` is
 * present in either the organisation or project markdown blob.
 */
export function looseContains(needle: string, haystack: string | null): boolean {
  if (!haystack || haystack.length === 0) return false;
  const normalisedNeedle = normaliseWhitespace(needle);
  if (normalisedNeedle.length === 0) return false;
  const normalisedHaystack = normaliseWhitespace(haystack);
  return normalisedHaystack.includes(normalisedNeedle);
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Validates a candidate pre-fill response payload (already-parsed JS object)
 * against the rules listed in the file header.
 *
 * @param payload                the parsed JS object to validate
 * @param libraryDecisionCodes   the set of `decisionCode` values present in
 *                               the question library — used to enforce rule
 *                               5's "decisionCode exists in the library"
 *                               check.
 * @param orgMarkdown            the organisation tech-stack.md content (or
 *                               null when absent); used for rule 5's
 *                               `sourceQuote` contains-check.
 * @param projectMarkdown        the project tech-stack.md content (or null
 *                               when absent); used for rule 5's
 *                               `sourceQuote` contains-check.
 * @returns                      a {@link ValidationResult} the caller branches on.
 */
export function assertPreFillResponse(
  payload: unknown,
  libraryDecisionCodes: ReadonlySet<string>,
  orgMarkdown: string | null,
  projectMarkdown: string | null,
): ValidationResult<PreFillResponse> {
  if (!isPlainObject(payload)) {
    return { ok: false, errors: ['Pre-fill response payload is not a JSON object'] };
  }

  const errors: string[] = [];

  // Top-level shape -------------------------------------------------------
  if (!Array.isArray(payload.preFilledAnswers)) {
    errors.push('preFilledAnswers must be an array');
  }
  if (!Array.isArray(payload.unmatchedCodes)) {
    errors.push('unmatchedCodes must be an array of strings');
  }
  if (typeof payload.summary !== 'string') {
    errors.push('summary must be a string');
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const rawAnswers = payload.preFilledAnswers as unknown[];
  const rawUnmatched = payload.unmatchedCodes as unknown[];

  // Validate unmatchedCodes entries ---------------------------------------
  const unmatchedCodes: string[] = [];
  const unmatchedSet = new Set<string>();
  for (let i = 0; i < rawUnmatched.length; i++) {
    const code = rawUnmatched[i];
    if (!isNonEmptyString(code)) {
      errors.push(`unmatchedCodes[${i}] must be a non-empty string`);
      continue;
    }
    unmatchedCodes.push(code);
    unmatchedSet.add(code);
  }

  // Validate preFilledAnswers entries -------------------------------------
  const preFilledAnswers: PreFillAnswerEntry[] = [];
  const seenAnswerCodes = new Set<string>();
  for (let i = 0; i < rawAnswers.length; i++) {
    const raw = rawAnswers[i];
    if (!isPlainObject(raw)) {
      errors.push(`preFilledAnswers[${i}] must be an object`);
      continue;
    }

    // decisionCode -------------------------------------------------------
    if (!isNonEmptyString(raw.decisionCode)) {
      errors.push(`preFilledAnswers[${i}].decisionCode must be a non-empty string`);
      continue;
    }
    const decisionCode = raw.decisionCode;
    if (!libraryDecisionCodes.has(decisionCode)) {
      errors.push(
        `preFilledAnswers[${i}].decisionCode ${JSON.stringify(decisionCode)} is not present in the question library`,
      );
    }
    if (seenAnswerCodes.has(decisionCode)) {
      errors.push(
        `preFilledAnswers[${i}].decisionCode ${JSON.stringify(decisionCode)} appears more than once in preFilledAnswers`,
      );
    } else {
      seenAnswerCodes.add(decisionCode);
    }
    if (unmatchedSet.has(decisionCode)) {
      errors.push(
        `preFilledAnswers[${i}].decisionCode ${JSON.stringify(decisionCode)} also appears in unmatchedCodes`,
      );
    }

    // value --------------------------------------------------------------
    if (!isNonEmptyString(raw.value)) {
      errors.push(`preFilledAnswers[${i}].value must be a non-empty string`);
    }

    // sourceQuote --------------------------------------------------------
    if (!isNonEmptyString(raw.sourceQuote)) {
      errors.push(`preFilledAnswers[${i}].sourceQuote must be a non-empty string`);
    } else {
      const inOrg = looseContains(raw.sourceQuote, orgMarkdown);
      const inProject = looseContains(raw.sourceQuote, projectMarkdown);
      if (!inOrg && !inProject) {
        errors.push(
          `preFilledAnswers[${i}].sourceQuote does not appear in either the organisation or project tech-stack.md (whitespace-normalised contains-check failed)`,
        );
      }
    }

    // sourceFile ---------------------------------------------------------
    if (raw.sourceFile !== 'organisation' && raw.sourceFile !== 'project') {
      errors.push(
        `preFilledAnswers[${i}].sourceFile must be 'organisation' or 'project' (got ${JSON.stringify(raw.sourceFile)})`,
      );
    }

    // Push a typed copy regardless of per-field failure — callers that
    // receive `errors.length > 0` will ignore `preFilledAnswers`; callers
    // in the happy path get a well-formed array.
    preFilledAnswers.push({
      decisionCode: typeof raw.decisionCode === 'string' ? raw.decisionCode : '',
      value: typeof raw.value === 'string' ? raw.value : '',
      sourceQuote: typeof raw.sourceQuote === 'string' ? raw.sourceQuote : '',
      sourceFile: raw.sourceFile === 'project' ? 'project' : 'organisation',
    });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      preFilledAnswers,
      unmatchedCodes,
      summary: payload.summary as string,
    },
  };
}
