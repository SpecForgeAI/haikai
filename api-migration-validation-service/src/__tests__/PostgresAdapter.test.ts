/**
 * PostgresAdapter unit test against a mocked `pg` module. Asserts the two
 * spec-critical safety properties:
 *   - explicit `LIMIT` injection if the SQL doesn't already carry one
 *   - per-query `SET statement_timeout = <ms>` issued before the SELECT
 *   - the SELECT-only guard rejects non-SELECT statements
 *
 * Spec: 2026-05-15 API Behaviour Baseline Capture Service -- Task Group 4
 * sub-task 4.1.
 */

// --- pg mock plumbing ------------------------------------------------------
//
// The adapter calls `pool.connect()` to get a `PoolClient` and then issues
// a sequence of queries on that client. The mock records every `query()`
// call so the test can assert on the SQL strings.

const mockClientQueries: Array<{ sql: string; params?: unknown[] }> = [];
const mockSelectResult = {
  rows: [{ id: 1 }, { id: 2 }],
  rowCount: 2,
};

const mockClient = {
  query: jest.fn(async (sql: string, params?: unknown[]) => {
    mockClientQueries.push({ sql, params });
    if (/^SET statement_timeout/i.test(sql.trim())) {
      return { rows: [], rowCount: 0 };
    }
    if (/^RESET statement_timeout/i.test(sql.trim())) {
      return { rows: [], rowCount: 0 };
    }
    return mockSelectResult;
  }),
  release: jest.fn(),
};

const mockPool = {
  connect: jest.fn(async () => mockClient),
  end: jest.fn(async () => undefined),
};

const mockDefaultParser = jest.fn((v: string) => `default-parsed:${v}`);
jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => mockPool),
  types: { getTypeParser: jest.fn(() => mockDefaultParser) },
}));

// Imports MUST come after the mock setup so the mocked Pool is used.
import { Pool } from 'pg';
import { PostgresAdapter, rawDatetimeTypes } from '../services/db/PostgresAdapter';
import { SqlGuardError } from '../services/db/sqlGuard';

describe('PostgresAdapter', () => {
  beforeEach(() => {
    mockClientQueries.length = 0;
    mockClient.query.mockClear();
    mockClient.release.mockClear();
    mockPool.connect.mockClear();
  });

  function buildAdapter(): PostgresAdapter {
    return new PostgresAdapter({
      dbType: 'postgres',
      host: 'localhost',
      port: 5432,
      database: 'test',
      schema: null,
      username: 'tester',
      password: 'pw',
    });
  }

  it('reads datetime OIDs as RAW STRINGS, never locale-shifted Dates (2026-08-07 ±1h artifact)', () => {
    buildAdapter();
    const poolConfig = (Pool as unknown as jest.Mock).mock.calls[0][0] as {
      types?: { getTypeParser: (oid: number) => (v: string) => unknown };
    };
    expect(poolConfig.types).toBe(rawDatetimeTypes);
    // date / timestamp / timestamptz come back verbatim...
    for (const oid of [1082, 1114, 1184]) {
      expect(poolConfig.types!.getTypeParser(oid)('2014-05-15 23:00:00')).toBe(
        '2014-05-15 23:00:00',
      );
    }
    // ...every other OID keeps the default pg parser.
    expect(poolConfig.types!.getTypeParser(23)('42')).toBe('default-parsed:42');
  });

  it('fetchOrderedRows with `after` appends the NULL-aware keyset predicate as params', async () => {
    const adapter = buildAdapter();
    await adapter.fetchOrderedRows({
      schema: 'dbo',
      table: 't',
      orderBy: ['a', 'b'],
      limits: { maxRows: 10, timeoutSeconds: 5 },
      after: [1, null],
    });
    const select = mockClientQueries.find((q) => /SELECT \* FROM/.test(q.sql));
    expect(select).toBeDefined();
    expect(select!.sql).toContain('WHERE (("a" > $1) OR ("a" = $2 AND "b" IS NOT NULL))');
    expect(select!.params).toEqual([1, 1]);
    expect(select!.sql).toMatch(/ORDER BY "a" ASC NULLS FIRST, "b" ASC NULLS FIRST/);
  });

  it('runReadonlySelect injects LIMIT when SQL lacks one and sets statement_timeout', async () => {
    const adapter = buildAdapter();
    const result = await adapter.runReadonlySelect(
      'SELECT id FROM things WHERE active = true',
      [],
      { maxRows: 100, timeoutSeconds: 5 },
    );

    expect(result.rows).toHaveLength(2);

    // First call MUST be SET statement_timeout = 5000 (5s in ms).
    expect(mockClientQueries[0].sql).toMatch(/^SET statement_timeout = 5000/i);
    // Second call MUST be the SELECT with LIMIT 100 appended.
    expect(mockClientQueries[1].sql).toContain('SELECT id FROM things');
    expect(mockClientQueries[1].sql).toMatch(/LIMIT 100\s*$/i);
    // Connection MUST be released.
    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });

  it('runReadonlySelect leaves an explicit LIMIT alone', async () => {
    const adapter = buildAdapter();
    await adapter.runReadonlySelect(
      'SELECT id FROM things LIMIT 25',
      [],
      { maxRows: 100, timeoutSeconds: 5 },
    );
    // Must NOT have appended a second LIMIT.
    const selectCall = mockClientQueries.find((q) => /SELECT id FROM things/.test(q.sql));
    expect(selectCall).toBeDefined();
    expect((selectCall?.sql.match(/LIMIT/gi) ?? []).length).toBe(1);
  });

  it('runReadonlySelect rejects non-SELECT statements via the SQL guard', async () => {
    const adapter = buildAdapter();
    await expect(
      adapter.runReadonlySelect(
        'DELETE FROM things WHERE id = 1',
        [],
        { maxRows: 100, timeoutSeconds: 5 },
      ),
    ).rejects.toBeInstanceOf(SqlGuardError);
    // Engine MUST not have been touched.
    expect(mockPool.connect).not.toHaveBeenCalled();
  });

  it('runReadonlySelect rejects multi-statement SQL', async () => {
    const adapter = buildAdapter();
    await expect(
      adapter.runReadonlySelect(
        'SELECT 1; SELECT 2',
        [],
        { maxRows: 100, timeoutSeconds: 5 },
      ),
    ).rejects.toBeInstanceOf(SqlGuardError);
    expect(mockPool.connect).not.toHaveBeenCalled();
  });

  // ---- countRows honesty (gold standard 2026-08-07) ------------------------

  it('countRows parses node-pg string counts (int8 comes back as a string)', async () => {
    const adapter = buildAdapter();
    mockSelectResult.rows = [{ row_count: '77' } as never];
    mockSelectResult.rowCount = 1;
    try {
      await expect(
        adapter.countRows({ schema: 'public', table: 'orders', limits: { maxRows: 5, timeoutSeconds: 5 } }),
      ).resolves.toBe(77);
    } finally {
      mockSelectResult.rows = [{ id: 1 }, { id: 2 }];
      mockSelectResult.rowCount = 2;
    }
  });

  it('countRows THROWS on an unparseable count — a garbled count must never read as 0', async () => {
    const adapter = buildAdapter();
    mockSelectResult.rows = [{ row_count: 'not-a-number' } as never];
    mockSelectResult.rowCount = 1;
    try {
      await expect(
        adapter.countRows({ schema: 'public', table: 'orders', limits: { maxRows: 5, timeoutSeconds: 5 } }),
      ).rejects.toThrow(/unparseable count/);
    } finally {
      mockSelectResult.rows = [{ id: 1 }, { id: 2 }];
      mockSelectResult.rowCount = 2;
    }
  });
});
