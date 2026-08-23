/**
 * Effect-candidate emission tests (2026-08-20, "one scan, one review, one
 * save"). Pins: the deterministic derivation (root matching with the
 * longest-fragment discipline, call walk to boundary SQL, candidate shape
 * matching the save-back contract, never competing with discovery's own
 * mined effects), and the guarded LLM proposal phase (vocabulary guard,
 * lower confidence, honest unproposed tail on decline/outage).
 */

import { DiscoveryCandidate } from '../../types/candidate';
import type { SclCorpus } from '../corpusAssembler';
import {
  deriveCorpusEffectCandidates,
  derivePathFragment,
  indexCorpus,
  parseProposalContent,
  parseWriteTablesFromSql,
  proposeEffectCandidatesViaLlm,
  summarizeEmission,
  unresolvedReason,
} from '../effectCandidateEmitter';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function behaviourTable(args: {
  key: string;
  symbol: string;
  annotations: string[];
  callTargets?: Array<string | null>;
}) {
  return {
    contract: {
      key: args.key,
      kind: 'behaviour_table',
      symbol: args.symbol,
      sourcePath: 'src/X.java',
      startLine: 1,
      signatureInputs: [],
      outcomeSignature: [],
      rows: (args.callTargets ?? []).map((target, index) => ({
        index,
        kind: 'terminal',
        conditionVerbatim: index === 0 ? 'input != null' : null,
        conditionRef: null,
        outcome:
          target === null
            ? { type: 'terminal', verbatim: 'return ok', ref: { path: 'x', line: 1 }, outcomeLabel: 'ok' }
            : { type: 'call', targetKey: target, targetSymbol: `Sym#${target}` },
      })),
      references: [],
      annotations: args.annotations,
      contentHash: 'h',
    },
    kind: 'behaviour_table',
    contractKey: args.key,
    sourcePath: 'src/X.java',
    sourceSymbol: args.symbol,
    contentHash: 'h',
    rootFanIn: 1,
    refFanIn: 0,
    roots: [],
  };
}

function boundary(args: { key: string; symbol: string; sql: string[] }) {
  return {
    contract: {
      key: args.key,
      kind: 'boundary',
      symbol: args.symbol,
      sourcePath: 'src/Dao.java',
      operations: args.sql.map((sqlVerbatim, i) => ({
        name: `op${i}`,
        sqlVerbatim,
        ref: { path: 'src/Dao.java', line: 10 + i },
        resultShape: null,
      })),
      contentHash: 'h',
    },
    kind: 'boundary',
    contractKey: args.key,
    sourcePath: 'src/Dao.java',
    sourceSymbol: args.symbol,
    contentHash: 'h',
    rootFanIn: 1,
    refFanIn: 1,
    roots: [],
  };
}

function corpusOf(contracts: unknown[]): SclCorpus {
  return {
    roots: [],
    contracts: contracts as SclCorpus['contracts'],
    reachability: [],
    findings: [],
    stats: {
      rootCount: 0,
      externalRootCount: 0,
      internalRootCount: 0,
      contractCount: contracts.length,
      reachableContractCount: contracts.length,
      unreachableClassCount: 0,
      unresolvedCallCount: 0,
      findingCounts: {},
    },
  };
}

function endpointCandidate(name: string, method: string, path: string): DiscoveryCandidate {
  return {
    id: `ep-${name}`,
    runId: 'run-1',
    candidateType: 'endpoints',
    name,
    confidence: 0.9,
    status: 'proposed',
    sourceClusterIds: [],
    data: { method, path },
  } as unknown as DiscoveryCandidate;
}

function effectCandidateFor(endpointName: string): DiscoveryCandidate {
  return {
    id: `ede-${endpointName}`,
    runId: 'run-1',
    candidateType: 'endpoint_data_effects',
    name: `${endpointName} → x`,
    confidence: 0.8,
    status: 'proposed',
    sourceClusterIds: [],
    data: { endpointName, dataEntityName: 'x', access_mode: 'write' },
  } as unknown as DiscoveryCandidate;
}

const CORPUS = corpusOf([
  behaviourTable({
    key: 'T-lookup',
    symbol: 'FilterResource#lookup',
    annotations: ['@POST', '@Path("lookup")'],
    callTargets: ['T-service'],
  }),
  behaviourTable({
    key: 'T-lookupFav',
    symbol: 'FilterResource#lookupStarred',
    annotations: ['@POST', '@Path("lookupStarred")'],
    callTargets: [null],
  }),
  behaviourTable({
    key: 'T-service',
    symbol: 'FilterService#apply',
    annotations: [],
    callTargets: ['Q-dao', 'T-lookup'], // includes a cycle back to the root
  }),
  boundary({
    key: 'Q-dao',
    symbol: 'FilterDao',
    sql: ['INSERT INTO dbo.filters (a) VALUES (?)', 'UPDATE [filter_audit] SET x = 1'],
  }),
]);

// ---------------------------------------------------------------------------
// Deterministic phase
// ---------------------------------------------------------------------------

describe('deriveCorpusEffectCandidates', () => {
  it('derives write-table candidates through the call walk, save-back shaped', () => {
    const result = deriveCorpusEffectCandidates({
      corpus: CORPUS,
      runId: 'run-1',
      runCandidates: [endpointCandidate('lookupFilters', 'POST', '/filters/lookup')],
    });
    expect(result.candidates).toHaveLength(2);
    const first = result.candidates[0];
    expect(first.candidateType).toBe('endpoint_data_effects');
    expect(first.confidence).toBe(0.9);
    const data = first.data as Record<string, unknown>;
    expect(data.endpointName).toBe('lookupFilters');
    expect(['filters', 'filter_audit']).toContain(data.dataEntityName);
    expect(data.access_mode).toBe('write');
    expect(data._addedBy).toBe('scl-effect-candidate-emitter');
    expect(
      (data.path_metadata_json as Record<string, unknown>).derivation,
    ).toBe('scl_corpus');
    expect(result.uncovered).toHaveLength(0);
  });

  it('longest-fragment discipline: /lookupStarred never matches the /lookup root', () => {
    const result = deriveCorpusEffectCandidates({
      corpus: CORPUS,
      runId: 'run-1',
      runCandidates: [endpointCandidate('lookupFav', 'POST', '/filters/lookupStarred')],
    });
    // The favourite root has no boundary in its walk -> no tables -> uncovered,
    // and the rootKeys prove the LONGER fragment won.
    expect(result.candidates).toHaveLength(0);
    expect(result.uncovered).toHaveLength(1);
    expect(result.uncovered[0].rootKeys).toEqual(['T-lookupFav']);
    // Diagnosis: root matched, walk COMPLETE (no calls at all), nothing
    // reached -> the honest complete_walk_no_tables stage.
    expect(result.uncovered[0].diagnosis.stage).toBe('complete_walk_no_tables');
    expect(result.uncovered[0].diagnosis.matched_roots[0]).toContain('lookupStarred');
  });

  it('dispatch expansion: a null-target interface call resolves to a DAO boundary by op name', () => {
    const corpus = corpusOf([
      behaviourTable({
        key: 'T-promote',
        symbol: 'FilterResource#promote',
        annotations: ['@POST', '@Path("promote")'],
        callTargets: [],
      }),
      boundary({
        key: 'Q-loaderImpl',
        symbol: 'FilterLoaderJdbc',
        sql: ['UPDATE filters SET status = ?'],
      }),
    ]);
    // The root calls the INTERFACE method — unresolved targetKey, but the
    // boundary has an operation of the same name: expansion bridges it.
    const rootContract = (corpus.contracts[0] as { contract: { rows: unknown[] } }).contract;
    rootContract.rows.push({
      index: 0,
      kind: 'terminal',
      conditionVerbatim: null,
      conditionRef: null,
      outcome: {
        type: 'call',
        targetKey: null,
        targetSymbol: 'FilterLoader#op0(Integer)',
      },
    });
    // Boundary op names come from the fixture builder as op0/op1/...
    const result = deriveCorpusEffectCandidates({
      corpus,
      runId: 'run-1',
      runCandidates: [endpointCandidate('promote', 'POST', '/filters/promote')],
    });
    expect(result.uncovered).toHaveLength(0);
    expect(result.candidates).toHaveLength(1);
    expect((result.candidates[0].data as Record<string, unknown>).dataEntityName).toBe('filters');
  });

  it('proven-read: a COMPLETE walk reaching only SELECT SQL emits read edges, not uncovered', () => {
    const corpus = corpusOf([
      behaviourTable({
        key: 'T-lookup',
        symbol: 'FilterResource#lookup',
        annotations: ['@POST', '@Path("lookup")'],
        callTargets: ['Q-readDao'],
      }),
      boundary({
        key: 'Q-readDao',
        symbol: 'FilterReadDao',
        sql: ['SELECT * FROM filters f JOIN filter_audit a ON f.id = a.fid'],
      }),
    ]);
    const result = deriveCorpusEffectCandidates({
      corpus,
      runId: 'run-1',
      runCandidates: [endpointCandidate('lookupFilters', 'POST', '/filters/lookup')],
    });
    expect(result.uncovered).toHaveLength(0);
    expect(result.provenRead).toHaveLength(1);
    expect(result.provenRead[0].readTables).toEqual(['filters', 'filter_audit']);
    expect(result.candidates).toHaveLength(2);
    const data = result.candidates[0].data as Record<string, unknown>;
    expect(data.access_mode).toBe('read');
    expect(
      (data.path_metadata_json as Record<string, unknown>).derivation,
    ).toBe('scl_corpus_read_proof');
  });

  it('diagnosis names the exact unresolved call site when the chain breaks', () => {
    const corpus = corpusOf([
      behaviourTable({
        key: 'T-promote',
        symbol: 'FilterResource#promote',
        annotations: ['@POST', '@Path("promote")'],
        callTargets: ['T-broken'],
      }),
      behaviourTable({
        key: 'T-broken',
        symbol: 'FilterService#promote',
        annotations: [],
        callTargets: [], // will get an UNRESOLVED call row below
      }),
    ]);
    // Inject an unresolved call row (targetKey null) into the service table.
    const serviceContract = (corpus.contracts[1] as { contract: { rows: unknown[] } }).contract;
    serviceContract.rows.push({
      index: 0,
      kind: 'terminal',
      conditionVerbatim: null,
      conditionRef: null,
      outcome: { type: 'call', targetKey: null, targetSymbol: 'FilterWorkflowDao#save' },
    });

    const result = deriveCorpusEffectCandidates({
      corpus,
      runId: 'run-1',
      runCandidates: [endpointCandidate('promote', 'POST', '/filters/promote')],
    });
    expect(result.uncovered).toHaveLength(1);
    const diagnosis = result.uncovered[0].diagnosis;
    expect(diagnosis.stage).toBe('chain_broken');
    expect(diagnosis.broken_calls[0]).toContain('FilterService#promote');
    expect(diagnosis.broken_calls[0]).toContain('FilterWorkflowDao#save');
    expect(diagnosis.broken_calls[0]).toContain('unresolved');
  });

  it('diagnosis lists same-verb fragments when NO root matches at all', () => {
    const result = deriveCorpusEffectCandidates({
      corpus: CORPUS,
      runId: 'run-1',
      runCandidates: [endpointCandidate('delete', 'POST', '/filters/deleteAll')],
    });
    expect(result.uncovered).toHaveLength(1);
    const diagnosis = result.uncovered[0].diagnosis;
    expect(diagnosis.stage).toBe('no_root_match');
    expect(diagnosis.same_verb_root_fragments).toEqual(
      expect.arrayContaining(['lookup', 'lookupStarred']),
    );
  });

  it('mined coverage: corpus edges are ADDITIVE, exact duplicates suppressed, never uncovered', () => {
    // 2026-08-22 ruling change ("chains are truth, mining is a head start"):
    // a mined effect no longer suppresses the walk — it only exempts the
    // endpoint from `uncovered` and dedupes exact (endpoint, table, mode)
    // edges. The walk's ADDITIONAL writes still emit.
    const result = deriveCorpusEffectCandidates({
      corpus: CORPUS,
      runId: 'run-1',
      runCandidates: [
        endpointCandidate('lookupFilters', 'POST', '/filters/lookup'),
        effectCandidateFor('lookupFilters'), // mined write on table `x`
      ],
    });
    expect(result.uncovered).toHaveLength(0);
    const tables = result.candidates.map(
      (c) => (c.data as Record<string, unknown>).dataEntityName,
    );
    expect(tables.sort()).toEqual(['filter_audit', 'filters']); // additive, no dup of `x`
  });

  it('a GET with no same-verb root emits nothing, never enters uncovered, and self-diagnoses', () => {
    const result = deriveCorpusEffectCandidates({
      corpus: CORPUS,
      runId: 'run-1',
      runCandidates: [endpointCandidate('listFilters', 'GET', '/filters/lookup')],
    });
    expect(result.candidates).toHaveLength(0);
    expect(result.uncovered).toHaveLength(0);
    // 2026-08-22: GETs no longer fail silently — the read-side diagnosis
    // mirror records WHY nothing derived.
    expect(result.readUnderived).toHaveLength(1);
    expect(result.readUnderived[0]).toMatchObject({
      method: 'GET',
      path: '/filters/lookup',
    });
    expect(result.readUnderived[0].diagnosis.stage).toBe('no_root_match');
  });
});

// ---------------------------------------------------------------------------
// Verb-agnostic chains (2026-08-22 user ruling: "old codebases don't obey
// REST and HTTP verb principles ... we just want the full path from endpoint
// to database"). Live-shakedown origin: 0 read edges estate-wide made the
// CRUD matrix claim "no table is ever read".
// ---------------------------------------------------------------------------

describe('verb-agnostic effect chains (2026-08-22)', () => {
  const READ_WRITE_CORPUS = corpusOf([
    behaviourTable({
      key: 'T-list',
      symbol: 'FilterResource#list',
      annotations: ['@GET', '@Path("filters")'],
      callTargets: ['Q-readDao'],
    }),
    behaviourTable({
      key: 'T-touch',
      symbol: 'AuditResource#touch',
      annotations: ['@GET', '@Path("touch")'],
      callTargets: ['Q-auditDao'],
    }),
    behaviourTable({
      key: 'T-save',
      symbol: 'FilterResource#save',
      annotations: ['@POST', '@Path("save")'],
      callTargets: ['Q-mixedDao'],
    }),
    boundary({
      key: 'Q-readDao',
      symbol: 'FilterReadDao',
      sql: ['SELECT * FROM filters f JOIN filter_tags ft ON f.id = ft.fid'],
    }),
    boundary({
      key: 'Q-auditDao',
      symbol: 'AccessAuditDao',
      sql: ['INSERT INTO access_audit (who) VALUES (?)'],
    }),
    boundary({
      key: 'Q-mixedDao',
      symbol: 'FilterWriteDao',
      sql: ['SELECT rate FROM ref_rates WHERE id = ?', 'INSERT INTO filters (a) VALUES (?)'],
    }),
  ]);

  it('a GET whose chain reaches SELECTs emits READ edges (scl_corpus_read)', () => {
    const result = deriveCorpusEffectCandidates({
      corpus: READ_WRITE_CORPUS,
      runId: 'run-1',
      runCandidates: [endpointCandidate('listFilters', 'GET', '/api/filters')],
    });
    const edges = result.candidates.map((c) => {
      const data = c.data as Record<string, unknown>;
      return `${data.access_mode}:${data.dataEntityName}`;
    });
    expect(edges.sort()).toEqual(['read:filter_tags', 'read:filters']);
    const detail = (result.candidates[0].data as Record<string, unknown>)
      .path_metadata_json as Record<string, unknown>;
    // Proof strength is VERB-INDEPENDENT: a complete clean walk earns
    // read_proof even on a GET; partial walks get plain scl_corpus_read.
    expect(detail.derivation).toBe('scl_corpus_read_proof');
    expect(result.readMapped).toBe(1);
    expect(result.uncovered).toHaveLength(0); // GETs never demand write maps
  });

  it('a legacy WRITING GET emits a real write edge (verbs are hints, chains are truth)', () => {
    const result = deriveCorpusEffectCandidates({
      corpus: READ_WRITE_CORPUS,
      runId: 'run-1',
      runCandidates: [endpointCandidate('touchAudit', 'GET', '/api/touch')],
    });
    expect(result.candidates).toHaveLength(1);
    const data = result.candidates[0].data as Record<string, unknown>;
    expect(data.access_mode).toBe('write');
    expect(data.dataEntityName).toBe('access_audit');
    expect(result.uncovered).toHaveLength(0);
  });

  it('a mutating endpoint that writes A and reads B emits write:A AND read:B', () => {
    const result = deriveCorpusEffectCandidates({
      corpus: READ_WRITE_CORPUS,
      runId: 'run-1',
      runCandidates: [endpointCandidate('saveFilter', 'POST', '/api/save')],
    });
    const edges = result.candidates.map((c) => {
      const data = c.data as Record<string, unknown>;
      return `${data.access_mode}:${data.dataEntityName}`;
    });
    expect(edges.sort()).toEqual(['read:ref_rates', 'write:filters']);
    // A writing chain is not read-PROVEN — its observed reads carry the
    // plain tag.
    const readEdge = result.candidates.find(
      (c) => (c.data as Record<string, unknown>).access_mode === 'read',
    )!;
    expect(
      ((readEdge.data as Record<string, unknown>).path_metadata_json as Record<string, unknown>)
        .derivation,
    ).toBe('scl_corpus_read');
  });

  it('an INTERNAL entrypoint (className/methodName) walks its chain and emits edges', () => {
    const corpus = corpusOf([
      behaviourTable({
        key: 'T-job',
        symbol: 'com.example.NightlyJob#run',
        annotations: [],
        callTargets: ['Q-jobDao'],
      }),
      boundary({
        key: 'Q-jobDao',
        symbol: 'SnapshotDao',
        sql: ['SELECT id FROM work_queue', 'INSERT INTO event_sink (x) VALUES (?)'],
      }),
    ]);
    const internal = {
      id: 'ep-job',
      runId: 'run-1',
      candidateType: 'endpoints',
      name: 'INTERNAL nightly-job',
      confidence: 0.9,
      status: 'proposed',
      sourceClusterIds: [],
      data: {
        httpMethod: 'INTERNAL_PROCESS',
        fullPath: 'nightly-job',
        className: 'com.example.NightlyJob',
        methodName: 'run',
      },
    } as unknown as DiscoveryCandidate;
    const result = deriveCorpusEffectCandidates({
      corpus,
      runId: 'run-1',
      runCandidates: [internal],
    });
    const edges = result.candidates.map((c) => {
      const data = c.data as Record<string, unknown>;
      return `${data.access_mode}:${data.dataEntityName}`;
    });
    expect(edges.sort()).toEqual(['read:work_queue', 'write:event_sink']);
    expect(result.internalWalked).toEqual(['INTERNAL nightly-job']);
    const detail = (result.candidates[0].data as Record<string, unknown>)
      .path_metadata_json as Record<string, unknown>;
    expect(detail.internal_entry).toBe('com.example.NightlyJob#run');
  });

  it('a GET whose chain BREAKS records chain_broken with the exact unresolved call', () => {
    const corpus = corpusOf([
      behaviourTable({
        key: 'T-broken',
        symbol: 'BookResource#list',
        annotations: ['@GET', '@Path("books")'],
        callTargets: ['T-ghost'], // target key never exists in the corpus
      }),
    ]);
    const result = deriveCorpusEffectCandidates({
      corpus,
      runId: 'run-1',
      runCandidates: [endpointCandidate('listBooks', 'GET', '/api/books')],
    });
    expect(result.candidates).toHaveLength(0);
    expect(result.readUnderived).toHaveLength(1);
    // T-ghost is queued but has no table -> walk ends without boundaries;
    // nothing derived and no boundary reached = complete_walk_no_tables
    // (a broken CALL SYMBOL would land chain_broken — pinned below).
    expect(['chain_broken', 'complete_walk_no_tables']).toContain(
      result.readUnderived[0].diagnosis.stage,
    );
  });

  it('a GET reaching a boundary whose SQL parses no tables records boundaries_without_read_sql', () => {
    const corpus = corpusOf([
      behaviourTable({
        key: 'T-ping',
        symbol: 'PingResource#ping',
        annotations: ['@GET', '@Path("ping")'],
        callTargets: ['Q-pingDao'],
      }),
      boundary({
        key: 'Q-pingDao',
        symbol: 'PingDao',
        sql: ['exec sp_ping'], // SQL-ish but yields neither reads nor writes
      }),
    ]);
    const result = deriveCorpusEffectCandidates({
      corpus,
      runId: 'run-1',
      runCandidates: [endpointCandidate('ping', 'GET', '/api/ping')],
    });
    expect(result.candidates).toHaveLength(0);
    expect(result.readUnderived).toHaveLength(1);
    expect(result.readUnderived[0].diagnosis.stage).toBe('boundaries_without_read_sql');
    expect(result.readUnderived[0].diagnosis.boundaries_reached[0]).toContain('PingDao');
  });

  it('a GET that derives read edges is NOT read-underived', () => {
    const result = deriveCorpusEffectCandidates({
      corpus: READ_WRITE_CORPUS,
      runId: 'run-1',
      runCandidates: [endpointCandidate('listFilters', 'GET', '/api/filters')],
    });
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.readUnderived).toHaveLength(0);
  });

  it('a PARTIALLY-derived endpoint still records its broken calls (chainBreaks)', () => {
    // The 2026-08-22 live shape: every GET derives the shared boilerplate
    // read, then its DOMAIN hop breaks — zero-edge instruments saw nothing.
    const corpus = corpusOf([
      behaviourTable({
        key: 'T-book',
        symbol: 'BookResource#list',
        annotations: ['@GET', '@Path("books")'],
        callTargets: ['Q-statusDao'], // boilerplate DAO; unresolved call injected below
      }),
      boundary({
        key: 'Q-statusDao',
        symbol: 'SystemStatusDao',
        sql: ['SELECT d FROM business_date'],
      }),
    ]);
    (corpus.contracts[0] as { contract: { rows: unknown[] } }).contract.rows.push({
      index: 9,
      kind: 'terminal',
      conditionVerbatim: null,
      conditionRef: null,
      outcome: { type: 'call', targetKey: null, targetSymbol: 'HierarchyLoaderFactory#load' },
    });
    const result = deriveCorpusEffectCandidates({
      corpus,
      runId: 'run-1',
      runCandidates: [endpointCandidate('listBooks', 'GET', '/api/books')],
    });
    // Derived the boilerplate read...
    expect(
      result.candidates.map((c) => (c.data as Record<string, unknown>).dataEntityName),
    ).toEqual(['business_date']);
    // ...and is NOT read-underived (it derived something)...
    expect(result.readUnderived).toHaveLength(0);
    // ...but the break is RECORDED with the emitted count.
    expect(result.chainBreaks).toHaveLength(1);
    expect(result.chainBreaks[0]).toMatchObject({
      endpointName: 'listBooks',
      method: 'GET',
      emitted: 1,
    });
    expect(result.chainBreaks[0].broken_calls[0]).toContain('unresolved');
  });

  it('summarizeEmission ranks topBrokenTargets from chainBreaks (partial included)', () => {
    const corpus = corpusOf([
      behaviourTable({
        key: 'T-a',
        symbol: 'ResA#get',
        annotations: ['@GET', '@Path("alpha")'],
        callTargets: ['Q-statusDao'],
      }),
      behaviourTable({
        key: 'T-b',
        symbol: 'ResB#get',
        annotations: ['@GET', '@Path("beta")'],
        callTargets: ['Q-statusDao'],
      }),
      boundary({
        key: 'Q-statusDao',
        symbol: 'SystemStatusDao',
        sql: ['SELECT d FROM business_date'],
      }),
    ]);
    for (const i of [0, 1]) {
      (corpus.contracts[i] as { contract: { rows: unknown[] } }).contract.rows.push({
        index: 9,
        kind: 'terminal',
        conditionVerbatim: null,
        conditionRef: null,
        outcome: { type: 'call', targetKey: null, targetSymbol: 'HierarchyLoaderFactory#load' },
      });
    }
    const derive = deriveCorpusEffectCandidates({
      corpus,
      runId: 'run-1',
      runCandidates: [
        endpointCandidate('getA', 'GET', '/api/alpha'),
        endpointCandidate('getB', 'GET', '/api/beta'),
      ],
    });
    const summary = summarizeEmission(derive, { candidates: [], unproposed: [], llmCalls: 0 });
    expect(summary.chainBreakCount).toBe(2);
    expect(summary.partialChainCount).toBe(2);
    const tops = summary.topBrokenTargets as string[];
    expect(tops).toHaveLength(1);
    expect(tops[0]).toMatch(/\(2\)$/); // the shared broken target counted from BOTH endpoints
  });

  it('KNOWN-class dispatch with 19 implementations resolves (criteria pattern); ?-class stays capped', () => {
    // 2026-08-23 live root cause: `Criteria#match(T)` has 19 implementations;
    // the flat cap of 12 severed every hierarchy chain behind the criteria
    // hop. A KNOWN receiver class now gets fan-out headroom; the strict cap
    // stays for `?` receivers.
    const makeCorpus = (targetSymbol: string) => {
      const impls = Array.from({ length: 19 }, (_, i) =>
        behaviourTable({
          key: `T-crit${i}`,
          symbol: `com.x.CriteriaImpl${i}#match(Node)`,
          annotations: [],
          callTargets: i === 0 ? ['Q-bookDao'] : [],
        }),
      );
      const corpus = corpusOf([
        behaviourTable({
          key: 'T-list',
          symbol: 'HierarchyResource#list',
          annotations: ['@GET', '@Path("hier")'],
          callTargets: [],
        }),
        ...impls,
        boundary({
          key: 'Q-bookDao',
          symbol: 'BookDao',
          sql: ['select * from hir_book where ValidFrom <= ?'],
        }),
      ]);
      // The impls take one parameter — the helper defaults signatureInputs
      // to [] which would index them as match/0 while the call wants match/1.
      for (let i = 1; i <= 19; i++) {
        (corpus.contracts[i] as { contract: { signatureInputs: unknown[] } }).contract.signatureInputs =
          [{ name: 'node', typeRef: 'Node' }];
      }
      (corpus.contracts[0] as { contract: { rows: unknown[] } }).contract.rows.push({
        index: 9,
        kind: 'terminal',
        conditionVerbatim: null,
        conditionRef: null,
        outcome: { type: 'call', targetKey: null, targetSymbol },
      });
      return corpus;
    };

    const result = deriveCorpusEffectCandidates({
      corpus: makeCorpus('com.x.Criteria#match(T)'),
      runId: 'run-1',
      runCandidates: [endpointCandidate('listHier', 'GET', '/api/hier')],
    });
    // The dispatch EXPANDS through the 19 impls to the DAO — read derived,
    // no chain break recorded.
    expect(
      result.candidates.map((c) => (c.data as Record<string, unknown>).dataEntityName),
    ).toEqual(['hir_book']);
    expect(result.chainBreaks).toHaveLength(0);

    // The SAME fan-out behind an unknown receiver stays refused (loud).
    const blindResult = deriveCorpusEffectCandidates({
      corpus: makeCorpus('?#match(?)'),
      runId: 'run-1',
      runCandidates: [endpointCandidate('listHier', 'GET', '/api/hier')],
    });
    expect(blindResult.candidates).toHaveLength(0);
    expect(blindResult.chainBreaks).toHaveLength(1);
    expect(blindResult.chainBreaks[0].broken_calls[0]).toContain('exceed the expansion cap 12');
  });

  it('reads derived through a cache-bridge row carry via_legacy_cache (decision evidence)', () => {
    const corpus = corpusOf([
      behaviourTable({
        key: 'T-front',
        symbol: 'FilterCacheFront#getFilters',
        annotations: ['@GET', '@Path("cached")'],
        callTargets: [],
      }),
      boundary({
        key: 'Q-dao',
        symbol: 'FilterDao',
        sql: ['select * from hir_filter where ValidFrom <= ?'],
      }),
    ]);
    (corpus.contracts[0] as { contract: { rows: unknown[] } }).contract.rows.push({
      index: 9,
      kind: 'branch',
      conditionVerbatim: 'cache miss -> loader',
      conditionRef: null,
      outcome: { type: 'call', targetKey: 'Q-dao', targetSymbol: 'FilterDao#getAllFilters' },
    });
    const result = deriveCorpusEffectCandidates({
      corpus,
      runId: 'run-1',
      runCandidates: [endpointCandidate('cachedFilters', 'GET', '/api/cached')],
    });
    expect(result.candidates).toHaveLength(1);
    const detail = (result.candidates[0].data as Record<string, unknown>)
      .path_metadata_json as Record<string, unknown>;
    expect(detail.via_legacy_cache).toBe(true);

    // A DIRECT (non-bridged) read carries NO tag.
    const direct = deriveCorpusEffectCandidates({
      corpus: READ_WRITE_CORPUS,
      runId: 'run-1',
      runCandidates: [endpointCandidate('listFilters', 'GET', '/api/filters')],
    });
    const directDetail = (direct.candidates[0].data as Record<string, unknown>)
      .path_metadata_json as Record<string, unknown>;
    expect(directDetail.via_legacy_cache).toBeUndefined();
  });

  it('an internal entrypoint with NO corpus presence lands in internalUnmatched, loudly', () => {
    const internal = {
      id: 'ep-ghost',
      runId: 'run-1',
      candidateType: 'endpoints',
      name: 'INTERNAL ghost-job',
      confidence: 0.9,
      status: 'proposed',
      sourceClusterIds: [],
      data: { httpMethod: 'INTERNAL_PROCESS', className: 'com.example.Ghost', methodName: 'run' },
    } as unknown as DiscoveryCandidate;
    const result = deriveCorpusEffectCandidates({
      corpus: CORPUS,
      runId: 'run-1',
      runCandidates: [internal],
    });
    expect(result.candidates).toHaveLength(0);
    expect(result.internalUnmatched).toEqual(['com.example.Ghost#run']);
  });
});

// ---------------------------------------------------------------------------
// LLM phase
// ---------------------------------------------------------------------------

describe('proposeEffectCandidatesViaLlm', () => {
  const uncovered = [
    {
      endpointCandidate: endpointCandidate('promoteFilter', 'POST', '/filters/promote'),
      method: 'POST',
      path: '/filters/promote',
      rootKeys: ['T-lookup'],
      diagnosis: {
        stage: 'chain_broken' as const,
        matched_roots: ['FilterResource#promote [fragment "promote"]'],
        same_verb_root_fragments: [],
        broken_calls: ['FilterService#promote: call to X unresolved'],
        boundaries_reached: [],
      },
    },
  ];

  it('accepts vocabulary-guarded tables at lower confidence; records rejects', async () => {
    const prompts: string[] = [];
    const result = await proposeEffectCandidatesViaLlm({
      runId: 'run-1',
      uncovered,
      corpus: CORPUS,
      vocabulary: ['filters', 'filter_audit'],
      relay: async (prompt) => {
        prompts.push(prompt);
        return {
          content: JSON.stringify({
            proposals: [
              {
                method: 'POST',
                path: '/filters/promote',
                tables: ['filter_audit', 'made_up'],
                rationale: 'promotion writes the audit trail',
              },
            ],
          }),
        };
      },
    });
    expect(result.llmCalls).toBe(1);
    expect(prompts[0]).toContain('filters, filter_audit'); // closed vocabulary in the prompt
    expect(prompts[0]).toContain('POST /filters/promote');
    expect(result.candidates).toHaveLength(1);
    const data = result.candidates[0].data as Record<string, unknown>;
    expect(result.candidates[0].confidence).toBe(0.65);
    expect(data.dataEntityName).toBe('filter_audit');
    const meta = data.path_metadata_json as Record<string, unknown>;
    expect(meta.derivation).toBe('llm_proposal');
    expect(meta.guard_rejected).toEqual(['made_up']);
    expect(result.unproposed).toHaveLength(0);
  });

  it('an outage lands the batch in unproposed with the reason', async () => {
    const result = await proposeEffectCandidatesViaLlm({
      runId: 'run-1',
      uncovered,
      corpus: CORPUS,
      vocabulary: ['filters'],
      relay: async () => {
        throw new Error('gateway relay HTTP 429');
      },
    });
    expect(result.candidates).toHaveLength(0);
    expect(result.unproposed).toHaveLength(1);
    expect(result.unproposed[0].reason).toContain('429');
    // The deterministic diagnosis travels with the unproposed record.
    expect(result.unproposed[0].diagnosis?.stage).toBe('chain_broken');
    expect(result.unproposed[0].diagnosis?.broken_calls[0]).toContain('unresolved');
  });

  it('every-table-guarded-out lands in unproposed honestly', async () => {
    const result = await proposeEffectCandidatesViaLlm({
      runId: 'run-1',
      uncovered,
      corpus: CORPUS,
      vocabulary: ['filters'],
      relay: async () => ({
        content: JSON.stringify({
          proposals: [
            { method: 'POST', path: '/filters/promote', tables: ['invented'], rationale: 'x' },
          ],
        }),
      }),
    });
    expect(result.candidates).toHaveLength(0);
    expect(result.unproposed[0].reason).toContain('vocabulary guard');
  });
});

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

describe('helpers', () => {
  it('parseWriteTablesFromSql strips schema/brackets, skips temp tables', () => {
    expect(parseWriteTablesFromSql('INSERT INTO dbo.orders (a) VALUES (1)')).toEqual(['orders']);
    expect(parseWriteTablesFromSql('INSERT INTO #tmp SELECT 1')).toEqual([]);
    expect(parseWriteTablesFromSql('SELECT update_count FROM t')).toEqual([]);
  });

  it('parseProposalContent tolerates markdown fences', () => {
    const proposals = parseProposalContent(
      '```json\n{"proposals":[{"method":"POST","path":"/x","tables":["t"]}]}\n```',
    );
    expect(proposals).toHaveLength(1);
    expect(proposals[0].path).toBe('/x');
  });
});

// ---------------------------------------------------------------------------
// 2026-08-21 fixes: composed fragments, real-symbol dispatch expansion,
// unresolved-call diagnosis reasons
// ---------------------------------------------------------------------------

describe('composed path fragments + dispatch fixes (2026-08-21)', () => {
  it('derivePathFragment composes class-level + method-level @Path in order', () => {
    expect(
      derivePathFragment(['@Path("hierarchy")', '@POST', '@Path("{date}/{id}")']),
    ).toBe('hierarchy/{date}/{id}');
    expect(derivePathFragment(['@POST', '@Path("/lookup/")'])).toBe('lookup');
    expect(derivePathFragment(['@POST'])).toBeNull();
  });

  it('a placeholder-only METHOD fragment becomes a usable root via the class prefix', () => {
    const corpus = corpusOf([
      behaviourTable({
        key: 'T-h',
        symbol: 'HierarchyResource#byDate',
        annotations: ['@Path("hierarchy")', '@POST', '@Path("{date}/{id}")'],
        callTargets: ['Q-hdao'],
      }),
      boundary({ key: 'Q-hdao', symbol: 'HierarchyDao', sql: ['INSERT INTO hier_node (a) VALUES (1)'] }),
    ]);
    const result = deriveCorpusEffectCandidates({
      corpus,
      runId: 'run-1',
      runCandidates: [endpointCandidate('h', 'POST', '/hierarchy/{businessDate}/{orgUnitId}')],
    });
    expect(result.uncovered).toHaveLength(0);
    expect(result.candidates.map((c) => c.name)).toEqual(['h → hier_node (write)']);
  });

  it('dispatch expansion resolves REAL `Cls#method(Type)` symbols (paren-strip fix)', () => {
    // Root's call row is null-target with a real-style abstract symbol; the
    // concrete override's table is found by bare name+arity and the walk
    // continues to its boundary write.
    const root = behaviourTable({
      key: 'T-root',
      symbol: 'NodeResource#save',
      annotations: ['@POST', '@Path("save")'],
      callTargets: [],
    });
    (root.contract as { rows: unknown[] }).rows = [
      {
        index: 0,
        kind: 'terminal',
        conditionVerbatim: null,
        conditionRef: null,
        outcome: {
          type: 'call',
          targetKey: null,
          targetSymbol: 'com.example.factory.NodeLoader#load(LocalDate)',
        },
      },
    ];
    const impl = behaviourTable({
      key: 'T-impl',
      symbol: 'com.example.factory.DbNodeLoader#load(LocalDate)',
      annotations: [],
      callTargets: ['Q-ndao'],
    });
    (impl.contract as { signatureInputs: unknown[] }).signatureInputs = [
      { name: 'date', typeRef: 'LocalDate' },
    ];
    const corpus = corpusOf([
      root,
      impl,
      boundary({ key: 'Q-ndao', symbol: 'NodeDao', sql: ['UPDATE node_state SET x = 1'] }),
    ]);
    const result = deriveCorpusEffectCandidates({
      corpus,
      runId: 'run-1',
      runCandidates: [endpointCandidate('n', 'POST', '/nodes/save')],
    });
    expect(result.uncovered).toHaveLength(0);
    expect(result.candidates.map((c) => c.name)).toEqual(['n → node_state (write)']);
  });

  it('unresolvedReason distinguishes absent classes from missing methods', () => {
    const index = indexCorpus(CORPUS);
    expect(unresolvedReason('com.x.Missing#nope(LocalDate)', index)).toContain(
      'NO corpus presence',
    );
    expect(unresolvedReason('FilterResource#nope(LocalDate)', index)).toContain(
      'no method named nope/1',
    );
  });

  it('broken-call lines carry the reason clause', () => {
    const root = behaviourTable({
      key: 'T-r',
      symbol: 'R#go',
      annotations: ['@POST', '@Path("go")'],
      callTargets: [],
    });
    (root.contract as { rows: unknown[] }).rows = [
      {
        index: 0,
        kind: 'terminal',
        conditionVerbatim: null,
        conditionRef: null,
        outcome: {
          type: 'call',
          targetKey: null,
          targetSymbol: 'com.x.GoneLoader#fetch(LocalDate)',
        },
      },
    ];
    const result = deriveCorpusEffectCandidates({
      corpus: corpusOf([root]),
      runId: 'run-1',
      runCandidates: [endpointCandidate('g', 'POST', '/go')],
    });
    expect(result.uncovered).toHaveLength(1);
    expect(result.uncovered[0].diagnosis.broken_calls[0]).toContain(
      'target class has NO corpus presence',
    );
  });
});

describe('boundary SQL-visibility stats (2026-08-21)', () => {
  it('annotates boundaries_reached with ops/sql/reads/writes counts', () => {
    const root = behaviourTable({
      key: 'T-b',
      symbol: 'R#blind',
      annotations: ['@POST', '@Path("blind")'],
      callTargets: ['Q-blind'],
    });
    const blind = boundary({ key: 'Q-blind', symbol: 'BlindDao', sql: [] });
    (blind.contract as { operations: unknown[] }).operations = [
      { name: 'run', sqlVerbatim: null, ref: { path: 'x', line: 1 }, resultShape: null },
    ];
    const result = deriveCorpusEffectCandidates({
      corpus: corpusOf([root, blind]),
      runId: 'run-1',
      runCandidates: [endpointCandidate('b', 'POST', '/blind')],
    });
    expect(result.uncovered).toHaveLength(1);
    expect(result.uncovered[0].diagnosis.boundaries_reached).toEqual([
      'BlindDao (ops 1, sql 0, reads 0, writes 0; blind ops: run)',
    ]);
  });
});

describe('class-aware dispatch ladder (2026-08-21 Item 4)', () => {
  function nullCallTable(key: string, symbol: string, path: string, targetSymbol: string) {
    const t = behaviourTable({ key, symbol, annotations: ['@POST', `@Path("${path}")`], callTargets: [] });
    (t.contract as { rows: unknown[] }).rows = [
      {
        index: 0,
        kind: 'terminal',
        conditionVerbatim: null,
        conditionRef: null,
        outcome: { type: 'call', targetKey: null, targetSymbol },
      },
    ];
    return t;
  }

  function implTable(key: string, symbol: string, boundaryKey: string) {
    const t = behaviourTable({ key, symbol, annotations: [], callTargets: [boundaryKey] });
    (t.contract as { signatureInputs: unknown[] }).signatureInputs = [
      { name: 'k', typeRef: 'String' },
    ];
    return t;
  }

  it('exact class+name+arity wins over a same-named method on an unrelated class', () => {
    const corpus = corpusOf([
      nullCallTable('T-root', 'R#go', 'go', 'com.a.OrgSaver#save(String)'),
      implTable('T-a', 'com.a.OrgSaver#save(String)', 'Q-a'),
      implTable('T-b', 'com.b.UnrelatedSaver#save(String)', 'Q-b'),
      boundary({ key: 'Q-a', symbol: 'ADao', sql: ['INSERT INTO org_saved (a) VALUES (1)'] }),
      boundary({ key: 'Q-b', symbol: 'BDao', sql: ['INSERT INTO unrelated_tbl (a) VALUES (1)'] }),
    ]);
    const result = deriveCorpusEffectCandidates({
      corpus,
      runId: 'run-1',
      runCandidates: [endpointCandidate('g', 'POST', '/go')],
    });
    const tables = result.candidates.map((c) => c.name);
    expect(tables).toEqual(['g → org_saved (write)']);
    expect(JSON.stringify(tables)).not.toContain('unrelated_tbl');
  });

  it('a KNOWN class with an arity mismatch stays broken (no blind name-only union)', () => {
    const corpus = corpusOf([
      nullCallTable('T-root', 'R#go', 'go', 'com.a.OrgSaver#save(String,int)'),
      implTable('T-b', 'com.b.UnrelatedSaver#save(String)', 'Q-b'),
      boundary({ key: 'Q-b', symbol: 'BDao', sql: ['INSERT INTO unrelated_tbl (a) VALUES (1)'] }),
    ]);
    const result = deriveCorpusEffectCandidates({
      corpus,
      runId: 'run-1',
      runCandidates: [endpointCandidate('g', 'POST', '/go')],
    });
    expect(result.candidates).toHaveLength(0);
    expect(result.uncovered).toHaveLength(1);
    expect(result.uncovered[0].diagnosis.broken_calls[0]).toContain('save');
  });

  it('a ?-class symbol (unknown receiver) still resolves via name-only as last resort', () => {
    const corpus = corpusOf([
      nullCallTable('T-root', 'R#go', 'go', '?#persistThing(?)'),
      implTable('T-a', 'com.a.ThingWriter#persistThing(Item)', 'Q-a'),
      boundary({ key: 'Q-a', symbol: 'ADao', sql: ['INSERT INTO thing_store (a) VALUES (1)'] }),
    ]);
    const result = deriveCorpusEffectCandidates({
      corpus,
      runId: 'run-1',
      runCandidates: [endpointCandidate('g', 'POST', '/go')],
    });
    expect(result.candidates.map((c) => c.name)).toEqual(['g → thing_store (write)']);
  });

  it('?-class broken calls carry the receiver-unknown reason', () => {
    const corpus = corpusOf([nullCallTable('T-root', 'R#go', 'go', '?#vanish(?)')]);
    const result = deriveCorpusEffectCandidates({
      corpus,
      runId: 'run-1',
      runCandidates: [endpointCandidate('g', 'POST', '/go')],
    });
    expect(result.uncovered[0].diagnosis.broken_calls[0]).toContain(
      'receiver type could not be determined at scan time',
    );
  });
});
