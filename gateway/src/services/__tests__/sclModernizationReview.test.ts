/**
 * SCL modernization review + confirm (spec 5, 2026-08-18) — fully mocked deps:
 *
 *  1. review merges LLM proposals ONLY for requested froms (the guard drops
 *     unrequested proposals);
 *  2. LLM failure is fail-soft for the RENDER but LOUD on the wire
 *     (2026-08-30: proposalPass.status 'failed' — a failed pass previously
 *     rendered as legitimate-looking "needs a value" rows);
 *  3. confirm persists via the mocked EXISTING decisions write path with the
 *     exact decisionCode / answerValue / answerSummary / scopeKind shapes;
 *  4. invalid rows are rejected whole, listing every offender;
 *  5. existing modernize.* decisions surface in the review (non-modernize
 *     decisions filtered out);
 *  6. no scan -> SclModernizationNoScanError;  per-row persist failures are
 *     collected, never partial-silent;
 *  7. proposal determinism (2026-08-30): generated proposals persist into the
 *     scan's stats_json (merge-spread) and REPLAY on later loads without an
 *     LLM call; regenerate bypasses the cache and re-persists; a failed
 *     regenerate replays the surviving cache (defaults never vanish).
 */

jest.mock('../logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { SclContractWire } from '../sclAnnotationPass';
import { logger as mockedLogger } from '../logger';
import {
  buildModernizationReview,
  confirmModernizationDecisions,
  SclModernizationDeps,
  SclModernizationNoScanError,
  SclModernizationValidationError,
} from '../sclModernizationReview';
import { CreateCapturedDecisionRequestBody } from '../architectConversation/targetStateCapturedDecisionsWriter';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** One mapped joda field + one UNMAPPED third-party type (Money). */
const SHAPES: SclContractWire[] = [
  {
    contract_key: 'S-booking',
    kind: 'shape',
    source_path: 'src/Booking.java',
    source_symbol: 'Booking',
    fan_in: 1,
    roots_json: { roots: [] },
    body_json: {
      fields: [
        { name: 'when', kind: 'date', sourceCarrier: 'org.joda.time.LocalDate' },
        { name: 'amount', kind: 'decimal', sourceCarrier: 'com.thirdparty.Money' },
      ],
    },
    gloss_json: null,
  },
];

const MODERNIZE_DECISION = {
  decisionId: 'd-1',
  projectId: 'p1',
  targetArchitectureId: 'target-1',
  decisionCode: 'modernize.dates.joda-localdate',
  scopeKind: 'architecture',
  answerValue: '{"from":"org.joda.time.LocalDate","to":"java.time.LocalDate"}',
  answerSummary: 'org.joda.time.LocalDate -> java.time.LocalDate',
  createdAt: '2026-08-18T00:00:00Z',
  createdByTask: 'scl-modernization-review',
};

const OTHER_DECISION = {
  ...MODERNIZE_DECISION,
  decisionId: 'd-2',
  decisionCode: 'service.language',
  answerValue: 'java21',
};

interface MockDeps extends SclModernizationDeps {
  fetchLatestScan: jest.Mock;
  fetchContracts: jest.Mock;
  resolveTargetArchitectureId: jest.Mock;
  fetchDecisions: jest.Mock;
  postDecision: jest.Mock;
  llm: jest.Mock;
  patchScan: jest.Mock;
}

function makeDeps(overrides: Partial<MockDeps> = {}): MockDeps {
  return {
    fetchLatestScan: jest.fn().mockResolvedValue({ id: 'scan-1', status: 'completed', stats_json: {} }),
    fetchContracts: jest.fn().mockImplementation(async (_p, _a, _s, kind: string) => {
      if (kind === 'shape') return SHAPES;
      return [];
    }),
    resolveTargetArchitectureId: jest.fn().mockResolvedValue('target-1'),
    fetchDecisions: jest.fn().mockResolvedValue([MODERNIZE_DECISION, OTHER_DECISION]),
    postDecision: jest.fn().mockResolvedValue({}),
    llm: jest.fn().mockResolvedValue({ content: '[]' }),
    patchScan: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

/** A scan whose stats_json carries a cached proposal set for Money (plus a
 * sibling stats key that any persist must preserve via merge-spread). */
function scanWithCachedProposals() {
  return {
    id: 'scan-1',
    status: 'completed',
    stats_json: {
      near_duplicate_cluster: [{ keep: 'x' }],
      modernization_proposals: {
        generated_at: '2026-08-29T09:00:00Z',
        proposals: [
          {
            from: 'com.thirdparty.Money',
            proposed_to: 'javax.money.MonetaryAmount',
            rationale: 'cached earlier',
          },
          {
            from: 'com.never.Requested',
            proposed_to: 'java.lang.Object',
            rationale: 'stale hallucination — the apply guard must drop it',
          },
        ],
      },
    },
  };
}

const ARGS = { projectId: 'p1', architectureId: 'arch-1' };

// ---------------------------------------------------------------------------
// 1 + 2. LLM proposal merge + guard + fail-soft
// ---------------------------------------------------------------------------

describe('buildModernizationReview — LLM proposals', () => {
  it('merges proposals for requested froms only; unrequested proposals are dropped', async () => {
    const deps = makeDeps({
      llm: jest.fn().mockResolvedValue({
        content: JSON.stringify([
          {
            from: 'com.thirdparty.Money',
            proposedTo: 'java.math.BigDecimal',
            rationale: 'Exact-scale decimal carrier in the JDK.',
          },
          {
            from: 'com.never.Requested',
            proposedTo: 'java.lang.Object',
            rationale: 'hallucinated — must be dropped',
          },
        ]),
      }),
    });

    const review = await buildModernizationReview(ARGS, deps);

    // ONE batched call; the mapped joda row was NOT sent to the LLM.
    expect(deps.llm).toHaveBeenCalledTimes(1);
    const prompt = deps.llm.mock.calls[0][0].userPrompt as string;
    expect(prompt).toContain('com.thirdparty.Money');
    expect(prompt).not.toContain('org.joda.time.LocalDate');

    const money = review.rows.find((r) => r.from === 'com.thirdparty.Money');
    expect(money?.provenance).toBe('llm_proposed');
    expect(money?.defaultTo).toBe('java.math.BigDecimal');
    expect(money?.proposalRationale).toBe('Exact-scale decimal carrier in the JDK.');

    // The unrequested from never landed anywhere.
    expect(review.rows.some((r) => r.from === 'com.never.Requested')).toBe(false);
    expect(review.rows.some((r) => r.defaultTo === 'java.lang.Object')).toBe(false);

    // Ruleset default untouched.
    const joda = review.rows.find((r) => r.from === 'org.joda.time.LocalDate');
    expect(joda?.provenance).toBe('ruleset_default');
    expect(joda?.defaultTo).toBe('java.time.LocalDate');

    // 2026-08-30: the pass reports ok/generated on the wire...
    expect(review.proposalPass).toMatchObject({
      status: 'ok',
      source: 'generated',
      eligible: 1,
      proposed: 1,
      error: null,
    });
    // ...and PERSISTS the set per scan (snake_case, merge-spread of stats).
    expect(deps.patchScan).toHaveBeenCalledTimes(1);
    const [pProj, pArch, pScan, statsJson] = deps.patchScan.mock.calls[0] as [
      string,
      string,
      string,
      Record<string, unknown>,
    ];
    expect([pProj, pArch, pScan]).toEqual(['p1', 'arch-1', 'scan-1']);
    const cache = statsJson.modernization_proposals as {
      generated_at: string;
      proposals: Array<Record<string, unknown>>;
    };
    expect(typeof cache.generated_at).toBe('string');
    expect(cache.proposals).toEqual([
      {
        from: 'com.thirdparty.Money',
        proposed_to: 'java.math.BigDecimal',
        rationale: 'Exact-scale decimal carrier in the JDK.',
      },
      {
        from: 'com.never.Requested',
        proposed_to: 'java.lang.Object',
        rationale: 'hallucinated — must be dropped',
      },
    ]);
  });

  it('LLM failure keeps rows unmapped but is LOUD on the wire (failed/none), nothing persisted', async () => {
    const deps = makeDeps({ llm: jest.fn().mockRejectedValue(new Error('rate limited')) });

    const review = await buildModernizationReview(ARGS, deps);

    const money = review.rows.find((r) => r.from === 'com.thirdparty.Money');
    expect(money?.provenance).toBe('unmapped');
    expect(money?.defaultTo).toBeNull();
    // 2026-08-30: no more silent fail-soft — the wire names the failure.
    expect(review.proposalPass).toMatchObject({
      status: 'failed',
      source: 'none',
      eligible: 1,
      proposed: 0,
      error: 'rate limited',
    });
    expect(deps.patchScan).not.toHaveBeenCalled();
  });

  it('a proposal PARSE failure logs the raw LLM response shape (diagnostic) and stays failed/none', async () => {
    // A TRUNCATED completion (token cap): the array opens but never closes,
    // so the parser finds no JSON array. The markers make that readable.
    const wrapped = '[{"from": "com.thirdparty.Money", "to": "java.math.BigDec';
    const deps = makeDeps({ llm: jest.fn().mockResolvedValue({ content: wrapped }) });

    const review = await buildModernizationReview(ARGS, deps);

    const diag = (mockedLogger.warn as jest.Mock).mock.calls.find(
      (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('proposal parse FAILED')
    );
    expect(diag).toBeDefined();
    expect(diag![1]).toMatchObject({
      requestedCount: 1,
      contentLength: wrapped.length,
      startsWithBrace: false,
      startsWithBracket: true,
      hasOpenBracket: true,
      hasCloseBracket: false,
      contentHead: wrapped,
      contentTail: '',
    });
    expect((diag![1] as { parseError: unknown }).parseError).toBe('LLM response contained no JSON array');
    expect(deps.patchScan).not.toHaveBeenCalled();
  });

  it('REPLAYS the cached per-scan proposals without an LLM call (deterministic loads)', async () => {
    const deps = makeDeps({
      fetchLatestScan: jest.fn().mockResolvedValue(scanWithCachedProposals()),
    });

    const review = await buildModernizationReview(ARGS, deps);

    expect(deps.llm).not.toHaveBeenCalled();
    expect(deps.patchScan).not.toHaveBeenCalled();
    const money = review.rows.find((r) => r.from === 'com.thirdparty.Money');
    expect(money?.provenance).toBe('llm_proposed');
    expect(money?.defaultTo).toBe('javax.money.MonetaryAmount');
    expect(money?.proposalRationale).toBe('cached earlier');
    // The apply guard drops the stale unrequested entry on replay too.
    expect(review.rows.some((r) => r.defaultTo === 'java.lang.Object')).toBe(false);
    expect(review.proposalPass).toMatchObject({
      status: 'ok',
      source: 'cache',
      eligible: 1,
      proposed: 1,
      error: null,
      generatedAt: '2026-08-29T09:00:00Z',
    });
  });

  it('regenerateProposals bypasses the cache, re-runs the LLM and re-persists (sibling stats kept)', async () => {
    const deps = makeDeps({
      fetchLatestScan: jest.fn().mockResolvedValue(scanWithCachedProposals()),
      llm: jest.fn().mockResolvedValue({
        content: JSON.stringify([
          {
            from: 'com.thirdparty.Money',
            proposedTo: 'java.math.BigDecimal',
            rationale: 'fresh proposal',
          },
        ]),
      }),
    });

    const review = await buildModernizationReview(
      { ...ARGS, regenerateProposals: true },
      deps
    );

    expect(deps.llm).toHaveBeenCalledTimes(1);
    const money = review.rows.find((r) => r.from === 'com.thirdparty.Money');
    expect(money?.defaultTo).toBe('java.math.BigDecimal');
    expect(review.proposalPass).toMatchObject({ status: 'ok', source: 'generated' });

    // Re-persisted, REPLACING the cache key but keeping sibling stats keys.
    expect(deps.patchScan).toHaveBeenCalledTimes(1);
    const statsJson = deps.patchScan.mock.calls[0][3] as Record<string, unknown>;
    expect(statsJson.near_duplicate_cluster).toEqual([{ keep: 'x' }]);
    const cache = statsJson.modernization_proposals as { proposals: Array<{ from: string }> };
    expect(cache.proposals).toEqual([
      { from: 'com.thirdparty.Money', proposed_to: 'java.math.BigDecimal', rationale: 'fresh proposal' },
    ]);
  });

  it('a FAILED regenerate replays the surviving cache (defaults never vanish)', async () => {
    const deps = makeDeps({
      fetchLatestScan: jest.fn().mockResolvedValue(scanWithCachedProposals()),
      llm: jest.fn().mockRejectedValue(new Error('relay down')),
    });

    const review = await buildModernizationReview(
      { ...ARGS, regenerateProposals: true },
      deps
    );

    const money = review.rows.find((r) => r.from === 'com.thirdparty.Money');
    expect(money?.provenance).toBe('llm_proposed');
    expect(money?.defaultTo).toBe('javax.money.MonetaryAmount');
    expect(review.proposalPass).toMatchObject({
      status: 'failed',
      source: 'cache',
      error: 'relay down',
      generatedAt: '2026-08-29T09:00:00Z',
    });
    expect(deps.patchScan).not.toHaveBeenCalled();
  });

  it('a proposal-cache persist failure downgrades to a warning (fresh proposals still serve)', async () => {
    const deps = makeDeps({
      llm: jest.fn().mockResolvedValue({
        content: JSON.stringify([
          { from: 'com.thirdparty.Money', proposedTo: 'java.math.BigDecimal', rationale: 'r' },
        ]),
      }),
      patchScan: jest.fn().mockRejectedValue(new Error('AMS down')),
    });

    const review = await buildModernizationReview(ARGS, deps);

    const money = review.rows.find((r) => r.from === 'com.thirdparty.Money');
    expect(money?.defaultTo).toBe('java.math.BigDecimal');
    expect(review.proposalPass).toMatchObject({ status: 'ok', source: 'generated' });
  });

  it('skips the LLM entirely when nothing is unmapped', async () => {
    const deps = makeDeps({
      fetchContracts: jest.fn().mockImplementation(async (_p, _a, _s, kind: string) => {
        if (kind === 'shape') {
          return [
            {
              ...SHAPES[0],
              body_json: {
                fields: [{ name: 'when', kind: 'date', sourceCarrier: 'org.joda.time.LocalDate' }],
              },
            },
          ];
        }
        return [];
      }),
    });

    const review = await buildModernizationReview(ARGS, deps);
    expect(deps.llm).not.toHaveBeenCalled();
    expect(review.proposalPass).toMatchObject({
      status: 'ok',
      source: 'none',
      eligible: 0,
      proposed: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// 5 + 6. Existing decisions + no scan
// ---------------------------------------------------------------------------

describe('buildModernizationReview — existing decisions + scan gate', () => {
  it('surfaces only modernize.* decisions for the target architecture', async () => {
    const deps = makeDeps();
    const review = await buildModernizationReview(ARGS, deps);

    expect(deps.fetchDecisions).toHaveBeenCalledWith('p1', 'target-1');
    expect(review.targetArchitectureId).toBe('target-1');
    expect(review.existingDecisions).toHaveLength(1);
    expect(review.existingDecisions[0].decisionCode).toBe('modernize.dates.joda-localdate');
    expect(review.scanId).toBe('scan-1');
  });

  it('renders with empty existingDecisions when no target architecture resolves', async () => {
    const deps = makeDeps({ resolveTargetArchitectureId: jest.fn().mockResolvedValue(null) });
    const review = await buildModernizationReview(ARGS, deps);
    expect(review.targetArchitectureId).toBeNull();
    expect(review.existingDecisions).toEqual([]);
    expect(deps.fetchDecisions).not.toHaveBeenCalled();
  });

  it('throws SclModernizationNoScanError when no scan exists', async () => {
    const deps = makeDeps({ fetchLatestScan: jest.fn().mockResolvedValue(null) });
    await expect(buildModernizationReview(ARGS, deps)).rejects.toBeInstanceOf(
      SclModernizationNoScanError
    );
  });
});

// ---------------------------------------------------------------------------
// 3 + 4 + 6. Confirm: persistence shapes, validation, per-row failures
// ---------------------------------------------------------------------------

const CONFIRM_ROW = {
  code: 'modernize.dates.joda-localdate',
  family: 'dates',
  from: 'org.joda.time.LocalDate',
  to: 'java.time.LocalDate',
  provenance: 'ruleset_default',
  usageCount: 61,
  exampleCites: [{ symbol: 'Booking#getWhen', sourcePath: 'src/Booking.java' }],
};

describe('confirmModernizationDecisions', () => {
  it('persists each row through the existing write path with the exact shapes', async () => {
    const deps = makeDeps();

    const result = await confirmModernizationDecisions(
      { projectId: 'p1', targetArchitectureId: 'target-1', rows: [CONFIRM_ROW] },
      deps
    );

    expect(result).toEqual({ confirmed: 1, failed: [] });
    expect(deps.postDecision).toHaveBeenCalledTimes(1);
    const [projectId, targetArchitectureId, body] = deps.postDecision.mock.calls[0] as [
      string,
      string,
      CreateCapturedDecisionRequestBody,
    ];
    expect(projectId).toBe('p1');
    expect(targetArchitectureId).toBe('target-1');
    expect(body.decisionCode).toBe('modernize.dates.joda-localdate');
    expect(body.scopeKind).toBe('architecture');
    expect(body.answerSummary).toBe('org.joda.time.LocalDate -> java.time.LocalDate');
    expect(body.createdByTask).toBe('scl-modernization-review');
    expect(JSON.parse(body.answerValue)).toEqual({
      from: 'org.joda.time.LocalDate',
      to: 'java.time.LocalDate',
      family: 'dates',
      provenance: 'ruleset_default',
      usage_count: 61,
      example_cites: [{ symbol: 'Booking#getWhen', source_path: 'src/Booking.java' }],
    });
  });

  it('rejects invalid rows whole, listing every offender, and persists nothing', async () => {
    const deps = makeDeps();
    const badRows = [
      { ...CONFIRM_ROW, code: 'not-modernize.something' },
      { ...CONFIRM_ROW, to: '   ' },
      CONFIRM_ROW,
    ];

    let thrown: unknown;
    try {
      await confirmModernizationDecisions(
        { projectId: 'p1', targetArchitectureId: 'target-1', rows: badRows },
        deps
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(SclModernizationValidationError);
    const offenders = (thrown as SclModernizationValidationError).offenders;
    // 2026-08-30 re-pin: rows #1 and #2 share the CONFIRM_ROW code, so the
    // new duplicate-code guard flags #2 as a third offender.
    expect(offenders.map((o) => o.index)).toEqual([0, 1, 2]);
    expect(offenders[0].reason).toContain("must start with 'modernize.'");
    expect(offenders[1].reason).toContain('non-empty');
    expect(offenders[2].reason).toContain('duplicate decision code');
    expect(deps.postDecision).not.toHaveBeenCalled();
  });

  it('rejects DUPLICATE decision codes whole (supersede-by-code would silently drop one)', async () => {
    const deps = makeDeps();
    // Same derived code twice (the Kiro third bug: String vs String[] used
    // to collide) — the store supersedes by code, so the second write would
    // silently replace the first.
    const rows = [CONFIRM_ROW, { ...CONFIRM_ROW, from: 'org.joda.time.LocalDate[]' }];

    let thrown: unknown;
    try {
      await confirmModernizationDecisions(
        { projectId: 'p1', targetArchitectureId: 'target-1', rows },
        deps
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(SclModernizationValidationError);
    const offenders = (thrown as SclModernizationValidationError).offenders;
    expect(offenders).toHaveLength(1);
    expect(offenders[0]).toMatchObject({ index: 1, code: 'modernize.dates.joda-localdate' });
    expect(offenders[0].reason).toContain('duplicate decision code');
    expect(offenders[0].reason).toContain('collides with row #0');
    expect(deps.postDecision).not.toHaveBeenCalled();
  });

  it('collects per-row persistence failures instead of failing silently or wholesale', async () => {
    const deps = makeDeps({
      postDecision: jest
        .fn()
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(new Error('HTTP 422 bad decision code')),
    });
    const rows = [CONFIRM_ROW, { ...CONFIRM_ROW, code: 'modernize.collections.vector' }];

    const result = await confirmModernizationDecisions(
      { projectId: 'p1', targetArchitectureId: 'target-1', rows },
      deps
    );

    expect(result.confirmed).toBe(1);
    expect(result.failed).toEqual([
      { code: 'modernize.collections.vector', error: 'HTTP 422 bad decision code' },
    ]);
  });
});
