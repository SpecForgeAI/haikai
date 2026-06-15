/**
 * MigrationDeliverySequencingResponse hand-rolled validator
 * (Spec 2026-05-25 PM Tasks Captured Decisions Integration + Delivery Sequencing).
 *
 * Validates the structured LLM response produced by the new
 * `product-manager--migration-delivery-sequencing` task. Hand-rolled per Q11
 * to mirror the convention established by
 * `specGenerationResponseValidator.ts` -- no JSON-schema library, same
 * `{ ok, value | errors }` return shape, same per-field error message style.
 *
 * The response shape has three variants keyed on `status`:
 *
 *   A. Sequenced:
 *      status === 'sequenced'
 *      required: initiativeOrder (non-empty array), confidence (high|medium|low),
 *                warnings (array of objects)
 *      hard rules (per Q13 of the requirements + Group 2 task brief):
 *        - every entry's `initiativeId` MUST exist in the supplied book of work
 *        - every entry of `parallelisableWith` MUST be a valid initiative id
 *          from the supplied book of work
 *        - every entry of `blockedBy` MUST be a valid initiative id from the
 *          supplied book of work
 *        - every `sequence` value MUST be a positive integer
 *        - `initiativeOrder` MUST be non-empty
 *      warning-only:
 *        - a cycle detected in the `blockedBy` graph emits a structured
 *          warning of shape `{ kind: 'sequencing_cycle', detail: '...' }` but
 *          status remains `'sequenced'`
 *
 *   B. InsufficientContext:
 *      status === 'insufficient_context'
 *      required: recommendedNextAction (non-empty string)
 *      The handler also writes this shape directly when runtime gating fires
 *      (no active target architecture / no captured decisions). The validator
 *      enforces structural correctness when the LLM emits this variant of its
 *      own accord.
 *
 *   C. Failed:
 *      status === 'failed'
 *      required: errorMessage (non-empty string)
 *
 * Public API:
 *   - `assertMigrationDeliverySequencingResponse(payload, bookOfWorkInitiativeIds)`
 *       returns `{ ok: true, value }` on success or
 *       `{ ok: false, errors: [...] }` on any hard failure with a list of
 *       human-readable error messages.
 *       The supplied `bookOfWorkInitiativeIds` parameter is the set of
 *       valid initiative ids the handler loaded from the book of work; the
 *       validator uses it to enforce the membership rules above. Cycle
 *       warnings are surfaced via the returned `value.warnings[]` array
 *       (additive -- the LLM's own warnings are preserved).
 */

// ---------------------------------------------------------------------------
// Enums + exported constant arrays
// ---------------------------------------------------------------------------

export const MIGRATION_DELIVERY_SEQUENCING_STATUS_VALUES = [
  'sequenced',
  'insufficient_context',
  'failed',
] as const;
export type MigrationDeliverySequencingStatus =
  (typeof MIGRATION_DELIVERY_SEQUENCING_STATUS_VALUES)[number];

export const MIGRATION_DELIVERY_SEQUENCING_CONFIDENCE_VALUES = [
  'high',
  'medium',
  'low',
] as const;
export type MigrationDeliverySequencingConfidence =
  (typeof MIGRATION_DELIVERY_SEQUENCING_CONFIDENCE_VALUES)[number];

// ---------------------------------------------------------------------------
// Typed shapes
// ---------------------------------------------------------------------------

export interface SequencingInitiativeOrderEntry {
  initiativeId: string;
  sequence: number;
  parallelisableWith: string[];
  blockedBy: string[];
  rationale: string;
}

export type SequencingWarningEntry = Record<string, unknown>;

export interface SequencedResponseA {
  status: 'sequenced';
  initiativeOrder: SequencingInitiativeOrderEntry[];
  confidence: MigrationDeliverySequencingConfidence;
  warnings: SequencingWarningEntry[];
  recommendedNextAction?: string;
}

export interface SequencingInsufficientContextResponseB {
  status: 'insufficient_context';
  recommendedNextAction: string;
  warnings?: SequencingWarningEntry[];
}

export interface SequencingFailedResponseC {
  status: 'failed';
  errorMessage: string;
}

export type MigrationDeliverySequencingResponse =
  | SequencedResponseA
  | SequencingInsufficientContextResponseB
  | SequencingFailedResponseC;

// ---------------------------------------------------------------------------
// Validation result types (mirror specGenerationResponseValidator.ts)
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

function isObjectArray(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.every((v) => isPlainObject(v));
}

function isPositiveInteger(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value > 0
  );
}

// ---------------------------------------------------------------------------
// Cycle detection (warning-only)
// ---------------------------------------------------------------------------

/**
 * Run a DFS over the `blockedBy` graph to detect cycles. Returns an array of
 * descriptive warning strings, one per detected cycle (de-duplicated by the
 * sorted node-set of the cycle). Exported so the handler tests can reuse the
 * same detection in isolation if needed.
 */
export function detectBlockedByCycles(
  entries: readonly SequencingInitiativeOrderEntry[]
): string[] {
  const adjacency = new Map<string, string[]>();
  for (const entry of entries) {
    adjacency.set(entry.initiativeId, [...entry.blockedBy]);
  }

  const cycles = new Set<string>();
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const colour = new Map<string, number>();
  for (const node of adjacency.keys()) colour.set(node, WHITE);

  const stack: string[] = [];

  const visit = (node: string): void => {
    colour.set(node, GRAY);
    stack.push(node);
    const neighbours = adjacency.get(node) ?? [];
    for (const next of neighbours) {
      // Ignore neighbours that are not nodes in our adjacency map -- the
      // membership-validation step already flagged them as hard fails.
      if (!adjacency.has(next)) continue;
      const c = colour.get(next) ?? WHITE;
      if (c === GRAY) {
        // Cycle found -- pull the slice from where `next` first appears in the
        // current DFS stack to the top.
        const cycleStart = stack.indexOf(next);
        if (cycleStart !== -1) {
          const cycle = stack.slice(cycleStart);
          const key = [...cycle].sort().join('|');
          cycles.add(`${cycle.join(' -> ')} -> ${next}`);
          void key;
        }
      } else if (c === WHITE) {
        visit(next);
      }
    }
    colour.set(node, BLACK);
    stack.pop();
  };

  for (const node of adjacency.keys()) {
    if ((colour.get(node) ?? WHITE) === WHITE) visit(node);
  }
  return Array.from(cycles);
}

// ---------------------------------------------------------------------------
// Branch validators
// ---------------------------------------------------------------------------

function validateSequencedBranch(
  obj: Record<string, unknown>,
  bookOfWorkInitiativeIds: ReadonlySet<string>
): ValidationResult<SequencedResponseA> {
  const errors: string[] = [];

  // confidence
  if (
    typeof obj.confidence !== 'string' ||
    !(MIGRATION_DELIVERY_SEQUENCING_CONFIDENCE_VALUES as readonly string[]).includes(
      obj.confidence as string
    )
  ) {
    errors.push(
      `sequenced.confidence must be one of: ${MIGRATION_DELIVERY_SEQUENCING_CONFIDENCE_VALUES.join(' | ')} (got ${JSON.stringify(obj.confidence)})`
    );
  }

  // warnings (LLM-emitted; cycle warnings appended by the validator below)
  if (obj.warnings !== undefined) {
    if (!Array.isArray(obj.warnings)) {
      errors.push('sequenced.warnings must be an array');
    } else if (!isObjectArray(obj.warnings)) {
      errors.push('sequenced.warnings must be an array of objects');
    }
  }

  // initiativeOrder (REQUIRED, non-empty)
  if (!Array.isArray(obj.initiativeOrder)) {
    errors.push('sequenced.initiativeOrder must be an array');
    return { ok: false, errors };
  }
  if ((obj.initiativeOrder as unknown[]).length === 0) {
    errors.push('sequenced.initiativeOrder must be a non-empty array when status="sequenced"');
  }

  const validatedEntries: SequencingInitiativeOrderEntry[] = [];
  const seenInitiativeIds = new Set<string>();
  const entries = obj.initiativeOrder as unknown[];
  for (let i = 0; i < entries.length; i++) {
    const raw = entries[i];
    if (!isPlainObject(raw)) {
      errors.push(`sequenced.initiativeOrder[${i}] must be an object`);
      continue;
    }
    const entry = raw;

    if (typeof entry.initiativeId !== 'string' || entry.initiativeId.length === 0) {
      errors.push(
        `sequenced.initiativeOrder[${i}].initiativeId must be a non-empty string`
      );
    } else if (!bookOfWorkInitiativeIds.has(entry.initiativeId)) {
      errors.push(
        `sequenced.initiativeOrder[${i}].initiativeId ${JSON.stringify(entry.initiativeId)} is not a valid initiative id from the supplied book of work`
      );
    } else {
      if (seenInitiativeIds.has(entry.initiativeId)) {
        errors.push(
          `sequenced.initiativeOrder[${i}].initiativeId ${JSON.stringify(entry.initiativeId)} appears more than once`
        );
      }
      seenInitiativeIds.add(entry.initiativeId);
    }

    if (!isPositiveInteger(entry.sequence)) {
      errors.push(
        `sequenced.initiativeOrder[${i}].sequence must be a positive integer (got ${JSON.stringify(entry.sequence)})`
      );
    }

    if (!isStringArray(entry.parallelisableWith)) {
      errors.push(
        `sequenced.initiativeOrder[${i}].parallelisableWith must be an array of strings`
      );
    } else {
      for (let j = 0; j < entry.parallelisableWith.length; j++) {
        const candidate = entry.parallelisableWith[j];
        if (!bookOfWorkInitiativeIds.has(candidate)) {
          errors.push(
            `sequenced.initiativeOrder[${i}].parallelisableWith[${j}] ${JSON.stringify(candidate)} is not a valid initiative id from the supplied book of work`
          );
        }
      }
    }

    if (!isStringArray(entry.blockedBy)) {
      errors.push(
        `sequenced.initiativeOrder[${i}].blockedBy must be an array of strings`
      );
    } else {
      for (let j = 0; j < entry.blockedBy.length; j++) {
        const candidate = entry.blockedBy[j];
        if (!bookOfWorkInitiativeIds.has(candidate)) {
          errors.push(
            `sequenced.initiativeOrder[${i}].blockedBy[${j}] ${JSON.stringify(candidate)} is not a valid initiative id from the supplied book of work`
          );
        }
      }
    }

    if (typeof entry.rationale !== 'string' || entry.rationale.length === 0) {
      errors.push(
        `sequenced.initiativeOrder[${i}].rationale must be a non-empty string`
      );
    }

    // Push a typed copy regardless of per-field failure -- callers that
    // receive `errors.length > 0` will ignore `validatedEntries`; callers in
    // the happy path get a well-formed array.
    validatedEntries.push({
      initiativeId: String(entry.initiativeId ?? ''),
      sequence: Number(entry.sequence ?? 0),
      parallelisableWith: Array.isArray(entry.parallelisableWith)
        ? (entry.parallelisableWith as unknown[]).map((v) => String(v))
        : [],
      blockedBy: Array.isArray(entry.blockedBy)
        ? (entry.blockedBy as unknown[]).map((v) => String(v))
        : [],
      rationale: typeof entry.rationale === 'string' ? entry.rationale : '',
    });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // Cycle detection -- warning only.
  const llmWarnings: SequencingWarningEntry[] = Array.isArray(obj.warnings)
    ? (obj.warnings as SequencingWarningEntry[])
    : [];
  const cycles = detectBlockedByCycles(validatedEntries);
  const augmentedWarnings: SequencingWarningEntry[] = [...llmWarnings];
  for (const cycleDetail of cycles) {
    augmentedWarnings.push({
      kind: 'sequencing_cycle',
      detail: cycleDetail,
    });
  }

  const value: SequencedResponseA = {
    status: 'sequenced',
    initiativeOrder: validatedEntries,
    confidence: obj.confidence as MigrationDeliverySequencingConfidence,
    warnings: augmentedWarnings,
    ...(typeof obj.recommendedNextAction === 'string' &&
    obj.recommendedNextAction.length > 0
      ? { recommendedNextAction: obj.recommendedNextAction as string }
      : {}),
  };
  return { ok: true, value };
}

function validateInsufficientContextBranch(
  obj: Record<string, unknown>
): ValidationResult<SequencingInsufficientContextResponseB> {
  const errors: string[] = [];

  if (
    typeof obj.recommendedNextAction !== 'string' ||
    obj.recommendedNextAction.length === 0
  ) {
    errors.push(
      'insufficient_context.recommendedNextAction must be a non-empty string'
    );
  }

  if (obj.warnings !== undefined) {
    if (!Array.isArray(obj.warnings)) {
      errors.push('insufficient_context.warnings must be an array');
    } else if (!isObjectArray(obj.warnings)) {
      errors.push('insufficient_context.warnings must be an array of objects');
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  const value: SequencingInsufficientContextResponseB = {
    status: 'insufficient_context',
    recommendedNextAction: obj.recommendedNextAction as string,
    ...(Array.isArray(obj.warnings)
      ? { warnings: obj.warnings as SequencingWarningEntry[] }
      : {}),
  };
  return { ok: true, value };
}

function validateFailedBranch(
  obj: Record<string, unknown>
): ValidationResult<SequencingFailedResponseC> {
  const errors: string[] = [];
  if (typeof obj.errorMessage !== 'string' || obj.errorMessage.length === 0) {
    errors.push('failed.errorMessage must be a non-empty string');
  }
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      status: 'failed',
      errorMessage: obj.errorMessage as string,
    },
  };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Validates a candidate `MigrationDeliverySequencingResponse` payload
 * (already-parsed JS object) against the three-variant schema.
 *
 * Branches on `payload.status`:
 *   - 'sequenced'             -> Sequenced branch
 *   - 'insufficient_context'  -> InsufficientContext branch
 *   - 'failed'                -> Failed branch
 *   - anything else           -> top-level error
 *
 * `bookOfWorkInitiativeIds` is the set of valid initiative ids the handler
 * loaded from the book of work; the validator enforces membership rules for
 * `initiativeId`, `parallelisableWith[]`, and `blockedBy[]` against this set.
 * Pass an empty set when validating a non-sequenced branch (the validator
 * will only consult the set for the sequenced branch).
 *
 * @param payload                    the parsed JS object to validate
 * @param bookOfWorkInitiativeIds    the set of valid initiative ids
 * @returns                          a {@link ValidationResult} that callers can branch on
 */
export function assertMigrationDeliverySequencingResponse(
  payload: unknown,
  bookOfWorkInitiativeIds: ReadonlySet<string>
): ValidationResult<MigrationDeliverySequencingResponse> {
  if (!isPlainObject(payload)) {
    return { ok: false, errors: ['Payload is not a JSON object'] };
  }

  const obj = payload as Record<string, unknown>;

  if (
    typeof obj.status !== 'string' ||
    !(MIGRATION_DELIVERY_SEQUENCING_STATUS_VALUES as readonly string[]).includes(
      obj.status as string
    )
  ) {
    return {
      ok: false,
      errors: [
        `status must be one of: ${MIGRATION_DELIVERY_SEQUENCING_STATUS_VALUES.join(' | ')} (got ${JSON.stringify(obj.status)})`,
      ],
    };
  }

  const status = obj.status as MigrationDeliverySequencingStatus;

  if (status === 'sequenced') {
    return validateSequencedBranch(obj, bookOfWorkInitiativeIds);
  }
  if (status === 'insufficient_context') {
    return validateInsufficientContextBranch(obj);
  }
  if (status === 'failed') {
    return validateFailedBranch(obj);
  }

  // Defensive -- unreachable because we narrowed against the enum above.
  return {
    ok: false,
    errors: [`Unrecognised status value: ${JSON.stringify(status)}`],
  };
}
