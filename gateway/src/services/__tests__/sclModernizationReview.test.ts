/**
 * SCL modernization review + confirm (spec 5, 2026-08-18) — fully mocked deps:
 *
 *  1. review merges LLM proposals ONLY for requested froms (the guard drops
 *     unrequested proposals);
 *  2. LLM failure is fail-soft — unmapped rows stay unmapped;
 *  3. confirm persists via the mocked EXISTING decisions write path with the
 *     exact decisionCode / answerValue / answerSummary / scopeKind shapes;
 *  4. invalid rows are rejected whole, listing every offender;
 *  5. existing modernize.* decisions surface in the review (non-modernize
 *     decisions filtered out);
 *  6. no scan -> SclModernizationNoScanError;  per-row persist failures are
 *     collected, never partial-silent.
 */

jest.mock('../logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { SclContractWire } from '../sclAnnotationPass';
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
    ...overrides,
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
  });

  it('keeps unmapped rows unmapped when the LLM call fails (fail-soft)', async () => {
    const deps = makeDeps({ llm: jest.fn().mockRejectedValue(new Error('rate limited')) });

    const review = await buildModernizationReview(ARGS, deps);

    const money = review.rows.find((r) => r.from === 'com.thirdparty.Money');
    expect(money?.provenance).toBe('unmapped');
    expect(money?.defaultTo).toBeNull();
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

    await buildModernizationReview(ARGS, deps);
    expect(deps.llm).not.toHaveBeenCalled();
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
    expect(offenders.map((o) => o.index)).toEqual([0, 1]);
    expect(offenders[0].reason).toContain("must start with 'modernize.'");
    expect(offenders[1].reason).toContain('non-empty');
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
