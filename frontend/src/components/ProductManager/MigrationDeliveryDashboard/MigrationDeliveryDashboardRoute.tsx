/**
 * MigrationDeliveryDashboardRoute
 *
 * Spec: 2026-05-19 Migration Delivery Progress and Evidence Tracking
 * Task Group 13 -- Route registration + AppShell wiring (Q-10).
 *
 * Spec: 2026-05-20 Cross-Story Context Injection -- Task Group 7.6
 * routing layer owns the AppShell model-cache invalidation. After the
 * dashboard signals that pass 2 actually ran (via the new
 * `onPassTwoPersisted` callback), this route calls
 * `loadModelByProjectId(projectId, architectureId)` and dispatches
 * `LOAD_MODEL` against the ArchitectureContext so any open architecture
 * views surface the newly-persisted pass-2 entities (per
 * `project_appshell_model_cache.md`).
 *
 * Spec: 2026-05-20 Cross-Story Context Injection -- Task Group 8 the route
 * owns the epic-decisions summary's data lifecycle: after loading the
 * dashboard hierarchy, it walks the epic nodes and fetches each epic's
 * captured-decisions list, then derives a per-epic count summary that the
 * dashboard renders. Clicking an epic's "Edit" link opens the dedicated
 * EpicCapturedDecisionsPanel modal.
 *
 * Spec: 2026-05-20 Cross-Story Context Injection -- Task Group 8.4 the route
 * also exposes a small "Project config" toolbar above the dashboard so the
 * user can edit the three per-project Task-Group-9 fields without leaving
 * the surface where they trigger batches. The toolbar is the only place
 * the ProjectConfigModal is currently mounted from in the app; if a
 * dedicated project-config screen is added later we can move the trigger
 * there.
 *
 * Frontend router entry for the read-only delivery dashboard surface.
 * Mounted under the architecture-scoped tree in `App.tsx` per Q-10
 * (option b):
 *
 *   /projects/:projectId
 *     /architectures/:architectureId
 *       /migration-books-of-work/:bookId/delivery
 *
 * Spec: 2026-06-14 Migrate Button + Migration Execution Driver (Spec 3 of 4)
 * -- Task Group 6 (route wiring). The route is the layer that supplies the
 * Migrate panel's orchestration scope + the oracle precondition the dashboard
 * itself cannot derive (it stays presentational):
 *   - `company` = the active project's organisation NAME (resolved via
 *     `getOrganisationById(activeProject.organisationId)`, the
 *     `ImplementationAssistantPanel` convention);
 *   - `project` = `activeProject.name` (same convention);
 *   - `hasActiveCurrentBaseline` = whether an active `kind='current'`
 *     API-behaviour baseline exists for the architecture (via the existing
 *     `listBaselines(projectId, architectureId, { kind:'current' })` read; the
 *     gateway re-validates the same `kind='current' AND status='active'` rule
 *     server-side, so this is the client-side gate + the orchestration scope).
 * Without these the live Migrate button posts an empty orchestration scope and
 * cannot detect the current baseline client-side. Each derive is fail-soft so a
 * transient lookup never blanks the dashboard (a missing baseline just keeps
 * Migrate hard-blocked, which is the safe default).
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useArchitectureDispatch } from '../../../contexts/ArchitectureContext';
import { useProject } from '../../../contexts/ProjectContext';
import { loadModelByProjectId } from '../../../api/modelApi';
import {
  getMigrationDeliveryDashboard,
  type MigrationDeliveryDashboardDto,
  type MigrationDeliveryHierarchyNodeDto,
} from '../../../api/migrationDeliveryDashboardApi';
import {
  getCapturedDecisionsSummary,
  type EpicCapturedDecisionsCountByEpicDto,
} from '../../../api/epicCapturedDecisionsApi';
import {
  getProjectById,
  type ProjectDto,
} from '../../../api/projectsApi';
import { getOrganisationById } from '../../../api/organisationsApi';
import { listBaselines } from '../../../api/apiBehaviourClient';
import { ProjectConfigModal } from '../../Project/ProjectConfigModal';
import type { EpicCapturedDecisionsSummaryByEpic } from './MigrationDeliveryEpicDecisionsSummary';
import { MigrationDeliveryDashboard } from './MigrationDeliveryDashboard';
import { EpicCapturedDecisionsPanel } from './EpicCapturedDecisionsPanel';

/** Walk the hierarchy depth-first to collect all epic nodes. */
function collectEpicNodes(
  hierarchy: ReadonlyArray<MigrationDeliveryHierarchyNodeDto>,
): MigrationDeliveryHierarchyNodeDto[] {
  const out: MigrationDeliveryHierarchyNodeDto[] = [];
  const walk = (nodes: ReadonlyArray<MigrationDeliveryHierarchyNodeDto>) => {
    for (const n of nodes) {
      if (n.type === 'epic' && n.workItemId) out.push(n);
      if (n.children && n.children.length > 0) walk(n.children);
    }
  };
  walk(hierarchy);
  return out;
}

/**
 * Props -- all optional test seams (Task Group 6). The route derives the
 * Migrate orchestration scope + the baseline precondition from the active
 * project + the existing baseline read; the seams let the route test assert the
 * derived values reach the dashboard without a live ProjectProvider / network.
 */
export interface MigrationDeliveryDashboardRouteProps {
  /** Test seam: the organisation-name lookup (defaults to the real client). */
  getOrganisationByIdFn?: typeof getOrganisationById;
  /** Test seam: the API-behaviour baseline list (defaults to the real client). */
  listBaselinesFn?: typeof listBaselines;
}


export function MigrationDeliveryDashboardRoute({
  getOrganisationByIdFn = getOrganisationById,
  listBaselinesFn = listBaselines,
}: MigrationDeliveryDashboardRouteProps = {}) {
  const { projectId, architectureId, bookId } = useParams<{
    projectId: string;
    architectureId: string;
    bookId: string;
  }>();
  const navigate = useNavigate();
  const dispatch = useArchitectureDispatch();
  const activeProject = useProject();

  const [epicDecisionsSummaries, setEpicDecisionsSummaries] = useState<
    ReadonlyArray<EpicCapturedDecisionsSummaryByEpic>
  >([]);
  const [openEpicPanelFor, setOpenEpicPanelFor] = useState<{
    epicWorkItemId: string;
    epicTitle: string;
  } | null>(null);
  const [projectConfigOpen, setProjectConfigOpen] = useState<boolean>(false);
  const [projectForConfig, setProjectForConfig] = useState<ProjectDto | null>(
    null,
  );

  // ----- Migrate orchestration scope + baseline precondition (Spec 2026-06-14,
  // Task Group 6). Derived from the active project + the existing baseline read
  // and threaded into the dashboard's Migrate panel. `company` resolves the
  // organisation NAME (the orchestration `company`); `project` is the active
  // project name (the orchestration `project`); `hasActiveCurrentBaseline`
  // mirrors the gateway's `kind='current' AND status='active'` rule. -----------
  const [company, setCompany] = useState<string>('');
  const [project, setProject] = useState<string>('');
  const [hasActiveCurrentBaseline, setHasActiveCurrentBaseline] =
    useState<boolean>(false);

  // AppShell cache invalidation after pass 2 persists. Best-effort: any
  // failure to load the fresh model is swallowed so it never poisons the
  // dashboard's post-batch render path. The dashboard already re-fetches
  // its own data so the worst case is a stale model cache for one extra
  // user interaction.
  const handlePassTwoPersisted = useCallback(
    async (input: { projectId: string; bookOfWorkId: string }) => {
      if (!architectureId) return;
      try {
        const model = await loadModelByProjectId(
          input.projectId,
          architectureId,
        );
        dispatch({
          type: 'LOAD_MODEL',
          payload: model as never,
          fileName: input.bookOfWorkId,
        });
      } catch {
        // ignore -- dashboard re-fetch covers visible state
      }
    },
    [architectureId, dispatch],
  );

  // Derive the orchestration scope from the active project (the
  // ImplementationAssistantPanel convention): company = organisation name,
  // project = project name. Fail-soft: a failed organisation lookup leaves
  // company empty (the server re-validates the hard-block regardless), but
  // project always falls back to the project name / id so the dispatch scope is
  // never silently lost.
  useEffect(() => {
    let cancelled = false;
    const derive = async () => {
      const projectName = activeProject?.name || projectId || '';
      if (!cancelled) setProject(projectName);

      if (!activeProject?.organisationId) {
        if (!cancelled) setCompany('');
        return;
      }
      try {
        const organisation = await getOrganisationByIdFn(
          activeProject.organisationId,
        );
        if (!cancelled) setCompany(organisation?.name ?? '');
      } catch {
        // Swallow -- a missing company keeps the server-side gate authoritative.
        if (!cancelled) setCompany('');
      }
    };
    void derive();
    return () => {
      cancelled = true;
    };
  }, [activeProject, projectId, getOrganisationByIdFn]);

  // Derive the oracle precondition: an active `kind='current'` API-behaviour
  // baseline must exist for the architecture before Migrate can run (CD-7).
  // Mirrors the gateway's `fetchActiveCurrentBaseline` (kind='current' AND
  // status='active'). Fail-soft: a read failure leaves the flag false, which
  // keeps Migrate hard-blocked with the missing-baseline reason -- the safe
  // default (the server re-validates regardless).
  useEffect(() => {
    let cancelled = false;
    const derive = async () => {
      if (!projectId || !architectureId) {
        if (!cancelled) setHasActiveCurrentBaseline(false);
        return;
      }
      try {
        const baselines = await listBaselinesFn(projectId, architectureId, {
          kind: 'current',
        });
        const hasActive = baselines.some(
          (b) =>
            (b.kind ?? 'current') === 'current' && b.status === 'active',
        );
        if (!cancelled) setHasActiveCurrentBaseline(hasActive);
      } catch {
        if (!cancelled) setHasActiveCurrentBaseline(false);
      }
    };
    void derive();
    return () => {
      cancelled = true;
    };
  }, [projectId, architectureId, listBaselinesFn]);

  // Fetch the epic-decisions summaries on mount + whenever projectId / bookId
  // changes. Best-effort: any failure leaves the dashboard summary empty.
  //
  // Follow-up #3 (2026-05-20): replaced the prior O(epic-count) loop with one
  // project-scoped bulk call. The dashboard hierarchy is still fetched so we
  // can attach each epic's TITLE to its summary row (AMS knows counts but not
  // titles).
  const loadEpicDecisionsSummaries = useCallback(async () => {
    if (!projectId || !bookId) return;
    let dashboard: MigrationDeliveryDashboardDto;
    try {
      dashboard = await getMigrationDeliveryDashboard(projectId, bookId);
    } catch {
      return;
    }
    const epics = collectEpicNodes(dashboard.hierarchy);
    if (epics.length === 0) {
      setEpicDecisionsSummaries([]);
      return;
    }
    let counts: EpicCapturedDecisionsCountByEpicDto[];
    try {
      counts = await getCapturedDecisionsSummary(projectId);
    } catch {
      setEpicDecisionsSummaries([]);
      return;
    }
    const titleByEpicId = new Map<string, string>();
    for (const epic of epics) {
      if (epic.workItemId) titleByEpicId.set(epic.workItemId, epic.title);
    }
    const summaries: EpicCapturedDecisionsSummaryByEpic[] = [];
    for (const c of counts) {
      const title = titleByEpicId.get(c.epicWorkItemId);
      if (!title) continue; // bulk endpoint returned an epic not in this book
      summaries.push({
        epicWorkItemId: c.epicWorkItemId,
        epicTitle: title,
        draftCount: c.draftCount,
        confirmedCount: c.confirmedCount,
        supersededCount: c.supersededCount,
      });
    }
    setEpicDecisionsSummaries(summaries);
  }, [projectId, bookId]);

  useEffect(() => {
    void loadEpicDecisionsSummaries();
  }, [loadEpicDecisionsSummaries]);

  const handleOpenProjectConfig = useCallback(async () => {
    if (!projectId) return;
    try {
      const project = await getProjectById(projectId);
      setProjectForConfig(project);
      setProjectConfigOpen(true);
    } catch {
      // Swallow -- the modal won't open. The dashboard's own error banner
      // doesn't cover this trigger, but a future enhancement could surface
      // it via a toast.
    }
  }, [projectId]);

  if (!projectId || !architectureId || !bookId) {
    return null;
  }

  const archScopedPrefix = `/projects/${projectId}/architectures/${architectureId}`;

  const handleOpenEpicDetail = (epicWorkItemId: string) => {
    const summary = epicDecisionsSummaries.find(
      (s) => s.epicWorkItemId === epicWorkItemId,
    );
    setOpenEpicPanelFor({
      epicWorkItemId,
      epicTitle: summary?.epicTitle ?? '',
    });
  };

  return (
    <>
      {/* Project-config trigger above the dashboard. Lives outside the
        * dashboard component so we don't disturb its existing prop shape /
        * tests; the per-project Task-Group-9 fields (token caps + auto-run
        * pass 2) are the dashboard's primary configuration concern, so the
        * trigger is here rather than buried in a global settings screen. */}
      <div
        data-testid="mdd-route-project-config-bar"
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          padding: '8px 16px 0 16px',
        }}
      >
        <button
          type="button"
          data-testid="mdd-route-open-project-config"
          onClick={() => void handleOpenProjectConfig()}
        >
          Project config
        </button>
      </div>
      <MigrationDeliveryDashboard
        projectId={projectId}
        bookId={bookId}
        defaultAutoRunPass2={projectForConfig?.autoRunPass2 ?? true}
        company={company}
        project={project}
        hasActiveCurrentBaseline={hasActiveCurrentBaseline}
        onBackToBookOfWork={() =>
          navigate(`${archScopedPrefix}/migration-books-of-work/${bookId}`)
        }
        onOpenBacklog={() => navigate(`${archScopedPrefix}/product/backlog`)}
        onOpenGeneratedSpecs={() =>
          // Phase 1c (2026-07-20): the plan REVIEW screen owns the spec
          // lifecycle — the standalone spec-generation workspace is gone.
          navigate(
            `${archScopedPrefix}/migration-books-of-work/${bookId}/review`,
          )
        }
        epicDecisionsSummaries={epicDecisionsSummaries}
        onOpenEpicDetail={handleOpenEpicDetail}
        onPassTwoPersisted={(input) => {
          void handlePassTwoPersisted(input);
          // Re-fetch the summaries after pass 2 persists so newly-seeded
          // decisions appear in the dashboard summary.
          void loadEpicDecisionsSummaries();
        }}
      />
      {openEpicPanelFor && (
        <EpicCapturedDecisionsPanel
          projectId={projectId}
          epicWorkItemId={openEpicPanelFor.epicWorkItemId}
          epicTitle={openEpicPanelFor.epicTitle}
          onClose={() => {
            setOpenEpicPanelFor(null);
            // Refresh summaries so any panel edits reflect in the dashboard.
            void loadEpicDecisionsSummaries();
          }}
        />
      )}
      {projectConfigOpen && (
        <ProjectConfigModal
          isOpen={projectConfigOpen}
          project={projectForConfig}
          onClose={() => setProjectConfigOpen(false)}
          onSaveSuccess={(updated) => {
            setProjectForConfig(updated);
            setProjectConfigOpen(false);
          }}
        />
      )}
    </>
  );
}

export default MigrationDeliveryDashboardRoute;
