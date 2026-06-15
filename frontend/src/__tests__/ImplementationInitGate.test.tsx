/**
 * ImplementationInitGate tests.
 *
 * Spec 2026-06-12: Implementation-Service Init and Integration Repair --
 * Task Group 4 (Task 4.1).
 *
 * Covers the Implement-flow init gate:
 *  (a) entering Implement pre-init auto-opens the Edit-project modal instead
 *      of the screen;
 *  (b) once init has succeeded the Implementation screen renders;
 *  (c) continued init failure renders the visible error state (never a
 *      blank/silent screen) with a working "Set up repositories" re-open;
 *  (d) the gate reacts to the active project's init flag flipping true
 *      (the modal's refreshActiveProject path) without a remount.
 *
 * CreateProjectModal is stubbed: its own dual-mode behaviour is covered in
 * CreateProjectModal.repoModes.test.tsx -- here we only assert the gate
 * opens it in edit mode for the active project.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

interface StubModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode?: string;
  project?: { id: string } | null;
}

vi.mock('../components/Project/CreateProjectModal', () => ({
  CreateProjectModal: ({ isOpen, onClose, mode, project }: StubModalProps) =>
    isOpen ? (
      <div
        data-testid="edit-project-modal"
        data-mode={mode}
        data-project-id={project?.id}
      >
        <button data-testid="stub-modal-close" onClick={onClose}>
          close
        </button>
      </div>
    ) : null,
}));

import { ImplementationInitGate } from '../components/ProductView/ImplementationInitGate';
import { ProjectContext } from '../contexts/ProjectContext';
import {
  makeTestProject,
  makeProjectContextValue,
} from '../test-utils/renderWithProviders';
import type { ProjectDto } from '../api/projectsApi';

function renderGate(project: ProjectDto | null) {
  return render(
    <ProjectContext.Provider value={makeProjectContextValue(project)}>
      <ImplementationInitGate>
        <div data-testid="implementation-screen">the real screen</div>
      </ImplementationInitGate>
    </ProjectContext.Provider>
  );
}

describe('ImplementationInitGate (Spec 2026-06-12)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('pre-init: hides the Implementation screen and auto-opens the Edit-project modal', () => {
    renderGate(
      makeTestProject({ id: 'proj-7', implementationInitSuccess: null })
    );

    // The real screen is NOT rendered
    expect(screen.queryByTestId('implementation-screen')).not.toBeInTheDocument();

    // The Edit-project modal auto-opened, in edit mode, for the active project
    const modal = screen.getByTestId('edit-project-modal');
    expect(modal).toHaveAttribute('data-mode', 'edit');
    expect(modal).toHaveAttribute('data-project-id', 'proj-7');
  });

  it('post-init: renders the Implementation screen without the gate or modal', () => {
    renderGate(makeTestProject({ implementationInitSuccess: true }));

    expect(screen.getByTestId('implementation-screen')).toBeInTheDocument();
    expect(screen.queryByTestId('implementation-init-gate')).not.toBeInTheDocument();
    expect(screen.queryByTestId('edit-project-modal')).not.toBeInTheDocument();
  });

  it('continued init failure: dismissing the modal leaves a visible error state with a working re-open button', () => {
    renderGate(
      makeTestProject({ id: 'proj-7', implementationInitSuccess: false })
    );

    // Dismiss the auto-opened modal (init still failed)
    fireEvent.click(screen.getByTestId('stub-modal-close'));
    expect(screen.queryByTestId('edit-project-modal')).not.toBeInTheDocument();

    // Visible error state -- never a blank/silent screen
    expect(screen.getByTestId('implementation-init-error')).toBeInTheDocument();
    expect(screen.getByTestId('implementation-init-error')).toHaveTextContent(
      'Implementation workspace not set up'
    );
    expect(screen.getByTestId('implementation-init-error')).toHaveTextContent(
      'the last setup attempt failed'
    );

    // The modal does NOT snap back open by itself, but the explicit
    // "Set up repositories" button re-opens it
    fireEvent.click(screen.getByTestId('implementation-init-setup-button'));
    expect(screen.getByTestId('edit-project-modal')).toBeInTheDocument();
  });

  it('renders the screen as soon as the active project flips to init-success (post-refresh)', () => {
    const preInit = makeTestProject({
      id: 'proj-7',
      implementationInitSuccess: false,
    });
    const { rerender } = renderGate(preInit);
    expect(screen.queryByTestId('implementation-screen')).not.toBeInTheDocument();

    // Simulate the modal's successful init -> refreshActiveProject updating
    // the context with implementation_init_success=true
    const postInit = makeTestProject({
      id: 'proj-7',
      implementationInitSuccess: true,
    });
    rerender(
      <ProjectContext.Provider value={makeProjectContextValue(postInit)}>
        <ImplementationInitGate>
          <div data-testid="implementation-screen">the real screen</div>
        </ImplementationInitGate>
      </ProjectContext.Provider>
    );

    expect(screen.getByTestId('implementation-screen')).toBeInTheDocument();
    expect(screen.queryByTestId('edit-project-modal')).not.toBeInTheDocument();
  });
});
