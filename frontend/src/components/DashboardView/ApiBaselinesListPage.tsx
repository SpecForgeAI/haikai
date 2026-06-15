/**
 * ApiBaselinesListPage Component
 *
 * Spec: 2026-05-15 API Behaviour Baseline Capture Service -- Task Group 8
 * + Spec 2026-05-25 API Test Harness -- Target-Side Capture -- Task Group 5
 *   (the "Capture target API behaviour" entry button + the
 *   `StartTargetReplayWizard` modal launch).
 *
 * Sibling page to `DiscoveryListPage` exposing two read-only lists for the
 * active project + architecture:
 *   - `CaptureSessionsList` (active + historical capture sessions)
 *   - `BaselinesList` (durable saved baselines)
 *
 * Click a row -> navigate to the matching detail URL:
 *   - `/projects/:p/architectures/:a/api-behaviour/sessions/:sessionId`
 *   - `/projects/:p/architectures/:a/api-behaviour/baselines/:baselineId`
 *
 * Mirrors the discovery sibling-page pattern (no filters, no bulk actions
 * in v1). The new "Capture target API behaviour" button lives in the
 * page header and opens `StartTargetReplayWizard` pre-bound to the active
 * project + architecture. The button is DISABLED (not hidden) when no
 * `kind='current', status='active'` baseline exists; the tooltip explains
 * why ("Capture a current-state baseline first").
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useProject } from '../../contexts/ProjectContext';
import { useActiveArchitectureId } from '../../contexts/ArchitectureContext';
import { CaptureSessionsList } from './CaptureSessionsList';
import { BaselinesList } from './BaselinesList';
import { StartTargetReplayWizard } from '../ApiBehaviour/StartTargetReplayWizard';
import {
  ApiBehaviourCaptureSessionDto,
  listBaselines,
} from '../../api/apiBehaviourClient';
import styles from './ApiBaselinesListPage.module.css';

export const ApiBaselinesListPage: React.FC = () => {
  const project = useProject();
  const architectureId = useActiveArchitectureId();
  const navigate = useNavigate();

  // ---- Target-replay wizard launcher state ---------------------------
  const [targetWizardOpen, setTargetWizardOpen] = useState(false);
  // Whether at least one `kind='current', status='active'` baseline exists
  // for this project + architecture. Drives the entry-button enabled state.
  const [hasEligibleSource, setHasEligibleSource] = useState<boolean>(false);
  const [eligibleSourceLoading, setEligibleSourceLoading] = useState<boolean>(false);

  const handleSessionSelect = useCallback(
    (sessionId: string) => {
      if (!project?.id || !architectureId) return;
      navigate(
        `/projects/${project.id}/architectures/${architectureId}` +
          `/api-behaviour/sessions/${sessionId}`,
      );
    },
    [project?.id, architectureId, navigate],
  );

  const handleBaselineSelect = useCallback(
    (baselineId: string) => {
      if (!project?.id || !architectureId) return;
      navigate(
        `/projects/${project.id}/architectures/${architectureId}` +
          `/api-behaviour/baselines/${baselineId}`,
      );
    },
    [project?.id, architectureId, navigate],
  );

  // Probe for at least one active current-state baseline so the entry button
  // can be enabled. Re-fires whenever project or architecture changes.
  useEffect(() => {
    if (!project?.id || !architectureId) {
      setHasEligibleSource(false);
      return;
    }
    let cancelled = false;
    setEligibleSourceLoading(true);
    (async () => {
      try {
        const baselines = await listBaselines(project.id, architectureId, {
          kind: 'current',
        });
        if (cancelled) return;
        const eligible = baselines.some(
          (b) =>
            (b.kind ?? 'current') === 'current' &&
            (b.status ?? '').toLowerCase() === 'active',
        );
        setHasEligibleSource(eligible);
      } catch {
        if (!cancelled) setHasEligibleSource(false);
      } finally {
        if (!cancelled) setEligibleSourceLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [project?.id, architectureId]);

  const handleTargetStarted = useCallback(
    (session: ApiBehaviourCaptureSessionDto) => {
      // Navigate to the session detail page so the user sees the replay
      // runner streaming progress. Mirrors the current-state wizard's
      // post-Start navigation pattern.
      if (!project?.id || !architectureId) return;
      navigate(
        `/projects/${project.id}/architectures/${architectureId}` +
          `/api-behaviour/sessions/${session.id}`,
      );
    },
    [project?.id, architectureId, navigate],
  );

  if (!project) {
    return (
      <div className={styles.container} data-testid="api-baselines-list-page">
        <div className={styles.emptyMessage}>
          Select a project to view API behaviour baselines.
        </div>
      </div>
    );
  }

  // Disable the entry button when no eligible source baseline exists OR
  // when the eligibility probe is still in flight. Tooltip differs by
  // reason so the user knows whether to wait or to capture a current
  // baseline first.
  const targetButtonDisabled =
    !architectureId || eligibleSourceLoading || !hasEligibleSource;
  const targetButtonTooltip = !architectureId
    ? 'Select an architecture first'
    : eligibleSourceLoading
    ? 'Checking for current-state baselines…'
    : !hasEligibleSource
    ? 'Capture a current-state baseline first'
    : 'Capture target API behaviour by replaying an existing current-state baseline';

  return (
    <div className={styles.container} data-testid="api-baselines-list-page">
      <div className={styles.header}>
        <h2>API Behaviour Baselines</h2>
        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={() => setTargetWizardOpen(true)}
            disabled={targetButtonDisabled}
            title={targetButtonTooltip}
            data-testid="api-baselines-list-page-capture-target"
          >
            Capture target API behaviour
          </button>
        </div>
      </div>
      <CaptureSessionsList
        projectId={project.id}
        architectureId={architectureId}
        onSelect={handleSessionSelect}
      />
      <BaselinesList
        projectId={project.id}
        architectureId={architectureId}
        onSelect={handleBaselineSelect}
      />
      {architectureId && (
        <StartTargetReplayWizard
          open={targetWizardOpen}
          projectId={project.id}
          architectureId={architectureId}
          onClose={() => setTargetWizardOpen(false)}
          onStarted={handleTargetStarted}
        />
      )}
    </div>
  );
};

export default ApiBaselinesListPage;
