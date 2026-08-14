/**
 * TargetArchitectureWorkspace
 *
 * Spec 2026-05-20 Target Architecture Authoring Flow -- Task Groups 6 + 7
 * Spec 2026-05-24 Target State Sub-tab + Deterministic Suggest -- Task Group 4
 *
 * Top-level "Target State" workspace, mounted under the Architecture & Design
 * page at `/projects/:p/architectures/:a/architecture-design/target-state`.
 * The workspace surfaces (clockwise from top-left):
 *
 *   - A drafts panel (left) listing every `kind='target'` row for the project,
 *     active-first then most-recent. The active draft is highlighted; the user
 *     can click a row to switch the editor's focus, inline-rename the draft,
 *     delete a non-active draft, or click "Promote" to open the promote-to-
 *     active confirm modal. Zero-element drafts are flagged with an inline
 *     "empty" badge so legacy broken drafts are visible at a glance.
 *   - A table editor (centre) grouped by element type
 *     (component / api / data entity / infrastructure). Read-only: the
 *     deterministic Suggest path is the canonical way to populate a draft;
 *     the inline-add UI was removed in spec 2026-05-24.
 *   - An unmapped-elements warning panel (right) listing current-architecture
 *     elements with no mapping into the active target. Per row: a "Mark
 *     decommissioned" action (calls the atomic AMS write path).
 *
 * Empty-state card:
 *   When zero drafts exist for the project, the workspace renders a centered
 *   empty-state card with a single Suggest button. The Drafts panel, table
 *   editor, Compare view, and Unmapped panel are all hidden in this state per
 *   spec 2026-05-24.
 *
 * The promote-to-active confirm modal:
 *   The drafts panel "Promote" button on a draft opens a single confirm modal
 *   that calls the promote endpoint twice: first with `dryRun=true` to render
 *   the impact-preview line ("This will mark N specs stale") BEFORE the user
 *   confirms, then again without `dryRun` to commit. Cancel closes the modal
 *   without calling the commit endpoint.
 *
 * Deterministic Suggest (spec 2026-05-24):
 *   The Suggest button calls the deterministic
 *   `POST /api/projects/{projectId}/target-architectures/suggest-from-current`
 *   endpoint via `suggestTargetFromCurrent`. The new draft is a NEW
 *   architecture (sibling under the same project) populated by an AMS-side
 *   deep-clone of the current architecture. Every cloned element carries
 *   `provenance='cloned-from'` server-side; the frontend no longer
 *   stamps provenance overlays for the LLM-suggested path (removed in this
 *   spec).
 *
 * AppShell cache invalidation:
 *   Every successful mutation (seed, rename, delete, decommission, promote)
 *   dispatches `LOAD_MODEL` (same-arch) or invalidates the per-architecture
 *   in-memory model cache (cross-arch) per `project_appshell_model_cache.md`.
 *   The deterministic Suggest flow creates a new draft id distinct from the
 *   active architecture, so it always takes the cross-arch invalidation path.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useProject } from '../../contexts/ProjectContext';
import {
  useArchitectureContext,
  useActiveArchitectureId,
  useArchitectureDispatch,
} from '../../contexts/ArchitectureContext';
import {
  ElementInventoryDomain,
  ElementInventoryResponse,
  getElementsInventory,
  listArchitectureMappings,
  updateArchitecture,
} from '../../api/architecturesApi';
import {
  deleteTargetArchitecture,
  listTargetArchitectures,
  listDecommissionedInTargetAnnotations,
  listUnmappedCurrentElements,
  markCurrentElementDecommissioned,
  promoteTargetArchitecture,
  seedTargetArchitecture,
  suggestTargetFromCurrent,
  DecommissionedInTargetAnnotation,
  PromoteTargetArchitectureResponse,
  SeedTargetArchitectureMode,
  TargetArchitectureDto,
  TargetArchitecturesApiError,
  UnmappedCurrentElement,
} from '../../api/targetArchitecturesApi';
import { loadModelByProjectId } from '../../api/modelApi';
import type { ManifestServiceOption } from '../../api/targetManifestApi';
import {
  TargetArchitectureCompareView,
  type CompareMapping,
} from './TargetArchitectureCompareView';
import { ArchitectConversationTab } from '../targetState/architectConversation/ArchitectConversationTab';
import { RightHandPanelShell } from '../common/RightHandPanelShell';
import {
  listCapturedDecisions,
  type CapturedDecisionDto,
} from '../../api/architectConversationApi';
import {
  useVulnerabilityReduction,
} from '../targetState/architectConversation/useVulnerabilityReduction';
import type { TargetCoordinateFateInput } from '../../api/vulnerabilityReductionApi';
import { VulnerabilityReductionPanel } from './VulnerabilityReductionPanel';
import styles from './TargetArchitectureWorkspace.module.css';

// ---------------------------------------------------------------------------
// Element-type grouping for the table editor.
//
// The spec lists four buckets: component / api / data-entity / infrastructure.
// The frontend's `ElementInventoryResponse` is grouped by AMS domain name
// ("Applications", "Data", "Behavioural", etc.). We coalesce them into the
// four spec buckets via this coarse mapping so the editor renders the same
// structure across both current and target architectures.
// ---------------------------------------------------------------------------

interface GroupedElementRow {
  id: string;
  name: string;
  /** Backend entity type label (e.g. "application_component"). */
  entityType: string;
}

interface GroupedRows {
  component: GroupedElementRow[];
  api: GroupedElementRow[];
  dataEntity: GroupedElementRow[];
  infrastructure: GroupedElementRow[];
}

const EMPTY_GROUPS: GroupedRows = {
  component: [],
  api: [],
  dataEntity: [],
  infrastructure: [],
};

type ElementGroupKey = keyof GroupedRows;

/** Human-readable label per group, used in headers. */
const ELEMENT_GROUP_LABEL: Record<ElementGroupKey, string> = {
  component: 'Components',
  api: 'APIs',
  dataEntity: 'Data entities',
  infrastructure: 'Infrastructure',
};

/**
 * Heuristic mapping of inventory domains/types -> the spec's four buckets.
 */
function bucketise(inventory: ElementInventoryResponse | null): GroupedRows {
  if (!inventory) return EMPTY_GROUPS;
  const out: GroupedRows = {
    component: [],
    api: [],
    dataEntity: [],
    infrastructure: [],
  };

  const collect = (
    bucket: keyof GroupedRows,
    domains: ElementInventoryDomain[],
    typeNamePredicate: (typeName: string) => boolean = () => true,
  ) => {
    for (const dom of domains) {
      for (const type of dom.types) {
        if (!typeNamePredicate(type.name)) continue;
        for (const inst of type.instances) {
          out[bucket].push({
            id: inst.id,
            name: inst.name,
            entityType: type.entityType ?? type.name,
          });
        }
      }
    }
  };

  const applicationsDomain = inventory.domains.filter(
    d => d.name.toLowerCase() === 'applications' || d.name.toLowerCase() === 'application',
  );
  const dataDomain = inventory.domains.filter(
    d => d.name.toLowerCase() === 'data',
  );
  const infraDomain = inventory.domains.filter(
    d => d.name.toLowerCase() === 'infrastructure',
  );

  collect('component', applicationsDomain, name => {
    const n = name.toLowerCase();
    return (
      n === 'applications' ||
      n === 'application' ||
      n === 'application components' ||
      n === 'app_components'
    );
  });
  collect('api', applicationsDomain, name => {
    const n = name.toLowerCase();
    return n === 'services' || n === 'interfaces' || n === 'endpoints';
  });
  collect('dataEntity', dataDomain);
  collect('infrastructure', infraDomain);

  return out;
}

/**
 * The TARGET draft's `services` elements as manifest-picker options
 * (2026-08-14). Same Applications-domain / service-type selection rule as the
 * gateway's scaffold-service reader (the inventory type is named "Services";
 * the UI's "APIs" bucket merges services+interfaces+endpoints, which is why a
 * services element like a "<name> API" DISPLAYS under APIs). Archived
 * instances are skipped. Exported for unit tests.
 */
export function targetServicesFromInventory(
  inventory: ElementInventoryResponse | null,
): ManifestServiceOption[] {
  const options: ManifestServiceOption[] = [];
  for (const domain of inventory?.domains ?? []) {
    if (domain.name.toLowerCase() !== 'applications' && domain.name.toLowerCase() !== 'application') {
      continue;
    }
    for (const type of domain.types ?? []) {
      if (!/service/i.test(type.name)) continue;
      for (const instance of type.instances ?? []) {
        if (instance.archived) continue;
        options.push({ id: instance.id, name: instance.name });
      }
    }
  }
  return options;
}

/**
 * Sum the four-bucket counts. Used by the Drafts panel to flag zero-element
 * drafts with the inline "empty" badge (spec 2026-05-24 -- task 4.9).
 */
function totalElementCount(grouped: GroupedRows): number {
  return (
    grouped.component.length +
    grouped.api.length +
    grouped.dataEntity.length +
    grouped.infrastructure.length
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const TargetArchitectureWorkspace: React.FC = () => {
  const project = useProject();
  const activeArchitectureId = useActiveArchitectureId();
  const dispatch = useArchitectureDispatch();
  const { invalidateArchitectureModelCache } = useArchitectureContext();

  const projectId = project?.id ?? null;

  const [targets, setTargets] = useState<TargetArchitectureDto[]>([]);
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [draftListError, setDraftListError] = useState<string | null>(null);
  const [seedDialogOpen, setSeedDialogOpen] = useState(false);
  const [inventory, setInventory] = useState<ElementInventoryResponse | null>(null);

  // Promote-to-active modal state. `promoteCandidateId` is non-null iff the
  // modal is open; the preview data and error are populated by the dry-run
  // call fired on open.
  const [promoteCandidateId, setPromoteCandidateId] = useState<string | null>(null);

  // -----------------------------------------------------------------------
  // View mode tabs (table editor + compare). Spec 2026-05-24 removed the
  // diagram view tab; only the two peers remain.
  // -----------------------------------------------------------------------

  type ViewMode = 'table' | 'compare';
  const [viewMode, setViewMode] = useState<ViewMode>('table');
  // The Architect Conversation now lives in a toggled right-side OVERLAY panel
  // (matching the tool's standard RHS conversation pattern) rather than a
  // center view-mode tab. It slides in over the right of the active view.
  const [conversationOpen, setConversationOpen] = useState(false);

  // One-frame highlight flag used by the Architect Conversation tab's
  // empty-state path (Surface 2 per Q23) to soft-push the user back here and
  // pulse the Suggest button via the `data-suggest-highlight` attribute on
  // the DraftsPanel control.
  const [highlightSuggest, setHighlightSuggest] = useState(false);
  const handleEmptyStateRedirectFromConversation = useCallback(() => {
    setConversationOpen(false);
    setHighlightSuggest(true);
    requestAnimationFrame(() => {
      // Clear after one paint -- mirrors the spec's 'one-frame highlight' phrasing.
      setHighlightSuggest(false);
    });
  }, []);

  /**
   * Spec 2026-05-26: "View in conversation" callback fired from a captured-
   * decision chip popover. Flips the viewMode to 'conversation' AND stashes
   * the decisionId in transient state; the conversation pane reads the
   * scrollToDecisionId prop, calls scrollIntoView on the matching turn DOM
   * node, then invokes onScrolledToDecision to clear the state.
   *
   * Q3 critical: callback path, NOT URL-hash navigation. viewMode is local
   * useState so a URL hash alone cannot switch the tab. No
   * window.location.hash plumbing, no hashchange listener, no history
   * pollution.
   */
  const handleOpenInConversation = useCallback((decisionId: string) => {
    setConversationOpen(true);
    setScrollToDecisionId(decisionId);
  }, []);

  const handleScrolledToDecision = useCallback(() => {
    setScrollToDecisionId(null);
  }, []);

  /**
   * In-flight flag for the deterministic
   * `POST .../target-architectures/suggest-from-current` call. Gates the
   * Suggest button(s) per spec 2026-05-24 (task 4.4) so a double-click
   * cannot fire two parallel deep-clones. Server-side also has a 5-second
   * 409 guard; this is the local guard.
   */
  const [suggestPending, setSuggestPending] = useState(false);

  /**
   * Last suggest-call failure message. Cleared on success / next attempt.
   * Surfaced as an inline error in the Drafts panel header or the empty-
   * state card depending on which surface is rendering the button.
   */
  const [suggestError, setSuggestError] = useState<string | null>(null);

  /**
   * Current-architecture inventory snapshot used by the compare view. We
   * fetch this lazily on first switch to the compare tab to avoid an
   * unconditional network round-trip on workspace mount.
   */
  const [currentInventory, setCurrentInventory] =
    useState<ElementInventoryResponse | null>(null);

  /**
   * "Decommissioned in target" annotation rows for the current arch.
   * Fetched alongside `currentInventory` for the compare view.
   */
  const [decommissionedAnnotations, setDecommissionedAnnotations] = useState<
    DecommissionedInTargetAnnotation[]
  >([]);

  /**
   * Mappings for the compare view, sourced from
   * `GET /api/projects/{projectId}/architecture-mappings?sourceArchitectureId=...&targetArchitectureId=...`.
   * AMS is the authoritative source: each row's `sourceElementId` is the
   * current-side id, `targetElementId` is the target-side id, and the
   * mapping `mappingType` (e.g. "equivalent", "decommissioned") drives
   * how the compare view renders the pair. Empty list = no mappings;
   * the compare view tolerates that.
   */
  const [mappings, setMappings] = useState<CompareMapping[]>([]);

  /**
   * Captured architect decisions for the selected target draft, used by the
   * Compare View chip decoration (spec 2026-05-26). Fetched in the same
   * lazy useEffect as the rest of the compare-view data; defaults to empty
   * on error (silent fail-soft per Q9 progressive enhancement).
   */
  const [capturedDecisions, setCapturedDecisions] = useState<CapturedDecisionDto[]>(
    [],
  );

  /**
   * Transient state set when a captured-decision chip's "View in conversation"
   * link fires. The conversation pane reads this prop, scrolls to the matching
   * decision-captured turn, then calls back to clear it so the same id does
   * not re-trigger on re-render (spec 2026-05-26 Q3 callback path).
   */
  const [scrollToDecisionId, setScrollToDecisionId] = useState<string | null>(
    null,
  );

  // Active-target id resolved from the targets list (used to scope the
  // unmapped-elements panel + decommission writes).
  const activeTarget = useMemo(
    () => targets.find(t => t.draftState === 'active') ?? null,
    [targets],
  );

  // -----------------------------------------------------------------------
  // Spec 4 (2026-06-24-vulnerability-reduction-and-steering) -- Task Group 7.2:
  // the estimated current->target CVE reduction panel, hosted ABOVE the compare
  // table (the compare view's 5-column contract is untouched). The roll-up is
  // read from the ONE shared Task Group 2 delta via `useVulnerabilityReduction`
  // -- per-surface re-derivation is a DEFECT.
  //
  // The workspace assembles a mapping-aware fate map from the
  // `architecture_element_mappings`-derived "decommissioned in target"
  // annotations: a decommissioned LIBRARY (whose `name` is the coordinate
  // `group:artifact` / npm package -- per the libraries-table convention) is a
  // `removed` fate, which ELIMINATES its CVEs by removal (no version bump needed,
  // honoured even for a no-known-fix CVE). Coordinates with a live target version
  // are graded by the conversation surface (which holds the manifest-resolved
  // versions); here the decommission fates are the durable, queryable signal. The
  // panel hides entirely when there is no fate map (no target snapshot) --
  // mirroring `findingsCoverage.ts`'s null-on-no-snapshot rule.
  const decommissionFateByCoordinate = useMemo<Record<string, TargetCoordinateFateInput>>(() => {
    const out: Record<string, TargetCoordinateFateInput> = {};
    for (const ann of decommissionedAnnotations) {
      const coordinate = (ann.name ?? '').trim();
      // Only library-style coordinates (group:artifact or an npm package) can be
      // matched to a current CVE coordinate; skip plain element names that carry
      // no coordinate shape so we never fabricate a fate for a non-library row.
      if (coordinate.length === 0) continue;
      const looksLikeCoordinate = coordinate.includes(':') || coordinate.includes('/') || coordinate.includes('.');
      if (!looksLikeCoordinate) continue;
      out[coordinate] = { kind: 'removed', via: 'decommissioned' };
    }
    return out;
  }, [decommissionedAnnotations]);

  const hasReductionFates = Object.keys(decommissionFateByCoordinate).length > 0;

  const { reduction: workspaceReduction } = useVulnerabilityReduction({
    projectId: projectId ?? '',
    currentArchitectureId: activeArchitectureId,
    targetArchitectureId: selectedDraftId,
    targetResolvedDependencies: [],
    extraFateByCoordinate: hasReductionFates ? decommissionFateByCoordinate : null,
  });
  const workspaceVulnDelta = workspaceReduction?.delta ?? null;

  // -----------------------------------------------------------------------
  // Initial + post-mutation draft fetch.
  // -----------------------------------------------------------------------

  const refreshDrafts = useCallback(async () => {
    if (!projectId) return;
    try {
      const rows = await listTargetArchitectures(projectId);
      setTargets(rows);
      setDraftListError(null);
      // Default the selection to the first row (active-first per the AMS
      // ordering) if the current selection no longer exists.
      setSelectedDraftId(prev => {
        if (prev && rows.some(r => r.id === prev)) return prev;
        return rows[0]?.id ?? null;
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to load target architectures';
      setDraftListError(message);
    }
  }, [projectId]);

  useEffect(() => {
    void refreshDrafts();
  }, [refreshDrafts]);

  // -----------------------------------------------------------------------
  // Element inventory for the selected draft.
  // -----------------------------------------------------------------------

  const refreshInventory = useCallback(async () => {
    if (!projectId || !selectedDraftId) {
      setInventory(null);
      return;
    }
    try {
      const data = await getElementsInventory(projectId, selectedDraftId);
      setInventory(data);
    } catch {
      // Failure leaves the editor empty rather than blocking the workspace.
      setInventory(null);
    }
  }, [projectId, selectedDraftId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (cancelled) return;
      await refreshInventory();
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshInventory]);

  const grouped = useMemo(() => bucketise(inventory), [inventory]);
  const selectedDraftElementCount = useMemo(
    () => totalElementCount(grouped),
    [grouped],
  );

  // Manifest picker options (2026-08-14): the TARGET draft's `services`
  // elements from ITS element inventory. The conversation tab's own
  // ArchitectureContext model is the CURRENT-STATE architecture on this page;
  // binding a manifest to one of its element ids fails the AMS ownership
  // validation (service_element_not_in_architecture), which killed every
  // confirmed-manifest persist.
  const targetManifestServiceOptions: ManifestServiceOption[] = useMemo(
    () => targetServicesFromInventory(inventory),
    [inventory],
  );

  // -----------------------------------------------------------------------
  // Unmapped-elements panel data (scoped to the active target).
  // -----------------------------------------------------------------------

  const [unmappedRows, setUnmappedRows] = useState<UnmappedCurrentElement[]>([]);

  const refreshUnmapped = useCallback(async () => {
    if (!projectId || !activeArchitectureId || !activeTarget) {
      setUnmappedRows([]);
      return;
    }
    try {
      // Scan the CURRENT architecture's elements (activeArchitectureId), scoped
      // to the active target draft -- i.e. current elements with no mapping into
      // that target. Previously this passed the target's OWN id as the
      // architecture to scan, so it listed the target's clones and never matched
      // the current-keyed mappings -> every element showed as unmapped.
      const rows = await listUnmappedCurrentElements(
        projectId, activeArchitectureId, activeTarget.id);
      setUnmappedRows(rows);
    } catch {
      // Empty list on error; the panel surfaces its own empty-state copy.
      setUnmappedRows([]);
    }
  }, [projectId, activeArchitectureId, activeTarget]);

  useEffect(() => {
    void refreshUnmapped();
  }, [refreshUnmapped]);

  // -----------------------------------------------------------------------
  // AppShell cache coordination after a mutation.
  // -----------------------------------------------------------------------

  const syncAppShellCache = useCallback(
    async (touchedArchitectureId: string | null) => {
      if (!projectId || !touchedArchitectureId) return;
      if (touchedArchitectureId === activeArchitectureId) {
        try {
          const model = await loadModelByProjectId(projectId, activeArchitectureId);
          dispatch({
            type: 'LOAD_MODEL',
            payload: model,
            fileName: project?.name ?? touchedArchitectureId,
          });
        } catch {
          invalidateArchitectureModelCache(touchedArchitectureId);
        }
        return;
      }
      invalidateArchitectureModelCache(touchedArchitectureId);
    },
    [
      projectId,
      activeArchitectureId,
      dispatch,
      invalidateArchitectureModelCache,
      project?.name,
    ],
  );

  // -----------------------------------------------------------------------
  // Drafts panel handlers.
  // -----------------------------------------------------------------------

  const handleRenameDraft = useCallback(
    async (draftId: string, newName: string) => {
      if (!projectId || !newName.trim()) return;
      const target = targets.find(t => t.id === draftId);
      if (!target) return;
      if (target.name === newName.trim()) return;
      try {
        await updateArchitecture(projectId, draftId, {
          name: newName.trim(),
          description: target.description ?? '',
          tags: target.tags ?? [],
        });
        await refreshDrafts();
        await syncAppShellCache(draftId);
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : 'Failed to rename target architecture';
        setDraftListError(message);
      }
    },
    [projectId, targets, refreshDrafts, syncAppShellCache],
  );

  const handleDeleteDraft = useCallback(
    async (draftId: string, isActiveDraft: boolean) => {
      if (!projectId) return;
      if (isActiveDraft) {
        const ok = window.confirm(
          'This is the ACTIVE target. Deleting it leaves the project with no ' +
            'active target until you promote another draft. Delete it anyway?',
        );
        if (!ok) return;
      }
      try {
        await deleteTargetArchitecture(projectId, draftId, isActiveDraft);
        await refreshDrafts();
        await syncAppShellCache(draftId);
      } catch (err) {
        const message =
          err instanceof TargetArchitecturesApiError
            ? err.body.message ?? err.message
            : err instanceof Error
              ? err.message
              : 'Failed to delete target architecture';
        setDraftListError(message);
      }
    },
    [projectId, refreshDrafts, syncAppShellCache],
  );

  const handleOpenPromote = useCallback((draftId: string) => {
    setPromoteCandidateId(draftId);
  }, []);

  const handleClosePromote = useCallback(() => {
    setPromoteCandidateId(null);
  }, []);

  /**
   * Commit handler for the promote modal. Calls the commit endpoint (no
   * dryRun), refreshes drafts + unmapped panel + the AppShell cache, and
   * closes the modal.
   */
  const handleConfirmPromote = useCallback(
    async (draftId: string) => {
      if (!projectId) return;
      try {
        await promoteTargetArchitecture(projectId, draftId);
        await refreshDrafts();
        await refreshUnmapped();
        await syncAppShellCache(draftId);
        setPromoteCandidateId(null);
      } catch (err) {
        const message =
          err instanceof TargetArchitecturesApiError
            ? err.body.message ?? err.message
            : err instanceof Error
              ? err.message
              : 'Failed to promote target architecture';
        setDraftListError(message);
      }
    },
    [projectId, refreshDrafts, refreshUnmapped, syncAppShellCache],
  );

  // -----------------------------------------------------------------------
  // Seed dialog handler.
  // -----------------------------------------------------------------------

  const handleSeed = useCallback(
    async (mode: SeedTargetArchitectureMode) => {
      if (!projectId) return;
      try {
        const created = await seedTargetArchitecture(projectId, { mode });
        await refreshDrafts();
        setSelectedDraftId(created.id);
        setSeedDialogOpen(false);
        await syncAppShellCache(created.id);
      } catch (err) {
        const message =
          err instanceof TargetArchitecturesApiError
            ? err.body.message ?? err.message
            : err instanceof Error
              ? err.message
              : 'Failed to seed target architecture';
        setDraftListError(message);
      }
    },
    [projectId, refreshDrafts, syncAppShellCache],
  );

  // -----------------------------------------------------------------------
  // Unmapped-panel handlers.
  // -----------------------------------------------------------------------

  /**
   * "Mark decommissioned" action: writes the target-side row + the
   * `mapping_type='decommissioned'` mapping atomically. Refresh the unmapped
   * panel + table inventory + AppShell cache afterwards.
   */
  const handleMarkDecommissioned = useCallback(
    async (row: UnmappedCurrentElement) => {
      if (!projectId || !activeTarget) return;
      try {
        await markCurrentElementDecommissioned(projectId, activeTarget.id, {
          currentElementId: row.elementId,
          currentElementType: row.elementType,
        });
        await refreshUnmapped();
        await refreshInventory();
        await syncAppShellCache(activeTarget.id);
      } catch (err) {
        const message =
          err instanceof TargetArchitecturesApiError
            ? err.body.message ?? err.message
            : err instanceof Error
              ? err.message
              : 'Failed to mark element decommissioned';
        setDraftListError(message);
      }
    },
    [projectId, activeTarget, refreshUnmapped, refreshInventory, syncAppShellCache],
  );

  // -----------------------------------------------------------------------
  // Spec 2026-05-24: Deterministic "Suggest target from current" handler.
  //
  // Replaces the May-20 LLM Suggest path entirely. The handler:
  //
  //   1. Captures the current `activeArchitectureId` at click time (a
  //      mid-flight architecture switch must not redirect the clone).
  //   2. Calls `suggestTargetFromCurrent(projectId, {currentArchitectureId})`.
  //   3. On success: refreshes the drafts list, auto-selects the newly-
  //      created draft via `result.newDraftId`, and invalidates the
  //      AppShell per-architecture model cache for the new draft
  //      (cross-architecture invalidation -- the new draft is a fresh
  //      architecture id distinct from the active one, so we cannot
  //      LOAD_MODEL into the current dispatch slot).
  //   4. On 422 (`empty_current_architecture`): clears the error after
  //      surfacing the backend message.
  //   5. On 409 (`recent_duplicate_suggest`): surfaces a retry-after
  //      message; the server-side guard means the user must wait ~5s.
  //
  // No LLM, no streaming, no per-element fan-out -- AMS does the deep-clone
  // server-side and returns the new draft id.
  // -----------------------------------------------------------------------

  const handleSuggestFromCurrent = useCallback(async () => {
    if (!projectId || !activeArchitectureId) return;
    const capturedArchitectureId = activeArchitectureId;
    setSuggestPending(true);
    setSuggestError(null);
    try {
      const result = await suggestTargetFromCurrent(projectId, {
        currentArchitectureId: capturedArchitectureId,
      });
      await refreshDrafts();
      setSelectedDraftId(result.newDraftId);
      // Cross-architecture invalidate: the new draft is a fresh architecture
      // id distinct from the active one (per
      // project_appshell_model_cache.md, same-arch dispatches use
      // LOAD_MODEL, cross-arch use invalidate). The user must navigate to
      // the new draft for the model to be fetched.
      invalidateArchitectureModelCache(result.newDraftId);
    } catch (err) {
      if (err instanceof TargetArchitecturesApiError) {
        if (err.body.code === 'empty_current_architecture') {
          setSuggestError(
            err.body.message ??
              'Current architecture has no elements to suggest from.',
          );
        } else if (err.body.code === 'recent_duplicate_suggest') {
          setSuggestError(
            err.body.message ??
              'A Suggest request was just made -- please wait a few seconds and try again.',
          );
        } else {
          setSuggestError(
            err.body.message ??
              err.message ??
              'Failed to suggest target architecture from current.',
          );
        }
      } else {
        const message =
          err instanceof Error
            ? err.message
            : 'Failed to suggest target architecture from current.';
        setSuggestError(message);
      }
    } finally {
      setSuggestPending(false);
    }
  }, [
    projectId,
    activeArchitectureId,
    refreshDrafts,
    invalidateArchitectureModelCache,
  ]);

  // -----------------------------------------------------------------------
  // Compare-view data fetch (lazy; fires when the user switches to the
  // compare tab).
  // -----------------------------------------------------------------------

  useEffect(() => {
    if (viewMode !== 'compare') return;
    if (!projectId || !activeArchitectureId) return;
    const targetArchId = selectedDraftId;
    let cancelled = false;
    void (async () => {
      try {
        const [inv, ann, rawMappings, decisions] = await Promise.all([
          getElementsInventory(projectId, activeArchitectureId),
          listDecommissionedInTargetAnnotations(
            projectId,
            activeArchitectureId,
            targetArchId,
          ),
          targetArchId
            ? listArchitectureMappings(projectId, {
                sourceArchitectureId: activeArchitectureId,
                targetArchitectureId: targetArchId,
              })
            : Promise.resolve([]),
          // Spec 2026-05-26: captured decisions for the target draft, fetched
          // alongside the compare-view data set. Q9 progressive enhancement:
          // the compare table renders immediately on the other promises;
          // banner + chips appear when this promise resolves. Silent fail-
          // soft on error (caught below); the default empty array leaves
          // the compare view undecorated rather than blocking it.
          targetArchId
            ? listCapturedDecisions(projectId, targetArchId, {
                includeSuperseded: false,
              }).catch(() => [] as CapturedDecisionDto[])
            : Promise.resolve([] as CapturedDecisionDto[]),
        ]);
        if (cancelled) return;
        setCurrentInventory(inv);
        setDecommissionedAnnotations(ann);
        const mapped: CompareMapping[] = rawMappings.map(m => ({
          currentElementId: m.sourceElementId,
          targetElementId: m.targetElementId,
          mappingType: m.mappingType,
        }));
        setMappings(mapped);
        // Belt-and-braces filter: AMS defaults to latest-only and we pass
        // includeSuperseded=false explicitly, but filter again here so a
        // future API change cannot leak superseded rows into the chip group.
        setCapturedDecisions(
          decisions.filter(d => d.supersededById === null),
        );
      } catch {
        if (cancelled) return;
        setCurrentInventory(null);
        setDecommissionedAnnotations([]);
        setMappings([]);
        setCapturedDecisions([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [viewMode, projectId, activeArchitectureId, selectedDraftId]);

  if (!project) {
    return (
      <div className={styles.workspace} data-testid="target-architecture-workspace">
        <div className={styles.emptyMessage}>
          Select a project to author its target architecture.
        </div>
      </div>
    );
  }

  const selectedDraft = targets.find(t => t.id === selectedDraftId) ?? null;
  const promoteCandidate = promoteCandidateId
    ? targets.find(t => t.id === promoteCandidateId) ?? null
    : null;

  // -----------------------------------------------------------------------
  // Empty-state branch (spec 2026-05-24 -- task 4.8). When zero drafts
  // exist for the project, render a centered card with the Suggest button.
  // The Drafts panel, table editor, Compare view, and Unmapped panel are
  // all hidden in this state.
  // -----------------------------------------------------------------------
  if (targets.length === 0) {
    return (
      <div
        className={styles.workspace}
        data-testid="target-architecture-workspace"
      >
        <div className={styles.header}>
          <h2>Target State</h2>
        </div>
        {draftListError && (
          <div className={styles.errorBanner} role="alert">
            {draftListError}
          </div>
        )}
        <div
          className={styles.emptyStateCard}
          data-testid="target-arch-empty-state-card"
        >
          <p className={styles.emptyStateCopy}>
            Target State is your proposed end-state architecture. Click
            Suggest to generate a 1:1 clone of your current architecture as a
            starting point.
          </p>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={() => void handleSuggestFromCurrent()}
            disabled={suggestPending || !activeArchitectureId}
            title={
              !activeArchitectureId
                ? 'Open a current architecture first'
                : 'Generate a target draft by cloning the current architecture'
            }
            data-testid="target-arch-suggest-from-current-button-empty"
          >
            {suggestPending ? 'Suggesting...' : 'Suggest'}
          </button>
          {suggestError && (
            <div
              className={styles.errorBanner}
              role="alert"
              data-testid="target-arch-suggest-error"
            >
              {suggestError}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.workspace} data-testid="target-architecture-workspace">
      <div className={styles.header}>
        <h2>Target State</h2>
        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={() => setSeedDialogOpen(true)}
            data-testid="target-arch-new-draft-button"
          >
            New draft
          </button>
        </div>
      </div>

      {draftListError && (
        <div className={styles.errorBanner} role="alert">
          {draftListError}
        </div>
      )}

      {/*
         * View-mode tabs. Spec 2026-05-24 removed the diagram view tab; the
         * two peers (Table editor + Compare with current) remain.
         */}
      <div
        className={styles.viewTabs}
        role="tablist"
        data-testid="target-arch-view-tabs"
      >
        <button
          type="button"
          role="tab"
          aria-selected={viewMode === 'table'}
          className={
            viewMode === 'table'
              ? `${styles.viewTab} ${styles.viewTabActive}`
              : styles.viewTab
          }
          onClick={() => setViewMode('table')}
          data-testid="target-arch-view-tab-table"
        >
          Table editor
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={viewMode === 'compare'}
          className={
            viewMode === 'compare'
              ? `${styles.viewTab} ${styles.viewTabActive}`
              : styles.viewTab
          }
          onClick={() => setViewMode('compare')}
          data-testid="target-arch-view-tab-compare"
        >
          Compare with current
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={conversationOpen}
          className={
            conversationOpen
              ? `${styles.viewTab} ${styles.viewTabActive}`
              : styles.viewTab
          }
          onClick={() => setConversationOpen((o) => !o)}
          data-testid="target-arch-view-tab-conversation"
        >
          Architect Conversation
        </button>
      </div>

      <div className={styles.layout}>
        <DraftsPanel
          drafts={targets}
          selectedDraftId={selectedDraftId}
          selectedDraftElementCount={selectedDraftElementCount}
          onSelect={setSelectedDraftId}
          onRename={handleRenameDraft}
          onDelete={handleDeleteDraft}
          onPromote={handleOpenPromote}
          onSuggestFromCurrent={handleSuggestFromCurrent}
          suggestPending={suggestPending}
          suggestError={suggestError}
          suggestDisabled={!activeArchitectureId}
          highlightSuggest={highlightSuggest}
        />
        {viewMode === 'table' && (
          <TableEditorPanel
            selectedDraft={selectedDraft}
            grouped={grouped}
          />
        )}
        {viewMode === 'compare' && (
          <div className={styles.compareColumn} data-testid="target-arch-compare-column">
            <VulnerabilityReductionPanel
              delta={workspaceVulnDelta}
              osvNote={workspaceReduction?.osv && !workspaceReduction.osv.available ? workspaceReduction.osv.note ?? null : null}
              heading="Estimated vulnerability reduction (current vs target)"
              testIdSuffix="compare"
            />
            <TargetArchitectureCompareView
            currentInventory={currentInventory}
            targetInventory={inventory}
            mappings={mappings}
            decommissionedAnnotations={decommissionedAnnotations}
            capturedDecisions={capturedDecisions}
              onOpenInConversation={handleOpenInConversation}
            />
          </div>
        )}
        {viewMode === 'table' && (
          <UnmappedElementsPanel
            activeTargetName={activeTarget?.name ?? null}
            rows={unmappedRows}
            onMarkDecommissioned={handleMarkDecommissioned}
          />
        )}
      </div>

      {/* Architect Conversation -- right-side panel styled + behaving like the
          tool's standard chat panel (persona + room header, collapse-to-tab,
          drag-resize), toggled by the "Architect Conversation" button. */}
      {conversationOpen && projectId && (
        <RightHandPanelShell
          storageKey={projectId}
          personaId="architect"
          roomName="Architecture Room"
          collapsedLabel="Architect"
          onClose={() => setConversationOpen(false)}
          /* Spec 2026-06-27 (Task Group 3): bound the shell content wrapper so
             the conversation's inner height chain resolves and ONLY its
             transcript scrolls (Discovery keeps the default 'auto'). */
          contentOverflow="hidden"
        >
          <ArchitectConversationTab
            projectId={projectId}
            selectedTargetArchitectureId={selectedDraftId}
            currentUserId={'current-user'}
            architectureName={selectedDraft?.name ?? undefined}
            conversationSavedAt={selectedDraft?.conversationSavedAt ?? null}
            onEmptyStateRedirect={handleEmptyStateRedirectFromConversation}
            scrollToDecisionId={scrollToDecisionId}
            onScrolledToDecision={handleScrolledToDecision}
            /* 2026-08-14: the manifest picker MUST offer the TARGET draft's
               services elements — the tab's own ArchitectureContext model is
               the CURRENT-STATE architecture on this page, and its element
               ids fail the AMS ownership validation (the live
               service_element_not_in_architecture 400 on every upload). */
            manifestServiceOptions={targetManifestServiceOptions}
          />
        </RightHandPanelShell>
      )}

      {seedDialogOpen && (
        <SeedTargetArchitectureDialog
          onCancel={() => setSeedDialogOpen(false)}
          onSubmit={handleSeed}
        />
      )}

      {promoteCandidate && projectId && (
        <PromoteConfirmModal
          projectId={projectId}
          candidate={promoteCandidate}
          onCancel={handleClosePromote}
          onConfirm={() => void handleConfirmPromote(promoteCandidate.id)}
        />
      )}
    </div>
  );
};

// ===========================================================================
// DraftsPanel
// ===========================================================================

interface DraftsPanelProps {
  drafts: TargetArchitectureDto[];
  selectedDraftId: string | null;
  /**
   * When true, the Suggest button receives a one-frame highlight (per Q23
   * Surface 2 of Spec 3 -- the Architect Conversation tab's empty-state path
   * soft-redirects here and flashes the Suggest control).
   */
  highlightSuggest?: boolean;
  /**
   * Element count of the currently-selected draft (sourced from the
   * inventory fetch). Retained for cross-check telemetry and for the case
   * where the AMS list response omits {@code elementCount} (older builds):
   * when a draft's DTO carries {@code elementCount === null} but it happens
   * to be the selected draft, this fallback gives the badge logic a value to
   * read.
   *
   * <p>Four-Spec Hardening Pass (2026-05-25), Item 3: the canonical badge
   * source is now {@code draft.elementCount} from the list response, which
   * lets the panel badge EVERY draft with zero elements rather than only the
   * selected one.</p>
   */
  selectedDraftElementCount: number;
  onSelect: (id: string) => void;
  onRename: (id: string, newName: string) => void;
  onDelete: (id: string, force: boolean) => void;
  onPromote: (id: string) => void;
  onSuggestFromCurrent: () => void;
  suggestPending: boolean;
  suggestError: string | null;
  /** Gated when there is no resolved current-architecture id to seed from. */
  suggestDisabled: boolean;
}

const DraftsPanel: React.FC<DraftsPanelProps> = ({
  drafts,
  selectedDraftId,
  selectedDraftElementCount,
  onSelect,
  onRename,
  onDelete,
  onPromote,
  onSuggestFromCurrent,
  suggestPending,
  suggestError,
  suggestDisabled,
  highlightSuggest,
}) => {
  // Spec 2026-06-26-target-conversation-save-resume-plan-sourcing (FR6): an
  // in-place filter that narrows the EXISTING drafts list to saved
  // conversations (`conversationSavedAt != null`). Indicator (badge) + filter
  // both read the same marker; this is NOT a parallel section.
  const [savedOnly, setSavedOnly] = useState(false);
  const savedCount = drafts.filter((d) => d.conversationSavedAt != null).length;
  const visibleDrafts = savedOnly
    ? drafts.filter((d) => d.conversationSavedAt != null)
    : drafts;
  return (
    <div className={styles.draftsPanel} data-testid="target-arch-drafts-panel">
      <div className={styles.draftsHeader}>
        <h3>Drafts</h3>
        <button
          type="button"
          className={styles.secondaryButton}
          onClick={onSuggestFromCurrent}
          disabled={suggestPending || suggestDisabled}
          title={
            suggestDisabled
              ? 'Open a current architecture first'
              : 'Generate a target draft by cloning the current architecture'
          }
          data-testid="target-arch-suggest-from-current-button"
          data-suggest-highlight={highlightSuggest ? 'true' : 'false'}
        >
          {suggestPending ? 'Suggesting...' : 'Suggest'}
        </button>
      </div>
      <label
        className={styles.savedFilterToggle}
        data-testid="target-arch-saved-filter-toggle"
        title="Show only target drafts with a saved conversation"
      >
        <input
          type="checkbox"
          checked={savedOnly}
          onChange={(e) => setSavedOnly(e.target.checked)}
          data-testid="target-arch-saved-filter-checkbox"
        />
        {' '}Saved conversations only ({savedCount})
      </label>
      {suggestError && (
        <div
          className={styles.errorBanner}
          role="alert"
          data-testid="target-arch-suggest-error"
        >
          {suggestError}{' '}
          <button
            type="button"
            className={styles.linkButton}
            onClick={onSuggestFromCurrent}
            data-testid="target-arch-suggest-retry"
          >
            Retry
          </button>
        </div>
      )}
      <ul className={styles.draftsList}>
        {visibleDrafts.map(draft => {
          const isActive = draft.draftState === 'active';
          const isSelected = draft.id === selectedDraftId;
          // Four-Spec Hardening Pass (2026-05-25), Item 3: badge EVERY draft
          // whose element count is zero, not just the selected one. The AMS
          // list response now carries `elementCount` per draft so we no
          // longer need to fan out per-draft inventory calls.
          //
          // Null-safe: `elementCount === null` means the wire did not carry
          // the field (e.g. older AMS build), so we fall back to the
          // selected-draft inventory count when the draft happens to be
          // selected. Unknown-count, non-selected drafts are NOT badged --
          // surfacing "unknown" as a non-badge is the deliberate degrade.
          const wireElementCount: number | null = draft.elementCount ?? null;
          const resolvedElementCount: number | null =
            wireElementCount !== null
              ? wireElementCount
              : isSelected
                ? selectedDraftElementCount
                : null;
          const isEmpty = resolvedElementCount === 0;
          const isSavedConversation = draft.conversationSavedAt != null;
          return (
            <li
              key={draft.id}
              className={
                isSelected
                  ? `${styles.draftRow} ${styles.draftRowActive}`
                  : styles.draftRow
              }
              data-testid={`target-arch-draft-row-${draft.id}`}
              data-active={isActive ? 'true' : 'false'}
              data-selected={isSelected ? 'true' : 'false'}
              data-empty={isEmpty ? 'true' : 'false'}
              data-saved-conversation={isSavedConversation ? 'true' : 'false'}
              onClick={() => onSelect(draft.id)}
            >
              <input
                type="text"
                className={styles.draftName}
                defaultValue={draft.name}
                aria-label={`Rename ${draft.name}`}
                data-testid={`target-arch-draft-name-input-${draft.id}`}
                onClick={e => e.stopPropagation()}
                onBlur={e => {
                  const next = e.target.value;
                  if (next !== draft.name) {
                    onRename(draft.id, next);
                  }
                }}
              />
              <div className={styles.draftRowMeta}>
                {isSavedConversation && (
                  <span
                    className={styles.savedBadge}
                    data-testid={`target-arch-saved-badge-${draft.id}`}
                    title={`Conversation saved ${draft.conversationSavedAt}`}
                  >
                    Saved
                  </span>
                )}
                {isEmpty && (
                  <span
                    className={styles.emptyBadge}
                    data-testid={`target-arch-empty-badge-${draft.id}`}
                    title="This draft has zero elements"
                  >
                    empty
                  </span>
                )}
                {isActive && (
                  <span
                    className={styles.activeBadge}
                    data-testid={`target-arch-active-badge-${draft.id}`}
                  >
                    Active
                  </span>
                )}
                {!isActive && (
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    title="Promote this draft to the active target"
                    data-testid={`target-arch-promote-button-${draft.id}`}
                    onClick={e => {
                      e.stopPropagation();
                      onPromote(draft.id);
                    }}
                  >
                    Promote
                  </button>
                )}
                <button
                  type="button"
                  className={styles.deleteButton}
                  title={
                    isActive
                      ? 'Delete the active target (it will no longer be active)'
                      : 'Delete this draft'
                  }
                  data-testid={`target-arch-delete-button-${draft.id}`}
                  onClick={e => {
                    e.stopPropagation();
                    onDelete(draft.id, isActive);
                  }}
                >
                  Delete
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

// ===========================================================================
// TableEditorPanel (read-only)
//
// Spec 2026-05-24 removed the inline "Add ..." buttons and the inline-add
// expansion -- the deterministic Suggest path is the canonical way to
// populate a draft. The table now renders rows only.
// ===========================================================================

interface TableEditorPanelProps {
  selectedDraft: TargetArchitectureDto | null;
  grouped: GroupedRows;
}

const TableEditorPanel: React.FC<TableEditorPanelProps> = ({
  selectedDraft,
  grouped,
}) => {
  if (!selectedDraft) {
    return (
      <div className={styles.editorPanel} data-testid="target-arch-editor-panel">
        <h3>Elements</h3>
        <div className={styles.editorEmpty}>
          Select or create a draft to view its elements.
        </div>
      </div>
    );
  }

  const groups: {
    key: ElementGroupKey;
    label: string;
    rows: GroupedElementRow[];
  }[] = (Object.keys(ELEMENT_GROUP_LABEL) as ElementGroupKey[]).map(key => ({
    key,
    label: ELEMENT_GROUP_LABEL[key],
    rows: grouped[key],
  }));

  return (
    <div className={styles.editorPanel} data-testid="target-arch-editor-panel">
      <h3>
        Elements -- {selectedDraft.name}
        {selectedDraft.draftState === 'active' ? ' (active)' : ''}
      </h3>
      {groups.map(group => (
        <div
          key={group.key}
          data-testid={`target-arch-editor-group-${group.key}`}
        >
          <div className={styles.groupHeaderRow}>
            <h4 className={styles.groupHeader}>{group.label}</h4>
          </div>
          {group.rows.length === 0 ? (
            <div className={styles.emptyMessage}>No rows.</div>
          ) : (
            <table className={styles.rowsTable}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                </tr>
              </thead>
              <tbody>
                {group.rows.map(row => (
                  <tr
                    key={row.id}
                    data-testid={`target-arch-editor-row-${row.id}`}
                  >
                    <td>{row.name}</td>
                    <td>{row.entityType}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}
    </div>
  );
};

// ===========================================================================
// UnmappedElementsPanel -- right-side warning panel.
// ===========================================================================

interface UnmappedElementsPanelProps {
  activeTargetName: string | null;
  rows: UnmappedCurrentElement[];
  onMarkDecommissioned: (row: UnmappedCurrentElement) => Promise<void>;
}

const UnmappedElementsPanel: React.FC<UnmappedElementsPanelProps> = ({
  activeTargetName,
  rows,
  onMarkDecommissioned,
}) => {
  return (
    <div
      className={styles.unmappedPanel}
      data-testid="target-arch-unmapped-panel"
    >
      <h3>Unmapped current elements</h3>
      {!activeTargetName ? (
        <div className={styles.emptyMessage}>
          Promote a draft to active to see unmapped current elements.
        </div>
      ) : rows.length === 0 ? (
        <div className={styles.emptyMessage}>
          Every current element is mapped into "{activeTargetName}".
        </div>
      ) : (
        <ul className={styles.unmappedList}>
          {rows.map(row => (
            <li
              key={`${row.elementType}:${row.elementId}`}
              className={styles.unmappedRow}
              data-testid={`target-arch-unmapped-row-${row.elementId}`}
            >
              <div className={styles.unmappedRowMeta}>
                <span className={styles.unmappedRowName}>{row.name}</span>
                <span className={styles.unmappedRowType}>{row.elementType}</span>
              </div>
              <div className={styles.unmappedRowActions}>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  data-testid={`target-arch-unmapped-mark-decom-${row.elementId}`}
                  onClick={() => void onMarkDecommissioned(row)}
                >
                  Mark decommissioned
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

// ===========================================================================
// PromoteConfirmModal -- single confirm modal.
// ===========================================================================

interface PromoteConfirmModalProps {
  projectId: string;
  candidate: TargetArchitectureDto;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * On open, calls promote with dryRun=true to fetch the impact-preview count
 * BEFORE the user confirms. The same endpoint (without dryRun) is called by
 * the parent's onConfirm to commit. Cancel closes the modal without firing
 * the commit path -- the dry-run call is read-only.
 */
const PromoteConfirmModal: React.FC<PromoteConfirmModalProps> = ({
  projectId,
  candidate,
  onCancel,
  onConfirm,
}) => {
  const [preview, setPreview] = useState<PromoteTargetArchitectureResponse | null>(
    null,
  );
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setPreviewLoading(true);
    setPreviewError(null);
    void (async () => {
      try {
        const data = await promoteTargetArchitecture(projectId, candidate.id, {
          dryRun: true,
        });
        if (!cancelled) {
          setPreview(data);
          setPreviewLoading(false);
        }
      } catch (err) {
        if (cancelled) return;
        const message =
          err instanceof TargetArchitecturesApiError
            ? err.body.message ?? err.message
            : err instanceof Error
              ? err.message
              : 'Failed to compute promote preview';
        setPreviewError(message);
        setPreviewLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, candidate.id]);

  return (
    <div className={styles.modalBackdrop} role="dialog" aria-modal="true">
      <div className={styles.modal} data-testid="target-arch-promote-modal">
        <h3>Promote draft to active</h3>
        <p>
          You are about to promote <strong>{candidate.name}</strong> to the
          active target.
        </p>
        {previewLoading && (
          <p
            className={styles.modeHint}
            data-testid="target-arch-promote-modal-loading"
          >
            Computing impact preview...
          </p>
        )}
        {previewError && (
          <p className={styles.errorBanner} role="alert">
            {previewError}
          </p>
        )}
        {!previewLoading && !previewError && preview && (
          <p data-testid="target-arch-promote-modal-impact">
            Promoting this draft will mark{' '}
            <strong>{preview.specsMarkedStale}</strong> spec
            {preview.specsMarkedStale === 1 ? '' : 's'} stale. Continue?
          </p>
        )}
        <div className={styles.modalActions}>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={onCancel}
            data-testid="target-arch-promote-modal-cancel"
          >
            Cancel
          </button>
          <button
            type="button"
            className={styles.primaryButton}
            disabled={previewLoading || !!previewError}
            onClick={onConfirm}
            data-testid="target-arch-promote-modal-confirm"
          >
            Promote
          </button>
        </div>
      </div>
    </div>
  );
};

// ===========================================================================
// SeedTargetArchitectureDialog
// ===========================================================================

interface SeedTargetArchitectureDialogProps {
  onCancel: () => void;
  onSubmit: (mode: SeedTargetArchitectureMode) => void;
}

export const SeedTargetArchitectureDialog: React.FC<
  SeedTargetArchitectureDialogProps
> = ({ onCancel, onSubmit }) => {
  const [mode, setMode] = useState<SeedTargetArchitectureMode>('clone-current');

  return (
    <div className={styles.modalBackdrop} role="dialog" aria-modal="true">
      <div
        className={styles.modal}
        data-testid="target-arch-seed-dialog"
      >
        <h3>New target architecture draft</h3>

        <label className={styles.modeOption}>
          <input
            type="radio"
            name="seed-mode"
            value="clone-current"
            checked={mode === 'clone-current'}
            onChange={() => setMode('clone-current')}
            data-testid="seed-mode-clone-current"
          />
          <span>
            <span className={styles.modeLabel}>Clone from current</span>
            <span className={styles.modeHint}>
              Deep-clone every element from the project&apos;s current
              architecture and auto-create equivalence mappings.
            </span>
          </span>
        </label>

        <label className={styles.modeOption}>
          <input
            type="radio"
            name="seed-mode"
            value="blank"
            checked={mode === 'blank'}
            onChange={() => setMode('blank')}
            data-testid="seed-mode-blank"
          />
          <span>
            <span className={styles.modeLabel}>Start blank</span>
            <span className={styles.modeHint}>
              Create an empty draft with no elements or mappings.
            </span>
          </span>
        </label>

        <label
          className={`${styles.modeOption} ${styles.modeOptionDisabled}`}
          title="Template registry not available in v1"
        >
          <input
            type="radio"
            name="seed-mode"
            value="from-template"
            disabled
            data-testid="seed-mode-from-template"
          />
          <span>
            <span className={styles.modeLabel}>From template</span>
            <span className={styles.modeHint}>
              Not available in v1 -- the template registry is deferred to a
              future release.
            </span>
          </span>
        </label>

        <div className={styles.modalActions}>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={onCancel}
            data-testid="seed-dialog-cancel"
          >
            Cancel
          </button>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={() => onSubmit(mode)}
            data-testid="seed-dialog-submit"
          >
            Create draft
          </button>
        </div>
      </div>
    </div>
  );
};

export default TargetArchitectureWorkspace;
