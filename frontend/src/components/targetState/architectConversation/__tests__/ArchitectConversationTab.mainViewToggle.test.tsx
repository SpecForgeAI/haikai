/**
 * ArchitectConversationTab -- main-area view toggle (2026-08-30 UX round).
 *
 * The modernization-decisions table moved OUT of the cramped right rail into
 * the LARGE main area behind a `[Conversation | Modernization decisions]`
 * toggle. Pins:
 *
 *   1. Active session: the toggle renders; the conversation view shows by
 *      default; the decisions view is hidden-but-mounted; the right rail no
 *      longer hosts the ModernizationReviewPanel.
 *   2. Clicking "Modernization decisions" shows the table full-main; clicking
 *      "Conversation" returns (both stay mounted -- display toggling).
 *   3. AUTO-FLIP: a successful Save Conversation lands on the decisions view.
 *   4. Saved/view-only landing: the toggle is present too -- the decisions
 *      table is reachable WITHOUT an open session (the discoverability fix).
 *   5. No scanned architecture (null active id) -> no toggle, no decisions
 *      view (the review is keyed to the code scan).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
  cleanup,
} from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks (BEFORE imports)
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
  fetchNextQuestion: vi.fn().mockResolvedValue({ question: null, phase: 'preset-walk' }),
  fetchQuestionLibraryScopes: vi.fn().mockResolvedValue({}),
  resolveCapturedAnswerLabel: vi.fn((value: unknown) => String(value)),
  ALLOWED_SCOPE_REF_TYPES: ['service'],
  OPT_OUT_ANSWER_VALUE: '(not used)',
  ArchitectConversationApiError: class extends Error {},
}));

// The toggle only renders with a SCANNED architecture; per-test switchable.
let activeArchitectureId: string | null = 'arch-current-1';

vi.mock('../../../../contexts/ArchitectureContext', () => ({
  useArchitecture: (() => {
    const m = { model: { metaModel: { entities: { services: [], app_components: [] } } } };
    return () => m;
  })(),
  useActiveArchitectureId: () => activeArchitectureId,
}));

// A non-null current-architecture id would otherwise drive the REAL reduction
// hook into fetches; stub it to the inert shape the tab consumes.
vi.mock('../useVulnerabilityReduction', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../useVulnerabilityReduction')>();
  return {
    ...actual,
    useVulnerabilityReduction: () => ({
      reduction: null,
      useThisVersionFor: vi.fn(),
      recompute: vi.fn(),
      recomputeFull: vi.fn(),
      scheduleFullRecompute: vi.fn(),
    }),
  };
});

// The relocated ModernizationReviewPanel mounts with its DEFAULT deps here
// (no injection seam through the tab), so shim the api module itself.
vi.mock('../../../../api/sclModernizationApi', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../../api/sclModernizationApi')>();
  return {
    ...actual,
    fetchModernizationReview: vi.fn(),
    confirmModernizationDecisions: vi.fn(),
  };
});

import { ArchitectConversationTab } from '../ArchitectConversationTab';
import {
  loadConversation,
  closeConversation,
  type ConversationEnvelope,
} from '../../../../api/architectConversationApi';
import {
  fetchModernizationReview,
  type SclModernizationReview,
} from '../../../../api/sclModernizationApi';

const PROJECT_ID = 'proj-view-toggle-1';
const TARGET_ARCH_ID = 'target-view-toggle-1';

function modernizationReview(): SclModernizationReview {
  return {
    scan_id: 'scan-1',
    target_architecture_id: 'target-1',
    rows: [
      {
        family: 'dates',
        matcher_key: 'org.joda.time.LocalDate',
        usage_count: 3,
        example_cites: [],
        matched_rule_code: null,
        from: 'org.joda.time.LocalDate',
        default_to: 'java.time.LocalDate',
        provenance: 'ruleset_default',
        notes: null,
      },
    ],
    existing_decisions: [],
  };
}

/** Open session; `withGateDecisions` answers the close gate so Save enables. */
function buildEnvelope(withGateDecisions: boolean): ConversationEnvelope {
  return {
    threadId: 'thr-toggle-1',
    turns: [{ kind: 'open', sessionId: 'sess-toggle-1', openedBy: 'user-A' }],
    currentSession: {
      sessionId: 'sess-toggle-1',
      status: 'open',
      openedBy: 'user-A',
      openedAt: '2026-08-30T08:00:00Z',
    },
    capturedDecisions: withGateDecisions
      ? ['service.language', 'api.protocol', 'db.engine'].map((code, i) => ({
          decisionId: `d-${i}`,
          decisionCode: code,
          scopeKind: 'architecture' as const,
          scopeRefType: null,
          scopeRefId: null,
          answerValue: 'x',
          answerSummary: null,
          standardsLookupRef: null,
          supersededById: null,
        }))
      : [],
  };
}

function renderTab(props: Partial<Parameters<typeof ArchitectConversationTab>[0]> = {}) {
  render(
    <ArchitectConversationTab
      projectId={PROJECT_ID}
      selectedTargetArchitectureId={TARGET_ARCH_ID}
      currentUserId="user-A"
      architectureName="Target Payments v2"
      {...props}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  activeArchitectureId = 'arch-current-1';
  vi.mocked(fetchModernizationReview).mockResolvedValue(modernizationReview());
});

afterEach(() => cleanup());

describe('ArchitectConversationTab -- main-area view toggle (2026-08-30)', () => {
  it('renders the toggle; conversation shows by default; the right rail no longer hosts the panel', async () => {
    vi.mocked(loadConversation).mockResolvedValue(buildEnvelope(false));
    renderTab();

    await screen.findByTestId('architect-conversation-view-toggle');

    // Conversation view visible, decisions view mounted-but-hidden.
    expect(
      screen.getByTestId('architect-conversation-conversation-view'),
    ).toBeVisible();
    expect(
      screen.getByTestId('architect-conversation-decisions-view'),
    ).not.toBeVisible();
    expect(
      screen.getByTestId('architect-conversation-view-tab-conversation'),
    ).toHaveAttribute('aria-selected', 'true');

    // The right rail hosts uploads/summary/close -- NOT the decisions table.
    const rail = screen.getByTestId('architect-conversation-right-column');
    expect(within(rail).queryByTestId('modernization-review-panel')).toBeNull();
    // The panel exists exactly once, inside the main-area decisions view.
    const decisionsView = screen.getByTestId('architect-conversation-decisions-view');
    expect(
      within(decisionsView).getByTestId('modernization-review-panel'),
    ).toBeInTheDocument();
  });

  it('flips to the decisions table and back; both views stay mounted', async () => {
    vi.mocked(loadConversation).mockResolvedValue(buildEnvelope(false));
    renderTab();

    await screen.findByTestId('architect-conversation-view-toggle');
    fireEvent.click(
      screen.getByTestId('architect-conversation-view-tab-decisions'),
    );

    expect(
      screen.getByTestId('architect-conversation-decisions-view'),
    ).toBeVisible();
    expect(
      screen.getByTestId('architect-conversation-conversation-view'),
    ).not.toBeVisible();
    // The relocated panel renders its table (loaded via the real default deps
    // against the mocked api module).
    await waitFor(() =>
      expect(
        screen.getByTestId('modernization-review-table'),
      ).toBeInTheDocument(),
    );
    expect(vi.mocked(fetchModernizationReview)).toHaveBeenCalledWith(
      PROJECT_ID,
      'arch-current-1',
    );

    fireEvent.click(
      screen.getByTestId('architect-conversation-view-tab-conversation'),
    );
    expect(
      screen.getByTestId('architect-conversation-conversation-view'),
    ).toBeVisible();
    expect(
      screen.getByTestId('architect-conversation-decisions-view'),
    ).not.toBeVisible();
  });

  it('AUTO-FLIPS to the decisions view on a successful Save Conversation', async () => {
    vi.mocked(loadConversation).mockResolvedValue(buildEnvelope(true));
    vi.mocked(closeConversation).mockResolvedValue({
      closeTurn: {
        kind: 'close',
        sessionId: 'sess-toggle-1',
        closeReason: 'completed-by-user',
        summaryMarkdown: '# summary',
      },
    } as Awaited<ReturnType<typeof closeConversation>>);
    renderTab();

    const saveButton = await screen.findByTestId(
      'architect-conversation-close-button',
    );
    expect(saveButton).toBeEnabled();
    fireEvent.click(saveButton);

    // The session closes into the saved/view-only landing WITH the decisions
    // view showing (the natural next step after the question walk).
    await waitFor(() =>
      expect(
        screen.getByTestId('architect-conversation-decisions-view'),
      ).toBeVisible(),
    );
    expect(
      screen.getByTestId('architect-conversation-view-tab-decisions'),
    ).toHaveAttribute('aria-selected', 'true');
    expect(
      screen.getByTestId('architect-conversation-conversation-view'),
    ).not.toBeVisible();
  });

  it('saved/view-only landing offers the toggle too (no open session needed)', async () => {
    vi.mocked(loadConversation).mockResolvedValue({
      threadId: 'thr-saved-1',
      currentSession: null,
      turns: [{ kind: 'open', sessionId: 'sess-old-1', openedBy: 'user-A' }],
      capturedDecisions: [],
    });
    renderTab({ conversationSavedAt: '2026-08-29T10:00:00Z' });

    await screen.findByTestId('architect-conversation-view-toggle');
    // Conversation view carries the existing view-only resume affordances.
    expect(
      screen.getByTestId('architect-conversation-reopen-continue-button'),
    ).toBeVisible();

    fireEvent.click(
      screen.getByTestId('architect-conversation-view-tab-decisions'),
    );
    expect(
      screen.getByTestId('architect-conversation-decisions-view'),
    ).toBeVisible();
    await waitFor(() =>
      expect(
        screen.getByTestId('modernization-review-table'),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByTestId('architect-conversation-reopen-continue-button'),
    ).not.toBeVisible();
  });

  it('renders NO toggle and NO decisions view without a scanned architecture', async () => {
    activeArchitectureId = null;
    vi.mocked(loadConversation).mockResolvedValue(buildEnvelope(false));
    renderTab();

    await screen.findByTestId('architect-conversation-right-column');
    expect(
      screen.queryByTestId('architect-conversation-view-toggle'),
    ).toBeNull();
    expect(
      screen.queryByTestId('architect-conversation-decisions-view'),
    ).toBeNull();
  });
});
