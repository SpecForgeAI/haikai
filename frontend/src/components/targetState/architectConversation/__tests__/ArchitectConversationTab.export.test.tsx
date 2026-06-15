/**
 * Tests for the Export-transcript toolbar in `ArchitectConversationTab`.
 *
 * Spec: 2026-05-26 Architect Conversation Enrichments (Batched #11 + #12)
 *
 * Covers (2 tests):
 *   C. Clicking the "Export transcript" button triggers a download:
 *      `URL.createObjectURL` is called with a text/markdown Blob, a temporary
 *      <a> is inserted, `click()` is invoked on it, and the Object URL is
 *      revoked.
 *   D. The button renders disabled when `turns.length === 0` (empty open
 *      session).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
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
  fetchQuestionLibraryScopes: vi.fn().mockResolvedValue({}),
  ALLOWED_SCOPE_REF_TYPES: ['service'],
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
}));

import { ArchitectConversationTab } from '../ArchitectConversationTab';
import {
  loadConversation,
  type ConversationEnvelope,
  type ConversationTurn,
} from '../../../../api/architectConversationApi';

const PROJECT_ID = 'proj-export-1';
const TARGET_ARCH_ID = 'arch-export-1';

function buildEnvelope(turns: ConversationTurn[]): ConversationEnvelope {
  return {
    threadId: 'thr-export-1',
    turns,
    currentSession: {
      sessionId: 'sess-export-1',
      status: 'open',
      openedBy: 'user-A',
      openedAt: '2026-05-26T08:00:00Z',
    },
    capturedDecisions: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('ArchitectConversationTab -- Export transcript button (Spec 2026-05-26, #12)', () => {
  it('triggers a Markdown blob download with the expected filename pattern when clicked', async () => {
    const turns: ConversationTurn[] = [
      { kind: 'open', sessionId: 'sess-export-1', openedBy: 'user-A' },
      {
        kind: 'question',
        decisionCode: 'service.language',
        promptText: 'Which language?',
        roundIndex: 1,
        staticContextLeadIn: 'Pick a language.',
      },
    ];
    vi.mocked(loadConversation).mockResolvedValue(buildEnvelope(turns));

    // jsdom does not implement these, and vi.spyOn requires the method to
    // already exist to wrap it -- define no-op stubs first so the spy can
    // attach (the assertions below verify the calls).
    if (typeof URL.createObjectURL !== 'function') {
      (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL =
        () => 'blob:stub';
    }
    if (typeof URL.revokeObjectURL !== 'function') {
      (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL =
        () => undefined;
    }
    // Mock URL.createObjectURL + revokeObjectURL.
    const createObjectUrlSpy = vi
      .spyOn(URL, 'createObjectURL')
      .mockImplementation(() => 'blob:stub-url');
    const revokeObjectUrlSpy = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => undefined);
    // Spy on anchor click (triggered by the handler on the dynamic <a>).
    const anchorClickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);

    render(
      <ArchitectConversationTab
        projectId={PROJECT_ID}
        selectedTargetArchitectureId={TARGET_ARCH_ID}
        currentUserId="user-A"
        architectureName="Target Payments v2"
      />,
    );

    const button = await screen.findByTestId(
      'architect-conversation-export-button',
    );
    expect(button).not.toBeDisabled();

    fireEvent.click(button);

    // The handler must have called createObjectURL with a Blob (the Blob is
    // the first arg to createObjectURL). Verify the MIME type via that arg.
    expect(createObjectUrlSpy).toHaveBeenCalledTimes(1);
    const blobArg = createObjectUrlSpy.mock.calls[0][0] as Blob;
    expect(blobArg.type).toBe('text/markdown');

    // Anchor click must have been invoked exactly once (the temporary <a>).
    expect(anchorClickSpy).toHaveBeenCalledTimes(1);

    // Cleanup: the Object URL should be revoked after the click.
    expect(revokeObjectUrlSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectUrlSpy).toHaveBeenCalledWith('blob:stub-url');

    // Restore spies.
    createObjectUrlSpy.mockRestore();
    revokeObjectUrlSpy.mockRestore();
    anchorClickSpy.mockRestore();
  });

  it('renders the export button as disabled when there are no turns', async () => {
    // Empty turns but an open session so the active-session render branch
    // (which carries the toolbar) is taken.
    vi.mocked(loadConversation).mockResolvedValue(buildEnvelope([]));

    render(
      <ArchitectConversationTab
        projectId={PROJECT_ID}
        selectedTargetArchitectureId={TARGET_ARCH_ID}
        currentUserId="user-A"
        architectureName="Target Payments v2"
      />,
    );

    const button = await screen.findByTestId(
      'architect-conversation-export-button',
    );
    expect(button).toBeDisabled();
  });
});
