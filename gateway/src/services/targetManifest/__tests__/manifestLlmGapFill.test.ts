/**
 * Task Group 5 tests — the ONE manifest LLM gap-fill call (answers-51 + Tier-2).
 *
 * Spec: 2026-06-26-target-dependency-manifest-auto-answer-comprehensive (Spec 2),
 * task 5.1.
 *
 * Scope (3-6 focused tests), all with an injected FAKE `ArchitectLlmClient`:
 *   (a) happy path: ONE batched call returns BOTH LLM-suggested answers to the
 *       open codes (badge `llm`, source-dependency carried) AND named Tier-2
 *       free facts (`"<friendly> — <coordinate>"`);
 *   (b) FAIL-OPEN: a thrown SingleShotLlmCallError / unparseable body becomes a
 *       typed failure and never throws through;
 *   (c) caching: identical content hash does not re-call; changed content
 *       re-calls;
 *   (d) only UNMATCHED deps enter the prompt, capped at a sane max;
 *   (e) R10 guard-rail: a single-choice value outside `choices` is dropped.
 */

import {
  ArchitectLlmClient,
  CallLlmToolLoopResponse,
  CallSingleShotResponse,
  SingleShotLlmCallError,
  SingleShotPrompt,
} from '../../architectConversation/architectLlmClient';
import {
  ManifestLlmAnswerableCode,
  clearManifestLlmGapFillCache,
  runManifestLlmGapFill,
} from '../manifestLlmGapFill';
import { ResolvedDependency, ResolvedManifest } from '../manifestVersionResolution';

jest.mock('../../logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const EM_DASH = '—';

// ---------------------------------------------------------------------------
// Fixtures + a recording fake LLM client
// ---------------------------------------------------------------------------

function mavenDep(name: string, version = '1.0.0'): ResolvedDependency {
  return {
    name,
    ecosystem: 'MAVEN',
    tag: 'svc',
    manifestPath: 'pom.xml',
    resolvedVersion: version,
    versionUnknown: false,
    source: 'declared',
    declaredVersion: version,
    declaredScope: 'compile',
    evidence: `${name} ${version}`,
  };
}

function mavenManifest(deps: ResolvedDependency[]): ResolvedManifest {
  return {
    ecosystem: 'MAVEN',
    tag: 'svc',
    manifestPath: 'pom.xml',
    resolvedDependencies: deps,
    pomMetadata: null,
  };
}

interface FakeClient {
  client: ArchitectLlmClient;
  prompts: SingleShotPrompt[];
  callCount: () => number;
}

function makeFakeClient(
  respond: (prompt: SingleShotPrompt) => string | never,
): FakeClient {
  const prompts: SingleShotPrompt[] = [];
  let calls = 0;
  const client: ArchitectLlmClient = {
    callLlmToolLoop: async (): Promise<CallLlmToolLoopResponse> => {
      throw new Error('callLlmToolLoop not used in gap-fill');
    },
    callSingleShot: async (prompt: SingleShotPrompt): Promise<CallSingleShotResponse> => {
      calls += 1;
      prompts.push(prompt);
      return { content: respond(prompt) };
    },
  };
  return { client, prompts, callCount: () => calls };
}

const ANSWERABLE: ManifestLlmAnswerableCode[] = [
  {
    code: 'validation.framework',
    prompt: 'Validation framework?',
    expectedAnswerShape: 'single-choice',
    choices: ['Hibernate Validator', 'Bean Validation'],
    versioned: true,
  },
  {
    code: 'interservice.discoveryMechanism',
    prompt: 'Discovery mechanism?',
    expectedAnswerShape: 'single-choice',
    choices: ['Eureka', 'Consul'],
    versioned: false,
  },
];

beforeEach(() => {
  clearManifestLlmGapFillCache();
});

// ---------------------------------------------------------------------------
// (a) happy path — ONE call yields BOTH answers-51 and Tier-2 free facts
// ---------------------------------------------------------------------------

test('(a) one batched call returns BOTH llm-suggested answers (badged + source dep) AND named Tier-2 free facts', async () => {
  const manifests = [
    mavenManifest([
      mavenDep('org.postgresql:postgresql', '42.7.4'), // MATCHED (db.driver) — excluded
      mavenDep('com.example:custom-validation'), // unmatched -> answer
      mavenDep('io.modelcontextprotocol:mcp-sdk'), // unmatched -> free fact
      mavenDep('org.springframework.ai:spring-ai-openai'), // unmatched -> free fact
    ]),
  ];

  const body = JSON.stringify({
    answers: [
      {
        decisionCode: 'validation.framework',
        value: 'Hibernate Validator',
        sourceDependency: 'com.example:custom-validation',
      },
    ],
    freeFacts: [
      { friendlyName: 'MCP SDK', coordinate: 'io.modelcontextprotocol:mcp-sdk' },
      {
        friendlyName: 'Spring AI / LLM client',
        coordinate: 'org.springframework.ai:spring-ai-openai',
      },
    ],
  });
  const fake = makeFakeClient(() => body);

  const result = await runManifestLlmGapFill({
    resolvedManifests: manifests,
    answerableCodes: ANSWERABLE,
    llmClient: fake.client,
  });

  expect(fake.callCount()).toBe(1); // ONE batched call
  expect(result.kind).toBe('success');
  if (result.kind !== 'success') return;

  // (a.1) answer-to-the-51, badged llm with the unmatched dep as source.
  expect(result.answers).toHaveLength(1);
  expect(result.answers[0]).toEqual({
    decisionCode: 'validation.framework',
    value: 'Hibernate Validator',
    versioned: true,
    sourceDependency: 'com.example:custom-validation',
  });

  // (a.2) Tier-2 free facts named with the "<friendly> — <coordinate>" label.
  expect(result.freeFacts).toHaveLength(2);
  expect(result.freeFacts[0].label).toBe(
    `MCP SDK ${EM_DASH} io.modelcontextprotocol:mcp-sdk`,
  );
  expect(result.freeFacts[1].label).toBe(
    `Spring AI / LLM client ${EM_DASH} org.springframework.ai:spring-ai-openai`,
  );
});

// ---------------------------------------------------------------------------
// (b) FAIL-OPEN — a thrown SingleShotLlmCallError / unparseable body
// ---------------------------------------------------------------------------

test('(b) a thrown SingleShotLlmCallError becomes a typed failure (never throws through)', async () => {
  const fake = makeFakeClient(() => {
    throw new SingleShotLlmCallError('provider exploded');
  });

  const result = await runManifestLlmGapFill({
    resolvedManifests: [mavenManifest([mavenDep('com.example:thing')])],
    answerableCodes: ANSWERABLE,
    llmClient: fake.client,
  });

  expect(result.kind).toBe('failure');
  if (result.kind !== 'failure') return;
  expect(result.reason).toBe('llm-call-failed');
});

test('(b2) an unparseable response body becomes a response-not-json failure', async () => {
  const fake = makeFakeClient(() => 'definitely not json {');

  const result = await runManifestLlmGapFill({
    resolvedManifests: [mavenManifest([mavenDep('com.example:thing')])],
    answerableCodes: ANSWERABLE,
    llmClient: fake.client,
  });

  expect(result.kind).toBe('failure');
  if (result.kind !== 'failure') return;
  expect(result.reason).toBe('response-not-json');
});

// ---------------------------------------------------------------------------
// (c) caching — identical content hash does not re-call; changed content does
// ---------------------------------------------------------------------------

test('(c) identical content is cached (no re-call); changed manifest content re-calls', async () => {
  const body = JSON.stringify({ answers: [], freeFacts: [] });
  const fake = makeFakeClient(() => body);

  const deps1 = [mavenManifest([mavenDep('com.example:alpha')])];

  const r1 = await runManifestLlmGapFill({
    resolvedManifests: deps1,
    answerableCodes: ANSWERABLE,
    llmClient: fake.client,
  });
  expect(r1.kind).toBe('success');
  if (r1.kind === 'success') expect(r1.cached).toBe(false);
  expect(fake.callCount()).toBe(1);

  // Same content — served from cache, no second call.
  const r2 = await runManifestLlmGapFill({
    resolvedManifests: deps1,
    answerableCodes: ANSWERABLE,
    llmClient: fake.client,
  });
  expect(r2.kind).toBe('success');
  if (r2.kind === 'success') expect(r2.cached).toBe(true);
  expect(fake.callCount()).toBe(1);

  // Changed content (different unmatched dep) — re-calls.
  const deps2 = [mavenManifest([mavenDep('com.example:beta')])];
  const r3 = await runManifestLlmGapFill({
    resolvedManifests: deps2,
    answerableCodes: ANSWERABLE,
    llmClient: fake.client,
  });
  expect(r3.kind).toBe('success');
  expect(fake.callCount()).toBe(2);
});

// ---------------------------------------------------------------------------
// (d) only UNMATCHED deps enter the prompt, capped at a sane max
// ---------------------------------------------------------------------------

test('(d) only unmatched deps reach the prompt, capped at maxDeps', async () => {
  const manifests = [
    mavenManifest([
      mavenDep('org.postgresql:postgresql', '42.7.4'), // MATCHED — must be absent
      mavenDep('com.example:aaa'),
      mavenDep('com.example:bbb'),
      mavenDep('com.example:ccc'), // beyond the cap of 2 — must be absent
    ]),
  ];
  const fake = makeFakeClient(() => JSON.stringify({ answers: [], freeFacts: [] }));

  await runManifestLlmGapFill({
    resolvedManifests: manifests,
    answerableCodes: ANSWERABLE,
    llmClient: fake.client,
    maxDeps: 2,
  });

  const userPrompt = fake.prompts[0].user;
  expect(userPrompt).not.toContain('org.postgresql:postgresql'); // matched
  expect(userPrompt).toContain('com.example:aaa');
  expect(userPrompt).toContain('com.example:bbb');
  expect(userPrompt).not.toContain('com.example:ccc'); // capped out
});

// ---------------------------------------------------------------------------
// (e) R10 guard-rail — a single-choice value outside choices is dropped
// ---------------------------------------------------------------------------

test('(e) a single-choice answer outside the code choices is dropped; a verbatim choice is kept', async () => {
  const manifests = [
    mavenManifest([mavenDep('com.example:disco-a'), mavenDep('com.example:disco-b')]),
  ];
  const body = JSON.stringify({
    answers: [
      {
        decisionCode: 'interservice.discoveryMechanism',
        value: 'Zookeeper', // NOT a member of choices => dropped
        sourceDependency: 'com.example:disco-a',
      },
      {
        decisionCode: 'interservice.discoveryMechanism',
        value: 'Consul', // verbatim choice => kept
        sourceDependency: 'com.example:disco-b',
      },
    ],
    freeFacts: [],
  });
  const fake = makeFakeClient(() => body);

  const result = await runManifestLlmGapFill({
    resolvedManifests: manifests,
    answerableCodes: ANSWERABLE,
    llmClient: fake.client,
  });

  expect(result.kind).toBe('success');
  if (result.kind !== 'success') return;
  expect(result.answers).toHaveLength(1);
  expect(result.answers[0].value).toBe('Consul');
});
