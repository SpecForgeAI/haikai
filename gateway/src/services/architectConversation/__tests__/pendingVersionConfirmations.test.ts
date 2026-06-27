/**
 * Tests for the pending-version-confirmation turn kind + thread persistence
 * (Spec 2026-06-27-target-manifest-version-unknown-pending-questions,
 * Task Group 1, sub-task 1.1).
 *
 * Scope (data-model contract only -- NO manifest write path, NO route, NO UI):
 *   1. The new `pending-version-confirmations` turn round-trips verbatim through
 *      `appendTurn` and reloads from `thread.json`.
 *   2. Re-writing the set REPLACES it (latest-wins): the reader derives a single
 *      authoritative pending set from the LATEST such turn.
 *   3. An empty set CLEARS pending; no turn at all reads as empty.
 *   4. `assertExhaustiveTurnKind` stays honest -- an exhaustive switch that
 *      handles the new kind compiles (the default arm narrows to `never`), and
 *      the guard throws on an out-of-union value.
 *
 * Like the open-phase turn-shape test, projectId is NOT a path segment so all
 * helper tests share the threads/ tree -- the beforeEach clears it.
 */

import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

// Shared mutable base path the mocked `fetchProjectFolder` returns.
let _testBasePath = '';

jest.mock('../../architectureModelClient', () => ({
  fetchProjectFolder: jest.fn(async () => _testBasePath),
}));

jest.mock('../../logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import { loadTargetStateConversation } from '../../targetStateConversationStore';
import {
  assertExhaustiveTurnKind,
  type ConversationTurn,
  type PendingVersionConfirmationEntry,
  type PendingVersionConfirmationsTurn,
} from '../turnShape';
import {
  buildPendingVersionConfirmationsTurn,
  readLatestPendingVersionConfirmations,
  writePendingVersionConfirmations,
} from '../pendingVersionConfirmations';

const PROJECT_ID = 'proj-pending-vc-test';
const TARGET_ARCH_ID = 'target-pending-vc-test';

const entryA: PendingVersionConfirmationEntry = {
  decisionCode: 'svc.framework.web',
  framework: 'spring-boot',
  sourceFile: 'service-a/pom.xml',
  sourceQuote: 'org.springframework.boot:spring-boot-starter-web',
  tag: 'service-a',
};

const entryB: PendingVersionConfirmationEntry = {
  decisionCode: 'svc.db.driver',
  framework: 'postgresql',
  sourceFile: 'service-a/pom.xml',
  sourceQuote: 'org.postgresql:postgresql',
  tag: 'service-a',
};

describe('Pending-version-confirmations turn + persistence (Spec 2026-06-27, Task Group 1)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pendingVersionConfirmations-test-'));
    _testBasePath = tmpDir;
    await fs
      .rm(path.join(tmpDir, 'threads'), { recursive: true, force: true })
      .catch(() => undefined);
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  // ==========================================================================
  // 1 -- the new turn round-trips verbatim via appendTurn + reload
  // ==========================================================================
  it('round-trips a `pending-version-confirmations` turn through appendTurn and reloads from thread.json', async () => {
    await writePendingVersionConfirmations(PROJECT_ID, TARGET_ARCH_ID, [entryA, entryB]);

    const loaded = await loadTargetStateConversation(PROJECT_ID, TARGET_ARCH_ID);
    expect(loaded.turns).toHaveLength(1);

    const turn = loaded.turns[0] as PendingVersionConfirmationsTurn;
    expect(turn.kind).toBe('pending-version-confirmations');
    expect(turn.entries).toEqual([entryA, entryB]);

    // The read helper derives the same authoritative set from the loaded thread.
    expect(readLatestPendingVersionConfirmations(loaded)).toEqual([entryA, entryB]);
  });

  // ==========================================================================
  // 2 -- re-writing REPLACES (latest-wins): one authoritative pending set
  // ==========================================================================
  it('re-writing replaces the set (latest-wins) so a single authoritative pending turn is read', async () => {
    await writePendingVersionConfirmations(PROJECT_ID, TARGET_ARCH_ID, [entryA, entryB]);
    // Second upload recomputes a different set (entryA confirmed, only entryB pending).
    await writePendingVersionConfirmations(PROJECT_ID, TARGET_ARCH_ID, [entryB]);

    const loaded = await loadTargetStateConversation(PROJECT_ID, TARGET_ARCH_ID);
    // Append-only on disk, but the reader resolves latest-wins to one set.
    expect(readLatestPendingVersionConfirmations(loaded)).toEqual([entryB]);
  });

  // ==========================================================================
  // 3 -- empty set CLEARS pending; no turn at all reads as empty
  // ==========================================================================
  it('an empty entries set clears pending, and no pending turn reads as empty', async () => {
    // No pending turn ever written.
    const fresh = await loadTargetStateConversation(PROJECT_ID, TARGET_ARCH_ID);
    expect(readLatestPendingVersionConfirmations(fresh)).toEqual([]);

    // Write a set, then a later upload clears it with an empty set.
    await writePendingVersionConfirmations(PROJECT_ID, TARGET_ARCH_ID, [entryA]);
    await writePendingVersionConfirmations(PROJECT_ID, TARGET_ARCH_ID, []);

    const loaded = await loadTargetStateConversation(PROJECT_ID, TARGET_ARCH_ID);
    expect(readLatestPendingVersionConfirmations(loaded)).toEqual([]);
  });

  // ==========================================================================
  // 4 -- builder shape + exhaustiveness guard stays honest
  // ==========================================================================
  it('builds the typed turn and keeps `assertExhaustiveTurnKind` honest for the new kind', () => {
    const built = buildPendingVersionConfirmationsTurn([entryA]);
    expect(built).toEqual({ kind: 'pending-version-confirmations', entries: [entryA] });

    // A switch handling EVERY kind narrows the default arm to `never`; if the new
    // kind were missing from the union this file would fail to COMPILE -- that is
    // the real exhaustiveness check.
    function describeKind(turn: ConversationTurn): string {
      switch (turn.kind) {
        case 'question':
        case 'answer':
        case 'cascade-summary':
        case 'cascade-accepted':
        case 'cascade-overridden':
        case 'decision-captured':
        case 'mapping-mutation-summary':
        case 'exception-pinned':
        case 'edit-superseded':
        case 'system-skip':
        case 'error':
        case 'open':
        case 'close':
        case 'tech-stack-prefill-summary':
        case 'tier-confirmation':
        case 'open-phase-prompt':
        case 'user-raised-topic':
        case 'option-proposal':
        case 'user-pick':
        case 'free-form-discussion':
          return 'other';
        case 'pending-version-confirmations':
          return 'pending';
        default:
          return assertExhaustiveTurnKind(turn);
      }
    }

    expect(describeKind(built)).toBe('pending');
    expect(describeKind({ kind: 'open', sessionId: 's', openedBy: 'u' })).toBe('other');
    expect(() =>
      assertExhaustiveTurnKind('not-a-kind' as unknown as never),
    ).toThrow(/Unexpected conversation turn kind/);
  });
});
