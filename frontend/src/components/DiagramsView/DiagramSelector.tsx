/**
 * DiagramSelector Component (Refactored)
 *
 * Spec 2026-03-05: Diagrams Toolbar UX Refresh - Task Group 7
 *
 * Replaces the previous flat <select> dropdown and inline New/Copy input controls
 * with a single-line toolbar:
 *   Search: [Grouped Autocomplete] [New] [Copy] [Rename] [Delete]
 *
 * All creation/modification flows are now modal-driven:
 * - New: Opens NewDiagramModal, dispatches ADD_DIAGRAM
 * - Copy: Opens CopyDiagramModal, deep-copies selected diagram, dispatches ADD_DIAGRAM
 * - Rename: Opens RenameDiagramModal, dispatches UPDATE_DIAGRAM
 * - Delete: Opens DeleteDiagramConfirmModal, dispatches DELETE_DIAGRAM
 */

import React, { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
// Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 5
// Diagram selection migrates from a reducer dispatch (`SELECT_DIAGRAM`)
// to the URL `:diagramId` segment under `/.../diagrams/:diagramId`.
// useNavigate writes the URL; the URL -> reducer sync effect inside
// DiagramsView keeps `state.selectedDiagramId` in step. After deleting
// the currently-selected diagram, navigate back to the bare list URL
// (`/.../diagrams`) so the URL reflects the cleared selection.
import { useArchitecture, useArchitectureDispatch, useActiveArchitectureId } from '../../contexts/ArchitectureContext';
import { useProject } from '../../contexts/ProjectContext';
import { saveModelToBackend } from '../../utils/saveUtils';
import { Button } from '../common/Button';
import { generatePrefixedId } from '../../utils/idGenerator';
import { Diagram } from '../../types/model';
import { DiagramType } from '../../types/diagramType';
import { DiagramAutocomplete } from './DiagramAutocomplete';
import { NewDiagramModal } from './modals/NewDiagramModal';
import { CopyDiagramModal } from './modals/CopyDiagramModal';
import { RenameDiagramModal } from './modals/RenameDiagramModal';
import { DeleteDiagramConfirmModal } from './modals/DeleteDiagramConfirmModal';
import styles from './DiagramsView.module.css';

export function DiagramSelector() {
  const state = useArchitecture();
  const dispatch = useArchitectureDispatch();
  // Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 5
  const navigate = useNavigate();
  const activeProject = useProject();
  const activeArchitectureId = useActiveArchitectureId();

  // Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 5
  // Navigate helper. Writes the URL; the sync effect in DiagramsView
  // updates the reducer. Falls back to a direct dispatch when the
  // architecture id has not yet hydrated (rare; keeps the autocomplete
  // usable during the initial-mount window).
  const navigateToDiagram = useCallback((diagramId: string | null) => {
    if (activeProject?.id && activeArchitectureId) {
      const base = `/projects/${activeProject.id}/architectures/${activeArchitectureId}/diagrams`;
      navigate(diagramId ? `${base}/${diagramId}` : base);
    } else if (diagramId !== null) {
      dispatch({ type: 'SELECT_DIAGRAM', payload: diagramId });
    } else {
      dispatch({ type: 'SELECT_DIAGRAM', payload: null });
    }
  }, [navigate, activeProject?.id, activeArchitectureId, dispatch]);

  // --------------------------------------------------------------------------
  // Modal visibility state (Task 7.2)
  // --------------------------------------------------------------------------
  const [showNewModal, setShowNewModal] = useState<boolean>(false);
  const [showCopyModal, setShowCopyModal] = useState<boolean>(false);
  const [showRenameModal, setShowRenameModal] = useState<boolean>(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<boolean>(false);

  // --------------------------------------------------------------------------
  // Derived values (Task 7.2)
  // --------------------------------------------------------------------------
  const hasDiagrams = state.model.diagrams.length > 0;
  const selectedDiagram = state.model.diagrams.find(d => d.id === state.selectedDiagramId) || null;
  const hasSelection = !!state.selectedDiagramId && hasDiagrams;

  // --------------------------------------------------------------------------
  // Task 7.3: New Diagram callback
  // --------------------------------------------------------------------------
  const handleNewDiagram = (name: string, diagramType: DiagramType) => {
    const newId = generatePrefixedId('diag');
    const newDiagram: Diagram = {
      id: newId,
      name,
      description: '',
      diagram_type: diagramType,
      settings: {},
      diagram_nodes: [],
      diagram_edges: [],
    };
    dispatch({ type: 'ADD_DIAGRAM', payload: newDiagram });
    setShowNewModal(false);
  };

  // --------------------------------------------------------------------------
  // Task 7.4: Copy Diagram callback
  // --------------------------------------------------------------------------
  const handleCopyDiagram = (name: string) => {
    if (!selectedDiagram) return;
    const copiedDiagram: Diagram = JSON.parse(JSON.stringify(selectedDiagram));
    copiedDiagram.id = generatePrefixedId('diag');
    copiedDiagram.name = name;
    // diagram_type is preserved from the deep copy
    dispatch({ type: 'ADD_DIAGRAM', payload: copiedDiagram });
    setShowCopyModal(false);
  };

  // --------------------------------------------------------------------------
  // Task 7.5: Rename Diagram callback
  // --------------------------------------------------------------------------
  const handleRenameDiagram = (newName: string) => {
    if (!selectedDiagram) return;
    dispatch({ type: 'UPDATE_DIAGRAM', diagramId: selectedDiagram.id, updates: { name: newName } });
    setShowRenameModal(false);
  };

  // --------------------------------------------------------------------------
  // Task 7.6: Delete Diagram callback (with backend persistence)
  // --------------------------------------------------------------------------
  const handleDeleteDiagram = useCallback(async () => {
    if (!state.selectedDiagramId) return;
    const diagramIdToDelete = state.selectedDiagramId;
    dispatch({ type: 'DELETE_DIAGRAM', payload: diagramIdToDelete });
    setShowDeleteConfirm(false);

    // Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 5
    // Navigate back to the bare diagram-list URL so the URL reflects
    // the cleared selection. The URL -> reducer sync effect in
    // DiagramsView clears `state.selectedDiagramId` to null on the
    // next render. (The DELETE_DIAGRAM reducer also picks a fallback
    // selection in some cases; the URL-driven sync overrides that to
    // keep URL and reducer aligned -- which the spec explicitly calls
    // out as the design intent.)
    navigateToDiagram(null);

    // Persist deletion to backend
    // Spec 2026-05-11: architecture-scoped save requires active project + architecture
    if (state.loadedFileName && activeProject?.id && activeArchitectureId) {
      const updatedModel = {
        ...state.model,
        diagrams: state.model.diagrams.filter(d => d.id !== diagramIdToDelete),
      };
      await saveModelToBackend(updatedModel, state.loadedFileName, activeProject.id, activeArchitectureId, dispatch);
    }
  }, [state.selectedDiagramId, state.model, state.loadedFileName, activeProject?.id, activeArchitectureId, dispatch, navigateToDiagram]);

  // --------------------------------------------------------------------------
  // Render (Task 7.2)
  // --------------------------------------------------------------------------
  return (
    <div className={styles.selectorContainer}>
      <span style={{ fontSize: '14px', fontWeight: 400, color: '#333' }}>
        {selectedDiagram ? selectedDiagram.name : 'None'}
      </span>
      <span className={styles.selectorLabel}>Search:</span>
      <DiagramAutocomplete
        diagrams={state.model.diagrams}
        selectedDiagramId={state.selectedDiagramId}
        onSelect={(id) => navigateToDiagram(id)}
      />
      <Button variant="secondary" onClick={() => setShowNewModal(true)}>
        New
      </Button>
      <Button variant="secondary" onClick={() => setShowCopyModal(true)} disabled={!hasSelection}>
        Copy
      </Button>
      <Button variant="secondary" onClick={() => setShowRenameModal(true)} disabled={!hasSelection}>
        Rename
      </Button>
      <Button variant="secondary" onClick={() => setShowDeleteConfirm(true)} disabled={!hasSelection}>
        Delete
      </Button>

      {/* Conditionally rendered modals */}
      {showNewModal && (
        <NewDiagramModal
          isOpen={showNewModal}
          onClose={() => setShowNewModal(false)}
          onSubmit={handleNewDiagram}
          existingDiagrams={state.model.diagrams}
        />
      )}
      {showCopyModal && selectedDiagram && (
        <CopyDiagramModal
          isOpen={showCopyModal}
          onClose={() => setShowCopyModal(false)}
          onSubmit={handleCopyDiagram}
          existingDiagrams={state.model.diagrams}
          sourceDiagramName={selectedDiagram.name}
        />
      )}
      {showRenameModal && selectedDiagram && (
        <RenameDiagramModal
          isOpen={showRenameModal}
          onClose={() => setShowRenameModal(false)}
          onSubmit={handleRenameDiagram}
          existingDiagrams={state.model.diagrams}
          currentDiagramName={selectedDiagram.name}
        />
      )}
      {showDeleteConfirm && (
        <DeleteDiagramConfirmModal
          isOpen={showDeleteConfirm}
          onClose={() => setShowDeleteConfirm(false)}
          onConfirm={handleDeleteDiagram}
        />
      )}
    </div>
  );
}
