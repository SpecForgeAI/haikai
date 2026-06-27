/**
 * Tests for Task Group 5 -- Frontend banner + SummaryPanel source-quote
 * display.
 *
 * Spec: 2026-05-25 Tech-Stack.md Pre-fill + Target-Tech-Stack.md Write
 *
 * Covers (6 tests, slight stretch over the 4-6 cap to add the explicit Q22
 * source-quote isolation assertion called out in the task brief):
 *
 *   1. Banner renders the both-files-matched variant with both filenames
 *      and the matched count.
 *   2. Banner renders the organisation-only-matched variant with no project
 *      file mention.
 *   3. Banner renders the project-only-matched variant with no organisation
 *      file mention.
 *   4. Banner renders the no-standards-found variant with the manual-only
 *      copy.
 *   5. Banner renders the failure variant with the no-retry copy (and no
 *      "Review" link).
 *   6. SummaryPanel shows the per-row source quote for a pre-fill row when
 *      the user expands it, NOT for a non-pre-fill user-walked row, and the
 *      main transcript pane never carries the source-quote text (the Q22
 *      isolation rule).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks (declared BEFORE imports)
// ---------------------------------------------------------------------------

vi.mock('../../../../api/architectConversationApi', () => ({
  loadConversation: vi.fn(),
  openConversation: vi.fn(),
  closeConversation: vi.fn(),
  answerQuestion: vi.fn(),
  acceptCascadeBatch: vi.fn(),
  overrideCascade: vi.fn(),
  revisePriorAnswer: vi.fn(),
  pinException: vi.fn(),
  getActiveTargetArchitectureId: vi.fn(),
  fetchQuestionLibraryScopes: vi.fn().mockResolvedValue({}),
  resolveCapturedAnswerLabel: vi.fn((value: unknown) => String(value)),
  ALLOWED_SCOPE_REF_TYPES: ['service'],
  OPT_OUT_ANSWER_VALUE: '(not used)',
  ArchitectConversationApiError: class extends Error {},
}));

// Spec 2026-06-05-architect-tier-gating (Half B): the tab now reads the
// cached target model via useArchitecture() to derive the default tier set.
// Provide an empty-entities model so the derivation fails open (asks all).
vi.mock('../../../../contexts/ArchitectureContext', () => ({
  useArchitecture: (() => {
    // Stable reference so the tab's tier-derivation useMemo deps don't churn
    // across renders (a fresh object each call re-fires the next-question effect).
    const m = { model: { metaModel: { entities: { services: [], app_components: [] } } } };
    return () => m;
  })(),
  // Spec 4 (Task Group 6): the tab now reads the CURRENT architecture id via
  // this hook for the vulnerability-reduction fetch. `null` here => the
  // reduction hook degrades to a null delta (no current-state fetch), which is
  // the correct non-blocking no-op for these unrelated tab tests.
  useActiveArchitectureId: () => null,
}));

import { ArchitectConversationTab } from '../ArchitectConversationTab';
import {
  loadConversation,
  type ConversationEnvelope,
  type TechStackPrefillSummaryTurn,
  type CapturedDecisionRow,
} from '../../../../api/architectConversationApi';

const PROJECT_ID = 'proj-prefill-banner-1';
const TARGET_ARCH_ID = 'target-prefill-banner-1';

function buildEnvelope(
  partial: Partial<ConversationEnvelope> & {
    turns?: ConversationEnvelope['turns'];
    capturedDecisions?: CapturedDecisionRow[];
  } = {},
): ConversationEnvelope {
  return {
    threadId: 'thr-prefill-1',
    turns: partial.turns ?? [],
    currentSession: partial.currentSession ?? {
      sessionId: 'sess-prefill-1',
      status: 'open',
      openedBy: 'user-A',
      openedAt: '2026-05-25T08:00:00Z',
    },
    capturedDecisions: partial.capturedDecisions ?? [],
  };
}

function summaryTurn(
  overrides: Partial<TechStackPrefillSummaryTurn>,
): TechStackPrefillSummaryTurn {
  return {
    kind: 'tech-stack-prefill-summary',
    bannerVariant: 'both-files-matched',
    matchedCount: 17,
    denominator: 51,
    orgFilePresent: true,
    projectFilePresent: true,
    orgFilePath: '/projects/parent/agent-os/product/tech-stack.md',
    projectFilePath:
      '/projects/parent/my-project/agent-os/product/tech-stack.md',
    partialFailureCodes: [],
    failureReason: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('ArchitectConversationTab -- Tech-Stack Pre-fill Banner (Spec 2026-05-25, Task Group 5)', () => {
  it('renders the both-files-matched variant with the matched count and both filenames', async () => {
    vi.mocked(loadConversation).mockResolvedValue(
      buildEnvelope({
        turns: [
          { kind: 'open', sessionId: 'sess-prefill-1', openedBy: 'user-A' },
          summaryTurn({}),
        ],
      }),
    );

    render(
      <ArchitectConversationTab
        projectId={PROJECT_ID}
        selectedTargetArchitectureId={TARGET_ARCH_ID}
        currentUserId="user-A"
      />,
    );

    const banner = await screen.findByTestId(
      'architect-conversation-tech-stack-prefill-banner',
    );
    expect(banner).toBeInTheDocument();
    expect(banner.getAttribute('data-banner-variant')).toBe('both-files-matched');
    expect(banner.textContent).toMatch(/17 of 51/);
    expect(banner.textContent).toMatch(/organisation/);
    expect(banner.textContent).toMatch(/project/);
    // The trailing filename is shortened from the absolute path.
    expect(banner.textContent).toMatch(/tech-stack\.md/);
    // Review link is available when matchedCount > 0.
    expect(
      screen.getByTestId('architect-conversation-tech-stack-prefill-review'),
    ).toBeInTheDocument();
  });

  it('renders the organisation-only-matched variant without referencing the project file', async () => {
    vi.mocked(loadConversation).mockResolvedValue(
      buildEnvelope({
        turns: [
          { kind: 'open', sessionId: 'sess-prefill-2', openedBy: 'user-A' },
          summaryTurn({
            bannerVariant: 'organisation-only-matched',
            matchedCount: 9,
            orgFilePresent: true,
            projectFilePresent: false,
            projectFilePath: null,
          }),
        ],
      }),
    );

    render(
      <ArchitectConversationTab
        projectId={PROJECT_ID}
        selectedTargetArchitectureId={TARGET_ARCH_ID}
        currentUserId="user-A"
      />,
    );

    const banner = await screen.findByTestId(
      'architect-conversation-tech-stack-prefill-banner',
    );
    expect(banner.getAttribute('data-banner-variant')).toBe(
      'organisation-only-matched',
    );
    expect(banner.textContent).toMatch(/9 of 51/);
    expect(banner.textContent).toMatch(/organisation tech standards/);
    // Negative assertion: the project-only-matched copy MUST NOT be present.
    expect(banner.textContent).not.toMatch(/project tech standards/);
  });

  it('renders the project-only-matched variant without referencing the organisation file', async () => {
    vi.mocked(loadConversation).mockResolvedValue(
      buildEnvelope({
        turns: [
          { kind: 'open', sessionId: 'sess-prefill-3', openedBy: 'user-A' },
          summaryTurn({
            bannerVariant: 'project-only-matched',
            matchedCount: 5,
            orgFilePresent: false,
            projectFilePresent: true,
            orgFilePath: null,
          }),
        ],
      }),
    );

    render(
      <ArchitectConversationTab
        projectId={PROJECT_ID}
        selectedTargetArchitectureId={TARGET_ARCH_ID}
        currentUserId="user-A"
      />,
    );

    const banner = await screen.findByTestId(
      'architect-conversation-tech-stack-prefill-banner',
    );
    expect(banner.getAttribute('data-banner-variant')).toBe('project-only-matched');
    expect(banner.textContent).toMatch(/5 of 51/);
    expect(banner.textContent).toMatch(/project tech standards/);
    expect(banner.textContent).not.toMatch(/organisation tech standards/);
  });

  it('renders the no-standards-found variant with the manual-only copy and no Review link', async () => {
    vi.mocked(loadConversation).mockResolvedValue(
      buildEnvelope({
        turns: [
          { kind: 'open', sessionId: 'sess-prefill-4', openedBy: 'user-A' },
          summaryTurn({
            bannerVariant: 'no-standards-found',
            matchedCount: 0,
            orgFilePresent: false,
            projectFilePresent: false,
            orgFilePath: null,
            projectFilePath: null,
          }),
        ],
      }),
    );

    render(
      <ArchitectConversationTab
        projectId={PROJECT_ID}
        selectedTargetArchitectureId={TARGET_ARCH_ID}
        currentUserId="user-A"
      />,
    );

    const banner = await screen.findByTestId(
      'architect-conversation-tech-stack-prefill-banner',
    );
    expect(banner.getAttribute('data-banner-variant')).toBe('no-standards-found');
    expect(banner.textContent).toMatch(/No tech standards found/);
    expect(banner.textContent).toMatch(/asked manually/);
    expect(
      screen.queryByTestId('architect-conversation-tech-stack-prefill-review'),
    ).toBeNull();
  });

  it('renders the failure variant with the no-retry copy and no Review link', async () => {
    vi.mocked(loadConversation).mockResolvedValue(
      buildEnvelope({
        turns: [
          { kind: 'open', sessionId: 'sess-prefill-5', openedBy: 'user-A' },
          summaryTurn({
            bannerVariant: 'failure',
            matchedCount: 0,
            failureReason:
              'Tech-stack file exceeded the 50,000-character cap (organisation); pre-fill skipped to avoid partial extraction.',
          }),
        ],
      }),
    );

    render(
      <ArchitectConversationTab
        projectId={PROJECT_ID}
        selectedTargetArchitectureId={TARGET_ARCH_ID}
        currentUserId="user-A"
      />,
    );

    const banner = await screen.findByTestId(
      'architect-conversation-tech-stack-prefill-banner',
    );
    expect(banner.getAttribute('data-banner-variant')).toBe('failure');
    expect(banner.textContent).toMatch(/pre-fill could not run/);
    expect(banner.textContent).toMatch(/asked manually/);
    // Failure variant: no retry button per spec.
    expect(
      screen.queryByTestId('architect-conversation-tech-stack-prefill-review'),
    ).toBeNull();
  });

  it('SummaryPanel shows source quote ONLY for pre-fill rows, and the main transcript pane never carries source-quote text (Q22 isolation)', async () => {
    const PREFILL_QUOTE =
      'Use Postgres 18 for all new services per Engineering Standards v3.';
    const prefillRow: CapturedDecisionRow = {
      decisionId: 'dec-prefill-1',
      decisionCode: 'db.engine',
      scopeKind: 'architecture',
      scopeRefType: null,
      scopeRefId: null,
      answerValue: JSON.stringify({
        value: 'Postgres 18',
        sourceQuote: PREFILL_QUOTE,
        sourceFile: 'tech-stack.md',
      }),
      answerSummary: 'Postgres 18',
      standardsLookupRef: null,
      supersededById: null,
      createdByTask: 'tech-stack-md-prefill',
    };
    const userWalkedRow: CapturedDecisionRow = {
      decisionId: 'dec-user-1',
      decisionCode: 'service.runtime',
      scopeKind: 'architecture',
      scopeRefType: null,
      scopeRefId: null,
      answerValue: 'Eclipse Temurin 21',
      answerSummary: null,
      standardsLookupRef: null,
      supersededById: null,
      createdByTask: 'architect-persona-conversation',
    };
    vi.mocked(loadConversation).mockResolvedValue(
      buildEnvelope({
        turns: [
          { kind: 'open', sessionId: 'sess-prefill-6', openedBy: 'user-A' },
          summaryTurn({ matchedCount: 1 }),
        ],
        capturedDecisions: [prefillRow, userWalkedRow],
      }),
    );

    render(
      <ArchitectConversationTab
        projectId={PROJECT_ID}
        selectedTargetArchitectureId={TARGET_ARCH_ID}
        currentUserId="user-A"
      />,
    );

    // Pre-fill row: has the "Show source" toggle.
    const sourceToggle = await screen.findByTestId(
      'architect-conversation-summary-source-toggle-db.engine',
    );
    expect(sourceToggle).toBeInTheDocument();

    // User-walked row: NO source toggle.
    expect(
      screen.queryByTestId(
        'architect-conversation-summary-source-toggle-service.runtime',
      ),
    ).toBeNull();

    // Source quote is NOT visible until the user expands.
    expect(
      screen.queryByTestId('architect-conversation-summary-source-db.engine'),
    ).toBeNull();

    // Click to expand.
    fireEvent.click(sourceToggle);
    await waitFor(() => {
      expect(
        screen.getByTestId('architect-conversation-summary-source-db.engine'),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByTestId(
        'architect-conversation-summary-source-quote-db.engine',
      ).textContent,
    ).toBe(PREFILL_QUOTE);

    // Q22 ISOLATION ASSERTION: the source-quote text MUST NOT appear in the
    // main transcript pane. It lives ONLY on the SummaryPanel review surface.
    const transcript = screen.getByTestId(
      'architect-conversation-transcript',
    );
    expect(transcript.textContent ?? '').not.toContain(PREFILL_QUOTE);
  });
});
