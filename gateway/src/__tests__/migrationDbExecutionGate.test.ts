/**
 * Tests — DB-pack readiness gate for the Migration Execution Driver
 * (Spec 2026-07-02-e, Persistence-Tier Oracle Program).
 *
 * The persistence-tier analogue of CD-7: DB-pack stories in scope => Migrate
 * refuses unless the pack exists, is fresh + correctly target-bound, has zero
 * open decisions, and every translate-disposition translation is approved.
 * FAIL-CLOSED on unreadable pack state.
 */

import {
  dbStoriesInScope,
  evaluateDbPackReadiness,
  DbPackGateReads,
} from '../services/migrationDbExecutionGate';
import type { PackView } from '../services/migrationDbPackPlanner';
import type { BookOfWorkItem } from '../services/migrationDriverAmsReads';
import type { PackManifest } from '../services/dbMigrationPack/types';

function story(
  workItemId: string,
  tags: string[]
): BookOfWorkItem {
  return { workItemId, title: workItemId, tags } as unknown as BookOfWorkItem;
}

function packView(overrides: Partial<PackView> = {}): PackView {
  return {
    packId: 'pack-1',
    status: 'generated',
    inputSnapshotHash: 'hash-1',
    manifest: {
      target_architecture_id: 'arch-target',
    } as unknown as PackManifest,
    decisions: [],
    translations: [],
    ...overrides,
  };
}

function reads(overrides: Partial<DbPackGateReads> = {}): DbPackGateReads {
  return {
    fetchPackView: async () => packView(),
    evaluateStaleness: async () => ({
      is_stale: false,
      staleness_reason: null,
      current_input_snapshot_hash: 'hash-1',
      staleness_check_error: null,
    }),
    ...overrides,
  };
}

const PARAMS = {
  projectId: 'proj-1',
  currentArchitectureId: 'arch-current',
  targetArchitectureId: 'arch-target',
};

describe('dbStoriesInScope', () => {
  it('detects pack-tagged and DB-stream-tagged stories, honouring deferral + selection', () => {
    const items = [
      story('wi-api', ['stream:target_service_api_implementation']),
      story('wi-db', ['provenance:pack', 'stream:data_migration']),
    ];
    expect(
      dbStoriesInScope({ items, deferredWorkItemIds: new Set(), selectedWorkItemIds: null })
    ).toBe(true);
    // Deferred DB story drops out of scope.
    expect(
      dbStoriesInScope({
        items,
        deferredWorkItemIds: new Set(['wi-db']),
        selectedWorkItemIds: null,
      })
    ).toBe(false);
    // Subset migrate selecting only the API story -> DB gate not applicable.
    expect(
      dbStoriesInScope({
        items,
        deferredWorkItemIds: new Set(),
        selectedWorkItemIds: new Set(['wi-api']),
      })
    ).toBe(false);
    // Stream tag alone (no provenance tag) is enough.
    expect(
      dbStoriesInScope({
        items: [story('wi-schema', ['stream:target_database_schema_implementation'])],
        deferredWorkItemIds: new Set(),
      })
    ).toBe(true);
    expect(
      dbStoriesInScope({
        items: [story('wi-api', ['stream:target_service_api_implementation'])],
        deferredWorkItemIds: new Set(),
      })
    ).toBe(false);
  });
});

describe('evaluateDbPackReadiness', () => {
  it('passes a fresh, correctly-bound, decision-clean, fully-approved pack', async () => {
    const result = await evaluateDbPackReadiness({ ...PARAMS, reads: reads() });
    expect(result).toEqual({ ok: true, reasons: [] });
  });

  it('blocks with db_pack_missing when no pack exists', async () => {
    const result = await evaluateDbPackReadiness({
      ...PARAMS,
      reads: reads({ fetchPackView: async () => null }),
    });
    expect(result.ok).toBe(false);
    expect(result.reasons.map((r) => r.code)).toEqual(['db_pack_missing']);
  });

  it('FAILS CLOSED with db_pack_read_failed when the pack state is unreadable', async () => {
    const result = await evaluateDbPackReadiness({
      ...PARAMS,
      reads: reads({
        fetchPackView: async () => {
          throw new Error('HTTP 503');
        },
      }),
    });
    expect(result.ok).toBe(false);
    expect(result.reasons[0].code).toBe('db_pack_read_failed');
    expect(result.reasons[0].message).toContain('fails CLOSED');
  });

  it('blocks with db_pack_stale when the pack is bound to a DIFFERENT target than the book', async () => {
    const result = await evaluateDbPackReadiness({
      ...PARAMS,
      targetArchitectureId: 'arch-OTHER-target',
      reads: reads(),
    });
    expect(result.ok).toBe(false);
    expect(result.reasons.map((r) => r.code)).toContain('db_pack_stale');
    expect(result.reasons[0].message).toContain('arch-OTHER-target');
  });

  it('blocks with db_pack_stale when the input-snapshot hash drifted', async () => {
    const result = await evaluateDbPackReadiness({
      ...PARAMS,
      reads: reads({
        evaluateStaleness: async () => ({
          is_stale: true,
          staleness_reason: 'inputs changed since generation',
          current_input_snapshot_hash: 'hash-2',
          staleness_check_error: null,
        }),
      }),
    });
    expect(result.ok).toBe(false);
    expect(result.reasons.map((r) => r.code)).toEqual(['db_pack_stale']);
    expect(result.reasons[0].message).toContain('regenerate the migration plan');
  });

  it('blocks with db_pack_decisions_unresolved listing sample keys — but an open surrogate_pk OFFER never blocks (2026-08-09)', async () => {
    const result = await evaluateDbPackReadiness({
      ...PARAMS,
      reads: reads({
        fetchPackView: async () =>
          packView({
            decisions: [
              { decision_key: 'type_mapping--dbo.orders.legacy_ts', object_ref: 'x', category: 'type_mapping', status: 'open' },
              { decision_key: 'delta_key--dbo.audit_log', object_ref: 'y', category: 'delta_key', status: 'open' },
              { decision_key: 'collation--dbo.names.name', object_ref: 'z', category: 'collation', status: 'resolved' },
              // Open surrogate_pk is an OFFER (no-PK tables emit completely,
              // just keyless — governed by the finding dispositions): it must
              // never count toward the block.
              { decision_key: 'surrogate_pk--tables_without_pk', object_ref: 'tables_without_pk', category: 'surrogate_pk', status: 'open' },
            ],
          }),
      }),
    });
    expect(result.ok).toBe(false);
    expect(result.reasons.map((r) => r.code)).toEqual(['db_pack_decisions_unresolved']);
    expect(result.reasons[0].message).toContain('2 DB pack decision(s)');
    expect(result.reasons[0].message).toContain('type_mapping--dbo.orders.legacy_ts');
    expect(result.reasons[0].message).not.toContain('surrogate_pk');
  });

  it('an open surrogate_pk decision ALONE does not block Migrate', async () => {
    const result = await evaluateDbPackReadiness({
      ...PARAMS,
      reads: reads({
        fetchPackView: async () =>
          packView({
            decisions: [
              { decision_key: 'surrogate_pk--tables_without_pk', object_ref: 'tables_without_pk', category: 'surrogate_pk', status: 'open' },
            ],
          }),
      }),
    });
    expect(result.reasons.map((r) => r.code)).not.toContain('db_pack_decisions_unresolved');
  });

  it('blocks with db_translations_unapproved for unreviewed/needs_rework translate rows ONLY', async () => {
    const result = await evaluateDbPackReadiness({
      ...PARAMS,
      reads: reads({
        fetchPackView: async () =>
          packView({
            translations: [
              { translation_key: 'a', object_ref: 'dbo.p1', kind: 'stored_procedure', disposition: 'translate', review_status: 'unreviewed' },
              { translation_key: 'b', object_ref: 'dbo.t1', kind: 'trigger', disposition: 'translate', review_status: 'needs_rework' },
              { translation_key: 'c', object_ref: 'dbo.p2', kind: 'stored_procedure', disposition: 'translate', review_status: 'approved' },
              { translation_key: 'd', object_ref: 'dbo.p3', kind: 'stored_procedure', disposition: 'translate', review_status: 'rejected' },
              { translation_key: 'e', object_ref: 'dbo.t2', kind: 'trigger', disposition: 'rewrite_in_app', review_status: 'unreviewed' },
            ],
          }),
      }),
    });
    expect(result.ok).toBe(false);
    expect(result.reasons.map((r) => r.code)).toEqual(['db_translations_unapproved']);
    expect(result.reasons[0].message).toContain('2 DB-object translation draft(s)');
    expect(result.reasons[0].message).toContain('stored_procedure, trigger');
  });

  it('stacks multiple reasons so the user sees every blocker at once', async () => {
    const result = await evaluateDbPackReadiness({
      ...PARAMS,
      reads: reads({
        fetchPackView: async () =>
          packView({
            decisions: [
              { decision_key: 'delta_key--dbo.audit_log', object_ref: 'y', category: 'delta_key', status: 'open' },
            ],
            translations: [
              { translation_key: 'a', object_ref: 'dbo.p1', kind: 'stored_procedure', disposition: 'translate', review_status: 'unreviewed' },
            ],
          }),
        evaluateStaleness: async () => ({
          is_stale: true,
          staleness_reason: 'inputs changed since generation',
          current_input_snapshot_hash: 'hash-2',
          staleness_check_error: null,
        }),
      }),
    });
    expect(result.ok).toBe(false);
    expect(result.reasons.map((r) => r.code).sort()).toEqual([
      'db_pack_decisions_unresolved',
      'db_pack_stale',
      'db_translations_unapproved',
    ]);
  });
});
