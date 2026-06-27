/**
 * Tests for the open-phase wire contract — Spec
 * 2026-06-06-architect-conversation-open-ended-phase, Task Group 1 (1.1).
 *
 * Scope (contract foundation only — NO LLM, NO persistence behaviour, NO UI):
 *   1. The five new durable turn kinds round-trip verbatim via the Spec-2
 *      `targetStateConversationStore` helper (representative payloads only —
 *      this is NOT an exhaustive per-field test).
 *   2. `assertExhaustiveTurnKind` stays honest: a `switch` over the union that
 *      handles every kind compiles (the exhaustiveness guard reaches the
 *      `never` default), and the guard throws on an out-of-union value.
 *   3. The `next-question` `phase` derivation: `phase: 'open-available'`
 *      STRICTLY when `selectNextQuestion` returns null (walk exhausted); the
 *      in-progress `'preset-walk'` value while a question is returned. The
 *      derivation expression mirrors the gateway route verbatim.
 *
 * Critical: this file has the project-memory `beforeEach` threads/ cleanup —
 * projectId is NOT in the path so all helper tests share the threads/ tree.
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
} from '../../targetStateConversationStore';
import {
  assertExhaustiveTurnKind,
  type ConversationPhase,
  type ConversationTurn,
  type ConversationTurnKind,
  type FreeFormDiscussionTurn,
  type OpenPhasePromptTurn,
  type OptionProposalTurn,
  type UserPickTurn,
  type UserRaisedTopicTurn,
} from '../turnShape';
import { selectNextQuestion } from '../questionSequencer';
import { QUESTION_LIBRARY } from '../../../config/architect-conversation/questionLibrary';

const PROJECT_ID = 'proj-openphase-test';
const TARGET_ARCH_ID = 'target-openphase-test';

/**
 * Pure mirror of the gateway `next-question` route's phase derivation
 * (`routes/architectConversation.ts`): the open phase is available STRICTLY
 * when the deterministic preset walk is exhausted. Kept here so the contract is
 * pinned without standing up the Express route.
 */
function derivePhase(next: unknown): ConversationPhase {
  return next === null ? 'open-available' : 'preset-walk';
}

describe('Open-phase turn shape + phase signal (Spec 2026-06-06, Task Group 1)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openPhaseTurnShape-test-'));
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
  // 1 — open-phase-prompt + user-raised-topic round-trip durably
  // ==========================================================================
  it('round-trips an `open-phase-prompt` turn (prompt + suggested areas) and a `user-raised-topic` turn', async () => {
    const prompt: OpenPhasePromptTurn = {
      kind: 'open-phase-prompt',
      promptText:
        "We've covered the standard decisions — are there other areas you'd like to decide?",
      suggestedAreas: [
        { label: 'Batch processing strategy', rationale: 'nightly Sybase jobs found in discovery' },
        { label: 'Caching layer' },
      ],
    };
    const topic: UserRaisedTopicTurn = {
      kind: 'user-raised-topic',
      topicLabel: 'Batch processing',
      topicText: 'how should the nightly batch jobs be migrated?',
    };

    await appendTurn(PROJECT_ID, TARGET_ARCH_ID, prompt);
    await appendTurn(PROJECT_ID, TARGET_ARCH_ID, topic);

    const loaded = await loadTargetStateConversation(PROJECT_ID, TARGET_ARCH_ID);
    expect(loaded.turns).toHaveLength(2);
    expect(loaded.turns[0]).toEqual(prompt);
    expect(loaded.turns[1]).toEqual(topic);
    // Suggested areas survive verbatim (advisory P3 payload).
    expect((loaded.turns[0] as OpenPhasePromptTurn).suggestedAreas).toHaveLength(2);
  });

  // ==========================================================================
  // 2 — option-proposal (single/multi + free-text escape) + user-pick round-trip
  // ==========================================================================
  it('round-trips an `option-proposal` (per-topic single/multi + "something else…" escape) and a `user-pick`', async () => {
    const single: OptionProposalTurn = {
      kind: 'option-proposal',
      topicLabel: 'Batch processing',
      selectionMode: 'single',
      options: [
        { value: 'spring-batch', label: 'Spring Batch' },
        { value: 'quartz' },
      ],
      allowFreeTextEscape: true,
      freeTextEscapeLabel: 'Something else…',
    };
    const multi: OptionProposalTurn = {
      kind: 'option-proposal',
      topicLabel: 'Observability concerns',
      selectionMode: 'multi',
      options: [{ value: 'metrics' }, { value: 'tracing' }, { value: 'structured-logs' }],
      allowFreeTextEscape: true,
    };
    const pick: UserPickTurn = {
      kind: 'user-pick',
      topicLabel: 'Batch processing',
      decisionCode: 'adhoc.batch-processing',
      selectedValues: ['spring-batch'],
    };

    await appendTurn(PROJECT_ID, TARGET_ARCH_ID, single);
    await appendTurn(PROJECT_ID, TARGET_ARCH_ID, multi);
    await appendTurn(PROJECT_ID, TARGET_ARCH_ID, pick);

    const loaded = await loadTargetStateConversation(PROJECT_ID, TARGET_ARCH_ID);
    expect(loaded.turns).toHaveLength(3);
    // Per-topic select mode is preserved (mirrors preset single-/multi-choice).
    expect((loaded.turns[0] as OptionProposalTurn).selectionMode).toBe('single');
    expect((loaded.turns[1] as OptionProposalTurn).selectionMode).toBe('multi');
    // The free-text escape marker is on every user-raised proposal (S4).
    expect((loaded.turns[0] as OptionProposalTurn).allowFreeTextEscape).toBe(true);
    // NO "Not applicable" option is ever modelled in the proposal shape (P4):
    // the only escape is the free-text one — there is no opt-out marker field.
    expect(Object.keys(single)).not.toContain('optOut');
    // The pick links to the generated adhoc.<slug> code.
    expect((loaded.turns[2] as UserPickTurn).decisionCode).toBe('adhoc.batch-processing');
  });

  // ==========================================================================
  // 3 — free-form-discussion models BOTH speaker roles
  // ==========================================================================
  it('round-trips `free-form-discussion` turns for both the user and the assistant role', async () => {
    const userMsg: FreeFormDiscussionTurn = {
      kind: 'free-form-discussion',
      speaker: 'user',
      messageText: 'What about the cut-over window for the legacy scheduler?',
    };
    const assistantMsg: FreeFormDiscussionTurn = {
      kind: 'free-form-discussion',
      speaker: 'assistant',
      messageText: 'A phased cut-over with a read-only freeze is typical here…',
    };

    await appendTurn(PROJECT_ID, TARGET_ARCH_ID, userMsg);
    await appendTurn(PROJECT_ID, TARGET_ARCH_ID, assistantMsg);

    const loaded = await loadTargetStateConversation(PROJECT_ID, TARGET_ARCH_ID);
    expect(loaded.turns).toHaveLength(2);
    expect((loaded.turns[0] as FreeFormDiscussionTurn).speaker).toBe('user');
    expect((loaded.turns[1] as FreeFormDiscussionTurn).speaker).toBe('assistant');
  });

  // ==========================================================================
  // 4 — assertExhaustiveTurnKind stays honest (compile-time + runtime)
  // ==========================================================================
  it('keeps `assertExhaustiveTurnKind` honest: an exhaustive switch compiles and the guard throws off-union', () => {
    // A switch that handles EVERY kind (including the five new ones) narrows the
    // default arm to `never`. If any kind were missing from the union/switch
    // this file would fail to COMPILE — that is the real exhaustiveness check.
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
          return 'preset';
        case 'open-phase-prompt':
        case 'user-raised-topic':
        case 'option-proposal':
        case 'user-pick':
        case 'free-form-discussion':
          return 'open-phase';
        // Spec 2026-06-27 pending-version-confirmations (added to the closed
        // union); handled here purely to keep this exhaustive switch honest.
        case 'pending-version-confirmations':
          return 'preset';
        default:
          // `turn` is narrowed to `never` here once every kind is handled —
          // passing it straight through is the exhaustiveness idiom.
          return assertExhaustiveTurnKind(turn);
      }
    }

    expect(
      describeKind({
        kind: 'open-phase-prompt',
        promptText: 'x',
        suggestedAreas: [],
      }),
    ).toBe('open-phase');
    expect(
      describeKind({ kind: 'open', sessionId: 's', openedBy: 'u' }),
    ).toBe('preset');

    // The guard is only ever reached with a value OUTSIDE the union — it must
    // throw there (cast through unknown to feign an unhandled kind).
    expect(() =>
      assertExhaustiveTurnKind('not-a-kind' as unknown as never),
    ).toThrow(/Unexpected conversation turn kind/);
  });

  // ==========================================================================
  // 5 — the closed union now lists all five new kinds (20 total)
  // ==========================================================================
  it('the closed ConversationTurnKind union contains the five open-phase kinds (21 total incl. pending-version-confirmations)', () => {
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
      'open-phase-prompt',
      'user-raised-topic',
      'option-proposal',
      'user-pick',
      'free-form-discussion',
      'pending-version-confirmations',
    ];
    expect(allKinds).toHaveLength(21);
    for (const k of [
      'open-phase-prompt',
      'user-raised-topic',
      'option-proposal',
      'user-pick',
      'free-form-discussion',
    ] as ConversationTurnKind[]) {
      expect(allKinds).toContain(k);
    }
  });

  // ==========================================================================
  // 6 — the next-question `phase` derivation (open-available ⟺ walk exhausted)
  // ==========================================================================
  it("derives phase 'open-available' STRICTLY when selectNextQuestion returns null, else 'preset-walk'", () => {
    // Walk exhausted: every library code captured → selectNextQuestion → null.
    const allAnswered = new Set(QUESTION_LIBRARY.map((e) => e.code));
    const exhausted = selectNextQuestion({ answeredCodes: allAnswered });
    expect(exhausted).toBeNull();
    expect(derivePhase(exhausted)).toBe('open-available');

    // Walk in progress: nothing captured → a real question is returned.
    const inProgress = selectNextQuestion({ answeredCodes: new Set() });
    expect(inProgress).not.toBeNull();
    expect(derivePhase(inProgress)).toBe('preset-walk');
  });
});
