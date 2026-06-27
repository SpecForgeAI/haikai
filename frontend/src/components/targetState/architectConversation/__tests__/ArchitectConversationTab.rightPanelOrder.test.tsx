/**
 * Tests for the right-column reorder + declutter + Title-Case headings in
 * `ArchitectConversationTab` (Spec 2026-06-27 Target-state Architect-Conversation
 * Right-Panel UX -- Task Group 1).
 *
 * Covers (3 tests):
 *   1. The right column renders its panels in the new order:
 *      DecisionsFileUploadPanel -> ManifestUploadPanel -> SummaryPanel ->
 *      CloseConversationFlow. (VulnerabilityReductionPanel sits between Summary
 *      and Close but renders nothing with a null delta, so it is asserted
 *      separately in test 3.)
 *   2. The Title-Cased box headings render ("Target Dependency Manifests",
 *      "Decisions Captured") and the removed `subheading` helper <p> copy is no
 *      longer in the DOM for either upload panel.
 *   3. The VulnerabilityReductionPanel default heading is Title-Cased
 *      ("Estimated Vulnerability Reduction").
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks (BEFORE imports) -- mirror ArchitectConversationTab.export.test.tsx
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
  ALLOWED_SCOPE_REF_TYPES: ['service'],
  ArchitectConversationApiError: class extends Error {},
}));

vi.mock('../../../../contexts/ArchitectureContext', () => ({
  useArchitecture: (() => {
    const m = { model: { metaModel: { entities: { services: [], app_components: [] } } } };
    return () => m;
  })(),
  // null current-architecture id => the reduction hook degrades to a null delta
  // (no current-state fetch), which is the correct non-blocking no-op here.
  useActiveArchitectureId: () => null,
}));

import { ArchitectConversationTab } from '../ArchitectConversationTab';
import { VulnerabilityReductionPanel } from '../../../Architecture/VulnerabilityReductionPanel';
import {
  loadConversation,
  type ConversationEnvelope,
  type ConversationTurn,
} from '../../../../api/architectConversationApi';

const PROJECT_ID = 'proj-order-1';
const TARGET_ARCH_ID = 'arch-order-1';

function buildEnvelope(turns: ConversationTurn[]): ConversationEnvelope {
  return {
    threadId: 'thr-order-1',
    turns,
    currentSession: {
      sessionId: 'sess-order-1',
      status: 'open',
      openedBy: 'user-A',
      openedAt: '2026-06-27T08:00:00Z',
    },
    capturedDecisions: [],
  };
}

const OPEN_TURNS: ConversationTurn[] = [
  { kind: 'open', sessionId: 'sess-order-1', openedBy: 'user-A' },
  {
    kind: 'question',
    decisionCode: 'service.language',
    promptText: 'Which language?',
    roundIndex: 1,
    staticContextLeadIn: 'Pick a language.',
  },
];

function renderTab() {
  render(
    <ArchitectConversationTab
      projectId={PROJECT_ID}
      selectedTargetArchitectureId={TARGET_ARCH_ID}
      currentUserId="user-A"
      architectureName="Target Payments v2"
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('ArchitectConversationTab -- right-column reorder + headings (Spec 2026-06-27, TG1)', () => {
  it('renders the right-column panels in the new order (Decisions -> Manifest -> Summary -> Close)', async () => {
    vi.mocked(loadConversation).mockResolvedValue(buildEnvelope(OPEN_TURNS));
    renderTab();

    // Wait for the active view to mount.
    await screen.findByTestId('decisions-file-upload-panel');

    const orderedIds = [
      'decisions-file-upload-panel',
      'manifest-upload-panel',
      'architect-conversation-summary-panel',
      'architect-conversation-close-flow',
    ];
    const els = orderedIds.map((id) => screen.getByTestId(id));
    for (let i = 0; i < els.length - 1; i += 1) {
      // Each panel must precede the next in document order.
      expect(
        els[i].compareDocumentPosition(els[i + 1]) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });

  it('renders Title-Cased box headings and drops the removed subheading helper copy', async () => {
    vi.mocked(loadConversation).mockResolvedValue(buildEnvelope(OPEN_TURNS));
    renderTab();

    await screen.findByTestId('manifest-upload-panel');

    // Title-Cased <h3> box headings.
    expect(screen.getByText('Target Dependency Manifests')).toBeInTheDocument();
    expect(screen.getByText('Decisions Captured')).toBeInTheDocument();

    // The removed subheading helper <p> copy is no longer in the DOM.
    expect(
      screen.queryByText(/Upload the target/i),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Already have your target-state decisions written down/i),
    ).not.toBeInTheDocument();
  });

  it('VulnerabilityReductionPanel default heading is Title-Cased', () => {
    // The empty-hint branch renders the default heading without needing a delta.
    render(<VulnerabilityReductionPanel delta={null} emptyHint="No target snapshot yet." />);
    expect(
      screen.getByText('Estimated Vulnerability Reduction'),
    ).toBeInTheDocument();
  });
});
