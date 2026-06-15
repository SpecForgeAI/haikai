/**
 * ImplementationInitGate Component
 *
 * Spec 2026-06-12: Implementation-Service Init and Integration Repair --
 * Task Group 4.
 *
 * Gates "Product & Delivery -> Implementation" on the active project's
 * workspace registration status (`implementationInitSuccess`, persisted by
 * the gateway init route and served on the project DTO):
 *
 * - Init succeeded -> renders its children (the real Implementation screen).
 * - Not yet initialised (null/false) -> entering the screen AUTO-OPENS the
 *   Edit-project modal variant (org/product locked, repos editable,
 *   Single/Poly radio available pre-init); Save attempts init. When init
 *   succeeds the modal refreshes the active project, this gate re-evaluates,
 *   and the children render -- no reload needed.
 * - If init still fails (modal dismissed without success), the screen shows
 *   a visible error state (never a blank/silent screen) with a
 *   "Set up repositories" button that re-opens the modal.
 *
 * There is NO backfill for existing projects: this gate + modal IS the
 * conversion path. The gate wraps BOTH the `product/implement/:workItemId`
 * route body (see ImplementTab) and the bare `product/implement` tab landing
 * (see ImplementGateLanding below, mounted in App.tsx).
 */

import { ReactNode, useEffect, useRef, useState } from 'react';
import { useProject } from '../../contexts/ProjectContext';
import { CreateProjectModal } from '../Project/CreateProjectModal';

export interface ImplementationInitGateProps {
  children: ReactNode;
}

export function ImplementationInitGate({ children }: ImplementationInitGateProps) {
  const project = useProject();
  const [modalOpen, setModalOpen] = useState(false);

  const initSucceeded = project?.implementationInitSuccess === true;

  // Auto-open the Edit-project modal ONCE per project per gate mount when the
  // workspace is not initialised. The ref stops the modal from snapping back
  // open the instant the user dismisses it (the error state below remains the
  // visible signal, with an explicit re-open button).
  const autoOpenedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (project && !initSucceeded && autoOpenedForRef.current !== project.id) {
      autoOpenedForRef.current = project.id;
      setModalOpen(true);
    }
  }, [project, initSucceeded]);

  if (initSucceeded) {
    return <>{children}</>;
  }

  return (
    <div
      data-testid="implementation-init-gate"
      style={{ padding: '32px', maxWidth: '720px' }}
    >
      <div
        data-testid="implementation-init-error"
        style={{
          backgroundColor: '#ffebee',
          border: '1px solid #ffcdd2',
          color: '#c62828',
          padding: '16px 20px',
          borderRadius: '6px',
          fontSize: '14px',
        }}
      >
        <strong style={{ display: 'block', marginBottom: '8px' }}>
          Implementation workspace not set up
        </strong>
        {project ? (
          <span>
            The implementation service has no registered workspace for{' '}
            <strong>{project.name}</strong>
            {project.implementationInitSuccess === false
              ? ' (the last setup attempt failed)'
              : ''}
            . Register the project&apos;s repositories to enable the Implement
            flow.
          </span>
        ) : (
          <span>No active project. Select or create a project first.</span>
        )}
      </div>

      {project && (
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          data-testid="implementation-init-setup-button"
          style={{
            marginTop: '16px',
            background: '#1976D2',
            color: 'white',
            border: 'none',
            padding: '10px 24px',
            borderRadius: '4px',
            fontSize: '14px',
            cursor: 'pointer',
          }}
        >
          Set up repositories
        </button>
      )}

      {project && (
        <CreateProjectModal
          isOpen={modalOpen}
          onClose={() => setModalOpen(false)}
          mode="edit"
          project={project}
        />
      )}
    </div>
  );
}

/**
 * Landing body for the BARE `product/implement` tab route. Pre-init the gate
 * takes over (auto-opens the Edit-project modal / shows the error state);
 * post-init it shows a hint directing the user to the Backlog, since the
 * Implementation Assistant is per-work-item
 * (`product/implement/:workItemId`).
 */
export function ImplementGateLanding() {
  return (
    <ImplementationInitGate>
      <div
        data-testid="implement-landing-hint"
        style={{ padding: '32px', color: '#555', fontSize: '14px' }}
      >
        Select a feature from the Backlog and choose Implement to start the
        Implementation Assistant.
      </div>
    </ImplementationInitGate>
  );
}

export default ImplementationInitGate;
