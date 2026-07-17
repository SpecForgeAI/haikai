/**
 * GeneratedMigrationBookOfWork structured response schema + validator.
 *
 * Spec: 2026-05-17 PM Migration Delivery Plan + Draft Book-of-Work Generation
 * Task Group 5: Structured Response Schema + Validation.
 *
 * This module defines the typed shape of the structured LLM response produced
 * by the `product-manager--migration-delivery-plan` task, plus a hand-rolled
 * validator that enforces:
 *
 *   - the six required top-level fields (`title`, `summary`, `generationInputs`,
 *     `generationSummary`, `qualityAssessment`, `items`);
 *   - per-item required fields and enum vocabularies:
 *       - `type` ∈ initiative | epic | feature | story
 *       - `workstream` ∈ 14 values including the `unknown` sentinel (Q-7)
 *       - `confidence` ∈ high | medium | low
 *       - `readiness` ∈ ready_for_spec | needs_focused_context |
 *                       needs_user_decision | blocked
 *       - optional `saveState` ∈ draft | selected | excluded | saved | failed (Q-16)
 *   - hierarchy integrity (`validateBookOfWorkHierarchy`):
 *       - no orphaned `parentId` references;
 *       - parent-child type sequences are valid
 *         (initiative -> epic -> feature -> story; no skipped levels);
 *       - no cycles in the parent chain.
 *
 * The gateway orchestration handler runs validation BEFORE any AMS write so
 * malformed hierarchies are rejected at gateway time and never persisted.
 *
 * Validator style mirrors `productManagerResponseValidator.ts` and
 * `plannerResponseValidator.ts` — hand-rolled checks, no Zod/Ajv dependency
 * (gateway has no schema library in its package.json).
 */

import { extractJson } from './plannerResponseValidator';
import { logger } from './logger';

// ---------------------------------------------------------------------------
// Enum vocabularies
// ---------------------------------------------------------------------------

export const MIGRATION_BOOK_OF_WORK_ITEM_TYPES = [
  'initiative',
  'epic',
  'feature',
  'story',
] as const;
export type MigrationBookOfWorkItemType =
  (typeof MIGRATION_BOOK_OF_WORK_ITEM_TYPES)[number];

/**
 * Canonical workstream vocabulary (Spec V, 2026-07-17 — plane-based streams).
 * Grouped by plane: REST + SOAP are ONE generic `api_migration`; reconciles are
 * per-plane (`data_parity_reconciliation_reporting`, `api_reconciliation_reporting`);
 * tests are peppered into build stories (no separate `migration_test_pack`).
 * The `unknown` sentinel is used ONLY when no other workstream applies; the
 * review-workspace filter surfaces `unknown` items so reviewers reclassify them.
 *
 * The 4 pre-reframe values are RETAINED for validation only (see
 * DEPRECATED_MIGRATION_BOOK_OF_WORK_WORKSTREAMS) so plans generated before the
 * reframe still validate; the planner / prompt / wizard no longer emit them.
 */
export const MIGRATION_BOOK_OF_WORK_WORKSTREAMS = [
  // Persistence plane
  'target_database_schema_implementation',
  'data_migration',
  'data_parity_reconciliation_reporting',
  // Service plane (REST + SOAP merged; internal = non-HTTP entrypoints)
  'api_migration',
  'internal_processing_implementation',
  'api_reconciliation_reporting',
  // UI plane
  'target_frontend_implementation',
  // Optional / cross-cutting
  'target_infrastructure_environment_implementation',
  'cutover_rollback_decommission',
  'architecture_refinement',
  'discovery_gap_resolution',
  'test_strategy',
  'other',
  'unknown',
] as const;
export type MigrationBookOfWorkWorkstream =
  (typeof MIGRATION_BOOK_OF_WORK_WORKSTREAMS)[number];

/**
 * Pre-reframe workstream values, retained for BACKWARD-COMPATIBLE VALIDATION
 * only (plans persisted before Spec V). Never emitted by current code:
 *   target_service_api_implementation, api_soap_integration_compatibility
 *     -> api_migration
 *   migration_test_pack       -> tests peppered into build-story specs
 *   reconciliation_reporting  -> data_parity_reconciliation_reporting +
 *                                api_reconciliation_reporting
 */
export const DEPRECATED_MIGRATION_BOOK_OF_WORK_WORKSTREAMS = [
  'target_service_api_implementation',
  'api_soap_integration_compatibility',
  'migration_test_pack',
  'reconciliation_reporting',
] as const;

/** All workstream tokens the validator accepts (canonical ∪ retained). */
const ACCEPTED_WORKSTREAMS: ReadonlySet<string> = new Set<string>([
  ...MIGRATION_BOOK_OF_WORK_WORKSTREAMS,
  ...DEPRECATED_MIGRATION_BOOK_OF_WORK_WORKSTREAMS,
]);

export const MIGRATION_BOOK_OF_WORK_CONFIDENCES = [
  'high',
  'medium',
  'low',
] as const;
export type MigrationBookOfWorkConfidence =
  (typeof MIGRATION_BOOK_OF_WORK_CONFIDENCES)[number];

export const MIGRATION_BOOK_OF_WORK_READINESS_VALUES = [
  'ready_for_spec',
  'needs_focused_context',
  'needs_user_decision',
  'blocked',
] as const;
export type MigrationBookOfWorkReadiness =
  (typeof MIGRATION_BOOK_OF_WORK_READINESS_VALUES)[number];

export const MIGRATION_BOOK_OF_WORK_SAVE_STATES = [
  'draft',
  'selected',
  'excluded',
  'saved',
  'failed',
] as const;
export type MigrationBookOfWorkSaveState =
  (typeof MIGRATION_BOOK_OF_WORK_SAVE_STATES)[number];

/**
 * Per-epic phase-2 expansion states (Spec 2026-06-11 Two-Phase Migration
 * Delivery Plan Generation, Task Group 3.3).
 *
 * This is THE single shared JSON shape for expansion state across the whole
 * feature: it rides as an `expansionState` field ON the epic item inside
 * `book_of_work_json.items[]` (NO new AMS column, NO new `chk_gmbw_status`
 * value — zero Liquibase change). The AMS `items/append` merge endpoint
 * (`AppendGeneratedMigrationBookOfWorkItemsRequest`) reads/writes the SAME
 * vocabulary, and the frontend types mirror it. Define once, import everywhere.
 *
 *   not_expanded — seeded on every epic by the phase-1 skeleton write.
 *   expanding    — the epic's phase-2 pipeline is in flight.
 *   expanded     — stories appended; TERMINAL (never re-expanded).
 *   failed       — pipeline failed after retry; RETRYABLE (re-runs only this
 *                  epic). Stale `expanding` (gateway restarted mid-expansion)
 *                  is also treated as retryable.
 */
export const MIGRATION_BOOK_OF_WORK_EXPANSION_STATES = [
  'not_expanded',
  'expanding',
  'expanded',
  'failed',
] as const;
export type MigrationBookOfWorkExpansionState =
  (typeof MIGRATION_BOOK_OF_WORK_EXPANSION_STATES)[number];

// ---------------------------------------------------------------------------
// Typed shapes
// ---------------------------------------------------------------------------

export interface MigrationBookOfWorkItem {
  id: string;
  type: MigrationBookOfWorkItemType;
  parentId: string | null;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  workstream: MigrationBookOfWorkWorkstream;
  sequenceOrder: number;
  tags: string[];
  confidence: MigrationBookOfWorkConfidence;
  readiness: MigrationBookOfWorkReadiness;
  readinessReasons: string[];
  missingInputs: string[];
  recommendedNextAction: string;
  traceabilitySummary: string;
  evidenceReferences?: string[];
  architectureReferences?: string[];
  apiBaselineReferences?: string[];
  discoveryFindingReferences?: string[];
  mappingReferences?: string[];
  sourceContextRefs?: string[];
  saveState?: MigrationBookOfWorkSaveState;
  /**
   * Phase-2 expansion state — present ONLY on `epic` items (Spec 2026-06-11
   * Two-Phase generation). Seeded `not_expanded` by the phase-1 skeleton;
   * merged server-side by the AMS `items/append` endpoint thereafter.
   */
  expansionState?: MigrationBookOfWorkExpansionState;
  workItemId?: string | null;
  errorMessage?: string | null;
}

export interface GeneratedMigrationBookOfWork {
  title: string;
  summary: string;
  generationInputs: Record<string, unknown>;
  generationSummary: Record<string, unknown>;
  qualityAssessment: Record<string, unknown>;
  items: MigrationBookOfWorkItem[];
}

// ---------------------------------------------------------------------------
// Validation result types
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

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value)
  );
}

/**
 * Parent-child type permitted by the hierarchy rules. A child of `type` is only
 * legal when seated under a parent of one of the types listed here.
 *
 *   initiative -> root only (parentId MUST be null)
 *   epic       -> parent MUST be an initiative
 *   feature    -> parent MUST be an epic
 *   story      -> parent MUST be a feature
 */
const ALLOWED_PARENT_TYPE: Record<
  MigrationBookOfWorkItemType,
  ReadonlySet<MigrationBookOfWorkItemType> | null
> = {
  initiative: null, // null parentId only
  epic: new Set(['initiative']),
  feature: new Set(['epic']),
  story: new Set(['feature']),
};

// ---------------------------------------------------------------------------
// Hierarchy validator (exported for reuse by the orchestration handler)
// ---------------------------------------------------------------------------

/**
 * Validates the parent-child hierarchy of a flat array of items.
 *
 * Checks:
 *   1. Every non-null `parentId` resolves to an existing item id (no orphans).
 *   2. The parent's `type` is the legal parent of this item's `type`:
 *        initiative.parentId === null
 *        epic.parent       === initiative
 *        feature.parent    === epic
 *        story.parent      === feature
 *      (no skipped levels and no level-jumping like initiative-under-story).
 *   3. There are no cycles in the parent chain.
 *
 * Returns `{ ok: true, value: items }` on success, or a list of human-readable
 * error messages on failure.
 */
export function validateBookOfWorkHierarchy(
  items: MigrationBookOfWorkItem[]
): ValidationResult<MigrationBookOfWorkItem[]> {
  const errors: string[] = [];

  // Build id -> item index
  const byId = new Map<string, MigrationBookOfWorkItem>();
  for (const item of items) {
    if (byId.has(item.id)) {
      errors.push(`Duplicate item id "${item.id}"`);
    }
    byId.set(item.id, item);
  }

  // Per-item parent checks
  for (const item of items) {
    const allowed = ALLOWED_PARENT_TYPE[item.type];

    if (allowed === null) {
      // initiative — parentId MUST be null
      if (item.parentId !== null) {
        errors.push(
          `Item "${item.id}" of type "${item.type}" must have parentId=null (got "${item.parentId}")`
        );
      }
      continue;
    }

    // For epic / feature / story, parentId MUST be non-null
    if (item.parentId === null || item.parentId === undefined) {
      errors.push(
        `Item "${item.id}" of type "${item.type}" must have a non-null parentId`
      );
      continue;
    }

    const parent = byId.get(item.parentId);
    if (!parent) {
      errors.push(
        `Item "${item.id}" has orphaned parentId "${item.parentId}" (no item with that id)`
      );
      continue;
    }

    if (!allowed.has(parent.type)) {
      errors.push(
        `Item "${item.id}" of type "${item.type}" has parent "${parent.id}" of type ` +
          `"${parent.type}"; expected parent type one of: ${[...allowed].join(', ')}`
      );
    }
  }

  // Cycle detection — walk each item's parent chain. With the type rules above
  // a cycle is structurally impossible (initiative.parent=null), but we still
  // defend against id-level cycles in case the type rule is bypassed by a
  // malformed payload that wasn't caught above (e.g. an epic whose parent id
  // is its own id).
  const CYCLE_LIMIT = items.length + 2;
  for (const item of items) {
    const seen = new Set<string>([item.id]);
    let cursor: MigrationBookOfWorkItem | undefined = item;
    let hops = 0;
    while (cursor && cursor.parentId !== null && cursor.parentId !== undefined) {
      hops += 1;
      if (hops > CYCLE_LIMIT) {
        errors.push(
          `Cycle detected in parent chain starting at item "${item.id}"`
        );
        break;
      }
      const next: MigrationBookOfWorkItem | undefined = byId.get(cursor.parentId);
      if (!next) {
        // Already reported above as orphan; stop walking.
        break;
      }
      if (seen.has(next.id)) {
        errors.push(
          `Cycle detected in parent chain starting at item "${item.id}" (revisits "${next.id}")`
        );
        break;
      }
      seen.add(next.id);
      cursor = next;
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, value: items };
}

// ---------------------------------------------------------------------------
// Item validator
// ---------------------------------------------------------------------------

function validateItem(
  raw: unknown,
  index: number
): ValidationResult<MigrationBookOfWorkItem> {
  const errors: string[] = [];

  if (!isPlainObject(raw)) {
    return {
      ok: false,
      errors: [`items[${index}] is not an object`],
    };
  }

  const obj = raw as Record<string, unknown>;

  // id
  if (typeof obj.id !== 'string' || obj.id.length === 0) {
    errors.push(`items[${index}].id must be a non-empty string`);
  }

  // type
  if (
    typeof obj.type !== 'string' ||
    !(MIGRATION_BOOK_OF_WORK_ITEM_TYPES as readonly string[]).includes(
      obj.type as string
    )
  ) {
    errors.push(
      `items[${index}].type must be one of: ${MIGRATION_BOOK_OF_WORK_ITEM_TYPES.join(' | ')} (got ${JSON.stringify(obj.type)})`
    );
  }

  // parentId
  if (obj.parentId !== null && typeof obj.parentId !== 'string') {
    errors.push(`items[${index}].parentId must be a string or null`);
  }

  // title
  if (typeof obj.title !== 'string' || obj.title.length === 0) {
    errors.push(`items[${index}].title must be a non-empty string`);
  }

  // description
  if (typeof obj.description !== 'string') {
    errors.push(`items[${index}].description must be a string`);
  }

  // acceptanceCriteria
  if (!isStringArray(obj.acceptanceCriteria)) {
    errors.push(`items[${index}].acceptanceCriteria must be an array of strings`);
  }

  // workstream (canonical plane-based vocabulary or a retained pre-reframe value)
  if (
    typeof obj.workstream !== 'string' ||
    !ACCEPTED_WORKSTREAMS.has(obj.workstream as string)
  ) {
    errors.push(
      `items[${index}].workstream must be one of the canonical plane-based values (Spec V) or a retained pre-reframe value (got ${JSON.stringify(obj.workstream)})`
    );
  }

  // sequenceOrder
  if (
    typeof obj.sequenceOrder !== 'number' ||
    !Number.isInteger(obj.sequenceOrder)
  ) {
    errors.push(`items[${index}].sequenceOrder must be an integer`);
  }

  // tags
  if (!isStringArray(obj.tags)) {
    errors.push(`items[${index}].tags must be an array of strings`);
  }

  // confidence
  if (
    typeof obj.confidence !== 'string' ||
    !(MIGRATION_BOOK_OF_WORK_CONFIDENCES as readonly string[]).includes(
      obj.confidence as string
    )
  ) {
    errors.push(
      `items[${index}].confidence must be one of: ${MIGRATION_BOOK_OF_WORK_CONFIDENCES.join(' | ')} (got ${JSON.stringify(obj.confidence)})`
    );
  }

  // readiness
  if (
    typeof obj.readiness !== 'string' ||
    !(MIGRATION_BOOK_OF_WORK_READINESS_VALUES as readonly string[]).includes(
      obj.readiness as string
    )
  ) {
    errors.push(
      `items[${index}].readiness must be one of: ${MIGRATION_BOOK_OF_WORK_READINESS_VALUES.join(' | ')} (got ${JSON.stringify(obj.readiness)})`
    );
  }

  // readinessReasons
  if (!isStringArray(obj.readinessReasons)) {
    errors.push(`items[${index}].readinessReasons must be an array of strings`);
  }

  // missingInputs
  if (!isStringArray(obj.missingInputs)) {
    errors.push(`items[${index}].missingInputs must be an array of strings`);
  }

  // recommendedNextAction
  if (typeof obj.recommendedNextAction !== 'string') {
    errors.push(`items[${index}].recommendedNextAction must be a string`);
  }

  // traceabilitySummary
  if (typeof obj.traceabilitySummary !== 'string') {
    errors.push(`items[${index}].traceabilitySummary must be a string`);
  }

  // Optional reference arrays — if present, must be string arrays
  for (const refKey of [
    'evidenceReferences',
    'architectureReferences',
    'apiBaselineReferences',
    'discoveryFindingReferences',
    'mappingReferences',
    'sourceContextRefs',
  ] as const) {
    if (obj[refKey] !== undefined && !isStringArray(obj[refKey])) {
      errors.push(`items[${index}].${refKey} must be an array of strings when present`);
    }
  }

  // Optional saveState (Q-16)
  if (obj.saveState !== undefined) {
    if (
      typeof obj.saveState !== 'string' ||
      !(MIGRATION_BOOK_OF_WORK_SAVE_STATES as readonly string[]).includes(
        obj.saveState as string
      )
    ) {
      errors.push(
        `items[${index}].saveState (when present) must be one of: ${MIGRATION_BOOK_OF_WORK_SAVE_STATES.join(' | ')} (got ${JSON.stringify(obj.saveState)})`
      );
    }
  }

  // Optional expansionState (Spec 2026-06-11 Two-Phase generation)
  if (obj.expansionState !== undefined) {
    if (
      typeof obj.expansionState !== 'string' ||
      !(MIGRATION_BOOK_OF_WORK_EXPANSION_STATES as readonly string[]).includes(
        obj.expansionState as string
      )
    ) {
      errors.push(
        `items[${index}].expansionState (when present) must be one of: ${MIGRATION_BOOK_OF_WORK_EXPANSION_STATES.join(' | ')} (got ${JSON.stringify(obj.expansionState)})`
      );
    }
  }

  // Optional workItemId / errorMessage
  if (
    obj.workItemId !== undefined &&
    obj.workItemId !== null &&
    typeof obj.workItemId !== 'string'
  ) {
    errors.push(`items[${index}].workItemId (when present) must be a string or null`);
  }
  if (
    obj.errorMessage !== undefined &&
    obj.errorMessage !== null &&
    typeof obj.errorMessage !== 'string'
  ) {
    errors.push(`items[${index}].errorMessage (when present) must be a string or null`);
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: obj as unknown as MigrationBookOfWorkItem,
  };
}

// ---------------------------------------------------------------------------
// Exported per-item validator + skeleton expansion-state seeding
// (Spec 2026-06-11 Two-Phase Migration Delivery Plan Generation)
// ---------------------------------------------------------------------------

/**
 * Validates ONE candidate `MigrationBookOfWorkItem` (already-parsed JS object).
 * Exported for the phase-2 expansion pipeline, which must validate every
 * expanded story against the item schema BEFORE the atomic per-epic append.
 */
export function validateMigrationBookOfWorkItem(
  raw: unknown,
  index = 0
): ValidationResult<MigrationBookOfWorkItem> {
  return validateItem(raw, index);
}

/**
 * Stamps `expansionState: 'not_expanded'` on every epic that does not already
 * carry an expansion state. Run by the phase-1 skeleton path AFTER assembly
 * and BEFORE the atomic AMS create write, so the persisted draft document is
 * the single source of truth for the phase-2 state machine from the start.
 * Non-epic items are returned untouched.
 */
export function seedEpicExpansionStates(
  items: MigrationBookOfWorkItem[]
): MigrationBookOfWorkItem[] {
  return items.map((item) =>
    item.type === 'epic' && item.expansionState === undefined
      ? { ...item, expansionState: 'not_expanded' }
      : item
  );
}

// ---------------------------------------------------------------------------
// Top-level validator
// ---------------------------------------------------------------------------

/**
 * Validates a candidate `GeneratedMigrationBookOfWork` payload (already-parsed
 * JS object, NOT a raw LLM string — use `validateMigrationBookOfWorkFromContent`
 * for the raw-LLM-content variant).
 *
 * Checks the six required top-level fields, each item's required fields and
 * enum vocabularies, and the parent-child hierarchy (orphans, type sequences,
 * cycles). Returns `{ ok: true, value }` on success or `{ ok: false, errors }`
 * with a list of human-readable error messages on failure.
 */
export function validateMigrationBookOfWork(
  payload: unknown
): ValidationResult<GeneratedMigrationBookOfWork> {
  const errors: string[] = [];

  if (!isPlainObject(payload)) {
    return { ok: false, errors: ['Payload is not a JSON object'] };
  }

  const obj = payload as Record<string, unknown>;

  if (typeof obj.title !== 'string' || obj.title.length === 0) {
    errors.push('title must be a non-empty string');
  }
  if (typeof obj.summary !== 'string') {
    errors.push('summary must be a string');
  }
  if (!isPlainObject(obj.generationInputs)) {
    errors.push('generationInputs must be an object');
  }
  if (!isPlainObject(obj.generationSummary)) {
    errors.push('generationSummary must be an object');
  }
  if (!isPlainObject(obj.qualityAssessment)) {
    errors.push('qualityAssessment must be an object');
  }
  if (!Array.isArray(obj.items)) {
    errors.push('items must be an array');
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // Validate each item
  const validatedItems: MigrationBookOfWorkItem[] = [];
  const items = obj.items as unknown[];
  for (let i = 0; i < items.length; i++) {
    const result = validateItem(items[i], i);
    if (!result.ok) {
      errors.push(...result.errors);
    } else {
      validatedItems.push(result.value);
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // Hierarchy validation — only meaningful when every item passed structural
  // validation (otherwise we'd report cascade errors on a broken item array).
  const hierarchy = validateBookOfWorkHierarchy(validatedItems);
  if (!hierarchy.ok) {
    return { ok: false, errors: hierarchy.errors };
  }

  const value: GeneratedMigrationBookOfWork = {
    title: obj.title as string,
    summary: obj.summary as string,
    generationInputs: obj.generationInputs as Record<string, unknown>,
    generationSummary: obj.generationSummary as Record<string, unknown>,
    qualityAssessment: obj.qualityAssessment as Record<string, unknown>,
    items: validatedItems,
  };

  return { ok: true, value };
}

/**
 * Validates a raw LLM response string by first extracting embedded JSON via
 * the existing `extractJson` helper (reused from `plannerResponseValidator`),
 * parsing it, and then running structural + hierarchy validation.
 *
 * On any failure, logs a single warning (matching the
 * `productManagerResponseValidator` precedent) and returns the failure result.
 */
export function validateMigrationBookOfWorkFromContent(
  content: string
): ValidationResult<GeneratedMigrationBookOfWork> {
  const jsonStr = extractJson(content);
  if (!jsonStr) {
    const error = 'No JSON found in LLM response';
    logFailure(error, content);
    return { ok: false, errors: [error] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    const error = `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`;
    logFailure(error, content);
    return { ok: false, errors: [error] };
  }

  const result = validateMigrationBookOfWork(parsed);
  if (!result.ok) {
    logFailure(result.errors.join('; '), content);
  }
  return result;
}

function logFailure(error: string, content: string): void {
  logger.warn('GeneratedMigrationBookOfWork validation failed', {
    event: 'generated_migration_book_of_work_validation_failed',
    error,
    rawContentPreview: content.substring(0, 300),
  });
}
