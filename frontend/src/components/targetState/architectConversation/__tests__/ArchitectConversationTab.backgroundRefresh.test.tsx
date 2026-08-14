/**
 * Background envelope refresh keeps the tab subtree MOUNTED (2026-08-14).
 *
 * The live failure: after a manifest upload the panel called
 * `onUploaded -> refreshEnvelope()`, which set `loading=true` — and the tab's
 * render gate swapped the ENTIRE subtree for the full-screen
 * "Loading conversation..." view. Every child's local state was destroyed
 * milliseconds after the upload completed: the manifest panel's response, its
 * persist banners, its status lists. To the operator the upload looked like it
 * "never happened" (and the persist-failure banner that would have named the
 * broken AMS write was eaten too).
 *
 * Pin: with an envelope already loaded and a SECOND loadConversation left
 * pending forever (a refresh in flight), an upload's persist banner renders
 * AND STAYS — the loader never replaces the mounted subtree.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks (BEFORE imports) — mirror ArchitectConversationTab.rightPanelOrder.
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
    const m = {
      model: {
        metaModel: {
          entities: {
            // One target Service so the manifest picker has an option.
            services: [{ id: 'svc-msk7s63i-x72go', name: 'Orders Service' }],
            app_components: [],
          },
        },
      },
    };
    return () => m;
  })(),
  // null current-architecture id => the reduction hook degrades to a null
  // delta (no current-state fetch) — the correct non-blocking no-op here.
  useActiveArchitectureId: () => null,
}));

import { ArchitectConversationTab } from '../ArchitectConversationTab';
import {
  loadConversation,
  type ConversationEnvelope,
  type ConversationTurn,
} from '../../../../api/architectConversationApi';

const PROJECT_ID = 'proj-refresh-1';
const TARGET_ARCH_ID = 'arch-refresh-1';

function buildEnvelope(): ConversationEnvelope {
  const turns: ConversationTurn[] = [
    { kind: 'open', sessionId: 'sess-r-1', openedBy: 'user-A' },
  ];
  return {
    threadId: 'thr-refresh-1',
    turns,
    currentSession: {
      sessionId: 'sess-r-1',
      status: 'open',
      openedBy: 'user-A',
      openedAt: '2026-08-14T08:00:00Z',
    },
    capturedDecisions: [],
  } as ConversationEnvelope;
}

/** Upload response carrying a SUCCESSFUL persist outcome. */
const UPLOAD_RESPONSE = {
  parsedManifests: [],
  droppedManifests: [],
  summary: { parsedCount: 1, droppedCount: 0, totalDeclaredDependencies: 0 },
  autoAnswer: null,
  manifestPersist: {
    status: 'ok',
    artifactCount: 1,
    tags: ['orders-service'],
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  // The manifest panel's default deps POST via global fetch; the onUploaded
  // side-effects (next-question etc.) may fetch too — answer everything with
  // the upload response (only the target-manifests POST reads its body shape).
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(UPLOAD_RESPONSE),
  }) as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
});

describe('ArchitectConversationTab — background refresh keeps the subtree (2026-08-14)', () => {
  it('an upload\'s persist banner renders AND SURVIVES the post-upload envelope refresh', async () => {
    // First load resolves; the post-upload refresh stays IN FLIGHT forever —
    // pre-fix that pending refresh replaced the whole tab with the loader.
    vi.mocked(loadConversation)
      .mockResolvedValueOnce(buildEnvelope())
      .mockImplementation(() => new Promise(() => undefined));

    render(
      <ArchitectConversationTab
        projectId={PROJECT_ID}
        selectedTargetArchitectureId={TARGET_ARCH_ID}
        currentUserId="user-A"
        architectureName="Target Payments v2"
      />,
    );

    // Active view mounted.
    const fileInput = await screen.findByTestId('manifest-file-input');

    // Stage a pom, bind the service, upload.
    fireEvent.change(fileInput, {
      target: { files: [new File(['<project/>'], 'pom.xml', { type: 'text/xml' })] },
    });
    fireEvent.change(screen.getByTestId('manifest-service-select-0'), {
      target: { value: 'svc-msk7s63i-x72go' },
    });
    fireEvent.click(screen.getByTestId('manifest-upload-submit'));

    // The persist banner appears...
    const banner = await screen.findByTestId('manifest-persist-ok');
    expect(banner.textContent).toContain('re-expand the foundations epic');

    // ...and STAYS: the in-flight envelope refresh must NOT swap the mounted
    // subtree for the full-screen loader (the pre-fix behavior that made
    // every upload look like it never happened).
    expect(screen.queryByTestId('architect-conversation-loading')).toBeNull();
    expect(screen.getByTestId('manifest-persist-ok')).toBeTruthy();
    expect(screen.getByTestId('manifest-upload-panel')).toBeTruthy();
  });

  it('the manifest picker offers the PARENT-SUPPLIED target services, not the context model (2026-08-14)', async () => {
    vi.mocked(loadConversation).mockResolvedValue(buildEnvelope());

    render(
      <ArchitectConversationTab
        projectId={PROJECT_ID}
        selectedTargetArchitectureId={TARGET_ARCH_ID}
        currentUserId="user-A"
        architectureName="Target Payments v2"
        manifestServiceOptions={[{ id: 'svc-target-9', name: 'Target Orders Service' }]}
      />,
    );

    const fileInput = await screen.findByTestId('manifest-file-input');
    fireEvent.change(fileInput, {
      target: { files: [new File(['<project/>'], 'pom.xml', { type: 'text/xml' })] },
    });

    const select = screen.getByTestId('manifest-service-select-0') as HTMLSelectElement;
    const values = Array.from(select.querySelectorAll('option')).map((o) =>
      o.getAttribute('value'),
    );
    // The TARGET draft's element id is offered; the context model's
    // CURRENT-STATE id (which fails the AMS ownership validation) is NOT.
    expect(values).toEqual(['', 'svc-target-9']);
    expect(values).not.toContain('svc-msk7s63i-x72go');
  });

  it('the INITIAL load still shows the full-screen loader (no envelope yet)', () => {
    vi.mocked(loadConversation).mockImplementation(
      () => new Promise(() => undefined),
    );

    render(
      <ArchitectConversationTab
        projectId={PROJECT_ID}
        selectedTargetArchitectureId={TARGET_ARCH_ID}
        currentUserId="user-A"
        architectureName="Target Payments v2"
      />,
    );

    expect(screen.getByTestId('architect-conversation-loading')).toBeTruthy();
  });
});
