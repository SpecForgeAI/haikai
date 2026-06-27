/**
 * Route tests — pending-version-confirmations surfaced FIRST in the
 * next-question walk (Spec
 * 2026-06-27-target-manifest-version-unknown-pending-questions, Task Group 3).
 *
 * Design A: a manifest coordinate whose version degraded to the
 * `version-unknown` sentinel writes NO captured-decision row; it is persisted as
 * a `pending-version-confirmations` turn on the thread. The next-question route
 * must surface those coordinates FIRST (ahead of the group A..J walk) with the
 * framework PRE-CHOSEN, reusing the existing pending-question DTO, and must
 * reconcile against captured rows (a pending code that now has a captured row
 * drops out — row presence wins). Pending entries must stay EXCLUDED from
 * answered / prompt-ready / close-gate (all row-presence driven).
 *
 * Deps are swapped via `setArchitectConversationDeps` so the handler is
 * hermetic: `loadConversation` returns a synthetic thread carrying (or omitting)
 * a pending turn, and `loadCapturedDecisions` returns the captured rows under
 * test.
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
import type {
  ConversationTurn,
  PendingVersionConfirmationEntry,
} from '../../services/architectConversation/turnShape';

const PROJECT_ID = 'proj-pending';
const TARGET_ARCH_ID = 'target-pending';
const BASE = `/api/projects/${PROJECT_ID}/target-architectures/${TARGET_ARCH_ID}/architect-conversation`;

/** Turns the mocked loadConversation reports for the thread. */
let threadTurns: ConversationTurn[] = [];
/** Captured-decision codes the mocked loader reports as already answered. */
let answeredCodes: string[] = [];

function buildApp(): express.Application {
  const app = express();
  app.use(express.json());
  app.use('/api', architectConversationRouter);
  return app;
}

function pendingTurn(
  entries: PendingVersionConfirmationEntry[],
): ConversationTurn {
  return { kind: 'pending-version-confirmations', entries } as ConversationTurn;
}

function entry(
  decisionCode: string,
  framework: string,
): PendingVersionConfirmationEntry {
  return {
    decisionCode,
    framework,
    sourceFile: 'pom.xml',
    sourceQuote: `${framework} (version unknown)`,
    tag: 'service-x',
  };
}

beforeEach(() => {
  threadTurns = [];
  answeredCodes = [];
  setArchitectConversationDeps({
    loadConversation: (async () => ({
      threadId: 'thr-pending',
      turns: threadTurns,
    })) as never,
    loadCapturedDecisions: (async () =>
      answeredCodes.map((code) => ({ decisionCode: code }))) as never,
  });
});

afterEach(() => {
  resetArchitectConversationDeps();
});

describe('next-question — pending-version-confirmations surfaced FIRST', () => {
  it('returns the pending code FIRST, framework pre-chosen, ahead of the group A walk', async () => {
    const app = buildApp();
    // service.framework is A.2; the normal walk would return service.language
    // (A.1) first. A pending entry for service.framework must override that.
    threadTurns = [pendingTurn([entry('service.framework', 'Spring Boot')])];

    const res = await request(app).get(`${BASE}/next-question`).expect(200);

    expect(res.body.question).not.toBeNull();
    expect(res.body.question.decisionCode).toBe('service.framework');
    // Framework is FIXED — the architect only supplies the version.
    expect(res.body.question.prechosenFramework).toBe('Spring Boot');
    // Pending precedes the walk but does NOT exhaust it -> phase stays preset-walk.
    expect(res.body.phase).toBe('preset-walk');
    // Proves it overrode the normal A.1 first question.
    expect(res.body.question.decisionCode).not.toBe('service.language');
  });

  it('asks pending entries in array order (first still-pending entry wins)', async () => {
    const app = buildApp();
    threadTurns = [
      pendingTurn([
        entry('db.engine', 'PostgreSQL'),
        entry('service.framework', 'Spring Boot'),
      ]),
    ];

    const res = await request(app).get(`${BASE}/next-question`).expect(200);
    expect(res.body.question.decisionCode).toBe('db.engine');
    expect(res.body.question.prechosenFramework).toBe('PostgreSQL');
  });

  it('a pending code that now has a captured row drops out (reconcile against captured rows) and the walk proceeds', async () => {
    const app = buildApp();
    threadTurns = [pendingTurn([entry('service.framework', 'Spring Boot')])];
    // The version was confirmed via the normal /answer path -> a captured row
    // now exists for service.framework. Row presence wins: it is no longer
    // pending, so the walk falls through to the ordinary first question.
    answeredCodes = ['service.framework'];

    const res = await request(app).get(`${BASE}/next-question`).expect(200);

    expect(res.body.question).not.toBeNull();
    // service.language (A.1) is now the first un-answered walk question.
    expect(res.body.question.decisionCode).toBe('service.language');
    // Ordinary walk questions carry NO pre-chosen framework.
    expect(res.body.question.prechosenFramework).toBeNull();
  });

  it('pending entries are EXCLUDED from answered / prompt-ready output (no captured row written)', async () => {
    const app = buildApp();
    threadTurns = [pendingTurn([entry('service.framework', 'Spring Boot')])];
    // No captured rows at all — only a pending entry.
    answeredCodes = [];

    // prompt-ready output is row-presence driven; a pending entry writes NO row,
    // so the output reports nothing captured.
    const promptRes = await request(app)
      .get(`${BASE}/prompt-ready-output`)
      .expect(200);
    expect(promptRes.body.promptReadyOutput).toBe('no decisions captured yet');

    // And the pending code is NOT treated as answered: it is still surfaced as
    // the next question (an answered code would be skipped).
    const nextRes = await request(app).get(`${BASE}/next-question`).expect(200);
    expect(nextRes.body.question.decisionCode).toBe('service.framework');
  });

  it('regression: with NO pending set the walk is unchanged (first question is service.language)', async () => {
    const app = buildApp();
    threadTurns = []; // no pending turn

    const res = await request(app).get(`${BASE}/next-question`).expect(200);
    expect(res.body.question).not.toBeNull();
    expect(res.body.question.decisionCode).toBe('service.language');
    expect(res.body.question.group).toBe('A');
    expect(res.body.question.prechosenFramework).toBeNull();
  });
});
