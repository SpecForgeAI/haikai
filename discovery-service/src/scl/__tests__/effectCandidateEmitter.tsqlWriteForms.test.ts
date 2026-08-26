/**
 * T-SQL optional-keyword write forms reach the WALK as writes (2026-08-26
 * capture-leak fix). Sybase allows `insert <table>` (no INTO) and
 * `delete <table>` (no FROM); a createOrGet/favourite-style DAO written in
 * that house style had its SELECT parse as a read edge while the INSERT
 * stayed invisible — the model held the table as READ-only, the
 * compensation bracket never imaged it, and the write leaked straight to
 * the end-of-job S0 fingerprint (one un-bracketed row per mutating call).
 * The parse-level pins live in effectCandidateEmitter.test.ts; this pins
 * the end-to-end story: bare-form writes emit WRITE candidates.
 */

import { deriveCorpusEffectCandidates } from '../effectCandidateEmitter';
import type { SclCorpus } from '../corpusAssembler';
import { DiscoveryCandidate } from '../../types/candidate';

function behaviourTable(args: { key: string; symbol: string; annotations: string[] }) {
  return {
    contract: {
      key: args.key,
      kind: 'behaviour_table',
      symbol: args.symbol,
      sourcePath: 'src/X.java',
      startLine: 1,
      signatureInputs: [],
      outcomeSignature: [],
      rows: [] as unknown[],
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

function boundaryWithOps(args: {
  key: string;
  symbol: string;
  operations: Array<{ name: string; sqlVerbatim: string | null }>;
}) {
  return {
    contract: {
      key: args.key,
      kind: 'boundary',
      symbol: args.symbol,
      sourcePath: 'src/Dao.java',
      operations: args.operations.map((o, i) => ({
        name: o.name,
        sqlVerbatim: o.sqlVerbatim,
        ref: o.sqlVerbatim ? { path: 'src/Dao.java', line: 10 + i } : null,
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
    refFanIn: 0,
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
  } as unknown as SclCorpus;
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

/** A favourite-style toggle: ONE reached DAO op whose body reads the tag
 *  row THEN bare-inserts it (`insert filter_tag …`, no INTO), plus a bare
 *  delete op for the un-favourite side. */
function favouriteCorpus(reachedOps: string[]): SclCorpus {
  const corpus = corpusOf([
    behaviourTable({
      key: 'T-fav',
      symbol: 'FilterService#markFavourite',
      annotations: ['@POST', '@Path("markFavourite")'],
    }),
    boundaryWithOps({
      key: 'Q-tagdao',
      symbol: 'com.x.FilterTagDao',
      operations: [
        {
          name: 'createOrGetTag',
          sqlVerbatim:
            'select tag_name from filter_tag where filter_id = ? ' +
            'insert filter_tag (filter_id, tag_name) values (?, ?)',
        },
        {
          name: 'removeTag',
          sqlVerbatim: 'delete filter_tag where filter_id = ? and tag_name = ?',
        },
      ],
    }),
  ]);
  (corpus.contracts[0] as { contract: { rows: unknown[] } }).contract.rows = reachedOps.map(
    (op, i) => ({
      index: i,
      kind: 'terminal',
      conditionVerbatim: null,
      conditionRef: null,
      outcome: { type: 'call', targetKey: 'Q-tagdao', targetSymbol: `FilterTagDao#${op}` },
    }),
  );
  return corpus;
}

function edgesOf(corpus: SclCorpus): string[] {
  const result = deriveCorpusEffectCandidates({
    corpus,
    runId: 'run-1',
    runCandidates: [endpointCandidate('markFavourite', 'POST', '/api/markFavourite')],
  });
  return result.candidates.map((c) => {
    const data = c.data as Record<string, unknown>;
    return `${data.access_mode}:${String(data.dataEntityName).toLowerCase()}`;
  });
}

describe('T-SQL optional-keyword writes in the walk (2026-08-26)', () => {
  it('a bare-INSERT read-then-write op derives a WRITE edge, not a read-only one', () => {
    const edges = edgesOf(favouriteCorpus(['createOrGetTag']));
    // Before the fix this endpoint derived ONLY read:filter_tag — the
    // exact shape that left the bracket blind to the favourite write.
    expect(edges).toContain('write:filter_tag');
  });

  it('a bare-DELETE op derives a WRITE edge', () => {
    const edges = edgesOf(favouriteCorpus(['removeTag']));
    expect(edges).toContain('write:filter_tag');
    expect(edges).not.toContain('read:filter_tag');
  });
});
