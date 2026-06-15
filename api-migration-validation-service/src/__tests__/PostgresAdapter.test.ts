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

jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => mockPool),
}));

// Imports MUST come after the mock setup so the mocked Pool is used.
import { PostgresAdapter } from '../services/db/PostgresAdapter';
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
});
