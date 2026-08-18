/**
 * SCL annotation pass (SCL pipeline spec 4, 2026-08-18) — fully mocked deps.
 *
 * Pins:
 *  1. happy path: unglossed table/shape contracts each get ONE LLM call + a
 *     gloss PATCH; already-glossed are skipped (idempotent) unless regenerate;
 *     the stats PATCH MERGES scl_annotation into the existing stats_json;
 *  2. verbatim-substring guard: hallucinated GLOSSES are dropped with a
 *     finding, a hallucinated INTENT rejects the whole annotation (no patch);
 *  3. malformed JSON gets exactly one retry;
 *  4. deterministic contradiction pass vs captured baseline items (5xx seen
 *     but no mined failure outcome / mined failures never observed / no
 *     baseline ⇒ baseline_available:false, zero contradictions);
 *  5. failure isolation: one contract's terminal LLM failure never stops the
 *     run — annotation_failed finding, everything else still processed.
 */

jest.mock('../logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import {
  runSclAnnotationPass,
  SclAnnotationDeps,
  SclContractWire,
  stableStringify,
} from '../sclAnnotationPass';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function table(
  key: string,
  overrides: Partial<SclContractWire> = {},
  body: Record<string, unknown> = {
    annotations: ['@GET', '@Path("/views/{viewId}")'],
    rows: [{ condition: 'always', outcome: 'value: view' }],
  }
): SclContractWire {
  return {
    contract_key: key,
    kind: 'behaviour_table',
    source_path: 'src/Legacy.java',
    source_symbol: `Legacy#${key}`,
    fan_in: 1,
    roots_json: { roots: [`Legacy#${key}`] },
    body_json: body,
    gloss_json: null,
    ...overrides,
  };
}

function shape(key: string): SclContractWire {
  return {
    contract_key: key,
    kind: 'shape',
    source_path: 'src/ViewDto.java',
    source_symbol: 'ViewDto',
    fan_in: 3,
    roots_json: { roots: [] },
    body_json: { fields: [{ name: 'id', kind: 'string' }] },
    gloss_json: null,
  };
}

const VALID_ANNOTATION = JSON.stringify({
  intent: 'Returns the requested view.',
  rowGlosses: [{ index: 0, gloss: 'Always yields the view.' }],
  fragmentName: 'View fetch',
});

interface MockDeps extends SclAnnotationDeps {
  fetchScan: jest.Mock;
  fetchContracts: jest.Mock;
  patchGloss: jest.Mock;
  patchScan: jest.Mock;
  llm: jest.Mock;
  fetchBaseline: jest.Mock;
  fetchBaselineItems: jest.Mock;
}

function makeDeps(args: {
  tables?: SclContractWire[];
  shapes?: SclContractWire[];
  baseline?: { id: string } | null;
  items?: Array<{ method: string; path: string; response_status: number }>;
}): MockDeps {
  return {
    fetchScan: jest
      .fn()
      .mockResolvedValue({ id: 'scan-1', status: 'completed', stats_json: { prior: 'kept' } }),
    fetchContracts: jest.fn().mockImplementation(async (_p, _a, _s, kind: string) => {
      if (kind === 'behaviour_table') return args.tables ?? [];
      if (kind === 'shape') return args.shapes ?? [];
      return [];
    }),
    patchGloss: jest.fn().mockResolvedValue(undefined),
    patchScan: jest.fn().mockResolvedValue(undefined),
    llm: jest.fn().mockResolvedValue({ content: VALID_ANNOTATION }),
    fetchBaseline: jest.fn().mockResolvedValue(args.baseline ?? null),
    fetchBaselineItems: jest.fn().mockResolvedValue(args.items ?? []),
  };
}

const RUN = { projectId: 'p1', architectureId: 'arch-1' };

// ---------------------------------------------------------------------------
// 1. Happy path + idempotent skip + regenerate
// ---------------------------------------------------------------------------

describe('runSclAnnotationPass — happy path', () => {
  it('annotates unglossed contracts, skips glossed, merges stats, regenerates on demand', async () => {
    const deps = makeDeps({
      tables: [table('T-1'), table('T-2'), table('T-3', { gloss_json: { intent: 'old' } })],
      shapes: [shape('S-1')],
    });

    const summary = await runSclAnnotationPass(RUN, deps);

    // 3 unglossed → 3 LLM calls + 3 gloss PATCHes; T-3 skipped without a call.
    expect(deps.llm).toHaveBeenCalledTimes(3);
    expect(deps.patchGloss).toHaveBeenCalledTimes(3);
    const prompts = deps.llm.mock.calls.map((c) => c[0].userPrompt as string);
    expect(prompts.some((p) => p.includes('Contract T-3'))).toBe(false);
    expect(summary.annotated).toBe(3);
    expect(summary.skipped_already_glossed).toBe(1);
    expect(summary.rejected).toBe(0);
    expect(summary.guard_rejections).toBe(0);
    expect(summary.baseline_available).toBe(false);

    // Gloss shape: intent + fragment_name + row_glosses map + annotated_at.
    const [, , , patchedKey, glossJson] = deps.patchGloss.mock.calls[0];
    expect(['T-1', 'T-2', 'S-1']).toContain(patchedKey);
    expect(glossJson.intent).toBe('Returns the requested view.');
    expect(glossJson.fragment_name).toBe('View fetch');
    expect(typeof glossJson.annotated_at).toBe('string');

    // Stats PATCH merged INTO the existing stats_json (spread, not replace).
    expect(deps.patchScan).toHaveBeenCalledTimes(1);
    const stats = deps.patchScan.mock.calls[0][3];
    expect(stats.prior).toBe('kept');
    expect(stats.scl_annotation.annotated).toBe(3);
    expect(stats.scl_annotation.skipped_already_glossed).toBe(1);
    expect(typeof stats.scl_annotation.completed_at).toBe('string');

    // regenerate=true re-annotates EVERYTHING including T-3.
    const again = await runSclAnnotationPass({ ...RUN, regenerate: true }, deps);
    expect(deps.llm).toHaveBeenCalledTimes(3 + 4);
    expect(deps.patchGloss).toHaveBeenCalledTimes(3 + 4);
    expect(again.annotated).toBe(4);
    expect(again.skipped_already_glossed).toBe(0);
  });

  it('row glosses land keyed by index in row_glosses', async () => {
    const deps = makeDeps({ tables: [table('T-1')] });
    await runSclAnnotationPass(RUN, deps);
    const glossJson = deps.patchGloss.mock.calls[0][4];
    expect(glossJson.row_glosses).toEqual({ '0': 'Always yields the view.' });
  });
});

// ---------------------------------------------------------------------------
// 2. Verbatim-substring guard
// ---------------------------------------------------------------------------

describe('runSclAnnotationPass — verbatim guard', () => {
  const GUARD_BODY = {
    annotations: ['@GET', '@Path("/views/{viewId}")'],
    rows: [
      { condition: 'id valid', outcome: 'value: viewDao.findLatest(viewId)' },
      { condition: 'else', outcome: 'throws: BadRequestException' },
    ],
  };

  it('keeps verbatim glosses, drops hallucinated ones with a finding', async () => {
    const deps = makeDeps({ tables: [table('T-g', {}, GUARD_BODY)] });
    deps.llm.mockResolvedValue({
      content: JSON.stringify({
        intent: 'Loads the latest view.',
        rowGlosses: [
          { index: 0, gloss: 'Delegates to `viewDao.findLatest(viewId)`.' },
          { index: 1, gloss: 'Calls `totallyInvented()` to validate.' },
        ],
        fragmentName: 'Latest view',
      }),
    });

    const summary = await runSclAnnotationPass(RUN, deps);

    expect(summary.annotated).toBe(1);
    expect(summary.guard_rejections).toBe(1);
    const glossJson = deps.patchGloss.mock.calls[0][4];
    expect(glossJson.row_glosses).toEqual({
      '0': 'Delegates to `viewDao.findLatest(viewId)`.',
    });
    expect(glossJson.guard_findings).toEqual([
      expect.objectContaining({
        kind: 'gloss_rejected_hallucination',
        detail: 'totallyInvented()',
        contract_key: 'T-g',
      }),
    ]);
  });

  it('a hallucinated INTENT rejects the whole annotation — no gloss patch, one finding', async () => {
    const deps = makeDeps({ tables: [table('T-bad-intent', {}, GUARD_BODY)] });
    deps.llm.mockResolvedValue({
      content: JSON.stringify({
        intent: 'Wraps `neverThere()` around the DAO.',
        rowGlosses: [],
        fragmentName: 'Bad',
      }),
    });

    const summary = await runSclAnnotationPass(RUN, deps);

    // Guard rejection is NOT a parse failure — no retry, single call.
    expect(deps.llm).toHaveBeenCalledTimes(1);
    expect(deps.patchGloss).not.toHaveBeenCalled();
    expect(summary.annotated).toBe(0);
    expect(summary.rejected).toBe(1);
    expect(summary.findings).toEqual([
      expect.objectContaining({
        kind: 'gloss_rejected_hallucination',
        detail: 'neverThere()',
        contract_key: 'T-bad-intent',
      }),
    ]);
  });

  it('row-gloss indexes outside the table rows are dropped', async () => {
    const deps = makeDeps({ tables: [table('T-idx', {}, GUARD_BODY)] });
    deps.llm.mockResolvedValue({
      content: JSON.stringify({
        intent: 'Loads the latest view.',
        rowGlosses: [{ index: 7, gloss: 'Ghost row.' }],
        fragmentName: 'Latest view',
      }),
    });

    const summary = await runSclAnnotationPass(RUN, deps);
    expect(summary.annotated).toBe(1);
    expect(summary.guard_rejections).toBe(1);
    const glossJson = deps.patchGloss.mock.calls[0][4];
    expect(glossJson.row_glosses).toEqual({});
    expect(glossJson.guard_findings[0].kind).toBe('gloss_rejected_invalid_index');
  });
});

// ---------------------------------------------------------------------------
// 3. Malformed JSON → one retry
// ---------------------------------------------------------------------------

describe('runSclAnnotationPass — parse retry', () => {
  it('retries once on malformed JSON, then succeeds', async () => {
    const deps = makeDeps({ tables: [table('T-1')] });
    deps.llm
      .mockResolvedValueOnce({ content: 'this is not json at all' })
      .mockResolvedValueOnce({ content: VALID_ANNOTATION });

    const summary = await runSclAnnotationPass(RUN, deps);

    expect(deps.llm).toHaveBeenCalledTimes(2);
    expect(deps.patchGloss).toHaveBeenCalledTimes(1);
    expect(summary.annotated).toBe(1);
    expect(summary.rejected).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 4. Contradiction pass (deterministic, no LLM)
// ---------------------------------------------------------------------------

describe('runSclAnnotationPass — contradiction pass', () => {
  const NO_FAILURE_TABLE = table(
    'T-http',
    { gloss_json: { intent: 'done' }, source_symbol: 'ViewResource#getView' },
    {
      annotations: ['@GET', '@Path("/views/{viewId}")'],
      rows: [{ condition: 'always', outcome: 'value: view' }],
    }
  );
  const FAILURE_TABLE = table(
    'T-abs',
    { gloss_json: { intent: 'done' }, source_symbol: 'ThingResource#list' },
    {
      annotations: ['@GET', '@Path("/things")'],
      rows: [
        { condition: 'found', outcome: 'value: things' },
        { condition: 'else', outcome: 'throws: NotFoundException' },
      ],
    }
  );

  it('flags capture 5xx vs no mined failure outcome, and never-observed mined failures', async () => {
    const deps = makeDeps({
      tables: [NO_FAILURE_TABLE, FAILURE_TABLE],
      baseline: { id: 'b1' },
      items: [
        { method: 'GET', path: '/views/123', response_status: 200 },
        { method: 'GET', path: '/views/999', response_status: 503 },
        { method: 'GET', path: '/things', response_status: 200 },
        { method: 'GET', path: '/things', response_status: 200 },
        { method: 'GET', path: '/things', response_status: 200 },
      ],
    });

    const summary = await runSclAnnotationPass(RUN, deps);

    expect(deps.llm).not.toHaveBeenCalled(); // both already glossed
    expect(summary.baseline_available).toBe(true);
    expect(summary.contradictions).toHaveLength(2);
    expect(summary.contradictions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'capture_contradiction',
          detail: 'capture shows 5xx but mined behaviour has no failure outcome',
          symbol: 'ViewResource#getView',
        }),
        expect.objectContaining({
          kind: 'capture_contradiction',
          detail: 'mined failure outcomes never observed in capture',
          symbol: 'ThingResource#list',
        }),
      ])
    );
    // Contradictions ride into the merged stats PATCH.
    const stats = deps.patchScan.mock.calls[0][3];
    expect(stats.scl_annotation.contradictions).toHaveLength(2);
    expect(stats.scl_annotation.baseline_available).toBe(true);
  });

  it('mined failures with fewer than 3 captured items are NOT flagged', async () => {
    const deps = makeDeps({
      tables: [FAILURE_TABLE],
      baseline: { id: 'b1' },
      items: [
        { method: 'GET', path: '/things', response_status: 200 },
        { method: 'GET', path: '/things', response_status: 200 },
      ],
    });
    const summary = await runSclAnnotationPass(RUN, deps);
    expect(summary.contradictions).toHaveLength(0);
  });

  it('no active baseline ⇒ baseline_available false, zero contradictions, no item fetch', async () => {
    const deps = makeDeps({ tables: [NO_FAILURE_TABLE], baseline: null });
    const summary = await runSclAnnotationPass(RUN, deps);
    expect(summary.baseline_available).toBe(false);
    expect(summary.contradictions).toHaveLength(0);
    expect(deps.fetchBaselineItems).not.toHaveBeenCalled();
    const stats = deps.patchScan.mock.calls[0][3];
    expect(stats.scl_annotation.baseline_available).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. Failure isolation
// ---------------------------------------------------------------------------

describe('runSclAnnotationPass — failure isolation', () => {
  it('a terminally-failing contract yields annotation_failed; the rest still process', async () => {
    const deps = makeDeps({ tables: [table('T-bad'), table('T-good')] });
    deps.llm.mockImplementation(async ({ userPrompt }: { userPrompt: string }) => {
      if (userPrompt.includes('Contract T-bad')) throw new Error('boom');
      return { content: VALID_ANNOTATION };
    });

    const summary = await runSclAnnotationPass(RUN, deps);

    expect(summary.annotated).toBe(1);
    expect(summary.rejected).toBe(1);
    expect(summary.findings).toEqual([
      expect.objectContaining({ kind: 'annotation_failed', contract_key: 'T-bad' }),
    ]);
    expect(deps.patchGloss).toHaveBeenCalledTimes(1);
    expect(deps.patchGloss.mock.calls[0][3]).toBe('T-good');
    // The run completes: stats still PATCHed with the honest counts.
    expect(deps.patchScan).toHaveBeenCalledTimes(1);
    const stats = deps.patchScan.mock.calls[0][3];
    expect(stats.scl_annotation.rejected).toBe(1);
    expect(stats.scl_annotation.findings).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// stableStringify — the guard reference string is deterministic
// ---------------------------------------------------------------------------

describe('stableStringify', () => {
  it('sorts object keys recursively', () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: [3, null] } })).toBe(
      '{"a":{"c":[3,null],"d":2},"b":1}'
    );
  });
});
