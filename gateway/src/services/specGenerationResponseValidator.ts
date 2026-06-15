/**
 * SpecGenerationResponse hand-rolled validator (Spec 2 PM Migration Shape-Spec Batch Generation).
 *
 * Spec: 2026-05-19 PM Migration Shape-Spec Batch Generation
 * Task Group 4: Hand-Rolled Response Validator.
 *
 * Validates the structured LLM response produced by the
 * `product-manager--migration-shape-spec-generation` task. The validator is
 * hand-rolled per A-4 (no Zod, no Ajv, no schema library) and mirrors the
 * pattern in `generatedMigrationBookOfWorkSchema.ts` (Spec 1's PM task).
 *
 * Validator failures map to per-story `failed` results, NEVER aborting the
 * whole batch (per R-12 — failure isolation). The batch handler (Group 6)
 * catches validation errors and records them as per-story
 * `{ status: 'failed', errorMessage: '<validator error>' }` rows.
 *
 * The response shape has three variants keyed on `status`:
 *
 *   A. Generated:
 *      status ∈ { 'generated', 'generated_with_warnings' }
 *      required: confidence (high|medium|low), specText, warnings,
 *                evidenceRefs, assumptions, tests, affectedAreas,
 *                coveredEndpointIds
 *      hard rules:
 *        - specText MUST start with the literal `/agent-os:shape-spec`
 *        - specText MUST carry actionable detail (proxy: length > 200 chars)
 *        - tests MUST be a structured array of
 *          { title, description, type: 'unit' | 'functional' }
 *          (Implementation-Ready Migration Spec Generation, D6)
 *        - coveredEndpointIds MUST be an array of strings (MAY be empty for
 *          non-endpoint stories) (Implementation-Ready Migration Spec
 *          Generation, D9)
 *
 *   B. InsufficientContext:
 *      status === 'insufficient_context'
 *      required: missingInputs (non-empty array), reason, recommendedNextAction,
 *                evidenceRefs
 *
 *   C. Failed:
 *      status === 'failed'
 *      required: errorMessage (non-empty)
 *
 * Public API:
 *   - `assertSpecGenerationResponse(payload)`
 *       returns `{ ok: true, value }` on success or
 *       `{ ok: false, errors: [...] }` on any failure with a list of
 *       human-readable error messages.
 *   - `computeMissingCitationWarning(response, capturedDecisions)`
 *       Spec 2026-05-25 extension -- for a Generated-variant response, appends
 *       a `missing_decision_citation` structured warning AND downgrades the
 *       LLM-rated confidence by one notch when the project has captured
 *       decisions AND the story's `evidenceRefs[]` contains zero entries with
 *       `type='captured_decision'`. Additive: no behaviour change for
 *       projects with zero captured decisions or for stories that already
 *       cite at least one captured-decision evidence ref.
 *       Spec 2026-05-26 tightening: the downgrade now fires only when at
 *       least one IN-SCOPE captured decision is uncited. Architecture-scope
 *       decisions stay always-in-scope; element-scope decisions are in-scope
 *       only when the story's `specText` or `affectedAreas` mention the
 *       resolved element name (case-insensitive substring). Legacy callers
 *       that omit `scopeKind` retain v1 binary behaviour (treated as
 *       architecture-scope → always in-scope).
 *   - `computeUnreferencedCitedDecisionWarning(response, capturedDecisions)`
 *       Sibling safety-net extension (Item N2) -- for a Generated-variant
 *       response that DID cite at least one captured decision, appends a
 *       `captured_decision_value_not_in_spec_text` structured warning when
 *       any cited decision's `answerValue` does NOT appear verbatim in
 *       `specText` (case-sensitive substring check). Warning-only signal:
 *       confidence is NOT downgraded. Complements
 *       `computeMissingCitationWarning` -- both functions are independent and
 *       the handler invokes them in sequence.
 *
 * Design-point refs:
 *   - A-4 hand-rolled validator, no schema library
 *   - R-12 per-story failure isolation (validator failures map to per-story failed)
 *   - R-13 / A-7 LLM-output fixtures consumed by the test suite
 *   - Spec 2026-05-25 Q5 + Q18: validator extension fires per-story between parse and auto-seed/persist
 *
 * Note on the actionable-detail rule:
 *   The user-facing requirement is "specText MUST reference some recognisable
 *   scope". This validator's deterministic implementation uses
 *   `specText.length > 200` as a content-length proxy for actionability when
 *   `affectedAreas` and `tests` are both empty. Group 6's handler layers a
 *   richer per-story scope check (case-insensitive substring of story title)
 *   against the actual story title which is unavailable here.
 */

// ---------------------------------------------------------------------------
// Enums + exported constant arrays
// ---------------------------------------------------------------------------

export const SPEC_GENERATION_STATUS_VALUES = [
  'generated',
  'generated_with_warnings',
  'insufficient_context',
  'failed',
] as const;
export type SpecGenerationStatus =
  (typeof SPEC_GENERATION_STATUS_VALUES)[number];

export const SPEC_GENERATION_CONFIDENCE_VALUES = [
  'high',
  'medium',
  'low',
] as const;
export type SpecGenerationConfidence =
  (typeof SPEC_GENERATION_CONFIDENCE_VALUES)[number];

/**
 * Heuristic content-length floor for the actionable-detail rule when neither
 * `affectedAreas` nor `tests` carry entries. The number is a deliberate proxy
 * — Group 6 layers a richer story-title substring check on top.
 */
export const SPEC_TEXT_ACTIONABLE_LENGTH_FLOOR = 200;

/**
 * The literal prefix every generated `specText` MUST start with.
 */
export const SPEC_TEXT_REQUIRED_PREFIX = '/agent-os:shape-spec';

/**
 * Allowed `type` values for a structured test in the Generated variant's
 * `tests[]` array (Implementation-Ready Migration Spec Generation, D6).
 * Constrained to `unit` / `functional` ONLY -- integration / E2E are Spec 2
 * concerns and are deliberately excluded here so the test pack maps 1:1 to the
 * Test Engineer `TestDefinition` shape the implement screen consumes.
 */
export const STRUCTURED_TEST_TYPE_VALUES = ['unit', 'functional'] as const;
export type StructuredTestType = (typeof STRUCTURED_TEST_TYPE_VALUES)[number];

// ---------------------------------------------------------------------------
// Typed shapes
// ---------------------------------------------------------------------------

/**
 * Free-shape entries inside the response's array fields. `evidenceRefs`,
 * `warnings`, and `missingInputs` accept either strings or objects so the
 * validator is forgiving about the LLM's chosen representation; downstream
 * Group 6 + Group 8 code normalises the shape.
 */
export type EvidenceRefEntry = string | Record<string, unknown>;
export type WarningEntry = Record<string, unknown>;
export interface MissingInputEntry {
  kind: string;
  id?: string;
  reason: string;
  [key: string]: unknown;
}

/**
 * A single structured test in the Generated variant's `tests[]` array
 * (Implementation-Ready Migration Spec Generation, D6). Aligns 1:1 with the
 * Test Engineer `TestDefinition` shape (`{ title, description, type }`) so the
 * structured pack can populate `latestTestPlannerResponse.testPlan` on the
 * implement screen AND render inline into `generated_spec_text` (D3). `type` is
 * constrained to `unit` / `functional`.
 */
export interface StructuredTest {
  title: string;
  description: string;
  type: StructuredTestType;
}

export interface GeneratedShapeSpecResponseA {
  status: 'generated' | 'generated_with_warnings';
  confidence: SpecGenerationConfidence;
  specText: string;
  warnings: WarningEntry[];
  evidenceRefs: EvidenceRefEntry[];
  assumptions: string[];
  /**
   * Structured unit/functional test pack (D6). Each entry is a
   * `{ title, description, type: 'unit' | 'functional' }` object; the array may
   * not be empty in practice (the prompt mandates >=1 test) but the validator
   * does not enforce non-emptiness here so a sparse-but-valid generation is not
   * forced into `failed`.
   */
  tests: StructuredTest[];
  affectedAreas: string[];
  /**
   * Model `EndpointEntity` UUIDs this story migrates (D9). MAY be empty for
   * non-endpoint stories (DB schema / data migration / other-service / infra).
   * Forward-only groundwork -- persisted but NOT consumed by any v1 feature.
   */
  coveredEndpointIds: string[];
}

export interface InsufficientContextShapeSpecResponseB {
  status: 'insufficient_context';
  missingInputs: MissingInputEntry[];
  reason: string;
  recommendedNextAction: string;
  evidenceRefs: EvidenceRefEntry[];
}

export interface FailedShapeSpecResponseC {
  status: 'failed';
  errorMessage: string;
}

export type GeneratedShapeSpecResponse =
  | GeneratedShapeSpecResponseA
  | InsufficientContextShapeSpecResponseB
  | FailedShapeSpecResponseC;

// ---------------------------------------------------------------------------
// Validation result types (mirror generatedMigrationBookOfWorkSchema.ts)
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
  return (
    value !== null && typeof value === 'object' && !Array.isArray(value)
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

function isObjectOrStringArray(value: unknown): value is EvidenceRefEntry[] {
  return (
    Array.isArray(value) &&
    value.every((v) => typeof v === 'string' || isPlainObject(v))
  );
}

function isObjectArray(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.every((v) => isPlainObject(v));
}

// ---------------------------------------------------------------------------
// Branch validators
// ---------------------------------------------------------------------------

function validateGeneratedBranch(
  obj: Record<string, unknown>
): ValidationResult<GeneratedShapeSpecResponseA> {
  const errors: string[] = [];
  const statusLabel = String(obj.status);

  // confidence
  if (
    typeof obj.confidence !== 'string' ||
    !(SPEC_GENERATION_CONFIDENCE_VALUES as readonly string[]).includes(
      obj.confidence as string
    )
  ) {
    errors.push(
      `${statusLabel}.confidence must be one of: ${SPEC_GENERATION_CONFIDENCE_VALUES.join(' | ')} (got ${JSON.stringify(obj.confidence)})`
    );
  }

  // specText
  if (typeof obj.specText !== 'string' || obj.specText.length === 0) {
    errors.push(`${statusLabel}.specText must be a non-empty string`);
  } else {
    // Hard rule 1: prefix
    if (!obj.specText.startsWith(SPEC_TEXT_REQUIRED_PREFIX)) {
      errors.push(
        `${statusLabel}.specText must start with the literal "${SPEC_TEXT_REQUIRED_PREFIX}" (got prefix ${JSON.stringify(obj.specText.substring(0, 30))})`
      );
    }
    // Hard rule 2: actionable detail / scope proxy
    // The user-facing requirement is "MUST reference some recognisable scope";
    // here we use specText.length > 200 chars as a deterministic proxy for
    // actionability. Group 6's handler layers a per-story title substring
    // check on top.
    const hasAffected =
      Array.isArray(obj.affectedAreas) &&
      (obj.affectedAreas as unknown[]).length > 0;
    const hasTests =
      Array.isArray(obj.tests) && (obj.tests as unknown[]).length > 0;
    if (
      !hasAffected &&
      !hasTests &&
      obj.specText.length <= SPEC_TEXT_ACTIONABLE_LENGTH_FLOOR
    ) {
      errors.push(
        `${statusLabel}.specText must reference actionable scope (non-empty affectedAreas OR non-empty tests OR length > ${SPEC_TEXT_ACTIONABLE_LENGTH_FLOOR} chars; got length=${obj.specText.length})`
      );
    }
  }

  // warnings — array of objects (may be empty for clean `generated`)
  if (!Array.isArray(obj.warnings)) {
    errors.push(`${statusLabel}.warnings must be an array`);
  } else if (!isObjectArray(obj.warnings)) {
    errors.push(`${statusLabel}.warnings must be an array of objects`);
  }

  // evidenceRefs — array of strings or objects
  if (!Array.isArray(obj.evidenceRefs)) {
    errors.push(`${statusLabel}.evidenceRefs must be an array`);
  } else if (!isObjectOrStringArray(obj.evidenceRefs)) {
    errors.push(
      `${statusLabel}.evidenceRefs must be an array of strings or objects`
    );
  }

  // assumptions
  if (!Array.isArray(obj.assumptions)) {
    errors.push(`${statusLabel}.assumptions must be an array`);
  } else if (!isStringArray(obj.assumptions)) {
    errors.push(`${statusLabel}.assumptions must be an array of strings`);
  }

  // tests — structured array of { title, description, type: unit|functional }
  // (Implementation-Ready Migration Spec Generation, D6). The flat string[]
  // shape from the original Spec 2 contract is no longer accepted.
  if (!Array.isArray(obj.tests)) {
    errors.push(`${statusLabel}.tests must be an array`);
  } else {
    const tests = obj.tests as unknown[];
    for (let i = 0; i < tests.length; i++) {
      const entry = tests[i];
      if (!isPlainObject(entry)) {
        errors.push(
          `${statusLabel}.tests[${i}] must be an object { title, description, type }`
        );
        continue;
      }
      if (typeof entry.title !== 'string' || entry.title.length === 0) {
        errors.push(
          `${statusLabel}.tests[${i}].title must be a non-empty string`
        );
      }
      if (
        typeof entry.description !== 'string' ||
        entry.description.length === 0
      ) {
        errors.push(
          `${statusLabel}.tests[${i}].description must be a non-empty string`
        );
      }
      if (
        typeof entry.type !== 'string' ||
        !(STRUCTURED_TEST_TYPE_VALUES as readonly string[]).includes(
          entry.type as string
        )
      ) {
        errors.push(
          `${statusLabel}.tests[${i}].type must be one of: ${STRUCTURED_TEST_TYPE_VALUES.join(' | ')} (got ${JSON.stringify(entry.type)})`
        );
      }
    }
  }

  // affectedAreas
  if (!Array.isArray(obj.affectedAreas)) {
    errors.push(`${statusLabel}.affectedAreas must be an array`);
  } else if (!isStringArray(obj.affectedAreas)) {
    errors.push(`${statusLabel}.affectedAreas must be an array of strings`);
  }

  // coveredEndpointIds — array of strings, MAY be empty (D9). Forward-only
  // groundwork; non-endpoint stories emit [].
  if (!Array.isArray(obj.coveredEndpointIds)) {
    errors.push(`${statusLabel}.coveredEndpointIds must be an array`);
  } else if (!isStringArray(obj.coveredEndpointIds)) {
    errors.push(
      `${statusLabel}.coveredEndpointIds must be an array of strings`
    );
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: obj as unknown as GeneratedShapeSpecResponseA,
  };
}

function validateInsufficientContextBranch(
  obj: Record<string, unknown>
): ValidationResult<InsufficientContextShapeSpecResponseB> {
  const errors: string[] = [];

  // missingInputs — REQUIRED, non-empty
  if (!Array.isArray(obj.missingInputs)) {
    errors.push('insufficient_context.missingInputs must be an array');
  } else if ((obj.missingInputs as unknown[]).length === 0) {
    errors.push(
      'insufficient_context.missingInputs must be a non-empty array'
    );
  } else {
    // Each entry must be an object with at least `kind` and `reason` strings
    const items = obj.missingInputs as unknown[];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!isPlainObject(item)) {
        errors.push(
          `insufficient_context.missingInputs[${i}] must be an object`
        );
        continue;
      }
      if (typeof item.kind !== 'string' || item.kind.length === 0) {
        errors.push(
          `insufficient_context.missingInputs[${i}].kind must be a non-empty string`
        );
      }
      if (typeof item.reason !== 'string' || item.reason.length === 0) {
        errors.push(
          `insufficient_context.missingInputs[${i}].reason must be a non-empty string`
        );
      }
      if (
        item.id !== undefined &&
        item.id !== null &&
        typeof item.id !== 'string'
      ) {
        errors.push(
          `insufficient_context.missingInputs[${i}].id (when present) must be a string`
        );
      }
    }
  }

  // reason
  if (typeof obj.reason !== 'string' || obj.reason.length === 0) {
    errors.push('insufficient_context.reason must be a non-empty string');
  }

  // recommendedNextAction
  if (
    typeof obj.recommendedNextAction !== 'string' ||
    obj.recommendedNextAction.length === 0
  ) {
    errors.push(
      'insufficient_context.recommendedNextAction must be a non-empty string'
    );
  }

  // evidenceRefs — array of strings or objects (may be empty)
  if (!Array.isArray(obj.evidenceRefs)) {
    errors.push('insufficient_context.evidenceRefs must be an array');
  } else if (!isObjectOrStringArray(obj.evidenceRefs)) {
    errors.push(
      'insufficient_context.evidenceRefs must be an array of strings or objects'
    );
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: obj as unknown as InsufficientContextShapeSpecResponseB,
  };
}

function validateFailedBranch(
  obj: Record<string, unknown>
): ValidationResult<FailedShapeSpecResponseC> {
  const errors: string[] = [];

  if (typeof obj.errorMessage !== 'string' || obj.errorMessage.length === 0) {
    errors.push('failed.errorMessage must be a non-empty string');
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: obj as unknown as FailedShapeSpecResponseC,
  };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Validates a candidate `SpecGenerationResponse` payload (already-parsed JS
 * object) against the three-variant schema.
 *
 * Branches on `value.status`:
 *   - 'generated' / 'generated_with_warnings' -> Generated branch
 *   - 'insufficient_context'                  -> InsufficientContext branch
 *   - 'failed'                                -> Failed branch
 *   - anything else                           -> top-level error
 *
 * On success returns `{ ok: true, value }` typed as
 * `GeneratedShapeSpecResponse`. On any failure returns
 * `{ ok: false, errors: [...] }` with human-readable error messages
 * suitable for the per-story `failed` result's `errorMessage`.
 *
 * @param payload  the parsed JS object to validate
 * @returns        a {@link ValidationResult} that callers can branch on
 */
export function assertSpecGenerationResponse(
  payload: unknown
): ValidationResult<GeneratedShapeSpecResponse> {
  if (!isPlainObject(payload)) {
    return { ok: false, errors: ['Payload is not a JSON object'] };
  }

  const obj = payload as Record<string, unknown>;

  // Top-level status check
  if (
    typeof obj.status !== 'string' ||
    !(SPEC_GENERATION_STATUS_VALUES as readonly string[]).includes(
      obj.status as string
    )
  ) {
    return {
      ok: false,
      errors: [
        `status must be one of: ${SPEC_GENERATION_STATUS_VALUES.join(' | ')} (got ${JSON.stringify(obj.status)})`,
      ],
    };
  }

  const status = obj.status as SpecGenerationStatus;

  if (status === 'generated' || status === 'generated_with_warnings') {
    return validateGeneratedBranch(obj);
  }
  if (status === 'insufficient_context') {
    return validateInsufficientContextBranch(obj);
  }
  if (status === 'failed') {
    return validateFailedBranch(obj);
  }

  // Defensive — unreachable because we narrowed against the enum above.
  return {
    ok: false,
    errors: [`Unrecognised status value: ${JSON.stringify(status)}`],
  };
}

// ===========================================================================
// Spec 2026-05-25 PM Tasks Captured Decisions Integration -- validator extension
// ===========================================================================

/**
 * Structured-warning shape appended by the missing-decision-citation extension.
 * Mirrors the per-story warning convention used elsewhere in this validator
 * (`warnings[]` entries are object-shaped with a leading `kind` discriminator).
 *
 * Spec 2026-05-26 tightening: now carries the alphabetically-sorted list of
 * in-scope-but-uncited decision codes so the warning is actionable (the PM
 * reviewer can see exactly which captured decisions to add to
 * `evidenceRefs[]`). Existing readers that only inspect `kind` and
 * `recommendedNextAction` continue to work — `missingDecisionCodes` is an
 * additive field.
 */
export interface MissingDecisionCitationWarning extends Record<string, unknown> {
  kind: 'missing_decision_citation';
  recommendedNextAction: 'review and add decision codes';
  /**
   * In-scope-but-uncited decision codes, sorted alphabetically for stable test
   * assertions and PR diffs. Populated by `computeMissingCitationWarning`
   * (Spec 2026-05-26 tightening). Empty array is possible only via fail-open
   * code paths in the handler (e.g. all decisions had `scopeElementName=null`
   * after a failed inventory fetch).
   */
  missingDecisionCodes: string[];
}

/**
 * Result envelope returned by `computeMissingCitationWarning`. The original
 * response is returned unchanged (same object identity, no in-place mutation)
 * when no extension fires; otherwise a NEW object is returned with the
 * augmented `warnings[]` and adjusted `confidence`. The handler then assigns
 * the returned object to the per-story row before persisting.
 *
 * `applied=true` indicates the extension fired (warning appended +
 * confidence-downgrade attempted -- the downgrade itself is bounded at `low`,
 * so applied=true with `confidence='low'->'low'` is a legitimate outcome).
 */
export interface MissingCitationExtensionResult {
  /** Augmented response. Same identity as input when applied=false. */
  response: GeneratedShapeSpecResponseA;
  /** True iff the extension applied (warning + downgrade attempt). */
  applied: boolean;
  /** Original confidence before downgrade (only set when applied=true). */
  originalConfidence?: SpecGenerationConfidence;
}

/**
 * Minimal shape of a captured-decision list entry the extension consumes. The
 * gateway already loads the full `TargetStateCapturedDecision[]` via
 * `fetchLatestCapturedDecisions` -- we only need to know whether the list is
 * non-empty so we accept a structurally-narrow array here for test ergonomics.
 *
 * `answerValue` is optional (added for the Item N2 safety-net extension --
 * `computeUnreferencedCitedDecisionWarning` -- which checks whether each cited
 * decision's verbatim answer string appears in the generated `specText`). The
 * original `computeMissingCitationWarning` only needs `decisionCode`, so older
 * callers that don't populate `answerValue` continue to work unchanged.
 *
 * Spec 2026-05-26 tightening: the three `scope*` fields below are populated by
 * the migration shape-spec handler from the Architecture Model Service
 * captured-decision DTO plus a per-batch element-inventory lookup. Legacy
 * callers that don't populate them get v1 binary behaviour -- treated as
 * architecture-scope → always in-scope → downgrade fires whenever the story
 * lacks a `captured_decision` evidenceRef.
 */
export interface CapturedDecisionRefForCitationCheck {
  decisionCode: string;
  /** Optional verbatim answer string; consumed by Item N2 safety-net check. */
  answerValue?: string;
  /**
   * Decision scope. Matches the production AMS-emitter enum on
   * `targetStateCapturedDecisionsWriter.ts:58` -- only `'architecture'` and
   * `'element'` are ever produced (the `service`/`interface` distinction lives
   * on `scopeRefType`, NOT on `scopeKind`). Undefined = legacy caller = treated
   * as architecture-scope.
   */
  scopeKind?: 'architecture' | 'element';
  /** Scope reference id; null/undefined for architecture-scope decisions. */
  scopeRefId?: string | null;
  /**
   * Element name resolved by the handler via the per-batch
   * `getElementsInventory` lookup. Null when scope is architecture, when the
   * inventory lookup did not resolve the ref (deleted element), or when the
   * inventory fetch failed (fail-open at element level). The validator treats
   * null on element-scope decisions as fail-open in-scope.
   */
  scopeElementName?: string | null;
}

/**
 * Returns true iff at least one entry in `evidenceRefs[]` is an object whose
 * `type` field equals the snake_case literal `'captured_decision'`. String
 * evidenceRef entries are NOT treated as captured-decision citations -- the
 * spec-mandated shape is `{type:'captured_decision', id:'<decision_code>'}`.
 *
 * Exported so the handler tests can reuse the same predicate when constructing
 * fixtures.
 */
export function hasCapturedDecisionEvidenceRef(
  evidenceRefs: readonly EvidenceRefEntry[]
): boolean {
  for (const ref of evidenceRefs) {
    if (typeof ref === 'string') continue;
    if (ref && typeof ref === 'object') {
      const t = (ref as Record<string, unknown>).type;
      if (typeof t === 'string' && t === 'captured_decision') return true;
    }
  }
  return false;
}

/**
 * Downgrade `confidence` by one notch with `low` as the floor.
 *   high   -> medium
 *   medium -> low
 *   low    -> low  (no change)
 *
 * Exported for the handler tests.
 */
export function downgradeConfidenceOneNotch(
  confidence: SpecGenerationConfidence
): SpecGenerationConfidence {
  if (confidence === 'high') return 'medium';
  if (confidence === 'medium') return 'low';
  return 'low';
}

/**
 * Spec 2026-05-26 internal helper: returns true iff the captured decision is
 * in-scope for the given story. The three-branch decision tree:
 *
 *   1. `scopeKind` undefined OR `scopeKind === 'architecture'` -> always
 *      in-scope. Architecture-wide decisions apply to every story; legacy
 *      callers (no scope fields populated) flow through this branch too
 *      preserving v1 binary behaviour.
 *   2. `scopeKind === 'element'` AND `scopeElementName` null/empty -> fail-open
 *      conservative in-scope. The handler returns null when the inventory
 *      lookup did not resolve the ref or the inventory fetch failed; treating
 *      null as in-scope keeps the downgrade signal alive in degraded scenarios.
 *   3. `scopeKind === 'element'` with a non-empty `scopeElementName` -> raw
 *      case-insensitive substring match of the element name against the
 *      concatenation of `response.specText` and each `affectedAreas` entry
 *      joined with newlines. Production element names are compound enough
 *      (`customer-service`, not `order`) that the false-positive surface is
 *      acceptable for v1; word-boundary tightening is a v2 candidate.
 *
 * Exported for direct unit testing.
 */
export function isDecisionInScopeForStory(
  decision: CapturedDecisionRefForCitationCheck,
  response: GeneratedShapeSpecResponseA
): boolean {
  if (!decision.scopeKind || decision.scopeKind === 'architecture') {
    return true;
  }
  // scopeKind === 'element' beyond this point.
  if (!decision.scopeElementName) {
    // Fail-open: handler returns null when the inventory lookup failed or did
    // not resolve the ref. We err on the side of keeping the signal alive.
    return true;
  }
  const needle = decision.scopeElementName.toLowerCase();
  const haystack = [response.specText, ...response.affectedAreas]
    .join('\n')
    .toLowerCase();
  return haystack.includes(needle);
}

/**
 * Spec 2026-05-25 validator extension (tightened by Spec 2026-05-26).
 *
 * For a Generated-variant shape-spec response:
 *   - If `capturedDecisions` is empty -> no-op (return input as-is, applied=false).
 *   - Else filter `capturedDecisions` through `isDecisionInScopeForStory`. If
 *     the in-scope subset is empty (story touches none of the captured
 *     decisions' scope) -> no-op (return input as-is, applied=false).
 *   - Else if the response's `evidenceRefs[]` ALREADY contains at least one
 *     entry with `type='captured_decision'` -> no-op (the LLM cited decisions).
 *   - Else -> append a `missing_decision_citation` structured warning carrying
 *     the alphabetically-sorted `missingDecisionCodes` (the in-scope but
 *     uncited decision codes) AND downgrade `confidence` by one notch (bounded
 *     at `low`). Returns a NEW response object with `applied=true` and the
 *     original confidence echoed in `originalConfidence` for the handler to
 *     log.
 *
 * Per-story scope: this function operates on ONE response at a time. The
 * handler invokes it inside the per-story loop so two stories in the same
 * batch can land with different outcomes (one warned, one untouched) per the
 * Group 3.1 test plan.
 *
 * Stays pure: no I/O. The handler is responsible for resolving
 * `scopeElementName` from the per-batch element-inventory lookup BEFORE
 * calling this function.
 *
 * Backward-compatibility: legacy callers that pass
 * `CapturedDecisionRefForCitationCheck[]` without populating `scopeKind` are
 * treated as architecture-scope across the board (via
 * `isDecisionInScopeForStory` branch 1), restoring v1 binary behaviour.
 *
 * @param response          the validated Generated response to potentially augment
 * @param capturedDecisions the project's latest captured-decisions list (may be empty)
 * @returns                 augmented or unchanged response, with `applied` flag
 */
export function computeMissingCitationWarning(
  response: GeneratedShapeSpecResponseA,
  capturedDecisions: readonly CapturedDecisionRefForCitationCheck[]
): MissingCitationExtensionResult {
  // Additive: no behaviour change for projects with zero captured decisions.
  if (!capturedDecisions || capturedDecisions.length === 0) {
    return { response, applied: false };
  }

  // Spec 2026-05-26: filter to in-scope decisions only. Architecture-scope
  // decisions stay always-in-scope; element-scope decisions need their resolved
  // name (set by the handler) to substring-match the story content.
  const inScopeDecisions = capturedDecisions.filter((d) =>
    isDecisionInScopeForStory(d, response)
  );
  if (inScopeDecisions.length === 0) {
    // Project has captured decisions but none apply to this story.
    return { response, applied: false };
  }

  // No downgrade when the story already cites at least one captured-decision
  // evidence ref.
  if (hasCapturedDecisionEvidenceRef(response.evidenceRefs)) {
    return { response, applied: false };
  }

  // Extension fires: append warning + downgrade confidence by one notch.
  const missingDecisionCodes = inScopeDecisions
    .map((d) => d.decisionCode)
    .slice()
    .sort();
  const warning: MissingDecisionCitationWarning = {
    kind: 'missing_decision_citation',
    recommendedNextAction: 'review and add decision codes',
    missingDecisionCodes,
  };
  const originalConfidence = response.confidence;
  const newConfidence = downgradeConfidenceOneNotch(originalConfidence);
  const augmented: GeneratedShapeSpecResponseA = {
    ...response,
    warnings: [...response.warnings, warning],
    confidence: newConfidence,
  };
  return {
    response: augmented,
    applied: true,
    originalConfidence,
  };
}

// ===========================================================================
// Item N2 safety-net extension -- captured-decision value not in specText
// ===========================================================================

/**
 * Structured-warning shape appended by the
 * `computeUnreferencedCitedDecisionWarning` safety-net extension. Fires when a
 * Generated-variant response DID cite captured decisions (so
 * `computeMissingCitationWarning` did NOT trip) BUT the verbatim
 * `answerValue` of one or more cited decisions does not appear in
 * `specText`. Indicates the LLM paraphrased or ignored the verbatim-quote rule
 * from the Spec-5 prompt; reviewers should double-check the generated text
 * actually references the cited decision values.
 */
export interface UnreferencedCitedDecisionWarning
  extends Record<string, unknown> {
  kind: 'captured_decision_value_not_in_spec_text';
  /** Decision codes whose `answerValue` was not found verbatim in `specText`. */
  missingDecisionCodes: string[];
  recommendedNextAction: 'verify spec text references the cited decision values';
}

/**
 * Result envelope for `computeUnreferencedCitedDecisionWarning`. Mirrors
 * `MissingCitationExtensionResult` but does NOT carry an `originalConfidence`
 * field because this safety-net signal is warning-only -- confidence is never
 * downgraded by N2.
 */
export interface UnreferencedCitedDecisionExtensionResult {
  /** Augmented response. Same identity as input when applied=false. */
  response: GeneratedShapeSpecResponseA;
  /** True iff the extension applied (warning appended). */
  applied: boolean;
}

/**
 * Returns the set of decision-codes cited by the response's `evidenceRefs[]`.
 * A "citation" is any object entry whose `type === 'captured_decision'`; the
 * decision-code is taken from the entry's `id` field (per the spec-mandated
 * shape `{type:'captured_decision', id:'<decision_code>'}`). String
 * evidenceRef entries and entries missing a string `id` are ignored.
 */
function collectCitedDecisionCodes(
  evidenceRefs: readonly EvidenceRefEntry[]
): string[] {
  const cited: string[] = [];
  for (const ref of evidenceRefs) {
    if (typeof ref === 'string') continue;
    if (!ref || typeof ref !== 'object') continue;
    const obj = ref as Record<string, unknown>;
    if (obj.type !== 'captured_decision') continue;
    if (typeof obj.id !== 'string' || obj.id.length === 0) continue;
    cited.push(obj.id);
  }
  return cited;
}

/**
 * Item N2 safety-net validator extension.
 *
 * For a Generated-variant shape-spec response that DID cite captured
 * decisions in `evidenceRefs[]`:
 *
 *   - For each cited decision-code, look up the matching entry in
 *     `capturedDecisions` by `decisionCode`. Skip codes that don't resolve
 *     (the citation is technically wrong but that's a different signal --
 *     out of scope for N2).
 *   - For each resolved decision with a non-empty `answerValue`, check
 *     whether `response.specText` contains the `answerValue` as a
 *     case-sensitive substring.
 *   - Collect the `decisionCode`s whose `answerValue` is NOT found.
 *   - If the collected list is empty -> no-op (return input as-is,
 *     `applied=false`). The LLM honoured the verbatim-quote rule.
 *   - Else -> append a `captured_decision_value_not_in_spec_text` structured
 *     warning carrying the missing codes. Confidence is NOT downgraded
 *     (warning-only signal).
 *
 * This is a complementary signal to `computeMissingCitationWarning`:
 *   - `computeMissingCitationWarning` fires when NO captured decision is
 *     cited at all.
 *   - `computeUnreferencedCitedDecisionWarning` fires when decisions ARE
 *     cited but their verbatim values don't appear in the generated text.
 *
 * Both functions are independent and additive; the handler invokes them in
 * sequence and accumulates warnings.
 *
 * @param response          the validated Generated response to potentially augment
 * @param capturedDecisions the project's latest captured-decisions list (may be empty)
 * @returns                 augmented or unchanged response, with `applied` flag
 */
export function computeUnreferencedCitedDecisionWarning(
  response: GeneratedShapeSpecResponseA,
  capturedDecisions: readonly CapturedDecisionRefForCitationCheck[]
): UnreferencedCitedDecisionExtensionResult {
  // Additive: nothing to cross-check if the project has zero decisions.
  if (!capturedDecisions || capturedDecisions.length === 0) {
    return { response, applied: false };
  }

  const citedCodes = collectCitedDecisionCodes(response.evidenceRefs);
  if (citedCodes.length === 0) {
    // No citations -> different problem, handled by
    // `computeMissingCitationWarning`. This safety-net only fires when at
    // least one decision was cited.
    return { response, applied: false };
  }

  // Index captured decisions by decisionCode for O(N) total lookup.
  const decisionByCode = new Map<string, CapturedDecisionRefForCitationCheck>();
  for (const d of capturedDecisions) {
    decisionByCode.set(d.decisionCode, d);
  }

  const missingDecisionCodes: string[] = [];
  const seen = new Set<string>();
  for (const code of citedCodes) {
    if (seen.has(code)) continue; // dedupe repeat citations
    seen.add(code);
    const decision = decisionByCode.get(code);
    if (!decision) continue; // citation does not resolve -- out of scope
    const value = decision.answerValue;
    if (typeof value !== 'string' || value.length === 0) continue; // nothing verbatim to check
    if (!response.specText.includes(value)) {
      missingDecisionCodes.push(code);
    }
  }

  if (missingDecisionCodes.length === 0) {
    return { response, applied: false };
  }

  const warning: UnreferencedCitedDecisionWarning = {
    kind: 'captured_decision_value_not_in_spec_text',
    missingDecisionCodes,
    recommendedNextAction:
      'verify spec text references the cited decision values',
  };
  const augmented: GeneratedShapeSpecResponseA = {
    ...response,
    warnings: [...response.warnings, warning],
    // NB: confidence intentionally NOT downgraded -- N2 is a softer
    // warning-only signal per the spec.
  };
  return {
    response: augmented,
    applied: true,
  };
}
