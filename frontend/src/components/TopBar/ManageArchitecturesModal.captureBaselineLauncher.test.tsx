/**
 * ManageArchitecturesModal -- Capture API Behaviour Baseline launcher tests
 *
 * Spec 2026-05-15 API Behaviour Baseline Capture Service -- Task Group 7
 * Task 7.1 sub-test #5: clicking the per-row "Capture API Behaviour
 * Baseline" button opens `StartCaptureSessionWizard` pre-bound to the
 * row's `projectId` + `architectureId`.
 *
 * 2026-06-02 navigate-on-start fix: when the mounted wizard fires
 * `onStarted(session)` (a real `/start` succeeded), the modal must close AND
 * navigate the user to the architecture-scoped capture-session detail page so
 * they can watch the capture run. A second test asserts that wiring against a
 * mocked `useNavigate`.
 *
 * The wizard child is mocked so we can read the props it received via data
 * attributes -- mirrors the existing `ManageArchitecturesModal.createTargetBaseline.test.tsx`
 * mock pattern. The mock also exposes a button that invokes the `onStarted`
 * prop with a fake running session so the navigate-on-start path is testable
 * without driving the real multi-step wizard.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../api/architecturesApi', async () => {
  const actual = await vi.importActual<typeof import('../../api/architecturesApi')>(
    '../../api/architecturesApi',
  );
  return {
    ...actual,
    createArchitecture: vi.fn(),
    updateArchitecture: vi.fn(),
    archiveArchitecture: vi.fn(),
    cloneArchitecture: vi.fn(),
  };
});

vi.mock('../../contexts/ArchitectureContext', () => ({
  useArchitectureContext: vi.fn(),
}));

// Mock react-router-dom's useNavigate so we can assert the post-start
// navigation target. Spread the actual module so any other exports the
// component (or its imports) rely on keep working.
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>(
    'react-router-dom',
  );
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('./EditArchitectureModal', () => ({
  EditArchitectureModal: () => <div data-testid="mock-edit-modal" />,
}));

vi.mock('./CloneArchitectureModal', () => ({
  CloneArchitectureModal: () => <div data-testid="mock-clone-modal" />,
}));

vi.mock('./ArchiveArchitectureConfirmModal', () => ({
  ArchiveArchitectureConfirmModal: (props: { architecture?: unknown }) =>
    props.architecture ? <div data-testid="mock-archive-modal" /> : null,
}));

// Avoid pulling in the selective-copy wizard's heavy provider dependency tree.
vi.mock('./SelectiveCopyWizardModal', () => ({
  SelectiveCopyWizardModal: () => <div data-testid="mock-selective-copy-wizard" />,
}));

// A fixed fake running session used by the onStarted-trigger button below so
// the navigate-on-start assertion can pin the exact session id in the URL.
const FAKE_STARTED_SESSION = {
  id: 'session-started-123',
  project_id: 'proj-uuid-launcher',
  architecture_id: 'arch-row',
  status: 'running',
} as unknown as import('../../api/apiBehaviourClient').ApiBehaviourCaptureSessionDto;

// The actual unit under test for sub-test #5 -- intercept props and surface
// them on a data attribute so the assertion can read them straight out of
// the DOM. Also exposes a button that fires `onStarted(session)` so the
// navigate-on-start wiring can be exercised in isolation.
vi.mock('../ApiBehaviour/StartCaptureSessionWizard', () => ({
  StartCaptureSessionWizard: (props: unknown) => {
    const safe = props as {
      open?: boolean;
      projectId?: string;
      architectureId?: string;
      architectureName?: string;
      onClose?: () => void;
      onStarted?: (
        session: import('../../api/apiBehaviourClient').ApiBehaviourCaptureSessionDto,
      ) => void;
    };
    return (
      <div
        data-testid="mock-start-capture-session-wizard"
        data-open={String(safe.open ?? '')}
        data-project-id={safe.projectId ?? ''}
        data-architecture-id={safe.architectureId ?? ''}
        data-architecture-name={safe.architectureName ?? ''}
      >
        <button
          type="button"
          data-testid="mock-wizard-fire-onstarted"
          onClick={() => safe.onStarted?.(FAKE_STARTED_SESSION)}
        >
          fire onStarted
        </button>
        <button
          type="button"
          data-testid="mock-wizard-fire-onclose"
          onClick={() => safe.onClose?.()}
        >
          fire onClose
        </button>
      </div>
    );
  },
}));

import { type Architecture } from '../../api/architecturesApi';
import { useArchitectureContext } from '../../contexts/ArchitectureContext';
import { ManageArchitecturesModal } from './ManageArchitecturesModal';

const PROJECT_ID = 'proj-uuid-launcher';

function buildArchitecture(overrides: Partial<Architecture> = {}): Architecture {
  return {
    id: 'arch-default',
    projectId: PROJECT_ID,
    name: 'Default',
    description: null,
    tags: [],
    archived: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useArchitectureContext).mockReturnValue({
    architectures: [
      buildArchitecture({ id: 'arch-row', name: 'Source Row' }),
      buildArchitecture({
        id: 'arch-active',
        name: 'Active',
        createdAt: '2026-01-02T00:00:00Z',
      }),
    ],
    activeArchitectureId: 'arch-active',
    refreshArchitectures: vi.fn().mockResolvedValue(undefined),
    setActiveArchitecture: vi.fn(),
    invalidateArchitectureModelCache: vi.fn(),
    setArchitectureModelCacheInvalidator: vi.fn(),
  } as unknown as ReturnType<typeof useArchitectureContext>);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ManageArchitecturesModal -- Capture API Behaviour Baseline launcher (Task 7.1 #5)', () => {
  it('clicking the per-row capture button opens the wizard pre-bound to that row\'s projectId + architectureId', () => {
    render(
      <ManageArchitecturesModal
        open={true}
        onClose={vi.fn()}
        projectId={PROJECT_ID}
      />,
    );

    // The wizard is not mounted before the button is clicked.
    expect(screen.queryByTestId('mock-start-capture-session-wizard')).toBeNull();

    // Click the capture launcher on the NON-active row to prove pre-binding
    // uses the clicked row's id, not the global active architecture.
    fireEvent.click(
      screen.getByTestId('manage-architectures-capture-baseline-arch-row'),
    );

    const wizard = screen.getByTestId('mock-start-capture-session-wizard');
    expect(wizard.getAttribute('data-open')).toBe('true');
    expect(wizard.getAttribute('data-project-id')).toBe(PROJECT_ID);
    expect(wizard.getAttribute('data-architecture-id')).toBe('arch-row');
    expect(wizard.getAttribute('data-architecture-name')).toBe('Source Row');
  });

  it('navigates to the capture-session detail page and closes the modal when the wizard fires onStarted', () => {
    const onClose = vi.fn();
    render(
      <ManageArchitecturesModal
        open={true}
        onClose={onClose}
        projectId={PROJECT_ID}
      />,
    );

    // Open the wizard against the non-active row.
    fireEvent.click(
      screen.getByTestId('manage-architectures-capture-baseline-arch-row'),
    );
    expect(screen.getByTestId('mock-start-capture-session-wizard')).toBeTruthy();

    // The wizard reports a successful /start by invoking onStarted(session).
    fireEvent.click(screen.getByTestId('mock-wizard-fire-onstarted'));

    // The user is taken to the architecture-scoped capture-session detail
    // page for the row's architecture + the started session id.
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith(
      `/projects/${PROJECT_ID}/architectures/arch-row/api-behaviour/sessions/${FAKE_STARTED_SESSION.id}`,
    );

    // The Manage Architectures modal closes so the detail page is unobscured.
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closing the wizard via onClose (cancel/escape) does NOT navigate', () => {
    const onClose = vi.fn();
    render(
      <ManageArchitecturesModal
        open={true}
        onClose={onClose}
        projectId={PROJECT_ID}
      />,
    );

    fireEvent.click(
      screen.getByTestId('manage-architectures-capture-baseline-arch-row'),
    );

    // Cancel/escape path: the wizard fires onClose only.
    fireEvent.click(screen.getByTestId('mock-wizard-fire-onclose'));

    // No navigation on cancel -- only a real start navigates.
    expect(mockNavigate).not.toHaveBeenCalled();
    // The launcher's own onClose (which clears capturingArchitecture) ran,
    // unmounting the wizard, while the parent modal stays open.
    expect(screen.queryByTestId('mock-start-capture-session-wizard')).toBeNull();
    expect(screen.getByTestId('manage-architectures-modal')).toBeTruthy();
    // The parent Manage modal's own onClose was NOT called by a cancel.
    expect(onClose).not.toHaveBeenCalled();
  });
});
