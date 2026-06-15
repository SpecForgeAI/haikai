/**
 * ManageArchitecturesModal -- Create Target Baseline button tests
 *
 * Spec 2026-05-15 Create Target Baseline from Current State -- Task Group 6
 * Task 6.1, sub-test 6: the new per-row "Create Target Baseline" button
 * opens SelectiveCopyWizardModal with `initialAutoMap=true`; the existing
 * "Copy from..." button continues to default `initialAutoMap` to false.
 *
 * The wizard child is mocked so we can read the props it received via data
 * attributes -- mirrors the existing ManageArchitecturesModal.test.tsx
 * mock pattern.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../api/architecturesApi', async () => {
  const actual = await vi.importActual<typeof import('../../api/architecturesApi')>(
    '../../api/architecturesApi'
  );
  return {
    ...actual,
    createArchitecture: vi.fn(),
    updateArchitecture: vi.fn(),
    archiveArchitecture: vi.fn(),
    cloneArchitecture: vi.fn(),
  };
});

// Provide a Router context for the component's useNavigate() call. These
// tests render the modal bare (no MemoryRouter) and do not assert
// navigation, so a no-op useNavigate mock is the minimal, faithful shim.
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>(
    'react-router-dom',
  );
  return {
    ...actual,
    useNavigate: () => vi.fn(),
  };
});

vi.mock('../../contexts/ArchitectureContext', () => ({
  useArchitectureContext: vi.fn(),
}));

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

const wizardMock = vi.fn();
vi.mock('./SelectiveCopyWizardModal', () => ({
  SelectiveCopyWizardModal: (props: unknown) => {
    wizardMock(props);
    const safe = props as {
      open?: boolean;
      projectId?: string;
      source?: { id?: string; name?: string };
      target?: { id?: string; name?: string };
      initialAutoMap?: boolean;
      onClose?: () => void;
    };
    return (
      <div
        data-testid="mock-selective-copy-wizard-modal-tb"
        data-open={String(safe.open ?? '')}
        data-source-id={safe.source?.id ?? ''}
        data-target-id={safe.target?.id ?? ''}
        data-initial-auto-map={String(safe.initialAutoMap ?? false)}
      >
        <button
          type="button"
          data-testid="mock-wizard-close"
          onClick={() => safe.onClose?.()}
        >
          fire close
        </button>
      </div>
    );
  },
}));

import { type Architecture } from '../../api/architecturesApi';
import { useArchitectureContext } from '../../contexts/ArchitectureContext';
import { ManageArchitecturesModal } from './ManageArchitecturesModal';

const PROJECT_ID = 'proj-uuid-123';

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
  wizardMock.mockClear();
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

describe('ManageArchitecturesModal -- Create Target Baseline button (Task 6.1 #6)', () => {
  it('renders the Create Target Baseline button on every non-archived row, disabled on the active row with the spec tooltip', () => {
    render(
      <ManageArchitecturesModal
        open={true}
        onClose={vi.fn()}
        projectId={PROJECT_ID}
      />
    );

    // Both rows have the button.
    expect(
      screen.getByTestId('manage-architectures-create-target-baseline-arch-row')
    ).toBeInTheDocument();
    const activeBtn = screen.getByTestId(
      'manage-architectures-create-target-baseline-arch-active'
    ) as HTMLButtonElement;
    expect(activeBtn).toBeDisabled();
    expect(activeBtn.getAttribute('title')).toContain('Cannot copy into itself');
  });

  it('clicking Create Target Baseline opens the wizard with initialAutoMap=true', () => {
    render(
      <ManageArchitecturesModal
        open={true}
        onClose={vi.fn()}
        projectId={PROJECT_ID}
      />
    );

    expect(screen.queryByTestId('mock-selective-copy-wizard-modal-tb')).toBeNull();
    fireEvent.click(
      screen.getByTestId('manage-architectures-create-target-baseline-arch-row')
    );

    const wizard = screen.getByTestId('mock-selective-copy-wizard-modal-tb');
    expect(wizard.getAttribute('data-source-id')).toBe('arch-row');
    expect(wizard.getAttribute('data-target-id')).toBe('arch-active');
    expect(wizard.getAttribute('data-initial-auto-map')).toBe('true');
  });

  it('clicking the existing Copy from\u2026 button opens the wizard with initialAutoMap=false (default)', () => {
    render(
      <ManageArchitecturesModal
        open={true}
        onClose={vi.fn()}
        projectId={PROJECT_ID}
      />
    );

    fireEvent.click(screen.getByTestId('manage-architectures-copy-from-arch-row'));

    const wizard = screen.getByTestId('mock-selective-copy-wizard-modal-tb');
    expect(wizard.getAttribute('data-source-id')).toBe('arch-row');
    expect(wizard.getAttribute('data-target-id')).toBe('arch-active');
    expect(wizard.getAttribute('data-initial-auto-map')).toBe('false');
  });
});
