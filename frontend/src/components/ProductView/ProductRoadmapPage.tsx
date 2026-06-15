/**
 * ProductRoadmapPage Component
 *
 * Spec 2026-01-04: Product Roadmap Review Page
 * Spec 2026-01-04: Product Roadmap Stage 3 - ARCHIVED Status and Expandable Descriptions
 * Spec 2026-01-04: Roadmap Import UX Glue - Persisted Status + Detailed Counts + Error UX
 * Spec 2026-01-05: Project Model with Active Project - Gated import when no active project
 * Spec 2026-01-05: Simplify Product Layout and Compact Roadmap Controls
 *   - Task Group 2: Exposed control row state via onControlStateChange callback
 *   - Task Group 3: Removed action row, lastImportedPanel, handleRefresh, inline styles
 *
 * Spec 2026-01-07: Preserve Product Tab UI State
 *   - Task Group 4: Context integration for roadmap expansion state persistence
 *   - Replaced local expandedIds state with context-backed state
 *   - Initial load expands non-ARCHIVED initiatives only when context empty
 *   - Expansion state persists across tab switches
 *
 * Spec 2026-01-10: Upload Book of Work from Markdown
 *   - Task Group 5: Added projectId and refreshWorkItems to RoadmapControlState
 *   - Enables ProductView to access project ID and refresh function for book of work upload
 *
 * Spec 2026-01-10: Fix Roadmap Tab Buttons Incorrectly Disabled When a Project is Open
 *   - Task Group 2: Added useProjectLoading hook to handle initial loading state
 *   - Updated isImportDisabled to include loading state
 *   - Updated banner visibility to exclude loading state (prevent misleading banner)
 *
 * Spec 2026-01-10: Product & Delivery - Resizable LHS Panels
 *   - Task Group 5: Integrated ResizableSplitPane for resizable tree/details layout
 *   - Tree on left, summary/CTA cards and details on right
 *   - Width persisted to localStorage with key "pd.roadmap.leftWidth"
 *
 * Spec 2026-02-15: RM Increment 1 -- Roadmap PM Mode + LHS Chat Panel
 *   - Task Group 5.9: Wrapped existing content in outer ResizableSplitPane
 *   - LHS: RoadmapPmChatPanel component
 *   - RHS: existing roadmap content (tree + details via inner split pane)
 *   - Outer split pane width persisted to localStorage with key "pd.roadmap.chatWidth"
 *
 * Spec 2026-03-01: Increment 9 -- Side Panel v2: Product and Roadmap Screens
 *   - Task Group 3.6: Removed outer ResizableSplitPane and RoadmapPmChatPanel
 *   - Task Group 3.7: Added UnifiedChatPanel as fixed-position RHS overlay
 *   - Inner ResizableSplitPane (tree | details) now takes full width
 *   - PanelThreadKey: { type: 'panel', projectId, screen: 'roadmap' }
 *   - allowedPersonaIds: ['product-manager'], initialPersonaId: 'product-manager'
 *   - No onArtifactSaved or artifactExists (advisory tasks only)
 *   - Early returns also wrapped in Fragment to include UnifiedChatPanel overlay
 *
 * Spec 2026-03-03: Unify Hub and RHS Panel Capabilities -- Task Group 4.4
 *   - Added getDashboardSummary fetch and dashboardData state for artifact tracking
 *   - Added onArtifactSaved={fetchDashboardData} to re-fetch after artifact save
 *   - Added artifactExists record derived from dashboardData
 *
 * Features:
 * - Import roadmap.md file from backend
 * - Display INITIATIVE and EPIC work items in hierarchical tree
 * - Read-only view (no editing capabilities)
 * - Detailed import summary with all 8 counts (inserted/updated/archived/deleted)
 * - "Go to Backlog" CTA after successful import with active epics
 * - Actionable error messages for 404/400/409 errors
 * - ARCHIVED initiatives collapsed by default
 * - Epic description expansion state management
 * - Spec 2026-01-05: Import button disabled when no active project
 * - Spec 2026-01-05: Control row state exposed to parent via callback
 * - Resizable left panel with width persisted to localStorage
 * - Spec 2026-03-01: RHS UnifiedChatPanel overlay for Roadmap PM persona
 *
 * Uses loadedFileName from ArchitectureContext as projectId.
 * Reuses WorkItemTree component for tree display.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useArchitecture } from '../../contexts/ArchitectureContext';
// Spec 2026-01-05: Import useProject for active project state
// Spec 2026-01-10: Import useProjectLoading for initial loading state handling
import { useProject, useProjectLoading } from '../../contexts/ProjectContext';
// Spec 2026-01-07: Import context hooks for expansion state persistence
import { useProductExpansion, deriveProjectKey } from '../../contexts/ProductUiStateContext';
import { fetchWorkItems } from '../../api/workItemsApi';
import { importRoadmap, fetchLatestArtifactMetadata } from '../../api/roadmapApi';
// Spec 2026-03-03: Import getDashboardSummary for artifact tracking
import { getDashboardSummary } from '../../api/dashboardApi';
import type { DashboardSummaryDto } from '../../types/dashboard';
import { buildWorkItemTree, deriveParentChain } from '../../utils/workItemTreeBuilder';
import type { WorkItem, WorkItemTreeNode } from '../../types/workItems';
import type { ImportResult, ArtifactMetadata } from '../../api/roadmapApi';
import { WorkItemTree } from './WorkItemTree';
import { WorkItemDetailsPanel } from './WorkItemDetailsPanel';
import { WorkItemCreateModal } from './WorkItemCreateModal';
import { WorkItemDeleteConfirmModal } from './WorkItemDeleteConfirmModal';
import { SyncDialog } from '../Sync/SyncDialog';
import { LinkToJiraDialog } from '../Sync/LinkToJiraDialog';
import { ResizableSplitPane } from '../shared/ResizableSplitPane';
// Spec 2026-03-01: Increment 9 -- Import UnifiedChatPanel for RHS overlay
import { UnifiedChatPanel } from '../UnifiedChat';
import type { ThreadKey } from '../../api/chatV2Api';
import baseStyles from './ProductBacklogPage.module.css';
import styles from './ProductRoadmapPage.module.css';

/**
 * Spec 2026-01-05: Control row state exposed to parent
 * Task Group 2.3: State shape for control row in ProductView
 *
 * Spec 2026-01-10: Extended with projectId and refreshWorkItems
 * for Upload Book of Work functionality
 */
export interface RoadmapControlState {
  /** Whether an import is currently in progress */
  importing: boolean;
  /** Last imported artifact metadata (null if never imported) */
  lastImportedMetadata: ArtifactMetadata | null;
  /** Whether metadata is currently loading */
  loadingMetadata: boolean;
  /** Handler function to trigger import */
  handleImport: () => void;
  /** Whether import button should be disabled */
  isImportDisabled: boolean;
  /**
   * Spec 2026-01-10: Project ID (name) for book of work upload
   * Used by ProductView to call uploadBookOfWork API
   */
  projectId: string | null;
  /**
   * Spec 2026-01-10: Function to refresh work items after upload
   * Called by ProductView after successful book of work upload
   */
  refreshWorkItems: () => Promise<void>;
}

/**
 * Props for ProductRoadmapPage
 */
interface ProductRoadmapPageProps {
  /** Callback to navigate to the Backlog tab */
  onNavigateToBacklog: () => void;
  /**
   * Spec 2026-01-05: Callback to expose control row state to parent
   * Called whenever control-relevant state changes
   */
  onControlStateChange?: (state: RoadmapControlState) => void;
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
 * Format a date for display (relative or absolute based on recency)
 * Exported for use in ProductView control row
 */
export function formatTimestamp(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMinutes < 1) {
    return 'just now';
  } else if (diffMinutes < 60) {
    return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`;
  } else if (diffHours < 24) {
    return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  } else if (diffDays < 7) {
    return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
  } else {
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
}

/**
 * ProductRoadmapPage Component
 *
 * Displays the Product Roadmap view for importing and reviewing
 * roadmap items (INITIATIVE and EPIC work items).
 *
 * Spec 2026-01-05: Control row is now rendered in ProductView.
 * This component exposes its state via onControlStateChange callback.
 *
 * Spec 2026-01-07: Expansion state is now backed by ProductUiStateContext
 * to persist across tab switches.
 *
 * Spec 2026-01-10: Uses ResizableSplitPane for resizable two-column layout.
 *
 * Spec 2026-03-01: Increment 9 -- Removed outer ResizableSplitPane with LHS chat.
 * Inner split pane (tree | details) now takes full width.
 * UnifiedChatPanel rendered as fixed-position RHS overlay in all return paths.
 */
export function ProductRoadmapPage({ onNavigateToBacklog, onControlStateChange }: ProductRoadmapPageProps) {
  // Get loadedFileName from context (used for UI/localStorage)
  const { loadedFileName } = useArchitecture();

  // Spec 2026-01-05: Get active project from ProjectContext
  const activeProject = useProject();
  const projectUuid = activeProject?.id ?? null;

  // Spec 2026-03-01: Construct PanelThreadKey for UnifiedChatPanel
  const panelThreadKey: ThreadKey | null = activeProject
    ? { type: 'panel', projectId: activeProject.id, screen: 'roadmap' }
    : null;

  // Spec 2026-01-10: Get loading state from ProjectContext
  // Used to properly gate buttons during initial project state load
  const loading = useProjectLoading();

  // Spec 2026-01-07: Derive projectKey for context-backed expansion state
  const projectKey = deriveProjectKey(loadedFileName);

  // Spec 2026-01-07: Task Group 4.2 - Use context-backed expansion state
  // Replaced local expandedIds state with useProductExpansion hook
  const { expandedIds, setExpandedIds, toggleExpanded } = useProductExpansion(projectKey, 'roadmap');

  // Spec 2026-01-07: Track whether first-load initialization has been done
  // This ref prevents re-initialization on every render or data refresh
  const hasInitializedExpansionRef = useRef(false);

  // Local state
  const [loadingRoadmap, setLoadingRoadmap] = useState<boolean>(false);
  const [importing, setImporting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [roadmapItems, setRoadmapItems] = useState<WorkItem[]>([]);

  // Spec 2026-01-04: Roadmap Import UX Glue - Persisted metadata state
  const [lastImportedMetadata, setLastImportedMetadata] = useState<ArtifactMetadata | null>(null);
  const [loadingMetadata, setLoadingMetadata] = useState<boolean>(false);

  // Epic description expansion state
  const [epicDescriptionExpandedIds, setEpicDescriptionExpandedIds] = useState<Set<string>>(new Set());

  // Spec 2026-03-03: Dashboard data state for artifactExists tracking
  const [dashboardData, setDashboardData] = useState<DashboardSummaryDto | null>(null);

  // Selection state for detail panel
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Create modal state (for adding epics under initiatives)
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [selectedParentForCreate, setSelectedParentForCreate] = useState<WorkItem | null>(null);

  // Delete modal state (for deleting initiatives/epics)
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<WorkItem | null>(null);
  const [descendantCountForDelete, setDescendantCountForDelete] = useState(0);

  // Tool ↔ Jira sync + link-to-Jira modal state (mirrors ProductBacklogPage)
  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [itemToSync, setItemToSync] = useState<WorkItem | null>(null);
  const [linkToJiraModalOpen, setLinkToJiraModalOpen] = useState(false);
  const [itemToLink, setItemToLink] = useState<WorkItem | null>(null);

  /**
   * Spec 2026-03-03: Fetch dashboard summary data for artifact tracking.
   * Follows the ProductPage fetchData pattern.
   */
  const fetchDashboardData = useCallback(async () => {
    if (!activeProject) return;
    try {
      const result = await getDashboardSummary(activeProject.id);
      setDashboardData(result);
    } catch (err) {
      // Silently fail - dashboard data is optional for artifact tracking
      console.warn('Failed to fetch dashboard data for artifact tracking:', err);
    }
  }, [activeProject]);

  /**
   * Fetch the latest artifact metadata for persisted status panel
   */
  const loadMetadata = useCallback(async () => {
    if (!projectUuid) {
      setLastImportedMetadata(null);
      return;
    }

    setLoadingMetadata(true);
    try {
      const metadata = await fetchLatestArtifactMetadata(projectUuid, 'ROADMAP_MD');
      setLastImportedMetadata(metadata);
    } catch (err) {
      // Silently fail - metadata is optional enhancement
      console.warn('Failed to fetch artifact metadata:', err);
    } finally {
      setLoadingMetadata(false);
    }
  }, [projectUuid]);

  /**
   * Load roadmap items from API and filter to INITIATIVE/EPIC only
   *
   * Spec 2026-01-07: Task Group 4.5 - Removed expansion state reset logic
   * Expansion initialization is now handled separately in useEffect
   * to avoid resetting user-modified expansion state on data refresh
   */
  const loadRoadmapItems = useCallback(async () => {
    if (!projectUuid) {
      setRoadmapItems([]);
      setErrorMessage(null);
      setErrorStatus(null);
      return;
    }

    setLoadingRoadmap(true);
    setErrorMessage(null);
    setErrorStatus(null);

    try {
      const items = await fetchWorkItems(projectUuid);

      // Filter to only INITIATIVE and EPIC types
      const filtered = items.filter(
        (item) => item.type === 'INITIATIVE' || item.type === 'EPIC'
      );

      setRoadmapItems(filtered);

      // Spec 2026-01-07: Task Group 4.5 - Removed lines that reset expandedIds
      // Expansion state initialization is now handled in the useEffect below
      // to preserve user modifications across data refreshes
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load roadmap items';
      setErrorMessage(message);
      setRoadmapItems([]);
    } finally {
      setLoadingRoadmap(false);
    }
  }, [projectUuid]);

  // Load on mount and when projectUuid changes
  // Spec 2026-03-03: Also fetch dashboard data alongside other loads
  useEffect(() => {
    loadRoadmapItems();
    loadMetadata();
    fetchDashboardData();
  }, [loadRoadmapItems, loadMetadata, fetchDashboardData]);

  /**
   * Spec 2026-01-07: Task Group 4.3 - First-load initialization logic
   *
   * Initialize expansion state only when:
   * 1. Context is empty for this project/tab (first load)
   * 2. We have roadmap items loaded
   * 3. We haven't already initialized (to prevent repeated resets)
   *
   * On subsequent loads (context not empty), use existing context state
   * to preserve user-modified expansion state.
   */
  useEffect(() => {
    // Skip if no items or still loading
    if (roadmapItems.length === 0 || loadingRoadmap) {
      return;
    }

    // Skip if we've already initialized for this project
    if (hasInitializedExpansionRef.current) {
      return;
    }

    // Check if context has existing state for this project/tab
    const contextIsEmpty = expandedIds.size === 0;

    if (contextIsEmpty) {
      // First load: compute default expansion
      // Non-ARCHIVED INITIATIVEs are expanded by default
      // ARCHIVED INITIATIVEs remain collapsed
      const initialExpanded = new Set<string>();
      for (const item of roadmapItems) {
        if (item.type === 'INITIATIVE' && item.status !== 'ARCHIVED') {
          initialExpanded.add(item.id);
        }
      }
      setExpandedIds(initialExpanded);
    }
    // If context is not empty, we use the existing state (no reset)

    // Mark as initialized to prevent re-running
    hasInitializedExpansionRef.current = true;
  }, [roadmapItems, loadingRoadmap, expandedIds.size, setExpandedIds]);

  /**
   * Reset initialization flag when project changes
   * This allows proper re-initialization for a new project
   */
  useEffect(() => {
    hasInitializedExpansionRef.current = false;
  }, [projectKey]);

  /**
   * Handle import button click
   * Enhanced error handling per Roadmap Import UX Glue spec
   */
  const handleImport = useCallback(async () => {
    if (!projectUuid) return;

    setImporting(true);
    setErrorMessage(null);
    setErrorStatus(null);

    try {
      const result = await importRoadmap(projectUuid);
      setImportResult(result);
      // Refresh tree data after successful import
      await loadRoadmapItems();
      // Update metadata immediately after successful import
      await loadMetadata();
    } catch (err) {
      if (err instanceof Error) {
        setErrorMessage(err.message);
        // Extract status from error message patterns
        if (err.message.includes('not found')) {
          setErrorStatus(404);
        } else if (err.message.includes('parse') || err.message.includes('Supported formats')) {
          setErrorStatus(400);
        } else if (err.message.includes('conflict') || err.message.includes('retry')) {
          setErrorStatus(409);
        }
      } else {
        setErrorMessage('Import failed');
      }
    } finally {
      setImporting(false);
    }
  }, [projectUuid, loadRoadmapItems, loadMetadata]);

  // Spec 2026-01-05: Task Group 3.2 - handleRefresh removed
  // Refresh functionality is now handled by handleImport (merged button)

  /**
   * Handle retry button click (for error state)
   */
  const handleRetry = useCallback(() => {
    setErrorMessage(null);
    setErrorStatus(null);
    handleImport();
  }, [handleImport]);

  /**
   * Handle Go to Backlog navigation
   */
  const handleGoToBacklog = useCallback(() => {
    onNavigateToBacklog();
  }, [onNavigateToBacklog]);

  // Build tree structure from flat roadmap items
  const treeResult = useMemo(() => {
    return buildWorkItemTree(roadmapItems);
  }, [roadmapItems]);

  // Apply expanded state to tree nodes using structural sharing.
  // Only creates new objects for nodes whose isExpanded actually changed.
  const nodesWithExpanded = useMemo((): WorkItemTreeNode[] => {
    function applyExpanded(nodes: WorkItemTreeNode[]): WorkItemTreeNode[] {
      let anyChanged = false;
      const result = nodes.map((node) => {
        const isExpanded = expandedIds.has(node.item.id);
        const children = applyExpanded(node.children);
        if (node.isExpanded === isExpanded && node.children === children) {
          return node;
        }
        anyChanged = true;
        return { ...node, isExpanded, children };
      });
      return anyChanged ? result : nodes;
    }
    return applyExpanded(treeResult.roots);
  }, [treeResult.roots, expandedIds]);

  // Count active (non-ARCHIVED) epics
  const activeEpicsCount = useMemo(() => {
    return roadmapItems.filter(
      (item) => item.type === 'EPIC' && item.status !== 'ARCHIVED'
    ).length;
  }, [roadmapItems]);

  /**
   * Spec 2026-01-07: Task Group 4.4 - Handle node expand/collapse toggle
   * Updated to use context's toggleExpanded instead of local state
   */
  const handleToggle = useCallback((id: string) => {
    toggleExpanded(id);
  }, [toggleExpanded]);

  /**
   * Handle epic description toggle
   */
  const handleToggleDescription = useCallback((id: string) => {
    setEpicDescriptionExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  // Selection handler
  const handleSelect = useCallback((id: string) => {
    setSelectedId(id);
  }, []);

  // Clear selection if selected item no longer exists in data
  useEffect(() => {
    if (selectedId && !treeResult.byId.has(selectedId)) {
      setSelectedId(null);
    }
  }, [selectedId, treeResult.byId]);

  // Derived: selected item, parent chain, children count
  const selectedItem = useMemo(() => {
    if (!selectedId) return null;
    return treeResult.byId.get(selectedId) || null;
  }, [selectedId, treeResult.byId]);

  const parentChain = useMemo(() => {
    if (!selectedId) return [];
    return deriveParentChain(selectedId, treeResult.byId);
  }, [selectedId, treeResult.byId]);

  const childrenCount = useMemo(() => {
    if (!selectedId) return 0;
    const children = treeResult.childrenByParent.get(selectedId);
    return children ? children.length : 0;
  }, [selectedId, treeResult.childrenByParent]);

  // Siblings for create modal (children of the parent, used for sort order computation)
  const siblingsForCreate = useMemo(() => {
    if (!selectedParentForCreate) return [];
    return treeResult.childrenByParent.get(selectedParentForCreate.id) || [];
  }, [selectedParentForCreate, treeResult.childrenByParent]);

  // === Modal Open Handlers ===

  const handleAddEpic = useCallback(() => {
    if (selectedItem && selectedItem.type.toUpperCase() === 'INITIATIVE') {
      setSelectedParentForCreate(selectedItem);
      setCreateModalOpen(true);
    }
  }, [selectedItem]);

  const handleDelete = useCallback(() => {
    if (selectedItem) {
      setItemToDelete(selectedItem);
      const count = countDescendants(selectedItem.id, treeResult.childrenByParent);
      setDescendantCountForDelete(count);
      setDeleteModalOpen(true);
    }
  }, [selectedItem, treeResult.childrenByParent]);

  // Tool ↔ Jira sync + link-to-Jira (mirrors ProductBacklogPage)
  const handleSync = useCallback(() => {
    if (selectedItem) {
      setItemToSync(selectedItem);
      setSyncModalOpen(true);
    }
  }, [selectedItem]);

  const handleSyncClose = useCallback(() => {
    setSyncModalOpen(false);
    setItemToSync(null);
  }, []);

  const handleSyncComplete = useCallback(async () => {
    setSyncModalOpen(false);
    setItemToSync(null);
    await loadRoadmapItems();
  }, [loadRoadmapItems]);

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
    await loadRoadmapItems();
  }, [loadRoadmapItems]);

  // === Modal Close Handlers ===

  const handleCloseCreateModal = useCallback(() => {
    setCreateModalOpen(false);
    setSelectedParentForCreate(null);
  }, []);

  const handleCloseDeleteModal = useCallback(() => {
    setDeleteModalOpen(false);
    setItemToDelete(null);
    setDescendantCountForDelete(0);
  }, []);

  // === Mutation Handlers ===

  const handleCreateSuccess = useCallback((newItem: WorkItem) => {
    setRoadmapItems((prev) => [...prev, newItem]);
    if (newItem.parentId) {
      const newExpandedIds = new Set(expandedIds);
      newExpandedIds.add(newItem.parentId);
      setExpandedIds(newExpandedIds);
    }
    setSelectedId(newItem.id);
    handleCloseCreateModal();
  }, [handleCloseCreateModal, expandedIds, setExpandedIds]);

  const handleDeleteSuccess = useCallback(() => {
    if (!itemToDelete) return;
    const idsToRemove = new Set<string>([
      itemToDelete.id,
      ...collectDescendantIds(itemToDelete.id, treeResult.childrenByParent),
    ]);
    setRoadmapItems((prev) => prev.filter((item) => !idsToRemove.has(item.id)));
    if (selectedId && idsToRemove.has(selectedId)) {
      setSelectedId(null);
    }
    handleCloseDeleteModal();
  }, [itemToDelete, treeResult.childrenByParent, selectedId, handleCloseDeleteModal]);

  /**
   * Render a count item with color coding
   */
  const renderCountItem = (label: string, count: number, type: 'inserted' | 'updated' | 'archived' | 'deleted') => {
    const prefix = type === 'inserted' ? '+' : type === 'updated' ? '~' : type === 'deleted' ? '-' : '';
    const className = count > 0
      ? (type === 'inserted' ? styles.countInserted
         : type === 'updated' ? styles.countUpdated
         : type === 'archived' ? styles.countArchived
         : styles.countDeleted)
      : styles.countZero;

    return (
      <span className={`${styles.countItem} ${className}`} key={type}>
        {prefix}{count} {label}
      </span>
    );
  };

  /**
   * Spec 2026-01-05: Compute whether import is disabled due to no active project
   * Spec 2026-01-10: Updated to include loading state
   * Buttons are disabled during initial load, when no project, or when importing
   */
  const isImportDisabled = loading || !activeProject || importing;

  /**
   * Spec 2026-01-10: Wrap loadRoadmapItems for use by ProductView
   * This async function is passed to parent for post-upload refresh
   */
  const refreshWorkItems = useCallback(async () => {
    await loadRoadmapItems();
  }, [loadRoadmapItems]);

  /**
   * Spec 2026-01-05: Task Group 2.3 - Expose control state to parent
   * Notify parent whenever control-relevant state changes
   *
   * Spec 2026-01-10: Extended with projectId and refreshWorkItems
   */
  useEffect(() => {
    if (onControlStateChange) {
      onControlStateChange({
        importing,
        lastImportedMetadata,
        loadingMetadata,
        handleImport,
        isImportDisabled,
        projectId: projectUuid,
        refreshWorkItems,
      });
    }
  }, [onControlStateChange, importing, lastImportedMetadata, loadingMetadata, handleImport, isImportDisabled, activeProject, refreshWorkItems]);

  // Spec 2026-03-01: Helper to render the UnifiedChatPanel overlay (reused across all return paths)
  // Spec 2026-03-03: Added onArtifactSaved and artifactExists props
  // Refresh both dashboard data and roadmap items after an artifact is saved
  const handleArtifactSaved = useCallback(() => {
    fetchDashboardData();
    loadRoadmapItems();
  }, [fetchDashboardData, loadRoadmapItems]);

  const chatPanelOverlay = panelThreadKey && (
    <UnifiedChatPanel
      threadKey={panelThreadKey}
      initialPersonaId="product-manager"
      allowedPersonaIds={['product-manager']}
      onArtifactSaved={handleArtifactSaved}
      artifactExists={{
        mission: dashboardData?.strategicFoundation?.productDefinition?.missionExists?.value === true,
        roadmap: Number(dashboardData?.strategicFoundation?.roadmap?.initiativesCount?.value ?? 0) > 0,
      }}
    />
  );

  // No project loaded state
  if (!loadedFileName) {
    return (
      <>
        <div className={baseStyles.container} data-testid="product-roadmap-page">
          <div className={baseStyles.noProjectContainer} data-testid="no-project-state">
            <div className={baseStyles.noProjectMessage}>No project loaded</div>
            <div className={baseStyles.noProjectHint}>
              Load a project to view roadmap.
            </div>
          </div>
        </div>
        {chatPanelOverlay}
      </>
    );
  }

  // Loading state
  if (loadingRoadmap) {
    return (
      <>
        <div className={baseStyles.container} data-testid="product-roadmap-page">
          <div className={baseStyles.loadingContainer} data-testid="loading-state">
            <div className={baseStyles.spinner} />
          </div>
        </div>
        {chatPanelOverlay}
      </>
    );
  }

  // Spec 2026-01-10: Left pane content - Tree (now inner left pane within the roadmap content)
  const leftPaneContent = (
    <div className={baseStyles.treePanelContent}>
      {roadmapItems.length === 0 ? (
        <div className={baseStyles.emptyContainer} data-testid="empty-state">
          <div className={baseStyles.emptyMessage}>No roadmap imported yet.</div>
        </div>
      ) : (
        <WorkItemTree
          nodes={nodesWithExpanded}
          selectedId={selectedId}
          onSelect={handleSelect}
          onToggle={handleToggle}
          expandedDescriptionIds={epicDescriptionExpandedIds}
          onToggleDescription={handleToggleDescription}
        />
      )}
    </div>
  );

  // Spec 2026-01-10: Right pane content - Summary/CTA cards and details
  const rightPaneContent = (
    <div className={styles.rightPanelContent}>
      {/* Spec 2026-01-05: Warning banner when no active project */}
      {/* Spec 2026-01-10: Don't show banner during initial loading to prevent misleading UI */}
      {!loading && !activeProject && (
        <div className={styles.noActiveProjectBanner} data-testid="no-active-project-warning">
          Create or open a project to import roadmap.
        </div>
      )}

      {/* Error card with actionable messages */}
      {errorMessage && (
        <div className={styles.errorCard} data-testid="error-card">
          <div className={styles.errorTitle}>Import Error</div>
          <div className={styles.errorMessage}>{errorMessage}</div>
          <div className={styles.errorActions}>
            <button
              className={styles.retryButton}
              onClick={handleRetry}
              disabled={importing}
              data-testid="retry-button"
            >
              Retry Import
            </button>
            {errorStatus === 404 && (
              <span className={styles.errorHint}>
                Create the file at agent-os/product/roadmap.md
              </span>
            )}
            {errorStatus === 400 && (
              <span className={styles.errorHint}>
                Check roadmap.md format
              </span>
            )}
          </div>
        </div>
      )}

      {/* Import summary card with detailed counts */}
      {importResult && !errorMessage && (
        <div className={styles.importSummaryCard} data-testid="import-summary-card">
          <div className={styles.importSummaryTitle}>Import Successful</div>
          <div className={styles.importSummaryRow}>
            <span className={styles.summaryLabel}>Revision:</span>
            <span className={styles.revisionBadge}>{importResult.artifactRevision}</span>
          </div>
          <div className={styles.importSummaryRow} data-testid="initiatives-summary">
            <span className={styles.summaryLabel}>Initiatives:</span>
            <div className={styles.summaryCountsGroup}>
              {renderCountItem('inserted', importResult.initiativesInserted, 'inserted')}
              <span className={styles.countSeparator}>/</span>
              {renderCountItem('updated', importResult.initiativesUpdated, 'updated')}
              <span className={styles.countSeparator}>/</span>
              {renderCountItem('archived', importResult.initiativesArchived, 'archived')}
              <span className={styles.countSeparator}>/</span>
              {renderCountItem('deleted', importResult.initiativesDeleted, 'deleted')}
            </div>
          </div>
          <div className={styles.importSummaryRow} data-testid="epics-summary">
            <span className={styles.summaryLabel}>Epics:</span>
            <div className={styles.summaryCountsGroup}>
              {renderCountItem('inserted', importResult.epicsInserted, 'inserted')}
              <span className={styles.countSeparator}>/</span>
              {renderCountItem('updated', importResult.epicsUpdated, 'updated')}
              <span className={styles.countSeparator}>/</span>
              {renderCountItem('archived', importResult.epicsArchived, 'archived')}
              <span className={styles.countSeparator}>/</span>
              {renderCountItem('deleted', importResult.epicsDeleted, 'deleted')}
            </div>
          </div>
        </div>
      )}

      {/* Go to Backlog CTA */}
      {importResult && !errorMessage && (
        <div className={styles.ctaSection} data-testid="cta-section">
          {activeEpicsCount > 0 ? (
            <button
              className={styles.goToBacklogButton}
              onClick={handleGoToBacklog}
              data-testid="go-to-backlog-button"
            >
              Go to Backlog ({activeEpicsCount} active epic{activeEpicsCount === 1 ? '' : 's'})
            </button>
          ) : (
            <div className={styles.noActiveEpicsHint} data-testid="no-active-epics-hint">
              No active epics found. Edit roadmap.md and re-import.
            </div>
          )}
        </div>
      )}

      {/* Detail panel for selected item */}
      {selectedItem && !errorMessage && (
        <div className={baseStyles.detailsPanelContent}>
          <WorkItemDetailsPanel
            item={selectedItem}
            parentChain={parentChain}
            childrenCount={childrenCount}
            onAddEpic={handleAddEpic}
            onDelete={handleDelete}
            onSync={handleSync}
            onLinkToJira={handleLinkToJira}
          />
        </div>
      )}

      {/* Details placeholder when nothing selected */}
      {!selectedItem && !errorMessage && !importResult && (
        <div className={styles.detailsPlaceholder} data-testid="details-placeholder">
          <div className={styles.placeholderText}>
            Select an initiative or epic to see details.
          </div>
        </div>
      )}
    </div>
  );

  // Spec 2026-03-01: Increment 9 -- Roadmap content (inner split pane takes full width)
  const existingRoadmapContent = (
    <ResizableSplitPane
      left={leftPaneContent}
      right={rightPaneContent}
      storageKey="pd.roadmap.leftWidth"
      defaultLeftWidthPx={350}
      minLeftWidthPx={200}
      maxLeftWidthPx={600}
    />
  );

  // Spec 2026-03-01: Increment 9 -- Render roadmap content at full width with RHS UnifiedChatPanel overlay
  return (
    <>
      <div className={baseStyles.container} data-testid="product-roadmap-page">
        {existingRoadmapContent}

        {/* Create Modal (for adding epics under initiatives) */}
        {createModalOpen && selectedParentForCreate && (
          <WorkItemCreateModal
            isOpen={createModalOpen}
            onClose={handleCloseCreateModal}
            parent={selectedParentForCreate}
            typeToCreate="EPIC"
            onSuccess={handleCreateSuccess}
            projectId={projectUuid!}
            siblings={siblingsForCreate}
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

        {/* Tool ↔ Jira sync dialog (Phase D) */}
        {syncModalOpen && itemToSync && projectUuid && (
          <SyncDialog
            isOpen={syncModalOpen}
            onClose={handleSyncClose}
            projectId={projectUuid}
            rootWorkItem={itemToSync}
            onSyncComplete={handleSyncComplete}
          />
        )}

        {/* Link-to-Jira dialog (Phase D) */}
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
      {chatPanelOverlay}
    </>
  );
}

// Spec 2026-01-05: Task Group 3.4 - Inline style constants removed
// actionRowStyles, primaryButtonStyles, secondaryButtonStyles deleted
// Control row styling now in ProductView.module.css
