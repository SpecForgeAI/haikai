/**
 * Tests — Discovery-Review Conversation Store (Spec 3 — capstone, Task Group 3.1).
 *
 * The store persists discovery-review threads at
 *   {projectParentFolder}/threads/discovery-review/{runId}/thread.json
 * keyed by the PRIMARY run id (projectId is NOT in the path).
 *
 * Tests:
 *   1. load on a run with no thread file returns the default envelope.
 *   2. appendTurn → load round-trips, the path is keyed by the PRIMARY run id,
 *      and the in-session DB-run pairing is carried on the `open` turn (NOT the
 *      path) — a single-run thread and its DB sibling never collide on disk.
 *   3. atomic write auto-creates a missing parent directory (no thrown ENOENT).
 *
 * THREAD HYGIENE (per the spec): projectId is NOT in the path, so runs share the
 * `threads/discovery-review/` folder. `beforeEach` cleans the shared `threads/`
 * dir so runs cannot collide across tests.
 */

import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

let _testBasePath = '';

jest.mock('../../architectureModelClient', () => ({
  fetchProjectFolder: jest.fn(async () => _testBasePath),
}));

jest.mock('../../logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import {
  appendReviewTurn,
  discoveryReviewConversationPath,
  loadDiscoveryReviewConversation,
} from '../discoveryReviewConversationStore';
import type { OpenTurn } from '../reviewTurnShape';

describe('Discovery-Review Conversation Store (Spec 3, Task Group 3)', () => {
  let tmpDir: string;
  const PROJECT_ID = 'proj-dr-001';
  const CODE_RUN = 'run-code-aaa';
  const DB_RUN = 'run-db-bbb';

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'discoveryReviewStore-test-'));
    _testBasePath = tmpDir;
    // Thread hygiene: projectId is NOT in the path, so runs share the
    // `threads/discovery-review/` folder. Clean it so runs never collide.
    await fs.rm(path.join(tmpDir, 'threads'), { recursive: true, force: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('returns the default empty envelope when no thread file exists', async () => {
    const thread = await loadDiscoveryReviewConversation(PROJECT_ID, CODE_RUN);
    expect(thread.schemaVersion).toBe(1);
    expect(typeof thread.threadId).toBe('string');
    expect(thread.threadId.length).toBeGreaterThan(0);
    expect(thread.turns).toEqual([]);
  });

  it('round-trips turns keyed by the PRIMARY run id with the DB-run pairing carried on the open turn (not the path)', async () => {
    // The path is keyed by the PRIMARY run id (the code run) — projectId absent.
    const expectedPath = discoveryReviewConversationPath(tmpDir, CODE_RUN);
    expect(expectedPath).toBe(
      path.join(tmpDir, 'threads', 'discovery-review', CODE_RUN, 'thread.json'),
    );
    expect(expectedPath).not.toContain(PROJECT_ID);
    // The DB run is NOT a path segment.
    expect(expectedPath).not.toContain(DB_RUN);

    // The in-session DB-run pairing lives on the open turn.
    const openTurn: OpenTurn = {
      kind: 'open',
      sessionId: 'sess-1',
      openedBy: 'tester',
      scanPair: {
        runs: [
          { runId: CODE_RUN, scanKind: 'code', serviceId: null },
          { runId: DB_RUN, scanKind: 'database', serviceId: null },
        ],
        primaryRunId: CODE_RUN,
      },
    };
    await appendReviewTurn(PROJECT_ID, CODE_RUN, openTurn);
    await appendReviewTurn(PROJECT_ID, CODE_RUN, { kind: 'narration', text: 'hello' });

    const thread = await loadDiscoveryReviewConversation(PROJECT_ID, CODE_RUN);
    expect(thread.turns).toHaveLength(2);
    const persistedOpen = thread.turns[0] as OpenTurn;
    expect(persistedOpen.kind).toBe('open');
    expect(persistedOpen.scanPair.runs.map((r) => r.runId)).toContain(DB_RUN);

    // The file is exactly where the pure path says, under the primary run id.
    const onDisk = JSON.parse(await fs.readFile(expectedPath, 'utf8'));
    expect(onDisk.turns).toHaveLength(2);

    // A thread keyed by the DB run is a SEPARATE file (no collision).
    const dbThread = await loadDiscoveryReviewConversation(PROJECT_ID, DB_RUN);
    expect(dbThread.turns).toEqual([]);
  });

  it('atomically auto-creates the missing parent directory on append (no ENOENT)', async () => {
    // No directory exists yet for this run.
    const freshRun = 'run-fresh-ccc';
    await expect(
      appendReviewTurn(PROJECT_ID, freshRun, { kind: 'narration', text: 'first' }),
    ).resolves.not.toThrow();
    const thread = await loadDiscoveryReviewConversation(PROJECT_ID, freshRun);
    expect(thread.turns).toHaveLength(1);
  });
});
