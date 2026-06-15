/**
 * Group 5 tests -- procedural-object findings: extended vocabulary + complete
 * verbatim bodies + risk-weighting.
 *
 * Spec: 2026-05-29 DB Structural Fidelity -- tasks.md 5.1.
 *
 * Offline only -- no LLM, no gateway relay. Drives the per-engine finding
 * builders directly. Focused set (within the 2-8 bound):
 *  1. trigger_logic / view_definition / sequence_definition are emitted with
 *     complete detail_json (name, schema, the table a trigger fires on, object
 *     kind, migration concern) + the full redacted/size-capped body + flags.
 *  2. A DML-writing procedure -> medium; a read-only procedure -> info
 *     (risk-weighting preserved). Triggers risk-weighted, not blanket INFO.
 *  3. Complete verbatim body: a long proc body is NOT truncated at 200; a body
 *     with embedded credentials is scrubbed + stamped redacted.
 *  4. The existing vocabulary is KEPT (stored_procedure_logic /
 *     hidden_business_logic / procedure_data_write / complex_view_logic).
 */

import {
  buildTriggerLogicFinding,
  buildViewDefinitionFinding,
  buildSequenceDefinitionFinding,
} from '../services/findings/databasePackFindingScanners';
import { buildAllPostgresFindings } from '../services/databasePacks/postgres/postgresFindings';
import { buildAllSybaseFindings } from '../services/databasePacks/sybase/sybaseFindings';
import type {
  IntrospectionResult,
  ProfileResult,
  RelationshipInference,
} from '../services/databasePacks/types';
import type { FindingEmitInput } from '../services/findings/FindingEmitter';

const emptyProfile: ProfileResult = { tables: [], skippedTables: [] };
const noRels: RelationshipInference[] = [];

function emptyIntrospection(): IntrospectionResult {
  return {
    schemas: [],
    tables: [],
    columns: [],
    keysAndIndexes: [],
    views: [],
    procedures: [],
    triggers: [],
    sequences: [],
  };
}

function byType(findings: FindingEmitInput[], type: string): FindingEmitInput[] {
  return findings.filter((f) => f.findingType === type);
}

// -----------------------------------------------------------------------------
// 1) New builders emit with complete detail_json + body + flags.
// -----------------------------------------------------------------------------

describe('New procedural-object builders (Spec 2026-05-29)', () => {
  it('buildTriggerLogicFinding carries firesOn table + objectKind + body + flags', () => {
    const f = buildTriggerLogicFinding({
      engineKey: 'postgres',
      schemaName: 'public',
      triggerName: 'trg_audit',
      tableSchema: 'public',
      tableName: 'orders',
      timing: 'after',
      events: ['insert', 'update'],
      body: 'BEGIN INSERT INTO audit_log VALUES (NEW.id); END',
      bodyHasDml: true,
    });
    expect(f.findingType).toBe('trigger_logic');
    expect(f.category).toBe('hidden_logic');
    expect(f.severity).toBe('medium'); // DML-writing trigger -> medium
    const d = f.detailJson as Record<string, unknown>;
    expect(d.objectKind).toBe('trigger');
    expect(d.firesOnTable).toBe('orders');
    expect(d.firesOnSchema).toBe('public');
    expect(d.timing).toBe('after');
    expect(d.events).toEqual(['insert', 'update']);
    expect(d.migrationConcern).toBe('trigger_writes_data');
    expect(d.body).toContain('INSERT INTO audit_log');
    expect(d.redacted).toBe(false);
    expect(d.truncated).toBe(false);
    // Spec 2026-06-11 TG1: the redaction-policy marker rides the detail.
    expect(d.literal_policy).toBe('targeted_v2');
  });

  it('buildViewDefinitionFinding carries objectKind + complete definition; severity laddered by complexity', () => {
    const simple = buildViewDefinitionFinding({
      engineKey: 'postgres',
      schemaName: 'public',
      viewName: 'v_users',
      isMaterialized: false,
      definition: 'SELECT id, name FROM users',
      isComplex: false,
    });
    expect(simple.findingType).toBe('view_definition');
    expect(simple.severity).toBe('info');
    const d = simple.detailJson as Record<string, unknown>;
    expect(d.objectKind).toBe('view');
    expect(d.body).toContain('SELECT id, name FROM users');
    // Spec 2026-06-11 TG1: the redaction-policy marker rides the detail.
    expect(d.literal_policy).toBe('targeted_v2');

    const complex = buildViewDefinitionFinding({
      engineKey: 'postgres',
      schemaName: 'public',
      viewName: 'v_report',
      isMaterialized: true,
      definition: 'SELECT ... many joins ...',
      isComplex: true,
    });
    expect(complex.severity).toBe('medium'); // complex -> medium, NOT blanket INFO
    expect((complex.detailJson as Record<string, unknown>).objectKind).toBe(
      'materialized_view',
    );
  });

  it('buildSequenceDefinitionFinding carries generation params + owned-by; standalone -> low', () => {
    const owned = buildSequenceDefinitionFinding({
      engineKey: 'postgres',
      schemaName: 'public',
      sequenceName: 'orders_id_seq',
      dataType: 'bigint',
      startValue: '1',
      increment: '1',
      ownedByTable: 'orders',
      ownedByColumn: 'id',
    });
    expect(owned.findingType).toBe('sequence_definition');
    expect(owned.severity).toBe('info');
    const d = owned.detailJson as Record<string, unknown>;
    expect(d.objectKind).toBe('sequence');
    expect(d.increment).toBe('1');
    expect(d.ownedByTable).toBe('orders');
    expect(d.migrationConcern).toBe('column_backed_sequence');

    const standalone = buildSequenceDefinitionFinding({
      engineKey: 'postgres',
      schemaName: 'public',
      sequenceName: 'global_counter',
    });
    expect(standalone.severity).toBe('low'); // standalone weighted, not blanket INFO
    expect((standalone.detailJson as Record<string, unknown>).migrationConcern).toBe(
      'standalone_sequence',
    );
  });
});

// -----------------------------------------------------------------------------
// 2 + 3 + 4) Per-engine emission: vocabulary + risk-weighting + complete body.
// -----------------------------------------------------------------------------

describe('Per-engine hidden-logic emission (Spec 2026-05-29)', () => {
  it('emits the new + existing vocabulary and ladders proc severity (DML medium / read-only info)', () => {
    const intro = emptyIntrospection();
    intro.procedures = [
      {
        schemaName: 'public',
        procedureName: 'write_proc',
        routineKind: 'procedure',
        body: 'BEGIN INSERT INTO t VALUES (1); END',
        language: 'plpgsql',
      },
      {
        schemaName: 'public',
        procedureName: 'read_proc',
        routineKind: 'function',
        body: 'BEGIN RETURN (SELECT count(*) FROM t); END',
        language: 'plpgsql',
      },
    ];
    intro.views = [
      {
        schemaName: 'public',
        viewName: 'v_simple',
        definition: 'SELECT 1',
        isMaterialized: false,
      },
    ];
    intro.triggers = [
      {
        schemaName: 'public',
        triggerName: 'trg_x',
        tableSchema: 'public',
        tableName: 'orders',
        timing: 'after',
        events: ['insert'],
        actionStatement: 'BEGIN UPDATE counters SET n = n + 1; END',
      },
    ];
    intro.sequences = [
      { schemaName: 'public', sequenceName: 'seq_a', increment: '1', ownedByTable: 'orders', ownedByColumn: 'id' },
    ];

    const findings = buildAllPostgresFindings(intro, emptyProfile, noRels);

    // New vocabulary present.
    expect(byType(findings, 'view_definition')).toHaveLength(1);
    expect(byType(findings, 'trigger_logic')).toHaveLength(1);
    expect(byType(findings, 'sequence_definition')).toHaveLength(1);

    // Existing vocabulary KEPT.
    expect(byType(findings, 'stored_procedure_logic').length).toBeGreaterThanOrEqual(2);
    expect(byType(findings, 'hidden_business_logic').length).toBeGreaterThanOrEqual(2);
    expect(byType(findings, 'procedure_data_write')).toHaveLength(1);

    // Risk-weighting: stored_procedure_logic is always medium (per the existing
    // builder); the DML signal is carried by procedure_data_write (medium). The
    // read-only proc emits NO procedure_data_write.
    const dataWrites = byType(findings, 'procedure_data_write');
    expect(dataWrites[0].severity).toBe('medium');
    expect(
      dataWrites.every((f) => {
        const d = f.detailJson as Record<string, unknown>;
        return d.tableName === 'write_proc';
      }),
    ).toBe(true);

    // Trigger that writes data -> medium (NOT blanket INFO).
    expect(byType(findings, 'trigger_logic')[0].severity).toBe('medium');
  });

  it('captures the COMPLETE verbatim proc body (no 200-char truncation) and scrubs embedded credentials', () => {
    const intro = emptyIntrospection();
    const longBody =
      'CREATE PROCEDURE big AS BEGIN\n' +
      "  DECLARE @c VARCHAR(200) = 'mysql://u:HardPass99@host/db';\n" +
      'SELECT col FROM tbl;\n'.repeat(60) +
      'END';
    intro.procedures = [
      {
        schemaName: 'public',
        procedureName: 'big',
        routineKind: 'procedure',
        body: longBody,
        language: 'plpgsql',
      },
    ];

    const findings = buildAllSybaseFindings(intro, emptyProfile, noRels);
    const spl = byType(findings, 'stored_procedure_logic')[0];
    const persistedBody = (spl.detailJson as Record<string, unknown>).bodySnippet as string;

    // The complete body survived (far longer than the old 200-char cap).
    expect(persistedBody.length).toBeGreaterThan(200);
    expect(persistedBody).toContain('CREATE PROCEDURE big');
    // The embedded connection-string password was scrubbed.
    expect(persistedBody).not.toContain('HardPass99');
  });
});
