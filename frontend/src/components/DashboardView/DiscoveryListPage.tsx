/**
 * DiscoveryListPage Component
 *
 * Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 7 (Task 7.5)
 *
 * V1 stripped-down list page for `/projects/:p/architectures/:a/discovery`.
 * Renders a one-column list of historical discovery runs for the active
 * project + architecture (most recent first). Click a row -> navigate to
 * `/.../discovery/runs/:runId` (the deep-linkable detail page).
 *
 * Per spec: NO filters, NO sort UI, NO candidate-table preview in V1.
 * The page mirrors the runs-list rendering currently inside
 * `DiscoveryRunDetailView`'s left column (extracted into the reusable
 * `DiscoveryRunsList` subcomponent in Task 7.4).
 */

import React, { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useProject } from '../../contexts/ProjectContext';
import { useActiveArchitectureId } from '../../contexts/ArchitectureContext';
import { DiscoveryRunsList } from './DiscoveryRunsList';
import styles from './DiscoveryRunDetailView.module.css';

export const DiscoveryListPage: React.FC = () => {
  const activeProject = useProject();
  const activeArchitectureId = useActiveArchitectureId();
  const navigate = useNavigate();

  const handleSelectRun = useCallback(
    (runId: string) => {
      if (!activeProject?.id || !activeArchitectureId) return;
      navigate(
        `/projects/${activeProject.id}/architectures/${activeArchitectureId}/discovery/runs/${runId}`
      );
    },
    [activeProject?.id, activeArchitectureId, navigate]
  );

  if (!activeProject) {
    return (
      <div className={styles.detailContainer} data-testid="discovery-list-page">
        <div className={styles.emptyMessage}>
          Select a project to view discovery runs.
        </div>
      </div>
    );
  }

  return (
    <div className={styles.detailContainer} data-testid="discovery-list-page">
      <div className={styles.detailHeader}>
        <h2>Discovery Runs</h2>
      </div>
      <DiscoveryRunsList
        projectId={activeProject.id}
        architectureId={activeArchitectureId}
        onSelectRun={handleSelectRun}
      />
    </div>
  );
};
