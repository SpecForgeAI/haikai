/**
 * Gap-filler tests — open-phase capture-path FAILURE behaviour (route level).
 * Spec 2026-06-06-architect-conversation-open-ended-phase, Task Group 7 (7.4).
 *
 * Gap analysis (7.3) found ONE critical seam unproven by 1.1-6.1 + the E2E:
 * the S3 "failure-to-`error`-turn" reuse AT THE ROUTE LEVEL on the NEW capture
 * path — specifically that an open-phase LLM-loop FAILURE during a write-bearing
 * route (`/open-phase/pick`, `/open-phase/summarise`):
 *   1. surfaces `{ outcome: 'error', errorTurn }` (NOT a 500, NOT a throw), AND
 *   2. does NOT write a captured-decision row (no spurious/half-baked
 *      `adhoc.<slug>` or `note.<slug>` row when the LLM never produced a pick /
 *      notes).
 *
 * This protects the "first-class decision write" + "per-note unique note write"
 * durability contracts: a failed loop must leave the captured-decisions plane
 * untouched. TG3 proves the LOOP returns an error result; TG4 proves the happy
 * WRITES; neither proves the route's failure path leaves the writer untouched.
 *
 * The LLM is mocked at the `ArchitectLlmClient` boundary (the established
 * pattern) by a client whose `callLlmToolLoop` THROWS → the loop maps it to an
 * `llm-call-failed` error result → the coordinator appends an `error` turn.
 *
 * 2 focused tests (well within the 7.4 ≤10 cap).
 */

import request from 'supertest';
import express from 'express';

import {
  architectConversationRouter,
  setArchitectConversationDeps,
  resetArchitectConversationDeps,
} from '../routes/architectConversation';
import type { ArchitectLlmClient } from '../services/architectConversation/architectLlmClient';
import type { ConversationTurn } from '../services/architectConversation/turnShape';

jest.mock('../services/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const PROJECT_ID = '550e8400-e29b-41d4-a716-446655440000';
const TARGET_ID = 'tgt-arch-open-phase-fail';
const BASE =
  `/api/projects/${PROJECT_ID}/target-architectures/${TARGET_ID}/architect-conversation`;

/** An LLM client whose tool loop always throws — drives `llm-call-failed`. */
function throwingLlmClient(): ArchitectLlmClient {
  return {
    async callLlmToolLoop() {
      throw new Error('upstream LLM exploded');
    },
    async callSingleShot() {
      throw new Error('not used');
    },
  };
}

function buildApp(): express.Application {
  const app = express();
  app.use(express.json());
  app.use('/api', architectConversationRouter);
  return app;
}

describe('Open-phase capture-path FAILURE behaviour (Spec 2026-06-06, Task Group 7 gap-fill)', () => {
  let appendedTurns: ConversationTurn[];
  let writeCalls: number;

  beforeEach(() => {
    appendedTurns = [];
    writeCalls = 0;
    setArchitectConversationDeps({
      llmClient: throwingLlmClient(),
      // The writer MUST NOT be reached on the failure path — count every call.
      postCapturedDecision: (async () => {
        writeCalls += 1;
        throw new Error('postCapturedDecision must NOT be called on the loop-failure path');
      }) as never,
      resolveOpenPhaseGrounding: (async () => 'GROUNDING') as never,
      appendTurn: (async (_p: string, _t: string, turn: ConversationTurn) => {
        appendedTurns.push(turn);
      }) as never,
      loadConversation: (async () => ({
        schemaVersion: 1 as const,
        threadId: 'thr-fail',
        turns: appendedTurns,
      })) as never,
    });
  });

  afterEach(() => {
    resetArchitectConversationDeps();
    jest.clearAllMocks();
  });

  // 1 — pick: loop failure → error turn, NO adhoc.<slug> row written.
  it('POST /open-phase/pick surfaces an error turn and writes NO adhoc row when the loop fails', async () => {
    const res = await request(buildApp())
      .post(`${BASE}/open-phase/pick`)
      .send({ topicLabel: 'Batch processing', selectedValues: ['Spring Batch'] });

    // Loop failure is surfaced as a 200 error-turn envelope (NOT a 500 / throw).
    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe('error');
    expect(res.body.errorTurn.kind).toBe('error');
    // The error turn reuses the closed-union error-kind mapping (S3).
    expect(res.body.errorTurn.errorKind).toBe('llm-call-failed');

    // CRITICAL: no captured-decision row was written (no half-baked adhoc.* row).
    expect(writeCalls).toBe(0);
    // No `decision-captured` / `user-pick` turn leaked into the transcript —
    // only the `error` turn was appended.
    expect(appendedTurns.some((t) => t.kind === 'decision-captured')).toBe(false);
    expect(appendedTurns.some((t) => t.kind === 'user-pick')).toBe(false);
    expect(appendedTurns.filter((t) => t.kind === 'error')).toHaveLength(1);
  });

  // 2 — summarise: loop failure → error turn, NO note.<slug> rows written.
  it('POST /open-phase/summarise surfaces an error turn and writes NO note rows when the loop fails', async () => {
    // Seed a free-form turn so the route reconstructs a (non-empty) transcript.
    appendedTurns.push({
      kind: 'free-form-discussion',
      speaker: 'user',
      messageText: 'Cutover must be a holiday',
    });

    const res = await request(buildApp())
      .post(`${BASE}/open-phase/summarise`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe('error');
    expect(res.body.errorTurn.kind).toBe('error');
    expect(res.body.errorTurn.errorKind).toBe('llm-call-failed');

    // CRITICAL: no note.<slug> rows written → no partial/duplicate-prone notes.
    expect(writeCalls).toBe(0);
  });
});
