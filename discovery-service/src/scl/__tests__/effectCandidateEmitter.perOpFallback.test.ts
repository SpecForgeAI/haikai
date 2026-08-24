/**
 * Per-op class-union fallback (Kiro 2026-08-24, replicated from the
 * work-machine fix): an UNANALYSED reached operation's contribution is
 * UNKNOWN, not empty — it falls back to the boundary's class-level union
 * for THAT op only. The old `anyOpKnown` form let ONE resolved sibling
 * discard the fallback for every unresolved op, so which tables survived
 * flipped whenever the opTables population changed (the
 * fix-one-break-another feedback loop). The pass is now MONOTONIC: more
 * information can only ever narrow, never erase.
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

/** ViewDao: one unreached op feeding the class union a WRITE, one
 *  reached-but-unanalysed op ('create', sql null), one reached-analysed op
 *  ('list', a select). */
function viewDaoCorpus(reachedOps: string[]): SclCorpus {
  const corpus = corpusOf([
    behaviourTable({
      key: 'T-ep',
      symbol: 'ViewService#handle',
      annotations: ['@POST', '@Path("mkview")'],
    }),
    boundaryWithOps({
      key: 'Q-viewdao',
      symbol: 'com.x.ViewDao',
      operations: [
        { name: 'seedRow', sqlVerbatim: "insert into view_registry (ViewName) values ('seed')" },
        { name: 'create', sqlVerbatim: null },
        { name: 'list', sqlVerbatim: 'select ViewName from view_registry' },
      ],
    }),
  ]);
  (corpus.contracts[0] as { contract: { rows: unknown[] } }).contract.rows = reachedOps.map(
    (op, i) => ({
      index: i,
      kind: 'terminal',
      conditionVerbatim: null,
      conditionRef: null,
      outcome: { type: 'call', targetKey: 'Q-viewdao', targetSymbol: `ViewDao#${op}` },
    }),
  );
  return corpus;
}

function edgesOf(corpus: SclCorpus): string[] {
  const result = deriveCorpusEffectCandidates({
    corpus,
    runId: 'run-1',
    runCandidates: [endpointCandidate('mkView', 'POST', '/api/mkview')],
  });
  return result.candidates.map((c) => {
    const data = c.data as Record<string, unknown>;
    return `${data.access_mode}:${String(data.dataEntityName).toLowerCase()}`;
  });
}

describe('per-op class-union fallback (Kiro 2026-08-24)', () => {
  it('an unanalysed op falls back to the class union even when an analysed sibling was ALSO reached', () => {
    // Old behavior: 'list' being analysed discarded the fallback, so the
    // create endpoint lost the boundary's write outright.
    const edges = edgesOf(viewDaoCorpus(['create', 'list']));
    expect(edges).toContain('write:view_registry');
    expect(edges).toContain('read:view_registry');
  });

  it('all-analysed reaches still NARROW to exactly the reached ops (class union not folded)', () => {
    const edges = edgesOf(viewDaoCorpus(['list']));
    expect(edges).toContain('read:view_registry');
    // The unreached seedRow write must NOT ride along.
    expect(edges).not.toContain('write:view_registry');
  });

  it('an all-unanalysed reach uses the class union (existing fallback preserved)', () => {
    const edges = edgesOf(viewDaoCorpus(['create']));
    expect(edges).toContain('write:view_registry');
    expect(edges).toContain('read:view_registry');
  });
});
