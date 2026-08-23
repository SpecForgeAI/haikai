/**
 * Surrogate identity PK — the "modern DBA" target fix (2026-08-08).
 *
 * Tables with no source primary key get ONE pack-wide `surrogate_pk`
 * decision; resolving `add_surrogate_identity_pk` gives each a target-only
 * `BIGINT GENERATED ALWAYS AS IDENTITY` PK. Pins the honesty seams:
 *
 *   - the column/key are `isSurrogate`-flagged end-to-end (IR -> DDL ->
 *     expected schema) so source-facing consumers can exclude them;
 *   - the name cascade (`id` -> `row_id` -> `haikai_row_id`) never collides;
 *   - delta-key detection NEVER picks the surrogate (the source has no such
 *     column to read a high-water from);
 *   - NO sequence-seed decision is raised for it (no source values loaded);
 *   - the no_primary_keys finding stops firing once the surrogate applies
 *     (the generator stays the only resolution oracle) and keeps firing on
 *     `leave_without_pk`;
 *   - parity keying skips surrogate PKs (values are generated independently
 *     per side — the keyed join would match nothing).
 */

import {
  applySurrogatePkDecision,
  buildSourceSchemaIr,
  deriveStructuralFindings,
  GenerationInputs,
  SURROGATE_PK_DECISION_KEY,
} from '../services/dbMigrationPack/inputs';
import { detectDeltaKey } from '../services/dbMigrationPack/dataScripts';
import { buildDbMigrationPackArtifacts } from '../services/dbMigrationPackHandler';
import { defaultResolveDataParityTables } from '../services/migrationDataParityReconcile';
import type { IrTable } from '../services/dbMigrationPack/types';

// ---------------------------------------------------------------------------
// Fixture: one keyed table + two no-PK heaps (one already owns a column
// named `id`, exercising the name cascade).
// ---------------------------------------------------------------------------

function makeInputs(resolved: GenerationInputs['resolvedPackDecisions'] = []): GenerationInputs {
  return {
    model: {
      physicalDataEntities: [
        {
          id: 'e-keyed',
          name: 'dbo.keyed',
          physical_type: 'table',
          constraints_metadata: {
            primary_key: { name: 'pk_keyed', columns: ['keyed_id'] },
            unique_constraints: [],
            check_constraints: [],
            indexes: [],
          },
        },
        {
          id: 'e-heap1',
          name: 'dbo.heap1',
          physical_type: 'table',
          constraints_metadata: {
            unique_constraints: [],
            check_constraints: [],
            indexes: [],
          },
        },
        {
          id: 'e-heap2',
          name: 'dbo.heap2',
          physical_type: 'table',
          constraints_metadata: {
            unique_constraints: [],
            check_constraints: [],
            indexes: [],
          },
        },
      ],
      physicalDataAttributes: [
        { id: 'a-k-1', name: 'keyed_id', physical_entity_id: 'e-keyed', source_type: 'int', is_nullable: false, is_identity: true, ordinal: 1 },
        { id: 'a-k-2', name: 'label', physical_entity_id: 'e-keyed', source_type: 'varchar(50)', is_nullable: false, ordinal: 2 },
        { id: 'a-h1-1', name: 'payload', physical_entity_id: 'e-heap1', source_type: 'varchar(100)', is_nullable: true, ordinal: 1 },
        { id: 'a-h1-2', name: 'amount', physical_entity_id: 'e-heap1', source_type: 'numeric', precision: 10, scale: 2, is_nullable: false, ordinal: 2 },
        // heap2 already owns `id` -> the cascade must pick `row_id`.
        { id: 'a-h2-1', name: 'id', physical_entity_id: 'e-heap2', source_type: 'varchar(20)', is_nullable: false, ordinal: 1 },
        { id: 'a-h2-2', name: 'note', physical_entity_id: 'e-heap2', source_type: 'varchar(200)', is_nullable: true, ordinal: 2 },
      ],
      dataEntityPoints: [],
      dataEntityRelationships: [],
    },
    findings: [],
    dbDecisions: [
      { decisionCode: 'db.engine', answerValue: 'PostgreSQL' },
      { decisionCode: 'db.migrations', answerValue: 'Liquibase' },
    ],
    resolvedPackDecisions: resolved,
  };
}

const RESOLVED_ADD = [
  {
    decision_key: SURROGATE_PK_DECISION_KEY,
    status: 'resolved',
    resolution_json: { option: 'add_surrogate_identity_pk' },
  },
] as GenerationInputs['resolvedPackDecisions'];

describe('applySurrogatePkDecision (unit)', () => {
  function heap(tableName: string, columnNames: string[]): IrTable {
    return {
      schemaName: 'dbo',
      tableName,
      entityId: `e-${tableName}`,
      physicalType: 'table',
      objectType: 'table',
      columns: columnNames.map((name, i) => ({
        schemaName: 'dbo',
        tableName,
        columnName: name,
        dataType: 'varchar(10)',
        maxLength: 10,
        scale: null,
        precision: null,
        isNullable: true,
        isPrimaryKey: false,
        defaultExpression: null,
        ordinalPosition: i + 1,
        isIdentity: false,
        collation: null,
        collationCaseInsensitive: false,
        isGenerated: false,
        generationExpression: null,
        nonPortableDefault: null,
        attributeId: `a-${tableName}-${i}`,
        entityId: `e-${tableName}`,
        findingIds: [],
      })),
      primaryKey: null,
      uniqueConstraints: [],
      checkConstraints: [],
      indexes: [],
      estimatedRowCount: null,
      findingIds: [],
    };
  }

  it('injects an isSurrogate identity PK per no-PK table with the id -> row_id -> haikai_row_id cascade', () => {
    const tables = [heap('plain', ['payload']), heap('has_id', ['id']), heap('has_both', ['id', 'row_id'])];
    const outcome = applySurrogatePkDecision(tables, {
      [SURROGATE_PK_DECISION_KEY]: { option: 'add_surrogate_identity_pk' },
    });
    expect(outcome.added).toEqual(['dbo.has_both', 'dbo.has_id', 'dbo.plain']);
    expect(outcome.skipped).toEqual([]);
    const byName = new Map(tables.map((t) => [t.tableName, t]));
    expect(byName.get('plain')!.primaryKey).toEqual({
      name: 'pk_plain_surrogate',
      columns: ['id'],
      isSurrogate: true,
    });
    expect(byName.get('has_id')!.primaryKey!.columns).toEqual(['row_id']);
    expect(byName.get('has_both')!.primaryKey!.columns).toEqual(['haikai_row_id']);
    const injected = byName.get('plain')!.columns.find((c) => c.columnName === 'id')!;
    expect(injected.isSurrogate).toBe(true);
    expect(injected.isIdentity).toBe(true);
    expect(injected.dataType).toBe('bigint');
    expect(injected.isNullable).toBe(false);
  });

  it('is a no-op without a resolution or on leave_without_pk, and never touches keyed tables', () => {
    const keyed = heap('keyed', ['a']);
    keyed.primaryKey = { name: 'pk_keyed', columns: ['a'] };
    const none = applySurrogatePkDecision([heap('h', ['x']), keyed], {});
    expect(none.added).toEqual([]);
    const leave = applySurrogatePkDecision([heap('h', ['x'])], {
      [SURROGATE_PK_DECISION_KEY]: { option: 'leave_without_pk' },
    });
    expect(leave.added).toEqual([]);
    const applied = applySurrogatePkDecision([keyed], {
      [SURROGATE_PK_DECISION_KEY]: { option: 'add_surrogate_identity_pk' },
    });
    expect(applied.added).toEqual([]);
    expect(keyed.primaryKey!.isSurrogate).toBeUndefined();
  });

  it('demote_tables demotes a declared-but-invalid PK to a NON-UNIQUE index and adds the surrogate (2026-08-12)', () => {
    // The live 6-table class: the pack declared a PK the source data does
    // not satisfy (duplicate tuples / NULL key members) — the bulk-load
    // preflight names exactly this remedy.
    const invalid = heap('org_registry', ['HierarchyId', 'ValidFrom', 'payload']);
    invalid.primaryKey = { name: 'pk_org_registry', columns: ['HierarchyId', 'ValidFrom'] };
    const untouched = heap('keyed_fine', ['a']);
    untouched.primaryKey = { name: 'pk_keyed_fine', columns: ['a'] };

    const outcome = applySurrogatePkDecision([invalid, untouched], {
      [SURROGATE_PK_DECISION_KEY]: {
        option: 'add_surrogate_identity_pk',
        demote_tables: ['DBO.ORG_REGISTRY'], // case-insensitive match
      },
    });

    expect(outcome.demoted).toEqual(['dbo.org_registry']);
    expect(outcome.added).toContain('dbo.org_registry');
    // Natural key survives as a NON-UNIQUE index (still the load order key).
    expect(invalid.indexes).toEqual([
      expect.objectContaining({
        name: 'ix_org_registry_natural_key',
        columns: ['HierarchyId', 'ValidFrom'],
        isUnique: false,
      }),
    ]);
    // The table now carries the surrogate identity PK.
    expect(invalid.primaryKey).toEqual(
      expect.objectContaining({ isSurrogate: true, columns: ['id'] }),
    );
    // A table NOT named in demote_tables keeps its real PK untouched.
    expect(untouched.primaryKey).toEqual({ name: 'pk_keyed_fine', columns: ['a'] });
  });

  it('demote_tables also accepts a comma-separated STRING (the UI detail-field wire form)', () => {
    const a = heap('t_a', ['k', 'v']);
    a.primaryKey = { name: 'pk_a', columns: ['k'] };
    const b = heap('t_b', ['k', 'v']);
    b.primaryKey = { name: 'pk_b', columns: ['k'] };
    const outcome = applySurrogatePkDecision([a, b], {
      [SURROGATE_PK_DECISION_KEY]: {
        option: 'add_surrogate_identity_pk',
        demote_tables: ' dbo.t_a , dbo.t_b ',
      },
    });
    expect(outcome.demoted).toEqual(['dbo.t_a', 'dbo.t_b']);
    expect(a.primaryKey).toEqual(expect.objectContaining({ isSurrogate: true }));
    expect(b.primaryKey).toEqual(expect.objectContaining({ isSurrogate: true }));
  });
});

describe('surrogate PK end-to-end (decision -> DDL -> expected schema -> findings)', () => {
  it('UNRESOLVED: raises ONE pack-wide surrogate_pk decision naming the heaps; no_primary_keys still fires', () => {
    const ir = buildSourceSchemaIr(makeInputs());
    const artifacts = buildDbMigrationPackArtifacts(ir);
    const decision = artifacts.decisions.find((d) => d.decisionKey === SURROGATE_PK_DECISION_KEY);
    expect(decision).toBeDefined();
    expect(decision!.category).toBe('surrogate_pk');
    expect(decision!.options).toEqual(['add_surrogate_identity_pk', 'leave_without_pk']);
    expect(decision!.question).toContain('dbo.heap1');
    expect(decision!.question).toContain('dbo.heap2');
    expect(decision!.question).not.toContain('dbo.keyed');
    const findings = deriveStructuralFindings(ir.structuralAccounting!);
    expect(findings.some((f) => f.kind === 'no_primary_keys')).toBe(true);
  });

  it('RESOLVED add: emits the identity PK DDL, flags expected schema, clears the finding, raises no seed decision, never re-raises', () => {
    const ir = buildSourceSchemaIr(makeInputs(RESOLVED_ADD));
    const heap1 = ir.tables.find((t) => t.tableName === 'heap1')!;
    expect(heap1.primaryKey).toEqual({
      name: 'pk_heap1_surrogate',
      columns: ['id'],
      isSurrogate: true,
    });

    const artifacts = buildDbMigrationPackArtifacts(ir);
    // The decision is resolved — never re-raised.
    expect(artifacts.decisions.find((d) => d.decisionKey === SURROGATE_PK_DECISION_KEY)).toBeUndefined();
    // No sequence-seed decision for a surrogate (no source values loaded).
    expect(
      artifacts.decisions.filter((d) => d.decisionKey.startsWith('sequence_seed--dbo.heap')),
    ).toEqual([]);

    // DDL: identity column + PK constraint present in the heap1 changeset.
    const ddl = artifacts.files
      .filter((f) => f.filePath.includes('heap1'))
      .map((f) => f.content)
      .join('\n');
    expect(ddl).toContain('GENERATED ALWAYS AS IDENTITY');
    expect(ddl).toContain('pk_heap1_surrogate');

    // Expected schema: column + key entries carry the surrogate flag.
    const cols = artifacts.manifest.expected_schema!.columns.filter(
      (c) => c.tableName === 'heap1' && c.columnName === 'id',
    );
    expect(cols).toHaveLength(1);
    expect(cols[0].isSurrogate).toBe(true);
    expect(cols[0].isIdentity).toBe(true);
    expect(cols[0].isPrimaryKey).toBe(true);
    const pkEntries = artifacts.manifest.expected_schema!.keysAndIndexes.filter(
      (k) => k.kind === 'primary_key' && k.tableName === 'heap1',
    );
    expect(pkEntries).toHaveLength(1);
    expect(pkEntries[0].isSurrogate).toBe(true);
    // The REAL pk on dbo.keyed carries no surrogate flag.
    const keyedPk = artifacts.manifest.expected_schema!.keysAndIndexes.find(
      (k) => k.kind === 'primary_key' && k.tableName === 'keyed',
    )!;
    expect(keyedPk.isSurrogate).toBeUndefined();

    // The finding's premise is gone — the generator resolves it, not a flag.
    const findings = deriveStructuralFindings(ir.structuralAccounting!);
    expect(findings.some((f) => f.kind === 'no_primary_keys')).toBe(false);
  });

  it('RESOLVED leave_without_pk: no injection, the finding keeps firing, the decision is not re-raised', () => {
    const ir = buildSourceSchemaIr(
      makeInputs([
        {
          decision_key: SURROGATE_PK_DECISION_KEY,
          status: 'resolved',
          resolution_json: { option: 'leave_without_pk' },
        },
      ] as GenerationInputs['resolvedPackDecisions']),
    );
    expect(ir.tables.find((t) => t.tableName === 'heap1')!.primaryKey).toBeNull();
    const artifacts = buildDbMigrationPackArtifacts(ir);
    expect(artifacts.decisions.find((d) => d.decisionKey === SURROGATE_PK_DECISION_KEY)).toBeUndefined();
    const findings = deriveStructuralFindings(ir.structuralAccounting!);
    expect(findings.some((f) => f.kind === 'no_primary_keys')).toBe(true);
  });

  it('delta-key detection NEVER picks the surrogate identity (source cannot be read by it)', () => {
    const ir = buildSourceSchemaIr(makeInputs(RESOLVED_ADD));
    const heap1 = ir.tables.find((t) => t.tableName === 'heap1')!;
    const detection = detectDeltaKey(heap1);
    expect(detection.deltaKey).not.toBe('id');
    expect(detection.strategy).toBe('needs_decision');
  });
});

describe('parity keying skips surrogate PKs', () => {
  it('threads real PKs as primaryKey but treats surrogate-PK tables as keyless (multiset fallback)', async () => {
    const manifest = {
      bulk_load: { table_order: ['dbo.keyed', 'dbo.heap1'] },
      expected_schema: {
        tables: [
          { schemaName: 'dbo', tableName: 'keyed' },
          { schemaName: 'dbo', tableName: 'heap1' },
        ],
        columns: [],
        keysAndIndexes: [
          {
            schemaName: 'dbo', tableName: 'keyed', kind: 'primary_key', name: 'pk_keyed',
            columns: ['keyed_id'], referencedSchema: null, referencedTable: null,
            referencedColumns: null, onDelete: null, onUpdate: null, isUnique: true,
            columnDirections: null,
          },
          {
            schemaName: 'dbo', tableName: 'heap1', kind: 'primary_key', name: 'pk_heap1_surrogate',
            columns: ['id'], referencedSchema: null, referencedTable: null,
            referencedColumns: null, onDelete: null, onUpdate: null, isUnique: true,
            columnDirections: null, isSurrogate: true,
          },
        ],
        sequences: [],
      },
    };
    const tables = await defaultResolveDataParityTables(
      'proj-1',
      'arch-1',
      (async () => ({ manifest })) as never,
    );
    const byTable = new Map(tables.map((t) => [t.table, t]));
    expect(byTable.get('keyed')!.primaryKey).toEqual(['keyed_id']);
    expect(byTable.get('heap1')!.primaryKey).toBeUndefined();
  });
});
