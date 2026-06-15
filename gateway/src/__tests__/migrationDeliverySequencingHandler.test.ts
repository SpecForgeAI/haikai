/**
 * Tests for the Migration Delivery Sequencing gateway orchestration handler.
 *
 * Spec: 2026-05-25 PM Tasks Captured Decisions Integration + Delivery Sequencing
 * Task Group 2.1.
 *
 * Verifies the handler's seven test surfaces (cap 4-8):
 *   1. Happy path: POSTs to Spec 2 with the exact write attributes and returns
 *      `{ sequenceId, summary, status='sequenced' }`.
 *   2. No active target architecture: returns insufficient_context +
 *      recommendedNextAction = "Define a target architecture first".
 *   3. No captured decisions: returns insufficient_context +
 *      recommendedNextAction = "Run the architect conversation first".
 *   4. LLM call throws: returns status='failed' with errorMessage.
 *   5. Validator hard fail (unknown initiative id in LLM response): status='failed'
 *      with the validator's error text inline.
 *   6. Token-budget overflow: handler throws TokenBudgetOverflowError when the
 *      combined cascade + decisions block exceeds the soft cap.
 *   7. Re-run path: a second invocation issues a second POST whose body does
 *      NOT carry a `previousDecisionId` parameter (supersession via Spec 2
 *      data plane).
 *
 * All LLM calls are mocked at the gateway's LLM client boundary via the
 * handler's `callLlm` dep.
 */

import {
  generateMigrationDeliverySequencing,
  TokenBudgetOverflowError,
  buildSequencingUserPrompt,
  LoadedBookOfWorkForSequencing,
} from '../services/migrationDeliverySequencingHandler';
import { MigrationDiscoveryContext } from '../services/migrationDiscoveryContextClient';
import { TargetStateCapturedDecision } from '../services/targetStateCapturedDecisionsClient';
import { MIGRATION_BOOK_OF_WORK_TOKEN_SOFT_CAP } from '../services/migrationBookOfWorkHandler';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeDiscoveryContext(
  overrides: Partial<MigrationDiscoveryContext> = {}
): MigrationDiscoveryContext {
  return {
    projectId: 'proj-1',
    currentArchitectureId: 'curr-1',
    targetArchitectureId: 'tgt-1',
    generatedAt: '2026-05-25T10:00:00Z',
    summary: 'minimal fixture for sequencing handler tests',
    ...overrides,
  };
}

function makeBookOfWork(): LoadedBookOfWorkForSequencing {
  return {
    bookOfWorkId: 'bow-1',
    projectId: 'proj-1',
    initiativeIds: ['I1', 'I2', 'I3'],
  };
}

function makeDecisions(): TargetStateCapturedDecision[] {
  return [
    {
      decisionId: 'd-1',
      projectId: 'proj-1',
      targetArchitectureId: 'tgt-1',
      decisionCode: 'db.engine',
      scopeKind: 'architecture',
      answerValue: 'Postgres 18',
      answerSummary: 'Postgres 18 chosen for target state',
      createdAt: '2026-05-24T10:00:00Z',
      createdByTask: 'architect-conversation',
    },
    {
      decisionId: 'd-2',
      projectId: 'proj-1',
      targetArchitectureId: 'tgt-1',
      decisionCode: 'service.framework',
      scopeKind: 'architecture',
      answerValue: 'Spring Boot 3',
      answerSummary: 'Spring Boot 3 chosen',
      createdAt: '2026-05-24T10:30:00Z',
      createdByTask: 'architect-conversation',
    },
  ];
}

function makeSequencedLlmResponseJson(): string {
  return JSON.stringify({
    status: 'sequenced',
    confidence: 'high',
    warnings: [],
    initiativeOrder: [
      {
        initiativeId: 'I1',
        sequence: 1,
        parallelisableWith: [],
        blockedBy: [],
        rationale: '[decision:db.engine] Postgres DDL must land first.',
      },
      {
        initiativeId: 'I2',
        sequence: 2,
        parallelisableWith: [],
        blockedBy: ['I1'],
        rationale: '[decision:service.framework] Spring Boot 3 services after DB.',
      },
      {
        initiativeId: 'I3',
        sequence: 3,
        parallelisableWith: ['I2'],
        blockedBy: ['I1'],
        rationale: 'Frontend parallel with services after DB.',
      },
    ],
  });
}

const FIXED_DECISION_ID_1 = 'created-row-id-1';
const FIXED_DECISION_ID_2 = 'created-row-id-2';

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('Migration Delivery Sequencing handler (Spec 2026-05-25, Group 2.1)', () => {
  it('happy path -- POSTs to Spec 2 with the exact write attributes and returns {sequenceId, summary}', async () => {
    const fetchActiveTargetArchitectureId = jest.fn().mockResolvedValue({
      activeTargetArchitectureId: 'tgt-1',
    });
    const fetchLatestCapturedDecisions = jest.fn().mockResolvedValue(makeDecisions());
    const loadBookOfWork = jest.fn().mockResolvedValue(makeBookOfWork());
    const fetchDiscoveryContext = jest.fn().mockResolvedValue(makeDiscoveryContext());
    const callLlm = jest.fn().mockResolvedValue({ content: makeSequencedLlmResponseJson() });
    const postCapturedDecision = jest.fn().mockResolvedValue({
      decisionId: FIXED_DECISION_ID_1,
      projectId: 'proj-1',
      targetArchitectureId: 'tgt-1',
      decisionCode: 'delivery.sequencing',
      scopeKind: 'architecture',
      answerValue: '{}',
      createdAt: '2026-05-25T11:00:00Z',
      createdByTask: 'product-manager--migration-delivery-sequencing',
    });

    const result = await generateMigrationDeliverySequencing(
      {
        projectId: 'proj-1',
        currentArchitectureId: 'curr-1',
        targetArchitectureId: 'tgt-1',
        bookOfWorkId: 'bow-1',
      },
      {
        fetchActiveTargetArchitectureId,
        fetchLatestCapturedDecisions,
        loadBookOfWork,
        fetchDiscoveryContext,
        callLlm,
        postCapturedDecision,
        systemPromptOverride: 'SYS',
      }
    );

    expect(result.status).toBe('sequenced');
    expect(result.sequenceId).toBe(FIXED_DECISION_ID_1);
    expect(typeof result.summary).toBe('string');
    expect(result.summary.length).toBeGreaterThan(0);

    // Exactly one POST.
    expect(postCapturedDecision).toHaveBeenCalledTimes(1);
    const [postProjectId, postTargetId, postBody] = postCapturedDecision.mock.calls[0];
    expect(postProjectId).toBe('proj-1');
    expect(postTargetId).toBe('tgt-1');
    // Verify the exact write attributes per spec.md.
    expect(postBody.decisionCode).toBe('delivery.sequencing');
    expect(postBody.scopeKind).toBe('architecture');
    expect(postBody.createdByTask).toBe('product-manager--migration-delivery-sequencing');
    expect(postBody.conversationThreadId).toBeNull();
    expect(postBody.conversationTurnRef).toBeNull();
    // answerValue is JSON-stringified initiativeOrder.
    const parsedAnswer = JSON.parse(postBody.answerValue);
    expect(Array.isArray(parsedAnswer.initiativeOrder)).toBe(true);
    expect(parsedAnswer.initiativeOrder).toHaveLength(3);
    // postBody must NOT carry a previousDecisionId (supersession via data plane).
    expect(postBody).not.toHaveProperty('previousDecisionId');

    // Single LLM call.
    expect(callLlm).toHaveBeenCalledTimes(1);
  });

  it('returns insufficient_context with "Define a target architecture first" when there is no active target', async () => {
    const fetchActiveTargetArchitectureId = jest.fn().mockResolvedValue({
      activeTargetArchitectureId: null,
    });
    const fetchLatestCapturedDecisions = jest.fn();
    const loadBookOfWork = jest.fn();
    const fetchDiscoveryContext = jest.fn();
    const callLlm = jest.fn();
    const postCapturedDecision = jest.fn();

    const result = await generateMigrationDeliverySequencing(
      {
        projectId: 'proj-1',
        currentArchitectureId: 'curr-1',
        targetArchitectureId: 'tgt-1',
        bookOfWorkId: 'bow-1',
      },
      {
        fetchActiveTargetArchitectureId,
        fetchLatestCapturedDecisions,
        loadBookOfWork,
        fetchDiscoveryContext,
        callLlm,
        postCapturedDecision,
        systemPromptOverride: 'SYS',
      }
    );

    expect(result.status).toBe('insufficient_context');
    expect(result.recommendedNextAction).toBe('Define a target architecture first');
    expect(result.sequenceId).toBeNull();
    // No downstream calls happened.
    expect(fetchLatestCapturedDecisions).not.toHaveBeenCalled();
    expect(loadBookOfWork).not.toHaveBeenCalled();
    expect(callLlm).not.toHaveBeenCalled();
    expect(postCapturedDecision).not.toHaveBeenCalled();
  });

  it('returns insufficient_context with "Run the architect conversation first" when no captured decisions exist', async () => {
    const fetchActiveTargetArchitectureId = jest.fn().mockResolvedValue({
      activeTargetArchitectureId: 'tgt-1',
    });
    const fetchLatestCapturedDecisions = jest.fn().mockResolvedValue([]);
    const loadBookOfWork = jest.fn();
    const fetchDiscoveryContext = jest.fn();
    const callLlm = jest.fn();
    const postCapturedDecision = jest.fn();

    const result = await generateMigrationDeliverySequencing(
      {
        projectId: 'proj-1',
        currentArchitectureId: 'curr-1',
        targetArchitectureId: 'tgt-1',
        bookOfWorkId: 'bow-1',
      },
      {
        fetchActiveTargetArchitectureId,
        fetchLatestCapturedDecisions,
        loadBookOfWork,
        fetchDiscoveryContext,
        callLlm,
        postCapturedDecision,
        systemPromptOverride: 'SYS',
      }
    );

    expect(result.status).toBe('insufficient_context');
    expect(result.recommendedNextAction).toBe('Run the architect conversation first');
    expect(result.sequenceId).toBeNull();
    expect(loadBookOfWork).not.toHaveBeenCalled();
    expect(callLlm).not.toHaveBeenCalled();
    expect(postCapturedDecision).not.toHaveBeenCalled();
  });

  it('returns status=failed when the LLM call throws and never invokes the captured-decisions POST', async () => {
    const callLlm = jest.fn().mockRejectedValue(new Error('upstream LLM 503'));
    const postCapturedDecision = jest.fn();

    const result = await generateMigrationDeliverySequencing(
      {
        projectId: 'proj-1',
        currentArchitectureId: 'curr-1',
        targetArchitectureId: 'tgt-1',
        bookOfWorkId: 'bow-1',
      },
      {
        fetchActiveTargetArchitectureId: jest.fn().mockResolvedValue({
          activeTargetArchitectureId: 'tgt-1',
        }),
        fetchLatestCapturedDecisions: jest.fn().mockResolvedValue(makeDecisions()),
        loadBookOfWork: jest.fn().mockResolvedValue(makeBookOfWork()),
        fetchDiscoveryContext: jest.fn().mockResolvedValue(makeDiscoveryContext()),
        callLlm,
        postCapturedDecision,
        systemPromptOverride: 'SYS',
      }
    );

    expect(result.status).toBe('failed');
    expect(result.errorMessage).toMatch(/upstream LLM 503/);
    expect(postCapturedDecision).not.toHaveBeenCalled();
  });

  it('returns status=failed with validator messages when the LLM emits an unknown initiative id', async () => {
    // LLM emits an initiativeId that is NOT in the loaded book of work.
    const bogusLlmResponse = JSON.stringify({
      status: 'sequenced',
      confidence: 'high',
      warnings: [],
      initiativeOrder: [
        {
          initiativeId: 'I-bogus-not-in-book',
          sequence: 1,
          parallelisableWith: [],
          blockedBy: [],
          rationale: 'made-up initiative',
        },
      ],
    });
    const callLlm = jest.fn().mockResolvedValue({ content: bogusLlmResponse });
    const postCapturedDecision = jest.fn();

    const result = await generateMigrationDeliverySequencing(
      {
        projectId: 'proj-1',
        currentArchitectureId: 'curr-1',
        targetArchitectureId: 'tgt-1',
        bookOfWorkId: 'bow-1',
      },
      {
        fetchActiveTargetArchitectureId: jest.fn().mockResolvedValue({
          activeTargetArchitectureId: 'tgt-1',
        }),
        fetchLatestCapturedDecisions: jest.fn().mockResolvedValue(makeDecisions()),
        loadBookOfWork: jest.fn().mockResolvedValue(makeBookOfWork()),
        fetchDiscoveryContext: jest.fn().mockResolvedValue(makeDiscoveryContext()),
        callLlm,
        postCapturedDecision,
        systemPromptOverride: 'SYS',
      }
    );

    expect(result.status).toBe('failed');
    expect(result.errorMessage).toMatch(/Sequencing response validation failed/);
    expect(result.errorMessage).toMatch(/I-bogus-not-in-book/);
    expect(postCapturedDecision).not.toHaveBeenCalled();
  });

  it('throws TokenBudgetOverflowError when the combined cascade + decisions block exceeds the soft cap', async () => {
    // Build a discovery context that survives the cascade but whose token
    // count plus the decisions-block overhead pushes above the soft cap.
    // The cascade preserves architecture summaries which we deliberately
    // bloat with content that does not match the cascade's truncation steps.
    const bloat: Record<string, string> = {};
    for (let i = 0; i < 90_000; i++) {
      bloat['k' + i] = 'value padded to inflate tokens beyond the 120k soft cap; '.repeat(2);
    }
    const oversized = makeDiscoveryContext({
      // currentArchitectureSummary is in the always-retained set; bloat it so
      // the cascade exhausts and throws.
      currentArchitectureSummary: { ...bloat } as never,
    });

    const result = generateMigrationDeliverySequencing(
      {
        projectId: 'proj-1',
        currentArchitectureId: 'curr-1',
        targetArchitectureId: 'tgt-1',
        bookOfWorkId: 'bow-1',
      },
      {
        fetchActiveTargetArchitectureId: jest.fn().mockResolvedValue({
          activeTargetArchitectureId: 'tgt-1',
        }),
        fetchLatestCapturedDecisions: jest.fn().mockResolvedValue(makeDecisions()),
        loadBookOfWork: jest.fn().mockResolvedValue(makeBookOfWork()),
        fetchDiscoveryContext: jest.fn().mockResolvedValue(oversized),
        callLlm: jest.fn(),
        postCapturedDecision: jest.fn(),
        systemPromptOverride: 'SYS',
      }
    );

    await expect(result).rejects.toBeInstanceOf(TokenBudgetOverflowError);
  });

  it('re-run path -- second POST does NOT carry a previousDecisionId parameter (supersession via data plane)', async () => {
    const sequencedLlmResponse = makeSequencedLlmResponseJson();
    const postCapturedDecision = jest
      .fn()
      .mockResolvedValueOnce({
        decisionId: FIXED_DECISION_ID_1,
        projectId: 'proj-1',
        targetArchitectureId: 'tgt-1',
        decisionCode: 'delivery.sequencing',
        scopeKind: 'architecture',
        answerValue: '{}',
        createdAt: '2026-05-25T11:00:00Z',
        createdByTask: 'product-manager--migration-delivery-sequencing',
      })
      .mockResolvedValueOnce({
        decisionId: FIXED_DECISION_ID_2,
        projectId: 'proj-1',
        targetArchitectureId: 'tgt-1',
        decisionCode: 'delivery.sequencing',
        scopeKind: 'architecture',
        answerValue: '{}',
        createdAt: '2026-05-25T12:00:00Z',
        createdByTask: 'product-manager--migration-delivery-sequencing',
      });

    const sharedDeps = {
      fetchActiveTargetArchitectureId: jest.fn().mockResolvedValue({
        activeTargetArchitectureId: 'tgt-1',
      }),
      fetchLatestCapturedDecisions: jest.fn().mockResolvedValue(makeDecisions()),
      loadBookOfWork: jest.fn().mockResolvedValue(makeBookOfWork()),
      fetchDiscoveryContext: jest.fn().mockResolvedValue(makeDiscoveryContext()),
      callLlm: jest.fn().mockResolvedValue({ content: sequencedLlmResponse }),
      postCapturedDecision,
      systemPromptOverride: 'SYS',
    };

    // First run.
    const firstResult = await generateMigrationDeliverySequencing(
      {
        projectId: 'proj-1',
        currentArchitectureId: 'curr-1',
        targetArchitectureId: 'tgt-1',
        bookOfWorkId: 'bow-1',
      },
      sharedDeps
    );
    expect(firstResult.status).toBe('sequenced');
    expect(firstResult.sequenceId).toBe(FIXED_DECISION_ID_1);

    // Second run -- supersession path.
    const secondResult = await generateMigrationDeliverySequencing(
      {
        projectId: 'proj-1',
        currentArchitectureId: 'curr-1',
        targetArchitectureId: 'tgt-1',
        bookOfWorkId: 'bow-1',
      },
      sharedDeps
    );
    expect(secondResult.status).toBe('sequenced');
    expect(secondResult.sequenceId).toBe(FIXED_DECISION_ID_2);

    // Two POSTs total. Neither body carries `previousDecisionId`.
    expect(postCapturedDecision).toHaveBeenCalledTimes(2);
    for (const call of postCapturedDecision.mock.calls) {
      const body = call[2];
      expect(body).not.toHaveProperty('previousDecisionId');
      expect(body.decisionCode).toBe('delivery.sequencing');
      expect(body.createdByTask).toBe('product-manager--migration-delivery-sequencing');
      expect(body.conversationThreadId).toBeNull();
      expect(body.conversationTurnRef).toBeNull();
    }
  });

  it('user prompt builder includes the captured-decisions block AFTER the discovery context (post-cascade placement)', () => {
    const bookOfWork = makeBookOfWork();
    const decisions = makeDecisions();
    const text = buildSequencingUserPrompt(
      bookOfWork.bookOfWorkId,
      bookOfWork.initiativeIds,
      makeDiscoveryContext(),
      decisions
    );
    expect(text).toContain('BOOK OF WORK ID: bow-1');
    expect(text).toContain('MIGRATION DISCOVERY CONTEXT');
    expect(text).toContain('TARGET STATE CAPTURED DECISIONS');
    // Decisions block must appear AFTER the discovery context block.
    expect(text.indexOf('TARGET STATE CAPTURED DECISIONS')).toBeGreaterThan(
      text.indexOf('MIGRATION DISCOVERY CONTEXT')
    );
    // Each captured-decision code is referenced.
    expect(text).toContain('db.engine');
    expect(text).toContain('service.framework');
    // Sanity: the soft cap is a positive number (smoke-test the import).
    expect(MIGRATION_BOOK_OF_WORK_TOKEN_SOFT_CAP).toBeGreaterThan(0);
  });
});
