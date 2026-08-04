/**
 * Structural-findings disposition model (Spec 2026-08-04-2): stable
 * kind:subject identity, closing semantics (accepted / known_gap close;
 * fix_upstream and undispositioned stay OPEN), legacy-warning fallback.
 */
import {
  findingsOfManifest,
  knownGapFindings,
  openStructuralFindings,
  resolveStructuralFindingStates,
} from '../services/migrationStructuralFindings';
import { deriveStructuralFindings } from '../services/dbMigrationPack/inputs';
import type { StructuralAccounting } from '../services/dbMigrationPack/types';

const FINDINGS = [
  { kind: 'no_primary_keys', subject: 'all_tables', message: 'no PKs (65 tables) — none.' },
  { kind: 'no_indexes', subject: 'all_tables', message: 'no indexes — 030 EMPTY.' },
];

describe('findingsOfManifest', () => {
  it('prefers structured findings', () => {
    const out = findingsOfManifest({ structural_findings: FINDINGS, structural_warnings: ['x'] });
    expect(out).toEqual(FINDINGS);
  });

  it('falls back to legacy warnings with a stable slug subject', () => {
    const out = findingsOfManifest({
      structural_warnings: ['No table carries a primary key (65 tables) — the target gets 0.'],
    });
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('legacy_warning');
    expect(out[0].subject).toBe('no-table-carries-a-primary-key-65-tables-the-target-gets');
    // Same text → same subject (disposition stability while text unchanged).
    expect(
      findingsOfManifest({
        structural_warnings: ['No table carries a primary key (65 tables) — the target gets 0.'],
      })[0].subject
    ).toBe(out[0].subject);
  });

  it('empty manifest → no findings', () => {
    expect(findingsOfManifest({})).toEqual([]);
  });
});

describe('disposition semantics', () => {
  it('undispositioned findings are OPEN', () => {
    const open = openStructuralFindings({ structural_findings: FINDINGS }, []);
    expect(open.map((f) => f.key)).toEqual([
      'no_primary_keys:all_tables',
      'no_indexes:all_tables',
    ]);
  });

  it('accepted and known_gap CLOSE; fix_upstream stays OPEN', () => {
    const states = resolveStructuralFindingStates({ structural_findings: FINDINGS }, [
      { finding_key: 'no_primary_keys:all_tables', disposition: 'accepted', note: 'by design' },
      { finding_key: 'no_indexes:all_tables', disposition: 'fix_upstream' },
    ]);
    expect(states.find((s) => s.kind === 'no_primary_keys')!.open).toBe(false);
    expect(states.find((s) => s.kind === 'no_indexes')!.open).toBe(true);

    const closed = resolveStructuralFindingStates({ structural_findings: FINDINGS }, [
      { finding_key: 'no_primary_keys:all_tables', disposition: 'accepted', note: 'by design' },
      { finding_key: 'no_indexes:all_tables', disposition: 'known_gap', note: 'DBA later' },
    ]);
    expect(closed.every((s) => !s.open)).toBe(true);
    expect(knownGapFindings({ structural_findings: FINDINGS }, [
      { finding_key: 'no_indexes:all_tables', disposition: 'known_gap', note: 'DBA later' },
    ]).map((s) => s.key)).toEqual(['no_indexes:all_tables']);
  });

  it('a disposition for a finding the pack no longer emits is IGNORED (auto-clear)', () => {
    const states = resolveStructuralFindingStates({ structural_findings: [FINDINGS[0]] }, [
      { finding_key: 'no_primary_keys:all_tables', disposition: 'accepted', note: 'by design' },
      { finding_key: 'no_indexes:all_tables', disposition: 'known_gap', note: 'stale row' },
    ]);
    expect(states).toHaveLength(1);
    expect(states[0].key).toBe('no_primary_keys:all_tables');
  });
});

describe('deriveStructuralFindings identities', () => {
  it('emits stable kind:subject with counts confined to the message', () => {
    const acc: StructuralAccounting = {
      tables_total: 65,
      view_entities_total: 0,
      tables_with_constraints_metadata: 65,
      tables_with_primary_key: 0,
      unique_constraints_total: 0,
      check_constraints_total: 0,
      indexes_total: 0,
      relationships_total: 5,
      relationships_with_fk_columns: 0,
      collation_hazard_columns: 0,
      generated_columns: 0,
      sequences_captured: 0,
      code_objects_captured: { stored_procedure: 0, trigger: 0, view: 0, scheduled_job: 0 },
    };
    const findings = deriveStructuralFindings(acc);
    expect(findings.map((f) => `${f.kind}:${f.subject}`)).toEqual([
      'no_primary_keys:all_tables',
      'no_indexes:all_tables',
      'relationships_without_fk_columns:all_relationships',
      'no_code_objects:all_code_objects',
    ]);
    // Count drift changes messages, never identities.
    const drifted = deriveStructuralFindings({ ...acc, tables_total: 60, relationships_total: 3 });
    expect(drifted.map((f) => `${f.kind}:${f.subject}`)).toEqual(
      findings.map((f) => `${f.kind}:${f.subject}`)
    );
    expect(drifted[0].message).not.toBe(findings[0].message);
  });
});
