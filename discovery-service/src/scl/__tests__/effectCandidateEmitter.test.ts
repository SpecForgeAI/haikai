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

  it('never competes: endpoints already covered by a mined effect candidate are skipped', () => {
    const result = deriveCorpusEffectCandidates({
      corpus: CORPUS,
      runId: 'run-1',
      runCandidates: [
        endpointCandidate('lookupFilters', 'POST', '/filters/lookup'),
        effectCandidateFor('lookupFilters'),
      ],
    });
    expect(result.candidates).toHaveLength(0);
    expect(result.uncovered).toHaveLength(0);
  });

  it('ignores read endpoints and non-endpoint candidates', () => {
    const result = deriveCorpusEffectCandidates({
      corpus: CORPUS,
      runId: 'run-1',
      runCandidates: [endpointCandidate('listFilters', 'GET', '/filters/lookup')],
    });
    expect(result.candidates).toHaveLength(0);
    expect(result.uncovered).toHaveLength(0);
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
