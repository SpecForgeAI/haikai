/**
 * SQL Server 16 -> PostgreSQL 18 pack generation (pair programme, Spec 5).
 *
 * The fixture below is the gateway-side twin of the S2 discovery fixtures
 * `discovery-service/src/__tests__/fixtures/mssql/hard-features-introspect.json`
 * and `wwi-introspect.json`: the same schemas, tables, columns, index shapes
 * and extended objects, expressed in the shapes the GENERATOR consumes —
 * the committed AMS physical model (`physical_data_entities` /
 * `physical_data_attributes` / relationship `fk_columns`) plus the persisted
 * discovery findings that carry the facts the committed model cannot
 * (collation, temporal periods, feature objects, sequence high-water marks).
 * Offline: no network, no live SQL Server (there is none — shaping §7).
 *
 * What is pinned here is the whole of Spec 5 end to end:
 *   5.1 the engine gate + the SQL Server system-object filter + the IR fields;
 *   5.2 the type table (incl. datetime2(7) precision loss and the feature
 *       decisions that ride a default mapping);
 *   5.3 filtered -> partial index, INCLUDE, columnstore/full-text methods,
 *       identity seed/increment, persisted vs VIRTUAL computed columns,
 *       FK SET DEFAULT, NOT VALID for an untrusted constraint;
 *   5.4 the pack-wide collation posture (citext default, ICU alternative);
 *   5.5 every item-5 object either EMULATED or an open decision with options;
 *   5.6 the SQL Server extract expressions + the sqlcmd reconciliation form;
 *   5.7 the engine-keyed system-reference gate.
 *
 * The Sybase corpus is the regression gate for all of it and is untouched.
 */

import {
  buildDbMigrationPackArtifacts,
  buildSourceSchemaIr,
  GenerationInputs,
  UnsupportedEnginePairError,
} from '../services/dbMigrationPackHandler';
import type {
  RawDiscoveryFinding,
  RawResolvedPackDecision,
} from '../services/dbMigrationPack/inputs';
import { mapSourceType, rewriteIifCalls } from '../services/dbMigrationPack/typeMapping';
import {
  findSystemReferences,
  isSystemObjectFor,
} from '../services/dbMigrationPack/systemObjects';
import { planBulkColumns } from '../services/dbMigrationPack/dataScripts';
import { TRANSLATION_KINDS, kindInstructions } from '../services/dbMigrationPack/translations';
import { NEUTRAL_TRANSLATION_PROFILE } from '../services/dbMigrationPack/translationProfile';
import type { PackManifest } from '../services/dbMigrationPack/types';

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const ENGINE = { engineKey: 'mssql' } as const;

function finding(
  id: string,
  finding_type: string,
  detail: Record<string, unknown>,
): RawDiscoveryFinding {
  return { id, finding_type, detail_json: { ...ENGINE, ...detail } };
}

function makeInputs(overrides?: {
  resolved?: RawResolvedPackDecision[];
  extraFindings?: RawDiscoveryFinding[];
}): GenerationInputs {
  return {
    model: {
      physicalDataEntities: [
        {
          id: 'e-postings',
          name: 'Ledger.Postings',
          physical_type: 'table',
          constraints_metadata: {
            primary_key: { name: 'PK_Ledger_Postings', columns: ['PostingID'] },
            unique_constraints: [],
            check_constraints: [
              { name: 'CK_Postings_Amount', expression: 'Amount >= 0' },
              // NOT TRUSTED at source (WITH NOCHECK): must emit NOT VALID.
              {
                name: 'CK_Postings_PostedBy',
                expression: 'len(PostedBy) > 0',
                is_not_trusted: true,
              },
            ],
            indexes: [
              {
                name: 'IX_Ledger_Postings_Active',
                columns: ['PostedBy'],
                is_unique: false,
                is_clustered: false,
                column_directions: ['ASC'],
                method: 'nonclustered',
                // A FILTERED index with a portable predicate -> partial index.
                predicate: 'IsVoided = 0',
                include_columns: ['PostingID'],
              },
              {
                name: 'IX_Ledger_Postings_Exotic',
                columns: ['PostedBy'],
                is_unique: false,
                method: 'nonclustered',
                // A predicate the deterministic translator refuses.
                predicate: "isdate(PostedOn) = 1",
              },
            ],
          },
        },
        {
          id: 'e-sensor',
          name: 'Ops.SensorArchive',
          physical_type: 'table',
          constraints_metadata: {
            primary_key: { name: 'PK_Ops_SensorArchive', columns: ['SensorArchiveID'] },
            unique_constraints: [],
            check_constraints: [],
            indexes: [
              {
                name: 'CCI_Ops_SensorArchive',
                columns: ['ReadingNote'],
                is_unique: false,
                method: 'clustered_columnstore',
              },
              {
                name: 'FT_Ops_SensorArchive_ReadingNote',
                columns: ['ReadingNote'],
                is_unique: false,
                method: 'fulltext',
              },
            ],
          },
        },
        {
          id: 'e-account',
          name: 'Ledger.Account',
          physical_type: 'table',
          constraints_metadata: {
            primary_key: { name: 'PK_Ledger_Account', columns: ['AccountID'] },
            unique_constraints: [],
            check_constraints: [],
            indexes: [],
          },
        },
        {
          id: 'e-account-history',
          name: 'Ledger.AccountHistory',
          physical_type: 'table',
          constraints_metadata: {
            primary_key: null,
            unique_constraints: [],
            check_constraints: [],
            indexes: [],
          },
        },
        // A SQL Server system object: NEVER migrated app schema.
        {
          id: 'e-sysdiagrams',
          name: 'dbo.sysdiagrams',
          physical_type: 'table',
          constraints_metadata: null,
        },
        {
          id: 'e-sysobjects',
          name: 'sys.objects',
          physical_type: 'view',
          constraints_metadata: null,
        },
      ],
      physicalDataAttributes: [
        // Ledger.Postings — one column per item-5 / type-table row.
        { id: 'a-p-1', name: 'PostingID', physical_entity_id: 'e-postings', source_type: 'bigint', is_nullable: false, is_identity: true, is_primary_key: true, ordinal: 1 },
        { id: 'a-p-2', name: 'PostedBy', physical_entity_id: 'e-postings', source_type: 'nvarchar(60)', is_nullable: false, ordinal: 2 },
        { id: 'a-p-3', name: 'IsVoided', physical_entity_id: 'e-postings', source_type: 'bit', is_nullable: false, ordinal: 3 },
        { id: 'a-p-4', name: 'PayloadDocument', physical_entity_id: 'e-postings', source_type: 'xml', is_nullable: true, ordinal: 4 },
        { id: 'a-p-5', name: 'LooseValue', physical_entity_id: 'e-postings', source_type: 'sql_variant', is_nullable: true, ordinal: 5 },
        { id: 'a-p-6', name: 'OrgNode', physical_entity_id: 'e-postings', source_type: 'hierarchyid', is_nullable: true, ordinal: 6 },
        { id: 'a-p-7', name: 'SiteShape', physical_entity_id: 'e-postings', source_type: 'geometry', is_nullable: true, ordinal: 7 },
        { id: 'a-p-8', name: 'ScannedDocument', physical_entity_id: 'e-postings', source_type: 'varbinary(max)', is_nullable: true, ordinal: 8 },
        { id: 'a-p-9', name: 'RowGuid', physical_entity_id: 'e-postings', source_type: 'uniqueidentifier', is_nullable: false, column_default: '(newid())', ordinal: 9 },
        { id: 'a-p-10', name: 'PostedOn', physical_entity_id: 'e-postings', source_type: 'datetime2(7)', is_nullable: false, ordinal: 10 },
        { id: 'a-p-11', name: 'PostedOffset', physical_entity_id: 'e-postings', source_type: 'datetimeoffset(7)', is_nullable: true, ordinal: 11 },
        { id: 'a-p-12', name: 'Amount', physical_entity_id: 'e-postings', source_type: 'money', is_nullable: false, ordinal: 12 },
        { id: 'a-p-13', name: 'ShortCode', physical_entity_id: 'e-postings', source_type: 'char(8)', is_nullable: true, ordinal: 13 },
        { id: 'a-p-14', name: 'DisplayName', physical_entity_id: 'e-postings', source_type: 'nvarchar(max)', is_nullable: true, ordinal: 14 },
        { id: 'a-p-15', name: 'RowVersion', physical_entity_id: 'e-postings', source_type: 'rowversion', is_nullable: true, ordinal: 15 },
        { id: 'a-p-16', name: 'Tier', physical_entity_id: 'e-postings', source_type: 'tinyint', is_nullable: true, ordinal: 16 },
        // Ops.SensorArchive
        { id: 'a-s-1', name: 'SensorArchiveID', physical_entity_id: 'e-sensor', source_type: 'bigint', is_nullable: false, is_identity: true, is_primary_key: true, ordinal: 1 },
        { id: 'a-s-2', name: 'ReadingNote', physical_entity_id: 'e-sensor', source_type: 'nvarchar(400)', is_nullable: true, ordinal: 2 },
        { id: 'a-s-3', name: 'ReadingSummary', physical_entity_id: 'e-sensor', source_type: 'nvarchar(80)', is_nullable: true, ordinal: 3 },
        { id: 'a-s-4', name: 'UpdatedAt', physical_entity_id: 'e-sensor', source_type: 'datetime2(3)', is_nullable: false, ordinal: 4 },
        // Ledger.Account — the SYSTEM_VERSIONED half of a temporal pair.
        { id: 'a-a-1', name: 'AccountID', physical_entity_id: 'e-account', source_type: 'int', is_nullable: false, is_identity: true, is_primary_key: true, ordinal: 1 },
        { id: 'a-a-2', name: 'Balance', physical_entity_id: 'e-account', source_type: 'decimal', precision: 19, scale: 4, is_nullable: false, ordinal: 2 },
        { id: 'a-a-3', name: 'ValidFrom', physical_entity_id: 'e-account', source_type: 'datetime2(7)', is_nullable: false, ordinal: 3 },
        { id: 'a-a-4', name: 'ValidTo', physical_entity_id: 'e-account', source_type: 'datetime2(7)', is_nullable: false, ordinal: 4 },
        // Ledger.AccountHistory — its history half, an ordinary loaded table.
        { id: 'a-h-1', name: 'AccountID', physical_entity_id: 'e-account-history', source_type: 'int', is_nullable: false, ordinal: 1 },
        { id: 'a-h-2', name: 'Balance', physical_entity_id: 'e-account-history', source_type: 'decimal', precision: 19, scale: 4, is_nullable: false, ordinal: 2 },
        { id: 'a-h-3', name: 'ValidFrom', physical_entity_id: 'e-account-history', source_type: 'datetime2(7)', is_nullable: false, ordinal: 3 },
        { id: 'a-h-4', name: 'ValidTo', physical_entity_id: 'e-account-history', source_type: 'datetime2(7)', is_nullable: false, ordinal: 4 },
        // System objects (excluded before any column is read).
        { id: 'a-sd-1', name: 'name', physical_entity_id: 'e-sysdiagrams', source_type: 'nvarchar(128)', is_nullable: false, ordinal: 1 },
        { id: 'a-so-1', name: 'object_id', physical_entity_id: 'e-sysobjects', source_type: 'int', is_nullable: false, ordinal: 1 },
      ],
      dataEntityPoints: [
        { id: 'p-postings', physical_entity_id: 'e-postings' },
        { id: 'p-sensor', physical_entity_id: 'e-sensor' },
      ],
      dataEntityRelationships: [
        {
          id: 'rel-postings-sensor',
          fromDataEntityPointId: 'p-postings',
          toDataEntityPointId: 'p-sensor',
          fk_columns: {
            join_columns: ['PostingID'],
            referenced_columns: ['SensorArchiveID'],
            // SQL Server's catalog spells the action with an underscore.
            on_delete: 'SET_DEFAULT',
            on_update: 'NO_ACTION',
            is_not_trusted: true,
          },
        },
      ],
    },
    findings: [
      // Collation: the DB default is _CI_ and so is the column's.
      finding('f-coll-postedby', 'collation_case_sensitivity_hazard', {
        schemaName: 'Ledger',
        tableName: 'Postings',
        columnName: 'PostedBy',
        collation: 'Latin1_General_CI_AS',
        databaseCollation: 'Latin1_General_100_CI_AS',
      }),
      finding('f-coll-shortcode', 'collation_case_sensitivity_hazard', {
        schemaName: 'Ledger',
        tableName: 'Postings',
        columnName: 'ShortCode',
        collation: 'Latin1_General_CI_AS',
        databaseCollation: 'Latin1_General_100_CI_AS',
      }),
      // newid() is engine-specific but has an EXACT target equivalent.
      finding('f-npd-rowguid', 'non_portable_default', {
        schemaName: 'Ledger',
        tableName: 'Postings',
        columnName: 'RowGuid',
        columnDefault: '(newid())',
        detectedToken: 'newid',
        portabilityNote: 'T-SQL newid() -> gen_random_uuid()',
      }),
      // IDENTITY seed/increment arrive as the synthesized sequence row.
      finding('f-seq-postings', 'sequence_definition', {
        schemaName: 'Ledger',
        sequenceName: 'Postings_PostingID',
        startValue: '1000',
        increment: '5',
        currentValue: '9000',
        ownedByTable: 'Ledger.Postings',
        ownedByColumn: 'PostingID',
      }),
      finding('f-seq-sensor', 'sequence_definition', {
        schemaName: 'Ops',
        sequenceName: 'SensorArchive_SensorArchiveID',
        startValue: '1',
        increment: '1',
        currentValue: '42',
        ownedByTable: 'Ops.SensorArchive',
        ownedByColumn: 'SensorArchiveID',
      }),
      // A NATIVE standalone sequence (CREATE SEQUENCE, no owning column).
      finding('f-seq-standalone', 'sequence_definition', {
        schemaName: 'Ledger',
        sequenceName: 'PostingBatchNumber',
        dataType: 'bigint',
        startValue: '1000',
        increment: '10',
        minValue: '1000',
        maxValue: '9223372036854775807',
        cycle: false,
        currentValue: '2500',
        ownedByTable: null,
        ownedByColumn: null,
      }),
      finding('f-seq-account', 'sequence_definition', {
        schemaName: 'Ledger',
        sequenceName: 'Account_AccountID',
        startValue: '1',
        increment: '1',
        currentValue: '77',
        ownedByTable: 'Ledger.Account',
        ownedByColumn: 'AccountID',
      }),
      // Item-5 table shapes.
      finding('f-temporal-account', 'temporal_table_detected', {
        schemaName: 'Ledger',
        tableName: 'Account',
        temporalType: 'system_versioned',
        historyTable: 'Ledger.AccountHistory',
        periodStartColumn: 'ValidFrom',
        periodEndColumn: 'ValidTo',
      }),
      finding('f-temporal-history', 'temporal_table_detected', {
        schemaName: 'Ledger',
        tableName: 'AccountHistory',
        temporalType: 'history',
        historyTable: null,
        periodStartColumn: 'ValidFrom',
        periodEndColumn: 'ValidTo',
      }),
      finding('f-memopt-sensor', 'memory_optimized_table', {
        schemaName: 'Ops',
        tableName: 'SensorArchive',
        isMemoryOptimized: true,
      }),
      finding('f-fulltext', 'fulltext_index_detected', {
        schemaName: 'Ops',
        tableName: 'SensorArchive',
        indexName: 'FT_Ops_SensorArchive_ReadingNote',
        fulltextCatalog: 'OpsSearchCatalog',
        columns: ['ReadingNote', 'ReadingSummary'],
      }),
      finding('f-filestream', 'filestream_column', {
        schemaName: 'Ledger',
        tableName: 'Postings',
        columnName: 'ScannedDocument',
      }),
      // Storage attributes ride alongside a column-shaped hazard finding.
      finding('f-rowguid', 'xml_typed_column', {
        schemaName: 'Ledger',
        tableName: 'Postings',
        columnName: 'RowGuid',
        isRowGuidCol: true,
        isSparse: true,
      }),
      // A NON-persisted computed column: PostgreSQL 18 VIRTUAL, not STORED.
      finding('f-computed', 'computed_column_not_persisted', {
        schemaName: 'Ops',
        tableName: 'SensorArchive',
        columnName: 'ReadingSummary',
        isPersistedComputed: false,
        generationExpression: 'left(ReadingNote, 80)',
      }),
      // Item-5 extended objects.
      finding('f-clr', 'clr_object_detected', {
        schemaName: 'Ledger',
        tableName: 'RiskScore',
        assemblyName: 'LedgerRiskScoring',
        bodySnippet: '-- CLR assembly LedgerRiskScoring (managed .NET)',
      }),
      finding('f-broker', 'service_broker_detected', {
        schemaName: 'Ops',
        tableName: 'SensorIngestQueue',
        extendedObjectKind: 'service_broker_queue',
      }),
      finding('f-synonym', 'synonym_detected', {
        schemaName: 'Ledger',
        tableName: 'StagedPostings',
        detail: { baseObject: 'ReportingWarehouse.dbo.StagedPostings' },
      }),
      finding('f-udtt', 'user_defined_table_type', {
        schemaName: 'Ledger',
        tableName: 'PostingBatchType',
      }),
      finding('f-indexed-view', 'indexed_view', {
        schemaName: 'Ledger',
        tableName: 'vwPostingTotals',
        untranslatableReason: 'indexed_view',
      }),
      finding('f-crossdb', 'cross_database_reference', {
        schemaName: 'Ledger',
        tableName: 'usp_SyncWarehouse',
        untranslatableReason: 'cross_database_reference',
        references: ['ReportingWarehouse.dbo.StagedPostings'],
        bodySnippet: 'SELECT * FROM ReportingWarehouse.dbo.StagedPostings',
      }),
      ...(overrides?.extraFindings ?? []),
    ],
    dbDecisions: [{ decisionCode: 'db.engine', answerValue: 'postgresql' }],
    resolvedPackDecisions: overrides?.resolved ?? [],
  };
}

/** Resolve a decision to one option (the shape AMS persists). */
function resolved(
  decision_key: string,
  option: string,
  extra: Record<string, unknown> = {},
): RawResolvedPackDecision {
  return { decision_key, status: 'resolved', resolution_json: { option, ...extra } };
}

/** Every decision the pack raises with an unresolved default set. */
const ALL_ITEM5_RESOLUTIONS: RawResolvedPackDecision[] = [
  resolved('collation--database', 'citext'),
  resolved('sql_variant_column--Ledger.Postings.LooseValue', 'jsonb'),
  resolved('hierarchyid_column--Ledger.Postings.OrgNode', 'ltree'),
  resolved('spatial_column--Ledger.Postings.SiteShape', 'postgis'),
  resolved('filestream--Ledger.Postings.ScannedDocument', 'rewrite_in_app'),
  resolved('type_mapping--Ledger.Postings.RowVersion', 'map_to_bytea'),
  resolved('temporal_table--Ledger.Account', 'emulate_history_table'),
  resolved('fulltext_index--Ops.SensorArchive', 'tsvector_gin'),
  resolved('memory_optimized_table--Ops.SensorArchive', 'accept_plain_table'),
  resolved('columnstore_index--Ops.SensorArchive--CCI_Ops_SensorArchive', 'btree'),
  resolved(
    'index_predicate--Ledger.Postings--IX_Ledger_Postings_Exotic',
    'provide_predicate',
    { predicate: '"PostedOn" IS NOT NULL' },
  ),
  resolved('clr_object--Ledger.RiskScore', 'rewrite_in_app'),
  resolved('service_broker--Ops.SensorIngestQueue', 'rewrite_in_app'),
  resolved('synonym--Ledger.StagedPostings', 'view'),
  resolved('user_defined_table_type--Ledger.PostingBatchType', 'composite_type'),
  resolved('indexed_view--Ledger.vwPostingTotals', 'rewrite_in_app'),
  resolved('cross_database_reference--Ledger.usp_SyncWarehouse', 'rewrite_in_app'),
  resolved('delta_key--Ledger.Postings', 'full_reload_each_increment'),
  resolved('delta_key--Ledger.Account', 'full_reload_each_increment'),
  resolved('delta_key--Ledger.AccountHistory', 'full_reload_each_increment'),
  resolved('surrogate_pk--tables_without_pk', 'add_surrogate_identity_pk'),
];

const build = (inputs: GenerationInputs) =>
  buildDbMigrationPackArtifacts(buildSourceSchemaIr(inputs));

const fileAt = (files: Array<{ filePath: string; content: string }>, path: string): string => {
  const f = files.find((x) => x.filePath === path);
  if (!f) throw new Error(`pack has no file at ${path} (have: ${files.map((x) => x.filePath).join(', ')})`);
  return f.content;
};

// ---------------------------------------------------------------------------
// 5.1 — the gate, the system-object filter, the IR
// ---------------------------------------------------------------------------

describe('5.1 gate + system objects + IR (SQL Server)', () => {
  it('accepts mssql as a generator-supported source engine', () => {
    const ir = buildSourceSchemaIr(makeInputs());
    expect(ir.sourceEngine).toBe('mssql');
    expect(ir.targetEngine).toBe('postgres');
    expect(ir.pairId).toBe('sqlserver16-postgres18');
  });

  it('still refuses a target engine that is not PostgreSQL', () => {
    const inputs = makeInputs();
    inputs.dbDecisions = [{ decisionCode: 'db.engine', answerValue: 'oracle' }];
    expect(() => buildSourceSchemaIr(inputs)).toThrow(UnsupportedEnginePairError);
  });

  it('excludes SQL Server system objects by SCHEMA and by tool-owned NAME, never by a sys* prefix', () => {
    expect(isSystemObjectFor('mssql', 'sys', 'objects')).toBe(true);
    expect(isSystemObjectFor('mssql', 'INFORMATION_SCHEMA', 'TABLES')).toBe(true);
    expect(isSystemObjectFor('mssql', 'dbo', 'sysdiagrams')).toBe(true);
    expect(isSystemObjectFor('mssql', 'dbo', 'MSreplication_options')).toBe(true);
    expect(isSystemObjectFor('mssql', 'dbo', 'spt_values')).toBe(true);
    expect(isSystemObjectFor('mssql', 'dbo', '__RefactorLog')).toBe(true);
    // An ordinary application table whose name merely LOOKS systemish.
    expect(isSystemObjectFor('mssql', 'dbo', 'system_audit')).toBe(false);
    expect(isSystemObjectFor('mssql', 'Ledger', 'Postings')).toBe(false);
    // The ASE curated list is untouched on the Sybase arm.
    expect(isSystemObjectFor('sybase', 'dbo', 'sysquerymetrics')).toBe(true);
    expect(isSystemObjectFor('sybase', 'dbo', 'sysdiagrams')).toBe(false);
  });

  it('keeps the excluded system objects out of the IR and records them', () => {
    const ir = buildSourceSchemaIr(makeInputs());
    const names = ir.tables.map((t) => `${t.schemaName}.${t.tableName}`);
    expect(names).not.toContain('dbo.sysdiagrams');
    expect(names).not.toContain('sys.objects');
    expect(ir.sybaseSystemExclusions?.map((e) => e.objectRef).sort()).toEqual([
      'dbo.sysdiagrams',
      'sys.objects',
    ]);
  });

  it('merges the SQL-Server-only IR facts: temporal, memory-optimized, full-text, filestream, identity seed/increment, INCLUDE columns, DB collation', () => {
    const ir = buildSourceSchemaIr(makeInputs());
    const account = ir.tables.find((t) => t.tableName === 'Account')!;
    expect(account.temporal).toEqual({
      temporalType: 'system_versioned',
      historyTable: 'Ledger.AccountHistory',
      periodStartColumn: 'ValidFrom',
      periodEndColumn: 'ValidTo',
    });
    const history = ir.tables.find((t) => t.tableName === 'AccountHistory')!;
    expect(history.temporal?.temporalType).toBe('history');

    const sensor = ir.tables.find((t) => t.tableName === 'SensorArchive')!;
    expect(sensor.memoryOptimized).toBe(true);
    expect(sensor.fullTextIndexes).toEqual([
      {
        name: 'FT_Ops_SensorArchive_ReadingNote',
        catalog: 'OpsSearchCatalog',
        columns: ['ReadingNote', 'ReadingSummary'],
      },
    ]);

    const postings = ir.tables.find((t) => t.tableName === 'Postings')!;
    const postingId = postings.columns.find((c) => c.columnName === 'PostingID')!;
    expect(postingId.identitySeed).toBe('1000');
    expect(postingId.identityIncrement).toBe('5');
    expect(postings.columns.find((c) => c.columnName === 'ScannedDocument')!.isFilestream).toBe(true);
    expect(
      postings.indexes.find((i) => i.name === 'IX_Ledger_Postings_Active')!.includeColumns,
    ).toEqual(['PostingID']);
    expect(ir.databaseCollation).toBe('Latin1_General_100_CI_AS');
    expect(ir.foreignKeys[0].isNotTrusted).toBe(true);
  });

  it('collects every item-5 extended object from the scan findings', () => {
    const ir = buildSourceSchemaIr(makeInputs());
    expect((ir.extendedObjects ?? []).map((e) => e.kind).sort()).toEqual([
      'clr_object_detected',
      'cross_database_reference',
      'filestream',
      'indexed_view',
      'service_broker_detected',
      'synonym_detected',
      'user_defined_table_type',
    ]);
    const crossDb = ir.extendedObjects!.find((e) => e.kind === 'cross_database_reference')!;
    expect(crossDb.untranslatableReason).toBe('cross_database_reference');
  });
});

// ---------------------------------------------------------------------------
// 5.2 — the type table
// ---------------------------------------------------------------------------

describe('5.2 SQL Server type table', () => {
  const map = (dataType: string, extra: Partial<{ maxLength: number; precision: number; scale: number }> = {}) =>
    mapSourceType('mssql', {
      dataType,
      maxLength: extra.maxLength ?? null,
      precision: extra.precision ?? null,
      scale: extra.scale ?? null,
    });

  it.each([
    ['int', 'integer'],
    ['smallint', 'smallint'],
    ['bigint', 'bigint'],
    ['tinyint', 'smallint'],
    ['bit', 'boolean'],
    ['money', 'numeric(19,4)'],
    ['smallmoney', 'numeric(10,4)'],
    ['float', 'double precision'],
    ['float(24)', 'real'],
    ['float(53)', 'double precision'],
    ['real', 'real'],
    ['char(8)', 'char(8)'],
    ['nchar(8)', 'char(8)'],
    ['varchar(50)', 'varchar(50)'],
    ['varchar(max)', 'text'],
    ['nvarchar(50)', 'varchar(50)'],
    ['nvarchar(max)', 'text'],
    ['text', 'text'],
    ['ntext', 'text'],
    ['binary(16)', 'bytea'],
    ['varbinary(50)', 'bytea'],
    ['varbinary(max)', 'bytea'],
    ['image', 'bytea'],
    ['date', 'date'],
    ['datetime', 'timestamp(3)'],
    ['smalldatetime', 'timestamp(0)'],
    ['datetime2(3)', 'timestamp(3)'],
    ['datetime2(7)', 'timestamp(6)'],
    ['datetimeoffset(7)', 'timestamptz(6)'],
    ['time(7)', 'time(6)'],
    ['time(3)', 'time(3)'],
    ['uniqueidentifier', 'uuid'],
    ['xml', 'xml'],
    ['sysname', 'varchar(128)'],
  ])('%s -> %s', (source, target) => {
    const result = map(source);
    expect(result.kind).toBe('mapped');
    if (result.kind === 'mapped') expect(result.postgresType).toBe(target);
  });

  it('flags 100ns precision loss on p=7 (and on an OMITTED (p), which the engine defaults to 7)', () => {
    for (const t of ['datetime2(7)', 'time(7)', 'datetimeoffset(7)', 'datetime2', 'time']) {
      const result = map(t);
      expect(result.kind).toBe('mapped');
      if (result.kind === 'mapped') expect(result.precisionLoss).toContain('100ns');
    }
    const lossless = map('datetime2(6)');
    if (lossless.kind === 'mapped') expect(lossless.precisionLoss).toBeUndefined();
  });

  it('rowversion/timestamp is a needs_decision — never a guessed datetime or bytea', () => {
    for (const t of ['rowversion', 'timestamp']) {
      const result = map(t);
      expect(result.kind).toBe('needs_decision');
      if (result.kind === 'needs_decision') {
        expect(result.options).toEqual(['map_to_bytea', 'drop_column', 'application_managed']);
      }
    }
  });

  it('sql_variant / hierarchyid / spatial map to a DEFAULT and carry their own decision', () => {
    const variant = map('sql_variant');
    expect(variant.kind).toBe('mapped');
    if (variant.kind === 'mapped') {
      expect(variant.postgresType).toBe('jsonb');
      expect(variant.featureDecision?.category).toBe('sql_variant_column');
      expect(variant.featureDecision?.options).toEqual(['jsonb', 'text', 'drop_column']);
    }
    const hier = map('hierarchyid');
    if (hier.kind === 'mapped') {
      expect(hier.postgresType).toBe('ltree');
      expect(hier.featureDecision?.prerequisite).toBe('ltree');
    }
    for (const t of ['geography', 'geometry']) {
      const spatial = map(t);
      if (spatial.kind === 'mapped') {
        expect(spatial.postgresType).toBe(t);
        expect(spatial.featureDecision?.prerequisite).toBe('postgis');
        expect(spatial.featureDecision?.options).toEqual(['postgis', 'wkt_text', 'drop_column']);
      }
    }
  });

  it('bare char is still a needs_decision on SQL Server (never a silent char(1))', () => {
    expect(map('char').kind).toBe('needs_decision');
    expect(map('nchar').kind).toBe('needs_decision');
  });

  it('an unlisted type names the alias-type / CLR-UDT possibility instead of guessing', () => {
    const result = map('MyCustomUdt');
    expect(result.kind).toBe('needs_decision');
    if (result.kind === 'needs_decision') {
      expect(result.question).toContain('ALIAS type');
      expect(result.options).toEqual(['specify_target_type', 'drop_column']);
    }
  });

  it('IIF rewrites structurally to CASE — a deterministic answer, not a decision', () => {
    expect(rewriteIifCalls('iif(a > 1, b, c)').expression).toBe('CASE WHEN a > 1 THEN b ELSE c END');
    // Nested, inside-out.
    expect(rewriteIifCalls('iif(a, iif(b, 1, 2), 3)').expression).toBe(
      'CASE WHEN a THEN CASE WHEN b THEN 1 ELSE 2 END ELSE 3 END',
    );
    // A comma inside a string literal is NOT an argument separator.
    expect(rewriteIifCalls("iif(a = 'x,y', 1, 2)").expression).toBe(
      "CASE WHEN a = 'x,y' THEN 1 ELSE 2 END",
    );
    // Not an IIF call at all.
    expect(rewriteIifCalls('modiifier + 1').changed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5.3 / 5.4 / 5.5 — emission over the fully-resolved pack
// ---------------------------------------------------------------------------

describe('SQL Server pack emission (all item-5 decisions resolved)', () => {
  const artifacts = build(makeInputs({ resolved: ALL_ITEM5_RESOLUTIONS }));
  const manifest = artifacts.manifest as PackManifest;
  const postings = fileAt(artifacts.files, 'liquibase/changesets/010-tables/Ledger.Postings.sql');
  const indexes = fileAt(artifacts.files, 'liquibase/changesets/030-indexes.sql');
  const schemas = fileAt(artifacts.files, 'liquibase/changesets/000-schemas.sql');
  const foreignKeys = fileAt(artifacts.files, 'liquibase/changesets/020-foreign-keys.sql');
  const emulations = fileAt(artifacts.files, 'liquibase/changesets/015-emulations.sql');

  it('vendors the generated pack for the IVS structural check when asked', () => {
    // The IVS python test (`implement-verify-service/tests/job_queue/
    // test_assembly_mssql_pack.py`) validates a REAL generated pack with
    // `validate_pack_on_disk`, the same invariants the apply step enforces on
    // the target machine. Regenerate that fixture with:
    //   HAIKAI_DUMP_MSSQL_PACK=1 npx jest dbMigrationPackGenerationMssql
    // Off by default so the test suite never writes to the repo.
    if (process.env.HAIKAI_DUMP_MSSQL_PACK !== '1') return;
    /* eslint-disable @typescript-eslint/no-var-requires */
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    /* eslint-enable @typescript-eslint/no-var-requires */
    const root = path.resolve(
      __dirname,
      '../../../implement-verify-service/tests/fixtures/mssql-pack',
    );
    fs.rmSync(root, { recursive: true, force: true });
    for (const file of artifacts.files) {
      const target = path.join(root, file.filePath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, file.content, 'utf8');
    }
  });

  it('generates a pack that passes the runnable-pack validation gate', () => {
    // buildDbMigrationPackArtifacts asserts it internally; reaching here is
    // the assertion. The master changelog lists the emulations changeset in
    // structural order, after the tables.
    const master = fileAt(artifacts.files, 'liquibase/db.changelog-master.xml');
    expect(master.indexOf('changesets/010-tables/Ledger.Postings.sql')).toBeLessThan(
      master.indexOf('changesets/015-emulations.sql'),
    );
    expect(master.indexOf('changesets/015-emulations.sql')).toBeLessThan(
      master.indexOf('changesets/020-foreign-keys.sql'),
    );
  });

  it('5.3 identity carries the source seed and increment, BY DEFAULT (SET IDENTITY_INSERT loads are routine)', () => {
    expect(postings).toContain(
      '"PostingID" bigint GENERATED BY DEFAULT AS IDENTITY (START WITH 1000 INCREMENT BY 5) NOT NULL',
    );
  });

  it('5.3 a filtered index becomes a PARTIAL index and INCLUDE columns survive', () => {
    expect(indexes).toContain(
      'CREATE INDEX "IX_Ledger_Postings_Active" ON "Ledger"."Postings" ("PostedBy" ASC) ' +
        'INCLUDE ("PostingID") WHERE IsVoided = 0;',
    );
    expect(indexes).toContain('PARTIAL index');
  });

  it('5.3 a non-portable predicate is emitted from the RESOLVED decision, with the source predicate on record', () => {
    expect(indexes).toContain('WHERE "PostedOn" IS NOT NULL;');
    expect(indexes).toContain("Source (verbatim): WHERE isdate(PostedOn) = 1");
  });

  it('5.3 a columnstore index drops to btree with a manifest note; a full-text index defers to the emulation', () => {
    expect(indexes).toContain('CREATE INDEX "CCI_Ops_SensorArchive" ON "Ops"."SensorArchive" ("ReadingNote");');
    expect(manifest.index_notes?.join('\n')).toContain('columnstore_dropped_to_btree');
    expect(indexes).toContain('FULL-TEXT index Ops.SensorArchive.FT_Ops_SensorArchive_ReadingNote');
    expect(indexes).not.toContain('CREATE INDEX "FT_Ops_SensorArchive_ReadingNote"');
  });

  it('5.3 FK referential actions normalise the catalog underscore form and an untrusted FK emits NOT VALID', () => {
    expect(foreignKeys).toContain('ON DELETE SET DEFAULT ON UPDATE NO ACTION NOT VALID;');
    expect(foreignKeys).toContain('VALIDATE CONSTRAINT');
  });

  it('5.3 an untrusted CHECK emits as a separate ALTER TABLE ... NOT VALID (PostgreSQL refuses NOT VALID inside CREATE TABLE)', () => {
    expect(postings).toContain('CONSTRAINT "CK_Postings_Amount" CHECK (Amount >= 0)');
    expect(postings).toContain(
      'ALTER TABLE "Ledger"."Postings" ADD CONSTRAINT "CK_Postings_PostedBy" ' +
        'CHECK (length(PostedBy) > 0) NOT VALID;',
    );
  });

  it('5.4 the citext posture rewrites affected columns and preserves a char(n) width with a length CHECK', () => {
    expect(postings).toContain('"PostedBy" citext NOT NULL');
    expect(postings).toContain('"ShortCode" citext');
    expect(postings).toContain('CHECK (length("ShortCode") <= 8)');
    expect(schemas).toContain('CREATE EXTENSION IF NOT EXISTS "citext";');
    expect(manifest.collation_posture).toBe('citext');
    expect(manifest.collation_affected_columns).toEqual([
      'Ledger.Postings.PostedBy',
      'Ledger.Postings.ShortCode',
    ]);
  });

  it('5.4/5.5 every target extension the mappings need is a loud prologue prerequisite', () => {
    expect(manifest.target_extensions_required).toEqual(['citext', 'ltree', 'postgis']);
    expect(schemas).toContain('CREATE EXTENSION IF NOT EXISTS "ltree";');
    expect(schemas).toContain('CREATE EXTENSION IF NOT EXISTS "postgis";');
    expect(schemas).toContain("PREREQUISITE: the 'postgis' extension is REQUIRED");
  });

  it('5.2 the feature defaults emit their resolved target types', () => {
    expect(postings).toContain('"LooseValue" jsonb');
    expect(postings).toContain('"OrgNode" ltree');
    expect(postings).toContain('"SiteShape" geometry');
    expect(postings).toContain('"RowVersion" bytea');
    expect(postings).toContain('"DisplayName" text');
    expect(postings).toContain('"Tier" smallint');
    expect(postings).toContain('"PostedOn" timestamp(6)');
    expect(postings).toContain('"PostedOffset" timestamptz(6)');
    expect(postings).toContain('"RowGuid" uuid NOT NULL DEFAULT gen_random_uuid()');
  });

  it('5.3 a NATIVE standalone sequence is created with its FULL generation detail and reseeded', () => {
    expect(schemas).toContain(
      'CREATE SEQUENCE IF NOT EXISTS "Ledger"."PostingBatchNumber" AS bigint INCREMENT BY 10 ' +
        'MINVALUE 1000 MAXVALUE 9223372036854775807 START WITH 1000 NO CYCLE;',
    );
    // Created AFTER its schema, which cannot be assumed to exist before.
    expect(schemas.indexOf('CREATE SCHEMA IF NOT EXISTS "Ledger";')).toBeLessThan(
      schemas.indexOf('CREATE SEQUENCE IF NOT EXISTS "Ledger"."PostingBatchNumber"'),
    );
    const seed = fileAt(artifacts.files, 'liquibase/changesets/040-sequences-seed.sql');
    expect(seed).toContain(
      `SELECT setval('"Ledger"."PostingBatchNumber"', 3500, false);`,
    );
  });

  it('5.2 p=7 columns are named in the manifest with the truncation note', () => {
    const columns = (manifest.precision_loss_columns ?? []).map((c) => c.column);
    expect(columns).toContain('Ledger.Postings.PostedOn');
    expect(columns).toContain('Ledger.Postings.PostedOffset');
    expect(columns).toContain('Ledger.Account.ValidFrom');
    expect(manifest.precision_loss_columns![0].note).toContain('100ns');
  });

  it('5.5 the temporal emulation BUILDS the trigger pair over the migrated history table', () => {
    expect(emulations).toContain('CREATE OR REPLACE FUNCTION "haikai_temporal_versioning"()');
    expect(emulations).toContain('CREATE OR REPLACE FUNCTION "haikai_temporal_row_start"()');
    expect(emulations).toContain(
      'CREATE TRIGGER "Account_versioning" AFTER UPDATE OR DELETE ON "Ledger"."Account" ' +
        'FOR EACH ROW EXECUTE FUNCTION "haikai_temporal_versioning"(' +
        "'Ledger.AccountHistory', 'ValidTo');",
    );
    // The source history table MIGRATES; the pack never re-creates it.
    expect(emulations).toContain(
      'History rows land in Ledger.AccountHistory, the source history table, which migrates as ' +
        'an ordinary table',
    );
    expect(emulations).not.toContain('CREATE TABLE "Ledger"."AccountHistory"');
    expect(emulations).toContain('FOR SYSTEM_TIME rewrite for Ledger.Account');
    expect(emulations).toContain('MSPG.TEMPORAL.001');
  });

  it('5.5 the full-text emulation BUILDS a generated tsvector column + GIN index', () => {
    expect(emulations).toContain(
      'ALTER TABLE "Ops"."SensorArchive" ADD COLUMN "FT_Ops_SensorArchive_ReadingNote_tsv" tsvector ' +
        "GENERATED ALWAYS AS (to_tsvector('english', coalesce(\"ReadingNote\", '') || ' ' || " +
        "coalesce(\"ReadingSummary\", ''))) STORED;",
    );
    expect(emulations).toContain('USING gin ("FT_Ops_SensorArchive_ReadingNote_tsv");');
    expect(emulations).toContain('MSPG.FULLTEXT.001');
  });

  it('5.5 every item-5 emulation and extended object is visible accounting on the manifest', () => {
    expect((manifest.emulations ?? []).map((e) => `${e.kind}:${e.object_ref}:${e.option}`)).toEqual([
      'fulltext_index:Ops.SensorArchive.FT_Ops_SensorArchive_ReadingNote:tsvector_gin',
      'temporal_table:Ledger.Account:emulate_history_table',
    ]);
    const extended = manifest.extended_objects ?? [];
    expect(extended.map((e) => e.object_ref).sort()).toEqual([
      'Ledger.Postings.ScannedDocument',
      'Ledger.RiskScore',
      'Ledger.StagedPostings',
      'Ledger.PostingBatchType',
      'Ledger.usp_SyncWarehouse',
      'Ledger.vwPostingTotals',
      'Ops.SensorIngestQueue',
    ].sort());
    // The OUT-by-ruling shapes carry their NAMED reason, never a silent skip.
    expect(
      extended.find((e) => e.object_ref === 'Ledger.usp_SyncWarehouse')!.untranslatable_reason,
    ).toBe('cross_database_reference');
    expect(
      extended.find((e) => e.object_ref === 'Ledger.vwPostingTotals')!.untranslatable_reason,
    ).toBe('indexed_view');
  });

  it('5.5 item-5 objects ride the SAME translation queue, with named reasons where they apply', () => {
    const queued = manifest.requires_translation_spec_2;
    const byKind = new Map(queued.map((q) => [q.kind, q]));
    expect(byKind.get('synonym')?.object_ref).toBe('Ledger.StagedPostings');
    expect(byKind.get('user_defined_table_type')?.object_ref).toBe('Ledger.PostingBatchType');
    expect(byKind.get('clr_object')?.untranslatable_reason).toBe('clr_object');
    expect(byKind.get('service_broker_object')?.untranslatable_reason).toBe('service_broker_object');
    // Every queued kind is a registered translation kind (AMS chk_dmpt_kind).
    for (const q of queued) {
      expect(TRANSLATION_KINDS as readonly string[]).toContain(q.kind);
    }
  });

  it('5.3 a NON-persisted computed column emits VIRTUAL (PostgreSQL 18), never a silent STORED', () => {
    const sensor = fileAt(artifacts.files, 'liquibase/changesets/010-tables/Ops.SensorArchive.sql');
    expect(sensor).toContain(
      '"ReadingSummary" varchar(80) GENERATED ALWAYS AS (left(ReadingNote, 80)) VIRTUAL',
    );
  });

  it('5.3 rowguidcol / sparse become notes, never DDL (they change no value on the target)', () => {
    expect(postings).toContain('ROWGUIDCOL Ledger.Postings.RowGuid');
    expect(postings).toContain('SPARSE Ledger.Postings.RowGuid');
    expect(postings).not.toContain('SPARSE,');
  });

  it('5.5 memory-optimized and history tables carry their loud note, not silent equivalence', () => {
    const sensor = fileAt(artifacts.files, 'liquibase/changesets/010-tables/Ops.SensorArchive.sql');
    expect(sensor).toContain('MEMORY_OPTIMIZED at source');
    const history = fileAt(
      artifacts.files,
      'liquibase/changesets/010-tables/Ledger.AccountHistory.sql',
    );
    expect(history).toContain('TEMPORAL HISTORY table');
  });

  it('5.6 the extract expressions are the SQL Server canonical forms', () => {
    const ir = buildSourceSchemaIr(makeInputs({ resolved: ALL_ITEM5_RESOLUTIONS }));
    const postingsTable = ir.tables.find((t) => t.tableName === 'Postings')!;
    const byName = new Map(
      planBulkColumns(postingsTable.columns, 'mssql').map((p) => [p.columnName, p.extractExpression]),
    );
    expect(byName.get('Amount')).toBe('CONVERT(numeric(19,4), Amount) AS Amount');
    expect(byName.get('PostedOn')).toBe('CONVERT(varchar(27), PostedOn, 121) AS PostedOn');
    expect(byName.get('PostedOffset')).toBe('CONVERT(varchar(34), PostedOffset, 127) AS PostedOffset');
    expect(byName.get('IsVoided')).toContain('CAST(IsVoided AS int) AS IsVoided');
    expect(byName.get('RowGuid')).toBe('LOWER(CONVERT(char(36), RowGuid)) AS RowGuid');
    expect(byName.get('PayloadDocument')).toBe(
      'CONVERT(nvarchar(max), PayloadDocument) AS PayloadDocument',
    );
    expect(byName.get('SiteShape')).toContain('SiteShape.STAsText() AS SiteShape, SiteShape.STSrid');
    expect(byName.get('OrgNode')).toContain('OrgNode.ToString() AS OrgNode');
    expect(byName.get('ScannedDocument')).toContain(
      "'\\x' + LOWER(CONVERT(varchar(max), ScannedDocument, 2)) AS ScannedDocument",
    );
  });

  it('5.6 the bulk script and reconciliation SQL name SQL Server and use its CLI + batch form', () => {
    const bulk = artifacts.files.find((f) => f.filePath.startsWith('data/bulk/'))!.content;
    expect(bulk).toContain('SQL Server extract');
    expect(bulk).toContain('bcp (queryout');
    const reconcile = fileAt(artifacts.files, 'reconcile/reconciliation.sql');
    expect(reconcile).toContain('===== SQL Server (SOURCE) — sqlcmd -h -1 -W -s,');
    expect(reconcile).toContain('COUNT_BIG(*)');
    expect(reconcile.split('\n').filter((l) => l.trim() === 'GO').length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 5.5 — the OPEN-decision posture (the Migrate gate)
// ---------------------------------------------------------------------------

describe('open item-5 decisions block Migrate and never guess', () => {
  const artifacts = build(makeInputs());
  const keys = artifacts.decisions.map((d) => d.decisionKey).sort();

  it('raises one decision per item-5 object, each with actionable options', () => {
    expect(keys).toEqual(
      expect.arrayContaining([
        'clr_object--Ledger.RiskScore',
        'collation--database',
        'columnstore_index--Ops.SensorArchive--CCI_Ops_SensorArchive',
        'cross_database_reference--Ledger.usp_SyncWarehouse',
        'filestream--Ledger.Postings.ScannedDocument',
        'fulltext_index--Ops.SensorArchive',
        'hierarchyid_column--Ledger.Postings.OrgNode',
        'index_predicate--Ledger.Postings--IX_Ledger_Postings_Exotic',
        'indexed_view--Ledger.vwPostingTotals',
        'memory_optimized_table--Ops.SensorArchive',
        'service_broker--Ops.SensorIngestQueue',
        'spatial_column--Ledger.Postings.SiteShape',
        'sql_variant_column--Ledger.Postings.LooseValue',
        'synonym--Ledger.StagedPostings',
        'temporal_table--Ledger.Account',
        'type_mapping--Ledger.Postings.RowVersion',
        'user_defined_table_type--Ledger.PostingBatchType',
      ]),
    );
    for (const d of artifacts.decisions) {
      expect(d.options.length).toBeGreaterThan(0);
      expect(d.question.length).toBeGreaterThan(40);
    }
  });

  it('the collation decision is ONE pack-wide question with the owner-ruled option order', () => {
    const collation = artifacts.decisions.find((d) => d.decisionKey === 'collation--database')!;
    expect(collation.options).toEqual([
      'citext',
      'icu_nondeterministic',
      'accept_case_sensitive_change',
    ]);
    expect(collation.question).toContain('citext');
    expect(collation.question).toContain('MSPG.COLL.001');
    // No PER-COLUMN collation decision is raised on this engine.
    expect(keys.filter((k) => k.startsWith('collation--') && k !== 'collation--database')).toEqual([]);
  });

  it('the flagged objects reach the coverage ledger, which is what blocks Migrate', () => {
    const flagged = artifacts.coverage.filter((c) => c.disposition === 'flagged');
    const refs = flagged.map((c) => c.objectRef);
    expect(refs).toContain('Ledger.Postings.LooseValue');
    expect(refs).toContain('Ledger.Postings.PostedBy');
    expect(refs).toContain('Ledger.Account');
    expect(refs).toContain('Ops.SensorArchive');
    expect(artifacts.counts.flagged).toBeGreaterThan(0);
  });

  it('an unresolved filtered-index predicate emits NO index and says so loudly', () => {
    const indexes = fileAt(artifacts.files, 'liquibase/changesets/030-indexes.sql');
    expect(indexes).toContain('NEEDS DECISION (index_predicate)');
    expect(indexes).not.toContain('CREATE INDEX "IX_Ledger_Postings_Exotic"');
  });

  it('an unresolved collation posture leaves the mapped type in place (no guessed citext)', () => {
    const postings = fileAt(artifacts.files, 'liquibase/changesets/010-tables/Ledger.Postings.sql');
    expect(postings).toContain('"PostedBy" varchar(60) NOT NULL');
    expect(postings).not.toContain('citext');
  });
});

// ---------------------------------------------------------------------------
// 5.4 — the ICU alternative
// ---------------------------------------------------------------------------

describe('5.4 the ICU collation posture', () => {
  const artifacts = build(
    makeInputs({
      resolved: ALL_ITEM5_RESOLUTIONS.map((r) =>
        r.decision_key === 'collation--database'
          ? resolved('collation--database', 'icu_nondeterministic')
          : r,
      ),
    }),
  );

  it('creates haikai_ci in changeset 000 and applies it to the affected columns', () => {
    const schemas = fileAt(artifacts.files, 'liquibase/changesets/000-schemas.sql');
    expect(schemas).toContain(
      "CREATE COLLATION IF NOT EXISTS haikai_ci (provider = icu, locale = 'und-u-ks-level2', deterministic = false);",
    );
    const postings = fileAt(artifacts.files, 'liquibase/changesets/010-tables/Ledger.Postings.sql');
    expect(postings).toContain('"PostedBy" varchar(60) COLLATE "haikai_ci" NOT NULL');
  });

  it('documents the LIKE / regex restriction in the manifest, never silently', () => {
    const manifest = artifacts.manifest as PackManifest;
    expect(manifest.collation_posture).toBe('icu_nondeterministic');
    expect(manifest.collation_notes.join('\n')).toContain('LIKE, SIMILAR TO, regular-expression');
  });
});

// ---------------------------------------------------------------------------
// 5.7 — the engine-keyed system-reference gate
// ---------------------------------------------------------------------------

describe('5.7 findSystemReferences is engine-keyed', () => {
  it('names schema-qualified SQL Server catalog references in executable SQL', () => {
    const sql =
      'CREATE VIEW "dbo"."v" AS SELECT * FROM sys.objects o JOIN INFORMATION_SCHEMA.TABLES t ON 1=1;';
    expect(findSystemReferences('mssql', sql)).toEqual([
      'information_schema.tables',
      'sys.objects',
    ]);
  });

  it('ignores comment lines and does NOT flag a bare `sys` identifier', () => {
    expect(
      findSystemReferences('mssql', '-- NOTE: sys.objects was EXCLUDED\nSELECT sys FROM t;'),
    ).toEqual([]);
  });

  it('flags the tool-owned objects that live in a user schema', () => {
    expect(findSystemReferences('mssql', 'SELECT * FROM dbo.sysdiagrams;')).toEqual(['sysdiagrams']);
    expect(findSystemReferences('mssql', 'SELECT * FROM spt_values;')).toEqual(['spt_values']);
  });

  it('keeps the ASE curated scan on the Sybase arm', () => {
    expect(findSystemReferences('sybase', 'SELECT * FROM sysquerymetrics;')).toEqual([
      'sysquerymetrics',
    ]);
    expect(findSystemReferences('sybase', 'SELECT * FROM dbo.sysdiagrams;')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 5.5 — the registered translation kinds
// ---------------------------------------------------------------------------

describe('5.5 translation kinds', () => {
  it('registers every SQL Server object kind the queue must carry', () => {
    expect(TRANSLATION_KINDS as readonly string[]).toEqual(
      expect.arrayContaining([
        'table_valued_function',
        'scalar_function',
        'synonym',
        'user_defined_table_type',
        'sequence',
        'clr_object',
        'service_broker_object',
        'temporal_history',
      ]),
    );
  });

  it('gives the four author-facing new kinds SPECIFIC instructions, not the generic default', () => {
    const profile = NEUTRAL_TRANSLATION_PROFILE;
    expect(kindInstructions('table_valued_function', profile)).toContain('RETURNS TABLE');
    expect(kindInstructions('scalar_function', profile)).toContain('IMMUTABLE');
    expect(kindInstructions('synonym', profile)).toContain('CREATE OR REPLACE VIEW');
    expect(kindInstructions('user_defined_table_type', profile)).toContain('CREATE TYPE');
    // A kind with no specific text still gets an honest generic instruction.
    expect(kindInstructions('temporal_history', profile)).toContain('temporal history');
  });
});
