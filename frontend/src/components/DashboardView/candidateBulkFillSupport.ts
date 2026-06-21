/**
 * candidateBulkFillSupport
 *
 * Spec: Skipped-candidate visibility + grouped bulk-fill (C1) for discovery
 * save-back (2026-06-20) -- Task Group 7.
 *
 * Pure helpers backing the C1 group-by-missing-field remediation panel:
 *   - `groupAffectedCandidates` folds the save-back REASON ARM (`reasons[]`)
 *     into GROUPS keyed by the specific missing/blocking field, PLUS a dedicated
 *     `business_logics` name-collision fallback group for `business_logics`
 *     candidates whose collision could not be qualified at generation/save-back.
 *   - `widgetKindForField` decides the per-group value control (typeahead for
 *     reference/FK fields, dropdown for enums, free-text otherwise).
 *   - `buildPatch` turns a resolved per-row value into the snake_case
 *     `BulkCandidateEditPatch` (top-level field vs `data`-blob overlay).
 *
 * These are deliberately framework-free so they can be unit-tested without
 * mounting the panel.
 */

import type { BulkCandidateEditPatch, SaveBackReasonEntry } from '../../api/discoveryApi';

// ============================================================================
// Widget kinds
// ============================================================================

export type BulkFillWidgetKind = 'typeahead' | 'dropdown' | 'freetext';

/**
 * Known enum fields and their option sets (starter set, extensible). When a
 * group's missing field is one of these, the panel renders a <select>.
 */
export const ENUM_FIELD_OPTIONS: Record<string, string[]> = {
  interface_type: [
    'REST_API',
    'SOAP_API',
    'GRAPHQL_API',
    'GRPC_API',
    'MESSAGE_QUEUE',
    'EVENT_STREAM',
    'FILE_TRANSFER',
    'DATABASE',
  ],
  operation_verb: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'],
};

/**
 * Top-level candidate fields (everything else is patched into the `data` blob).
 * Mirrors the writable top-level columns on {@link BulkCandidateEditPatch}.
 */
const TOP_LEVEL_FIELDS: ReadonlySet<string> = new Set([
  'name',
  'candidate_type',
  'status',
  'review_status',
  'confidence',
  'operation',
]);

/**
 * Reference/FK field heuristics: a field that resolves to another model
 * entity / candidate. We treat any `*_id` field, plus an explicit allow-list of
 * known reference fields, as a typeahead-resolved reference.
 */
const KNOWN_REFERENCE_FIELDS: ReadonlySet<string> = new Set([
  'parent_candidate_id',
  'source_entity_name',
  'target_entity_name',
  'logical_entity_name',
  'physical_entity_name',
  'targetEntityName',
  'sourceEntityName',
]);

export function isReferenceField(field: string): boolean {
  if (KNOWN_REFERENCE_FIELDS.has(field)) return true;
  return /_id$/.test(field) || /Id$/.test(field) || /Name$/.test(field) || /_name$/.test(field);
}

export function isEnumField(field: string): boolean {
  return field in ENUM_FIELD_OPTIONS;
}

/** Decide the per-group value control for a missing field. */
export function widgetKindForField(field: string): BulkFillWidgetKind {
  if (isEnumField(field)) return 'dropdown';
  if (isReferenceField(field)) return 'typeahead';
  return 'freetext';
}

// ============================================================================
// Grouping
// ============================================================================

/** Sentinel group key for the business_logics name-collision fallback group. */
export const BUSINESS_LOGICS_COLLISION_GROUP = '__business_logics_name_collision__';

/** Sentinel for an arm entry that did not carry a specific missing field. */
export const UNSPECIFIED_FIELD_GROUP = '__unspecified__';

/**
 * The reason CLASSES the C1 panel can remediate. `blocked` (unresolved
 * reference / bad type) and `quality_gap` (committed-but-missing-field) are the
 * actionable buckets; the panel also folds in the business_logics name-collision
 * fallback.
 */
export const ACTIONABLE_REASONS: ReadonlySet<string> = new Set(['blocked', 'quality_gap']);

export interface BulkFillGroup {
  /** Stable group key: a field name, or one of the two sentinels. */
  key: string;
  /** The missing/blocking field this group is keyed by ('' for the fallback). */
  field: string;
  /** Human label for the group header. */
  label: string;
  /** The value control this group uses. */
  widget: BulkFillWidgetKind;
  /** Whether this is the business_logics name-collision fallback group. */
  isCollisionFallback: boolean;
  /** The reason-arm entries in this group. */
  entries: SaveBackReasonEntry[];
}

function fieldLabel(field: string): string {
  if (!field) return 'Field';
  return field
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^\w/, (c) => c.toUpperCase());
}

/**
 * Does this arm entry belong in the business_logics name-collision fallback
 * group? A `business_logics` candidate that is blocked/quality-gapped because
 * its class context was missing (so the `<class>.<method>` qualifier could not
 * be applied) -- detected by candidateType + an absent/class-ish missing field.
 */
export function isCollisionFallbackEntry(entry: SaveBackReasonEntry): boolean {
  if (entry.candidateType !== 'business_logics') return false;
  const mf = entry.missingField ?? '';
  // No class context, or the missing field explicitly names the class slot.
  return (
    entry.class.trim().length === 0 ||
    mf === 'class' ||
    mf === 'className' ||
    mf === 'controllerClassName' ||
    mf === 'name'
  );
}

/**
 * Fold the reason arm into remediation groups.
 *
 * @param reasons    The full per-candidate reason arm.
 * @param scopeClass Optional reason CLASS to scope to (the clicked chip token).
 *                   When provided, only entries of that class (mapped to the
 *                   actionable buckets) are grouped. When omitted, ALL
 *                   actionable entries are grouped.
 */
export function groupAffectedCandidates(
  reasons: SaveBackReasonEntry[],
  scopeClass?: string | null,
): BulkFillGroup[] {
  const byKey = new Map<string, BulkFillGroup>();

  const wantClass = scopeClass && ACTIONABLE_REASONS.has(scopeClass) ? scopeClass : null;

  for (const entry of reasons) {
    if (!ACTIONABLE_REASONS.has(entry.reason)) continue;
    if (wantClass && entry.reason !== wantClass) continue;

    if (isCollisionFallbackEntry(entry)) {
      const key = BUSINESS_LOGICS_COLLISION_GROUP;
      let g = byKey.get(key);
      if (!g) {
        g = {
          key,
          field: 'name',
          label: 'business_logics name collision - qualify with class',
          widget: 'freetext',
          isCollisionFallback: true,
          entries: [],
        };
        byKey.set(key, g);
      }
      g.entries.push(entry);
      continue;
    }

    const field = entry.missingField ?? '';
    const key = field || UNSPECIFIED_FIELD_GROUP;
    let g = byKey.get(key);
    if (!g) {
      g = {
        key,
        field,
        label: field ? fieldLabel(field) : 'Unspecified field',
        widget: field ? widgetKindForField(field) : 'freetext',
        isCollisionFallback: false,
        entries: [],
      };
      byKey.set(key, g);
    }
    g.entries.push(entry);
  }

  // Stable order: real-field groups first (alphabetical by label), the
  // unspecified bucket next, the collision fallback last.
  return Array.from(byKey.values()).sort((a, b) => {
    const rank = (g: BulkFillGroup) =>
      g.isCollisionFallback ? 2 : g.key === UNSPECIFIED_FIELD_GROUP ? 1 : 0;
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    return a.label.localeCompare(b.label);
  });
}

// ============================================================================
// Patch building
// ============================================================================

/**
 * Build the qualified `<class>.<method>` name for a business_logics collision
 * row. Uses the row's own class context; when an explicit override class is
 * supplied it wins. Returns null when there is no class to qualify with (the
 * row stays blocked and the panel surfaces it as still-blocking).
 */
export function qualifiedBusinessLogicName(
  entry: SaveBackReasonEntry,
  overrideClass?: string,
): string | null {
  const cls = (overrideClass ?? entry.class ?? '').trim();
  if (!cls) return null;
  const method = (entry.name ?? '').trim();
  // If the name already looks qualified (contains a dot), leave it.
  if (method.includes('.')) return method;
  if (!method) return null;
  return `${cls}.${method}`;
}

/**
 * Turn a resolved value for one row into a snake_case bulk-edit patch.
 * Top-level fields are set as top-level keys; everything else is merged into a
 * partial `data` overlay (supplied key wins, others preserved server-side).
 */
export function buildPatch(
  candidateId: string,
  field: string,
  value: unknown,
): BulkCandidateEditPatch {
  if (TOP_LEVEL_FIELDS.has(field)) {
    const patch: BulkCandidateEditPatch = { candidate_id: candidateId };
    (patch as unknown as Record<string, unknown>)[field] = value;
    return patch;
  }
  return { candidate_id: candidateId, data: { [field]: value } };
}
