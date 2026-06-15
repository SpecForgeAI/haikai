/**
 * Mapping Mutation Rules Config — Target State Architect-Persona Conversation (Spec 3, Commit 1)
 *
 * Spec: 2026-05-24-target-state-architect-conversation
 *
 * Deterministic, decision-code-keyed rules driving what the AMS
 * `apply-mapping-mutations` endpoint does after a captured decision is written.
 *
 * Per F2 (spec §"Mapping mutation rules config"):
 * - `db.engine`: tables = physical_data_entity, physical_data_attribute,
 *   data_entity_points; change = keep-equivalent; decorate notes.
 * - `api.protocol` (SOAP → REST): tables = interface, endpoint;
 *   change = replaced_by; decorate notes.
 * - `service.framework`: tables = service; change = keep-equivalent;
 *   decorate notes.
 * - `service.language`: tables = method, class; change = keep-equivalent;
 *   decorate notes.
 * - All other decision codes: notes decoration only, no `mapping_type` change.
 *
 * Scope boundary is always parent-not-leaf per Q15; per-element exceptions
 * narrow to a single row at orchestration time (not here).
 *
 * IMPORTANT: This is config only. The actual mutations happen on the AMS side
 * in Commit 4. This file is consumed by the gateway in Commit 4 to forward the
 * rule subset for a given decision code to the new AMS endpoint.
 */

import { QUESTION_LIBRARY, QuestionLibraryEntry } from './questionLibrary';

// ---------------------------------------------------------------------------
// Affected table names (supertype identifiers)
//
// These are the entity supertype tables the AMS endpoint reads when assembling
// the affected mapping set. They mirror the closed scope_ref_type set with the
// addition of `data_entity_points` (a join-side table, not a scope_ref_type
// value — included here because db.engine touches it too per the spec).
// ---------------------------------------------------------------------------

export type AffectedTableName =
  | 'service'
  | 'interface'
  | 'endpoint'
  | 'physical_data_entity'
  | 'physical_data_attribute'
  | 'data_entity_points'
  | 'method'
  | 'class';

// ---------------------------------------------------------------------------
// Allowed mapping_type change kinds
// ---------------------------------------------------------------------------

/**
 * Closed set of `mapping_type` changes the rules can request.
 * - `none`: notes-only decoration; do not touch mapping_type.
 * - `keep-equivalent`: explicitly keep mapping_type=`equivalent` (idempotent).
 * - `replaced_by`: mapping_type → `replaced_by`.
 * - `renamed`: mapping_type → `renamed`.
 * - `merged`: mapping_type → `merged`.
 * - `split`: mapping_type → `split`.
 */
export type MappingTypeChange =
  | 'none'
  | 'keep-equivalent'
  | 'replaced_by'
  | 'renamed'
  | 'merged'
  | 'split';

// ---------------------------------------------------------------------------
// Scope boundary kind (per Q15)
// ---------------------------------------------------------------------------

/**
 * Always `parent-not-leaf` in v1 per Q15. Per-element exceptions are handled at
 * orchestration time (narrowing to a single row); they do not change the rule.
 */
export type ScopeBoundary = 'parent-not-leaf';

// ---------------------------------------------------------------------------
// Rule shape (per F2)
// ---------------------------------------------------------------------------

export interface MappingMutationRule {
  /**
   * The list of supertype tables whose mappings this decision affects.
   * Empty array means notes-only decoration (no row reads beyond the row
   * already targeted by the decoration helper).
   */
  affectedTableSets: readonly AffectedTableName[];
  /** The default `mapping_type` change to apply, or `none`. */
  defaultMappingTypeChange: MappingTypeChange;
  /** Always `parent-not-leaf` in v1 per Q15. */
  scopeBoundary: ScopeBoundary;
}

export type MappingMutationRules = Readonly<Record<string, MappingMutationRule>>;

// ---------------------------------------------------------------------------
// v1 rules — exactly the 4 mutation cases + notes-only for the other 47 codes
// ---------------------------------------------------------------------------

/**
 * The 4 mutation cases per spec §"Mapping mutation rules config" v1 rules.
 * All other decision codes fall through to a notes-only entry built below.
 */
const MUTATION_CASE_RULES: Record<string, MappingMutationRule> = {
  'db.engine': {
    affectedTableSets: [
      'physical_data_entity',
      'physical_data_attribute',
      'data_entity_points',
    ],
    defaultMappingTypeChange: 'keep-equivalent',
    scopeBoundary: 'parent-not-leaf',
  },
  'api.protocol': {
    affectedTableSets: ['interface', 'endpoint'],
    defaultMappingTypeChange: 'replaced_by',
    scopeBoundary: 'parent-not-leaf',
  },
  'service.framework': {
    affectedTableSets: ['service'],
    defaultMappingTypeChange: 'keep-equivalent',
    scopeBoundary: 'parent-not-leaf',
  },
  'service.language': {
    affectedTableSets: ['method', 'class'],
    defaultMappingTypeChange: 'keep-equivalent',
    scopeBoundary: 'parent-not-leaf',
  },
};

/**
 * Notes-only fallback rule used for every decision code not in
 * `MUTATION_CASE_RULES`. Per spec: "All other decision codes: notes decoration
 * only, no `mapping_type` change."
 */
const NOTES_ONLY_RULE: MappingMutationRule = {
  affectedTableSets: [],
  defaultMappingTypeChange: 'none',
  scopeBoundary: 'parent-not-leaf',
};

/**
 * Build the full rules map by walking the question library and assigning each
 * code either its mutation-case rule or the notes-only fallback.
 *
 * Keeping the source-of-truth as a build step (rather than hand-typing all 51
 * keys) guarantees the rules map always covers every code in the library —
 * the validator in `loadConfigs.ts` enforces this in both directions.
 */
function buildMappingMutationRules(
  library: readonly QuestionLibraryEntry[]
): MappingMutationRules {
  const rules: Record<string, MappingMutationRule> = {};
  for (const entry of library) {
    if (Object.prototype.hasOwnProperty.call(MUTATION_CASE_RULES, entry.code)) {
      rules[entry.code] = MUTATION_CASE_RULES[entry.code];
    } else {
      rules[entry.code] = NOTES_ONLY_RULE;
    }
  }
  return Object.freeze(rules);
}

export const MAPPING_MUTATION_RULES: MappingMutationRules =
  buildMappingMutationRules(QUESTION_LIBRARY);

/**
 * Exported for tests + the validator in `loadConfigs.ts`.
 * Set of decision codes that have a non-notes-only mutation rule in v1.
 */
export const V1_MUTATION_CASE_CODES: readonly string[] = Object.keys(
  MUTATION_CASE_RULES
);
