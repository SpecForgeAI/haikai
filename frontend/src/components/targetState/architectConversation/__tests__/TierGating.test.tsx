/**
 * Frontend tests — Architect Tier-Gating (Spec 2026-06-05-architect-tier-gating,
 * Half B, Task Group 3).
 *
 * Covers the client-side DEFAULT tier-set derivation + the core bug fix
 * (the set is now SENT):
 *
 *   - The tab derives the three technology-tier booleans from the cached target
 *     model (`services[].app_component_id -> app_components[].tech_type`) via the
 *     shared `deriveServiceTier` helper, unioning across services.
 *   - A Service+Persistence-only model derives {ui:false, service:true,
 *     persistence:true}; an empty / all-unknown ('Other'/NULL) model FAILS OPEN
 *     to all-true (ask everything).
 *   - The derived set is SENT on `open` (`openConversation` body) and on every
 *     `next-question` (`fetchNextQuestion` 3rd arg) — previously omitted, which
 *     is the bug this spec fixes.
 *
 * GOTCHA (mock completeness): the `architectConversationApi` factory lists EVERY
 * export the tab imports (copied from StartConversation/QuestionDriver + the
 * symbols the tab additionally imports), else a partial mock throws "No X
 * export…". `useArchitecture` is a `vi.fn()` so each test can vary the model.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from '@testing-library/react';

vi.mock('../../../../api/architectConversationApi', () => ({
  loadConversation: vi.fn(),
  openConversation: vi.fn(),
  closeConversation: vi.fn(),
  captureAnswer: vi.fn(),
  acceptCascadeBatch: vi.fn(),
  overrideCascade: vi.fn(),
  revisePriorAnswer: vi.fn(),
  pinException: vi.fn(),
  fetchQuestionLibraryScopes: vi.fn().mockResolvedValue({}),
  fetchNextQuestion: vi.fn(),
  fetchPromptReadyOutput: vi.fn(),
  OPT_OUT_ANSWER_VALUE: '(not used)',
  ALLOWED_SCOPE_REF_TYPES: ['service'],
  ArchitectConversationApiError: class extends Error {},
}));

// useArchitecture is varied per test via this fn.
const mockUseArchitecture = vi.fn();
vi.mock('../../../../contexts/ArchitectureContext', () => ({
  useArchitecture: () => mockUseArchitecture(),
}));

import { ArchitectConversationTab } from '../ArchitectConversationTab';
import {
  fetchNextQuestion,
  loadConversation,
  openConversation,
} from '../../../../api/architectConversationApi';

const PROJECT_ID = 'proj-tier';
const TARGET = 'arch-tier';

const ALL_TRUE = {
  hasUiTier: true,
  hasServiceTier: true,
  hasPersistenceTier: true,
};

function modelOf(
  services: Array<{ id: string; app_component_id?: string }>,
  appComponents: Array<{ id: string; tech_type?: string }>,
) {
  return {
    model: {
      metaModel: {
        entities: {
          services,
          app_components: appComponents,
        },
      },
    },
  };
}

/** loadConversation -> an OPEN session so refreshNextQuestion fires on mount. */
function openSessionEnvelope() {
  return {
    threadId: 'thr',
    turns: [{ kind: 'open', sessionId: 's1', openedBy: 'u1' }],
    currentSession: {
      sessionId: 's1',
      status: 'open',
      openedBy: 'u1',
      openedAt: '2026-06-05T00:00:00Z',
    },
    capturedDecisions: [],
  };
}

/** loadConversation -> NO session so the "Start conversation" CTA renders. */
function noSessionEnvelope() {
  return {
    threadId: 'thr',
    turns: [],
    currentSession: null,
    capturedDecisions: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // fetchNextQuestion now returns { question, phase } (Spec 2026-06-06 TG1).
  vi.mocked(fetchNextQuestion).mockResolvedValue({
    question: null,
    phase: 'open-available',
  });
});

afterEach(() => cleanup());

describe('ArchitectConversationTab — default tier derivation from the cached model', () => {
  it('Service+Persistence-only model derives {ui:false, service:true, persistence:true} and SENDS it on next-question', async () => {
    mockUseArchitecture.mockReturnValue(
      modelOf(
        [
          { id: 'svc-api', app_component_id: 'ac-api' },
          { id: 'svc-db', app_component_id: 'ac-db' },
        ],
        [
          { id: 'ac-api', tech_type: 'Service Tier' },
          { id: 'ac-db', tech_type: 'Persistence Tier' },
        ],
      ),
    );
    vi.mocked(loadConversation).mockResolvedValue(openSessionEnvelope() as never);

    render(
      <ArchitectConversationTab
        projectId={PROJECT_ID}
        selectedTargetArchitectureId={TARGET}
        currentUserId="u1"
      />,
    );

    await waitFor(() => {
      expect(fetchNextQuestion).toHaveBeenCalledWith(PROJECT_ID, TARGET, {
        hasUiTier: false,
        hasServiceTier: true,
        hasPersistenceTier: true,
      });
    });
  });

  it('UI-only model derives {ui:true, service:false, persistence:false}', async () => {
    mockUseArchitecture.mockReturnValue(
      modelOf(
        [{ id: 'svc-ui', app_component_id: 'ac-ui' }],
        [{ id: 'ac-ui', tech_type: 'UI Tier' }],
      ),
    );
    vi.mocked(loadConversation).mockResolvedValue(openSessionEnvelope() as never);

    render(
      <ArchitectConversationTab
        projectId={PROJECT_ID}
        selectedTargetArchitectureId={TARGET}
        currentUserId="u1"
      />,
    );

    await waitFor(() => {
      expect(fetchNextQuestion).toHaveBeenCalledWith(PROJECT_ID, TARGET, {
        hasUiTier: true,
        hasServiceTier: false,
        hasPersistenceTier: false,
      });
    });
  });

  it("FAIL-OPEN: 'Other' tech_type + NULL app_component_id both contribute no tier; alongside a real Service only service is true", async () => {
    mockUseArchitecture.mockReturnValue(
      modelOf(
        [
          { id: 'svc-other', app_component_id: 'ac-other' }, // 'Other' -> Unknown
          { id: 'svc-null', app_component_id: undefined }, // NULL hop -> Unknown
          { id: 'svc-api', app_component_id: 'ac-api' }, // Service
        ],
        [
          { id: 'ac-other', tech_type: 'Other' },
          { id: 'ac-api', tech_type: 'Service Tier' },
        ],
      ),
    );
    vi.mocked(loadConversation).mockResolvedValue(openSessionEnvelope() as never);

    render(
      <ArchitectConversationTab
        projectId={PROJECT_ID}
        selectedTargetArchitectureId={TARGET}
        currentUserId="u1"
      />,
    );

    await waitFor(() => {
      expect(fetchNextQuestion).toHaveBeenCalledWith(PROJECT_ID, TARGET, {
        hasUiTier: false,
        hasServiceTier: true,
        hasPersistenceTier: false,
      });
    });
  });

  it('FAIL-OPEN: an empty / all-unknown model defaults all three tier flags true (ask everything)', async () => {
    // No services at all -> empty derived set -> fail-open all-true.
    mockUseArchitecture.mockReturnValue(modelOf([], []));
    vi.mocked(loadConversation).mockResolvedValue(openSessionEnvelope() as never);

    render(
      <ArchitectConversationTab
        projectId={PROJECT_ID}
        selectedTargetArchitectureId={TARGET}
        currentUserId="u1"
      />,
    );

    await waitFor(() => {
      expect(fetchNextQuestion).toHaveBeenCalledWith(PROJECT_ID, TARGET, ALL_TRUE);
    });
  });
});

describe('ArchitectConversationTab — open SENDS the derived tier set (the core bug fix)', () => {
  it('openConversation receives the derived relevanceContext (UI-absent) on Start', async () => {
    mockUseArchitecture.mockReturnValue(
      modelOf(
        [{ id: 'svc-api', app_component_id: 'ac-api' }],
        [{ id: 'ac-api', tech_type: 'Service Tier' }],
      ),
    );
    vi.mocked(loadConversation).mockResolvedValue(noSessionEnvelope() as never);
    vi.mocked(openConversation).mockResolvedValue({
      sessionId: 'sess-new',
      openTurn: { kind: 'open', sessionId: 'sess-new', openedBy: 'u1' },
    } as never);

    render(
      <ArchitectConversationTab
        projectId={PROJECT_ID}
        selectedTargetArchitectureId={TARGET}
        currentUserId="u1"
      />,
    );

    fireEvent.click(
      await screen.findByTestId('architect-conversation-start-button'),
    );

    await waitFor(() => {
      expect(openConversation).toHaveBeenCalledWith(PROJECT_ID, TARGET, {
        openedBy: 'u1',
        relevanceContext: {
          hasUiTier: false,
          hasServiceTier: true,
          hasPersistenceTier: false,
        },
      });
    });
  });
});
