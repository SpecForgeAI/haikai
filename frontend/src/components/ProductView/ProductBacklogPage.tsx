/**
 * ProductBacklogPage Component
 *
 * Spec 2026-01-03: Product Backlog Tree View (Stage 4)
 * Task Group 3: Main page component for the Product Backlog.
 *
 * Extended in Spec 2026-01-03: Product Backlog CRUD (Stage 4 - Increment 3)
 * Task Group 4: Modal state management and orchestration.
 *
 * Extended in Spec 2026-01-03: Product Implement View (Stage 5 - Increment 4)
 * Task Group 1: Added onWorkOnThis prop for navigation to Implement view.
 *
 * Extended in Spec 2026-01-04: Product Backlog Stage 4 - Roadmap Epic Anchoring
 * Task Groups 1-5: Archived filter state, filtering, toggle UI, empty state guidance,
 * and feature creation gating.
 *
 * Extended in Spec 2026-01-07: Preserve Product Tab UI State
 * Task Group 3: Replaced local expandedIds state with context-backed state
 * to preserve expansion state across tab switches.
 *
 * Extended in Spec 2026-01-08: Backlog Auto-Expand Epics on Initial Load
 * Task Group 1: Auto-expand both INITIATIVE and EPIC nodes on first load
 * so Features are visible under Epics without user interaction.
 *
 * Extended in Spec 2026-01-10: Product & Delivery - Resizable LHS Panels
 * Task Group 4: Integrated ResizableSplitPane for resizable tree/details layout.
 *
 * Features:
 * - Loads work items from API using loadedFileName as projectId
 * - Two-column layout: Tree (left) + Details (right) with resizable divider
 * - Loading, error, and empty states
 * - Retry functionality for error recovery
 * - Create, edit, and delete modals for FEATURE and STORY items
 * - "Work on this now" navigation for FEATURE and STORY items
 * - Archived roadmap items filter with localStorage persistence
 * - Empty state guidance when no active epics exist
 * - Expansion state persists across tab switches via ProductUiStateContext
 * - Auto-expands INITIATIVE and EPIC nodes on first load
 * - Resizable left panel with width persisted to localStorage
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useArchitecture } from '../../contexts/ArchitectureContext';
import { useProject } from '../../contexts/ProjectContext';
import { useProductExpansion, deriveProjectKey } from '../../contexts/ProductUiStateContext';
import { fetchWorkItems, deleteWorkItem, updateWorkItem } from '../../api/workItemsApi';
import { buildWorkItemTree, deriveParentChain } from '../../utils/workItemTreeBuilder';
import type { WorkItem, WorkItemTreeNode } from '../../types/workItems';
import { WorkItemTree } from './WorkItemTree';
import { WorkItemDetailsPanel } from './WorkItemDetailsPanel';
import { WorkItemCreateModal } from './WorkItemCreateModal';
import { WorkItemEditModal } from './WorkItemEditModal';
import { WorkItemDeleteConfirmModal } from './WorkItemDeleteConfirmModal';
import { SyncDialog } from '../Sync/SyncDialog';
import { LinkToJiraDialog } from '../Sync/LinkToJiraDialog';
import { ResizableSplitPane } from '../shared/ResizableSplitPane';
import { UnifiedChatPanel } from '../UnifiedChat';
import type { ThreadKey } from '../../api/chatV2Api';
import styles from './ProductBacklogPage.module.css';

/**
 * Props for ProductBacklogPage component
 */
export interface ProductBacklogPageProps {
  /** Callback when "Work on this now" is clicked for a work item */
  onWorkOnThis?: (workItemId: string) => void;
  /** Callback when "Refine" is clicked on a FEATURE */
  onRefine?: (workItemId: string) => void;
  /** Callback when "Refine and Implement" is clicked on a FEATURE */
  onRefineAndImplement?: (workItemId: string) => void;
  /** Callback when "Define Integration/E2E" is clicked on a FEATURE */
  onDefineIntegrationTests?: (workItemId: string) => void;
  /** Optional callback for navigation to roadmap page */
  onNavigateToRoadmap?: () => void;
  /**
   * Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 6
   * URL-derived initial selection. When supplied (and non-null), the page
   * pre-selects this work item id so the details panel mounts open. Changes
   * to this prop after mount are synced into local selection state via an
   * effect (so back/forward across `/.../product/backlog/:workItemId` URLs
   * update the panel without remounting).
   */
  initialSelectedId?: string | null;
  /**
   * Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 6
   * Optional callback fired when the page's local selection state changes,
   * including programmatic clears (delete, filter-out). The route-aware
   * wrapper (`<BacklogTab/>`) uses this to drive `useNavigate` so the URL
   * and the selection stay in lockstep.
   */
  onSelectionChange?: (workItemId: string | null) => void;
}

/**
 * Helper function to count all descendants recursively
 */
function countDescendants(
  itemId: string,
  childrenByParent: Map<string | null, WorkItem[]>
): number {
  const directChildren = childrenByParent.get(itemId) || [];
  let count = directChildren.length;

  for (const child of directChildren) {
    count += countDescendants(child.id, childrenByParent);
  }

  return count;
}

/**
 * Helper function to collect all descendant IDs recursively
 */
function collectDescendantIds(
  itemId: string,
  childrenByParent: Map<string | null, WorkItem[]>
): string[] {
  const directChildren = childrenByParent.get(itemId) || [];
  const ids: string[] = [];

  for (const child of directChildren) {
    ids.push(child.id);
    ids.push(...collectDescendantIds(child.id, childrenByParent));
  }

  return ids;
}

/**
 * Compute the rollup status for a parent based on its children's statuses.
 * Rules:
 * - Exclude CANCELLED children from calculation
 * - If no non-cancelled children exist → CANCELLED
 * - If all non-cancelled are PLANNED → PLANNED
 * - If all non-cancelled are COMPLETED → COMPLETED
 * - Otherwise (any mix) → IN_PROGRESS
 *
 * Returns null if the item has no children (status stays manually managed).
 */
function computeRollupStatus(
  parentId: string,
  allItems: WorkItem[],
): string | null {
  const children = allItems.filter((item) => item.parentId === parentId);
  if (children.length === 0) return null;

  const active = children.filter((c) => c.status !== 'CANCELLED');

  if (active.length === 0) return 'CANCELLED';
  if (active.every((c) => c.status === 'PLANNED')) return 'PLANNED';
  if (active.every((c) => c.status === 'COMPLETED')) return 'COMPLETED';
  return 'IN_PROGRESS';
}

/**
 * Walk up the parent chain, recalculating rollup status for each ancestor.
 * Issues updateWorkItem calls for any parent whose derived status differs
 * from its current status.
 *
 * @param startItemId - The item whose change triggered the rollup
 * @param allItems - Current work items (post-mutation, fetched fresh from server)
 * @param projectId - Project UUID for API calls
 * @param startFromParentId - Optional: start rollup from this parent ID directly
 *   (used after delete, when startItemId no longer exists in allItems)
 */
async function rollupStatusToAncestors(
  startItemId: string,
  allItems: WorkItem[],
  projectId: string,
  startFromParentId?: string | null,
): Promise<void> {
  const byId = new Map(allItems.map((item) => [item.id, item]));

  // Determine where to start walking
  let currentParentId: string | null;
  if (startFromParentId !== undefined) {
    currentParentId = startFromParentId;
  } else {
    const startItem = byId.get(startItemId);
    if (!startItem) return;
    currentParentId = startItem.parentId;
  }

  while (currentParentId) {
    const parent = byId.get(currentParentId);
    if (!parent) break;

    const derivedStatus = computeRollupStatus(parent.id, allItems);
    if (derivedStatus && derivedStatus !== parent.status) {
      await updateWorkItem(projectId, parent.id, {
        type: parent.type,
        parentId: parent.parentId ?? undefined,
        title: parent.title,
        status: derivedStatus,
      });
      // Update local copy so the next ancestor's computation sees the new status
      parent.status = derivedStatus;
    }

    currentParentId = parent.parentId;
  }
}

/**
 * Get localStorage key for archived filter preference
 * Task Group 1: Key pattern for localStorage persistence
 */
function getArchivedFilterStorageKey(projectId: string): string {
  return `product_backlog_show_archived::${projectId}`;
}

/**
 * Filter work items for tree display
 * Task Group 2: Excludes archived INITIATIVE and EPIC items when toggle is off
 *
 * @param items - Array of work items
 * @param showArchivedRoadmapItems - Whether to show archived roadmap items
 * @returns Filtered array of work items
 */
function filterWorkItemsForTree(
  items: WorkItem[],
  showArchivedRoadmapItems: boolean
): WorkItem[] {
  if (showArchivedRoadmapItems) {
    return items;
  }
  return items.filter((item) => {
    const isRoadmapItem = item.type === 'INITIATIVE' || item.type === 'EPIC';
    const isArchived = item.status === 'ARCHIVED';
    return !(isRoadmapItem && isArchived);
  });
}

/**
 * ProductBacklogPage Component
 *
 * Orchestrates data loading and state management for the Product Backlog view.
 * Uses loadedFileName from ArchitectureContext as the project identifier.
 * Uses ProductUiStateContext to persist expansion state across tab switches.
 */
export function ProductBacklogPage({ onWorkOnThis, onRefine, onRefineAndImplement, onDefineIntegrationTests, onNavigateToRoadmap, initialSelectedId, onSelectionChange }: ProductBacklogPageProps) {
  // Get loadedFileName from context (used for UI/localStorage)
  const { loadedFileName } = useArchitecture();
  // Get active project for UUID-based API calls
  const activeProject = useProject();
  const projectUuid = activeProject?.id ?? null;

  // Construct PanelThreadKey for UnifiedChatPanel overlay
  const panelThreadKey: ThreadKey | null = activeProject
    ? { type: 'panel', projectId: activeProject.id, screen: 'backlog' }
    : null;

  // Derive project key for context-backed expansion state
  // Spec 2026-01-07 Task Group 3.2: Get projectKey from loadedFileName
  const projectKey = deriveProjectKey(loadedFileName);

  // Spec 2026-01-07 Task Group 3.2: Replace local expandedIds state with context-backed state
  // Use context hook to get expansion state that persists across tab switches
  const {
    expandedIds,
    setExpandedIds,
    toggleExpanded: contextToggleExpanded,
  } = useProductExpansion(projectKey, 'backlog');

  // Track pending epic expansion request (from URL param or onArtifactSaved)
  const pendingExpandEpicIdRef = useRef<string | null>(
    new URLSearchParams(window.location.search).get('expandEpicId')
  );

  // Local state
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [workItems, setWorkItems] = useState<WorkItem[]>([]);
  // Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 6
  // Initial value seeded from initialSelectedId so the URL-driven deep-link
  // pre-opens the details panel on the first render (no waiting for an
  // effect tick).
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId ?? null);

  /**
   * Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 6
   * Sync URL-driven `initialSelectedId` -> local `selectedId` whenever the
   * URL changes (e.g. browser back/forward across
   * `/.../product/backlog/<id>` <-> `/.../product/backlog`). Only fires when
   * the values differ to avoid an infinite loop with the
   * `onSelectionChange` emit-effect below.
   */
  useEffect(() => {
    if ((initialSelectedId ?? null) !== selectedId) {
      setSelectedId(initialSelectedId ?? null);
    }
    // Intentionally exclude `selectedId` from the deps so that a user
    // selection click doesn't immediately reset to the URL value (the
    // emit-effect below propagates the user's choice into the URL, then
    // this effect sees the URL match selectedId and no-ops).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSelectedId]);

  /**
   * Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 6
   * Emit local `selectedId` changes up to the route-aware wrapper so the
   * URL can be kept in lockstep. Skipped when the parent already knows
   * (i.e. the value matches `initialSelectedId`) to avoid redundant
   * navigations.
   */
  useEffect(() => {
    if (!onSelectionChange) return;
    if ((initialSelectedId ?? null) === selectedId) return;
    onSelectionChange(selectedId);
  }, [selectedId, initialSelectedId, onSelectionChange]);

  // Spec 2026-01-07 Task Group 3.3: Track if initial expansion has been set for this project
  // This ref tracks whether we've initialized expansion state for the current project
  const initializedForProjectRef = useRef<string | null>(null);

  // Task Group 1: Archived filter state with localStorage persistence
  const [showArchivedRoadmapItems, setShowArchivedRoadmapItems] = useState<boolean>(() => {
    if (!loadedFileName) return false;
    try {
      const stored = localStorage.getItem(getArchivedFilterStorageKey(loadedFileName));
      return stored === 'true';
    } catch {
      return false;
    }
  });

  // Modal state
  const [createModalOpen, setCreateModalOpen] = useState<boolean>(false);
  const [editModalOpen, setEditModalOpen] = useState<boolean>(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState<boolean>(false);
  const [syncModalOpen, setSyncModalOpen] = useState<boolean>(false);
  const [itemToSync, setItemToSync] = useState<WorkItem | null>(null);
  const [linkToJiraModalOpen, setLinkToJiraModalOpen] = useState<boolean>(false);
  const [itemToLink, setItemToLink] = useState<WorkItem | null>(null);
  const [selectedParentForCreate, setSelectedParentForCreate] = useState<WorkItem | null>(null);
  const [typeToCreate, setTypeToCreate] = useState<'FEATURE' | 'STORY' | null>(null);
  const [itemToEdit, setItemToEdit] = useState<WorkItem | null>(null);
  const [itemToDelete, setItemToDelete] = useState<WorkItem | null>(null);
  const [descendantCountForDelete, setDescendantCountForDelete] = useState<number>(0);

  // Task Group 1: Read archived filter from localStorage when projectId changes
  useEffect(() => {
    if (!loadedFileName) {
      setShowArchivedRoadmapItems(false);
      return;
    }
    try {
      const stored = localStorage.getItem(getArchivedFilterStorageKey(loadedFileName));
      setShowArchivedRoadmapItems(stored === 'true');
    } catch {
      setShowArchivedRoadmapItems(false);
    }
  }, [loadedFileName]);

  // Task Group 1: Persist archived filter preference to localStorage
  useEffect(() => {
    if (!loadedFileName) return;
    try {
      localStorage.setItem(
        getArchivedFilterStorageKey(loadedFileName),
        String(showArchivedRoadmapItems)
      );
    } catch {
      // Ignore localStorage errors (e.g., quota exceeded, private browsing)
    }
  }, [loadedFileName, showArchivedRoadmapItems]);

  // Load work items when projectId changes
  // Spec 2026-01-07 Task Group 3.5: Guard against accidental resets
  // This callback no longer resets expandedIds on every load
  const loadWorkItems = useCallback(async () => {
    if (!projectUuid) {
      setWorkItems([]);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const items = await fetchWorkItems(projectUuid);
      setWorkItems(items);
      // Spec 2026-01-07 Task Group 3.5: REMOVED lines 196-202 that reset expandedIds on every load
      // Expansion state initialization is now handled in a separate useEffect
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load work items';
      setError(message);
      setWorkItems([]);
    } finally {
      setLoading(false);
    }
  }, [projectUuid]);

  // Load on mount and when projectUuid changes
  useEffect(() => {
    loadWorkItems();
  }, [loadWorkItems]);

  // Spec 2026-01-07 Task Group 3.3: Implement first-load initialization logic
  // Spec 2026-01-08 Task Group 1: Auto-expand both INITIATIVE and EPIC nodes
  // This effect handles initial expansion state setup when:
  // 1. Context is empty for this project/tab (first load)
  // 2. Work items have been loaded
  // It does NOT reset expansion state if context already has data (subsequent loads)
  useEffect(() => {
    // Only run if we have work items and a valid project key
    if (workItems.length === 0 || !projectKey) {
      return;
    }

    // Check if we've already initialized for this project during this mount
    // OR if context already has expansion state (user has previously interacted)
    if (initializedForProjectRef.current === projectKey) {
      // Already initialized for this project during this component lifecycle
      return;
    }

    // Check if context already has data for this project/tab
    // If expandedIds.size > 0, context already has state - don't reset to defaults
    if (expandedIds.size > 0) {
      // Mark as initialized to prevent re-running
      initializedForProjectRef.current = projectKey;
      return;
    }

    // First load: expand INITIATIVE and EPIC nodes so Features are visible under Epics
    const initialExpanded = new Set<string>();
    for (const item of workItems) {
      if (item.type === 'INITIATIVE' || item.type === 'EPIC') {
        initialExpanded.add(item.id);
      }
    }

    // Only set if there are items to expand
    if (initialExpanded.size > 0) {
      setExpandedIds(initialExpanded);
    }

    // Mark as initialized for this project
    initializedForProjectRef.current = projectKey;
  }, [workItems, projectKey, expandedIds.size, setExpandedIds]);

  // Reset initialization tracking when project changes
  useEffect(() => {
    if (projectKey !== initializedForProjectRef.current) {
      // Project changed, but don't clear the ref yet - let the initialization effect handle it
    }
  }, [projectKey]);

  // Ref to access current expandedIds without adding it as an effect dependency
  const expandedIdsRef = useRef(expandedIds);
  expandedIdsRef.current = expandedIds;

  // Ref to track pending scroll-to-epic after auto-expand renders
  const pendingScrollToIdRef = useRef<string | null>(null);

  // Auto-expand a specific epic and its ancestors (triggered by URL param or onArtifactSaved)
  useEffect(() => {
    const epicId = pendingExpandEpicIdRef.current;
    if (!epicId || workItems.length === 0) return;

    // Find the epic in work items
    const epic = workItems.find(item => item.id === epicId);
    if (!epic) return;

    // Consume the pending request
    pendingExpandEpicIdRef.current = null;

    // Clean expandEpicId from URL without triggering navigation
    const url = new URL(window.location.href);
    if (url.searchParams.has('expandEpicId')) {
      url.searchParams.delete('expandEpicId');
      window.history.replaceState({}, '', url.toString());
    }

    // Build set of IDs to expand: the epic, its ancestors, and its direct children (features)
    const idsToExpand = new Set(expandedIdsRef.current);
    idsToExpand.add(epicId);

    // Expand ancestors (initiative → epic chain)
    let current = epic;
    while (current.parentId) {
      idsToExpand.add(current.parentId);
      const parent = workItems.find(item => item.id === current.parentId);
      if (!parent) break;
      current = parent;
    }

    // Expand child features so stories are visible
    for (const item of workItems) {
      if (item.parentId === epicId) {
        idsToExpand.add(item.id);
      }
    }

    setExpandedIds(idsToExpand);
    setSelectedId(epicId);
    // Queue scroll-to-epic after the expanded tree renders
    pendingScrollToIdRef.current = epicId;
  }, [workItems, setExpandedIds]);

  // Scroll to the epic node after auto-expand renders the tree.
  // Fires when selectedId changes; the ref guard ensures it only scrolls
  // after the auto-expand effect (not on normal user selection clicks).
  useEffect(() => {
    const scrollTarget = pendingScrollToIdRef.current;
    if (!scrollTarget || scrollTarget !== selectedId) return;
    pendingScrollToIdRef.current = null;

    const el = document.querySelector(`[data-testid="tree-node-${scrollTarget}"]`);
    if (el) {
      el.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  }, [selectedId]);

  // Task Group 2: Filter work items before building tree
  const filteredWorkItems = useMemo(() => {
    return filterWorkItemsForTree(workItems, showArchivedRoadmapItems);
  }, [workItems, showArchivedRoadmapItems]);

  // Build tree structure from filtered work items
  const treeResult = useMemo(() => {
    return buildWorkItemTree(filteredWorkItems);
  }, [filteredWorkItems]);

  // Task Group 2: Compute visible epics count for empty state detection
  const visibleEpics = useMemo(() => {
    return workItems.filter(
      (item) => item.type === 'EPIC' && item.status !== 'ARCHIVED'
    );
  }, [workItems]);

  // Task Group 2: Check if selection should be cleared when filter changes
  useEffect(() => {
    if (selectedId && !treeResult.byId.has(selectedId)) {
      setSelectedId(null);
    }
  }, [selectedId, treeResult.byId]);

  // Apply expanded state to tree nodes using structural sharing.
  // Only creates new objects for nodes whose isExpanded actually changed,
  // so React.memo on TreeNode can skip unchanged subtrees.
  const nodesWithExpanded = useMemo((): WorkItemTreeNode[] => {
    function applyExpanded(nodes: WorkItemTreeNode[]): WorkItemTreeNode[] {
      let anyChanged = false;
      const result = nodes.map((node) => {
        const isExpanded = expandedIds.has(node.item.id);
        const children = applyExpanded(node.children);
        if (node.isExpanded === isExpanded && node.children === children) {
          return node; // reuse same object reference
        }
        anyChanged = true;
        return { ...node, isExpanded, children };
      });
      return anyChanged ? result : nodes;
    }
    return applyExpanded(treeResult.roots);
  }, [treeResult.roots, expandedIds]);

  // Get selected item details
  const selectedItem = useMemo(() => {
    if (!selectedId) return null;
    return treeResult.byId.get(selectedId) || null;
  }, [selectedId, treeResult.byId]);

  // Get parent chain for selected item
  const parentChain = useMemo(() => {
    if (!selectedId) return [];
    return deriveParentChain(selectedId, treeResult.byId);
  }, [selectedId, treeResult.byId]);

  // Get children count for selected item
  const childrenCount = useMemo(() => {
    if (!selectedId) return 0;
    const children = treeResult.childrenByParent.get(selectedId);
    return children ? children.length : 0;
  }, [selectedId, treeResult.childrenByParent]);

  // Get siblings for create modal (children of the parent)
  const siblingsForCreate = useMemo(() => {
    if (!selectedParentForCreate) return [];
    return treeResult.childrenByParent.get(selectedParentForCreate.id) || [];
  }, [selectedParentForCreate, treeResult.childrenByParent]);

  // Handle node selection
  const handleSelect = useCallback((id: string) => {
    setSelectedId(id);
  }, []);

  // Spec 2026-01-07 Task Group 3.4: Update handleToggle callback to use context
  // Handle node expand/collapse toggle - now uses context's toggleExpanded
  const handleToggle = useCallback((id: string) => {
    contextToggleExpanded(id);
  }, [contextToggleExpanded]);

  // Handle retry button click
  const handleRetry = useCallback(() => {
    loadWorkItems();
  }, [loadWorkItems]);

  // Task Group 1: Toggle handler for archived filter
  const handleToggleShowArchived = useCallback(() => {
    setShowArchivedRoadmapItems((prev) => !prev);
  }, []);

  // Task Group 4: Handle navigation to roadmap
  const handleGoToRoadmap = useCallback(() => {
    if (onNavigateToRoadmap) {
      onNavigateToRoadmap();
    } else {
      // Fallback: use window.location if no callback provided
      window.location.href = '/product/roadmap';
    }
  }, [onNavigateToRoadmap]);

  // === Modal Open Handlers ===

  const handleAddFeature = useCallback(() => {
    if (selectedItem && selectedItem.type.toUpperCase() === 'EPIC') {
      setSelectedParentForCreate(selectedItem);
      setTypeToCreate('FEATURE');
      setCreateModalOpen(true);
    }
  }, [selectedItem]);

  const handleAddStory = useCallback(() => {
    if (selectedItem && selectedItem.type.toUpperCase() === 'FEATURE') {
      setSelectedParentForCreate(selectedItem);
      setTypeToCreate('STORY');
      setCreateModalOpen(true);
    }
  }, [selectedItem]);

  const handleEdit = useCallback(() => {
    if (selectedItem && (selectedItem.type.toUpperCase() === 'FEATURE' || selectedItem.type.toUpperCase() === 'STORY')) {
      setItemToEdit(selectedItem);
      setEditModalOpen(true);
    }
  }, [selectedItem]);

  const handleDelete = useCallback(() => {
    if (selectedItem && (selectedItem.type.toUpperCase() === 'FEATURE' || selectedItem.type.toUpperCase() === 'STORY')) {
      setItemToDelete(selectedItem);
      const count = countDescendants(selectedItem.id, treeResult.childrenByParent);
      setDescendantCountForDelete(count);
      setDeleteModalOpen(true);
    }
  }, [selectedItem, treeResult.childrenByParent]);

  // Phase D: open the Tool ↔ Jira sync dialog with the selected item as root.
  // Available on every type — INITIATIVE through TEST.
  const handleSync = useCallback(() => {
    if (selectedItem) {
      setItemToSync(selectedItem);
      setSyncModalOpen(true);
    }
  }, [selectedItem]);

  const handleSyncComplete = useCallback(async () => {
    setSyncModalOpen(false);
    setItemToSync(null);
    // Refresh the work item tree so external_key chips and any new/changed
    // items reflect the post-sync state.
    await loadWorkItems();
  }, [loadWorkItems]);

  const handleSyncClose = useCallback(() => {
    setSyncModalOpen(false);
    setItemToSync(null);
  }, []);

  // Phase D follow-up: manually attach a Jira key (external_key) to a tool item
  // so a subsequent Sync run knows it's linked. Use case: pre-create empty
  // Initiative in Jira, set its key here, then Sync with Tool as golden source.
  const handleLinkToJira = useCallback(() => {
    if (selectedItem) {
      setItemToLink(selectedItem);
      setLinkToJiraModalOpen(true);
    }
  }, [selectedItem]);

  const handleLinkToJiraClose = useCallback(() => {
    setLinkToJiraModalOpen(false);
    setItemToLink(null);
  }, []);

  const handleLinkToJiraSuccess = useCallback(async () => {
    // Refresh the work item tree so the external_key chip reflects the new link
    await loadWorkItems();
  }, [loadWorkItems]);

  // Handle artifact saved from the chat panel (e.g., backlog save)
  // Re-fetches work items and triggers auto-expand for the saved epic
  const handleArtifactSaved = useCallback(async (info?: { artifactType?: string; epicId?: string }) => {
    if (info?.artifactType === 'backlog' && info.epicId) {
      pendingExpandEpicIdRef.current = info.epicId;
    }
    await loadWorkItems();
  }, [loadWorkItems]);

  // Handle "Work on this now" button click — also transitions status to IN_PROGRESS
  const handleWorkOnThis = useCallback(async () => {
    if (selectedItem && onWorkOnThis) {
      const itemType = selectedItem.type.toUpperCase();
      if (itemType === 'FEATURE' || itemType === 'STORY') {
        // Update status to IN_PROGRESS if currently PLANNED
        if (projectUuid && selectedItem.status === 'PLANNED') {
          try {
            await updateWorkItem(projectUuid, selectedItem.id, {
              type: selectedItem.type,
              parentId: selectedItem.parentId ?? undefined,
              title: selectedItem.title,
              status: 'IN_PROGRESS',
            });
            // Rollup: starting work on a child → parent may become IN_PROGRESS
            const freshItems = await fetchWorkItems(projectUuid);
            await rollupStatusToAncestors(selectedItem.id, freshItems, projectUuid);
            await loadWorkItems();
          } catch (err) {
            console.warn('Failed to update work item status to IN_PROGRESS:', err);
          }
        }
        onWorkOnThis(selectedItem.id);
      }
    }
  }, [selectedItem, onWorkOnThis, projectUuid, loadWorkItems]);

  // Handle "Refine" button click on a FEATURE
  const handleRefine = useCallback(() => {
    if (selectedItem && onRefine) {
      onRefine(selectedItem.id);
    }
  }, [selectedItem, onRefine]);

  // Handle "Refine and Implement" button click on a FEATURE
  const handleRefineAndImplement = useCallback(() => {
    if (selectedItem && onRefineAndImplement) {
      onRefineAndImplement(selectedItem.id);
    }
  }, [selectedItem, onRefineAndImplement]);

  // Handle "Define Integration/E2E" button click on a FEATURE
  const handleDefineIntegrationTests = useCallback(() => {
    if (selectedItem && onDefineIntegrationTests) {
      onDefineIntegrationTests(selectedItem.id);
    }
  }, [selectedItem, onDefineIntegrationTests]);

  const handleMarkComplete = useCallback(async () => {
    if (!selectedItem || !projectUuid) return;
    try {
      await updateWorkItem(projectUuid, selectedItem.id, {
        type: selectedItem.type,
        parentId: selectedItem.parentId ?? undefined,
        title: selectedItem.title,
        status: 'COMPLETED',
      });
      // Rollup: completing a child may complete the parent (if all siblings done)
      const freshItems = await fetchWorkItems(projectUuid);
      await rollupStatusToAncestors(selectedItem.id, freshItems, projectUuid);
      await loadWorkItems();
    } catch (err) {
      console.warn('Failed to mark work item as complete:', err);
    }
  }, [selectedItem, projectUuid, loadWorkItems]);

  // === Modal Close Handlers ===

  const handleCloseCreateModal = useCallback(() => {
    setCreateModalOpen(false);
    setSelectedParentForCreate(null);
    setTypeToCreate(null);
  }, []);

  const handleCloseEditModal = useCallback(() => {
    setEditModalOpen(false);
    setItemToEdit(null);
  }, []);

  const handleCloseDeleteModal = useCallback(() => {
    setDeleteModalOpen(false);
    setItemToDelete(null);
    setDescendantCountForDelete(0);
  }, []);

  // === Mutation Handlers ===

  // Spec 2026-01-07: handleCreateSuccess now uses context's setExpandedIds
  // Rollup: adding a new PLANNED child may change parent from COMPLETED back to IN_PROGRESS
  const handleCreateSuccess = useCallback(async (newItem: WorkItem) => {
    // Expand parent to show new item - use context-backed state
    if (newItem.parentId) {
      const newExpandedIds = new Set(expandedIds);
      newExpandedIds.add(newItem.parentId);
      setExpandedIds(newExpandedIds);
    }

    // Select the newly created item
    setSelectedId(newItem.id);

    // Close modal
    handleCloseCreateModal();

    // Rollup parent statuses after the new child is persisted
    if (projectUuid && newItem.parentId) {
      try {
        const freshItems = await fetchWorkItems(projectUuid);
        await rollupStatusToAncestors(newItem.id, freshItems, projectUuid);
      } catch (err) {
        console.warn('Failed to rollup status after create:', err);
      }
    }

    // Refresh from server to get accurate statuses
    await loadWorkItems();
  }, [handleCloseCreateModal, expandedIds, setExpandedIds, projectUuid, loadWorkItems]);

  // Rollup: editing status via modal may affect parent
  const handleUpdateSuccess = useCallback(async (updatedItem: WorkItem) => {
    // Keep selection on updated item
    setSelectedId(updatedItem.id);

    // Close modal
    handleCloseEditModal();

    // Rollup parent statuses after the edit
    if (projectUuid) {
      try {
        const freshItems = await fetchWorkItems(projectUuid);
        await rollupStatusToAncestors(updatedItem.id, freshItems, projectUuid);
      } catch (err) {
        console.warn('Failed to rollup status after update:', err);
      }
    }

    // Refresh from server to get accurate statuses
    await loadWorkItems();
  }, [handleCloseEditModal, projectUuid, loadWorkItems]);

  // Rollup: deleting a child may change parent status (e.g., remaining children all COMPLETED)
  const handleDeleteSuccess = useCallback(async () => {
    if (!itemToDelete) return;

    const deletedParentId = itemToDelete.parentId;

    // Clear selection if deleted item was selected
    const idsToRemove = new Set<string>([
      itemToDelete.id,
      ...collectDescendantIds(itemToDelete.id, treeResult.childrenByParent),
    ]);
    if (selectedId && idsToRemove.has(selectedId)) {
      setSelectedId(null);
    }

    // Close modal
    handleCloseDeleteModal();

    // Rollup parent statuses after deletion
    if (projectUuid && deletedParentId) {
      try {
        const freshItems = await fetchWorkItems(projectUuid);
        await rollupStatusToAncestors(itemToDelete.id, freshItems, projectUuid, deletedParentId);
      } catch (err) {
        console.warn('Failed to rollup status after delete:', err);
      }
    }

    // Refresh from server to get accurate statuses
    await loadWorkItems();
  }, [itemToDelete, treeResult.childrenByParent, selectedId, handleCloseDeleteModal, projectUuid, loadWorkItems]);

  // No project loaded state
  if (!loadedFileName) {
    return (
      <>
        <div className={styles.container} data-testid="product-backlog-page">
          <div className={styles.noProjectContainer} data-testid="no-project-state">
            <div className={styles.noProjectMessage}>No project loaded</div>
            <div className={styles.noProjectHint}>
              Load a project file to view its product backlog.
            </div>
          </div>
        </div>
        {panelThreadKey && (
          <UnifiedChatPanel
            threadKey={panelThreadKey}
            initialPersonaId="product-manager"
            allowedPersonaIds={['product-manager']}
            onArtifactSaved={handleArtifactSaved}
          />
        )}
      </>
    );
  }

  // Loading state
  if (loading) {
    return (
      <>
        <div className={styles.container} data-testid="product-backlog-page">
          <div className={styles.loadingContainer} data-testid="loading-state">
            <div className={styles.spinner} />
          </div>
        </div>
        {panelThreadKey && (
          <UnifiedChatPanel
            threadKey={panelThreadKey}
            initialPersonaId="product-manager"
            allowedPersonaIds={['product-manager']}
            onArtifactSaved={handleArtifactSaved}
          />
        )}
      </>
    );
  }

  // Error state
  if (error) {
    return (
      <>
        <div className={styles.container} data-testid="product-backlog-page">
          <div className={styles.errorContainer} data-testid="error-state">
            <div className={styles.errorMessage}>{error}</div>
            <button
              className={styles.retryButton}
              onClick={handleRetry}
              data-testid="retry-button"
            >
              Retry
            </button>
          </div>
        </div>
        {panelThreadKey && (
          <UnifiedChatPanel
            threadKey={panelThreadKey}
            initialPersonaId="product-manager"
            allowedPersonaIds={['product-manager']}
            onArtifactSaved={handleArtifactSaved}
          />
        )}
      </>
    );
  }

  // Empty state (no work items at all)
  if (workItems.length === 0) {
    return (
      <>
        <div className={styles.container} data-testid="product-backlog-page">
          <div className={styles.emptyContainer} data-testid="empty-state">
            <div className={styles.emptyMessage}>No work items yet.</div>
          </div>
        </div>
        {panelThreadKey && (
          <UnifiedChatPanel
            threadKey={panelThreadKey}
            initialPersonaId="product-manager"
            allowedPersonaIds={['product-manager']}
            onArtifactSaved={handleArtifactSaved}
          />
        )}
      </>
    );
  }

  // Task Group 4: Check if we should show empty epic guidance
  const showEmptyEpicGuidance = visibleEpics.length === 0 && !showArchivedRoadmapItems;

  // Spec 2026-01-10: Left pane content - Tree with header
  const leftPaneContent = (
    <div className={styles.treePanelContent}>
      {/* Task Group 3: Header section with hint and filter toggle */}
      <div className={styles.backlogHeader} data-testid="backlog-header">
        <div className={styles.headerHint} data-testid="backlog-header-hint">
          Features belong under Roadmap Epics.
        </div>
        <label className={styles.filterToggle} data-testid="archived-filter-label">
          <input
            type="checkbox"
            checked={showArchivedRoadmapItems}
            onChange={handleToggleShowArchived}
            className={styles.filterCheckbox}
            data-testid="archived-filter-checkbox"
          />
          <span className={styles.filterLabelText}>Show archived roadmap items</span>
        </label>
      </div>

      {/* Task Group 4: Empty state guidance when no active epics */}
      {showEmptyEpicGuidance ? (
        <div className={styles.emptyEpicGuidance} data-testid="empty-epic-guidance">
          <div className={styles.guidancePrimary}>No active roadmap epics found.</div>
          <div className={styles.guidanceSecondary}>
            Import a roadmap to create epics before adding features.
          </div>
          <button
            className={styles.goToRoadmapButton}
            onClick={handleGoToRoadmap}
            data-testid="go-to-roadmap-button"
          >
            Go to Roadmap
          </button>
        </div>
      ) : (
        <WorkItemTree
          nodes={nodesWithExpanded}
          selectedId={selectedId}
          onSelect={handleSelect}
          onToggle={handleToggle}
        />
      )}
    </div>
  );

  // Spec 2026-01-10: Right pane content - Details panel
  const rightPaneContent = (
    <div className={styles.detailsPanelContent}>
      <WorkItemDetailsPanel
        item={selectedItem}
        parentChain={parentChain}
        childrenCount={childrenCount}
        onAddFeature={handleAddFeature}
        onAddStory={handleAddStory}
        onEdit={handleEdit}
        onDelete={handleDelete}
        onWorkOnThis={onWorkOnThis ? handleWorkOnThis : undefined}
        onRefine={onRefine ? handleRefine : undefined}
        onRefineAndImplement={onRefineAndImplement ? handleRefineAndImplement : undefined}
        onDefineIntegrationTests={onDefineIntegrationTests ? handleDefineIntegrationTests : undefined}
        onMarkComplete={handleMarkComplete}
        onSync={handleSync}
        onLinkToJira={handleLinkToJira}
      />
    </div>
  );

  // Normal state - two-column layout with resizable split pane
  // Spec 2026-01-10: Use ResizableSplitPane for resizable tree/details layout
  return (
    <>
      <div className={styles.container} data-testid="product-backlog-page">
        <ResizableSplitPane
          left={leftPaneContent}
          right={rightPaneContent}
          storageKey="pd.backlog.leftWidth"
          defaultLeftWidthPx={350}
          minLeftWidthPx={200}
          maxLeftWidthPx={600}
        />

        {/* Create Modal */}
        {createModalOpen && selectedParentForCreate && typeToCreate && (
          <WorkItemCreateModal
            isOpen={createModalOpen}
            onClose={handleCloseCreateModal}
            parent={selectedParentForCreate}
            typeToCreate={typeToCreate}
            onSuccess={handleCreateSuccess}
            projectId={projectUuid!}
            siblings={siblingsForCreate}
          />
        )}

        {/* Edit Modal */}
        {editModalOpen && itemToEdit && (
          <WorkItemEditModal
            isOpen={editModalOpen}
            onClose={handleCloseEditModal}
            item={itemToEdit}
            onSuccess={handleUpdateSuccess}
            projectId={projectUuid!}
          />
        )}

        {/* Delete Confirm Modal */}
        {deleteModalOpen && itemToDelete && (
          <WorkItemDeleteConfirmModal
            isOpen={deleteModalOpen}
            onClose={handleCloseDeleteModal}
            item={itemToDelete}
            descendantCount={descendantCountForDelete}
            onConfirm={handleDeleteSuccess}
            projectId={projectUuid!}
          />
        )}

        {/* Phase D: Tool ↔ Jira Sync Dialog */}
        {syncModalOpen && itemToSync && projectUuid && (
          <SyncDialog
            isOpen={syncModalOpen}
            onClose={handleSyncClose}
            projectId={projectUuid}
            rootWorkItem={itemToSync}
            onSyncComplete={handleSyncComplete}
          />
        )}

        {/* Phase D: Link-to-Jira Dialog (manually attach external_key) */}
        {linkToJiraModalOpen && itemToLink && projectUuid && (
          <LinkToJiraDialog
            isOpen={linkToJiraModalOpen}
            onClose={handleLinkToJiraClose}
            item={itemToLink}
            projectId={projectUuid}
            onSuccess={handleLinkToJiraSuccess}
          />
        )}
      </div>
      {panelThreadKey && (
        <UnifiedChatPanel
          threadKey={panelThreadKey}
          initialPersonaId="product-manager"
          allowedPersonaIds={['product-manager']}
          onArtifactSaved={handleArtifactSaved}
        />
      )}
    </>
  );
}
