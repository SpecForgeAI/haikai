/**
 * Group G tests -- fuller Postgres procedure capture (Spec 2026-05-30
 * Data-Layer Fidelity 2): pg_get_functiondef / arguments / return type /
 * volatility / SECURITY DEFINER captured ALONGSIDE the existing `prosrc` body,
 * threaded into the existing Spec-3 `stored_procedure_logic` Finding.
 *
 * EXTENDS the Spec-3 db-pack introspection + finding test patterns (mirrors
 * dbStructuralFidelityGroup2.test.ts). Offline only -- no live DB. The Postgres
 * SQL->IR path uses a mocked `pg` Pool; the finding builders are fed synthetic
 * IR. Synthetic-rows-only -> isolation-safe.
 *
 * Focused set (within the 2-8 bound):
 *  1. pg_get_functiondef / arguments / return / volatility / SECURITY DEFINER
 *     captured onto ProcedureMetadata alongside `body` (prosrc kept).
 *  2. An OVERLOADED function is distinguishable by its captured signature.
 *  3. A SECURITY DEFINER function is flagged (securityDefiner=true).
 *  4. The existing stored_procedure_logic body Finding still emits unchanged,
 *     now ALSO carrying the fuller-capture keys (and prosrc body intact).
 */

// -----------------------------------------------------------------------------
// `pg` Pool mock (mirrors dbStructuralFidelityGroup2.test.ts).
// -----------------------------------------------------------------------------

const recordedQueries: Array<{ sql: string; params: unknown[] }> = [];

type QueueEntry = {
  match: RegExp;
  rows: Array<Record<string, unknown>>;
  rowCount?: number;
};
const queryQueue: QueueEntry[] = [];

function queueQueryResult(
  match: RegExp,
  rows: Array<Record<string, unknown>>,
): void {
  queryQueue.push({ match, rows, rowCount: rows.length });
}

const mockClient = {
  query: jest.fn(async (sql: string, params?: unknown[]) => {
    const normalized = String(sql).trim();
    recordedQueries.push({ sql: normalized, params: params ?? [] });
    if (/^SET statement_timeout/i.test(normalized)) return { rows: [], rowCount: 0 };
    if (/^RESET statement_timeout/i.test(normalized)) return { rows: [], rowCount: 0 };
    for (let i = 0; i < queryQueue.length; i++) {
      const entry = queryQueue[i];
      if (entry.match.test(normalized)) {
        queryQueue.splice(i, 1);
        return { rows: entry.rows, rowCount: entry.rowCount ?? entry.rows.length };
      }
    }
    return { rows: [], rowCount: 0 };
  }),
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
import {
  mapPostgresVolatility,
} from '../services/databasePacks/postgres/postgresIntrospection';
import { __testOnly as postgresFindings } from '../services/databasePacks/postgres/postgresFindings';
import type {
  DatabaseDiscoveryConfig,
  DatabaseDiscoveryCredentials,
  IntrospectionResult,
} from '../services/databasePacks/types';
import type { DatabaseDiscoveryPackContext } from '../services/databasePacks/DatabaseDiscoveryPack';

const baseConfig = (): DatabaseDiscoveryConfig => ({
  dbEngine: 'postgres',
  host: 'db.test',
  port: 5432,
  databaseName: 'demo',
  catalogName: null,
  schemaName: 'public',
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

const baseCtx = (): DatabaseDiscoveryPackContext => ({
  config: baseConfig(),
  credentials: { username: 'svc_ro', password: 'x' } as DatabaseDiscoveryCredentials,
  runId: 'run-g',
  projectId: 'proj-g',
  architectureId: 'arch-g',
});

const emptyIntrospection = (): IntrospectionResult => ({
  schemas: [],
  tables: [],
  columns: [],
  keysAndIndexes: [],
  views: [],
  procedures: [],
  triggers: [],
  sequences: [],
});

beforeEach(() => {
  recordedQueries.length = 0;
  queryQueue.length = 0;
  mockClient.query.mockClear();
  mockClient.release.mockClear();
  mockPool.connect.mockClear();
});

// -----------------------------------------------------------------------------
// 1) + 2) + 3) Fuller capture on ProcedureMetadata; overload distinguishable;
//             SECURITY DEFINER flagged.
// -----------------------------------------------------------------------------

describe('Postgres fuller procedure introspection (Group G)', () => {
  it('captures functiondef / arguments / return / volatility / SECURITY DEFINER alongside prosrc', async () => {
    const pack = new PostgresDiscoveryPack();
    const ctx = baseCtx();
    queueQueryResult(/pg_catalog\.pg_proc/i, [
      // Two OVERLOADS of calc_total -- distinguishable by their arguments.
      {
        schema_name: 'public',
        proc_name: 'calc_total',
        prokind: 'f',
        lang_name: 'plpgsql',
        proc_src: 'BEGIN RETURN a + b; END;',
        full_definition:
          'CREATE OR REPLACE FUNCTION public.calc_total(a integer, b integer)\n' +
          ' RETURNS integer\n LANGUAGE plpgsql\nAS $function$ BEGIN RETURN a + b; END; $function$',
        proc_arguments: 'a integer, b integer',
        proc_result: 'integer',
        provolatile: 'i',
        prosecdef: false,
      },
      {
        schema_name: 'public',
        proc_name: 'calc_total',
        prokind: 'f',
        lang_name: 'plpgsql',
        proc_src: 'BEGIN RETURN a + b + c; END;',
        full_definition:
          'CREATE OR REPLACE FUNCTION public.calc_total(a integer, b integer, c integer)\n' +
          ' RETURNS integer\n LANGUAGE plpgsql\nAS $function$ BEGIN RETURN a + b + c; END; $function$',
        proc_arguments: 'a integer, b integer, c integer',
        proc_result: 'integer',
        provolatile: 's',
        prosecdef: false,
      },
      // A SECURITY DEFINER function.
      {
        schema_name: 'public',
        proc_name: 'audit_write',
        prokind: 'f',
        lang_name: 'plpgsql',
        proc_src: 'BEGIN INSERT INTO audit VALUES (now()); END;',
        full_definition:
          'CREATE OR REPLACE FUNCTION public.audit_write()\n RETURNS void\n LANGUAGE plpgsql\n' +
          ' SECURITY DEFINER\nAS $function$ BEGIN INSERT INTO audit VALUES (now()); END; $function$',
        proc_arguments: '',
        proc_result: 'void',
        provolatile: 'v',
        prosecdef: true,
      },
    ]);

    await pack.connect(ctx);
    const procs = await pack.introspectProcedures(ctx);
    await pack.close();

    expect(procs).toHaveLength(3);

    // Overloads distinguishable by their captured signature.
    const overloads = procs.filter((p) => p.procedureName === 'calc_total');
    expect(overloads).toHaveLength(2);
    const sigs = overloads.map((p) => p.arguments).sort();
    expect(sigs).toEqual(['a integer, b integer', 'a integer, b integer, c integer']);

    // First overload: verbatim functiondef, return type, IMMUTABLE volatility,
    // prosrc body kept, not SECURITY DEFINER.
    const two = overloads.find((p) => p.arguments === 'a integer, b integer')!;
    expect(two.fullDefinition).toContain('CREATE OR REPLACE FUNCTION public.calc_total(a integer, b integer)');
    expect(two.returnType).toBe('integer');
    expect(two.volatility).toBe('IMMUTABLE'); // provolatile 'i'
    expect(two.securityDefiner).toBe(false);
    expect(two.body).toBe('BEGIN RETURN a + b; END;'); // prosrc kept

    const three = overloads.find((p) => p.arguments === 'a integer, b integer, c integer')!;
    expect(three.volatility).toBe('STABLE'); // provolatile 's'

    // SECURITY DEFINER function flagged + VOLATILE.
    const audit = procs.find((p) => p.procedureName === 'audit_write')!;
    expect(audit.securityDefiner).toBe(true);
    expect(audit.volatility).toBe('VOLATILE'); // provolatile 'v'
    expect(audit.fullDefinition).toContain('SECURITY DEFINER');

    // Belt-and-braces: the proc SELECT references the fuller-capture columns
    // AND keeps prosrc.
    const procSql = recordedQueries.find((q) => /pg_catalog\.pg_proc/i.test(q.sql));
    expect(procSql!.sql).toMatch(/pg_get_functiondef/i);
    expect(procSql!.sql).toMatch(/pg_get_function_arguments/i);
    expect(procSql!.sql).toMatch(/prosecdef/i);
    expect(procSql!.sql).toMatch(/provolatile/i);
    expect(procSql!.sql).toMatch(/p\.prosrc/i); // prosrc kept
  });
});

// -----------------------------------------------------------------------------
// volatility mapper edge coverage.
// -----------------------------------------------------------------------------

describe('mapPostgresVolatility (Group G)', () => {
  it('maps i/s/v verbatim keywords and null for unknown', () => {
    expect(mapPostgresVolatility('i')).toBe('IMMUTABLE');
    expect(mapPostgresVolatility('s')).toBe('STABLE');
    expect(mapPostgresVolatility('v')).toBe('VOLATILE');
    expect(mapPostgresVolatility('x')).toBeNull();
    expect(mapPostgresVolatility(null)).toBeNull();
  });
});

// -----------------------------------------------------------------------------
// 4) The existing stored_procedure_logic Finding still emits, now carrying the
//    fuller-capture keys alongside the (kept) prosrc body.
// -----------------------------------------------------------------------------

describe('stored_procedure_logic Finding carries Group G fuller capture', () => {
  it('keeps the body Finding and adds functiondef / signature / volatility / SECURITY DEFINER', () => {
    const ir: IntrospectionResult = {
      ...emptyIntrospection(),
      procedures: [
        {
          schemaName: 'public',
          procedureName: 'audit_write',
          routineKind: 'function',
          body: 'BEGIN INSERT INTO audit VALUES (now()); END;',
          language: 'plpgsql',
          fullDefinition:
            'CREATE OR REPLACE FUNCTION public.audit_write()\n SECURITY DEFINER\n' +
            'AS $function$ BEGIN INSERT INTO audit VALUES (now()); END; $function$',
          arguments: '',
          returnType: 'void',
          volatility: 'VOLATILE',
          securityDefiner: true,
        },
      ],
    };
    const out = postgresFindings.emitHiddenLogicFindings(ir);
    const spFinding = out.find((f) => f.findingType === 'stored_procedure_logic')!;
    expect(spFinding).toBeTruthy();
    const detail = spFinding.detailJson as Record<string, unknown>;
    // Existing body still present (prosrc kept; full-body redaction returns it).
    expect(String(detail.bodySnippet)).toContain('INSERT INTO audit');
    // Fuller-capture keys present.
    expect(String(detail.fullDefinition)).toContain('SECURITY DEFINER');
    expect(detail.returnType).toBe('void');
    expect(detail.volatility).toBe('VOLATILE');
    expect(detail.securityDefiner).toBe(true);
    expect(detail).toHaveProperty('signatureArguments', '');
  });

  it('omits the fuller-capture keys for a procedure with no Group G metadata (Spec-3 shape unchanged)', () => {
    const ir: IntrospectionResult = {
      ...emptyIntrospection(),
      procedures: [
        {
          schemaName: 'public',
          procedureName: 'legacy_proc',
          routineKind: 'procedure',
          body: 'SELECT 1;',
          language: 'sql',
          // No Group G fields populated (e.g. the Sybase path).
        },
      ],
    };
    const out = postgresFindings.emitHiddenLogicFindings(ir);
    const spFinding = out.find((f) => f.findingType === 'stored_procedure_logic')!;
    const detail = spFinding.detailJson as Record<string, unknown>;
    expect(detail).not.toHaveProperty('fullDefinition');
    expect(detail).not.toHaveProperty('signatureArguments');
    expect(detail).not.toHaveProperty('securityDefiner');
    // The stable Spec-3 keys are intact.
    expect(detail.routineKind).toBe('procedure');
    expect(String(detail.bodySnippet)).toContain('SELECT 1');
  });
});
