/**
 * Deterministic-phase vocabulary guard (Kiro 2026-08-24, replicated from
 * the work-machine fix). `mineSqlFromMethod` space-joins EVERY string
 * literal in a method before the table regexes run, so a non-SQL literal
 * next to a SQL one yields phantom table tokens. The LLM proposal phase
 * has always been vocabulary-guarded; the DETERMINISTIC phase was not, so
 * phantoms rode through as real edges and could only ever be BLOCKED at
 * save-back. Supplying the committed table vocabulary drops them at
 * source (recorded on droppedUnknownTables); absent vocabulary keeps the
 * old unguarded behaviour.
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

/** One endpoint whose DAO reach parses a REAL table and a PHANTOM token
 *  (the literal-join artifact: `insert into db` from a joined non-SQL
 *  fragment). */
function phantomCorpus(): SclCorpus {
  const corpus = corpusOf([
    behaviourTable({
      key: 'T-ep',
      symbol: 'BookService#save',
      annotations: ['@POST', '@Path("books")'],
    }),
    boundary({
      key: 'Q-dao',
      symbol: 'com.x.BookDao',
      sql: [
        'insert into deal_book (Name) values (?) select Name from deal_book insert into db select 1 from the',
      ],
    }),
  ]);
  (corpus.contracts[0] as { contract: { rows: unknown[] } }).contract.rows = [
    {
      index: 0,
      kind: 'terminal',
      conditionVerbatim: null,
      conditionRef: null,
      outcome: { type: 'call', targetKey: 'Q-dao', targetSymbol: 'BookDao#op0' },
    },
  ];
  return corpus;
}

function deriveWith(vocabulary: string[] | null | undefined) {
  return deriveCorpusEffectCandidates({
    corpus: phantomCorpus(),
    runId: 'run-1',
    tableVocabulary: vocabulary,
    runCandidates: [endpointCandidate('saveBook', 'POST', '/api/books')],
  });
}

function edgesOf(result: ReturnType<typeof deriveWith>): string[] {
  return result.candidates.map((c) => {
    const data = c.data as Record<string, unknown>;
    return `${data.access_mode}:${String(data.dataEntityName).toLowerCase()}`;
  });
}

describe('deterministic-phase vocabulary guard (Kiro 2026-08-24)', () => {
  it('drops phantom tokens at source and records them on droppedUnknownTables', () => {
    const result = deriveWith(['deal_book']);
    const edges = edgesOf(result);
    expect(edges).toContain('write:deal_book');
    // The literal-join phantoms never become edges...
    expect(edges.some((e) => e.endsWith(':db') || e.endsWith(':the'))).toBe(false);
    // ...and the refusal is LOUD, not silent.
    expect(result.droppedUnknownTables).toEqual(expect.arrayContaining(['db', 'the']));
  });

  it('absent vocabulary keeps the old unguarded behaviour (guard OFF)', () => {
    const result = deriveWith(null);
    const edges = edgesOf(result);
    expect(edges).toContain('write:deal_book');
    expect(edges).toContain('write:db');
    expect(result.droppedUnknownTables).toEqual([]);
  });

  it('vocabulary matching is normalised (case / surrounding noise collapse to one recorded phantom)', () => {
    const result = deriveWith(['DEAL_BOOK']);
    // Mixed-case vocabulary still admits the real table.
    expect(edgesOf(result)).toContain('write:deal_book');
    // Each phantom is recorded ONCE, normalised.
    const dbCount = result.droppedUnknownTables.filter((t) => t === 'db').length;
    expect(dbCount).toBe(1);
  });

  it('readAnywhereTables passes through the SAME guard (the write-only bucket gate stays phantom-free)', () => {
    const guarded = deriveWith(['deal_book']);
    expect(guarded.readAnywhereTables).not.toContain('the');
    expect(guarded.readAnywhereTables).toContain('deal_book');
    const unguarded = deriveWith(null);
    expect(unguarded.readAnywhereTables).toContain('the');
  });
});
