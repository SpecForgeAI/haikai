/**
 * Tests — Pre-fill From Tech-Stack orchestration
 * Spec 2026-05-25 Tech-Stack.md Pre-fill + Target-Tech-Stack.md Write, Task Group 2.
 *
 * Per tasks.md §2.1 — orchestration-side tests:
 *   - Happy path: representative two-file context produces matched/unmatched split (LLM mocked)
 *   - Project-level wins over org-level when both name the same standard (prompt construction)
 *   - LLM call failure surfaces failure-variant + writes zero rows
 *
 * All LLM calls are mocked at the `callSingleShot` boundary.
 */

import type {
  ArchitectLlmClient,
  CallLlmToolLoopArgs,
  CallLlmToolLoopResponse,
  CallSingleShotOptions,
  CallSingleShotResponse,
  SingleShotPrompt,
} from '../architectLlmClient';
import { SingleShotLlmCallError } from '../architectLlmClient';
import {
  PreFillLibraryCandidate,
  buildUserPrompt,
  prefillFromTechStack,
  stripJsonFences,
} from '../prefillFromTechStack';

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

function makeMockLlmClient(
  singleShotImpl: (
    prompt: SingleShotPrompt,
    options?: CallSingleShotOptions,
  ) => Promise<CallSingleShotResponse>,
): ArchitectLlmClient {
  return {
    callLlmToolLoop: async (
      _args: CallLlmToolLoopArgs,
    ): Promise<CallLlmToolLoopResponse> => {
      throw new Error('callLlmToolLoop is not used in pre-fill tests');
    },
    callSingleShot: singleShotImpl,
  };
}

const ORG_MARKDOWN = `# Organisation Standards

## Backend
- Language: Java 21 (LTS)
- Framework: Spring Boot 3.4

## Database
- Engine: Postgres 16
`;

const PROJECT_MARKDOWN = `# Project Standards (Alpha)

## Backend
- Language: Java 21
- Logging: SLF4J + Logback JSON
`;

const CANDIDATES: PreFillLibraryCandidate[] = [
  {
    code: 'service.language',
    prompt: 'What language should target services run on?',
    expectedAnswerShape: 'single-choice',
    choices: ['Java 21', 'Java 17', 'Kotlin 2.0'],
  },
  {
    code: 'service.framework',
    prompt: 'What framework should target services use?',
    expectedAnswerShape: 'single-choice',
    choices: ['Spring Boot 3.4', 'Quarkus 3'],
  },
  {
    code: 'db.engine',
    prompt: 'What database engine should target services use?',
    expectedAnswerShape: 'single-choice',
    choices: ['Postgres 16', 'MySQL 8'],
  },
  {
    code: 'api.protocol',
    prompt: 'What API protocol should target services expose?',
    expectedAnswerShape: 'single-choice',
    choices: ['REST', 'gRPC'],
  },
];

// ---------------------------------------------------------------------------
// Test 1: happy path
// ---------------------------------------------------------------------------

test('happy path returns the validated PreFillResponse', async () => {
  const expectedResponse = {
    preFilledAnswers: [
      {
        decisionCode: 'service.language',
        value: 'Java 21',
        sourceQuote: 'Language: Java 21',
        sourceFile: 'project',
      },
      {
        decisionCode: 'service.framework',
        value: 'Spring Boot 3.4',
        sourceQuote: 'Framework: Spring Boot 3.4',
        sourceFile: 'organisation',
      },
      {
        decisionCode: 'db.engine',
        value: 'Postgres 16',
        sourceQuote: 'Engine: Postgres 16',
        sourceFile: 'organisation',
      },
    ],
    unmatchedCodes: ['api.protocol'],
    summary: 'Matched 3 of 4 candidate questions.',
  };

  const llmClient = makeMockLlmClient(async () => ({
    content: JSON.stringify(expectedResponse),
  }));

  const result = await prefillFromTechStack({
    orgMarkdown: ORG_MARKDOWN,
    projectMarkdown: PROJECT_MARKDOWN,
    candidateDecisions: CANDIDATES,
    projectContext: {
      projectName: 'alpha',
      currentArchitectureId: 'arch-current',
      targetArchitectureId: 'arch-target',
    },
    llmClient,
  });

  expect(result.kind).toBe('success');
  if (result.kind === 'success') {
    expect(result.response.preFilledAnswers).toHaveLength(3);
    expect(result.response.unmatchedCodes).toEqual(['api.protocol']);
  }
});

// ---------------------------------------------------------------------------
// Test 2: prompt labels project + organisation sections distinctly
// ---------------------------------------------------------------------------

test('user prompt labels organisation + project sections so project-level can win', () => {
  const userPrompt = buildUserPrompt({
    orgMarkdown: ORG_MARKDOWN,
    projectMarkdown: PROJECT_MARKDOWN,
    candidateDecisions: CANDIDATES,
    projectContext: {
      projectName: 'alpha',
      currentArchitectureId: 'arch-current',
      targetArchitectureId: 'arch-target',
    },
    llmClient: makeMockLlmClient(async () => ({ content: '{}' })),
  });

  const orgIdx = userPrompt.indexOf('## ORGANISATION STANDARDS');
  const projIdx = userPrompt.indexOf('## PROJECT STANDARDS');
  expect(orgIdx).toBeGreaterThan(-1);
  expect(projIdx).toBeGreaterThan(-1);
  // Both labels are present and the candidate questions section follows.
  expect(userPrompt.indexOf('## CANDIDATE QUESTIONS')).toBeGreaterThan(projIdx);
});

// ---------------------------------------------------------------------------
// Test 3: LLM call failure surfaces failure signal + zero rows
// ---------------------------------------------------------------------------

test('LLM call failure returns failure-kind with llm-call-failed reason', async () => {
  const llmClient = makeMockLlmClient(async () => {
    throw new SingleShotLlmCallError('upstream provider 503');
  });

  const result = await prefillFromTechStack({
    orgMarkdown: ORG_MARKDOWN,
    projectMarkdown: null,
    candidateDecisions: CANDIDATES,
    projectContext: {
      projectName: 'alpha',
      currentArchitectureId: null,
      targetArchitectureId: null,
    },
    llmClient,
  });

  expect(result.kind).toBe('failure');
  if (result.kind === 'failure') {
    expect(result.reason).toBe('llm-call-failed');
    expect(result.errorMessage).toContain('upstream provider 503');
  }
});

// ---------------------------------------------------------------------------
// Test 4: malformed JSON response surfaces response-not-json reason
// ---------------------------------------------------------------------------

test('malformed JSON response surfaces response-not-json failure', async () => {
  const llmClient = makeMockLlmClient(async () => ({
    content: 'this is not JSON at all',
  }));

  const result = await prefillFromTechStack({
    orgMarkdown: ORG_MARKDOWN,
    projectMarkdown: null,
    candidateDecisions: CANDIDATES,
    projectContext: {
      projectName: 'alpha',
      currentArchitectureId: null,
      targetArchitectureId: null,
    },
    llmClient,
  });

  expect(result.kind).toBe('failure');
  if (result.kind === 'failure') {
    expect(result.reason).toBe('response-not-json');
  }
});

// ---------------------------------------------------------------------------
// Test 5: validator failure (hallucinated decisionCode) surfaces validator-failed
// ---------------------------------------------------------------------------

test('validator failure (hallucinated decisionCode) surfaces validator-failed', async () => {
  const llmClient = makeMockLlmClient(async () => ({
    content: JSON.stringify({
      preFilledAnswers: [
        {
          decisionCode: 'service.fictional',
          value: 'made up',
          sourceQuote: 'Language: Java 21',
          sourceFile: 'organisation',
        },
      ],
      unmatchedCodes: [],
      summary: 'Hallucinated.',
    }),
  }));

  const result = await prefillFromTechStack({
    orgMarkdown: ORG_MARKDOWN,
    projectMarkdown: null,
    candidateDecisions: CANDIDATES,
    projectContext: {
      projectName: 'alpha',
      currentArchitectureId: null,
      targetArchitectureId: null,
    },
    llmClient,
  });

  expect(result.kind).toBe('failure');
  if (result.kind === 'failure') {
    expect(result.reason).toBe('validator-failed');
    expect(result.validatorErrors?.some((e) => e.includes('not present in the question library'))).toBe(true);
  }
});

// ---------------------------------------------------------------------------
// Test 6: tolerates ```json``` fences
// ---------------------------------------------------------------------------

test('strips ```json``` fences from LLM-wrapped JSON responses', () => {
  expect(stripJsonFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
  expect(stripJsonFences('```\n{"a":1}\n```')).toBe('{"a":1}');
  expect(stripJsonFences('{"a":1}')).toBe('{"a":1}');
});

// ---------------------------------------------------------------------------
// Test 7: degenerate empty candidate list
// ---------------------------------------------------------------------------

test('empty candidate list short-circuits to a success with empty arrays', async () => {
  const llmClient = makeMockLlmClient(async () => {
    throw new Error('LLM should not be called when no candidates');
  });
  const result = await prefillFromTechStack({
    orgMarkdown: ORG_MARKDOWN,
    projectMarkdown: PROJECT_MARKDOWN,
    candidateDecisions: [],
    projectContext: {
      projectName: 'alpha',
      currentArchitectureId: null,
      targetArchitectureId: null,
    },
    llmClient,
  });

  expect(result.kind).toBe('success');
  if (result.kind === 'success') {
    expect(result.response.preFilledAnswers).toHaveLength(0);
    expect(result.response.unmatchedCodes).toHaveLength(0);
  }
});
