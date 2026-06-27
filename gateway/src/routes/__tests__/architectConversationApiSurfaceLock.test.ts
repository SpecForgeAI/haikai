/**
 * Route tests -- API like-for-like lock wiring
 * (Spec 2026-06-24-target-conversation-tech-stack-constraints, FR9).
 *
 * BUG #3 fix: the target-state architect conversation must NOT ask the six
 * Group B `api.*` questions on a FUNCTIONAL (API) like-for-like migration -- they
 * are auto-answered/derived from the current-state API Behaviour Baseline and
 * suppressed. The lock MECHANISM (`apiSurfaceLock.ts`) already existed but was
 * never called from production; this suite proves the route wiring.
 *
 * Exercises the two routes that thread the lock:
 *
 *   - POST .../architect-conversation/open: when the surface mode resolves to
 *     `like_for_like` AND a reconciled baseline is present, the six Group B codes
 *     are auto-answered (captured-decision rows, createdByTask=
 *     'api-like-for-like-lock') and reported as suppressed.
 *   - GET  .../architect-conversation/next-question: the suppressed codes are
 *     folded into the walk's skip set so `selectNextQuestion` never returns a
 *     locked `api.*` question; composes with tier-gating.
 *
 * The production `SourceContractProvider` DEGRADES (no derived-values read
 * exists yet -- see `baselineSourceContractProvider.ts`); tests inject a fixture
 * provider via `resolveSourceContractProvider` to exercise the live wiring.
 * Deps are swapped via `setArchitectConversationDeps` so the handlers are
 * hermetic.
 */

import request from 'supertest';
import express from 'express';

jest.mock('../../services/architectureModelClient', () => ({
  fetchProductName: jest.fn(async () => 'Test Project'),
}));

jest.mock('../../services/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import {
  architectConversationRouter,
  setArchitectConversationDeps,
  resetArchitectConversationDeps,
} from '../architectConversation';
import { QUESTION_LIBRARY } from '../../config/architect-conversation/questionLibrary';
import { LOCKABLE_GROUP_B_CODES } from '../../config/architect-conversation/apiSurfaceMode';
import {
  API_SURFACE_LOCK_TASK_NAME,
  type SourceContractProvider,
} from '../../services/architectConversation/apiSurfaceLock';
import type { CreateCapturedDecisionRequestBody } from '../../services/architectConversation/targetStateCapturedDecisionsWriter';

const PROJECT_ID = 'proj-api-lock';
const TARGET_ARCH_ID = 'target-api-lock';
const BASE = `/api/projects/${PROJECT_ID}/target-architectures/${TARGET_ARCH_ID}/architect-conversation`;

/** A fixture provider with the full source-derived Group B value set. */
function fullBaselineProvider(): SourceContractProvider {
  return {
    hasReconciledBaseline: () => true,
    readGroupBValue: (code) => ({
      value: `locked:${code}`,
      sourceQuote: `quote for ${code}`,
      sourceFile: 'contracts/widgets-openapi.yaml',
    }),
  };
}

/** The production-equivalent DEGRADE provider (no baseline / no values). */
function degradeProvider(): SourceContractProvider {
  return {
    hasReconciledBaseline: () => false,
    readGroupBValue: () => undefined,
  };
}

let lockWrites: CreateCapturedDecisionRequestBody[] = [];
let answeredCodes: string[] = [];

function buildApp(): express.Application {
  const app = express();
  app.use(express.json());
  app.use('/api', architectConversationRouter);
  return app;
}

function applyCommonDeps(provider: SourceContractProvider): void {
  setArchitectConversationDeps({
    resolveSourceContractProvider: (async () => provider) as never,
    appendTurn: (async () => undefined) as never,
    loadConversation: (async () => ({ threadId: 'thr-api-lock', turns: [] })) as never,
    loadCapturedDecisions: (async () =>
      answeredCodes.map((code) => ({ decisionCode: code }))) as never,
    // The lock writer (deps.postCapturedDecision) records every locked row.
    postCapturedDecision: (async (
      _projectId: string,
      _targetArchitectureId: string,
      body: CreateCapturedDecisionRequestBody,
    ) => {
      lockWrites.push(body);
      return { decisionId: `dec-${body.decisionCode}`, decisionCode: body.decisionCode } as never;
    }) as never,
    // Keep the open-turn tech-stack pre-fill hermetic (both files absent => no LLM).
    openTurnPrefillDeps: {
      loadTechStack: (async () => ({
        orgMarkdown: null,
        projectMarkdown: null,
        orgPath: null,
        projectPath: null,
        orgTruncated: false,
        projectTruncated: false,
      })) as never,
      postCapturedDecision: (async () => ({})) as never,
      appendTurn: (async () => undefined) as never,
      prefillFromTechStack: (async () => ({})) as never,
    } as never,
  });
}

beforeEach(() => {
  lockWrites = [];
  answeredCodes = [];
});

afterEach(() => {
  resetArchitectConversationDeps();
});

// ---------------------------------------------------------------------------
// (1) Reconciled baseline + like_for_like => auto-answer + suppress
// ---------------------------------------------------------------------------

describe('reconciled baseline + like_for_like: the six Group B codes are auto-answered + suppressed', () => {
  it('POST open writes the six locked Group B rows with the lock task marker and reports them suppressed', async () => {
    applyCommonDeps(fullBaselineProvider());
    const app = buildApp();

    const res = await request(app)
      .post(`${BASE}/open`)
      .send({ openedBy: 'tester' })
      .expect(200);

    // The open response surfaces the lock outcome.
    expect(res.body.apiSurfaceLock).toBeDefined();
    expect(res.body.apiSurfaceLock.mode).toBe('like_for_like');
    expect(new Set(res.body.apiSurfaceLock.suppressedCodes)).toEqual(
      new Set(LOCKABLE_GROUP_B_CODES),
    );

    // Each of the six Group B codes was written exactly once via the lock task.
    const lockRows = lockWrites.filter(
      (w) => w.createdByTask === API_SURFACE_LOCK_TASK_NAME,
    );
    expect(new Set(lockRows.map((w) => w.decisionCode))).toEqual(
      new Set(LOCKABLE_GROUP_B_CODES),
    );
    for (const row of lockRows) {
      expect(row.scopeKind).toBe('architecture');
      const parsed = JSON.parse(row.answerValue);
      expect(parsed.value).toBe(`locked:${row.decisionCode}`);
      expect(parsed.sourceFile).toBe('contracts/widgets-openapi.yaml');
    }
  });

  it('GET next-question never returns a locked Group B api.* question (skips B to C after Group A is answered)', async () => {
    applyCommonDeps(fullBaselineProvider());
    const app = buildApp();

    // Group A answered => the next deterministic group is B. With the lock,
    // B is suppressed, so the walk advances past it.
    answeredCodes = QUESTION_LIBRARY.filter((e) => e.group === 'A').map((e) => e.code);

    const res = await request(app).get(`${BASE}/next-question`).expect(200);
    expect(res.body.question).not.toBeNull();
    expect(res.body.question.group).not.toBe('B');
    expect(LOCKABLE_GROUP_B_CODES).not.toContain(res.body.question.decisionCode);
    // Next surviving group after A (B suppressed) is C.
    expect(res.body.question.group).toBe('C');
  });
});

// ---------------------------------------------------------------------------
// (2) No baseline (degrade) => Group B is asked as before (no regression)
// ---------------------------------------------------------------------------

describe('no baseline (degrade): Group B is asked exactly as today', () => {
  it('POST open locks nothing and reports an unset mode', async () => {
    applyCommonDeps(degradeProvider());
    const app = buildApp();

    const res = await request(app)
      .post(`${BASE}/open`)
      .send({ openedBy: 'tester' })
      .expect(200);

    expect(res.body.apiSurfaceLock.mode).toBeNull();
    expect(res.body.apiSurfaceLock.suppressedCodes).toEqual([]);
    expect(lockWrites.filter((w) => w.createdByTask === API_SURFACE_LOCK_TASK_NAME)).toHaveLength(0);
  });

  it('GET next-question asks the first Group B question (api.protocol) after Group A', async () => {
    applyCommonDeps(degradeProvider());
    const app = buildApp();

    answeredCodes = QUESTION_LIBRARY.filter((e) => e.group === 'A').map((e) => e.code);

    const res = await request(app).get(`${BASE}/next-question`).expect(200);
    expect(res.body.question).not.toBeNull();
    expect(res.body.question.group).toBe('B');
    expect(res.body.question.decisionCode).toBe('api.protocol');
  });
});

// ---------------------------------------------------------------------------
// (3) Composition with tier-gating
// ---------------------------------------------------------------------------

describe('composition with tier-gating', () => {
  it('the lock (Group B) and the UI-tier gate (Group E) compose: both must drop for the walk to complete', async () => {
    const app = buildApp();

    // Everything answered EXCEPT Group B and Group E.
    answeredCodes = QUESTION_LIBRARY.filter(
      (e) => e.group !== 'B' && e.group !== 'E',
    ).map((e) => e.code);

    // With the lock active, B is suppressed; UI-absent drops E via tier-gating.
    // BOTH filters apply => the walk is complete (null).
    applyCommonDeps(fullBaselineProvider());
    const locked = await request(app)
      .get(`${BASE}/next-question?hasUiTier=false`)
      .expect(200);
    expect(locked.body.question).toBeNull();

    // Sanity: with the DEGRADE provider, B is NOT suppressed -- even with E
    // dropped by the same tier gate, a Group B question is still asked. This
    // proves the null above is the lock's doing and that tier-gating still runs.
    resetArchitectConversationDeps();
    applyCommonDeps(degradeProvider());
    const degraded = await request(app)
      .get(`${BASE}/next-question?hasUiTier=false`)
      .expect(200);
    expect(degraded.body.question).not.toBeNull();
    expect(degraded.body.question.group).toBe('B');
  });

  it('Group A is unaffected by the lock: the first question is still service.language with a full baseline', async () => {
    applyCommonDeps(fullBaselineProvider());
    const app = buildApp();

    const res = await request(app).get(`${BASE}/next-question`).expect(200);
    expect(res.body.question).not.toBeNull();
    expect(res.body.question.decisionCode).toBe('service.language');
    expect(res.body.question.group).toBe('A');
  });
});
