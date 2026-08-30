/**
 * C5 (2026-08-30): a UNIQUE constraint identical to the PRIMARY KEY (same
 * columns, same order) is suppressed with a provenance comment — Postgres
 * backs each with its own btree index, so the pair is two identical indexes:
 * double write cost and storage, no added guarantee. A different column ORDER
 * is a distinct index prefix and is deliberately KEPT; a UNIQUE naming absent
 * columns is claimed by the PRE-EXISTING dropped-key (pk_composition) path
 * first — the redundancy check never shadows that gate.
 */

import { emitTableChangeset, EmittableColumn } from '../services/dbMigrationPack/liquibase';
import { IrTable } from '../services/dbMigrationPack/types';

function makeColumn(name: string): EmittableColumn {
  return {
    columnName: name,
    postgresType: 'integer',
    isNullable: false,
    isIdentity: false,
    defaultExpression: null,
    generationExpression: null,
  };
}

function makeTable(overrides: Partial<IrTable> = {}): IrTable {
  return {
    schemaName: 'dbo',
    tableName: 'screen_filter',
    entityId: 'pde-1',
    physicalType: 'Table',
    objectType: 'table',
    columns: [],
    primaryKey: null,
    uniqueConstraints: [],
    checkConstraints: [],
    indexes: [],
    estimatedRowCount: null,
    findingIds: [],
    ...overrides,
  } as IrTable;
}

const COLS = ['FilterId', 'ValidTo', 'ValidFrom'].map(makeColumn);

function emit(table: IrTable, resolved?: Record<string, Record<string, unknown>>): string {
  return emitTableChangeset({
    table,
    columns: COLS,
    omitted: [],
    skipped: [],
    resolvedDecisions: resolved,
  });
}

describe('emitTableChangeset — redundant PK+UNIQUE suppression', () => {
  const pk = { name: 'screen_filter_pk', columns: ['FilterId', 'ValidTo', 'ValidFrom'] };

  it('suppresses a UNIQUE identical to the PK (same columns, same order) with a loud comment', () => {
    const content = emit(
      makeTable({
        primaryKey: pk,
        uniqueConstraints: [{ name: 'screen_filter_ak1', columns: ['FilterId', 'ValidTo', 'ValidFrom'] }],
      }),
    );

    expect(content).toContain('PRIMARY KEY ("FilterId", "ValidTo", "ValidFrom")');
    expect(content).not.toContain('CONSTRAINT "screen_filter_ak1" UNIQUE');
    expect(content).toContain(
      '-- REDUNDANT UNIQUE dbo.screen_filter.screen_filter_ak1 (FilterId, ValidTo, ValidFrom) NOT emitted',
    );
    expect(content).toContain('identical to PRIMARY KEY screen_filter_pk');
    expect(content).toContain('SEPARATE btree indexes');
    expect(content).toContain('fully preserved by the primary key');
  });

  it('KEEPS a UNIQUE over the same columns in a DIFFERENT order (distinct index prefix)', () => {
    const content = emit(
      makeTable({
        primaryKey: pk,
        uniqueConstraints: [{ name: 'screen_filter_ak1', columns: ['ValidTo', 'FilterId', 'ValidFrom'] }],
      }),
    );
    expect(content).toContain('CONSTRAINT "screen_filter_ak1" UNIQUE ("ValidTo", "FilterId", "ValidFrom")');
    expect(content).not.toContain('REDUNDANT UNIQUE');
  });

  it('KEEPS a UNIQUE over a different column set', () => {
    const content = emit(
      makeTable({
        primaryKey: pk,
        uniqueConstraints: [{ name: 'screen_filter_ak1', columns: ['FilterId', 'ValidTo'] }],
      }),
    );
    expect(content).toContain('CONSTRAINT "screen_filter_ak1" UNIQUE ("FilterId", "ValidTo")');
    expect(content).not.toContain('REDUNDANT UNIQUE');
  });

  it('KEEPS every UNIQUE when the table has no PK', () => {
    const content = emit(
      makeTable({
        primaryKey: null,
        uniqueConstraints: [{ name: 'screen_filter_ak1', columns: ['FilterId', 'ValidTo', 'ValidFrom'] }],
      }),
    );
    expect(content).toContain('CONSTRAINT "screen_filter_ak1" UNIQUE');
    expect(content).not.toContain('REDUNDANT UNIQUE');
  });

  it('differing-case members are claimed by the case-sensitive dropped-key gate FIRST (real behaviour)', () => {
    // presentColumns is deliberately case-sensitive in the pk_composition
    // gate, so a UNIQUE whose members are spelled in a different case never
    // reaches the redundancy check — it raises the NEEDS DECISION instead.
    // (The redundancy compare itself is case-insensitive as cheap defence,
    // but this pins the actual routing rather than bending the code.)
    const content = emit(
      makeTable({
        primaryKey: pk,
        uniqueConstraints: [{ name: 'screen_filter_ak1', columns: ['filterid', 'validto', 'validfrom'] }],
      }),
    );
    expect(content).toContain("NEEDS DECISION (pk_composition): UNIQUE 'screen_filter_ak1'");
    expect(content).not.toContain('REDUNDANT UNIQUE');
  });

  it('suppresses on the emit_over_present_members path when the KEPT members equal the kept PK', () => {
    // Both the PK and the UNIQUE name a dropped column; both resolutions keep
    // present members only -> both reduce to (FilterId, ValidTo) -> redundant.
    const table = makeTable({
      primaryKey: { name: 'screen_filter_pk', columns: ['FilterId', 'ValidTo', 'Dropped'] },
      uniqueConstraints: [{ name: 'screen_filter_ak1', columns: ['FilterId', 'ValidTo', 'Dropped'] }],
    });
    const content = emit(table, {
      'pk_composition--dbo.screen_filter--screen_filter_pk': {
        option: 'emit_over_present_members',
      },
      'pk_composition--dbo.screen_filter--screen_filter_ak1': {
        option: 'emit_over_present_members',
      },
    });
    expect(content).toContain('PRIMARY KEY ("FilterId", "ValidTo")');
    expect(content).not.toContain('CONSTRAINT "screen_filter_ak1" UNIQUE');
    expect(content).toContain('REDUNDANT UNIQUE dbo.screen_filter.screen_filter_ak1 (FilterId, ValidTo)');
  });

  it('a UNIQUE naming ABSENT columns is claimed by the dropped-key gate FIRST, never the redundancy path', () => {
    const content = emit(
      makeTable({
        primaryKey: { name: 'screen_filter_pk', columns: ['FilterId'] },
        uniqueConstraints: [{ name: 'screen_filter_ak1', columns: ['Ghost'] }],
      }),
    );
    expect(content).toContain("NEEDS DECISION (pk_composition): UNIQUE 'screen_filter_ak1'");
    expect(content).not.toContain('REDUNDANT UNIQUE');
  });
});
