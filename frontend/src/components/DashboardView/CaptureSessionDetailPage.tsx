/**
 * CaptureSessionDetailPage Component
 *
 * Spec: 2026-05-15 API Behaviour Baseline Capture Service -- Task Group 8
 *
 * Thin route wrapper for
 *   `/projects/:p/architectures/:a/api-behaviour/sessions/:sessionId`.
 *
 * Reads the URL-derived session id via `useParams` and passes it to
 * `CaptureSessionDetailView`. The "Back" button navigates to the sibling
 * list page.
 */

import React, { useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useProject } from '../../contexts/ProjectContext';
import { useActiveArchitectureId } from '../../contexts/ArchitectureContext';
import { CaptureSessionDetailView } from './CaptureSessionDetailView';
import styles from './ApiBaselinesListPage.module.css';

export const CaptureSessionDetailPage: React.FC = () => {
  const project = useProject();
  const architectureId = useActiveArchitectureId();
  const params = useParams<{ sessionId?: string }>();
  const navigate = useNavigate();

  const listUrl =
    project?.id && architectureId
      ? `/projects/${project.id}/architectures/${architectureId}/api-behaviour`
      : null;

  const handleClose = useCallback(() => {
    if (listUrl) navigate(listUrl);
  }, [listUrl, navigate]);

  if (!project || !architectureId) {
    return (
      <div className={styles.detailContainer} data-testid="capture-session-detail-page">
        <div className={styles.emptyMessage}>
          Select a project and architecture to view this capture session.
        </div>
      </div>
    );
  }

  if (!params.sessionId) {
    return (
      <div className={styles.detailContainer} data-testid="capture-session-detail-page">
        <div className={styles.emptyMessage}>No session id in the URL.</div>
      </div>
    );
  }

  return (
    <div data-testid="capture-session-detail-page" data-session-id={params.sessionId}>
      <CaptureSessionDetailView
        projectId={project.id}
        architectureId={architectureId}
        sessionId={params.sessionId}
        onClose={handleClose}
      />
    </div>
  );
};

export default CaptureSessionDetailPage;
