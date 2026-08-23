/**
 * Sequence-generator emission (Oracle Nine item 2): the legacy sequence
 * TABLE + increment proc has no identity columns to translate — the
 * foundations decision materializes on the table's constraints_metadata and
 * the pack emits explicit sequences seeded from LOADED data (setval max+1),
 * plus the optional read-compatibility view.
 */
import { buildSequenceSeeds } from '../services/dbMigrationPackHandler';

const baseTable = (over: Record<string, unknown>) => ({
  schemaName: 'dbo',
  tableName: 'seq_registry',
  entityId: 'e1',
  physicalType: 'Table',
  objectType: 'table',
  columns: [],
  primaryKey: null,
  uniqueConstraints: [],
  checkConstraints: [],
  indexes: [],
  ...over,
});

const IR = (gen: Record<string, unknown> | null) =>
  ({
    tables: [
      baseTable({ sequenceGenerator: gen }),
      baseTable({ tableName: 'screen_filter', sequenceGenerator: null }),
    ],
    foreignKeys: [],
    sequences: [],
    resolvedDecisions: {},
  }) as never;

describe('buildSequenceSeedStatements — sequence-generator idiom', () => {
  it('native strategy emits CREATE SEQUENCE + setval from loaded max per mapping', () => {
    const { statements } = buildSequenceSeeds(
      IR({
        strategy: 'native',
        name_column: 'SequenceName',
        number_column: 'SequenceNumber',
        decision_ref: 'F-9',
        mappings: [
          { sequence_name: 'WidgetId', current_value: 4592, table: 'screen_filter', column: 'WidgetId' },
          { sequence_name: 'Orphan', current_value: 7, table: null, column: null },
        ],
      }),
      100,
      [],
    );
    const widget = statements.find((s) => s.objectRef.includes('WidgetId'));
    expect(widget?.sql).toContain('CREATE SEQUENCE IF NOT EXISTS "widgetid_seq"');
    expect(widget?.sql).toContain("setval('widgetid_seq'");
    expect(widget?.sql).toContain('COALESCE(MAX("WidgetId"), 0) + 1');
    const orphan = statements.find((s) => s.objectRef.includes('Orphan'));
    expect(orphan?.sql).toBeNull();
    expect(orphan?.note).toContain('NO confirmed table.column mapping');
  });

  it('native_with_view additionally emits the compatibility view; table_emulation emits a note only', () => {
    const withView = buildSequenceSeeds(
      IR({
        strategy: 'native_with_view',
        name_column: 'SequenceName',
        number_column: 'SequenceNumber',
        mappings: [
          { sequence_name: 'WidgetId', table: 'screen_filter', column: 'WidgetId' },
        ],
      }),
      100,
      [],
    ).statements;
    const view = withView.find((s) => s.objectRef.includes('compatibility view'));
    expect(view?.sql).toContain('CREATE OR REPLACE VIEW');
    expect(view?.sql).toContain('last_value AS "SequenceNumber"');

    const emulated = buildSequenceSeeds(
      IR({ strategy: 'table_emulation', mappings: [] }),
      100,
      [],
    ).statements;
    expect(emulated.some((s) => s.sql === null && (s.note ?? '').includes('table_emulation'))).toBe(
      true,
    );
  });
});
