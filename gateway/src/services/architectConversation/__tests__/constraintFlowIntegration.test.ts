/**
 * Tests — End-to-end constraint + versioned-capture flow (integration seams)
 * Spec 2026-06-24-target-conversation-tech-stack-constraints, Task Group 8
 * (Test Review & Gap Analysis — THIS spec only).
 *
 * The per-group unit suites (TG1-7) cover each piece in isolation. This file
 * fills the critical INTEGRATION-SEAM gaps identified in §8.2 by composing the
 * REAL modules across group boundaries — foundational answer -> branch-list ->
 * deterministic matrix -> grey judge (fail-open) -> hide + `Other (advanced)` +
 * seed reconciliation -> versioned capture (one resolved chip) -> the FR9 lock.
 *
 * Strategic, integration-first (per §8.3): NO exhaustive per-row / perf / a11y
 * tests. Hard cap 10 new tests; this file adds 6.
 *
 * Only the LLM boundary + the captured-decision writer are mocked; the
 * branch-lists, compatibility matrix, choice filter, framework/version envelope,
 * and API-surface lock are the REAL implementations.
 */

import type { ArchitectLlmClient } from '../architectLlmClient';
import type { GreyCompatibilityJudgeDeps } from '../greyCompatibilityJudge';
import { filterChoices, reconcileSeed, OTHER_ADVANCED_CHOICE } from '../choiceFilter';
import {
  buildFrameworkVersionEnvelope,
  resolveFrameworkVersionChip,
} from '../../../config/architect-conversation/frameworkVersionShape';
import {
  applyApiSurfaceLock,
  type ApiSurfaceLockDeps,
  type SourceContractProvider,
  type SourceContractValue,
} from '../apiSurfaceLock';
import {
  QUESTION_LIBRARY,
  type QuestionLibraryEntry,
} from '../../../config/architect-conversation/questionLibrary';

jest.mock('../../logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

function entryByCode(code: string): QuestionLibraryEntry {
  const e = QUESTION_LIBRARY.find((x) => x.code === code);
  if (!e) throw new Error(`missing fixture: ${code}`);
  return e;
}

/** Deps whose LLM throws — proves the deterministic / hard path never awaits it. */
const NO_LLM_DEPS: GreyCompatibilityJudgeDeps = {
  llmClient: {
    callLlmToolLoop: async () => {
      throw new Error('callLlmToolLoop must not be used');
    },
    callSingleShot: async () => {
      throw new Error('LLM must not be called on this path');
    },
  } as ArchitectLlmClient,
};

beforeEach(() => jest.clearAllMocks());

// ---------------------------------------------------------------------------
// Seam 1 — Full Java-21 walk: hide FastAPI AND capture framework+version as ONE
// chip. Composes TG4 (filterChoices) -> TG5 (buildFrameworkVersionEnvelope).
// ---------------------------------------------------------------------------

describe('integration: Java-21 walk hides FastAPI and captures ONE resolved chip', () => {
  it('filters service.framework to JVM-only, then the chosen framework+version is a single chip', async () => {
    // 1. Filter (TG4): Java 21 hides FastAPI/NestJS/Gin/ASP.NET from the offered set.
    const filtered = await filterChoices(
      {
        entry: entryByCode('service.framework'),
        foundationalAnswers: { 'service.language': 'Java 21' },
      },
      NO_LLM_DEPS,
    );
    expect(filtered.offered).not.toContain('FastAPI');
    expect(filtered.offered).toContain('Spring Boot');
    // The escape hatch is present (the set was narrowed).
    expect(filtered.offered).toContain(OTHER_ADVANCED_CHOICE);

    // 2. The architect picks a surviving framework + a concrete version (TG5).
    const picked = 'Spring Boot';
    expect(filtered.offered).toContain(picked);
    const env = buildFrameworkVersionEnvelope({
      value: { framework: picked, version: '3.4.1' },
    });

    // The capture rides the EXISTING envelope; answerSummary is exactly ONE chip
    // (never a framework x version cartesian product).
    expect(JSON.parse(env.answerValue)).toEqual({
      value: { framework: 'Spring Boot', version: '3.4.1' },
      sourceQuote: null,
      sourceFile: null,
    });
    expect(env.answerSummary).toBe('Spring Boot 3.4.1');
  });
});

// ---------------------------------------------------------------------------
// Seam 2 — Grey-residue fail-open THROUGH filterChoices. Composes TG2 matrix ->
// TG3 judge (throwing) -> TG4 offered set. The conversation is never blocked:
// the full set is offered.
// ---------------------------------------------------------------------------

describe('integration: grey residue fails OPEN through filterChoices (full set offered)', () => {
  it('a throwing LLM-judge leaves every grey candidate offered (nothing hidden, not blocked)', async () => {
    // ui.designSystem under Angular: MUI / Chakra / Ant Design are `undecided`
    // (genuinely grey) per the real matrix, so they reach the LLM — which throws.
    const throwingDeps: GreyCompatibilityJudgeDeps = {
      llmClient: {
        callLlmToolLoop: async () => {
          throw new Error('unused');
        },
        callSingleShot: async () => {
          throw new Error('provider unavailable');
        },
      } as ArchitectLlmClient,
    };

    const filtered = await filterChoices(
      {
        entry: entryByCode('ui.designSystem'),
        foundationalAnswers: { 'ui.framework': 'Angular 17' },
      },
      throwingDeps,
    );

    expect(filtered.llmInvoked).toBe(true);
    // FAIL-OPEN: every curated choice survives; nothing is hidden by a failed judge.
    for (const choice of entryByCode('ui.designSystem').choices!) {
      expect(filtered.offered).toContain(choice);
    }
    expect(filtered.hidden).toEqual([]);
    // No narrowing happened => no escape-hatch sentinel forced in.
    expect(filtered.offered).not.toContain(OTHER_ADVANCED_CHOICE);
  });
});

// ---------------------------------------------------------------------------
// Seam 3 — Seed-filtered-out fallback composed with the REAL filtered set.
// Composes TG4 filterChoices -> reconcileSeed (not a hand-written array).
// ---------------------------------------------------------------------------

describe('integration: a cascades seed filtered out by the REAL filtered set falls back', () => {
  it('FastAPI seed under Java 21 is substituted by a first-compatible JVM framework', async () => {
    const filtered = await filterChoices(
      {
        entry: entryByCode('service.framework'),
        foundationalAnswers: { 'service.language': 'Java 21' },
      },
      NO_LLM_DEPS,
    );
    // The seed proposes FastAPI, which the REAL filter hid under Java 21.
    const reconciled = reconcileSeed({
      questionCode: 'service.framework',
      seedValue: 'FastAPI 0.115',
      filteredChoices: filtered.offered,
    });
    expect(reconciled.preserved).toBe(false);
    expect(reconciled.substituted).toBe(true);
    // The substitute is a real member of the filtered set, never the sentinel.
    expect(filtered.offered).toContain(reconciled.value);
    expect(reconciled.value).not.toBe(OTHER_ADVANCED_CHOICE);
    expect(['Spring Boot', 'Quarkus', 'Micronaut']).toContain(
      reconciled.value,
    );
  });
});

// ---------------------------------------------------------------------------
// Seam 4 — db.driver versioned hard-dependent walk: engine+language narrows the
// driver set AND the pick captures as one chip. A second versioned/hard-dependent
// code (Group C) proving matrix `versioned` + branch-list + capture compose.
// ---------------------------------------------------------------------------

describe('integration: db.driver narrows by engine then captures one resolved chip', () => {
  it('Postgres narrows db.driver to SQL drivers and the picked driver+version is one chip', async () => {
    const driverEntry = entryByCode('db.driver');
    // db.driver is a versioned hard-dependent Group C code.
    expect(driverEntry.versioned).toBe(true);
    expect(driverEntry.dependencyClass).toBe('hard-dependent');

    const filtered = await filterChoices(
      {
        entry: driverEntry,
        foundationalAnswers: {
          'db.engine': 'Postgres 18',
          'service.language': 'Java 21',
        },
      },
      NO_LLM_DEPS,
    );
    // SQL engine => the Mongo / Dynamo drivers are hidden.
    expect(filtered.offered).toContain('pgjdbc');
    expect(filtered.offered).not.toContain('mongo-java-driver');
    expect(filtered.offered).not.toContain('dynamodb-enhanced');
    expect(filtered.filtered).toBe(true);

    // The picked driver + a concrete version captures as ONE chip.
    const chip = resolveFrameworkVersionChip({
      framework: 'pgjdbc',
      version: '42.7.4',
    });
    expect(chip).toBe('pgjdbc 42.7.4');
    const env = buildFrameworkVersionEnvelope({
      value: { framework: 'pgjdbc', version: '42.7.4' },
    });
    expect(env.answerSummary).toBe('pgjdbc 42.7.4');
  });
});

// ---------------------------------------------------------------------------
// Seam 5 — FR9 `L` supersedes H/G ONLY while like_for_like is active. Composes
// TG7 (apiSurfaceLock) with TG4 (filterChoices) for api.contractFormat (Group B,
// underlying class H). Under like_for_like it is locked + suppressed (never
// asked); under may_change it reverts to H and filterChoices narrows it by
// api.protocol.
// ---------------------------------------------------------------------------

const GROUP_B_BASELINE: Record<string, SourceContractValue> = {
  'api.protocol': { value: 'REST/JSON', sourceQuote: 'paths:', sourceFile: 'openapi.yaml' },
  'api.versioning': { value: 'URL path', sourceQuote: '/v1', sourceFile: 'openapi.yaml' },
  'api.contractFormat': { value: 'OpenAPI 3.1', sourceQuote: 'openapi: 3.1.0', sourceFile: 'openapi.yaml' },
  'api.auth': { value: 'OAuth2 + JWT', sourceQuote: 'bearerAuth', sourceFile: 'openapi.yaml' },
  'api.errorContract': { value: 'RFC 7807 Problem Details', sourceQuote: 'problem+json', sourceFile: 'openapi.yaml' },
  'api.rateLimiting': { value: 'gateway-enforced', sourceQuote: 'x-ratelimit', sourceFile: 'openapi.yaml' },
};

function lockDepsWithBaseline(): { deps: ApiSurfaceLockDeps; writes: { decisionCode: string }[] } {
  const writes: { decisionCode: string }[] = [];
  const provider: SourceContractProvider = {
    hasReconciledBaseline: () => true,
    readGroupBValue: (code) => GROUP_B_BASELINE[code],
  };
  const deps: ApiSurfaceLockDeps = {
    sourceContractProvider: provider,
    postCapturedDecision: (async (_p: string, _t: string, body: { decisionCode: string }) => {
      writes.push(body);
      return {} as never;
    }) as ApiSurfaceLockDeps['postCapturedDecision'],
  };
  return { deps, writes };
}

describe('integration: FR9 L supersedes H/G only while like_for_like is active', () => {
  it('like_for_like locks + suppresses api.contractFormat (never asked); may_change reverts it to H + filters by protocol', async () => {
    // --- like_for_like: api.contractFormat is locked from source + suppressed. ---
    const { deps, writes } = lockDepsWithBaseline();
    const locked = await applyApiSurfaceLock(
      { projectId: 'p1', targetArchitectureId: 't1' /* defaults to like_for_like */ },
      deps,
    );
    expect(locked.mode).toBe('like_for_like');
    expect(locked.suppressedCodes).toContain('api.contractFormat');
    expect(writes.map((w) => w.decisionCode)).toContain('api.contractFormat');

    // --- may_change: api.contractFormat reverts to its underlying H class and is
    //     narrowed by api.protocol via the REAL branch-list (NOT locked). ---
    const { deps: deps2, writes: writes2 } = lockDepsWithBaseline();
    const unlocked = await applyApiSurfaceLock(
      { projectId: 'p1', targetArchitectureId: 't1', requestedMode: 'may_change' },
      deps2,
    );
    expect(unlocked.mode).toBe('may_change');
    expect(unlocked.suppressedCodes).toEqual([]);
    expect(writes2).toHaveLength(0);

    // Under may_change the question is asked; its underlying class is H and the
    // branch-list narrows it by protocol (gRPC => proto3 only).
    const cf = entryByCode('api.contractFormat');
    expect(cf.dependencyClass).toBe('hard-dependent');
    const filtered = await filterChoices(
      { entry: cf, foundationalAnswers: { 'api.protocol': ['gRPC'] } },
      NO_LLM_DEPS,
    );
    expect(filtered.offered).toContain('proto3');
    expect(filtered.offered).not.toContain('OpenAPI');
    expect(filtered.filtered).toBe(true);
  });

  it('the same six Group B codes flagged lockableFromSource are exactly the ones locked under like_for_like', async () => {
    const { deps } = lockDepsWithBaseline();
    const locked = await applyApiSurfaceLock(
      { projectId: 'p1', targetArchitectureId: 't1' },
      deps,
    );
    const lockableFlagged = QUESTION_LIBRARY.filter(
      (e) => e.lockableFromSource === true,
    ).map((e) => e.code);
    // The lock outcome's suppressed set == the matrix-flagged Group B set.
    expect(new Set(locked.suppressedCodes)).toEqual(new Set(lockableFlagged));
  });
});
