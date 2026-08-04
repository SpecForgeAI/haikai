/**
 * Structural-findings disposition model (Spec 2026-08-04-2).
 *
 * The DB pack generator emits structured `structural_findings` (stable
 * `kind:subject` identities) for every suspicious zero. A human dispositions
 * each finding on the Schema-migration screen BEFORE a migration plan exists:
 *
 *   - `accepted`     — the source is genuinely like this (reason recorded).
 *                      Produces nothing in the plan.
 *   - `fix_upstream` — intent recorded, finding stays OPEN; it clears only
 *                      when a regenerated pack no longer emits it. Still
 *                      blocks plan generation / Migrate (the point of the
 *                      choice is to fix BEFORE planning).
 *   - `known_gap`    — real work the tool cannot perform yet. Unblocks the
 *                      gate and materialises as a `known_gap` work item under
 *                      the "Known gaps" feature (manual execution class,
 *                      never dispatched to the implement-verify service).
 *
 * Dispositions persist per PROJECT in AMS (`db_structural_finding_dispositions`,
 * keyed `kind:subject`) so they survive pack regeneration; a finding the
 * regenerated pack no longer emits simply stops appearing (auto-cleared —
 * the generator is the only resolution oracle, never a manual flag).
 */
import type { PackManifest, StructuralFinding } from './dbMigrationPack/types';
import { structuralFindingKey } from './dbMigrationPack/types';

/** AMS wire row (snake_case) for one persisted disposition. */
export interface StructuralDispositionRow {
  finding_key: string;
  kind?: string | null;
  subject?: string | null;
  disposition: 'accepted' | 'fix_upstream' | 'known_gap' | string;
  note?: string | null;
}

/** One finding joined with its (possibly absent) disposition. */
export interface StructuralFindingState {
  key: string;
  kind: string;
  subject: string;
  message: string;
  disposition: StructuralDispositionRow['disposition'] | null;
  note: string | null;
  /** True while the finding blocks plan generation / Migrate. */
  open: boolean;
}

/**
 * The manifest's findings, structured. Legacy packs (pre-Spec) carry only
 * `structural_warnings` strings — each becomes a `legacy_warning` finding
 * whose subject is a slug of the message head, stable while the text is
 * unchanged (regenerating on current code upgrades them to structured form).
 */
export function findingsOfManifest(
  manifest: Pick<PackManifest, 'structural_findings' | 'structural_warnings'>
): StructuralFinding[] {
  if (manifest.structural_findings && manifest.structural_findings.length > 0) {
    return manifest.structural_findings;
  }
  return (manifest.structural_warnings ?? []).map((message) => ({
    kind: 'legacy_warning',
    subject: message
      .slice(0, 60)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, ''),
    message,
  }));
}

/** Dispositions considered CLOSING for the gates. */
const CLOSING_DISPOSITIONS = new Set(['accepted', 'known_gap']);

/** Join the pack's current findings with the project's dispositions. */
export function resolveStructuralFindingStates(
  manifest: Pick<PackManifest, 'structural_findings' | 'structural_warnings'>,
  dispositions: ReadonlyArray<StructuralDispositionRow>
): StructuralFindingState[] {
  const byKey = new Map(dispositions.map((d) => [d.finding_key, d]));
  return findingsOfManifest(manifest).map((f) => {
    const key = structuralFindingKey(f);
    const row = byKey.get(key) ?? null;
    return {
      key,
      kind: f.kind,
      subject: f.subject,
      message: f.message,
      disposition: row?.disposition ?? null,
      note: row?.note ?? null,
      open: !row || !CLOSING_DISPOSITIONS.has(row.disposition),
    };
  });
}

/** The findings still blocking (undispositioned or fix_upstream). */
export function openStructuralFindings(
  manifest: Pick<PackManifest, 'structural_findings' | 'structural_warnings'>,
  dispositions: ReadonlyArray<StructuralDispositionRow>
): StructuralFindingState[] {
  return resolveStructuralFindingStates(manifest, dispositions).filter((s) => s.open);
}

/** The findings dispositioned `known_gap` (materialise as known-gap items). */
export function knownGapFindings(
  manifest: Pick<PackManifest, 'structural_findings' | 'structural_warnings'>,
  dispositions: ReadonlyArray<StructuralDispositionRow>
): StructuralFindingState[] {
  return resolveStructuralFindingStates(manifest, dispositions).filter(
    (s) => s.disposition === 'known_gap'
  );
}

/** One-line human summary for gate messages. */
export function describeOpenFindings(open: ReadonlyArray<StructuralFindingState>): string {
  const sample = open
    .slice(0, 3)
    .map((s) => (s.disposition === 'fix_upstream' ? `${s.key} (fix upstream pending)` : s.key))
    .join(', ');
  return `${open.length} structural finding(s) undispositioned or awaiting upstream fix (${sample}${
    open.length > 3 ? ', …' : ''
  })`;
}
