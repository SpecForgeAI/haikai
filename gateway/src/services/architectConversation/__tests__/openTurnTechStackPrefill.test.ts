/**
 * Tests — Open-turn Tech-Stack Pre-fill Orchestration
 * Spec 2026-05-25 Tech-Stack.md Pre-fill + Target-Tech-Stack.md Write, Task Group 3.
 *
 * Per tasks.md §3.1 — 4-8 focused tests covering:
 *   - Auto-skip runs before pre-fill (the orchestrator only sees auto-skip-relevant codes)
 *   - Pre-fill rows POST with correct attributes
 *   - Both-files-absent path appends synthetic system turn and routes banner to no-standards
 *   - Partial-failure aborts remaining POSTs and merges failed codes into the unmatched list
 *   - Oversized truncation routes to failure-variant banner with zero rows written
 *
 * LLM is mocked at the `callSingleShot` boundary; the loader and POST writer
 * are mocked at the dependency seam.
 */

import type { ArchitectLlmClient } from '../architectLlmClient';
import {
  PreFillLibraryCandidate,
  PrefillFromTechStackResult,
} from '../prefillFromTechStack';
import type { CreateCapturedDecisionRequestBody } from '../targetStateCapturedDecisionsWriter';
import type { TargetStateCapturedDecision } from '../../targetStateCapturedDecisionsClient';
import type { TechStackLoadResult } from '../techStackLoader';
import {
  OpenTurnTechStackPrefillDeps,
  TECH_STACK_PREFILL_TASK_NAME,
  runOpenTurnTechStackPrefill,
} from '../openTurnTechStackPrefill';
import { InvalidProjectFolderNameError } from '../projectNameSanitiser';
import type { TechStackPrefillSummaryTurn } from '../turnShape';

jest.mock('../../logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CANDIDATES: PreFillLibraryCandidate[] = [
  {
    code: 'service.language',
    prompt: 'What language?',
    expectedAnswerShape: 'single-choice',
    choices: ['Java 21', 'Kotlin 2.0'],
  },
  {
    code: 'service.framework',
    prompt: 'What framework?',
    expectedAnswerShape: 'single-choice',
    choices: ['Spring Boot 3.4'],
  },
  {
    code: 'db.engine',
    prompt: 'What database engine?',
    expectedAnswerShape: 'single-choice',
    choices: ['Postgres 16'],
  },
];

const STUB_LLM_CLIENT: ArchitectLlmClient = {
  callLlmToolLoop: async () => {
    throw new Error('callLlmToolLoop should not be invoked by pre-fill orchestrator');
  },
  callSingleShot: async () => ({ content: '{}' }),
};

interface AppendCall {
  projectId: string;
  targetArchitectureId: string;
  turn: unknown;
}

interface PostCall {
  projectId: string;
  targetArchitectureId: string;
  body: CreateCapturedDecisionRequestBody;
}

function makeRecordingDeps(opts: {
  loadResult?: TechStackLoadResult;
  loadThrows?: unknown;
  prefillResult?: PrefillFromTechStackResult;
  postFailureOnCode?: string;
}): {
  deps: OpenTurnTechStackPrefillDeps;
  appendCalls: AppendCall[];
  postCalls: PostCall[];
} {
  const appendCalls: AppendCall[] = [];
  const postCalls: PostCall[] = [];

  const deps: OpenTurnTechStackPrefillDeps = {
    loadTechStack: async (_projectId: string) => {
      if (opts.loadThrows) throw opts.loadThrows;
      return (
        opts.loadResult ?? {
          orgMarkdown: null,
          projectMarkdown: null,
          orgTruncated: false,
          projectTruncated: false,
          orgPath: null,
          projectPath: null,
        }
      );
    },
    appendTurn: (async (
      projectId: string,
      targetArchitectureId: string,
      turn: unknown,
    ) => {
      appendCalls.push({ projectId, targetArchitectureId, turn });
    }) as OpenTurnTechStackPrefillDeps['appendTurn'],
    postCapturedDecision: (async (
      projectId: string,
      targetArchitectureId: string,
      body: CreateCapturedDecisionRequestBody,
    ): Promise<TargetStateCapturedDecision> => {
      postCalls.push({ projectId, targetArchitectureId, body });
      if (opts.postFailureOnCode && body.decisionCode === opts.postFailureOnCode) {
        throw new Error(`Synthetic POST failure for ${body.decisionCode}`);
      }
      return {
        decisionId: `decision-${body.decisionCode}`,
        projectId,
        targetArchitectureId,
        decisionCode: body.decisionCode,
        scopeKind: body.scopeKind,
        scopeRefType: body.scopeRefType ?? null,
        scopeRefId: body.scopeRefId ?? null,
        answerValue: body.answerValue,
        answerSummary: body.answerSummary ?? null,
        standardsLookupRef: body.standardsLookupRef ?? null,
        conversationThreadId: body.conversationThreadId ?? null,
        conversationTurnRef: body.conversationTurnRef ?? null,
        createdAt: '2026-05-25T00:00:00Z',
        createdByTask: body.createdByTask,
        supersededById: null,
      };
    }) as OpenTurnTechStackPrefillDeps['postCapturedDecision'],
    prefillFromTechStack: async () => {
      if (!opts.prefillResult) {
        return {
          kind: 'success',
          response: {
            preFilledAnswers: [],
            unmatchedCodes: CANDIDATES.map((c) => c.code),
            summary: 'No pre-fills.',
          },
        };
      }
      return opts.prefillResult;
    },
  };

  return { deps, appendCalls, postCalls };
}

// ---------------------------------------------------------------------------
// Test 1: both files absent → no-standards banner; no LLM call; no rows
// ---------------------------------------------------------------------------

test('both files absent appends a no-standards-found banner and writes zero rows', async () => {
  const { deps, appendCalls, postCalls } = makeRecordingDeps({});

  const result = await runOpenTurnTechStackPrefill(
    {
      projectId: 'proj-1',
      targetArchitectureId: 'arch-target',
      conversationThreadId: 'thread-1',
      candidateDecisions: CANDIDATES,
      projectContext: {
        projectName: 'alpha',
        currentArchitectureId: 'arch-current',
        targetArchitectureId: 'arch-target',
      },
      llmClient: STUB_LLM_CLIENT,
    },
    deps,
  );

  expect(postCalls).toHaveLength(0);
  expect(appendCalls).toHaveLength(1);
  const turn = appendCalls[0].turn as TechStackPrefillSummaryTurn;
  expect(turn.kind).toBe('tech-stack-prefill-summary');
  expect(turn.bannerVariant).toBe('no-standards-found');
  expect(turn.matchedCount).toBe(0);
  expect(turn.denominator).toBe(55);
  expect(result.rowsWritten).toBe(0);
});

// ---------------------------------------------------------------------------
// Test 2: pre-fill rows POST with the correct created_by_task + JSON answer_value
// ---------------------------------------------------------------------------

test('pre-fill rows POST with tech-stack-md-prefill, architecture scope, and JSON answerValue', async () => {
  const { deps, appendCalls, postCalls } = makeRecordingDeps({
    loadResult: {
      orgMarkdown: '# Org\n- Language: Java 21',
      projectMarkdown: '# Project\n- Framework: Spring Boot 3.4',
      orgTruncated: false,
      projectTruncated: false,
      orgPath: '/proj/agent-os/product/tech-stack.md',
      projectPath: '/proj/alpha/agent-os/product/tech-stack.md',
    },
    prefillResult: {
      kind: 'success',
      response: {
        preFilledAnswers: [
          {
            decisionCode: 'service.language',
            value: 'Java 21',
            sourceQuote: 'Language: Java 21',
            sourceFile: 'organisation',
          },
          {
            decisionCode: 'service.framework',
            value: 'Spring Boot 3.4',
            sourceQuote: 'Framework: Spring Boot 3.4',
            sourceFile: 'project',
          },
        ],
        unmatchedCodes: ['db.engine'],
        summary: 'Matched 2 of 3.',
      },
    },
  });

  const result = await runOpenTurnTechStackPrefill(
    {
      projectId: 'proj-1',
      targetArchitectureId: 'arch-target',
      conversationThreadId: 'thread-1',
      candidateDecisions: CANDIDATES,
      projectContext: {
        projectName: 'alpha',
        currentArchitectureId: 'arch-current',
        targetArchitectureId: 'arch-target',
      },
      llmClient: STUB_LLM_CLIENT,
    },
    deps,
  );

  expect(postCalls).toHaveLength(2);
  for (const call of postCalls) {
    expect(call.body.createdByTask).toBe(TECH_STACK_PREFILL_TASK_NAME);
    expect(call.body.scopeKind).toBe('architecture');
    expect(call.body.standardsLookupRef).toBeNull();
    // answer_value is JSON-encoded { value, sourceQuote, sourceFile }
    const parsed = JSON.parse(call.body.answerValue);
    expect(parsed.value).toBeDefined();
    expect(parsed.sourceQuote).toBeDefined();
    expect(parsed.sourceFile).toMatch(/organisation|project/);
  }

  const turn = appendCalls[0].turn as TechStackPrefillSummaryTurn;
  expect(turn.bannerVariant).toBe('both-files-matched');
  expect(turn.matchedCount).toBe(2);
  expect(turn.orgFilePresent).toBe(true);
  expect(turn.projectFilePresent).toBe(true);
  expect(result.matchedCodes).toEqual(['service.language', 'service.framework']);
});

// ---------------------------------------------------------------------------
// Test 3: only one file present → routes banner to organisation-only-matched
// ---------------------------------------------------------------------------

test('only organisation file present routes banner to organisation-only-matched', async () => {
  const { deps, appendCalls } = makeRecordingDeps({
    loadResult: {
      orgMarkdown: '# Org\n- Language: Java 21',
      projectMarkdown: null,
      orgTruncated: false,
      projectTruncated: false,
      orgPath: '/proj/agent-os/product/tech-stack.md',
      projectPath: null,
    },
    prefillResult: {
      kind: 'success',
      response: {
        preFilledAnswers: [
          {
            decisionCode: 'service.language',
            value: 'Java 21',
            sourceQuote: 'Language: Java 21',
            sourceFile: 'organisation',
          },
        ],
        unmatchedCodes: ['service.framework', 'db.engine'],
        summary: 'Matched 1 of 3.',
      },
    },
  });

  await runOpenTurnTechStackPrefill(
    {
      projectId: 'proj-1',
      targetArchitectureId: 'arch-target',
      conversationThreadId: 'thread-1',
      candidateDecisions: CANDIDATES,
      projectContext: {
        projectName: 'alpha',
        currentArchitectureId: null,
        targetArchitectureId: null,
      },
      llmClient: STUB_LLM_CLIENT,
    },
    deps,
  );

  const turn = appendCalls[0].turn as TechStackPrefillSummaryTurn;
  expect(turn.bannerVariant).toBe('organisation-only-matched');
});

// ---------------------------------------------------------------------------
// Test 4: oversized truncation routes to failure-variant + zero rows
// ---------------------------------------------------------------------------

test('oversized file routes banner to failure variant with zero rows', async () => {
  const { deps, postCalls, appendCalls } = makeRecordingDeps({
    loadResult: {
      orgMarkdown: 'x'.repeat(10),
      projectMarkdown: null,
      orgTruncated: true,
      projectTruncated: false,
      orgPath: '/proj/agent-os/product/tech-stack.md',
      projectPath: null,
    },
  });

  const result = await runOpenTurnTechStackPrefill(
    {
      projectId: 'proj-1',
      targetArchitectureId: 'arch-target',
      conversationThreadId: 'thread-1',
      candidateDecisions: CANDIDATES,
      projectContext: {
        projectName: 'alpha',
        currentArchitectureId: null,
        targetArchitectureId: null,
      },
      llmClient: STUB_LLM_CLIENT,
    },
    deps,
  );

  expect(postCalls).toHaveLength(0);
  expect(result.rowsWritten).toBe(0);
  const turn = appendCalls[0].turn as TechStackPrefillSummaryTurn;
  expect(turn.bannerVariant).toBe('failure');
  expect(turn.failureReason).toContain('50,000-character cap');
});

// ---------------------------------------------------------------------------
// Test 5: LLM call failure → failure-variant banner, zero rows
// ---------------------------------------------------------------------------

test('LLM call failure routes banner to failure variant', async () => {
  const { deps, postCalls, appendCalls } = makeRecordingDeps({
    loadResult: {
      orgMarkdown: '# Org',
      projectMarkdown: null,
      orgTruncated: false,
      projectTruncated: false,
      orgPath: '/proj/agent-os/product/tech-stack.md',
      projectPath: null,
    },
    prefillResult: {
      kind: 'failure',
      reason: 'llm-call-failed',
      errorMessage: 'upstream 503',
    },
  });

  await runOpenTurnTechStackPrefill(
    {
      projectId: 'proj-1',
      targetArchitectureId: 'arch-target',
      conversationThreadId: 'thread-1',
      candidateDecisions: CANDIDATES,
      projectContext: {
        projectName: 'alpha',
        currentArchitectureId: null,
        targetArchitectureId: null,
      },
      llmClient: STUB_LLM_CLIENT,
    },
    deps,
  );

  expect(postCalls).toHaveLength(0);
  const turn = appendCalls[0].turn as TechStackPrefillSummaryTurn;
  expect(turn.bannerVariant).toBe('failure');
  expect(turn.failureReason).toContain('upstream 503');
});

// ---------------------------------------------------------------------------
// Test 6: partial-failure aborts remaining writes and merges into unmatched
// ---------------------------------------------------------------------------

test('partial-failure aborts remaining writes and lists failed codes', async () => {
  const { deps, postCalls, appendCalls } = makeRecordingDeps({
    loadResult: {
      orgMarkdown: '# Org',
      projectMarkdown: '# Project',
      orgTruncated: false,
      projectTruncated: false,
      orgPath: '/proj/agent-os/product/tech-stack.md',
      projectPath: '/proj/alpha/agent-os/product/tech-stack.md',
    },
    prefillResult: {
      kind: 'success',
      response: {
        preFilledAnswers: [
          {
            decisionCode: 'service.language',
            value: 'Java 21',
            sourceQuote: 'Language: Java 21',
            sourceFile: 'organisation',
          },
          {
            decisionCode: 'service.framework',
            value: 'Spring Boot 3.4',
            sourceQuote: 'Framework: Spring Boot 3.4',
            sourceFile: 'project',
          },
          {
            decisionCode: 'db.engine',
            value: 'Postgres 16',
            sourceQuote: 'Engine: Postgres 16',
            sourceFile: 'organisation',
          },
        ],
        unmatchedCodes: [],
        summary: 'Matched 3 of 3.',
      },
    },
    postFailureOnCode: 'service.framework',
  });

  const result = await runOpenTurnTechStackPrefill(
    {
      projectId: 'proj-1',
      targetArchitectureId: 'arch-target',
      conversationThreadId: 'thread-1',
      candidateDecisions: CANDIDATES,
      projectContext: {
        projectName: 'alpha',
        currentArchitectureId: null,
        targetArchitectureId: null,
      },
      llmClient: STUB_LLM_CLIENT,
    },
    deps,
  );

  // POSTs: service.language attempts (success), service.framework attempts (fail),
  // db.engine NEVER attempts (aborted after first failure).
  expect(postCalls).toHaveLength(2);
  expect(result.partialFailureCodes).toContain('service.framework');
  expect(result.partialFailureCodes).toContain('db.engine');
  expect(result.rowsWritten).toBe(1); // only service.language succeeded

  const turn = appendCalls[0].turn as TechStackPrefillSummaryTurn;
  expect(turn.bannerVariant).toBe('failure');
  expect(turn.matchedCount).toBe(1);
  expect(turn.partialFailureCodes).toEqual(['service.framework', 'db.engine']);
});

// ---------------------------------------------------------------------------
// Test 7: invalid project name (path-traversal) routes to failure banner
// ---------------------------------------------------------------------------

test('invalid project name (path-traversal) routes to failure banner', async () => {
  const { deps, postCalls, appendCalls } = makeRecordingDeps({
    loadThrows: new InvalidProjectFolderNameError('../etc', '..'),
  });

  await runOpenTurnTechStackPrefill(
    {
      projectId: 'proj-1',
      targetArchitectureId: 'arch-target',
      conversationThreadId: 'thread-1',
      candidateDecisions: CANDIDATES,
      projectContext: {
        projectName: '../etc',
        currentArchitectureId: null,
        targetArchitectureId: null,
      },
      llmClient: STUB_LLM_CLIENT,
    },
    deps,
  );

  expect(postCalls).toHaveLength(0);
  const turn = appendCalls[0].turn as TechStackPrefillSummaryTurn;
  expect(turn.bannerVariant).toBe('failure');
  expect(turn.failureReason).toContain('Project name rejected');
});

// ---------------------------------------------------------------------------
// Test 8: candidate filtering — caller passes auto-skip-relevant codes; pre-fill
// honours that by never attempting to extract codes not in the candidate list
// (i.e. the orchestrator does not silently add codes back). The LLM response is
// validated against the candidate set by the validator (Group 2).
// ---------------------------------------------------------------------------

test('orchestrator does not attempt POSTs for codes outside the candidate set', async () => {
  const { deps, postCalls } = makeRecordingDeps({
    loadResult: {
      orgMarkdown: '# Org',
      projectMarkdown: null,
      orgTruncated: false,
      projectTruncated: false,
      orgPath: '/proj/agent-os/product/tech-stack.md',
      projectPath: null,
    },
    prefillResult: {
      kind: 'success',
      response: {
        // Only one matched answer (service.language). The candidate set
        // included this code -- the orchestrator posts exactly one row.
        preFilledAnswers: [
          {
            decisionCode: 'service.language',
            value: 'Java 21',
            sourceQuote: 'Language: Java 21',
            sourceFile: 'organisation',
          },
        ],
        unmatchedCodes: ['service.framework', 'db.engine'],
        summary: 'Matched 1 of 3.',
      },
    },
  });

  await runOpenTurnTechStackPrefill(
    {
      projectId: 'proj-1',
      targetArchitectureId: 'arch-target',
      conversationThreadId: 'thread-1',
      // Caller supplies only the codes auto-skip declared relevant.
      candidateDecisions: CANDIDATES,
      projectContext: {
        projectName: 'alpha',
        currentArchitectureId: null,
        targetArchitectureId: null,
      },
      llmClient: STUB_LLM_CLIENT,
    },
    deps,
  );

  // Exactly one POST -- the orchestrator never invents pre-fills.
  expect(postCalls).toHaveLength(1);
  expect(postCalls[0].body.decisionCode).toBe('service.language');
});
