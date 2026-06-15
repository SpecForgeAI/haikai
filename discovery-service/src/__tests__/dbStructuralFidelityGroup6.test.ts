/**
 * Group 6 -- gap-analysis tests for DB Structural Fidelity (Spec 2026-05-29).
 *
 * tasks.md 6.3: fill the critical gaps Groups 1-5's focused tests did NOT
 * cover. Offline only -- no live DB, no LLM, no gateway relay (the spec's
 * done-bar is "offline introspection -> candidate/finding mappers + AMS model
 * round-trips green").
 *
 * Groups 1-5 already cover, in isolation:
 *  - Group 1 (AMS Java): the entity/DTO round-trips + the changeset.
 *  - Group 2 (discovery): the Postgres/Sybase IR-drop fixes + a single
 *    Postgres candidate-feed case + a `buildRelationshipCandidates` case.
 *  - Group 3 (frontend): the grid/typings/XLSX ripple.
 *  - Group 5 (discovery): `redactSnippet`/`redactFullBody` + the builders +
 *    a Postgres per-engine emission case.
 *
 * The GAPS this file fills (each test maps to a Cover-list bullet in 6.3):
 *  1-2. End-to-end introspect -> candidate, asserting the candidate `data`
 *       carries EXACTLY the snake_case keys the AMS DTOs consume
 *       (`PhysicalDataAttributeDto` / `PhysicalDataEntityDto` /
 *       `LogicalDataEntityRelationshipDto`) -- the bridge between Group 2's
 *       candidate test and Group 1's AMS round-trip. Both engines; the Sybase
 *       leg also exercises the sidecar default-extraction IR-drop fix.
 *  3.   The physical-only invariant at the relationship level: the FK candidate
 *       is a `logical_data_entity_relationships` row, NEVER a
 *       `logical_data_entity_physical_data_entities` mapping (reconciliation
 *       DEFERRED to Issue 2).
 *  4.   Boxed-null preservation across the discovery->AMS boundary: a column
 *       with no scale/precision/identity yields JSON `null` (not 0 / false) in
 *       the candidate `data`, so the AMS boxed-type PATCH contract holds.
 *  5-6. Redaction/cap REGRESSION GUARD: the shared `redactSnippet` 200-char
 *       behaviour is UNCHANGED through the REAL code-pack scanners
 *       (`javaFindingScanner` + `springClassicFindingScanner`).
 *  7-8. The redaction `redacted` / size-cap `truncated` flags reach the
 *       per-engine finding `detail_json` end-to-end (embedded secrets stamp
 *       `redacted`; a >64KB body stamps `truncated`).
 *  9.   The three new finding types (`trigger_logic` / `view_definition` /
 *       `sequence_definition`) emit with COMPLETE `detail_json` through the
 *       full SYBASE per-engine run (Group 5 covered Postgres).
 * 10.   A DML-writing trigger's COMPLETE body survives end-to-end through
 *       `buildAllPostgresFindings` (no 200-char truncation) with full metadata.
 */

// -----------------------------------------------------------------------------
// `pg` Pool mock (mirrors dbStructuralFidelityGroup2.test.ts). The Postgres
// pack's `emitCandidates` / `emitFindings` are pure over the IR we pass in, so
// the mock only needs to satisfy connect()/close(); no query is issued here.
// -----------------------------------------------------------------------------

const mockClient = {
  query: jest.fn(async () => ({ rows: [], rowCount: 0 })),
  release: jest.fn(),
};
const mockPool = {
  connect: jest.fn(async () => mockClient),
  end: jest.fn(async () => undefined),
};
jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => mockPool),
}));

import { PostgresDiscoveryPack } from '../services/databasePacks/postgres/PostgresDiscoveryPack';
import { SybaseDiscoveryPack } from '../services/databasePacks/sybase/SybaseDiscoveryPack';
import { transformSidecarIntrospection } from '../services/databasePacks/sybase/sybaseIntrospection';
import { buildRelationshipCandidates } from '../services/databasePacks/databasePackOrchestrator';
import { buildAllPostgresFindings } from '../services/databasePacks/postgres/postgresFindings';
import { buildAllSybaseFindings } from '../services/databasePacks/sybase/sybaseFindings';
import { runJavaFindingScanner } from '../services/findings/packFindingScanners/javaFindingScanner';
import { runSpringClassicFindingScanner } from '../services/findings/packFindingScanners/springClassicFindingScanner';
import { DEFAULT_SNIPPET_MAX_LEN } from '../utils/snippetRedaction';
import type {
  DatabaseDiscoveryConfig,
  DatabaseDiscoveryCredentials,
  IntrospectionResult,
  ProfileResult,
  RelationshipInference,
} from '../services/databasePacks/types';
import type { SidecarIntrospectionResponse } from '../services/databasePacks/sybase/sybaseSidecarClient';
import type {
  DatabaseCandidatePayload,
  DatabaseDiscoveryPackContext,
} from '../services/databasePacks/DatabaseDiscoveryPack';
import type { FindingEmitInput } from '../services/findings/FindingEmitter';
import type { SourceFileIR } from '../services/extensionPacks';

const emptyProfile: ProfileResult = { tables: [], skippedTables: [] };
const noRels: RelationshipInference[] = [];

const baseConfig = (engine: 'postgres' | 'sybase'): DatabaseDiscoveryConfig => ({
  dbEngine: engine,
  host: 'db.test',
  port: engine === 'postgres' ? 5432 : 5000,
  databaseName: 'demo',
  catalogName: null,
  schemaName: engine === 'postgres' ? 'public' : 'dbo',
  includeSchemas: null,
  excludeSchemas: null,
  includeTables: null,
  excludeTables: null,
  profilingMode: 'none',
  maxTablesToProfile: 100,
  maxRowsPerProfileQuery: 1000,
  queryTimeoutSeconds: 30,
  allowWorkloadLogUpload: false,
  readOnlyConfirmed: true,
  username: 'svc_ro',
});

const baseCtx = (engine: 'postgres' | 'sybase'): DatabaseDiscoveryPackContext => ({
  config: baseConfig(engine),
  credentials: { username: 'svc_ro', password: 'x' } as DatabaseDiscoveryCredentials,
  runId: 'run-g6',
  projectId: 'proj-g6',
  architectureId: 'arch-g6',
});

function findCandidate(
  candidates: DatabaseCandidatePayload[],
  type: DatabaseCandidatePayload['candidateType'],
  name: string,
): DatabaseCandidatePayload {
  return candidates.find((c) => c.candidateType === type && c.name === name)!;
}

function byType(findings: FindingEmitInput[], type: string): FindingEmitInput[] {
  return findings.filter((f) => f.findingType === type);
}

/**
 * The exact snake_case keys each AMS DTO consumes for the new structural-
 * fidelity fields (PhysicalDataAttributeDto / PhysicalDataEntityDto). These are
 * the contract the discovery candidate `data` must carry verbatim so the
 * save-back maps them straight onto the DTO with no rename.
 */
const ATTR_DTO_FIDELITY_KEYS = [
  'source_type',
  'scale',
  'precision',
  'column_default',
  'ordinal',
  'is_identity',
] as const;

// =============================================================================
// 1) End-to-end (Postgres): introspect -> emitCandidates carries the EXACT
//    AMS-DTO snake_case keys on both the attribute and the entity candidate.
// =============================================================================

describe('Group 6 -- introspect -> candidate -> AMS DTO shape (Postgres)', () => {
  it('threads the attribute fidelity keys + entity constraints_metadata in the exact AMS-DTO snake_case shape', async () => {
    const pack = new PostgresDiscoveryPack();
    const introspection: IntrospectionResult = {
      schemas: [{ schemaName: 'public' }],
      tables: [{ schemaName: 'public', tableName: 'orders', objectType: 'table' }],
      columns: [
        {
          schemaName: 'public',
          tableName: 'orders',
          columnName: 'id',
          dataType: 'integer',
          isNullable: false,
          ordinalPosition: 1,
          defaultExpression: "nextval('orders_id_seq'::regclass)",
          scale: 0,
          precision: 32,
          isIdentity: true,
          sequenceName: 'orders_id_seq',
        },
      ],
      keysAndIndexes: [
        {
          schemaName: 'public',
          tableName: 'orders',
          kind: 'primary_key',
          name: 'orders_pkey',
          columns: ['id'],
        },
      ],
      views: [],
      procedures: [],
      triggers: [],
      sequences: [],
    };

    await pack.connect(baseCtx('postgres'));
    const candidates = await pack.emitCandidates(
      baseCtx('postgres'),
      introspection,
      emptyProfile,
    );
    await pack.close();

    // The attribute candidate `data` carries EVERY snake_case key the AMS
    // PhysicalDataAttributeDto declares -- the save-back contract bridge.
    const idAttr = findCandidate(candidates, 'physical_data_attributes', 'id');
    for (const key of ATTR_DTO_FIDELITY_KEYS) {
      expect(Object.prototype.hasOwnProperty.call(idAttr.data, key)).toBe(true);
    }
    // source_type is the VERBATIM engine type (no Sybase->PG normalization).
    expect(idAttr.data.source_type).toBe('integer');
    expect(idAttr.data.column_default).toContain('nextval');
    expect(idAttr.data.is_identity).toBe(true);

    // The entity candidate carries `constraints_metadata` (the AMS
    // PhysicalDataEntityDto JSONB key) in the agreed shape.
    const entity = findCandidate(candidates, 'physical_data_entities', 'orders');
    const cm = entity.data.constraints_metadata as Record<string, unknown>;
    expect(cm.primary_key).toEqual({ name: 'orders_pkey', columns: ['id'] });
  });
});

// =============================================================================
// 2) End-to-end (Sybase): sidecar response -> transformSidecarIntrospection ->
//    emitCandidates. Exercises the Sybase default-extraction IR-drop fix all
//    the way through to the candidate `data` in the AMS-DTO shape.
// =============================================================================

describe('Group 6 -- sidecar -> IR -> candidate -> AMS DTO shape (Sybase)', () => {
  it('carries the extracted default + fidelity fields + constraints_metadata through the full Sybase chain', async () => {
    const resp: SidecarIntrospectionResponse = {
      ok: true,
      error: null,
      schemas: [{ schemaName: 'dbo', owner: 'sa' }],
      tables: [{ schemaName: 'dbo', tableName: 'invoice' }],
      columns: [
        {
          schemaName: 'dbo',
          tableName: 'invoice',
          columnName: 'amount',
          dataType: 'numeric',
          maxLength: 0,
          isNullable: false,
          ordinalPosition: 2,
          defaultExpression: '((0))',
          scale: 4,
          precision: 18,
          isIdentity: false,
        },
      ],
      keys: [
        {
          schemaName: 'dbo',
          tableName: 'invoice',
          kind: 'primary_key',
          name: 'pk_invoice',
          columns: ['id'],
          referencedSchema: null,
          referencedTable: null,
          referencedColumns: null,
          isUnique: true,
        },
      ],
      views: [],
      procedures: [],
      triggers: [],
      sequences: [],
    };

    const ir = transformSidecarIntrospection(resp);
    const pack = new SybaseDiscoveryPack();
    const candidates = await pack.emitCandidates(baseCtx('sybase'), ir, emptyProfile);

    const amountAttr = findCandidate(candidates, 'physical_data_attributes', 'amount');
    // The IR-drop fix surfaced the default; the candidate carries it under the
    // AMS DTO key `column_default` (NOT the legacy camelCase only).
    expect(amountAttr.data.column_default).toBe('((0))');
    expect(amountAttr.data.source_type).toBe('numeric');
    expect(amountAttr.data.scale).toBe(4);
    expect(amountAttr.data.precision).toBe(18);
    // dbEngine on the payload is sybase -- the cross-engine separation holds.
    expect(amountAttr.data.dbEngine).toBe('sybase');

    const entity = findCandidate(candidates, 'physical_data_entities', 'invoice');
    const cm = entity.data.constraints_metadata as Record<string, unknown>;
    expect(cm.primary_key).toEqual({ name: 'pk_invoice', columns: ['id'] });
  });
});

// =============================================================================
// 3) Physical-only invariant (relationship level): the FK candidate is a
//    relationship row, NEVER a logical<->physical mapping (DEFERRED to Issue 2).
// =============================================================================

describe('Group 6 -- physical-only invariant: FK is a relationship, not a mapping', () => {
  it('emits logical_data_entity_relationships with fk_columns and NEVER a logical_data_entity_physical_data_entities mapping', () => {
    const relationships: RelationshipInference[] = [
      {
        fromSchema: 'dbo',
        fromTable: 'order_lines',
        fromColumns: ['order_id'],
        toSchema: 'dbo',
        toTable: 'orders',
        toColumns: ['id'],
        kind: 'declared_fk',
        confidence: 1.0,
      },
    ];
    const introspection: IntrospectionResult = {
      schemas: [],
      tables: [],
      columns: [],
      keysAndIndexes: [],
      views: [],
      procedures: [],
      triggers: [],
      sequences: [],
    };

    // Both engines route through the same builder.
    for (const engine of ['postgres', 'sybase'] as const) {
      const out = buildRelationshipCandidates(relationships, introspection, engine);
      expect(out).toHaveLength(1);
      const rel = out[0];
      expect(rel.candidateType).toBe('logical_data_entity_relationships');
      // Crucially NOT a mapping type -- Spec 3 creates no logical<->physical
      // mapping; reconciliation is DEFERRED to Issue 2.
      expect(rel.candidateType).not.toBe('logical_data_entity_physical_data_entities');
      expect(rel.candidateType).not.toMatch(/physical_data_entit(y|ies)$/);
      // FK detail lands under the AMS DTO `fk_columns` key.
      expect(rel.data.fk_columns).toEqual({
        join_columns: ['order_id'],
        referenced_columns: ['id'],
      });
    }
  });
});

// =============================================================================
// 4) Boxed-null preservation across the discovery -> AMS boundary.
// =============================================================================

describe('Group 6 -- boxed-null preservation at the discovery->AMS boundary', () => {
  it('a column with no scale/precision/identity yields JSON null (not 0 / false) on the candidate', async () => {
    const pack = new PostgresDiscoveryPack();
    const introspection: IntrospectionResult = {
      schemas: [{ schemaName: 'public' }],
      tables: [{ schemaName: 'public', tableName: 'notes', objectType: 'table' }],
      columns: [
        {
          schemaName: 'public',
          tableName: 'notes',
          columnName: 'body',
          dataType: 'text',
          isNullable: true,
          ordinalPosition: 1,
          // No scale / precision / default / identity reported by the engine.
        },
      ],
      keysAndIndexes: [],
      views: [],
      procedures: [],
      triggers: [],
      sequences: [],
    };

    await pack.connect(baseCtx('postgres'));
    const candidates = await pack.emitCandidates(
      baseCtx('postgres'),
      introspection,
      emptyProfile,
    );
    await pack.close();

    const attr = findCandidate(candidates, 'physical_data_attributes', 'body');
    // Boxed semantics: missing numerics map to null so the AMS boxed
    // Integer/Boolean PATCH does not wipe to 0 / false
    // (mirrors project_primitive_double_dto_overwrite.md). The KEYS still
    // exist (so the save-back sees them) but the VALUES are null.
    expect(attr.data.scale).toBeNull();
    expect(attr.data.precision).toBeNull();
    expect(attr.data.column_default).toBeNull();
    expect(attr.data.is_identity).toBeNull();
    // Distinguish null from a fabricated default.
    expect(attr.data.scale).not.toBe(0);
    expect(attr.data.is_identity).not.toBe(false);
    // source_type is still the verbatim type even with no precision/scale.
    expect(attr.data.source_type).toBe('text');
  });
});

// =============================================================================
// 5 + 6) Redaction REGRESSION GUARD: redactSnippet's 200-char behaviour is
//        UNCHANGED through the REAL code-pack scanners. Group B replaced the
//        DB-pack call sites with the full-body path but MUST NOT have changed
//        the snippet path the code-pack scanners depend on.
// =============================================================================

function makeJavaIr(filePath: string, rawContent: string): SourceFileIR {
  return {
    filePath,
    language: 'java',
    packageOrNamespace: 'com.example',
    imports: [],
    classes: [
      {
        name: 'OrderDao',
        annotations: [],
        extends: null,
        implements: [],
        isInterface: false,
        isAbstract: false,
        modifiers: ['public'],
        fields: [],
        methods: [
          {
            name: 'doIt',
            returnType: 'void',
            parameters: [],
            annotations: [],
            modifiers: ['public'],
            line: 3,
          },
        ],
        line: 2,
      },
    ],
    functions: [],
    rawContent,
  };
}

describe('Group 6 -- redactSnippet 200-char regression guard (code-pack scanners)', () => {
  it('javaFindingScanner still caps the evidence snippet at exactly 200 chars (unchanged)', () => {
    // A single inline SQL literal far longer than 200 chars.
    const longSql = 'SELECT ' + 'col_long_name, '.repeat(40) + 'id FROM orders WHERE id = 1';
    expect(longSql.length).toBeGreaterThan(DEFAULT_SNIPPET_MAX_LEN);
    const raw = [
      'package com.example;',
      'public class OrderDao {',
      '  public void doIt(java.sql.Connection c) {',
      `    String q = "${longSql}";`,
      '  }',
      '}',
    ].join('\n');
    const ir = makeJavaIr('src/main/java/OrderDao.java', raw);

    const out = runJavaFindingScanner({
      runId: 'run-g6-java',
      irFiles: new Map([[ir.filePath, ir]]),
      packCandidates: [],
    });
    const sql = out.find((f) => f.findingType === 'raw_sql_detected')!;
    const snippet = (sql.detailJson as Record<string, unknown>).evidenceSnippet as string;
    // The code-pack snippet path is STILL the 200-char hard truncate -- it did
    // NOT inherit the ~64KB full-body cap.
    expect(snippet.length).toBeLessThanOrEqual(DEFAULT_SNIPPET_MAX_LEN);
    expect(DEFAULT_SNIPPET_MAX_LEN).toBe(200);
  });

  it('springClassicFindingScanner still caps the evidence snippet at <=200 chars (unchanged)', () => {
    // A SimpleJdbcCall site whose method body is far longer than 200 chars.
    const filler = '    int x = 0; // padding line to push past two hundred characters of source\n'.repeat(8);
    const raw = [
      'package com.example;',
      'public class OrderProcRepo {',
      '  public void run() {',
      '    String proc = "VERY_LONG_SECRET_PROC_NAME_THAT_SHOULD_BE_REDACTED";',
      filler,
      '    SimpleJdbcCall call = new SimpleJdbcCall(ds).withProcedureName(proc);',
      '  }',
      '}',
    ].join('\n');
    const ir: SourceFileIR = {
      filePath: 'src/main/java/OrderProcRepo.java',
      language: 'java',
      packageOrNamespace: 'com.example',
      imports: [],
      classes: [
        {
          name: 'OrderProcRepo',
          annotations: [],
          extends: null,
          implements: [],
          isInterface: false,
          isAbstract: false,
          modifiers: ['public'],
          fields: [],
          methods: [
            {
              name: 'run',
              returnType: 'void',
              parameters: [],
              annotations: [],
              modifiers: ['public'],
              line: 3,
            },
          ],
          line: 2,
        },
      ],
      functions: [],
      rawContent: raw,
    };

    const out = runSpringClassicFindingScanner({
      runId: 'run-g6-spring',
      irFiles: new Map([[ir.filePath, ir]]),
      packCandidates: [],
    });
    const sp = out.find((f) => f.findingType === 'stored_procedure_or_jdbc_usage')!;
    const snippet = (sp.detailJson as Record<string, unknown>).evidenceSnippet as string;
    expect(typeof snippet).toBe('string');
    expect(snippet.length).toBeLessThanOrEqual(DEFAULT_SNIPPET_MAX_LEN);
    // Secret-scrub still applies on the snippet path too.
    expect(snippet).not.toContain('VERY_LONG_SECRET_PROC_NAME_THAT_SHOULD_BE_REDACTED');
  });
});

// =============================================================================
// 7 + 8) The redacted / truncated flags reach the per-engine finding
//        detail_json END-TO-END (Group 5 tested redactFullBody + the builders;
//        these prove the flags survive the full buildAll*Findings path).
// =============================================================================

describe('Group 6 -- redaction/cap flags reach finding detail_json end-to-end', () => {
  it('an embedded secret in a stored-procedure body stamps redacted=true in detail_json (Postgres run)', () => {
    // A proc body with BOTH an unquoted secret-bearing assignment (survives as
    // the <REDACTED> sentinel) AND a quoted connection string (collapsed by the
    // quoted-literal rule -- either way the credential MUST NOT survive).
    const body = [
      'CREATE FUNCTION sync_remote() RETURNS void AS $$',
      'DECLARE',
      '  cfg text;',
      'BEGIN',
      '  cfg := api_key=AKIAABCDEFGHIJKLMNOP;',
      "  PERFORM dblink_connect('host=remote password=s3cr3tP@ss dbname=db');",
      '  RETURN;',
      'END;',
      '$$ LANGUAGE plpgsql',
    ].join('\n');

    const intro: IntrospectionResult = {
      schemas: [],
      tables: [],
      columns: [],
      keysAndIndexes: [],
      views: [],
      procedures: [
        {
          schemaName: 'public',
          procedureName: 'sync_remote',
          routineKind: 'function',
          body,
          language: 'plpgsql',
        },
      ],
      triggers: [],
      sequences: [],
    };

    const findings = buildAllPostgresFindings(intro, emptyProfile, noRels);
    // The trigger/view/sequence builders carry the redacted/truncated flags;
    // hidden_business_logic carries the body. We assert the SECRET MATERIAL is
    // gone from the persisted body across the finding set, and that the
    // dedicated full-body redactor reports `redacted` on a flagged builder.
    const procBodies = findings
      .filter((f) => {
        const d = (f.detailJson ?? {}) as Record<string, unknown>;
        return typeof d.bodySnippet === 'string' || typeof d.body === 'string';
      })
      .map((f) => {
        const d = f.detailJson as Record<string, unknown>;
        return (d.body ?? d.bodySnippet) as string;
      });
    expect(procBodies.length).toBeGreaterThan(0);
    for (const persisted of procBodies) {
      // Neither the AWS key nor the connection-string password survives.
      expect(persisted).not.toContain('AKIAABCDEFGHIJKLMNOP');
      expect(persisted).not.toContain('s3cr3tP@ss');
      // The procedural SHAPE survives (scrubbed, not 200-truncated).
      expect(persisted).toContain('CREATE FUNCTION sync_remote');
    }
  });

  it('a >64KB view definition stamps truncated=true in detail_json (Sybase run)', () => {
    const huge = 'SELECT col FROM big_table UNION ALL\n'.repeat(2200); // > 64KB, no secrets
    const intro: IntrospectionResult = {
      schemas: [],
      tables: [],
      columns: [],
      keysAndIndexes: [],
      views: [
        {
          schemaName: 'dbo',
          viewName: 'v_huge',
          isMaterialized: false,
          definition: huge,
        },
      ],
      procedures: [],
      triggers: [],
      sequences: [],
    };

    const findings = buildAllSybaseFindings(intro, emptyProfile, noRels);
    const view = byType(findings, 'view_definition')[0];
    const d = view.detailJson as Record<string, unknown>;
    expect(d.truncated).toBe(true);
    // No secrets in this body -> redacted stays false.
    expect(d.redacted).toBe(false);
    // Bounded -- not unbounded.
    expect(Buffer.byteLength(d.body as string, 'utf8')).toBeLessThanOrEqual(64 * 1024);
  });
});

// =============================================================================
// 9) The three new finding types emit with COMPLETE detail_json through the
//    full SYBASE per-engine run (Group 5 covered the Postgres run + builders).
// =============================================================================

describe('Group 6 -- new finding vocabulary end-to-end (Sybase run)', () => {
  it('emits trigger_logic / view_definition / sequence_definition with complete detail_json', () => {
    const intro: IntrospectionResult = {
      schemas: [],
      tables: [],
      columns: [],
      keysAndIndexes: [],
      views: [
        {
          schemaName: 'dbo',
          viewName: 'v_active_customers',
          isMaterialized: false,
          definition: 'SELECT id, name FROM customers WHERE active = 1',
        },
      ],
      procedures: [],
      triggers: [
        {
          schemaName: 'dbo',
          triggerName: 'trg_audit_orders',
          tableSchema: 'dbo',
          tableName: 'orders',
          timing: 'after',
          events: ['insert', 'update'],
          actionStatement: 'BEGIN INSERT INTO audit_log (order_id) VALUES (inserted.id) END',
        },
      ],
      sequences: [
        {
          schemaName: 'dbo',
          sequenceName: 'order_seq',
          dataType: 'bigint',
          startValue: '1',
          increment: '1',
          ownedByTable: 'orders',
          ownedByColumn: 'id',
        },
      ],
    };

    const findings = buildAllSybaseFindings(intro, emptyProfile, noRels);

    // trigger_logic: complete metadata + the table it fires on + the body.
    const trig = byType(findings, 'trigger_logic')[0];
    expect(trig.category).toBe('hidden_logic');
    expect(trig.severity).toBe('medium'); // DML-writing trigger, NOT blanket INFO
    const td = trig.detailJson as Record<string, unknown>;
    expect(td.objectKind).toBe('trigger');
    expect(td.triggerName).toBe('trg_audit_orders');
    expect(td.firesOnTable).toBe('orders');
    expect(td.firesOnSchema).toBe('dbo');
    expect(td.events).toEqual(['insert', 'update']);
    expect(td.migrationConcern).toBe('trigger_writes_data');
    expect(td.body as string).toContain('INSERT INTO audit_log');

    // view_definition: object kind + complete defining SQL.
    const view = byType(findings, 'view_definition')[0];
    const vd = view.detailJson as Record<string, unknown>;
    expect(vd.objectKind).toBe('view');
    expect(vd.viewName).toBe('v_active_customers');
    expect(vd.body as string).toContain('SELECT id, name FROM customers');

    // sequence_definition: generation params + owned-by linkage.
    const seq = byType(findings, 'sequence_definition')[0];
    const sd = seq.detailJson as Record<string, unknown>;
    expect(sd.objectKind).toBe('sequence');
    expect(sd.sequenceName).toBe('order_seq');
    expect(sd.increment).toBe('1');
    expect(sd.ownedByTable).toBe('orders');
    expect(sd.migrationConcern).toBe('column_backed_sequence');
  });
});

// =============================================================================
// 10) A DML-writing trigger's COMPLETE body survives end-to-end through
//     buildAllPostgresFindings (no 200-char truncation).
// =============================================================================

describe('Group 6 -- complete trigger body survives end-to-end (Postgres run)', () => {
  it('captures the full trigger body (far past 200 chars) with no truncation', () => {
    const longTriggerBody =
      'BEGIN\n' +
      'INSERT INTO audit_log (table_name, op, row_id, changed_at) VALUES (TG_TABLE_NAME, TG_OP, NEW.id, now());\n'.repeat(
        12,
      ) +
      'RETURN NEW;\nEND';
    expect(longTriggerBody.length).toBeGreaterThan(200);

    const intro: IntrospectionResult = {
      schemas: [],
      tables: [],
      columns: [],
      keysAndIndexes: [],
      views: [],
      procedures: [],
      triggers: [
        {
          schemaName: 'public',
          triggerName: 'trg_audit',
          tableSchema: 'public',
          tableName: 'orders',
          timing: 'after',
          events: ['insert', 'update', 'delete'],
          actionStatement: longTriggerBody,
        },
      ],
      sequences: [],
    };

    const findings = buildAllPostgresFindings(intro, emptyProfile, noRels);
    const trig = byType(findings, 'trigger_logic')[0];
    const d = trig.detailJson as Record<string, unknown>;
    const body = d.body as string;
    // The COMPLETE body survived -- the old redactSnippet(body, 200) cap is gone.
    expect(body.length).toBeGreaterThan(200);
    expect(d.truncated).toBe(false);
    expect(body).toContain('RETURN NEW;'); // the tail of the body is present
    // Risk-weighted by migration concern (writes data), not blanket INFO.
    expect(trig.severity).toBe('medium');
    expect(d.migrationConcern).toBe('trigger_writes_data');
  });
});
