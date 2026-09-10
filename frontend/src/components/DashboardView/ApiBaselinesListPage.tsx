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
 * 2026-09-09 (Stored Proc & Function Behaviour Program, Spec 3): the page
 * becomes the Live behaviour surface with a tab per behaviour KIND — "API
 * behaviour" (the two lists above, the default tab) and "Stored procs and
 * functions" (`ProcBehaviour/ProcBaselinesTab`). The proc kind is DB-native
 * and shares nothing with the API capture path but the stylesheet.
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
import { EffectMapBackfillModal } from './EffectMapBackfillModal';
import { ProcBaselinesTab } from '../ProcBehaviour/ProcBaselinesTab';
import {
  ApiBehaviourCaptureSessionDto,
  listBaselines,
} from '../../api/apiBehaviourClient';
import styles from './ApiBaselinesListPage.module.css';

/**
 * Live behaviour kinds. The API behaviour baseline is the original surface;
 * "Stored procs and functions" (Stored Proc & Function Behaviour Program,
 * Spec 3, decision 19) is the SECOND kind on the same surface — DB-native and
 * independent of the API capture path, so it gets its own tab rather than
 * being folded into the API lists.
 */
type BehaviourTab = 'api' | 'proc';

export const ApiBaselinesListPage: React.FC = () => {
  const project = useProject();
  const architectureId = useActiveArchitectureId();
  const navigate = useNavigate();
  const [tab, setTab] = useState<BehaviourTab>('api');

  // ---- Target-replay wizard launcher state ---------------------------
  const [targetWizardOpen, setTargetWizardOpen] = useState(false);
  // ---- Effect-map backfill modal (2026-08-20) ------------------------
  const [backfillModalOpen, setBackfillModalOpen] = useState(false);
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
      <div className={styles.tabsNav} role="tablist" data-testid="live-behaviour-tabs">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'api'}
          className={tab === 'api' ? `${styles.tabButton} ${styles.tabButtonActive}` : styles.tabButton}
          onClick={() => setTab('api')}
          data-testid="live-behaviour-tab-api"
        >
          API behaviour
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'proc'}
          className={tab === 'proc' ? `${styles.tabButton} ${styles.tabButtonActive}` : styles.tabButton}
          onClick={() => setTab('proc')}
          data-testid="live-behaviour-tab-proc"
        >
          Stored procs and functions
        </button>
      </div>
      {tab === 'proc' && (
        <ProcBaselinesTab projectId={project.id} architectureId={architectureId} />
      )}
      {/* API behaviour panel. Kept MOUNTED and merely hidden on the proc tab
          so its two lists (and their in-flight loads) survive a tab switch. */}
      <div hidden={tab !== 'api'}>
      <div className={styles.header}>
        <h2>API Behaviour Baselines</h2>
        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() => setBackfillModalOpen(true)}
            disabled={!architectureId}
            title="Derive missing endpoint → write-table effect maps from the structural corpus + guarded LLM proposals"
            data-testid="api-baselines-list-page-backfill-effect-maps"
          >
            Backfill effect maps
          </button>
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
      {architectureId && (
        <EffectMapBackfillModal
          open={backfillModalOpen}
          projectId={project.id}
          architectureId={architectureId}
          onClose={() => setBackfillModalOpen(false)}
        />
      )}
      </div>
    </div>
  );
};

export default ApiBaselinesListPage;
