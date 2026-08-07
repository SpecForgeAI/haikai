/**
 * Tests — side-by-side sync & reconciliation pack emitters
 * (Spec 2026-07-02-d, Persistence-Tier Oracle Program).
 *
 * All emitters are pure + deterministic; the pins here protect the operating
 * model the user agreed: ONE-WAY daily sync, per-run reconciliation with a
 * gateable drift exit, and sequence seeding at SWAP-OVER (not bulk load).
 */

import {
  RECONCILIATION_REPORT_PATH,
  RECONCILIATION_SQL_PATH,
  SWAP_OVER_RUNBOOK_PATH,
  SYNC_RUNNER_PATH,
  SYNC_STATE_PATH,
  SYNC_STATE_TABLE,
  buildSyncManifestSection,
  emitReconciliationReportBuilder,
  emitReconciliationSql,
  emitSwapOverRunbook,
  emitSyncRunner,
  emitSyncStateDdl,
} from '../services/dbMigrationPack/syncPack';
import type { DeltaStrategy } from '../services/dbMigrationPack/types';
import {
  generateDbMigrationPack,
} from '../services/dbMigrationPackHandler';
import type { GenerationInputs } from '../services/dbMigrationPack/inputs';

const STRATEGIES: DeltaStrategy[] = [
  { table: 'dbo.orders', strategy: 'insert_only', deltaKey: 'order_id', source: 'identity_column' },
  { table: 'dbo.customers', strategy: 'insert_update', deltaKey: 'updated_at', source: 'timestamp_name_heuristic' },
  { table: 'dbo.products', strategy: 'full_reload', deltaKey: null, source: 'none' },
  { table: 'dbo.audit_log', strategy: 'needs_decision', deltaKey: null, source: 'none' },
];

describe('sync emitters (pure)', () => {
  it('state DDL creates the idempotent high-water table', () => {
    const ddl = emitSyncStateDdl();
    expect(ddl).toContain(`CREATE TABLE IF NOT EXISTS ${SYNC_STATE_TABLE}`);
    expect(ddl).toContain('high_water');
    expect(ddl).toContain('Idempotence');
  });

  it('runner EXECUTES the AMVS-driven sync via the gateway (2026-08-07 — the old comment stub executed nothing) and documents every table posture', () => {
    const runner = emitSyncRunner({ strategies: STRATEGIES });
    expect(runner).toContain('#!/usr/bin/env bash');
    // The REAL dispatch — never a pretend sync_table() body.
    expect(runner).toContain('run-incremental-sync');
    expect(runner).toContain('curl -sS -X POST');
    expect(runner).toContain('GATEWAY_BASE_URL');
    expect(runner).not.toContain('sync_table()');
    // Per-table posture is documented for the operator.
    expect(runner).toContain('dbo.orders  key=order_id  insert_only');
    expect(runner).toContain('dbo.customers  key=updated_at  insert_update');
    expect(runner).toContain('full-reload tables (1)');
    expect(runner).toContain('BLOCKED (1)');
    expect(runner).toContain('delta_key--dbo.audit_log');
    expect(runner).toContain(RECONCILIATION_REPORT_PATH);
    expect(runner).toContain('ONE-WAY only');
    // Honest exit semantics: clean = 0, anything else = attention.
    expect(runner).toContain('exit 2');
  });

  it('reconciliation SQL emits BOTH engine sections with max(delta_key) where keyed', () => {
    const sql = emitReconciliationSql({
      tableOrder: ['dbo.customers', 'dbo.orders', 'dbo.products'],
      strategies: STRATEGIES,
    });
    expect(sql).toContain('PostgreSQL (TARGET)');
    expect(sql).toContain('Sybase ASE (SOURCE)');
    // Target-side statements are QUOTED, source case preserved (2026-08-07):
    // the unquoted form silently lower-cased mixed-case identifiers.
    expect(sql).toContain(
      `SELECT 'dbo.orders', count(*)::text, max("order_id")::text FROM "dbo"."orders";`
    );
    expect(sql).toContain(`SELECT 'dbo.products', count(*)::text, NULL FROM "dbo"."products";`);
    // The Sybase section stays UNQUOTED (source-engine semantics).
    expect(sql).toContain('convert(varchar(40), max(order_id)) FROM dbo.orders');
  });

  it('report builder exits 2 on drift (the cutover gate contract)', () => {
    const script = emitReconciliationReportBuilder();
    expect(script).toContain('exit 2');
    expect(script).toContain('| table | source rows | target rows |');
  });

  it('runbook seeds sequences AT SWAP-OVER, gates on zero drift, and re-homes jobs exactly once', () => {
    const runbook = emitSwapOverRunbook({
      sourceEngine: 'sybase_ase',
      targetEngine: 'postgresql',
      sequences: [
        {
          schemaName: 'dbo',
          sequenceName: 'orders_seq',
          currentValue: '5000',
          currentValueAvailable: true,
          startValue: null,
          ownedByTable: 'orders',
          ownedByColumn: 'order_id',
          findingIds: [],
        },
      ],
      scheduledJobs: ['dbo.nightly_rollup'],
      pendingDecisionTables: ['dbo.audit_log'],
    });
    expect(runbook).toContain('NOW — not at bulk load');
    expect(runbook).toContain('Zero-drift gate');
    expect(runbook).toContain('[decision:db.jobsRehoming]');
    expect(runbook).toContain('dbo.nightly_rollup');
    expect(runbook).toContain('**BLOCKED**');
    expect(runbook).toContain('dbo.audit_log');
  });

  it('manifest sync section mirrors the strategies + artefact paths', () => {
    const section = buildSyncManifestSection(STRATEGIES);
    expect(section).toMatchObject({
      cadence_default: 'daily',
      state_table: SYNC_STATE_TABLE,
      runner_path: SYNC_RUNNER_PATH,
      state_ddl_path: SYNC_STATE_PATH,
      reconciliation_paths: [RECONCILIATION_SQL_PATH, RECONCILIATION_REPORT_PATH],
      runbook_path: SWAP_OVER_RUNBOOK_PATH,
    });
    expect(section.tables).toHaveLength(4);
    expect(section.tables[3]).toEqual({
      table: 'dbo.audit_log',
      strategy: 'needs_decision',
      delta_key: null,
    });
  });
});

describe('pipeline integration — the five sync files ride the pack', () => {
  it('generateDbMigrationPack emits the sync/reconcile/runbook files and the manifest sync section', async () => {
    const inputs: GenerationInputs = {
      model: {
        physicalDataEntities: [
          {
            id: 'ent-1',
            name: 'dbo.orders',
            physical_type: 'table',
            constraints_metadata: {
              primary_key: { name: 'pk_orders', columns: ['order_id'] },
            },
          },
        ],
        physicalDataAttributes: [
          {
            id: 'attr-1',
            name: 'order_id',
            physical_entity_id: 'ent-1',
            data_type: 'int',
            is_primary_key: true,
            is_nullable: false,
            is_identity: true,
            ordinal: 1,
          },
        ],
        dataEntityPoints: [],
        dataEntityRelationships: [],
      },
      findings: [],
      dbDecisions: [{ decisionCode: 'db.engine', answerValue: 'PostgreSQL 18' }],
      resolvedPackDecisions: [],
    };

    let persistedBody: Record<string, unknown> | null = null;
    const result = await generateDbMigrationPack(
      { projectId: 'proj-1', architectureId: 'arch-1', targetArchitectureId: 'arch-t' },
      {
        fetchModel: async () => inputs.model,
        fetchFindings: async () => inputs.findings,
        fetchDbDecisions: async () => inputs.dbDecisions,
        fetchResolvedPackDecisions: async () => inputs.resolvedPackDecisions,
        persistPack: async (_projectId, body) => {
          persistedBody = body as unknown as Record<string, unknown>;
          return { id: 'pack-1' } as never;
        },
        translationHook: async () => null,
      }
    );

    expect(result.pack.id).toBe('pack-1');
    const files = (persistedBody as unknown as {
      files: Array<{ file_path: string; file_kind: string }>;
    }).files;
    const byPath = new Map(files.map((f) => [f.file_path, f.file_kind]));
    expect(byPath.get(SYNC_STATE_PATH)).toBe('sync_runner');
    expect(byPath.get(SYNC_RUNNER_PATH)).toBe('sync_runner');
    expect(byPath.get(RECONCILIATION_SQL_PATH)).toBe('reconciliation_script');
    expect(byPath.get(RECONCILIATION_REPORT_PATH)).toBe('reconciliation_script');
    expect(byPath.get(SWAP_OVER_RUNBOOK_PATH)).toBe('cutover_runbook');

    const manifest = (persistedBody as unknown as {
      manifest_json: { sync?: { runner_path: string; tables: unknown[] } };
    }).manifest_json;
    expect(manifest.sync?.runner_path).toBe(SYNC_RUNNER_PATH);
    expect(manifest.sync?.tables).toHaveLength(1);
  });
});
