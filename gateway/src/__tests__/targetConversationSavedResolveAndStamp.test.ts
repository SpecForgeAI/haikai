/**
 * Tests — Save-Resume plan sourcing decouple from "active" + save stamp
 * (Spec 2026-06-26 Target-State Conversation Save/Resume/Plan-Sourcing,
 * Task Group 3, sub-task 3.1).
 *
 * Focused inventory (6 tests):
 *   1. TargetStateDecisionsContextResolver resolves the most-recent-SAVED
 *      target (calls fetchMostRecentSavedTargetArchitectureId, NOT
 *      fetchActiveTargetArchitectureId) and feeds its decisions into the
 *      prompt-ready output.
 *   2. TargetStateDecisionsContextResolver preserves the "no target
 *      architecture defined yet" fallback AND logs the new
 *      `no_saved_conversation` reason when no conversation has been saved.
 *   3. TargetTechStackContextResolver composes the `target-tech-stack-<id>.md`
 *      filename from the SAME resolved saved id (decisions + tech-stack cannot
 *      diverge) and returns the file content when present.
 *   4. TargetTechStackContextResolver preserves the file-absent sentinel
 *      ("no migration target tech stack written yet") when the saved target
 *      exists but no tech-stack file is on disk.
 *   5. Close handler calls the stamp endpoint AFTER CloseTurn append +
 *      tech-stack write, and reports it additively on the close payload.
 *   6. Close handler is fail-soft: a stamp failure does NOT abort the close
 *      turn (still 200, closeTurn + targetTechStackWrite still present, stamp
 *      reported as failed).
 */

// ---------------------------------------------------------------------------
// Module mocks (declared before importing the units under test)
// ---------------------------------------------------------------------------

jest.mock('../services/targetStateCapturedDecisionsClient', () => ({
  fetchActiveTargetArchitectureId: jest.fn(),
  fetchMostRecentSavedTargetArchitectureId: jest.fn(),
  fetchLatestCapturedDecisions: jest.fn(),
  stampConversationSaved: jest.fn(),
}));

jest.mock('../services/targetManifestArtifactsClient', () => ({
  fetchLatestTargetManifestArtifacts: jest.fn(async () => []),
}));

jest.mock('../services/architectureModelClient', () => {
  const actual = jest.requireActual('../services/architectureModelClient');
  return {
    ...actual,
    fetchProjectFolder: jest.fn(),
    fetchProductName: jest.fn(),
  };
});

jest.mock('../services/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import request from 'supertest';
import express from 'express';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  TargetStateDecisionsContextResolver,
  TargetTechStackContextResolver,
} from '../services/contextResolvers';
import {
  fetchActiveTargetArchitectureId,
  fetchMostRecentSavedTargetArchitectureId,
  fetchLatestCapturedDecisions,
  stampConversationSaved,
  type TargetStateCapturedDecision,
} from '../services/targetStateCapturedDecisionsClient';
import {
  fetchProjectFolder,
  fetchProductName,
} from '../services/architectureModelClient';
import {
  architectConversationRouter,
  setArchitectConversationDeps,
  resetArchitectConversationDeps,
} from '../routes/architectConversation';

const mockSaved = fetchMostRecentSavedTargetArchitectureId as jest.MockedFunction<
  typeof fetchMostRecentSavedTargetArchitectureId
>;
const mockActive = fetchActiveTargetArchitectureId as jest.MockedFunction<
  typeof fetchActiveTargetArchitectureId
>;
const mockDecisions = fetchLatestCapturedDecisions as jest.MockedFunction<
  typeof fetchLatestCapturedDecisions
>;
const mockStamp = stampConversationSaved as jest.MockedFunction<typeof stampConversationSaved>;
const mockProjFolder = fetchProjectFolder as jest.MockedFunction<typeof fetchProjectFolder>;
const mockProdName = fetchProductName as jest.MockedFunction<typeof fetchProductName>;

function decision(
  overrides: Partial<TargetStateCapturedDecision> = {},
): TargetStateCapturedDecision {
  return {
    decisionId: 'd1',
    projectId: 'proj-test',
    targetArchitectureId: 'target-saved-1',
    decisionCode: 'db.engine',
    scopeKind: 'architecture',
    scopeRefType: null,
    scopeRefId: null,
    answerValue: 'Postgres 18',
    answerSummary: 'Postgres 18',
    standardsLookupRef: null,
    conversationThreadId: null,
    conversationTurnRef: null,
    createdAt: '2026-06-26T12:00:00Z',
    createdByTask: 'architect-persona--target-state-conversation',
    supersededById: null,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ===========================================================================
// Resolver decouple from "active"
// ===========================================================================

test('decisions resolver sources the most-recent-SAVED target, not the active target', async () => {
  mockSaved.mockResolvedValue({ savedTargetArchitectureId: 'target-saved-1' });
  mockDecisions.mockResolvedValue([decision({ answerSummary: 'Postgres 18' })]);

  const resolver = new TargetStateDecisionsContextResolver();
  const out = await resolver.resolve('proj-test', 'project:proj-test:hub');

  // The saved finder drives the resolution; the active finder is NOT consulted.
  expect(mockSaved).toHaveBeenCalledTimes(1);
  expect(mockSaved).toHaveBeenCalledWith('proj-test');
  expect(mockActive).not.toHaveBeenCalled();

  // Decisions are fetched against the resolved SAVED id.
  expect(mockDecisions).toHaveBeenCalledWith('proj-test', 'target-saved-1');
  expect(out).toContain('`db.engine` = Postgres 18');
});

test('decisions resolver keeps the "no target architecture defined yet" fallback + logs no_saved_conversation', async () => {
  mockSaved.mockResolvedValue({ savedTargetArchitectureId: null });
  const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

  const resolver = new TargetStateDecisionsContextResolver();
  const out = await resolver.resolve('proj-test', 'project:proj-test:hub');

  expect(out).toBe('no target architecture defined yet');
  // The captured-decisions list must be skipped when no saved conversation exists.
  expect(mockDecisions).not.toHaveBeenCalled();
  expect(logSpy).toHaveBeenCalledWith(
    expect.stringContaining('reason=no_saved_conversation'),
  );

  logSpy.mockRestore();
});

test('tech-stack resolver names target-tech-stack-<id>.md from the SAME resolved saved id', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'saved-resolve-test-'));
  try {
    // BOTH resolvers consult the SAME saved finder, so the same id flows into
    // the decisions lookup AND the tech-stack filename -- they cannot diverge.
    mockSaved.mockResolvedValue({ savedTargetArchitectureId: 'TARGET-SAVED-1' });
    mockProjFolder.mockResolvedValue(root);
    mockProdName.mockResolvedValue('alpha-project');

    const dir = path.join(root, 'alpha-project', 'agent-os', 'product');
    await fs.mkdir(dir, { recursive: true });
    // The resolver lowercases the id when composing the filename.
    await fs.writeFile(
      path.join(dir, 'target-tech-stack-target-saved-1.md'),
      '# Target Tech Stack\n- Java 21',
      'utf-8',
    );

    const resolver = new TargetTechStackContextResolver();
    const out = await resolver.resolve('proj-test', 'thread-key');

    expect(out).toContain('# Target Tech Stack');
    expect(out).toContain('Java 21');
    expect(mockSaved).toHaveBeenCalledWith('proj-test');
    expect(mockActive).not.toHaveBeenCalled();
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('tech-stack resolver keeps the file-absent sentinel when the saved target exists but no file is written', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'saved-resolve-absent-'));
  try {
    mockSaved.mockResolvedValue({ savedTargetArchitectureId: 'TARGET-SAVED-1' });
    mockProjFolder.mockResolvedValue(root);
    mockProdName.mockResolvedValue('alpha-project');
    // No file written on disk.

    const resolver = new TargetTechStackContextResolver();
    const out = await resolver.resolve('proj-test', 'thread-key');

    expect(out).toBe('no migration target tech stack written yet');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

// ===========================================================================
// Close handler: stamp after CloseTurn + tech-stack write, fail-soft
// ===========================================================================

const PROJECT_ID = 'proj-close';
const TARGET_ARCH_ID = 'target-close-1';
const CLOSE_URL = `/api/projects/${PROJECT_ID}/target-architectures/${TARGET_ARCH_ID}/architect-conversation/close`;

function buildApp(): express.Application {
  const app = express();
  app.use(express.json());
  app.use('/api', architectConversationRouter);
  return app;
}

const CLOSE_BODY = {
  sessionId: 'sess-1',
  closeReason: 'completed-by-user',
  summaryMarkdown: '## Summary\n- done',
};

afterEach(() => {
  resetArchitectConversationDeps();
});

test('close handler stamps conversation-saved AFTER CloseTurn append + tech-stack write (additive on the payload)', async () => {
  const callOrder: string[] = [];

  mockStamp.mockImplementation(async () => {
    callOrder.push('stamp');
    return { conversationSavedAt: '2026-06-26T12:34:56Z' };
  });

  setArchitectConversationDeps({
    appendTurn: (async () => {
      callOrder.push('close-turn');
    }) as never,
    stampConversationSaved: mockStamp,
    // Hermetic tech-stack writer: records its write, succeeds with no real AMS.
    writeTargetTechStackDeps: {
      fetchProjectFolder: (async () => '/tmp/org-root') as never,
      fetchProductName: (async () => 'proj') as never,
      fetchLatestCapturedDecisions: (async () => []) as never,
      mkdir: (async () => undefined) as never,
      writeFile: (async () => {
        callOrder.push('tech-stack-write');
      }) as never,
      rename: (async () => undefined) as never,
    },
  });

  const res = await request(buildApp()).post(CLOSE_URL).send(CLOSE_BODY);

  expect(res.status).toBe(200);
  expect(res.body.closeTurn).toBeDefined();
  expect(res.body.targetTechStackWrite).toBeDefined();
  expect(res.body.conversationSavedStamp).toEqual({
    kind: 'saved',
    conversationSavedAt: '2026-06-26T12:34:56Z',
  });

  // The stamp ran with the route's path params...
  expect(mockStamp).toHaveBeenCalledWith(PROJECT_ID, TARGET_ARCH_ID);
  // ...and strictly AFTER the CloseTurn append + the tech-stack write.
  expect(callOrder).toEqual(['close-turn', 'tech-stack-write', 'stamp']);
});

test('close handler is fail-soft: a stamp failure does not abort the close turn', async () => {
  mockStamp.mockRejectedValue(new Error('AMS conversation-saved 503'));

  setArchitectConversationDeps({
    appendTurn: (async () => undefined) as never,
    stampConversationSaved: mockStamp,
    writeTargetTechStackDeps: {
      fetchProjectFolder: (async () => '/tmp/org-root') as never,
      fetchProductName: (async () => 'proj') as never,
      fetchLatestCapturedDecisions: (async () => []) as never,
      mkdir: (async () => undefined) as never,
      writeFile: (async () => undefined) as never,
      rename: (async () => undefined) as never,
    },
  });

  const res = await request(buildApp()).post(CLOSE_URL).send(CLOSE_BODY);

  // Close still succeeds; the stamp failure is surfaced additively, not fatal.
  expect(res.status).toBe(200);
  expect(res.body.closeTurn).toBeDefined();
  expect(res.body.targetTechStackWrite).toBeDefined();
  expect(res.body.conversationSavedStamp.kind).toBe('failed');
  expect(res.body.conversationSavedStamp.conversationSavedAt).toBeNull();
  expect(res.body.conversationSavedStamp.reason).toContain('503');
});
