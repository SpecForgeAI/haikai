/**
 * batchResolveConflictsSupport
 *
 * Spec 2026-06-23 Batch "Resolve Conflicts" Modal -- Task Group 1.
 *
 * Pure, React-free support module for the batch conflict-resolution modal. It
 * carries three concerns, all unit-testable in isolation:
 *
 *  1. A frontend-side mirror of the discovery-service source-authority ladder
 *     ({@link sourceLabelRank} / {@link classifySourceTier}) used to mark the
 *     "* most authoritative" option in a conflict row and to drive the
 *     "Use most authoritative source" helper.
 *  2. A `CandidateType -> human label` map ({@link candidateTypeLabel}) used for
 *     the modal's plain, non-collapsible type-group headers, with a title-case
 *     fallback for any unmapped / new token.
 *  3. The pure pre-selection helpers the modal calls when the reviewer clicks a
 *     "Resolve All" control ({@link selectMostAuthoritative} /
 *     {@link selectPreferredSource} / {@link markMostAuthoritative} /
 *     {@link presentSourceLabels}).
 *
 * CROSS-PACKAGE MIRROR (NO cross-import). The authority ladder and the
 * `CandidateType` union live in the `discovery-service` package, which the
 * frontend must NOT import from. The tier order, the contract-pack label set,
 * and the full `CandidateType` member list below are a HAND-MIRRORED COPY of:
 *
 *   - discovery-service `src/services/candidateIdentity.ts`
 *       `SOURCE_TIER_RANK` (~line 205), `CONTRACT_PACK_LABELS` (~line 226),
 *       `classifySourceTier` (~line 246)
 *   - discovery-service `src/types/candidate.ts`
 *       `CandidateType` union (~line 77)
 *
 * Keep these values in sync with those originals if they ever change.
 */

// ============================================================================
// (a) Source-authority ladder -- hand-mirror of discovery-service
//     candidateIdentity.ts (NO cross-import).
// ============================================================================

/**
 * The four contributing-source precedence tiers, most authoritative first.
 * Hand-mirror of `SourceTier` in candidateIdentity.ts (~line 195).
 */
export type SourceTier =
  | 'structural-framework-pack'
  | 'contract-pack'
  | 'runtime-evidence'
  | 'llm-gap-fill';

/**
 * Numeric rank for each tier -- LOWER is HIGHER precedence (rank 0 wins). Lets
 * callers compare two source labels with a single integer compare. Hand-mirror
 * of `SOURCE_TIER_RANK` in candidateIdentity.ts (~line 205).
 */
export const SOURCE_TIER_RANK: Record<SourceTier, number> = {
  'structural-framework-pack': 0,
  'contract-pack': 1,
  'runtime-evidence': 2,
  'llm-gap-fill': 3,
};

/**
 * Explicit source labels stamped by the merge for the two non-pack stages.
 * Hand-mirror of the corresponding constants in candidateIdentity.ts (~line 217).
 */
const RUNTIME_EVIDENCE_SOURCE_LABEL = 'runtime-evidence';
const LLM_GAP_FILL_SOURCE_LABEL = 'llm-gap-fill';

/**
 * Contract-pack `_addedBy` labels (WADL / XSD / SOAP). They emit a partial
 * contract view but are NOT a structural framework scan, so they sit below the
 * framework adapters and above runtime/LLM. Hand-mirror of `CONTRACT_PACK_LABELS`
 * in candidateIdentity.ts (~line 226).
 */
const CONTRACT_PACK_LABELS = new Set<string>([
  'rest-wadl-pack',
  'xsd-schema-pack',
  'spring-classic-soap',
  'spring-classic-soap-message',
  'spring-classic-soap-data-effect',
]);

/**
 * Classify a contributing source label into its precedence tier. Hand-mirror of
 * `classifySourceTier` in candidateIdentity.ts (~line 246).
 *
 * Rules (most specific first):
 *   - the two merge-stamped non-pack labels map to their explicit tiers;
 *   - the explicit contract-pack label set maps to `contract-pack`;
 *   - everything else (framework adapters, plus any UNKNOWN/new pack label) is a
 *     structural framework pack -- the HIGHEST tier and the safe default, since
 *     an unrecognised label is treated as a real framework scan rather than a
 *     contract / runtime / LLM guess.
 */
export function classifySourceTier(label: string | undefined | null): SourceTier {
  const l = (label ?? '').trim();
  if (l === RUNTIME_EVIDENCE_SOURCE_LABEL) return 'runtime-evidence';
  if (l === LLM_GAP_FILL_SOURCE_LABEL) return 'llm-gap-fill';
  if (CONTRACT_PACK_LABELS.has(l)) return 'contract-pack';
  return 'structural-framework-pack';
}

/**
 * Rank of a source label (LOWER wins). Convenience wrapper over
 * {@link classifySourceTier} + {@link SOURCE_TIER_RANK}. Hand-mirror of
 * `sourceLabelRank` in candidateIdentity.ts (~line 258). An unknown label
 * defaults to the structural-framework (most authoritative) tier, i.e. rank 0.
 */
export function sourceLabelRank(label: string | undefined | null): number {
  return SOURCE_TIER_RANK[classifySourceTier(label)];
}

// ============================================================================
// (b) CandidateType -> human label map.
//     Shape/style precedent: ./findingTypeLabels.ts.
//     Member list is a hand-mirror of the `CandidateType` union in
//     discovery-service src/types/candidate.ts (~line 77).
// ============================================================================

/**
 * Hand-curated friendly labels keyed by raw `CandidateType` token. Covers every
 * member of the discovery-service `CandidateType` union (a mix of entity AND
 * relationship types). {@link candidateTypeLabel} falls back gracefully for any
 * token missing here, so a new pipeline type still renders legibly -- but a
 * missing entry IS a hint that the new type should be documented here.
 */
export const CANDIDATE_TYPE_LABELS: Record<string, string> = {
  application: 'Applications',
  app_component: 'Application Components',
  service: 'Services',
  logical_data_entities: 'Logical Data Entities',
  logical_data_attributes: 'Logical Data Attributes',
  physical_data_entities: 'Physical Data Entities',
  physical_data_attributes: 'Physical Data Attributes',
  interfaces: 'Interfaces',
  business_process: 'Business Processes',
  business_logics: 'Business Logic',
  logical_data_entity_relationships: 'Logical Data Entity Relationships',
  interface_logical_entities: 'Interface Logical Entities',
  logical_data_entity_physical_data_entities: 'Logical-to-Physical Data Entities',
  logical_data_attribute_physical_data_attributes: 'Logical-to-Physical Data Attributes',
  endpoint_data_effects: 'Endpoint Data Effects',
  data_movements: 'Data Movements',
  data_entity: 'Data Entities',
  endpoints: 'Endpoints',
  class: 'Classes',
  method: 'Methods',
  ui_screens: 'UI Screens',
  ui_components: 'UI Components',
};

/**
 * Title-case a snake_case / hyphen-case token for use as a fallback label.
 * Splits on `_` and `-`, capitalises each word, and joins with a space. Empty /
 * non-string input returns an empty string. (Mirrors the helper in
 * findingTypeLabels.ts.)
 */
function titleCaseFromToken(raw: string): string {
  if (!raw || typeof raw !== 'string') return '';
  return raw
    .split(/[_-]+/)
    .filter((piece) => piece.length > 0)
    .map((piece) => piece.charAt(0).toUpperCase() + piece.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Return the friendly label for a `CandidateType`. Known types come from
 * {@link CANDIDATE_TYPE_LABELS}; unknown / new tokens are title-cased on the fly
 * so the UI never renders a raw `snake_case_type` to the reviewer.
 */
export function candidateTypeLabel(type: string | null | undefined): string {
  if (type == null) return '';
  const trimmed = String(type).trim();
  if (trimmed.length === 0) return '';
  const known = CANDIDATE_TYPE_LABELS[trimmed];
  if (known) return known;
  return titleCaseFromToken(trimmed);
}

// ============================================================================
// (c) Pure pre-selection helpers consumed by the batch modal.
//     No React. All selection maps are keyed by row identity (see rowKey).
// ============================================================================

/** One competing value for a conflicted attribute (mirrors `_conflicts[attr][]`). */
export interface ConflictRowOption {
  value: unknown;
  source: string;
}

/**
 * One conflict row in the batch modal = one conflicted attribute on one
 * candidate. The modal aggregates these across all candidates in the run.
 */
export interface ConflictRow {
  candidateId: string;
  candidateName: string;
  type: string;
  attr: string;
  options: ConflictRowOption[];
}

/**
 * A selection map keyed by row identity ({@link rowKey}). The value is the
 * chosen option index into that row's `options`. A row that is absent from the
 * map is UNSELECTED.
 */
export type BatchSelections = Record<string, number>;

/**
 * Stable identity for a conflict row = candidate id + conflicted attribute
 * (one row per conflicted attribute on a candidate). Used to key every
 * selection map so the modal and the commit loop agree on row identity.
 */
export function rowKey(row: Pick<ConflictRow, 'candidateId' | 'attr'>): string {
  return `${row.candidateId}::${row.attr}`;
}

/**
 * Index of the single most-authoritative option in a row (lowest source rank
 * wins). Ties within the same tier resolve to the FIRST option. Returns
 * `undefined` only for an empty `options` array. Pure; no React.
 */
export function markMostAuthoritative(row: ConflictRow): number | undefined {
  if (!row.options || row.options.length === 0) return undefined;
  let bestIndex = 0;
  let bestRank = sourceLabelRank(row.options[0].source);
  for (let i = 1; i < row.options.length; i += 1) {
    const rank = sourceLabelRank(row.options[i].source);
    // Strict `<` keeps the FIRST option on a tie within the same tier.
    if (rank < bestRank) {
      bestRank = rank;
      bestIndex = i;
    }
  }
  return bestIndex;
}

/**
 * Pre-select, on every row, the option from the highest-authority source
 * present (lowest source rank). Ties within a tier resolve to the FIRST option.
 * Rows with no options are left unselected (absent from the map).
 */
export function selectMostAuthoritative(rows: ConflictRow[]): BatchSelections {
  const out: BatchSelections = {};
  for (const row of rows) {
    const index = markMostAuthoritative(row);
    if (index !== undefined) {
      out[rowKey(row)] = index;
    }
  }
  return out;
}

/**
 * Pre-select the given source's option on every row where that source is
 * present; rows lacking the source stay UNSELECTED (absent from the map) so the
 * reviewer can see what is left to do. If a row carries the source more than
 * once, the FIRST matching option wins.
 */
export function selectPreferredSource(rows: ConflictRow[], source: string): BatchSelections {
  const out: BatchSelections = {};
  for (const row of rows) {
    const index = row.options.findIndex((opt) => opt.source === source);
    if (index >= 0) {
      out[rowKey(row)] = index;
    }
  }
  return out;
}

/**
 * The de-duplicated, authority-ranked list of source labels actually present
 * among the given rows. Drives the "Prefer a source..." dropdown so it lists
 * ONLY sources present. Within the same tier, labels keep their
 * first-encountered order (stable).
 */
export function presentSourceLabels(rows: ConflictRow[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const row of rows) {
    for (const opt of row.options) {
      if (!seen.has(opt.source)) {
        seen.add(opt.source);
        ordered.push(opt.source);
      }
    }
  }
  // Stable sort by authority rank (LOWER wins); ties keep first-seen order.
  return ordered
    .map((label, i) => ({ label, i, rank: sourceLabelRank(label) }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map((entry) => entry.label);
}
