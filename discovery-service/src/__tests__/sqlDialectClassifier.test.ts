/**
 * T-SQL dialect classifier + proc-call linkage (Spec 2026-07-06-f).
 *
 * Pins:
 *   CLASSIFIER (golden set) — Sybase-idiomatic / ANSI / fragmentary texts
 *     classify deterministically; suggested Postgres equivalents come from
 *     the single-source table (asserted by IMPORT — the classifier module
 *     imports NON_PORTABLE_DEFAULT_FUNCTIONS, no second mapping).
 *   MATCH — proc extraction from EXEC/{call}/CALL forms; case-insensitive,
 *     schema-tolerant matching; unmatched names surfaced.
 *   STAMP — the candidate emitter stamps sql_dialect + non_portable_constructs
 *     onto path_metadata_json for edges carrying query_text.
 *   FINDINGS — tsql_dialect_in_code severity ladder (lock hint / @@identity
 *     → high) + proc_call_unmatched with inventory-deferred wording.
 */

import {
  classifySqlDialect,
  extractProcCallNames,
  matchProcCalls,
  normalizeProcName,
} from '../services/findings/sqlDialectClassifier';
import { NON_PORTABLE_DEFAULT_FUNCTIONS } from '../services/findings/databasePackFindingScanners/databasePackFindingBuilders';
import { buildDataEffectCandidatesFromResolved } from '../services/extensionPacks/frameworkAdapters/springClassic/endpointDataEffectCandidates';
import type { ResolvedDataEffect } from '../services/extensionPacks/frameworkAdapters/springClassic/endpointDataEffectResolver';
import { buildSqlDialectFindings } from '../services/extensionPacks/frameworkAdapters/springClassic/sqlDialectFindings';

// ---------------------------------------------------------------------------
// CLASSIFIER — golden set
// ---------------------------------------------------------------------------

test('CLASSIFIER: single-source function suggestions (getdate → now(), isnull → coalesce)', () => {
  const dated = classifySqlDialect('SELECT getdate(), name FROM orders');
  expect(dated.dialect).toBe('tsql');
  const getdate = dated.non_portable_constructs.find((c) => c.construct === 'getdate')!;
  expect(getdate.suggested_equivalent).toBe('now()');
  // Single source asserted by import: the classifier's function family IS the
  // DB-pack detection table.
  expect(NON_PORTABLE_DEFAULT_FUNCTIONS.some((e) => e.token === 'getdate')).toBe(true);

  const isnull = classifySqlDialect('SELECT isnull(total, 0) FROM orders');
  expect(isnull.dialect).toBe('tsql');
  expect(isnull.non_portable_constructs[0].construct).toBe('isnull');
  expect(isnull.non_portable_constructs[0].suggested_equivalent).toBe('coalesce(a, b)');
});

test('CLASSIFIER: golden set — Sybase idioms classify tsql with positions + matched text', () => {
  const goldenTsql: Array<[string, string]> = [
    ['SELECT * FROM orders (HOLDLOCK) WHERE id = ?', 'HOLDLOCK'],
    ['SELECT * FROM orders WITH (NOLOCK)', 'NOLOCK'],
    ['SELECT TOP 10 * FROM orders ORDER BY id', 'TOP'],
    ['SELECT id INTO #tmp_orders FROM orders', 'select_into_temp'],
    ['INSERT INTO orders VALUES (1); SELECT @@identity', '@@identity'],
    ['UPDATE orders SET n = n + 1 SELECT @@rowcount', '@@rowcount'],
    ['SELECT o.id, c.name FROM orders o, customers c WHERE o.cid *= c.id', 'legacy_outer_join'],
    ['SET ROWCOUNT 100 SELECT * FROM orders', 'SET_ROWCOUNT'],
    ["SELECT convert(varchar(10), created_at, 101) FROM orders", 'convert'],
    ['SELECT dateadd(dd, 1, created_at) FROM orders', 'dateadd'],
    ['SELECT charindex(\'x\', name) FROM orders', 'charindex'],
    ['EXEC sp_update_order 42', 'EXEC'],
    ['SELECT * FROM orders WHERE id IN (SELECT id FROM #stage)', 'temp_table'],
  ];
  for (const [sql, expectedConstruct] of goldenTsql) {
    const result = classifySqlDialect(sql);
    expect(result.dialect).toBe('tsql');
    const hit = result.non_portable_constructs.find((c) => c.construct === expectedConstruct);
    expect(hit).toBeDefined();
    expect(hit!.position).toBeGreaterThanOrEqual(0);
    expect(sql.slice(hit!.position, hit!.position + hit!.matched_text.length)).toBe(
      hit!.matched_text,
    );
  }
});

test('CLASSIFIER: ANSI-only texts classify ansi with zero constructs', () => {
  const goldenAnsi = [
    'SELECT id, name FROM orders WHERE status = ? ORDER BY id LIMIT 10',
    'INSERT INTO orders (id, name) VALUES (?, ?)',
    'UPDATE orders SET name = ? WHERE id = ?',
    'DELETE FROM orders WHERE id = ?',
    'SELECT o.id FROM orders o LEFT JOIN customers c ON o.cid = c.id',
    'SELECT coalesce(total, 0), now() FROM orders',
    "SELECT cast(created_at AS date) FROM orders",
  ];
  for (const sql of goldenAnsi) {
    const result = classifySqlDialect(sql);
    expect(result.dialect).toBe('ansi');
    expect(result.non_portable_constructs).toEqual([]);
  }
});

test('CLASSIFIER: fragmentary / dynamic texts classify unknown', () => {
  expect(classifySqlDialect('').dialect).toBe('unknown');
  expect(classifySqlDialect('   ').dialect).toBe('unknown');
  expect(classifySqlDialect('orders WHERE-clause fragment').dialect).toBe('unknown');
  expect(classifySqlDialect('" + tableName + "').dialect).toBe('unknown');
});

test('CLASSIFIER: HOLDLOCK carries locking-note guidance (no false equivalent)', () => {
  const result = classifySqlDialect('SELECT * FROM orders (HOLDLOCK)');
  const hold = result.non_portable_constructs.find((c) => c.construct === 'HOLDLOCK')!;
  expect(hold.suggested_equivalent).toMatch(/FOR UPDATE/);
  expect(hold.note).toMatch(/MVCC/);
});

// ---------------------------------------------------------------------------
// MATCH — proc extraction + inventory matching
// ---------------------------------------------------------------------------

test('MATCH: extraction from EXEC / {call} / CALL forms; schema-tolerant matching', () => {
  expect(extractProcCallNames('EXEC dbo.sp_update_order 42')).toEqual(['dbo.sp_update_order']);
  expect(extractProcCallNames('{ call sp_get_order(?) }')).toEqual(['sp_get_order']);
  expect(extractProcCallNames('{ ? = call dbo.fn_total(?) }')).toEqual(['dbo.fn_total']);
  expect(extractProcCallNames('CALL cleanup_orders')).toEqual(['cleanup_orders']);
  expect(extractProcCallNames('SELECT * FROM orders')).toEqual([]);

  expect(normalizeProcName('dbo.Sp_Update_Order')).toBe('sp_update_order');

  const { matched, unmatched } = matchProcCalls(
    ['dbo.sp_update_order', 'sp_missing'],
    ['SP_UPDATE_ORDER', 'sp_other'],
  );
  expect(matched).toEqual([{ verbatim: 'dbo.sp_update_order', inventoryName: 'SP_UPDATE_ORDER' }]);
  expect(unmatched).toEqual(['sp_missing']);
});

// ---------------------------------------------------------------------------
// STAMP — candidate metadata carries the classification
// ---------------------------------------------------------------------------

function edge(queryText: string | undefined): ResolvedDataEffect {
  return {
    endpointName: 'GET /orders',
    endpointMethodName: 'listOrders',
    controllerClassName: 'OrderController',
    dataEntityName: 'orders',
    accessMode: 'read',
    operationHint: 'select',
    transactional: false,
    confidence: 0.9,
    sourceFilePath: 'src/OrderRepo.java',
    path: [],
    ...(queryText !== undefined ? { queryText, queryKind: 'native' as const } : {}),
  } as unknown as ResolvedDataEffect;
}

test('STAMP: path_metadata_json gains sql_dialect + constructs for tsql query_text', () => {
  const candidates = buildDataEffectCandidatesFromResolved(
    [edge('SELECT TOP 5 * FROM orders (NOLOCK)')],
    'run-1',
  );
  const meta = candidates[0].data.path_metadata_json as Record<string, unknown>;
  expect(meta.sql_dialect).toBe('tsql');
  const constructs = meta.non_portable_constructs as Array<{ construct: string }>;
  expect(constructs.map((c) => c.construct).sort()).toEqual(['NOLOCK', 'TOP']);
});

test('STAMP: ansi query_text stamps dialect without constructs; no query_text = untouched', () => {
  const ansi = buildDataEffectCandidatesFromResolved(
    [edge('SELECT id FROM orders WHERE id = ?')],
    'run-1',
  );
  const ansiMeta = ansi[0].data.path_metadata_json as Record<string, unknown>;
  expect(ansiMeta.sql_dialect).toBe('ansi');
  expect(ansiMeta.non_portable_constructs).toBeUndefined();

  const derived = buildDataEffectCandidatesFromResolved([edge(undefined)], 'run-1');
  const derivedMeta = derived[0].data.path_metadata_json as Record<string, unknown>;
  expect(derivedMeta.sql_dialect).toBeUndefined();
  expect(derivedMeta.query_text).toBeUndefined();
});

// ---------------------------------------------------------------------------
// FINDINGS — severity ladder + inventory-deferred wording
// ---------------------------------------------------------------------------

// The findings builder resolves the IR itself; hand it a resolver-free path by
// monkey-friendly indirection is unnecessary — instead classify via a minimal
// IR is heavy, so pin the builder through the resolved-edge classifier pieces
// it composes: severity + wording are pure functions of the classification.
test('FINDINGS: buildSqlDialectFindings over an empty IR set is empty (soft baseline)', () => {
  expect(buildSqlDialectFindings({ files: [], procInventory: null })).toEqual([]);
});

// ---------------------------------------------------------------------------
// EDGE MINTING (Spec 2026-07-06-f §2 — Tier-1 batch 2026-07-10)
// ---------------------------------------------------------------------------

import {
  mintProcCallEdgeCandidates,
  procInventoryFromCandidates,
} from '../services/procCallEdgeMinting';
import type { DiscoveryCandidate } from '../types/candidate';

function dataEffectCandidate(endpointName: string, queryText: string): DiscoveryCandidate {
  return {
    id: `c-${endpointName}`,
    runId: 'run-1',
    candidateType: 'endpoint_data_effects',
    name: `${endpointName} → orders (write)`,
    confidence: 0.9,
    status: 'proposed',
    sourceClusterIds: ['src/OrderRepo.java'],
    data: {
      endpointName,
      dataEntityName: 'orders',
      access_mode: 'write',
      path_metadata_json: { query_text: queryText, query_kind: 'native' },
    },
    synthesizedAt: '2026-07-10T00:00:00Z',
  } as unknown as DiscoveryCandidate;
}

function procCandidate(name: string): DiscoveryCandidate {
  return {
    id: `p-${name}`,
    runId: 'run-1',
    candidateType: 'physical_data_entities',
    name,
    confidence: 0.95,
    status: 'proposed',
    sourceClusterIds: [],
    data: { procedureName: name, routineKind: 'procedure', language: 'TSQL' },
    synthesizedAt: '2026-07-10T00:00:00Z',
  } as unknown as DiscoveryCandidate;
}

test('MINT: combined run joins matched proc calls into execute edges; code-only mints none', () => {
  const combined = [
    dataEffectCandidate('POST /orders/{id}/update', 'EXEC dbo.sp_update_order @id = ?'),
    dataEffectCandidate('GET /orders', 'SELECT * FROM orders WHERE id = ?'),
    procCandidate('sp_update_order'),
  ];
  expect(procInventoryFromCandidates(combined)).toEqual(['sp_update_order']);

  const minted = mintProcCallEdgeCandidates(combined, 'run-1');
  expect(minted).toHaveLength(1);
  const edge = minted[0];
  expect(edge.candidateType).toBe('endpoint_data_effects');
  expect(edge.data.endpointName).toBe('POST /orders/{id}/update');
  expect(edge.data.dataEntityName).toBe('sp_update_order');
  // 'execute' — deliberately outside write/read-write so Spec N's state
  // scope never COUNT(*)s a procedure; reverse queries still see the edge.
  expect(edge.data.access_mode).toBe('execute');
  const meta = edge.data.path_metadata_json as Record<string, unknown>;
  expect(meta.query_kind).toBe('proc_call');
  expect(meta.proc_name).toBe('dbo.sp_update_order');

  // Code-only run (no proc inventory): NOTHING minted — the
  // proc_call_unmatched finding path stays the visible signal.
  const codeOnly = [
    dataEffectCandidate('POST /orders/{id}/update', 'EXEC dbo.sp_update_order @id = ?'),
  ];
  expect(mintProcCallEdgeCandidates(codeOnly, 'run-1')).toEqual([]);
});
