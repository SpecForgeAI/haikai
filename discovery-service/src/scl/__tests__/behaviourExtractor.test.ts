/**
 * SCL behaviour extractor + slicer tests — `[T-...]` behaviour tables and
 * `[Q-...]` boundary contracts from the fixture legacy app, via the composed
 * `sliceProject` entry point.
 *
 * Parse-heavy suite (real tree-sitter through the process-scoped binding);
 * run via `npm test -- --testPathPattern=scl`.
 */

import * as path from 'path';
import { sliceProject, type SclSliceResult } from '../slicer';
import type { SclBehaviourTable, SclRow } from '../sclTypes';

const FIXTURE_ROOT = path.join(__dirname, 'fixtures', 'legacy-app');

describe('extractBehaviour via sliceProject (fixture legacy app)', () => {
  let result: SclSliceResult;

  const table = (symbol: string): SclBehaviourTable => {
    const found = result.tables.find((t) => t.symbol === symbol);
    expect(found).toBeDefined();
    return found as SclBehaviourTable;
  };

  beforeAll(async () => {
    result = await sliceProject(FIXTURE_ROOT);
  });

  // -------------------------------------------------------------------------
  // 1. HierarchyViewProvider#getView — call into the cache + 3 absorb rows
  // -------------------------------------------------------------------------

  it('HierarchyViewProvider#getView calls ViewCache#getViewViaCache and absorbs three exceptions in order', () => {
    const t = table('com.legacy.hier.provider.HierarchyViewProvider#getView(Integer,AuditInfo)');

    const callRow = t.rows.find(
      (r) =>
        r.outcome.type === 'call' &&
        r.outcome.targetSymbol.startsWith('com.legacy.hier.provider.ViewCache#getViewViaCache')
    );
    expect(callRow).toBeDefined();
    // The callee has a behaviour table, so the reference resolves to its T-key.
    expect((callRow!.outcome as Extract<SclRow['outcome'], { type: 'call' }>).targetKey).toBe(
      result.keyBySymbol.get(
        'com.legacy.hier.provider.ViewCache#getViewViaCache(Integer,AuditInfo)'
      )
    );

    const catchRows = t.rows.filter((r) => r.kind === 'catch');
    expect(catchRows).toHaveLength(3);
    const absorbs = catchRows.map(
      (r) => r.outcome as Extract<SclRow['outcome'], { type: 'absorb' }>
    );
    expect(absorbs.every((o) => o.type === 'absorb')).toBe(true);
    expect(absorbs.map((o) => o.exceptionType)).toEqual([
      'ViewNotFoundException',
      'NoDataFoundException',
      'Exception',
    ]);
    expect(absorbs[0].thenVerbatim).toContain('NO_DATA_FOUND');
    expect(absorbs[1].thenVerbatim).toContain('NO_DATA_FOUND');
    expect(absorbs[2].thenVerbatim).toContain('FATAL');

    // Verbatim method annotations ride on the table.
    expect(t.annotations).toContain('@ExecutionTimeLogging');
    expect(t.annotations).toContain('@AuditDbLogging');
  });

  // -------------------------------------------------------------------------
  // 2. ViewCache#getViewViaCache — branch verbatim, throw label, boundary call
  // -------------------------------------------------------------------------

  it('ViewCache#getViewViaCache has the verbatim cache branch, the throws terminal, and a Q-keyed boundary call', () => {
    const t = table('com.legacy.hier.provider.ViewCache#getViewViaCache(Integer,AuditInfo)');

    const branch = t.rows.find((r) => r.conditionVerbatim === 'cache.containsKey(viewId)');
    expect(branch).toBeDefined();
    expect(branch!.kind).toBe('branch');

    const throwsRow = t.rows.find(
      (r) => r.outcome.type === 'terminal' && r.outcome.outcomeLabel === 'throws:ViewNotFoundException'
    );
    expect(throwsRow).toBeDefined();

    const daoCall = t.rows.find(
      (r) =>
        r.outcome.type === 'call' &&
        r.outcome.targetSymbol.startsWith('com.legacy.hier.dao.ViewDao#findLatest')
    );
    expect(daoCall).toBeDefined();
    const daoOutcome = daoCall!.outcome as Extract<SclRow['outcome'], { type: 'call' }>;
    expect(daoOutcome.targetSymbol).toBe('com.legacy.hier.dao.ViewDao#findLatest(Integer)');
    // Boundary callee: the call references the Q contract directly.
    const viewDaoBoundary = result.boundaries.find(
      (b) => b.symbol === 'com.legacy.hier.dao.ViewDao'
    )!;
    expect(daoOutcome.targetKey).toBe(viewDaoBoundary.key);
    expect(daoOutcome.targetKey).toMatch(/^Q-[0-9a-f]{12}$/);
    // And the table's references carry the Q-key.
    expect(t.references).toContain(viewDaoBoundary.key);
  });

  // -------------------------------------------------------------------------
  // 3. ViewDao boundary contract — verbatim SQL + S-keyed result shape
  // -------------------------------------------------------------------------

  it('ViewDao is a boundary whose findLatest operation has verbatim SQL and the HierarchyViewDetail S-key result shape', () => {
    const boundary = result.boundaries.find((b) => b.symbol === 'com.legacy.hier.dao.ViewDao');
    expect(boundary).toBeDefined();
    expect(boundary!.key).toMatch(/^Q-[0-9a-f]{12}$/);

    const findLatest = boundary!.operations.find((op) => op.name === 'findLatest');
    expect(findLatest).toBeDefined();
    expect(findLatest!.sqlVerbatim).toContain(
      'SELECT id, name, valid_from, valid_to FROM hier_view'
    );
    expect(findLatest!.ref).not.toBeNull();
    expect(findLatest!.ref!.path).toBe('src/main/java/com/legacy/hier/dao/ViewDao.java');

    const detailKey = result.keyBySymbol.get('com.legacy.hier.model.HierarchyViewDetail');
    expect(detailKey).toMatch(/^S-[0-9a-f]{12}$/);
    expect(findLatest!.resultShape).toBe(detailKey);
    // findAll strips List<> and resolves to the same shape.
    const findAll = boundary!.operations.find((op) => op.name === 'findAll');
    expect(findAll!.resultShape).toBe(detailKey);
    // Private mapRow is not an operation.
    expect(boundary!.operations.map((op) => op.name)).not.toContain('mapRow');

    // Boundary methods get NO behaviour tables.
    expect(result.tables.some((t) => t.symbol.startsWith('com.legacy.hier.dao.ViewDao#'))).toBe(
      false
    );
  });

  // -------------------------------------------------------------------------
  // 4. NodeResource#getNode — source-ordered rows + dispatch ambiguity
  // -------------------------------------------------------------------------

  it('NodeResource#getNode has source-ordered rows, a throws first row, and a dispatch row with an ambiguity finding', () => {
    const t = table('com.legacy.hier.api.NodeResource#getNode(String)');

    const first = t.rows[0];
    expect(first.kind).toBe('branch');
    expect(first.conditionVerbatim).toBe('nodeId == null || nodeId.trim().isEmpty()');
    expect(first.outcome.type).toBe('terminal');
    expect((first.outcome as Extract<SclRow['outcome'], { type: 'terminal' }>).outcomeLabel).toBe(
      'throws:BadRequestException'
    );

    const second = t.rows[1];
    expect(second.conditionVerbatim).toBe('Long.parseLong(nodeId) > 99999999L');
    expect(second.outcome.type).toBe('terminal');

    const dispatch = t.rows.find((r) => r.kind === 'dispatch');
    expect(dispatch).toBeDefined();
    expect(dispatch!.conditionVerbatim).toBeNull();
    const dispatchOutcome = dispatch!.outcome as Extract<SclRow['outcome'], { type: 'call' }>;
    expect(dispatchOutcome.type).toBe('call');
    expect(dispatchOutcome.targetSymbol).toBe(
      'com.legacy.hier.service.NodeService#findNode(String)'
    );
    expect(dispatchOutcome.targetKey).toBeNull();

    const finding = result.findings.find(
      (f) =>
        f.kind === 'dispatch_ambiguity' &&
        f.symbol === 'com.legacy.hier.api.NodeResource#getNode(String)'
    );
    expect(finding).toBeDefined();
    expect(finding!.candidates).toContain(
      'com.legacy.hier.service.NodeServiceImpl#findNode(String)'
    );
    expect(finding!.candidates).toContain(
      'com.legacy.hier.service.CachingNodeServiceImpl#findNode(String)'
    );
  });

  // -------------------------------------------------------------------------
  // 5. CookieUtils inlining
  // -------------------------------------------------------------------------

  it('CookieUtils is inlined: no table, symbol recorded, call stays verbatim in ViewResource#getView', () => {
    expect(result.inlined.some((s) => s.includes('CookieUtils'))).toBe(true);
    expect(
      result.tables.some((t) => t.symbol.startsWith('com.legacy.hier.util.CookieUtils#'))
    ).toBe(false);

    const t = table(
      'com.legacy.hier.api.ViewResource#getView(String,String,Integer,javax.ws.rs.core.HttpHeaders)'
    );
    const inlineRow = t.rows.find(
      (r) => r.outcome.type === 'terminal' && r.outcome.verbatim.includes('CookieUtils.readSsoCookie')
    );
    expect(inlineRow).toBeDefined();
    // The inlined callee is never referenced as a contract.
    expect(t.rows.some((r) => r.outcome.type === 'call' && r.outcome.targetSymbol.includes('CookieUtils'))).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 6. Determinism
  // -------------------------------------------------------------------------

  it('is deterministic: two sliceProject runs produce identical keys and content hashes', async () => {
    const second = await sliceProject(FIXTURE_ROOT);
    expect(second.tables.map((t) => [t.symbol, t.key, t.contentHash])).toEqual(
      result.tables.map((t) => [t.symbol, t.key, t.contentHash])
    );
    expect(second.boundaries.map((b) => [b.symbol, b.key, b.contentHash])).toEqual(
      result.boundaries.map((b) => [b.symbol, b.key, b.contentHash])
    );
    expect(second.shapes.map((s) => [s.symbol, s.key, s.contentHash])).toEqual(
      result.shapes.map((s) => [s.symbol, s.key, s.contentHash])
    );
    expect(second.findings).toEqual(result.findings);
    expect(second.inlined).toEqual(result.inlined);
    expect(second.stats).toEqual(result.stats);
  });

  // -------------------------------------------------------------------------
  // 7. Stats sanity + zero parse errors
  // -------------------------------------------------------------------------

  it('has sane stats and zero parse errors', () => {
    expect(result.parseErrors).toEqual([]);
    expect(result.stats.classCount).toBe(18);
    expect(result.stats.boundaryCount).toBe(1);
    expect(result.stats.tableCount).toBe(result.tables.length);
    expect(result.stats.shapeCount).toBe(result.shapes.length);
    expect(result.stats.rowCount).toBe(
      result.tables.reduce((n, t) => n + t.rows.length, 0)
    );
    expect(result.stats.tableCount).toBeGreaterThanOrEqual(8);
    expect(result.stats.rowCount).toBeGreaterThan(0);

    // The expected table population (no boundary methods, no accessors, no
    // trivial inlined methods, no interfaces).
    const symbols = result.tables.map((t) => t.symbol);
    for (const expected of [
      'com.legacy.hier.api.ViewResource#getView(String,String,Integer,javax.ws.rs.core.HttpHeaders)',
      'com.legacy.hier.api.ViewResource#getAllViews(String,String,javax.ws.rs.core.HttpHeaders)',
      'com.legacy.hier.api.NodeResource#getNode(String)',
      'com.legacy.hier.provider.HierarchyViewProvider#getView(Integer,AuditInfo)',
      'com.legacy.hier.provider.HierarchyViewProvider#getAllViews(AuditInfo)',
      'com.legacy.hier.provider.ViewCache#getViewViaCache(Integer,AuditInfo)',
      'com.legacy.hier.provider.ViewCache#getAllViews(AuditInfo)',
      'com.legacy.hier.provider.ViewEnricher#applyOpenEndedValidity(com.legacy.hier.model.HierarchyViewDetail)',
      'com.legacy.hier.jobs.NightlyRollupJob#run()',
    ]) {
      expect(symbols).toContain(expected);
    }
    // Plain accessors never become tables.
    expect(symbols.some((s) => s.includes('HierarchyViewDetail#'))).toBe(false);

    // Every table key is well-formed and registered in keyBySymbol.
    for (const t of result.tables) {
      expect(t.key).toMatch(/^T-[0-9a-f]{12}$/);
      expect(result.keyBySymbol.get(t.symbol)).toBe(t.key);
    }
  });

  // -------------------------------------------------------------------------
  // Complexity budget — LOUD truncation
  // -------------------------------------------------------------------------

  it('truncates LOUDLY beyond the row budget (finding + /* TRUNCATED */ marker row)', async () => {
    const tight = await sliceProject(FIXTURE_ROOT, { maxRowsPerTable: 2 });
    const truncFindings = tight.findings.filter((f) => f.kind === 'complexity_truncated');
    expect(truncFindings.length).toBeGreaterThan(0);
    const truncated = tight.tables.find(
      (t) => t.symbol === 'com.legacy.hier.provider.HierarchyViewProvider#getView(Integer,AuditInfo)'
    )!;
    expect(truncated.rows).toHaveLength(3); // 2 kept + marker
    const marker = truncated.rows[truncated.rows.length - 1];
    expect(marker.conditionVerbatim).toBe('/* TRUNCATED */');
    expect(marker.kind).toBe('terminal');
    expect(
      truncFindings.some((f) => f.symbol === truncated.symbol)
    ).toBe(true);
  });
});
