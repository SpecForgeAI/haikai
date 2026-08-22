/**
 * DiscoveryRunDetailView Component
 *
 * Spec 2026-05-16 Discovery Findings -- Task Group 6.
 *
 * THE Discovery Run Detail view. This tabbed view is the canonical and
 * sole home for the per-run detail surface mounted at
 * `/projects/:p/architectures/:a/discovery/runs/:runId`; there is no
 * other variant. The earlier legacy copy at
 * `DashboardView/DiscoveryRunDetailView.tsx` has been retired and the
 * routing reconciliation that justified a temporary suffixed filename
 * during the introduction of the tab strip is complete.
 *
 * What this view does:
 *   - Renders the selected run's header (status / architecture / created)
 *     and the rest of the run-detail meta when the parent supplies it
 *   - Surfaces the advisory `degraded` run-integrity banner (with its
 *     `degraded_reasons`) above the tab strip the SAME way the parent's
 *     `warnings` banner is shown (Oracle Integrity & Determinism, Spec #3,
 *     Task Group 6) -- a non-degraded run shows nothing
 *   - Hosts a tab control with two initial tabs ("Candidates" + "Findings")
 *     designed so future tabs (Evidence, Decision Tasks, Relationships,
 *     Clusters) can slot in without restructuring
 *   - The Candidates tab embeds the existing
 *     `DashboardView/DiscoveryCandidateTable` so the existing UX is
 *     preserved exactly
 *   - The Findings tab embeds the `<FindingsTab />` (Group 7)
 *
 * The AppShell model cache (`project_appshell_model_cache.md`) is NOT
 * invalidated on finding writes -- findings live outside the architecture
 * model. Candidate save-back flows still dispatch `LOAD_MODEL` as before
 * (handled inside the existing candidate surfaces / save-back modal --
 * unchanged by this spec).
 *
 * Spec 2 (2026-06-02) Cascade-aware Bulk Review + Reject Suppression --
 * Task Group 5: the bulk Save action now ALSO appears in the embedded grid's
 * toolbar. This view threads the parent's save handler + state down to the grid
 * (`onBulkSave` / `bulkSaveInFlight` / `bulkSaveLabel` / `hasApprovedToSave`) so
 * the grid's Save button reuses the EXACT save-approved path (and its post-save
 * cache refresh) the run-detail page already drives -- the page's existing Save
 * block in `candidatesTabHeader` is unchanged.
 *
 * Spec 3 (2026-06-02) Conversational Discovery-Review "Architect" Persona --
 * Task Group 4: a "Discovery Review Room" launch button opens the conversational
 * Architect review room (`<DiscoveryReviewRoom />`) inside the shared
 * `RightHandPanelShell` (persona `architect`), behind a simple open/collapse
 * toggle (mirroring the `TargetArchitectureWorkspace` mount). The room handles
 * the two-run union (its scan-selection opener) while this view + the grid stay
 * single-run.
 */

import React, { useState, useMemo, useCallback } from 'react';
import type {
  DiscoveryRunDto,
  DiscoveryCandidateDto,
} from '../../api/discoveryApi';
import { DiscoveryCandidateTable } from '../DashboardView/DiscoveryCandidateTable';
import { FindingsTab } from './FindingsTab';
import { StructuralModelTab } from './structuralModel/StructuralModelTab';
import { RightHandPanelShell } from '../common/RightHandPanelShell';
import { DiscoveryReviewRoom } from './DiscoveryReviewRoom';
import styles from './DiscoveryRunDetailView.module.css';

// ============================================================================
// Tab control
// ============================================================================

/**
 * Identifier set for the tab strip. Adding a new tab is a two-line change:
 * extend this union, then push a new entry to `TABS` below.
 */
export type DiscoveryRunDetailTabId = 'candidates' | 'findings' | 'structural-model';

interface TabDefinition {
  id: DiscoveryRunDetailTabId;
  label: string;
}

const TABS: TabDefinition[] = [
  { id: 'candidates', label: 'Candidates' },
  { id: 'findings', label: 'Findings' },
  { id: 'structural-model', label: 'Structural Model' },
];

// ============================================================================
// Advisory `degraded` run-integrity signal (Spec #3 -- Oracle Integrity &
// Determinism, Task Group 6)
// ============================================================================

/**
 * Normalize the run's `degraded_reasons` into a `string[]` for rendering.
 *
 * AMS persists + emits `degraded_reasons` as a JSON-encoded `string[]`
 * (verbatim, null when absent) -- modelled exactly on the `warnings` field --
 * so the value can reach the frontend as EITHER a JSON-encoded string OR an
 * already-parsed array (defensive, mirroring the dual-tolerance `coerce`
 * idiom used elsewhere in the codebase). This helper accepts both:
 *   - an array -> returned as-is (string entries only),
 *   - a JSON-encoded array string -> parsed,
 *   - a non-JSON plain string -> wrapped as a single-entry array,
 *   - null / undefined / unparseable -> empty array.
 *
 * It NEVER throws -- an unparseable value yields an empty list so the banner
 * simply renders the flag without reasons rather than crashing the view.
 */
export function normalizeDegradedReasons(
  reasons: string | string[] | null | undefined,
): string[] {
  if (reasons == null) return [];
  if (Array.isArray(reasons)) {
    return reasons.filter((r): r is string => typeof r === 'string' && r.length > 0);
  }
  if (typeof reasons === 'string') {
    const trimmed = reasons.trim();
    if (trimmed.length === 0) return [];
    // Try to parse a JSON-encoded string[] (the AMS wire shape). Fall back to
    // treating the value as a single plain-string reason.
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (r): r is string => typeof r === 'string' && r.length > 0,
        );
      }
      if (typeof parsed === 'string' && parsed.length > 0) {
        return [parsed];
      }
    } catch {
      // Not JSON -- treat the raw string as a single reason.
    }
    return [trimmed];
  }
  return [];
}

/**
 * Whether the run carries the advisory `degraded` flag. A run is degraded
 * only when `degraded === true`; null / undefined / false are NOT degraded
 * (a non-degraded run renders no banner). The flag rides ALONGSIDE the
 * `COMPLETED` status -- it never blocks and is not a terminal status.
 */
function isRunDegraded(run: DiscoveryRunDto | null): boolean {
  return run?.degraded === true;
}

// ============================================================================
// Props
// ============================================================================

export interface DiscoveryRunDetailViewProps {
  projectId: string;
  /**
   * Active architecture id from the URL. Used to scope the Findings tab
   * fetch + thread into the embedded `DiscoveryCandidateTable`.
   */
  architectureId: string;
  /**
   * The selected run. Supplied by the parent route wrapper so this canonical
   * view can stay focused on tab + content composition without re-importing
   * the whole run-list / fetching dance from the legacy view. When `null`
   * (e.g. route loading) the component renders an inert empty-state.
   */
  selectedRun: DiscoveryRunDto | null;
  /**
   * Loaded candidates for the selected run, threaded down so the parent
   * keeps the lifted candidate-state pattern from the legacy view (used
   * by Save All Approved). When `null` the Candidates tab renders a
   * "no candidates loaded yet" empty-state.
   */
  candidates: DiscoveryCandidateDto[] | null;
  /**
   * Setter for the lifted candidate state. Forwarded into
   * `DiscoveryCandidateTable` so review actions update the parent's copy.
   */
  onCandidatesChange: (candidates: DiscoveryCandidateDto[]) => void;
  /**
   * Optional initial active tab. Used only when `activeTab` (controlled
   * prop) is absent. Defaults to `'candidates'` so users who navigate to
   * the run-detail view see the existing surface unchanged.
   */
  initialActiveTab?: DiscoveryRunDetailTabId;
  /**
   * Controlled active tab. When supplied, the parent owns the active-tab
   * state (typically wired to a `?tab=` URL search param via
   * `useSearchParams`). When omitted, the component manages its own state
   * seeded from `initialActiveTab`.
   */
  activeTab?: DiscoveryRunDetailTabId;
  /**
   * Fires when the user clicks a tab button. The parent should update
   * whatever drives `activeTab` (URL param, parent state, etc).
   */
  onTabChange?: (tab: DiscoveryRunDetailTabId) => void;
  /**
   * Optional content rendered above the candidate table inside the
   * Candidates tab panel. The page wrapper uses this slot for the
   * "Save All Approved" block (save button + success / error messages)
   * so candidate-specific chrome stays scoped to the Candidates tab.
   */
  candidatesTabHeader?: React.ReactNode;
  /**
   * Optional callback for opening a linked-target inside the Findings
   * drawer (threaded through). Lets the host route wire `useNavigate` if
   * it wants click-through to candidate / decision-task / evidence pages.
   */
  onOpenLinkedTarget?: (targetType: string, targetId: string) => void;
  /**
   * Optional hotfix Bug 3 timestamp -- bumped after a save-back so the
   * embedded `DiscoveryCandidateTable` can clear its review-status filter
   * and re-evaluate per-row button disabled state. Matches the legacy
   * view's prop wiring.
   */
  lastSaveTimestamp?: number;
  /** Foundations receipts map threaded to the candidate table (2026-08-22). */
  scopeByEntityName?: Map<string, { scope: string; decisionRef: string | null }>;
  /**
   * Spec 2 (2026-06-02) Task Group 5.5 -- bulk Save in the grid toolbar.
   * Threaded straight through to `DiscoveryCandidateTable`. The page wires
   * `onBulkSave` to its EXISTING save-approved flow (the `SaveBackConfirmModal`
   * -> `handleSaveApprovedConfirmed` path with its post-save AppShell cache
   * refresh), and supplies the in-flight flag + dynamic label + has-approved
   * gate. When `onBulkSave` is omitted the grid renders no Save button.
   */
  onBulkSave?: () => void;
  bulkSaveInFlight?: boolean;
  bulkSaveLabel?: string;
  hasApprovedToSave?: boolean;
  /**
   * Spec 3 (2026-06-02) Task Group 4 -- who opens the Discovery Review Room
   * (recorded on the room's `open` turn). Defaults to `'current-user'` when
   * absent so the launch path works without extra wiring; the host page can
   * supply the real user id.
   */
  currentUserId?: string;
  /**
   * Spec 2026-06-11 Findings Coverage + Gap Wayfinding -- Task Group 3.
   * Finding id from the `?findingId=` route param, threaded to
   * `FindingsTab` which fetches that single finding and opens the existing
   * `FindingDetailDrawer` once, on mount. Unknown/404 ids silently no-op.
   */
  initialFindingId?: string | null;
  /**
   * Spec 2026-06-11 Findings Coverage + Gap Wayfinding -- Task Group 3.
   * Seeds the existing `reviewRoomOpen` state from the `?room=open` route
   * param so the Discovery Review Room (Architecture Room) opens on load.
   */
  initialReviewRoomOpen?: boolean;
}

// ============================================================================
// Component
// ============================================================================

export const DiscoveryRunDetailView: React.FC<DiscoveryRunDetailViewProps> = ({
  projectId,
  architectureId,
  selectedRun,
  candidates,
  onCandidatesChange,
  initialActiveTab,
  activeTab: controlledActiveTab,
  onTabChange,
  candidatesTabHeader,
  onOpenLinkedTarget,
  lastSaveTimestamp,
  scopeByEntityName,
  onBulkSave,
  bulkSaveInFlight,
  bulkSaveLabel,
  hasApprovedToSave,
  currentUserId,
  initialFindingId,
  initialReviewRoomOpen,
}) => {
  // Tab state is local unless the parent supplies `activeTab` (controlled
  // mode -- typically wired to a `?tab=` URL param). Both modes coexist so
  // existing tests can keep mounting the view without router wiring.
  const [uncontrolledActiveTab, setUncontrolledActiveTab] = useState<DiscoveryRunDetailTabId>(
    initialActiveTab ?? 'candidates',
  );
  const activeTab = controlledActiveTab ?? uncontrolledActiveTab;
  const setActiveTab = useCallback(
    (tab: DiscoveryRunDetailTabId) => {
      if (controlledActiveTab === undefined) {
        setUncontrolledActiveTab(tab);
      }
      onTabChange?.(tab);
    },
    [controlledActiveTab, onTabChange],
  );

  // Spec 3 (Task Group 4) -- Discovery Review Room open/collapse toggle. Behind
  // a simple boolean (mirroring `TargetArchitectureWorkspace`'s `conversationOpen`).
  // Seeded from the `?room=open` route param (Spec 2026-06-11, Task Group 3).
  const [reviewRoomOpen, setReviewRoomOpen] = useState<boolean>(
    initialReviewRoomOpen ?? false,
  );

  const runId = selectedRun?.id ?? null;
  const runArchitectureId = selectedRun?.architecture_id ?? architectureId;

  // Advisory `degraded` run-integrity signal (Spec #3 -- Oracle Integrity &
  // Determinism, Task Group 6). Computed only from the run DTO so a
  // non-degraded run renders nothing. Reasons are normalized from the
  // snake_case `degraded_reasons` JSON-encoded payload (dual-tolerant).
  const degraded = isRunDegraded(selectedRun);
  const degradedReasons = useMemo(
    () => normalizeDegradedReasons(selectedRun?.degraded_reasons),
    [selectedRun?.degraded_reasons],
  );

  // Memoise the active tab object so React doesn't re-compute the label on
  // every render (a micro-optimisation; the tab list is tiny but the
  // pattern keeps re-renders honest if future tabs do heavier lookups).
  const activeTabDef = useMemo(
    () => TABS.find((t) => t.id === activeTab) ?? TABS[0],
    [activeTab],
  );

  const renderCandidatesPanel = useCallback(() => {
    if (!selectedRun || !runId) {
      return (
        <div
          className={styles.emptyMessage}
          data-testid="candidates-tab-no-run"
        >
          Select a run to view its candidates.
        </div>
      );
    }
    if (!candidates) {
      return (
        <>
          {candidatesTabHeader}
          <div
            className={styles.emptyMessage}
            data-testid="candidates-tab-not-loaded"
          >
            Candidates haven&apos;t been loaded yet for this run.
          </div>
        </>
      );
    }
    if (candidates.length === 0) {
      return (
        <>
          {candidatesTabHeader}
          <div
            className={styles.emptyMessage}
            data-testid="empty-candidates-message"
          >
            No candidates generated for this run.
          </div>
        </>
      );
    }
    return (
      <>
        {candidatesTabHeader}
        <DiscoveryCandidateTable
          projectId={projectId}
          architectureId={runArchitectureId}
          runId={runId}
          candidates={candidates}
          onCandidatesChange={onCandidatesChange}
          lastSaveTimestamp={lastSaveTimestamp}
          scopeByEntityName={scopeByEntityName}
          onBulkSave={onBulkSave}
          bulkSaveInFlight={bulkSaveInFlight}
          bulkSaveLabel={bulkSaveLabel}
          hasApprovedToSave={hasApprovedToSave}
        />
      </>
    );
  }, [
    selectedRun,
    runId,
    candidates,
    projectId,
    runArchitectureId,
    onCandidatesChange,
    lastSaveTimestamp,
    scopeByEntityName,
    candidatesTabHeader,
    onBulkSave,
    bulkSaveInFlight,
    bulkSaveLabel,
    hasApprovedToSave,
  ]);

  const renderFindingsPanel = useCallback(() => {
    if (!selectedRun || !runId) {
      return (
        <div
          className={styles.emptyMessage}
          data-testid="findings-tab-no-run"
        >
          Select a run to view its findings.
        </div>
      );
    }
    return (
      <FindingsTab
        projectId={projectId}
        architectureId={runArchitectureId}
        runId={runId}
        onOpenLinkedTarget={onOpenLinkedTarget}
        initialFindingId={initialFindingId}
      />
    );
  }, [
    selectedRun,
    runId,
    projectId,
    runArchitectureId,
    onOpenLinkedTarget,
    initialFindingId,
  ]);

  return (
    <div
      className={styles.detailContainer}
      data-testid="discovery-run-detail-view-canonical"
    >
      {/* Advisory degraded run-integrity banner (Spec #3, Task Group 6).
          Rendered the SAME way the parent's `warnings` banner is shown:
          a single line for one reason, a list for several. The run still
          COMPLETED -- this is advisory only and never blocks. A non-degraded
          run (degraded false/null) renders nothing. */}
      {degraded && (
        <div
          className={`${styles.warningsBanner} ${styles.degradedBanner}`}
          role="alert"
          data-testid="run-degraded-banner"
        >
          <span
            className={styles.degradedBannerHeading}
            data-testid="run-degraded-flag"
          >
            Degraded run: the captured model may be partial.
          </span>
          {degradedReasons.length === 1 ? (
            <span data-testid="run-degraded-reason">{degradedReasons[0]}</span>
          ) : degradedReasons.length > 1 ? (
            <ul
              className={styles.warningsBannerList}
              data-testid="run-degraded-reasons-list"
            >
              {degradedReasons.map((reason, idx) => (
                <li key={idx} data-testid="run-degraded-reason">
                  {reason}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}

      {/* Spec 3 (Task Group 4): the "Discovery Review Room" launch button.
          Opens the conversational Architect review room inside the shared
          RightHandPanelShell. Shown only when a run is selected (the room
          needs a primary run id to key its thread). */}
      {selectedRun && runId && (
        <div
          className={styles.reviewRoomLaunchBar}
          data-testid="discovery-review-room-launch-bar"
        >
          <button
            type="button"
            className={styles.reviewRoomLaunchButton}
            aria-pressed={reviewRoomOpen}
            onClick={() => setReviewRoomOpen((o) => !o)}
            data-testid="discovery-review-room-launch-button"
          >
            {reviewRoomOpen ? 'Close Architecture Room' : 'Architecture Room'}
          </button>
        </div>
      )}

      {/* Tab strip */}
      <div
        className={styles.tabStrip}
        role="tablist"
        aria-label="Discovery run detail tabs"
        data-testid="discovery-run-detail-tab-strip"
      >
        {TABS.map((tab) => {
          const isActive = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={`discovery-run-detail-tab-panel-${tab.id}`}
              id={`discovery-run-detail-tab-${tab.id}`}
              className={`${styles.tabButton}${isActive ? ` ${styles.tabButtonActive}` : ''}`}
              onClick={() => setActiveTab(tab.id)}
              data-testid={`discovery-run-detail-tab-${tab.id}`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Active tab panel */}
      <div
        className={styles.tabPanel}
        role="tabpanel"
        aria-labelledby={`discovery-run-detail-tab-${activeTabDef.id}`}
        id={`discovery-run-detail-tab-panel-${activeTabDef.id}`}
        data-testid={`discovery-run-detail-tab-panel-${activeTabDef.id}`}
      >
        {activeTab === 'candidates' && renderCandidatesPanel()}
        {activeTab === 'findings' && renderFindingsPanel()}
        {/* Structural Model tab (SCL pipeline spec 6, 2026-08-18 design "UI
            placement" ruling): corpus browser + reachability report +
            "explain this". Architecture-scoped (the SCL scan is keyed to the
            architecture, not the discovery run), so it needs no selectedRun. */}
        {activeTab === 'structural-model' && (
          <StructuralModelTab
            projectId={projectId}
            architectureId={runArchitectureId}
          />
        )}
      </div>

      {/* Spec 3 (Task Group 4): the Discovery Review Room, mounted in the shared
          RightHandPanelShell verbatim (persona `architect`), behind the simple
          open/collapse toggle above. The room owns the two-run union via its
          scan-selection opener; this view + the grid stay single-run. */}
      {reviewRoomOpen && selectedRun && runId && (
        <RightHandPanelShell
          storageKey={`discovery-review:${runId}`}
          personaId="architect"
          roomName="Architecture Room"
          collapsedLabel="Review"
          onClose={() => setReviewRoomOpen(false)}
        >
          <DiscoveryReviewRoom
            projectId={projectId}
            architectureId={runArchitectureId}
            runId={runId}
            runDiscoveryKind={selectedRun.discovery_kind}
            openedBy={currentUserId ?? 'current-user'}
          />
        </RightHandPanelShell>
      )}
    </div>
  );
};
