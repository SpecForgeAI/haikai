/**
 * SCL corpus assembler tests — roots, closure/fan-in, near-dup clustering,
 * the aggregated unresolved-calls finding, and the class-level reachability
 * report, against the REAL fixture legacy app slice.
 *
 * Parse-heavy suite (wasm tree-sitter through `sliceProject`);
 * run via `npm test -- --testPathPattern="src/scl"`.
 */

import * as path from 'path';
import { sliceProject, type SclSliceResult } from '../slicer';
import {
  assembleCorpus,
  type SclCorpus,
  type SclCorpusContract,
} from '../corpusAssembler';
import { stableStringify } from '../sclTypes';

const FIXTURE_ROOT = path.join(__dirname, 'fixtures', 'legacy-app');

const SYM = {
  getNode: 'com.legacy.hier.api.NodeResource#getNode(String)',
  getView: 'com.legacy.hier.api.ViewResource#getView(String,String,Integer,HttpHeaders)',
  getAllViews: 'com.legacy.hier.api.ViewResource#getAllViews(String,String,HttpHeaders)',
  jobRun: 'com.legacy.hier.jobs.NightlyRollupJob#run()',
  importMain: 'com.legacy.hier.orphan.LegacyImportTool#main(String[])',
  providerGetView: 'com.legacy.hier.provider.HierarchyViewProvider#getView(Integer,AuditInfo)',
  providerGetAllViews: 'com.legacy.hier.provider.HierarchyViewProvider#getAllViews(AuditInfo)',
  cacheGetViewViaCache: 'com.legacy.hier.provider.ViewCache#getViewViaCache(Integer,AuditInfo)',
  cacheGetAllViews: 'com.legacy.hier.provider.ViewCache#getAllViews(AuditInfo)',
  cachingFindNode: 'com.legacy.hier.service.CachingNodeServiceImpl#findNode(String)',
  enricherApply: 'com.legacy.hier.provider.ViewEnricher#applyOpenEndedValidity(HierarchyViewDetail)',
  viewDao: 'com.legacy.hier.dao.ViewDao',
  hierarchyViewDetail: 'com.legacy.hier.model.HierarchyViewDetail',
  filterCriteria: 'com.legacy.hier.model.FilterCriteria',
  nodeServiceImpl: 'com.legacy.hier.service.NodeServiceImpl',
  nodeService: 'com.legacy.hier.service.NodeService',
  viewEnricher: 'com.legacy.hier.provider.ViewEnricher',
  cookieUtils: 'com.legacy.hier.util.CookieUtils',
  legacyImportTool: 'com.legacy.hier.orphan.LegacyImportTool',
};

describe('assembleCorpus (fixture legacy app)', () => {
  let slice: SclSliceResult;
  let corpus: SclCorpus;

  const contract = (sourceSymbol: string, kind?: string): SclCorpusContract => {
    const found = corpus.contracts.find(
      (c) => c.sourceSymbol === sourceSymbol && (kind === undefined || c.kind === kind)
    );
    expect(found).toBeDefined();
    return found as SclCorpusContract;
  };

  beforeAll(async () => {
    slice = await sliceProject(FIXTURE_ROOT);
    corpus = assembleCorpus(slice);
  });

  // -------------------------------------------------------------------------
  // 1. Roots — generic detectors, no hardcoded app idioms
  // -------------------------------------------------------------------------

  it('detects the three HTTP-annotated resource methods as external roots', () => {
    const external = corpus.roots.filter((r) => r.kind === 'external');
    expect(external.map((r) => r.symbol).sort()).toEqual(
      [SYM.getNode, SYM.getAllViews, SYM.getView].sort()
    );
    for (const r of external) {
      expect(r.detail).toMatch(/^http_annotation:@/);
    }
  });

  it('roots NightlyRollupJob#run via the generic framework-invoked detector (external supertype + public no-arg run)', () => {
    const root = corpus.roots.find((r) => r.symbol === SYM.jobRun);
    expect(root).toBeDefined();
    expect(root!.kind).toBe('internal');
    // Which detector fired is recorded in the detail.
    expect(root!.detail).toBe('framework_invoked:Runnable');
  });

  it('roots LegacyImportTool#main via the main-method detector even though the table was inline-suppressed — and the orphan report therefore excludes the class', () => {
    // The trivial main body was inlined (no behaviour table exists) …
    expect(slice.inlined).toContain(SYM.importMain);
    expect(slice.tables.some((t) => t.symbol === SYM.importMain)).toBe(false);
    // … but detector (a) works from the index, so it is a ROOT, not an orphan.
    const root = corpus.roots.find((r) => r.symbol === SYM.importMain);
    expect(root).toBeDefined();
    expect(root!.kind).toBe('internal');
    expect(root!.detail).toBe('has_main');
    expect(corpus.reachability.some((i) => i.symbol === SYM.legacyImportTool)).toBe(false);
  });

  it('roots NodeServiceImpl via the config-referenced detector (d) at class level (beans.xml, all methods inlined)', () => {
    const root = corpus.roots.find((r) => r.symbol === SYM.nodeServiceImpl);
    expect(root).toBeDefined();
    expect(root!.kind).toBe('internal');
    expect(root!.detail).toBe('config_referenced:src/main/resources/beans.xml');
    // Identifier-boundary matching: the NodeService INTERFACE is not wrongly
    // config-rooted by its FQN being a substring of NodeServiceImpl's.
    expect(corpus.roots.some((r) => r.symbol === SYM.nodeService)).toBe(false);
  });

  it('supports extraRoots (the AMS-registered-entrypoint seam): an extra root makes its closure reachable and leaves the report', () => {
    const withExtra = assembleCorpus(slice, { extraRoots: [SYM.enricherApply] });
    const root = withExtra.roots.find((r) => r.symbol === SYM.enricherApply);
    expect(root).toBeDefined();
    expect(root!.kind).toBe('internal');
    expect(root!.detail).toBe('extra_root');
    const enricherTable = withExtra.contracts.find((c) => c.sourceSymbol === SYM.enricherApply);
    expect(enricherTable!.reachable).toBe(true);
    expect(withExtra.reachability.some((i) => i.symbol === SYM.viewEnricher)).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 2. Closure + fan-in
  // -------------------------------------------------------------------------

  it('reaches the provider and cache tables from exactly the getView root (rootFanIn 1)', () => {
    const provider = contract(SYM.providerGetView, 'behaviour_table');
    expect(provider.reachable).toBe(true);
    expect(provider.rootFanIn).toBe(1);
    expect(provider.roots).toEqual([SYM.getView]);

    const cache = contract(SYM.cacheGetViewViaCache, 'behaviour_table');
    expect(cache.reachable).toBe(true);
    expect(cache.rootFanIn).toBe(1);
    expect(cache.roots).toEqual([SYM.getView]);
  });

  it('reaches the ViewDao Q contract and the shape chain (HierarchyViewDetail via the boundary result shape, FilterCriteria via shape refs)', () => {
    const dao = contract(SYM.viewDao, 'boundary');
    expect(dao.contractKey).toMatch(/^Q-[0-9a-f]{12}$/);
    expect(dao.reachable).toBe(true);
    expect(dao.roots.sort()).toEqual([SYM.getAllViews, SYM.getView].sort());

    const detail = contract(SYM.hierarchyViewDetail, 'shape');
    expect(detail.reachable).toBe(true);
    expect(detail.rootFanIn).toBe(2);

    const criteria = contract(SYM.filterCriteria, 'shape');
    expect(criteria.reachable).toBe(true);
  });

  it('hoists the shared NodeService impl table: reachable from BOTH the getNode endpoint AND the NightlyRollupJob job — rootFanIn exactly 2', () => {
    // THE fan-in hoisting fixture: dispatch expansion resolves the interface
    // call from NodeResource#getNode AND the loop-body call from
    // NightlyRollupJob#run to the same CachingNodeServiceImpl table.
    const impl = contract(SYM.cachingFindNode, 'behaviour_table');
    expect(impl.reachable).toBe(true);
    expect(impl.rootFanIn).toBe(2);
    expect(impl.roots).toEqual([SYM.getNode, SYM.jobRun]);
    expect(impl.refFanIn).toBe(2);
  });

  it('persists unreachable contracts with reachable=false (the Structural Model tab shows them)', () => {
    const enricher = contract(SYM.enricherApply, 'behaviour_table');
    expect(enricher.reachable).toBe(false);
    expect(enricher.rootFanIn).toBe(0);
    expect(enricher.roots).toEqual([]);
    // Unreachable shapes stay in the corpus too.
    const envelope = contract('com.legacy.hier.model.ResponseEnvelope', 'shape');
    expect(envelope.reachable).toBe(false);
    expect(corpus.contracts.some((c) => !c.reachable)).toBe(true);
  });

  it('carries identity fields verbatim from the slice contracts', () => {
    const provider = contract(SYM.providerGetView, 'behaviour_table');
    const sliceTable = slice.tables.find((t) => t.symbol === SYM.providerGetView)!;
    expect(provider.contractKey).toBe(sliceTable.key);
    expect(provider.contentHash).toBe(sliceTable.contentHash);
    expect(provider.sourcePath).toBe(sliceTable.sourcePath);
    expect(provider.contract).toBe(sliceTable);
  });

  // -------------------------------------------------------------------------
  // 3. Reachability report (class-level, generic signals)
  // -------------------------------------------------------------------------

  it('reports ViewEnricher as a genuine orphan with no_signals', () => {
    const item = corpus.reachability.find((i) => i.symbol === SYM.viewEnricher);
    expect(item).toBeDefined();
    expect(item!.signals).toEqual(['no_signals']);
    expect(item!.sourcePath).toBe(
      'src/main/java/com/legacy/hier/provider/ViewEnricher.java'
    );
  });

  it('EXCLUDES inlined helpers from the report (their code lives inside callers): CookieUtils', () => {
    // CookieUtils has no tables and its only method was inline-suppressed —
    // "unreachable as a table" is definitional for it, not diagnostic.
    expect(slice.inlined.some((s) => s.startsWith(`${SYM.cookieUtils}#`))).toBe(true);
    expect(corpus.reachability.some((i) => i.symbol === SYM.cookieUtils)).toBe(false);
  });

  it('excludes annotation types (aspects) from the report entirely', () => {
    expect(
      corpus.reachability.some((i) => i.symbol.includes('aspect.'))
    ).toBe(false);
    // @interface declarations are not even indexed as classes.
    expect(slice.index.classesByFqn.has('com.legacy.hier.aspect.AuditDbLogging')).toBe(false);
  });

  it('excludes the config-wired NodeServiceImpl (root + closure-reached via dispatch) and the NodeService interface from the report', () => {
    expect(corpus.reachability.some((i) => i.symbol === SYM.nodeServiceImpl)).toBe(false);
    expect(corpus.reachability.some((i) => i.symbol === SYM.nodeService)).toBe(false);
  });

  it('annotates unreached exception classes with the generic implements_external signal', () => {
    const notFound = corpus.reachability.find(
      (i) => i.symbol === 'com.legacy.hier.exception.ViewNotFoundException'
    );
    expect(notFound).toBeDefined();
    expect(notFound!.signals).toContain('implements_external:Exception');
  });

  it('keeps the report sorted by symbol and consistent with the stats', () => {
    const symbols = corpus.reachability.map((i) => i.symbol);
    expect(symbols).toEqual([...symbols].sort());
    expect(corpus.stats.unreachableClassCount).toBe(corpus.reachability.length);
  });

  // -------------------------------------------------------------------------
  // 4. Assembler findings
  // -------------------------------------------------------------------------

  it('clusters the two structurally-identical ViewResource endpoints as ONE near-duplicate finding (never auto-merged)', () => {
    const clusters = corpus.findings.filter((f) => f.kind === 'near_duplicate_cluster');
    expect(clusters).toHaveLength(1);
    expect(clusters[0].candidates).toEqual([SYM.getAllViews, SYM.getView]);
    // Clustered tables remain distinct contracts in the corpus.
    expect(contract(SYM.getView).contractKey).not.toBe(contract(SYM.getAllViews).contractKey);
  });

  it('aggregates all null-targetKey call/dispatch rows into ONE unresolved_calls finding + the stat', () => {
    const unresolved = corpus.findings.filter((f) => f.kind === 'unresolved_calls');
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0].detail).toContain('3 call/dispatch row(s)');
    expect(unresolved[0].candidates).toHaveLength(3);
    expect(unresolved[0].candidates).toContain(
      `${SYM.getNode} -> com.legacy.hier.service.NodeService#findNode(String)`
    );
    expect(corpus.stats.unresolvedCallCount).toBe(3);
  });

  it('carries the slice findings through (dispatch ambiguities preserved)', () => {
    for (const f of slice.findings) {
      expect(corpus.findings).toContainEqual(f);
    }
  });

  // -------------------------------------------------------------------------
  // 5. Stats
  // -------------------------------------------------------------------------

  it('computes consistent corpus stats', () => {
    expect(corpus.stats.externalRootCount).toBe(3);
    expect(corpus.stats.internalRootCount).toBe(3);
    expect(corpus.stats.rootCount).toBe(corpus.roots.length);
    expect(corpus.stats.rootCount).toBe(6);
    expect(corpus.stats.contractCount).toBe(corpus.contracts.length);
    expect(corpus.stats.contractCount).toBe(
      slice.tables.length + slice.shapes.length + slice.boundaries.length
    );
    expect(corpus.stats.reachableContractCount).toBe(
      corpus.contracts.filter((c) => c.reachable).length
    );
    expect(corpus.stats.reachableContractCount).toBe(12);
    const countedFindings = Object.values(corpus.stats.findingCounts).reduce((a, b) => a + b, 0);
    expect(countedFindings).toBe(corpus.findings.length);
    expect(corpus.stats.findingCounts.near_duplicate_cluster).toBe(1);
    expect(corpus.stats.findingCounts.unresolved_calls).toBe(1);
  });

  // -------------------------------------------------------------------------
  // 6. Determinism
  // -------------------------------------------------------------------------

  it('is deterministic: assembling twice yields byte-identical stableStringify output', () => {
    const again = assembleCorpus(slice);
    expect(stableStringify(again)).toBe(stableStringify(corpus));
  });

  it('is deterministic across fresh slices too', async () => {
    const freshSlice = await sliceProject(FIXTURE_ROOT);
    const fresh = assembleCorpus(freshSlice);
    expect(stableStringify(fresh)).toBe(stableStringify(corpus));
  });
});
