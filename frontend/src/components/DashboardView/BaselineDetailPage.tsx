/**
 * BaselineDetailPage Component
 *
 * Spec: 2026-05-15 API Behaviour Baseline Capture Service -- Task Group 8
 * Task 8.5 / 8.6.
 *
 * Thin route wrapper for
 *   `/projects/:p/architectures/:a/api-behaviour/baselines/:baselineId`.
 *
 * Reads the URL-derived baseline id via `useParams` and passes it to
 * `BaselineDetailView`. The "Back" button navigates to the sibling list
 * page.
 */

import React, { useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useProject } from '../../contexts/ProjectContext';
import { useActiveArchitectureId } from '../../contexts/ArchitectureContext';
import { BaselineDetailView } from './BaselineDetailView';
import styles from './ApiBaselinesListPage.module.css';

export const BaselineDetailPage: React.FC = () => {
  const project = useProject();
  const architectureId = useActiveArchitectureId();
  const params = useParams<{ baselineId?: string }>();
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
      <div className={styles.detailContainer} data-testid="baseline-detail-page">
        <div className={styles.emptyMessage}>
          Select a project and architecture to view this baseline.
        </div>
      </div>
    );
  }

  if (!params.baselineId) {
    return (
      <div className={styles.detailContainer} data-testid="baseline-detail-page">
        <div className={styles.emptyMessage}>No baseline id in the URL.</div>
      </div>
    );
  }

  return (
    <div data-testid="baseline-detail-page" data-baseline-id={params.baselineId}>
      <BaselineDetailView
        projectId={project.id}
        architectureId={architectureId}
        baselineId={params.baselineId}
        onClose={handleClose}
      />
    </div>
  );
};

export default BaselineDetailPage;
