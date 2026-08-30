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

/**
 * C1 collision-safety (2026-08-30): the confirmed mapping names ONE table but
 * the same id column lives in several — a sibling holding a HIGHER max means
 * seeding from the mapped table alone re-issues live ids. The seed now takes
 * the GREATEST max across every in-scope carrier; the single-carrier output
 * stays byte-identical.
 */
describe('buildSequenceSeeds — GREATEST across every carrier of the column', () => {
  const col = (name: string) => ({ columnName: name });
  const gen = {
    strategy: 'native',
    name_column: 'SequenceName',
    number_column: 'SequenceNumber',
    decision_ref: 'F-9',
    mappings: [
      { sequence_name: 'WidgetId', table: 'screen_filter', column: 'WidgetId' },
    ],
  };
  const irWith = (tables: Array<Record<string, unknown>>) =>
    ({
      tables,
      foreignKeys: [],
      sequences: [],
      resolvedDecisions: {},
    }) as never;

  it('a sibling carrier joins the seed via GREATEST; the mapped table stays first', () => {
    const { statements } = buildSequenceSeeds(
      irWith([
        baseTable({ sequenceGenerator: gen, tableName: 'seq_registry' }),
        baseTable({ tableName: 'screen_filter', columns: [col('WidgetId')] }),
        baseTable({ tableName: 'view_registry', columns: [col('WidgetId')] }),
      ]),
      100,
      [],
    );
    const widget = statements.find((s) => s.objectRef.includes('WidgetId'));
    expect(widget?.sql).toContain('GREATEST(');
    expect(widget?.sql).toContain('COALESCE((SELECT MAX("WidgetId") FROM "dbo"."screen_filter"), 0)');
    expect(widget?.sql).toContain('COALESCE((SELECT MAX("WidgetId") FROM "dbo"."view_registry"), 0)');
    // Mapped table is the FIRST term.
    expect(widget!.sql!.indexOf('"dbo"."screen_filter"')).toBeLessThan(
      widget!.sql!.indexOf('"dbo"."view_registry"'),
    );
    expect(widget?.note).toContain('GREATEST');
    expect(widget?.note).toContain('dbo.view_registry');
    expect(widget?.note).toContain('re-issue live ids');
  });

  it('tables NOT carrying the column never join the seed', () => {
    const { statements } = buildSequenceSeeds(
      irWith([
        baseTable({ sequenceGenerator: gen, tableName: 'seq_registry' }),
        baseTable({ tableName: 'screen_filter', columns: [col('WidgetId')] }),
        baseTable({ tableName: 'view_registry', columns: [col('WidgetId')] }),
        baseTable({ tableName: 'audit_trail_info', columns: [col('OtherId')] }),
      ]),
      100,
      [],
    );
    const widget = statements.find((s) => s.objectRef.includes('WidgetId'));
    expect(widget?.sql).not.toContain('audit_trail_info');
  });

  it('is symmetric: whichever carrier is the mapped one, BOTH maxes are in the seed', () => {
    const mappedToView = {
      ...gen,
      mappings: [{ sequence_name: 'WidgetId', table: 'view_registry', column: 'WidgetId' }],
    };
    const { statements } = buildSequenceSeeds(
      irWith([
        baseTable({ sequenceGenerator: mappedToView, tableName: 'seq_registry' }),
        baseTable({ tableName: 'screen_filter', columns: [col('WidgetId')] }),
        baseTable({ tableName: 'view_registry', columns: [col('WidgetId')] }),
      ]),
      100,
      [],
    );
    const widget = statements.find((s) => s.objectRef.includes('WidgetId'));
    expect(widget?.sql).toContain('"dbo"."view_registry"');
    expect(widget?.sql).toContain('"dbo"."screen_filter"');
    expect(widget!.sql!.indexOf('"dbo"."view_registry"')).toBeLessThan(
      widget!.sql!.indexOf('"dbo"."screen_filter"'),
    );
  });

  it('a single-carrier column emits the EXACT single-table form (byte-identical)', () => {
    const { statements } = buildSequenceSeeds(
      irWith([
        baseTable({ sequenceGenerator: gen, tableName: 'seq_registry' }),
        baseTable({ tableName: 'screen_filter', columns: [col('WidgetId')] }),
        baseTable({ tableName: 'view_registry', columns: [col('FilterId')] }),
      ]),
      100,
      [],
    );
    const widget = statements.find((s) => s.objectRef.includes('WidgetId'));
    expect(widget?.sql).toBe(
      'CREATE SEQUENCE IF NOT EXISTS "widgetid_seq";\n' +
        `SELECT setval('widgetid_seq', (SELECT COALESCE(MAX("WidgetId"), 0) + 1 ` +
        'FROM "dbo"."screen_filter"), false);',
    );
    expect(widget?.note).toBe('seeded from loaded screen_filter.WidgetId max+1 (F-9).');
  });
});
