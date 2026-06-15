/**
 * useUIScreenDiagram Hook
 *
 * React hook for managing UI_SCREEN diagram state and autosave.
 * Follows the same debounced autosave pattern as useSequenceDiagram.
 *
 * Features:
 * - Local state management for UIScreenContent
 * - Debounced autosave (500ms delay)
 * - Type-safe content updates
 * - Integration with ArchitectureContext for persistence
 */

import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { Diagram } from '../types/model';
import {
  UIScreenContent,
  UIScreenComponentRef,
  UIScreenActionRef,
  createDefaultUIScreenContent,
} from '../types/typedContent';

/** Debounce delay for autosave in milliseconds */
const AUTOSAVE_DELAY_MS = 500;

/**
 * Props for the useUIScreenDiagram hook
 */
export interface UseUIScreenDiagramProps {
  /** The current diagram object */
  diagram: Diagram | null;
  /** Callback to update the diagram (passed from parent context) */
  onUpdateDiagram: (diagramId: string, updates: Partial<Diagram>) => void;
}

/**
 * Return type for the useUIScreenDiagram hook
 */
export interface UseUIScreenDiagramReturn {
  /** The current UI screen content */
  content: UIScreenContent;
  /** Set the screen_id reference */
  setScreenId: (screenId: string | null) => void;
  /** Add a component reference */
  addComponent: (componentRef: UIScreenComponentRef) => void;
  /** Update a component reference */
  updateComponent: (componentId: string, updates: Partial<UIScreenComponentRef>) => void;
  /** Remove a component reference */
  removeComponent: (componentId: string) => void;
  /** Reorder components */
  reorderComponents: (components: UIScreenComponentRef[]) => void;
  /** Add an action reference */
  addAction: (actionRef: UIScreenActionRef) => void;
  /** Update an action reference */
  updateAction: (actionId: string, updates: Partial<UIScreenActionRef>) => void;
  /** Remove an action reference */
  removeAction: (actionId: string) => void;
  /** Reorder actions */
  reorderActions: (actions: UIScreenActionRef[]) => void;
  /** Replace entire content */
  setContent: (content: UIScreenContent) => void;
  /** Whether there are pending unsaved changes */
  isDirty: boolean;
  /** Force save immediately */
  saveNow: () => void;
}

/**
 * Extract UIScreenContent from diagram typedContent
 */
function extractUIScreenContent(diagram: Diagram | null): UIScreenContent {
  if (!diagram || !diagram.typed_content) {
    return createDefaultUIScreenContent();
  }

  const typedContent = diagram.typed_content;
  if (typedContent.type !== 'UI_SCREEN' || !typedContent.content) {
    return createDefaultUIScreenContent();
  }

  // Safe cast since we verified the type
  return typedContent.content as UIScreenContent;
}

/**
 * useUIScreenDiagram Hook
 *
 * Manages UI_SCREEN diagram state with debounced autosave.
 *
 * @param props - Hook props containing diagram and update callback
 * @returns Object with content state and mutation functions
 */
export function useUIScreenDiagram({
  diagram,
  onUpdateDiagram,
}: UseUIScreenDiagramProps): UseUIScreenDiagramReturn {
  // Local state for UI screen content
  const [content, setContentState] = useState<UIScreenContent>(() =>
    extractUIScreenContent(diagram)
  );

  // Track dirty state
  const [isDirty, setIsDirty] = useState(false);

  // Timer ref for debounced save
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Ref to current diagram ID for closure stability
  const diagramIdRef = useRef<string | null>(diagram?.id ?? null);

  // Update diagram ID ref when diagram changes
  useEffect(() => {
    diagramIdRef.current = diagram?.id ?? null;
  }, [diagram?.id]);

  // Sync local state when diagram changes from external source
  useEffect(() => {
    const newContent = extractUIScreenContent(diagram);
    setContentState(newContent);
    setIsDirty(false);
  }, [diagram?.id, diagram?.typed_content]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  /**
   * Save content to diagram
   */
  const saveContent = useCallback(
    (contentToSave: UIScreenContent) => {
      const diagramId = diagramIdRef.current;
      if (!diagramId) return;

      const typedContent = {
        type: 'UI_SCREEN' as const,
        version: 1,
        content: contentToSave,
      };

      onUpdateDiagram(diagramId, { typed_content: typedContent });
      setIsDirty(false);
    },
    [onUpdateDiagram]
  );

  /**
   * Schedule debounced save
   */
  const scheduleSave = useCallback(
    (newContent: UIScreenContent) => {
      setIsDirty(true);

      // Clear existing timer
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }

      // Schedule new save
      saveTimerRef.current = setTimeout(() => {
        saveContent(newContent);
        saveTimerRef.current = null;
      }, AUTOSAVE_DELAY_MS);
    },
    [saveContent]
  );

  /**
   * Force save immediately
   */
  const saveNow = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    saveContent(content);
  }, [content, saveContent]);

  /**
   * Set screen_id reference
   */
  const setScreenId = useCallback(
    (screenId: string | null) => {
      setContentState((prev) => {
        const newContent = { ...prev, screen_id: screenId };
        scheduleSave(newContent);
        return newContent;
      });
    },
    [scheduleSave]
  );

  /**
   * Add a component reference
   */
  const addComponent = useCallback(
    (componentRef: UIScreenComponentRef) => {
      setContentState((prev) => {
        const newContent = {
          ...prev,
          components: [...prev.components, componentRef],
        };
        scheduleSave(newContent);
        return newContent;
      });
    },
    [scheduleSave]
  );

  /**
   * Update a component reference
   */
  const updateComponent = useCallback(
    (componentId: string, updates: Partial<UIScreenComponentRef>) => {
      setContentState((prev) => {
        const newComponents = prev.components.map((c) =>
          c.id === componentId ? { ...c, ...updates } : c
        );
        const newContent = { ...prev, components: newComponents };
        scheduleSave(newContent);
        return newContent;
      });
    },
    [scheduleSave]
  );

  /**
   * Remove a component reference
   */
  const removeComponent = useCallback(
    (componentId: string) => {
      setContentState((prev) => {
        const newComponents = prev.components.filter((c) => c.id !== componentId);
        const newContent = { ...prev, components: newComponents };
        scheduleSave(newContent);
        return newContent;
      });
    },
    [scheduleSave]
  );

  /**
   * Reorder components
   */
  const reorderComponents = useCallback(
    (components: UIScreenComponentRef[]) => {
      setContentState((prev) => {
        const newContent = { ...prev, components };
        scheduleSave(newContent);
        return newContent;
      });
    },
    [scheduleSave]
  );

  /**
   * Add an action reference
   */
  const addAction = useCallback(
    (actionRef: UIScreenActionRef) => {
      setContentState((prev) => {
        const newContent = {
          ...prev,
          actions: [...prev.actions, actionRef],
        };
        scheduleSave(newContent);
        return newContent;
      });
    },
    [scheduleSave]
  );

  /**
   * Update an action reference
   */
  const updateAction = useCallback(
    (actionId: string, updates: Partial<UIScreenActionRef>) => {
      setContentState((prev) => {
        const newActions = prev.actions.map((a) =>
          a.id === actionId ? { ...a, ...updates } : a
        );
        const newContent = { ...prev, actions: newActions };
        scheduleSave(newContent);
        return newContent;
      });
    },
    [scheduleSave]
  );

  /**
   * Remove an action reference
   */
  const removeAction = useCallback(
    (actionId: string) => {
      setContentState((prev) => {
        const newActions = prev.actions.filter((a) => a.id !== actionId);
        const newContent = { ...prev, actions: newActions };
        scheduleSave(newContent);
        return newContent;
      });
    },
    [scheduleSave]
  );

  /**
   * Reorder actions
   */
  const reorderActions = useCallback(
    (actions: UIScreenActionRef[]) => {
      setContentState((prev) => {
        const newContent = { ...prev, actions };
        scheduleSave(newContent);
        return newContent;
      });
    },
    [scheduleSave]
  );

  /**
   * Replace entire content
   */
  const setContent = useCallback(
    (newContent: UIScreenContent) => {
      setContentState(newContent);
      scheduleSave(newContent);
    },
    [scheduleSave]
  );

  return useMemo(
    () => ({
      content,
      setScreenId,
      addComponent,
      updateComponent,
      removeComponent,
      reorderComponents,
      addAction,
      updateAction,
      removeAction,
      reorderActions,
      setContent,
      isDirty,
      saveNow,
    }),
    [
      content,
      setScreenId,
      addComponent,
      updateComponent,
      removeComponent,
      reorderComponents,
      addAction,
      updateAction,
      removeAction,
      reorderActions,
      setContent,
      isDirty,
      saveNow,
    ]
  );
}

export default useUIScreenDiagram;
