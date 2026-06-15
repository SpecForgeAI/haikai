/**
 * ProductImplementPage Component
 *
 * Spec 2026-01-03: Product Implement View (Stage 5 - Increment 4)
 * Task Group 2: Main page component for the Product Implement view.
 *
 * Spec 2026-01-04: Product Implement Context Picker v1
 * Task Group 4: Integration with ContextPickerModal for linking entities/diagrams.
 *
 * Spec 2026-01-09: Persist Implement Context per Work Item in Backend
 * Task Group 3: Backend API integration for context persistence.
 *
 * Spec 2026-01-09: Implement Chat - Planner Conversation Loop (Iteration 2)
 * Task Group 6: Integration with ImplementationAssistantPanel for chat functionality.
 *
 * Spec 2026-01-17: Context Picker Modal UI Improvements
 * Task Group 9: Parent component integration with relationshipOptions prop
 *
 * Spec 2026-01-17: Fix Context Chips Hydrate Labels After Navigation
 * Task Groups 1 & 2: Label hydration on context fetch and on architecture data load
 *
 * Spec 2026-01-18: Fix Add Context Relationship Labels
 * Task Group 1: Pass metaModelEntities to buildRelationshipPickList for proper label rendering
 *
 * Spec 2026-01-24: Implement Screen Change 1 - Remove RHS WorkItemSummaryPanel
 * Task Group 1: Removed RHS panel and WorkItemSummaryPanel
 * - Removed onBackToBacklog prop from interface
 * - Removed rightPane div and WorkItemSummaryPanel
 * - Updated leftPane to take full width
 * - Context state and handlers remain for ContextPickerModal and future integration
 *
 * Spec 2026-05-19: PM Migration Shape-Spec Batch Generation
 * Task Group 12: WorkItem Implement-tab integration
 * - Renders the new `ImplementTabShapeSpecCard` sibling component above the
 *   Implementation Assistant panel. The card queries the per-WorkItem
 *   spec-generation endpoint and renders the "Generated shape-spec
 *   available" chip + stored spec text only when a generation row exists
 *   for the active WorkItem (R-9; no new field on `WorkItemEntity`).
 *
 * Features:
 * - Loads work item from API using workItemId prop
 * - Single-pane layout: Implementation Assistant with 65/35 inner split
 * - Empty state when no workItemId or item not found
 * - Loading, error states with retry functionality
 * - Derives parent chain and children list for selected item
 * - Context linking via ContextPickerModal, persisted to backend API
 * - localStorage used as secondary cache, backend is authoritative
 * - Passes work item metadata and context to ImplementationAssistantPanel for chat
 * - Passes relationship options to ContextPickerModal for relationship context selection
 * - Hydrates context labels on fetch and when architecture data loads
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useArchitecture, useActiveArchitectureId } from '../../contexts/ArchitectureContext';
import { useProject } from '../../contexts/ProjectContext';
import { fetchWorkItems } from '../../api/workItemsApi';
import { fetchImplementContext, saveImplementContext } from '../../api/implementContextApi';
import { buildWorkItemTree, deriveParentChain } from '../../utils/workItemTreeBuilder';
import type { WorkItem } from '../../types/workItems';
import type { ContextState } from '../../utils/contextStorage';
import { loadContext, saveContext, createEmptyContextState } from '../../utils/contextStorage';
import { rehydrateContextLabels } from '../../utils/contextLabelResolver';
import {
  buildArchitecturePickList,
  buildDiagramPickList,
  buildRelationshipPickList,
} from '../../utils/contextPickListBuilders';
import { getImplementState } from '../../api/chatApi';
import { deserializeImplementState } from '../../utils/implementStateSerializer';
import { ImplementationAssistantPanel } from './ImplementationAssistantPanel';
import { ContextPickerModal } from './ContextPickerModal';
import { ImplementTabShapeSpecCard } from './ImplementTabShapeSpecCard';
import { useFeatureRefinementOrchestration } from '../../hooks/useFeatureRefinementOrchestration';
import type { StoryRefinementResult } from '../../types/featureRefinement';
import styles from './ProductImplementPage.module.css';

/**
 * Props for ProductImplementPage component
 *
 * Spec 2026-01-24: Removed onBackToBacklog prop - no longer needed
 */
export interface ProductImplementPageProps {
  /** The work item ID to display (from URL query parameter) */
  workItemId: string | null;
  /** Refinement mode: 'standard' (default), 'refine' (PM->TE), 'refine_and_implement', or 'holistic_only' */
  refinementMode?: 'standard' | 'refine' | 'refine_and_implement' | 'holistic_only';
}

// ============================================================================
// Label Comparison Helper
// Spec 2026-01-17: Fix Context Chips Hydrate Labels After Navigation
// Task Group 2: Used to prevent infinite loops when re-hydrating labels
// ============================================================================

/**
 * Compare labels between two ContextState objects to detect changes.
 * Used to prevent infinite loops in the re-hydration useEffect.
 *
 * @param oldState - The previous context state
 * @param newState - The new context state after hydration
 * @returns true if any labels have changed
 */
function hasLabelsChanged(oldState: ContextState, newState: ContextState): boolean {
  const oldLabels = [
    ...oldState.entity_refs.map(r => r.label),
    ...oldState.diagram_refs.map(r => r.label),
    ...(oldState.relationship_refs || []).map(r => r.label),
  ].join('|');

  const newLabels = [
    ...newState.entity_refs.map(r => r.label),
    ...newState.diagram_refs.map(r => r.label),
    ...(newState.relationship_refs || []).map(r => r.label),
  ].join('|');

  return oldLabels !== newLabels;
}

/**
 * ProductImplementPage Component
 *
 * Displays the implementation view with:
 * - Single pane: Implementation Assistant with Feature Definition and Team Chat
 *
 * Handles empty state, loading state, and error state.
 * Manages context state (linked entities/diagrams/relationships) via localStorage.
 *
 * Spec 2026-01-24: Removed RHS WorkItemSummaryPanel - now single pane layout
 */
export function ProductImplementPage({
  workItemId,
  refinementMode = 'standard',
}: ProductImplementPageProps) {
  // Get state from context
  const state = useArchitecture();
  const { loadedFileName, model } = state;
  // Get active project for UUID-based API calls
  const activeProject = useProject();
  const projectUuid = activeProject?.id ?? null;
  // Spec 2026-05-19 follow-up: active architecture id is required to build the
  // drill-back URL to the spec-generation workspace (the workspace lives under
  // the architecture-scoped route tree).
  const activeArchitectureId = useActiveArchitectureId();

  // Router navigation - Spec 2026-05-19 G12 drill-back to the spec workspace.
  const navigate = useNavigate();

  // Local state
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [workItems, setWorkItems] = useState<WorkItem[]>([]);

  // Context state for linking entities/diagrams/relationships
  const [contextState, setContextState] = useState<ContextState>(createEmptyContextState());
  const [contextLoading, setContextLoading] = useState<boolean>(false);

  // Modal state
  const [isContextModalOpen, setIsContextModalOpen] = useState<boolean>(false);

  // Auto-send message state (set when user clicks "Send" in context modal)
  const [autoSendMessage, setAutoSendMessage] = useState<string | null>(null);

  // ============================================================================
  // Spec 2026-01-17: Fix Context Chips Hydrate Labels After Navigation
  // Task Group 2: Guard ref to prevent infinite loops during hydration
  // ============================================================================
  const isHydratingRef = useRef<boolean>(false);

  // Load work items when projectId changes
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

  // ============================================================================
  // Spec 2026-01-17: Fix Context Chips Hydrate Labels After Navigation
  // Task Group 1: Load context from backend API and hydrate labels
  // ============================================================================
  useEffect(() => {
    if (loadedFileName && workItemId) {
      setContextLoading(true);
      // Use projectUuid for backend API calls (backend expects UUID path variable)
      const effectiveProjectId = projectUuid || loadedFileName;
      fetchImplementContext(effectiveProjectId, workItemId)
        .then((loaded) => {
          // Task Group 1: Hydrate labels immediately after fetch
          const rehydrated = rehydrateContextLabels(
            loaded,
            model.metaModel.entities,
            model.diagrams,
            model.metaModel.relationships
          );
          setContextState(rehydrated);
          // Cache the rehydrated context to localStorage as secondary storage
          saveContext(loadedFileName, workItemId, rehydrated);
        })
        .catch((err) => {
          console.warn('Failed to load context from backend, falling back to localStorage:', err);
          // Fallback to localStorage if backend fails
          const cached = loadContext(loadedFileName, workItemId);
          // Still hydrate labels for cached context
          const rehydrated = rehydrateContextLabels(
            cached,
            model.metaModel.entities,
            model.diagrams,
            model.metaModel.relationships
          );
          setContextState(rehydrated);
        })
        .finally(() => {
          setContextLoading(false);
        });
    } else {
      setContextState(createEmptyContextState());
    }
  }, [loadedFileName, workItemId, projectUuid]); // Note: model dependencies intentionally excluded to avoid re-fetching

  // ============================================================================
  // Spec 2026-01-17: Fix Context Chips Hydrate Labels After Navigation
  // Task Group 2: Re-hydrate labels when architecture data changes
  // ============================================================================
  useEffect(() => {
    // Skip if already hydrating to prevent infinite loops
    if (isHydratingRef.current) {
      return;
    }

    // Skip if no context to hydrate
    if (
      contextState.entity_refs.length === 0 &&
      contextState.diagram_refs.length === 0 &&
      (!contextState.relationship_refs || contextState.relationship_refs.length === 0)
    ) {
      return;
    }

    // Skip if architecture data is not loaded yet
    // We check if entities object exists and has at least one collection with items
    const hasEntityData = model.metaModel.entities &&
      Object.values(model.metaModel.entities).some(
        (arr) => Array.isArray(arr) && arr.length > 0
      );

    if (!hasEntityData && model.diagrams.length === 0) {
      return;
    }

    // Re-hydrate labels with current architecture data
    const rehydrated = rehydrateContextLabels(
      contextState,
      model.metaModel.entities,
      model.diagrams,
      model.metaModel.relationships
    );

    // Only update state if labels actually changed
    if (hasLabelsChanged(contextState, rehydrated)) {
      isHydratingRef.current = true;
      setContextState(rehydrated);
      // Reset the ref after state update is scheduled
      // Using setTimeout to ensure it resets after React processes the state update
      setTimeout(() => {
        isHydratingRef.current = false;
      }, 0);
    }
  }, [
    model.metaModel.entities,
    model.diagrams,
    model.metaModel.relationships,
    contextState,
  ]);

  // Build tree structure from flat work items
  const treeResult = useMemo(() => {
    return buildWorkItemTree(workItems);
  }, [workItems]);

  // Get selected item from workItemId
  const selectedItem = useMemo(() => {
    if (!workItemId) return null;
    return treeResult.byId.get(workItemId) || null;
  }, [workItemId, treeResult.byId]);

  // Get parent chain for selected item (used for epic name derivation)
  const parentChain = useMemo(() => {
    if (!workItemId) return [];
    return deriveParentChain(workItemId, treeResult.byId);
  }, [workItemId, treeResult.byId]);

  // Spec 2026-01-24: Task Group 2 - Derive epicName from parentChain
  const epicName = useMemo(() => {
    const epic = parentChain.find(parent => parent.type.toUpperCase() === 'EPIC');
    return epic?.title;
  }, [parentChain]);

  // Derive featureName from parentChain when working on a STORY
  const featureName = useMemo(() => {
    if (selectedItem?.type.toUpperCase() !== 'STORY') return undefined;
    const feature = parentChain.find(parent => parent.type.toUpperCase() === 'FEATURE');
    return feature?.title;
  }, [parentChain, selectedItem]);

  // Derive sibling stories: other children of the same parent (excluding self)
  const siblingStories = useMemo(() => {
    if (!selectedItem?.parentId) return [];
    const siblings = treeResult.childrenByParent.get(selectedItem.parentId) || [];
    return siblings
      .filter((s) => s.id !== selectedItem.id)
      .map((s) => ({ title: s.title, description: s.description, status: s.status }));
  }, [selectedItem, treeResult.childrenByParent]);

  // Derive child stories of the feature (for multi-story cycling)
  // For PM->TE per-story refinement: skip COMPLETED and CANCELLED stories
  const childStories = useMemo(() => {
    if (!workItemId || !selectedItem) return [];
    if (selectedItem.type.toUpperCase() !== 'FEATURE') return [];
    const allChildren = treeResult.childrenByParent.get(workItemId) || [];
    return allChildren.filter(s => {
      const status = s.status?.toUpperCase();
      return status !== 'COMPLETED' && status !== 'CANCELLED';
    });
  }, [workItemId, selectedItem, treeResult.childrenByParent]);

  // For holistic TE review: only exclude CANCELLED stories (COMPLETED stories
  // are relevant for integration/E2E test analysis)
  const childStoriesForHolistic = useMemo(() => {
    if (!workItemId || !selectedItem) return [];
    if (selectedItem.type.toUpperCase() !== 'FEATURE') return [];
    const allChildren = treeResult.childrenByParent.get(workItemId) || [];
    return allChildren.filter(s => s.status?.toUpperCase() !== 'CANCELLED');
  }, [workItemId, selectedItem, treeResult.childrenByParent]);

  // Spec 2026-03-19: Pre-load story specs for holistic_only mode.
  // Fetches persisted implement state for each child story from the backend.
  const [preloadedStoryResults, setPreloadedStoryResults] = useState<StoryRefinementResult[]>([]);
  const preloadAttemptedRef = useRef<string | null>(null);

  useEffect(() => {
    if (
      refinementMode !== 'holistic_only' ||
      childStoriesForHolistic.length === 0 ||
      !activeProject?.projectParentFolder ||
      !loadedFileName ||
      preloadAttemptedRef.current === workItemId
    ) {
      return;
    }
    preloadAttemptedRef.current = workItemId;

    const loadStorySpecs = async () => {
      const results: StoryRefinementResult[] = [];
      for (const story of childStoriesForHolistic) {
        try {
          const resp = await getImplementState(
            loadedFileName,
            story.id,
            activeProject.projectParentFolder!,
            story.title
          );
          if (resp.exists && resp.state) {
            const deserialized = deserializeImplementState(resp.state);
            if (deserialized) {
              results.push({
                storyId: story.id,
                storyTitle: story.title,
                plannerResponse: deserialized.latestPlannerResponse ?? null,
                testPlannerResponse: deserialized.latestTestPlannerResponse ?? null,
                completedAt: new Date(),
              });
            }
          }
        } catch {
          // Skip stories with no persisted state
        }
      }
      setPreloadedStoryResults(results);
    };

    loadStorySpecs();
  }, [refinementMode, childStoriesForHolistic, activeProject?.projectParentFolder, loadedFileName, workItemId]);

  // Multi-story refinement orchestration
  const orchestration = useFeatureRefinementOrchestration({
    featureWorkItemId: workItemId,
    stories: childStories,
    refinementMode,
    preloadedStoryResults: refinementMode === 'holistic_only' ? preloadedStoryResults : undefined,
  });

  // When multi-story cycling is active, use the orchestration's activeWorkItemId
  // to look up the effective selected item (may be a story instead of the feature)
  const effectiveWorkItemId = orchestration.hasMultiStory
    ? orchestration.activeWorkItemId
    : workItemId;

  const effectiveSelectedItem = useMemo(() => {
    if (!effectiveWorkItemId) return null;
    return treeResult.byId.get(effectiveWorkItemId) || null;
  }, [effectiveWorkItemId, treeResult.byId]);

  // Derive parent chain for effective item (may be a story during cycling)
  const effectiveParentChain = useMemo(() => {
    if (!effectiveWorkItemId) return [];
    return deriveParentChain(effectiveWorkItemId, treeResult.byId);
  }, [effectiveWorkItemId, treeResult.byId]);

  const effectiveEpicName = useMemo(() => {
    const epic = effectiveParentChain.find(parent => parent.type.toUpperCase() === 'EPIC');
    return epic?.title;
  }, [effectiveParentChain]);

  const effectiveFeatureName = useMemo(() => {
    const item = effectiveSelectedItem;
    if (!item || item.type.toUpperCase() !== 'STORY') return undefined;
    const feature = effectiveParentChain.find(parent => parent.type.toUpperCase() === 'FEATURE');
    return feature?.title;
  }, [effectiveParentChain, effectiveSelectedItem]);

  // Sibling stories for the effective item
  const effectiveSiblingStories = useMemo(() => {
    if (!effectiveSelectedItem?.parentId) return [];
    const siblings = treeResult.childrenByParent.get(effectiveSelectedItem.parentId) || [];
    return siblings
      .filter((s) => s.id !== effectiveSelectedItem.id)
      .map((s) => ({ title: s.title, description: s.description, status: s.status }));
  }, [effectiveSelectedItem, treeResult.childrenByParent]);

  // Build pick list options from architecture model
  const architectureOptions = useMemo(() => {
    return buildArchitecturePickList(model.metaModel.entities);
  }, [model.metaModel.entities]);

  const diagramOptions = useMemo(() => {
    return buildDiagramPickList(model.diagrams);
  }, [model.diagrams]);

  // Build relationship pick list options from architecture model
  // Spec 2026-01-17: Task Group 9 - Parent component integration
  // Spec 2026-01-18: Task Group 1 - Pass metaModelEntities for proper label rendering
  const relationshipOptions = useMemo(() => {
    return buildRelationshipPickList(model.metaModel.relationships, model.metaModel.entities);
  }, [model.metaModel.relationships, model.metaModel.entities]);

  // Handle retry button click
  const handleRetry = useCallback(() => {
    loadWorkItems();
  }, [loadWorkItems]);

  // Handle "Add context" button click
  const handleAddContext = useCallback(() => {
    setIsContextModalOpen(true);
  }, []);

  // Handle modal close
  const handleContextModalClose = useCallback(() => {
    setIsContextModalOpen(false);
  }, []);

  // Handle modal Apply
  const handleContextApply = useCallback(
    (newState: ContextState) => {
      setContextState(newState);
      // Persist to backend API and localStorage as secondary cache
      if (loadedFileName && workItemId) {
        const effectiveProjectId = projectUuid || loadedFileName;
        saveImplementContext(effectiveProjectId, workItemId, newState)
          .then(() => {
            // Also save to localStorage as secondary cache
            saveContext(loadedFileName, workItemId, newState);
          })
          .catch((err) => {
            console.warn('Failed to save context to backend:', err);
            // Still save to localStorage as fallback
            saveContext(loadedFileName, workItemId, newState);
          });
      }
    },
    [loadedFileName, workItemId, projectUuid]
  );

  // Handle context modal Send (Apply + auto-send message to chat)
  const handleContextSend = useCallback(() => {
    setAutoSendMessage(
      "I've provided the architectural context, please give me your understanding of this feature"
    );
  }, []);

  // Clear auto-send message after it has been consumed
  const handleAutoSendComplete = useCallback(() => {
    setAutoSendMessage(null);
  }, []);

  // Handle remove entity chip
  const handleRemoveEntityChip = useCallback(
    (entityId: string) => {
      const newState: ContextState = {
        ...contextState,
        entity_refs: contextState.entity_refs.filter(
          (ref) => ref.entity_id !== entityId
        ),
      };
      setContextState(newState);
      // Persist to backend API and localStorage as secondary cache
      if (loadedFileName && workItemId) {
        const effectiveProjectId = projectUuid || loadedFileName;
        saveImplementContext(effectiveProjectId, workItemId, newState)
          .then(() => {
            saveContext(loadedFileName, workItemId, newState);
          })
          .catch((err) => {
            console.warn('Failed to save context to backend:', err);
            saveContext(loadedFileName, workItemId, newState);
          });
      }
    },
    [contextState, loadedFileName, workItemId, projectUuid]
  );

  // Handle remove diagram chip
  const handleRemoveDiagramChip = useCallback(
    (diagramId: string) => {
      const newState: ContextState = {
        ...contextState,
        diagram_refs: contextState.diagram_refs.filter(
          (ref) => ref.diagram_id !== diagramId
        ),
      };
      setContextState(newState);
      // Persist to backend API and localStorage as secondary cache
      if (loadedFileName && workItemId) {
        const effectiveProjectId = projectUuid || loadedFileName;
        saveImplementContext(effectiveProjectId, workItemId, newState)
          .then(() => {
            saveContext(loadedFileName, workItemId, newState);
          })
          .catch((err) => {
            console.warn('Failed to save context to backend:', err);
            saveContext(loadedFileName, workItemId, newState);
          });
      }
    },
    [contextState, loadedFileName, workItemId, projectUuid]
  );

  // ============================================================================
  // Spec 2026-05-19: Migration Shape-Spec Batch Generation - Task Group 12
  //
  // Drill-back handler: when the user clicks "Open in spec workspace" inside
  // the `ImplementTabShapeSpecCard`, route to the spec-generation workspace
  // for the book-of-work that owns this WorkItem's generation row, passing
  // the WorkItem id as a query param so the workspace auto-opens the story
  // result drawer (`SpecGenerationWorkspace.initialDrawerWorkItemId`).
  //
  // URL shape is architecture-scoped because the route is registered under
  // `/projects/:projectId/architectures/:architectureId/...` in `App.tsx`;
  // `ProjectLayout`'s missing-architecture redirect would otherwise bounce
  // a flat project-scoped URL away.
  // ============================================================================
  const handleDrillBackToWorkspace = useCallback(
    (input: { workItemId: string; bookOfWorkId: string | null }) => {
      if (!projectUuid || !input.bookOfWorkId || !activeArchitectureId) return;
      const url =
        `/projects/${encodeURIComponent(projectUuid)}` +
        `/architectures/${encodeURIComponent(activeArchitectureId)}` +
        `/migration-books-of-work/${encodeURIComponent(input.bookOfWorkId)}` +
        `/spec-generation` +
        `?workItemId=${encodeURIComponent(input.workItemId)}`;
      navigate(url);
    },
    [navigate, projectUuid, activeArchitectureId]
  );

  // No project loaded state
  // Spec 2026-01-24: Removed "Go to Backlog" button
  if (!loadedFileName) {
    return (
      <div className={styles.container} data-testid="product-implement-page">
        <div className={styles.emptyStateContainer} data-testid="no-project-state">
          <div className={styles.emptyStateMessage}>No project loaded</div>
          <div className={styles.emptyStateHint}>
            Load a project file to view implementation details.
          </div>
        </div>
      </div>
    );
  }

  // Loading state
  if (loading) {
    return (
      <div className={styles.container} data-testid="product-implement-page">
        <div className={styles.loadingContainer} data-testid="loading-state">
          <div className={styles.spinner} />
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className={styles.container} data-testid="product-implement-page">
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
    );
  }

  // Empty state - no workItemId provided or item not found
  // Spec 2026-01-24: Removed "Go to Backlog" button
  if (!workItemId || !selectedItem) {
    return (
      <div className={styles.container} data-testid="product-implement-page">
        <div className={styles.emptyStateContainer} data-testid="empty-state">
          <div className={styles.emptyStateMessage}>
            Select a feature or story from Backlog to begin.
          </div>
        </div>
      </div>
    );
  }

  // Resolve the item to display - during multi-story cycling, this may be a story
  const displayItem = orchestration.hasMultiStory ? effectiveSelectedItem : selectedItem;
  const displayWorkItemId = orchestration.hasMultiStory ? effectiveWorkItemId : workItemId;

  // Normal state - single-pane layout with Implementation Assistant
  // Spec 2026-01-24: Removed RHS panel, leftPane now takes full width
  return (
    <div className={styles.container} data-testid="product-implement-page">
      {/* Main pane: Implementation Assistant */}
      <div className={styles.mainPane} data-testid="main-pane">
        {/*
          Spec 2026-05-19 (G12): Generated shape-spec card. Renders only
          when a spec-generation row exists for the active WorkItem (R-9).
          Drill-back routes to the spec workspace with auto-open drawer.
        */}
        {projectUuid && displayWorkItemId && (
          <ImplementTabShapeSpecCard
            projectId={projectUuid}
            workItemId={displayWorkItemId}
            onDrillBackToWorkspace={handleDrillBackToWorkspace}
          />
        )}

        <ImplementationAssistantPanel
          key={`${displayWorkItemId}-${orchestration.phase}`}
          workItemId={displayWorkItemId!}
          workItemTitle={displayItem?.title || selectedItem.title}
          workItemType={displayItem?.type || selectedItem.type}
          workItemDescription={displayItem?.description || selectedItem.description || ""}
          projectId={loadedFileName}
          projectUuid={projectUuid ?? undefined}
          contextState={contextState}
          epicName={orchestration.hasMultiStory ? effectiveEpicName : epicName}
          featureName={orchestration.hasMultiStory ? effectiveFeatureName : featureName}
          siblingStories={orchestration.hasMultiStory ? effectiveSiblingStories : siblingStories}
          contextLoading={contextLoading}
          onAddContext={handleAddContext}
          onRemoveEntityChip={handleRemoveEntityChip}
          onRemoveDiagramChip={handleRemoveDiagramChip}
          autoSendMessage={autoSendMessage}
          onAutoSendComplete={handleAutoSendComplete}
          refinementMode={refinementMode}
          refinementProgress={orchestration.hasMultiStory ? orchestration.progress : undefined}
          onRefinementComplete={orchestration.hasMultiStory ? orchestration.advance : undefined}
          holisticReviewData={orchestration.holisticReviewData}
        />
      </div>

      {/* Context Picker Modal */}
      <ContextPickerModal
        isOpen={isContextModalOpen}
        onClose={handleContextModalClose}
        initialSelected={contextState}
        architectureOptions={architectureOptions}
        diagramOptions={diagramOptions}
        relationshipOptions={relationshipOptions}
        onApply={handleContextApply}
        onSend={handleContextSend}
      />
    </div>
  );
}
