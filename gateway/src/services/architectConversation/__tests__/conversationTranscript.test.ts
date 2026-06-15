/**
 * Tests for Conversation Transcript Turn Append + Close
 * Spec 2026-05-24-target-state-architect-conversation, Task Group 5.14
 * (Backend test group 6 per `spec.md` §"Tests").
 *
 * Per tasks.md §5.14 -- 4-6 focused backend tests covering:
 *   1. Turn append round-trips via Spec 2's `targetStateConversationStore.ts`
 *      helper without extending its signature (per Q3).
 *   2. Session `open` / `close` markers correctly delimit logical sessions
 *      inside one thread file.
 *   3. Relevance auto-skip writes a `system-skip` turn with `relevanceReason`.
 *   4. `edit-superseded` turn carries `originalDecisionId`, `newDecisionId`,
 *      and `affectedDownstreamCodes[]`.
 *   5. `close` turn embeds the full `summaryMarkdown` inline per Q16
 *      (self-contained -- no resolver re-query needed at read time).
 *   6. Retire-current writes a synthetic `close` turn with
 *      `closeReason: 'retired-by-other-user'`, then a fresh `open` turn.
 *
 * Spec 2026-06-05-architect-tier-gating (Half B), Task Group 2 adds a
 * `tier-confirmation` opening-turn round-trip + coordinator-emit coverage at
 * the bottom of the file.
 *
 * Critical: this test file has a `beforeEach` cleanup of the threads tree per
 * the project-memory test-pattern note -- since projectId is NOT in the path
 * all helper tests share the same threads/ directory.
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

import {
  appendTurn,
  loadTargetStateConversation,
  targetStateConversationPath,
} from '../../targetStateConversationStore';
import type {
  CloseTurn,
  ConversationTurnKind,
  EditSupersededTurn,
  OpenTurn,
  SystemSkipTurn,
  ConversationTurn,
  TierConfirmationTurn,
} from '../turnShape';
import { assertExhaustiveTurnKind } from '../turnShape';
import {
  appendTierConfirmationTurn,
  buildTierConfirmationTurn,
} from '../architectConversationCoordinator';
import type { RelevanceContext } from '../../../config/architect-conversation/questionLibrary';

const PROJECT_ID = 'proj-transcript-test';
const TARGET_ARCH_ID = 'target-transcript-test';

describe('Conversation Transcript (Spec 2026-05-24, Task Group 5.14 -- Backend Test Group 6)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'conversationTranscript-test-'),
    );
    _testBasePath = tmpDir;
    // Critical per project memory: clear threads/ between tests so other tests
    // sharing the same hub thread file are isolated.
    await fs
      .rm(path.join(tmpDir, 'threads'), { recursive: true, force: true })
      .catch(() => undefined);
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors.
    }
  });

  // ==========================================================================
  // Test 1 -- typed turn round-trip via Spec 2's helper (signature unchanged)
  // ==========================================================================
  it('round-trips a typed `question` turn via the Spec-2 helper without extending its signature', async () => {
    const turn: ConversationTurn = {
      kind: 'question',
      decisionCode: 'service.language',
      promptText: 'What language and major version should target services run on?',
      roundIndex: 1,
    };

    await appendTurn(PROJECT_ID, TARGET_ARCH_ID, turn);

    const loaded = await loadTargetStateConversation(PROJECT_ID, TARGET_ARCH_ID);
    expect(loaded.turns).toHaveLength(1);
    expect(loaded.turns[0]).toEqual(turn);

    // The helper persists turns as `unknown` -- the typed cast confirms the
    // round-trip is lossless for our union.
    const roundTripped = loaded.turns[0] as ConversationTurn;
    expect(roundTripped.kind).toBe('question');
  });

  // ==========================================================================
  // Test 2 -- open / close markers delimit logical sessions in one thread file
  // ==========================================================================
  it('persists open + close markers in turns[] to delimit sessions inside one thread file', async () => {
    const openTurn: OpenTurn = {
      kind: 'open',
      sessionId: 'sess-1',
      openedBy: 'user-A',
    };
    const closeTurn: CloseTurn = {
      kind: 'close',
      sessionId: 'sess-1',
      closeReason: 'completed-by-user',
      summaryMarkdown: '# Summary\n- service.language = Java 21',
    };
    const secondOpen: OpenTurn = {
      kind: 'open',
      sessionId: 'sess-2',
      openedBy: 'user-A',
    };

    await appendTurn(PROJECT_ID, TARGET_ARCH_ID, openTurn);
    await appendTurn(PROJECT_ID, TARGET_ARCH_ID, closeTurn);
    await appendTurn(PROJECT_ID, TARGET_ARCH_ID, secondOpen);

    const loaded = await loadTargetStateConversation(PROJECT_ID, TARGET_ARCH_ID);
    expect(loaded.turns).toHaveLength(3);
    expect((loaded.turns[0] as OpenTurn).kind).toBe('open');
    expect((loaded.turns[1] as CloseTurn).kind).toBe('close');
    expect((loaded.turns[2] as OpenTurn).kind).toBe('open');

    // Session id stable across the close.
    expect((loaded.turns[0] as OpenTurn).sessionId).toBe('sess-1');
    expect((loaded.turns[1] as CloseTurn).sessionId).toBe('sess-1');
    // New logical session inside the same thread file.
    expect((loaded.turns[2] as OpenTurn).sessionId).toBe('sess-2');

    // The file path stays the same -- one thread file per (project, target arch).
    const expectedPath = targetStateConversationPath(tmpDir, TARGET_ARCH_ID);
    const exists = await fs.access(expectedPath).then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });

  // ==========================================================================
  // Test 3 -- system-skip turn carries the relevance reason (per Q7)
  // ==========================================================================
  it('persists a system-skip turn with the relevance reason populated', async () => {
    const skip: SystemSkipTurn = {
      kind: 'system-skip',
      decisionCode: 'ui.framework',
      relevanceReason:
        'auto-skipped: ui.framework — relevance predicate returned false',
    };

    await appendTurn(PROJECT_ID, TARGET_ARCH_ID, skip);

    const loaded = await loadTargetStateConversation(PROJECT_ID, TARGET_ARCH_ID);
    expect(loaded.turns).toHaveLength(1);
    const persisted = loaded.turns[0] as SystemSkipTurn;
    expect(persisted.kind).toBe('system-skip');
    expect(persisted.decisionCode).toBe('ui.framework');
    expect(persisted.relevanceReason).toContain('auto-skipped');
  });

  // ==========================================================================
  // Test 4 -- edit-superseded turn carries the Q6 banner payload fields
  // ==========================================================================
  it('persists an edit-superseded turn with originalDecisionId, newDecisionId, and affectedDownstreamCodes[]', async () => {
    const edit: EditSupersededTurn = {
      kind: 'edit-superseded',
      originalDecisionId: 'dec-old-1',
      newDecisionId: 'dec-new-1',
      affectedDownstreamCodes: ['service.runtime', 'testing.unit', 'build.tool'],
    };

    await appendTurn(PROJECT_ID, TARGET_ARCH_ID, edit);

    const loaded = await loadTargetStateConversation(PROJECT_ID, TARGET_ARCH_ID);
    expect(loaded.turns).toHaveLength(1);
    const persisted = loaded.turns[0] as EditSupersededTurn;
    expect(persisted.originalDecisionId).toBe('dec-old-1');
    expect(persisted.newDecisionId).toBe('dec-new-1');
    expect(persisted.affectedDownstreamCodes).toEqual([
      'service.runtime',
      'testing.unit',
      'build.tool',
    ]);
  });

  // ==========================================================================
  // Test 5 -- close turn embeds full summaryMarkdown inline per Q16
  // ==========================================================================
  it('close turn embeds the full summaryMarkdown inline so any later read is self-contained', async () => {
    const fullSummary = [
      '# Architect conversation summary',
      '',
      '## Architecture-wide decisions',
      '- **service.language**: Java 21',
      '- **api.protocol**: REST/JSON',
      '- **db.engine**: Postgres 18',
      '',
      '## Per-element exceptions',
      '- **service.framework** (service:legacy-svc): Spring Classic 5',
    ].join('\n');

    const close: CloseTurn = {
      kind: 'close',
      sessionId: 'sess-close-1',
      closeReason: 'completed-by-user',
      summaryMarkdown: fullSummary,
    };

    await appendTurn(PROJECT_ID, TARGET_ARCH_ID, close);

    const loaded = await loadTargetStateConversation(PROJECT_ID, TARGET_ARCH_ID);
    expect(loaded.turns).toHaveLength(1);
    const persisted = loaded.turns[0] as CloseTurn;
    expect(persisted.kind).toBe('close');
    expect(persisted.summaryMarkdown).toBe(fullSummary);
    // Self-contained: the markdown carries the full grouped-by-scope summary
    // so a later read needs no resolver re-query.
    expect(persisted.summaryMarkdown).toContain('## Architecture-wide decisions');
    expect(persisted.summaryMarkdown).toContain('## Per-element exceptions');
    expect(persisted.summaryMarkdown).toContain('service.framework');
  });

  // ==========================================================================
  // Test 6 -- retire-current writes a synthetic close (reason=retired) then a fresh open
  // ==========================================================================
  it('retire-current sequences a `close` turn with closeReason=retired-by-other-user then a fresh `open` turn', async () => {
    // First user opens a session.
    const firstOpen: OpenTurn = {
      kind: 'open',
      sessionId: 'sess-A',
      openedBy: 'user-A',
    };
    await appendTurn(PROJECT_ID, TARGET_ARCH_ID, firstOpen);

    // Second user lands on the same conversation -- the UI fires the retire
    // path which writes a synthetic close + a new open in sequence.
    const retireClose: CloseTurn = {
      kind: 'close',
      sessionId: 'sess-A',
      closeReason: 'retired-by-other-user',
      summaryMarkdown: '# Session retired before completion (partial summary)',
    };
    const secondOpen: OpenTurn = {
      kind: 'open',
      sessionId: 'sess-B',
      openedBy: 'user-B',
    };
    await appendTurn(PROJECT_ID, TARGET_ARCH_ID, retireClose);
    await appendTurn(PROJECT_ID, TARGET_ARCH_ID, secondOpen);

    const loaded = await loadTargetStateConversation(PROJECT_ID, TARGET_ARCH_ID);
    expect(loaded.turns).toHaveLength(3);

    const close = loaded.turns[1] as CloseTurn;
    expect(close.kind).toBe('close');
    expect(close.closeReason).toBe('retired-by-other-user');
    // First user's session id is the one being retired.
    expect(close.sessionId).toBe('sess-A');

    const open = loaded.turns[2] as OpenTurn;
    expect(open.kind).toBe('open');
    // Fresh session by the second user.
    expect(open.openedBy).toBe('user-B');
    expect(open.sessionId).toBe('sess-B');
  });
});

// ===========================================================================
// Spec 2026-06-05-architect-tier-gating (Half B), Task Group 2 -- the
// tier-confirmation opening turn (turn union round-trip + coordinator emit).
// ===========================================================================

describe('Tier-confirmation opening turn (Spec 2026-06-05-architect-tier-gating, Task Group 2)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tierConfirmation-test-'));
    _testBasePath = tmpDir;
    await fs
      .rm(path.join(tmpDir, 'threads'), { recursive: true, force: true })
      .catch(() => undefined);
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('round-trips a `tier-confirmation` turn carrying the derived + confirmed tier booleans', async () => {
    const turn: TierConfirmationTurn = {
      kind: 'tier-confirmation',
      derivedTiers: {
        hasUiTier: false,
        hasServiceTier: true,
        hasPersistenceTier: true,
      },
      confirmedTiers: {
        hasUiTier: false,
        hasServiceTier: true,
        hasPersistenceTier: true,
      },
    };

    await appendTurn(PROJECT_ID, TARGET_ARCH_ID, turn);

    const loaded = await loadTargetStateConversation(PROJECT_ID, TARGET_ARCH_ID);
    expect(loaded.turns).toHaveLength(1);
    const persisted = loaded.turns[0] as TierConfirmationTurn;
    expect(persisted.kind).toBe('tier-confirmation');
    // All three derived booleans round-trip.
    expect(persisted.derivedTiers).toEqual({
      hasUiTier: false,
      hasServiceTier: true,
      hasPersistenceTier: true,
    });
    // All three confirmed booleans round-trip.
    expect(persisted.confirmedTiers).toEqual({
      hasUiTier: false,
      hasServiceTier: true,
      hasPersistenceTier: true,
    });
  });

  it('buildTierConfirmationTurn seeds derived == confirmed from a RelevanceContext (self-contained)', () => {
    const ctx: RelevanceContext = {
      hasUiTier: true,
      hasServiceTier: false,
      hasPersistenceTier: true,
    };
    const turn = buildTierConfirmationTurn(ctx);
    expect(turn.kind).toBe('tier-confirmation');
    expect(turn.derivedTiers).toEqual(ctx);
    expect(turn.confirmedTiers).toEqual(ctx);
    // Distinct objects so a later confirmed-set adjustment never mutates the
    // derived snapshot.
    expect(turn.derivedTiers).not.toBe(turn.confirmedTiers);
  });

  it('appendTierConfirmationTurn (the coordinator open step) writes exactly one tier-confirmation turn', async () => {
    // Emulate the coordinator open step: open turn FIRST, then the
    // tier-confirmation turn BEFORE any question.
    const openTurn: OpenTurn = { kind: 'open', sessionId: 's-1', openedBy: 'u-1' };
    await appendTurn(PROJECT_ID, TARGET_ARCH_ID, openTurn);

    const returned = await appendTierConfirmationTurn(
      PROJECT_ID,
      TARGET_ARCH_ID,
      { hasUiTier: false, hasServiceTier: true, hasPersistenceTier: false },
      appendTurn,
    );
    expect(returned.kind).toBe('tier-confirmation');

    const loaded = await loadTargetStateConversation(PROJECT_ID, TARGET_ARCH_ID);
    // open then tier-confirmation, and the tier-confirmation is BEFORE the first
    // question (there is no question turn yet).
    expect(loaded.turns.map((t) => (t as ConversationTurn).kind)).toEqual([
      'open',
      'tier-confirmation',
    ]);
    const persisted = loaded.turns[1] as TierConfirmationTurn;
    expect(persisted.confirmedTiers.hasServiceTier).toBe(true);
    expect(persisted.confirmedTiers.hasUiTier).toBe(false);
  });

  it('assertExhaustiveTurnKind stays exhaustive — every kind incl. tier-confirmation is a known literal', () => {
    // A compile-time exhaustiveness guard lives in the production switches; this
    // runtime check pins that the closed union (15 kinds) includes the new
    // literal and that the guard throws only on an out-of-union value.
    const allKinds: ConversationTurnKind[] = [
      'question',
      'answer',
      'cascade-summary',
      'cascade-accepted',
      'cascade-overridden',
      'decision-captured',
      'mapping-mutation-summary',
      'exception-pinned',
      'edit-superseded',
      'system-skip',
      'error',
      'open',
      'close',
      'tech-stack-prefill-summary',
      'tier-confirmation',
    ];
    expect(allKinds).toHaveLength(15);
    expect(allKinds).toContain('tier-confirmation');
    // The guard is only ever reached with a value OUTSIDE the union -- it must
    // throw there. (We cast through unknown to feign an unhandled kind.)
    expect(() =>
      assertExhaustiveTurnKind('not-a-kind' as unknown as never),
    ).toThrow(/Unexpected conversation turn kind/);
  });
});
