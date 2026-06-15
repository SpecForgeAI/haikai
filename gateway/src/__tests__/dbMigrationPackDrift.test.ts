/**
 * Expected-vs-actual schema verification diff — focused tests.
 *
 * Spec: 2026-06-11 Source-Grade DB Schema + Data Migration Pack —
 * Task Group 5 (Task 5.1).
 *
 * Covers ONLY:
 *   1. Classification — identical object -> `match`, absent expected object
 *      -> `missing`, differing object -> `mismatch` with a structured
 *      property/expected/actual detail list (column type, nullability,
 *      identity, FK referential action, index direction).
 *   2. Objects present in the target but not expected land in the
 *      INFORMATIONAL `unexpected_in_target` section (never mismatches).
 *   3. A scope filter restricts the diff to the requested schemas/tables and
 *      the persisted report records `scan_scope_json`.
 *   4. Every verify run APPENDS a new drift-report row (`source: 'in_tool'`)
 *      — append-only POSTs, prior rows never touched.
 */

jest.mock('../config', () => ({
  getConfig: () => ({
    architectureModelServiceBaseUrl: 'http://localhost:8080',
    discoveryServiceBaseUrl: 'http://localhost:8091',
  }),
  resetConfig: jest.fn(),
}));

jest.mock('../services/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockFetch = jest.fn();
(global as unknown as { fetch: typeof mockFetch }).fetch = mockFetch;

import {
  ActualSchemaSnapshot,
  diffExpectedVsActual,
  DriftObjectEntry,
  runDbMigrationPackVerification,
} from '../services/dbMigrationPackDrift';
import { ExpectedSchema } from '../services/dbMigrationPack/types';
import express from 'express';
import request from 'supertest';
import { dbMigrationPackRouter } from '../routes/dbMigrationPack';
import {
  buildDbMigrationPackArtifacts,
  buildSourceSchemaIr,
  GenerationInputs,
} from '../services/dbMigrationPackHandler';

// ---------------------------------------------------------------------------
// Fixtures — the manifest expected-schema vocabulary vs a scan snapshot
// ---------------------------------------------------------------------------

function makeExpected(): ExpectedSchema {
  return {
    tables: [
      { schemaName: 'dbo', tableName: 'orders' },
      { schemaName: 'dbo', tableName: 'customers' },
    ],
    columns: [
      {
        schemaName: 'dbo',
        tableName: 'orders',
        columnName: 'order_id',
        dataType: 'integer',
        isNullable: false,
        isPrimaryKey: true,
        defaultExpression: null,
        isIdentity: true,
        isGenerated: false,
        generationExpression: null,
      },
      {
        schemaName: 'dbo',
        tableName: 'orders',
        columnName: 'amount',
        dataType: 'numeric(19,4)',
        isNullable: false,
        isPrimaryKey: false,
        defaultExpression: null,
        isIdentity: false,
        isGenerated: false,
        generationExpression: null,
      },
      {
        schemaName: 'dbo',
        tableName: 'customers',
        columnName: 'id',
        dataType: 'integer',
        isNullable: false,
        isPrimaryKey: true,
        defaultExpression: null,
        isIdentity: true,
        isGenerated: false,
        generationExpression: null,
      },
    ],
    keysAndIndexes: [
      {
        schemaName: 'dbo',
        tableName: 'orders',
        kind: 'primary_key',
        name: 'pk_orders',
        columns: ['order_id'],
        referencedSchema: null,
        referencedTable: null,
        referencedColumns: null,
        onDelete: null,
        onUpdate: null,
        isUnique: true,
        columnDirections: null,
      },
      {
        schemaName: 'dbo',
        tableName: 'orders',
        kind: 'foreign_key',
        name: 'fk_orders__customers__customer_id',
        columns: ['customer_id'],
        referencedSchema: 'dbo',
        referencedTable: 'customers',
        referencedColumns: ['id'],
        onDelete: 'CASCADE',
        onUpdate: null,
        isUnique: false,
        columnDirections: null,
      },
      {
        schemaName: 'dbo',
        tableName: 'orders',
        kind: 'index',
        name: 'ix_orders_amount',
        columns: ['amount'],
        referencedSchema: null,
        referencedTable: null,
        referencedColumns: null,
        onDelete: null,
        onUpdate: null,
        isUnique: false,
        columnDirections: ['DESC'],
      },
    ],
    sequences: [],
  };
}

/**
 * Actual target snapshot (information_schema spellings on purpose):
 *  - dbo.orders exists; order_id identical (long type names); amount drifted
 *    to numeric(10,2) AND nullable; FK present but ON DELETE NO ACTION;
 *    index present but ascending.
 *  - dbo.customers is ENTIRELY MISSING.
 *  - dbo.audit_log + orders.created_by are unexpected target-side extras.
 */
function makeActual(): ActualSchemaSnapshot {
  return {
    tables: [
      { schemaName: 'dbo', tableName: 'orders', objectType: 'table' },
      { schemaName: 'dbo', tableName: 'audit_log', objectType: 'table' },
    ],
    columns: [
      {
        schemaName: 'dbo',
        tableName: 'orders',
        columnName: 'order_id',
        dataType: 'integer',
        isNullable: false,
        ordinalPosition: 1,
        isIdentity: true,
      },
      {
        schemaName: 'dbo',
        tableName: 'orders',
        columnName: 'amount',
        dataType: 'numeric',
        isNullable: true,
        ordinalPosition: 2,
        precision: 10,
        scale: 2,
        isIdentity: false,
      },
      {
        schemaName: 'dbo',
        tableName: 'orders',
        columnName: 'created_by',
        dataType: 'character varying',
        isNullable: true,
        ordinalPosition: 3,
        maxLength: 50,
      },
      {
        schemaName: 'dbo',
        tableName: 'audit_log',
        columnName: 'id',
        dataType: 'bigint',
        isNullable: false,
        ordinalPosition: 1,
      },
    ],
    keysAndIndexes: [
      {
        schemaName: 'dbo',
        tableName: 'orders',
        kind: 'primary_key',
        name: 'pk_orders',
        columns: ['order_id'],
        isUnique: true,
      },
      {
        schemaName: 'dbo',
        tableName: 'orders',
        kind: 'foreign_key',
        name: 'fk_orders__customers__customer_id',
        columns: ['customer_id'],
        referencedSchema: 'dbo',
        referencedTable: 'customers',
        referencedColumns: ['id'],
        onDelete: 'NO ACTION',
        onUpdate: 'NO ACTION',
      },
      {
        schemaName: 'dbo',
        tableName: 'orders',
        kind: 'index',
        name: 'ix_orders_amount',
        columns: ['amount'],
        isUnique: false,
        columnDirections: ['ASC'],
      },
    ],
    sequences: [],
  };
}

function byRef(
  objects: DriftObjectEntry[],
  objectType: string,
  objectRef: string
): DriftObjectEntry | undefined {
  return objects.find((o) => o.object_type === objectType && o.object_ref === objectRef);
}

beforeEach(() => {
  mockFetch.mockReset();
});

// ---------------------------------------------------------------------------
// 1. classification
// ---------------------------------------------------------------------------

describe('diffExpectedVsActual — classification (5.2)', () => {
  it('classifies match / missing / mismatch with structured property detail lists', () => {
    const report = diffExpectedVsActual(makeExpected(), makeActual());

    // match — identical objects.
    expect(byRef(report.objects, 'table', 'dbo.orders')?.classification).toBe('match');
    expect(byRef(report.objects, 'column', 'dbo.orders.order_id')?.classification).toBe('match');
    expect(byRef(report.objects, 'primary_key', 'dbo.orders.pk_orders')?.classification).toBe(
      'match'
    );

    // missing — expected, absent in the target (table AND its column).
    expect(byRef(report.objects, 'table', 'dbo.customers')?.classification).toBe('missing');
    expect(byRef(report.objects, 'column', 'dbo.customers.id')?.classification).toBe('missing');

    // mismatch — column type (catalog spelling normalized) + nullability.
    const amount = byRef(report.objects, 'column', 'dbo.orders.amount');
    expect(amount?.classification).toBe('mismatch');
    expect(amount?.details).toContainEqual({
      property: 'type',
      expected: 'numeric(19,4)',
      actual: 'numeric(10,2)',
    });
    expect(amount?.details).toContainEqual({
      property: 'nullability',
      expected: 'NOT NULL',
      actual: 'NULL',
    });

    // mismatch — FK referential action reproduced in the detail list.
    const fk = byRef(report.objects, 'foreign_key', 'dbo.orders.fk_orders__customers__customer_id');
    expect(fk?.classification).toBe('mismatch');
    expect(fk?.details).toContainEqual({
      property: 'on_delete',
      expected: 'CASCADE',
      actual: 'NO ACTION',
    });

    // mismatch — index column direction.
    const ix = byRef(report.objects, 'index', 'dbo.orders.ix_orders_amount');
    expect(ix?.classification).toBe('mismatch');
    expect(ix?.details).toContainEqual({
      property: 'column_directions',
      expected: 'DESC',
      actual: 'ASC',
    });

    // Summary counts agree with the per-object classifications.
    expect(report.summary.match_count).toBe(
      report.objects.filter((o) => o.classification === 'match').length
    );
    expect(report.summary.missing_count).toBeGreaterThanOrEqual(2);
    expect(report.summary.mismatch_count).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 2. unexpected_in_target is informational
// ---------------------------------------------------------------------------

describe('diffExpectedVsActual — unexpected_in_target (5.2)', () => {
  it('reports target-only objects in the informational section, never as mismatches', () => {
    const report = diffExpectedVsActual(makeExpected(), makeActual());

    const unexpectedRefs = report.unexpected_in_target.map(
      (u) => `${u.object_type}:${u.object_ref}`
    );
    expect(unexpectedRefs).toContain('table:dbo.audit_log');
    expect(unexpectedRefs).toContain('column:dbo.orders.created_by');
    // Columns of an unexpected table are not double-reported.
    expect(unexpectedRefs).not.toContain('column:dbo.audit_log.id');

    // Informational ONLY: nothing unexpected appears in the classified
    // objects and the summary's mismatch count is untouched by it.
    expect(byRef(report.objects, 'table', 'dbo.audit_log')).toBeUndefined();
    expect(byRef(report.objects, 'column', 'dbo.orders.created_by')).toBeUndefined();
    expect(report.summary.unexpected_count).toBe(report.unexpected_in_target.length);
  });
});

// ---------------------------------------------------------------------------
// 3. scope filter + scan_scope_json
// ---------------------------------------------------------------------------

describe('verify scope (5.2 / 5.3)', () => {
  it('restricts the diff to the requested tables and persists scan_scope_json on the report row', async () => {
    const scope = { schemas: ['dbo'], tables: ['dbo.orders'] };

    // The pure diff: dbo.customers objects are OUT of a dbo.orders-only scope.
    const scoped = diffExpectedVsActual(makeExpected(), makeActual(), scope);
    expect(byRef(scoped.objects, 'table', 'dbo.customers')).toBeUndefined();
    expect(byRef(scoped.objects, 'column', 'dbo.customers.id')).toBeUndefined();
    expect(byRef(scoped.objects, 'table', 'dbo.orders')?.classification).toBe('match');
    expect(
      scoped.unexpected_in_target.find((u) => u.object_ref === 'dbo.audit_log')
    ).toBeUndefined();

    // The orchestration records the scope on the persisted row.
    const appendDriftReport = jest
      .fn()
      .mockResolvedValue({ id: 'dr-1', pack_id: 'pack-1', match_count: 0 });
    const result = await runDbMigrationPackVerification(
      {
        projectId: 'p-1',
        packId: 'pack-1',
        connection: {
          host: 'pg',
          port: 5432,
          databaseName: 'db',
          username: 'u',
          password: 'pw',
        },
        scope,
      },
      {
        fetchPack: jest.fn().mockResolvedValue({
          id: 'pack-1',
          manifest_json: { expected_schema: makeExpected() },
        }),
        scanTarget: jest.fn().mockResolvedValue(makeActual()),
        appendDriftReport,
      }
    );

    expect(appendDriftReport).toHaveBeenCalledTimes(1);
    const [, , body] = appendDriftReport.mock.calls[0];
    expect(body.scan_scope_json).toEqual(scope);
    expect(body.source).toBe('in_tool');
    expect(body.match_count).toBe(result.report.summary.match_count);
    expect(body.mismatch_count).toBe(result.report.summary.mismatch_count);
    expect(body.report_json).toEqual(result.report);
  });
});

// ---------------------------------------------------------------------------
// 4. append-only drift history
// ---------------------------------------------------------------------------

describe('drift history persistence (5.3)', () => {
  it('appends a NEW drift-report row per verify run (POST only — prior rows never touched)', async () => {
    // Default appendDriftReport rides the real AMS endpoint via fetch.
    mockFetch.mockResolvedValue({
      ok: true,
      status: 201,
      headers: { get: () => 'application/json' },
      text: async () => JSON.stringify({ id: 'dr-new', pack_id: 'pack-1' }),
    });

    const deps = {
      fetchPack: jest.fn().mockResolvedValue({
        id: 'pack-1',
        manifest_json: { expected_schema: makeExpected() },
      }),
      scanTarget: jest.fn().mockResolvedValue(makeActual()),
    };
    const requestArgs = {
      projectId: 'p-1',
      packId: 'pack-1',
      connection: {
        host: 'pg',
        port: 5432,
        databaseName: 'db',
        username: 'u',
        password: 'pw',
      },
    };

    await runDbMigrationPackVerification(requestArgs, deps);
    await runDbMigrationPackVerification(
      { ...requestArgs, scope: { tables: ['dbo.orders'] } },
      deps
    );

    // TWO appends — one per run — both POSTs to the append-only history
    // endpoint; no PUT/PATCH/DELETE ever touches an existing row.
    expect(mockFetch).toHaveBeenCalledTimes(2);
    for (const [url, init] of mockFetch.mock.calls) {
      expect(String(url)).toBe(
        'http://localhost:8080/api/projects/p-1/db-migration-packs/pack-1/drift-reports'
      );
      expect((init as { method: string }).method).toBe('POST');
    }
    // The second run recorded ITS OWN scope — history rows are independent.
    const secondBody = JSON.parse(String((mockFetch.mock.calls[1][1] as { body: string }).body));
    expect(secondBody.scan_scope_json).toEqual({ tables: ['dbo.orders'] });
    expect(secondBody.source).toBe('in_tool');
  });
});

// ---------------------------------------------------------------------------
// Group 7 — strategic end-to-end gap tests (Task 7.3)
// ---------------------------------------------------------------------------

function jsonResponseG7(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (k: string) => (k.toLowerCase() === 'content-type' ? 'application/json' : null),
    },
    text: async () => JSON.stringify(body),
  };
}

describe('Group 7 — the generated expected_schema feeds the diff directly (one vocabulary)', () => {
  it('verifies a REALLY generated expected schema: untouched objects match, a mutated column mismatches with detail, an extra table is informational, and the run appends its history row', async () => {
    // A small committed model run through the REAL generation core — the
    // expected schema comes out of the generator manifest, NOT a hand-built
    // fixture, so any vocabulary drift between generator and differ fails here.
    const generationInputs: GenerationInputs = {
      model: {
        physicalDataEntities: [
          {
            id: 'e-cust',
            name: 'dbo.customers',
            physical_type: 'table',
            constraints_metadata: {
              primary_key: { name: 'pk_customers', columns: ['customer_id'] },
              indexes: [{ name: 'ix_customers_email', columns: ['email'], is_unique: false }],
            },
          },
          {
            id: 'e-ord',
            name: 'dbo.orders',
            physical_type: 'table',
            constraints_metadata: {
              primary_key: { name: 'pk_orders', columns: ['order_id'] },
            },
          },
        ],
        physicalDataAttributes: [
          { id: 'a1', name: 'customer_id', physical_entity_id: 'e-cust', source_type: 'int', is_nullable: false, is_identity: true, ordinal: 1 },
          { id: 'a2', name: 'email', physical_entity_id: 'e-cust', source_type: 'varchar(100)', is_nullable: true, ordinal: 2 },
          { id: 'a3', name: 'created_at', physical_entity_id: 'e-cust', source_type: 'datetime', is_nullable: false, column_default: 'getdate()', ordinal: 3 },
          { id: 'a4', name: 'order_id', physical_entity_id: 'e-ord', source_type: 'int', is_nullable: false, is_identity: true, ordinal: 1 },
          { id: 'a5', name: 'customer_id', physical_entity_id: 'e-ord', source_type: 'int', is_nullable: false, ordinal: 2 },
          { id: 'a6', name: 'amount', physical_entity_id: 'e-ord', source_type: 'numeric', precision: 10, scale: 2, is_nullable: false, ordinal: 3 },
        ],
        dataEntityPoints: [
          { id: 'p-c', physical_entity_id: 'e-cust' },
          { id: 'p-o', physical_entity_id: 'e-ord' },
        ],
        dataEntityRelationships: [
          {
            id: 'r1',
            fromDataEntityPointId: 'p-o',
            toDataEntityPointId: 'p-c',
            fk_columns: {
              join_columns: ['customer_id'],
              referenced_columns: ['customer_id'],
              on_delete: 'SET NULL',
              on_update: null,
            },
          },
        ],
      },
      findings: [
        {
          id: 'f-npd',
          finding_type: 'non_portable_default',
          detail_json: {
            engineKey: 'sybase',
            schemaName: 'dbo',
            tableName: 'customers',
            columnName: 'created_at',
            columnDefault: 'getdate()',
            detectedToken: 'getdate',
          },
        },
        {
          id: 'f-s1',
          finding_type: 'sequence_cutover_hazard',
          detail_json: { engineKey: 'sybase', schemaName: 'dbo', sequenceName: 'cust_seq', currentValue: '10', currentValueAvailable: true, ownedByTable: 'customers', ownedByColumn: 'customer_id' },
        },
        {
          id: 'f-s2',
          finding_type: 'sequence_cutover_hazard',
          detail_json: { engineKey: 'sybase', schemaName: 'dbo', sequenceName: 'ord_seq', currentValue: '20', currentValueAvailable: true, ownedByTable: 'orders', ownedByColumn: 'order_id' },
        },
      ],
      dbDecisions: [{ decisionCode: 'db.engine', answerValue: 'PostgreSQL' }],
      resolvedPackDecisions: [],
    };
    const artifacts = buildDbMigrationPackArtifacts(buildSourceSchemaIr(generationInputs));
    const expected = artifacts.manifest.expected_schema;

    // Build the actual target snapshot FROM the generated expected schema
    // (the round trip), then drift it deliberately in exactly two places:
    // amount numeric(10,2) -> numeric(12,2), plus an extra dbo.audit_log.
    const actual: ActualSchemaSnapshot = {
      tables: [
        ...expected.tables.map((t) => ({
          schemaName: t.schemaName,
          tableName: t.tableName,
          objectType: 'table',
        })),
        { schemaName: 'dbo', tableName: 'audit_log', objectType: 'table' },
      ],
      columns: expected.columns.map((c) => ({
        schemaName: c.schemaName,
        tableName: c.tableName,
        columnName: c.columnName,
        dataType: c.columnName === 'amount' ? 'numeric' : c.dataType,
        precision: c.columnName === 'amount' ? 12 : null,
        scale: c.columnName === 'amount' ? 2 : null,
        isNullable: c.isNullable,
        isIdentity: c.isIdentity,
        isGenerated: c.isGenerated,
        generationExpression: c.generationExpression,
        defaultExpression: c.defaultExpression,
      })),
      keysAndIndexes: expected.keysAndIndexes.map((k) => ({
        schemaName: k.schemaName,
        tableName: k.tableName,
        kind: k.kind,
        name: k.name,
        columns: k.columns,
        referencedSchema: k.referencedSchema,
        referencedTable: k.referencedTable,
        referencedColumns: k.referencedColumns,
        onDelete: k.onDelete,
        onUpdate: k.onUpdate,
        isUnique: k.isUnique,
        columnDirections: k.columnDirections,
      })),
      sequences: [],
    };

    const appendDriftReport = jest
      .fn()
      .mockResolvedValue({ id: 'dr-gen', pack_id: 'pack-gen' });
    const result = await runDbMigrationPackVerification(
      {
        projectId: 'p-1',
        packId: 'pack-gen',
        connection: { host: 'pg', port: 5432, databaseName: 'db', username: 'u', password: 'pw' },
      },
      {
        fetchPack: jest
          .fn()
          .mockResolvedValue({ id: 'pack-gen', manifest_json: { expected_schema: expected } }),
        scanTarget: jest.fn().mockResolvedValue(actual),
        appendDriftReport,
      }
    );

    const { report } = result;
    // EXACTLY one mismatch (the mutated column), zero missing — every other
    // generated object round-trips to `match` through the diff vocabulary.
    expect(report.summary.missing_count).toBe(0);
    expect(report.summary.mismatch_count).toBe(1);
    expect(report.summary.match_count).toBe(report.objects.length - 1);
    const amount = report.objects.find((o) => o.object_ref === 'dbo.orders.amount');
    expect(amount?.classification).toBe('mismatch');
    expect(amount?.details).toContainEqual({
      property: 'type',
      expected: 'numeric(10,2)',
      actual: 'numeric(12,2)',
    });
    // The generated FK (verbatim ON DELETE SET NULL) matched the round trip.
    const fk = report.objects.find((o) => o.object_type === 'foreign_key');
    expect(fk?.classification).toBe('match');
    // The rewritten default (getdate() -> now()) also round-tripped to match.
    const createdAt = report.objects.find((o) => o.object_ref === 'dbo.customers.created_at');
    expect(createdAt?.classification).toBe('match');
    // The extra table is informational ONLY.
    expect(report.unexpected_in_target).toContainEqual({
      object_type: 'table',
      object_ref: 'dbo.audit_log',
      detail: expect.any(String),
    });
    // And the run appended its history row with the same counts.
    expect(appendDriftReport).toHaveBeenCalledTimes(1);
    const [, , body] = appendDriftReport.mock.calls[0];
    expect(body.mismatch_count).toBe(1);
    expect(body.source).toBe('in_tool');
  });
});

describe('Group 7 — verify ROUTE end-to-end (scan -> diff -> appended history)', () => {
  it('drives the credentialed verification through the HTTP surface: discovery scan with per-invocation credentials + scope, deterministic diff, drift row POSTed to AMS', async () => {
    const scope = { tables: ['dbo.orders'] };
    const driftPosts: string[] = [];
    mockFetch.mockImplementation(async (url: unknown, init?: { method?: string; body?: string }) => {
      const u = String(url);
      if (u === 'http://localhost:8080/api/projects/p-1/db-migration-packs/pack-1') {
        return jsonResponseG7(200, {
          id: 'pack-1',
          manifest_json: { expected_schema: makeExpected() },
        });
      }
      if (u === 'http://localhost:8091/discovery/db/verification-scan') {
        return jsonResponseG7(200, {
          success: true,
          scan_mode: 'verification_only',
          snapshot: makeActual(),
        });
      }
      if (u === 'http://localhost:8080/api/projects/p-1/db-migration-packs/pack-1/drift-reports') {
        driftPosts.push(init?.body ?? '');
        return jsonResponseG7(201, { id: 'dr-route', pack_id: 'pack-1' });
      }
      throw new Error(`unexpected fetch: ${u}`);
    });

    const app = express();
    app.use(express.json({ limit: '5mb' }));
    app.use('/api/v1', dbMigrationPackRouter);

    const res = await request(app)
      .post('/api/v1/projects/p-1/db-migration-packs/pack-1/verify')
      .send({
        db: { host: 'target-pg', port: 5432, databaseName: 'orders_db' },
        username: 'verifier',
        password: 's3cret',
        scope,
      });

    expect(res.status).toBe(200);
    // The HTTP-level report equals the pure deterministic diff over the same
    // fixtures — the route adds orchestration, never classification changes.
    const reference = diffExpectedVsActual(makeExpected(), makeActual(), scope);
    expect(res.body.report).toEqual(JSON.parse(JSON.stringify(reference)));
    expect(res.body.drift_report.id).toBe('dr-route');

    // Credentials + scope passed through to the discovery scan per invocation.
    const scanCall = mockFetch.mock.calls.find((c) =>
      String(c[0]).includes('verification-scan')
    )!;
    const scanBody = JSON.parse(String((scanCall[1] as { body: string }).body));
    expect(scanBody.username).toBe('verifier');
    expect(scanBody.password).toBe('s3cret');
    expect(scanBody.scope).toEqual(scope);

    // ONE appended history row with the scoped counts + the in_tool source.
    expect(driftPosts).toHaveLength(1);
    const persistedBody = JSON.parse(driftPosts[0]);
    expect(persistedBody.source).toBe('in_tool');
    expect(persistedBody.scan_scope_json).toEqual(scope);
    expect(persistedBody.match_count).toBe(reference.summary.match_count);
    expect(persistedBody.mismatch_count).toBe(reference.summary.mismatch_count);
    expect(persistedBody.report_json).toEqual(JSON.parse(JSON.stringify(reference)));
  });
});
