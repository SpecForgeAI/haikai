/**
 * Structural completeness accounting (WS3 P1, 2026-07-31).
 *
 * The live 2026-07-30 pack shipped 0 PKs / 0 FKs / 0 indexes and no code
 * objects — silently. The accounting makes what generation RECEIVED visible
 * (manifest.structural_accounting) and converts suspicious zeros into
 * explicit warnings (manifest.structural_warnings) that the planner turns
 * into prerequisite items.
 */
import {
  accountingFromIr,
  buildStructuralAccounting,
  deriveStructuralWarnings,
  GenerationInputs,
} from '../services/dbMigrationPack/inputs';
import { buildDbMigrationPackArtifacts } from '../services/dbMigrationPackHandler';
import { IrTable, SourceSchemaIr, StructuralAccounting } from '../services/dbMigrationPack/types';

// ---------------------------------------------------------------------------
// Minimal fixtures (accounting reads ONLY model entities + relationships +
// the IR — no engine machinery needed)
// ---------------------------------------------------------------------------

function irTable(name: string, overrides: Partial<IrTable> = {}): IrTable {
  return {
    schemaName: 'dbo',
    tableName: name,
    entityId: `e-${name}`,
    physicalType: 'table',
    objectType: 'table',
    columns: [],
    primaryKey: null,
    uniqueConstraints: [],
    checkConstraints: [],
    indexes: [],
    estimatedRowCount: null,
    findingIds: [],
    ...overrides,
  };
}

function ir(tables: IrTable[], overrides: Partial<SourceSchemaIr> = {}): SourceSchemaIr {
  return {
    sourceEngine: 'sybase_ase',
    targetEngine: 'postgresql',
    tables,
    foreignKeys: [],
    sequences: [],
    untranslated: [],
    dbDecisions: [{ decisionCode: 'db.engine', answerValue: 'PostgreSQL' }],
    resolvedDecisions: {},
    ...overrides,
  };
}

function inputsWith(model: {
  entities?: Array<Record<string, unknown>>;
  relationships?: Array<Record<string, unknown>>;
}): GenerationInputs {
  return {
    model: {
      physicalDataEntities: model.entities ?? [],
      physicalDataAttributes: [],
      dataEntityPoints: [],
      dataEntityRelationships: model.relationships ?? [],
    },
  } as unknown as GenerationInputs;
}

describe('buildStructuralAccounting', () => {
  it('counts what the inputs actually carried', () => {
    const tables = [
      irTable('customers', {
        primaryKey: { name: 'pk', columns: ['id'] },
        uniqueConstraints: [{ name: 'uq', columns: ['email'] }],
        indexes: [
          { name: 'ix1', columns: ['a'], isUnique: false, isClustered: false, columnDirections: null, method: null, predicate: null },
        ],
      }),
      irTable('orders', {
        checkConstraints: [{ name: 'ck', expression: 'x > 0' }],
      }),
      irTable('v_summary', { objectType: 'view' }),
    ];
    const inputs = inputsWith({
      entities: [
        { id: 'e-customers', name: 'dbo.customers', constraints_metadata: { primary_key: { name: 'pk', columns: ['id'] } } },
        { id: 'e-orders', name: 'dbo.orders', constraints_metadata: {} },
        { id: 'e-v', name: 'dbo.v_summary' },
      ],
      relationships: [
        { id: 'r1', fk_columns: { join_columns: ['customer_id'], referenced_columns: ['id'] } },
        { id: 'r2' }, // declared but join-less — emittable FKs exclude it
      ],
    });
    // Findings-channel facts (2026-08-01): a case-insensitive + generated
    // column and one captured sequence, merged onto the IR the way the
    // findings pass does.
    tables[0].columns = [
      {
        schemaName: 'dbo', tableName: 'customers', columnName: 'display_name',
        dataType: 'varchar(80)', maxLength: null, scale: null, precision: null,
        isNullable: true, isPrimaryKey: false, defaultExpression: null,
        ordinalPosition: 2, isIdentity: false, collation: 'nocase',
        collationCaseInsensitive: true, isGenerated: true,
        generationExpression: "upper(first_name)", nonPortableDefault: null,
        attributeId: 'a-1', entityId: 'e-customers', findingIds: ['f-b', 'f-e'],
      },
    ];
    const acc = buildStructuralAccounting(
      inputs,
      ir(tables, {
        untranslated: [{ kind: 'stored_procedure', objectRef: 'dbo.usp_x', findingIds: [] }],
        sequences: [
          {
            schemaName: 'dbo', sequenceName: 'seq_orders', currentValue: '100',
            currentValueAvailable: true, startValue: null, ownedByTable: null,
            ownedByColumn: null, findingIds: ['f-c'],
          },
        ],
      })
    );

    expect(acc.tables_total).toBe(2);
    expect(acc.view_entities_total).toBe(1);
    expect(acc.tables_with_constraints_metadata).toBe(1); // empty {} does not count
    expect(acc.tables_with_primary_key).toBe(1);
    expect(acc.unique_constraints_total).toBe(1);
    expect(acc.check_constraints_total).toBe(1);
    expect(acc.indexes_total).toBe(1);
    expect(acc.relationships_total).toBe(2);
    expect(acc.relationships_with_fk_columns).toBe(1);
    expect(acc.collation_hazard_columns).toBe(1);
    expect(acc.generated_columns).toBe(1);
    expect(acc.sequences_captured).toBe(1);
    expect(acc.code_objects_captured.stored_procedure).toBe(1);
  });
});

describe('deriveStructuralWarnings', () => {
  function acc(overrides: Partial<StructuralAccounting> = {}): StructuralAccounting {
    return {
      tables_total: 65,
      view_entities_total: 0,
      tables_with_constraints_metadata: 65,
      tables_with_primary_key: 60,
      unique_constraints_total: 3,
      check_constraints_total: 2,
      indexes_total: 61,
      relationships_total: 5,
      relationships_with_fk_columns: 5,
      collation_hazard_columns: 12,
      generated_columns: 2,
      sequences_captured: 7,
      code_objects_captured: { stored_procedure: 29, trigger: 0, view: 4, scheduled_job: 0 },
      ...overrides,
    };
  }

  it('is silent for a well-captured source', () => {
    expect(deriveStructuralWarnings(acc())).toEqual([]);
  });

  it('warns when constraints_metadata is absent everywhere (the umbrella case)', () => {
    const warnings = deriveStructuralWarnings(
      acc({ tables_with_constraints_metadata: 0, tables_with_primary_key: 0, indexes_total: 0 })
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('constraints_metadata is absent');
  });

  it('warns on zero PKs and zero indexes when metadata exists', () => {
    const warnings = deriveStructuralWarnings(
      acc({ tables_with_primary_key: 0, indexes_total: 0 })
    );
    expect(warnings.some((w) => w.includes('no table carries a primary key'))).toBe(true);
    expect(warnings.some((w) => w.includes('030-indexes.sql will be EMPTY'))).toBe(true);
  });

  it('warns on join-less relationships (the live EMPTY 020-foreign-keys case)', () => {
    const warnings = deriveStructuralWarnings(acc({ relationships_with_fk_columns: 0 }));
    expect(warnings.some((w) => w.includes('020-foreign-keys.sql will be EMPTY'))).toBe(true);
  });

  it('warns when NO code objects were captured at all (the live 29-procs case)', () => {
    const warnings = deriveStructuralWarnings(
      acc({ code_objects_captured: { stored_procedure: 0, trigger: 0, view: 0, scheduled_job: 0 } })
    );
    expect(warnings.some((w) => w.includes('NO stored-procedure / trigger / view'))).toBe(true);
  });
});

describe('manifest carries the accounting (handler wiring)', () => {
  it('embeds structural_accounting + structural_warnings from the IR', () => {
    const bare = ir([irTable('plain', {
      columns: [],
    })]);
    // Give the table one column so emission has something to do.
    bare.tables[0].columns.push({
      schemaName: 'dbo', tableName: 'plain', columnName: 'id', dataType: 'int',
      maxLength: null, scale: null, precision: null, isNullable: false,
      isPrimaryKey: false, defaultExpression: null, ordinalPosition: 1,
      isIdentity: false, collation: null, collationCaseInsensitive: false,
      isGenerated: false, generationExpression: null, nonPortableDefault: null,
      attributeId: 'a1', entityId: 'e-plain', findingIds: [],
    });

    const artifacts = buildDbMigrationPackArtifacts(bare);

    const acc = artifacts.manifest.structural_accounting!;
    expect(acc.tables_total).toBe(1);
    expect(acc.tables_with_primary_key).toBe(0);
    // No metadata anywhere -> the umbrella warning + the no-code warning.
    expect(artifacts.manifest.structural_warnings!.length).toBeGreaterThanOrEqual(2);
    expect(
      artifacts.manifest.structural_warnings!.some((w) => w.includes('constraints_metadata is absent'))
    ).toBe(true);
  });
});

describe('accountingFromIr fallback', () => {
  it('derives counts from the IR alone', () => {
    const acc = accountingFromIr(
      ir([
        irTable('a', { primaryKey: { name: 'pk', columns: ['id'] } }),
        irTable('b'),
      ], {
        foreignKeys: [
          {
            relationshipId: 'r1', fromSchema: 'dbo', fromTable: 'b', toSchema: 'dbo',
            toTable: 'a', joinColumns: ['a_id'], referencedColumns: ['id'],
            onDelete: null, onUpdate: null,
          },
        ],
      })
    );
    expect(acc.tables_total).toBe(2);
    expect(acc.tables_with_primary_key).toBe(1);
    expect(acc.relationships_with_fk_columns).toBe(1);
  });
});
