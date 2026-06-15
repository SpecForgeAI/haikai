/**
 * Route tests — Architect Tier-Gating (Spec 2026-06-05-architect-tier-gating,
 * Half B, Task Group 3).
 *
 * Exercises the two routes that thread the technology-tier set:
 *
 *   - POST .../architect-conversation/open: reads all three tier flags from
 *     `body.relevanceContext` (each defaulting true, FAIL-OPEN) and appends a
 *     `tier-confirmation` turn carrying the set.
 *   - GET  .../architect-conversation/next-question: reads
 *     `?hasUiTier`/`?hasServiceTier`/`?hasPersistenceTier` (each default true)
 *     and gates the walk — UI-absent ⇒ Group E skipped; all-absent still asks
 *     the generic groups; omit params ⇒ everything asked (fail-open).
 *
 * The deps are swapped via `setArchitectConversationDeps` so the handlers are
 * hermetic: `appendTurn` records turns in-memory, captured-decisions + the
 * tech-stack pre-fill are stubbed (the pre-fill loader reports both files
 * absent, so no LLM call is made and a no-standards banner is appended).
 */

import request from 'supertest';
import express from 'express';

// fetchProductName (the open route's best-effort project-name lookup) is
// imported directly, not via deps — mock the AMS client module so no HTTP fires.
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
import type { ConversationTurn, TierConfirmationTurn } from '../../services/architectConversation/turnShape';

const PROJECT_ID = 'proj-tier-gate';
const TARGET_ARCH_ID = 'target-tier-gate';
const BASE = `/api/projects/${PROJECT_ID}/target-architectures/${TARGET_ARCH_ID}/architect-conversation`;

/** Recorded turns from the mocked appendTurn, reset per test. */
let recordedTurns: ConversationTurn[] = [];

/** Captured-decision codes the mocked loader reports as already answered. */
let answeredCodes: string[] = [];

function buildApp(): express.Application {
  const app = express();
  app.use(express.json());
  app.use('/api', architectConversationRouter);
  return app;
}

beforeEach(() => {
  recordedTurns = [];
  answeredCodes = [];
  setArchitectConversationDeps({
    // Record every appended turn so we can assert the tier-confirmation turn.
    appendTurn: (async (
      _projectId: string,
      _targetArchitectureId: string,
      turn: unknown,
    ) => {
      recordedTurns.push(turn as ConversationTurn);
    }) as never,
    // The open route loads the thread to get its threadId for the pre-fill.
    loadConversation: (async () => ({ threadId: 'thr-tier-gate', turns: [] })) as never,
    // next-question reads captured-decision codes to remove already-answered
    // questions from the stream.
    loadCapturedDecisions: (async () =>
      answeredCodes.map((code) => ({ decisionCode: code }))) as never,
    // Stub the tech-stack pre-fill loader so BOTH files are absent: the
    // orchestrator short-circuits to a no-standards banner with NO LLM call.
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
      appendTurn: (async (
        _p: string,
        _t: string,
        turn: unknown,
      ) => {
        recordedTurns.push(turn as ConversationTurn);
      }) as never,
      prefillFromTechStack: (async () => ({})) as never,
    } as never,
  });
});

afterEach(() => {
  resetArchitectConversationDeps();
});

function tierTurn(): TierConfirmationTurn | undefined {
  return recordedTurns.find(
    (t) => t.kind === 'tier-confirmation',
  ) as TierConfirmationTurn | undefined;
}

describe('POST open — threads the tier set + appends the tier-confirmation turn', () => {
  it('appends a tier-confirmation turn carrying the sent (UI-absent) tier set', async () => {
    const app = buildApp();
    const res = await request(app)
      .post(`${BASE}/open`)
      .send({
        openedBy: 'tester',
        relevanceContext: {
          hasUiTier: false,
          hasServiceTier: true,
          hasPersistenceTier: true,
        },
      })
      .expect(200);

    // The response echoes the turn and it is in the recorded transcript.
    expect(res.body.tierConfirmationTurn).toBeDefined();
    expect(res.body.tierConfirmationTurn.kind).toBe('tier-confirmation');

    const turn = tierTurn();
    expect(turn).toBeDefined();
    expect(turn!.confirmedTiers).toEqual({
      hasUiTier: false,
      hasServiceTier: true,
      hasPersistenceTier: true,
    });
    // derived == confirmed at open.
    expect(turn!.derivedTiers).toEqual(turn!.confirmedTiers);

    // The tier-confirmation turn is appended BEFORE the first question (the open
    // route never appends a question turn) and after the open turn.
    const kinds = recordedTurns.map((t) => t.kind);
    expect(kinds.indexOf('open')).toBeLessThan(kinds.indexOf('tier-confirmation'));
    expect(kinds).not.toContain('question');
  });

  it('FAIL-OPEN: omitting relevanceContext defaults all three tier flags true', async () => {
    const app = buildApp();
    await request(app).post(`${BASE}/open`).send({ openedBy: 'tester' }).expect(200);

    const turn = tierTurn();
    expect(turn).toBeDefined();
    expect(turn!.confirmedTiers).toEqual({
      hasUiTier: true,
      hasServiceTier: true,
      hasPersistenceTier: true,
    });
  });
});

describe('GET next-question — gates the walk on the three tier query params', () => {
  it('omitting params asks everything (fail-open): first question is service.language (Group A)', async () => {
    const app = buildApp();
    const res = await request(app).get(`${BASE}/next-question`).expect(200);
    expect(res.body.question).not.toBeNull();
    expect(res.body.question.decisionCode).toBe('service.language');
    expect(res.body.question.group).toBe('A');
  });

  it('UI-absent (?hasUiTier=false) skips Group E — when only Group E remains, the walk completes', async () => {
    const app = buildApp();
    // Mark every NON-E code as already answered, so the only questions left are
    // Group E (UI). This isolates the UI gate.
    answeredCodes = QUESTION_LIBRARY.filter((e) => e.group !== 'E').map((e) => e.code);

    // With UI present, the next question IS a Group E (UI) question.
    const present = await request(app)
      .get(`${BASE}/next-question?hasUiTier=true&hasServiceTier=true&hasPersistenceTier=true`)
      .expect(200);
    expect(present.body.question).not.toBeNull();
    expect(present.body.question.group).toBe('E');

    // With UI absent, Group E is skipped → the walk is complete (null).
    const absent = await request(app)
      .get(`${BASE}/next-question?hasUiTier=false&hasServiceTier=true&hasPersistenceTier=true`)
      .expect(200);
    expect(absent.body.question).toBeNull();
  });

  it('Service-absent skips Group A: the first question is no longer a Service question', async () => {
    const app = buildApp();
    const res = await request(app)
      .get(`${BASE}/next-question?hasUiTier=true&hasServiceTier=false&hasPersistenceTier=true`)
      .expect(200);
    expect(res.body.question).not.toBeNull();
    // service.language is Group A (Service) — it must be skipped.
    expect(res.body.question.decisionCode).not.toBe('service.language');
    expect(res.body.question.group).not.toBe('A');
  });

  it('all three tiers absent still asks the generic groups (F/G/I/J): first is logging.framework (F)', async () => {
    const app = buildApp();
    const res = await request(app)
      .get(`${BASE}/next-question?hasUiTier=false&hasServiceTier=false&hasPersistenceTier=false`)
      .expect(200);
    expect(res.body.question).not.toBeNull();
    // A/B/C/D/E/H all gated off; the first surviving entry in walk order is the
    // first generic group F entry.
    expect(res.body.question.group).toBe('F');
    expect(res.body.question.decisionCode).toBe('logging.framework');
  });
});
