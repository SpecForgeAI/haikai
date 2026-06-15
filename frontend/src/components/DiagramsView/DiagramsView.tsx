import React, { useState, useRef, useCallback, useMemo } from 'react';
import ReactDOM from 'react-dom';
import { useArchitecture, useArchitectureDispatch, useActiveArchitectureId, useUndo } from '../../contexts/ArchitectureContext';
// Spec 2026-05-02 Multi-Architecture Selector + URL Routing -- Task Group 4
// useNavigate replaces the SET_VIEW dispatch path; useCurrentView
// derives the view name from the URL (was state.currentView).
import { useNavigate } from 'react-router-dom';
import { useCurrentView as useCurrentViewHook, useSelectedDiagramId } from '../../hooks/useCurrentView';
import { DiagramSelector } from './DiagramSelector';
import { Canvas } from './Canvas';
import { PalettePanel, ActivityFlowCreationMode, initialActivityFlowCreationMode } from './PalettePanel';
// Task Group 4: Import activity flow creation utilities
import {
  exitActivityFlowCreationMode,
  setActivityFlowSourceNode,
  createActivityFlowEntity,
  createActivityFlowDiagramEdge,
} from '../../utils/activityFlowCreation';
// Spec 2026-01-01 Task Group 4: Import state transition creation utilities
import {
  TransitionCreationMode,
  initialTransitionCreationMode,
  exitTransitionCreationMode,
  setTransitionSourceState,
  createStateTransitionEntity,
  createTransitionDiagramEdge,
} from '../../utils/stateTransitionCreation';
// Spec 2026-01-02 Task Group 8: Import UI workflow transition creation utilities
import {
  WorkflowTransitionCreationMode,
  createIdleWorkflowTransitionMode,
  advanceToTargetSelection,
  isValidUIScreenNode,
  createUIWorkflowTransition,
  createUIWorkflowTransitionEdge,
} from '../../utils/uiWorkflowTransitionCreation';
import { SequenceEditorPanel } from './SequenceEditorPanel';
// UI Architecture Phase 1 Increment 2: Import UI_SCREEN diagram components
import { UIScreenDiagramEditorPanel } from './UIScreenDiagramEditorPanel';
import { UIScreenDiagramRenderer } from './UIScreenDiagramRenderer';
// Spec 2026-05-05 Task Group 3: Infrastructure Diagram V2 parallel renderer
import { InfrastructureDiagramRenderer } from './InfrastructureDiagramRenderer';
import { InspectorPanel, DecorationAddMode } from './InspectorPanel';
import { DecorationsPanel } from './DecorationsPanel';
import { TimeNavigationControls } from './TimeNavigationControls';
import { ElementContextMenu, ZIndexAction } from './ElementContextMenu';
import { AddLinkModal } from './modals/AddLinkModal';
import { AdvancedAddDialog, buildTreeData, buildOrderedNodeListFromLeaves, getAncestorKeys } from './AdvancedAddDialog';
import { buildWrappedNodeHierarchy } from './PalettePanel';
import { ErrorModal } from '../common/Modal';
// Task Group 4 (A3): Import EditActivityFlowConditionModal
import { EditActivityFlowConditionModal, isDecisionActivityKind } from './modals/EditActivityFlowConditionModal';
import { validateDiagramNodes, calculateDiagramFitZoom, getEntityLabel, getDescendantNodes, parseLineWeight } from '../../utils/rendering';
import { buildInterfaceCompositeNodes, DataEntityIdsForInterface } from '../../utils/interfaceCompositeBuilder';
import { getDefaultViewQuarter } from '../../utils/quarterUtils';
import { generateDecorationId } from '../../config/defaults';
import { getZIndexBounds, calculateNewZIndex } from '../../utils/zIndexUtils';
import { appConfig, DECORATION_DEFAULTS, Z_INDEX_DEFAULTS } from '../../config/defaults';
import { getViewportCenterFromRaw, DEFAULT_CANVAS_CENTER, GetViewportCenterFn } from '../../utils/viewportUtils';
import { getDiagramType } from '../../types/diagramType';
import {
  Diagram,
  DiagramNode,
  DiagramEdge,
  Decoration,
  ShapeDecoration,
  TextHorizontalAlign,
  TextVerticalAlign,
  DecorationHAlign,
  DecorationVAlign,
  SHAPE_DECORATION_TYPES,
  ShapeDecorationType,
  DecorationType,
  LineDecoration,
  ElementContextMenuState,
  ElementContextMenuType,
  ActivityFlow,
  Activity,
  ENTITY_TYPES,
} from '../../types/model';
import {
  TreeNodeData,
  AdvancedAddResult,
  DEFAULT_SPACING_PRESET,
  LayoutConfig,
  SPACING_PRESETS,
  DEFAULT_LAYOUT_CONFIG,
} from '../../types/advancedAdd';
import styles from './DiagramsView.module.css';
// Spec: Export Diagrams as SVG - API functions for SVG export
import { exportDiagramAsSvg, exportAllDiagramsAsZip, parseContentDispositionFilename } from '../../api/modelApi';
// Spec 2026-03-26: Temporary Diagram - imports for temporary diagram mode
import TemporaryDiagramRenderer from './TemporaryDiagramRenderer';
import { fetchTemporaryDiagram } from '../../api/temporaryDiagramApi';
import type { TemporaryArchitectureDiagram } from '../../types/temporaryArchitectureDiagram';
import { useTemporaryDiagramContext } from '../../contexts/TemporaryDiagramContext';
// Spec 2026-03-27: Deterministic Diagram Auto-Mapping (Increment 5)
import { mapTemporaryDiagram, DiagramMappingResult } from '../../utils/temporaryDiagramMapping';
// Spec 2026-03-27: Mapping Confirmation Modal (Increment 6)
import { MappingConfirmationModal } from './MappingConfirmationModal';
import type { CompletedDiagramMapping } from '../../utils/mappingConfirmationUtils';
// Spec 2026-03-27: Diagram Finalization and Completion UX (Increment 7)
import { Toast, ToastType } from '../common/Toast';
import { buildCompletedMappingFromFullMatch, buildNativeDiagramFromMapping } from '../../utils/diagramFinalizationUtils';
import { calculateEdgePoints } from '../../utils/relationshipUtils';
// Spec 2026-04-03: User Journey Review - imports for journey review mode
import { useUserJourneyReviewContext } from '../../contexts/UserJourneyReviewContext';
import UserJourneyDiagramRenderer from './UserJourneyDiagramRenderer';
import type { JourneyNavLink } from './UserJourneyDiagramRenderer';
import { enrichJourneySteps } from './journeyEnrichment';
import { JourneyChooser } from './JourneyChooser';
import { JourneyReviewBanner } from './JourneyReviewBanner';
// Spec 2026-04-03: User Journey Diagram Edit and Save Flow - imports
import { SaveJourneyDiagramModal } from './modals/SaveJourneyDiagramModal';
import { generatePrefixedId } from '../../utils/idGenerator';
import type { UserJourneyDiagramDto } from '../../types/userJourneyDiagram';
// Spec 2026-04-03: User Journey One-Way Sync from Meta-Model - imports
import { SyncStatusBanner } from './SyncStatusBanner';
import { useUserJourneySyncStatus } from '../../hooks/useUserJourneySyncStatus';
import { useProject } from '../../contexts/ProjectContext';
// Spec 2026-04-07: User Journey Overview Review - imports
import { useUserJourneyOverviewReviewContext } from '../../contexts/UserJourneyOverviewReviewContext';
import { OverviewReviewBanner } from './OverviewReviewBanner';
import { fetchTemporaryUserJourneyOverviewDiagram } from '../../api/userJourneyOverviewDiagramApi';
import type { UserJourneyOverviewDiagramDto, UserJourneyOverviewNodeDto } from '../../types/userJourneyOverviewDiagram';
import UserJourneyOverviewDiagramRenderer from './UserJourneyOverviewDiagramRenderer';
// Spec 2026-04-10: Overview enrichment utility (summary counts + related colleagues)
import { enrichOverviewFull } from './overviewEnrichment';
import type { OverviewEnrichmentMetaData } from './overviewEnrichment';
// Persist diagrams to backend after save
import { saveModelToBackend } from '../../utils/saveUtils';
// Spec 2026-04-13: Save All Diagrams as PDF (server-side generation)
import { groupDiagramsByBusinessUser } from './pdfExport';
import { extractUserJourneyDiagram, extractUserJourneyOverviewDiagram } from './diagramExtractionUtils';
import { generatePdfOnServer } from '../../api/pdfApi';
import type { PdfDiagramGroup } from '../../api/pdfApi';


// Canvas-level context menu for Copy/Paste/Undo on empty space
function CanvasContextMenu({ x, y, copyEnabled, pasteEnabled, undoEnabled, onCopy, onPaste, onUndo, onClose }: {
  x: number; y: number;
  copyEnabled: boolean; pasteEnabled: boolean; undoEnabled: boolean;
  onCopy: () => void; onPaste: () => void; onUndo: () => void; onClose: () => void;
}) {
  const menuRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) onClose();
    };
    const tid = setTimeout(() => document.addEventListener('mousedown', handleClickOutside), 0);
    return () => { clearTimeout(tid); document.removeEventListener('mousedown', handleClickOutside); };
  }, [onClose]);

  React.useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  // Clamp position to viewport
  const padding = 5;
  const menuWidth = 120;
  const menuHeight = 105;
  let posX = x; let posY = y;
  if (posX + menuWidth > window.innerWidth - padding) posX = window.innerWidth - menuWidth - padding;
  if (posY + menuHeight > window.innerHeight - padding) posY = window.innerHeight - menuHeight - padding;
  if (posX < padding) posX = padding;
  if (posY < padding) posY = padding;

  const itemStyle = (enabled: boolean): React.CSSProperties => ({
    padding: '8px 16px', fontSize: 13, cursor: enabled ? 'pointer' : 'default',
    color: enabled ? '#333' : '#aaa', userSelect: 'none',
  });

  return ReactDOM.createPortal(
    <div ref={menuRef} style={{
      position: 'fixed', left: posX, top: posY, minWidth: 120,
      background: 'white', border: '1px solid #e0e0e0', borderRadius: 4,
      boxShadow: '0 2px 8px rgba(0,0,0,0.15)', zIndex: 1000, padding: '4px 0',
    }} onClick={e => { e.stopPropagation(); e.preventDefault(); }} onContextMenu={e => { e.stopPropagation(); e.preventDefault(); }}>
      <div style={itemStyle(undoEnabled)}
        onClick={undoEnabled ? onUndo : undefined}
        onMouseEnter={e => { if (undoEnabled) (e.target as HTMLElement).style.background = '#f5f5f5'; }}
        onMouseLeave={e => { (e.target as HTMLElement).style.background = ''; }}>
        Undo
      </div>
      <div style={{ borderTop: '1px solid #e0e0e0', margin: '2px 0' }} />
      <div style={itemStyle(copyEnabled)}
        onClick={copyEnabled ? onCopy : undefined}
        onMouseEnter={e => { if (copyEnabled) (e.target as HTMLElement).style.background = '#f5f5f5'; }}
        onMouseLeave={e => { (e.target as HTMLElement).style.background = ''; }}>
        Copy
      </div>
      <div style={itemStyle(pasteEnabled)}
        onClick={pasteEnabled ? onPaste : undefined}
        onMouseEnter={e => { if (pasteEnabled) (e.target as HTMLElement).style.background = '#f5f5f5'; }}
        onMouseLeave={e => { (e.target as HTMLElement).style.background = ''; }}>
        Paste
      </div>
    </div>,
    document.body
  );
}

// Selection state type for multi-select support
export interface SelectionState {
  selectedNodeIds: Set<string>;
  selectedEdgeIds: Set<string>;
  selectedDecorationIds: Set<string>;
}

// Props interface for Canvas selection callbacks
export interface CanvasSelectionProps {
  selectedNodeIds: Set<string>;
  selectedEdgeIds: Set<string>;
  selectedDecorationIds: Set<string>;
  onNodeSelect: (nodeId: string, isMultiSelect: boolean) => void;
  onEdgeSelect: (edgeId: string, isMultiSelect: boolean) => void;
  onDecorationSelect: (decorationId: string, isMultiSelect: boolean) => void;
  onClearSelection: () => void;
  onBulkSelect: (nodeIds: Set<string>, edgeIds: Set<string>, decorationIds: Set<string>, addToExisting: boolean) => void;
}

// Props interface for InspectorPanel selection props (kept for compatibility)
export interface InspectorPanelSelectionProps {
  selectedNodeIds: Set<string>;
  selectedEdgeIds: Set<string>;
  selectedDecorationIds: Set<string>;
}

// =========================================
// Row 2 Helper Functions (copied from InspectorPanel)
// =========================================

// Helper to parse font size string to number
function parseFontSize(fontSize?: string | number): number {
  if (fontSize === undefined || fontSize === null) return 12;
  if (typeof fontSize === 'number') return fontSize;
  const parsed = parseInt(fontSize, 10);
  return isNaN(parsed) ? 12 : parsed;
}

// Get common font size across all selected items (nodes, edges, and decorations)
function getCommonFontSize(
  selectedNodeIds: Set<string>,
  selectedEdgeIds: Set<string>,
  selectedDecorationIds: Set<string>,
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  decorations: Decoration[]
): number | null {
  const sizes: number[] = [];

  for (const nodeId of selectedNodeIds) {
    const node = nodes.find(n => n.id === nodeId);
    if (node) {
      sizes.push(parseFontSize(node.text_font_size));
    }
  }

  for (const edgeId of selectedEdgeIds) {
    const edge = edges.find(e => e.id === edgeId);
    if (edge) {
      sizes.push(parseFontSize(edge.label_font_size));
    }
  }

  for (const decorationId of selectedDecorationIds) {
    const decoration = decorations.find(d => d.id === decorationId);
    if (decoration) {
      sizes.push(decoration.text_font_size ?? (decoration.type === 'BOX' ? DECORATION_DEFAULTS.BOX.text_font_size : DECORATION_DEFAULTS.LINE.text_font_size));
    }
  }

  if (sizes.length === 0) return null;

  const firstSize = sizes[0];
  return sizes.every(s => s === firstSize) ? firstSize : null;
}

// Check if all selected items have a particular font weight
function allHaveFontWeight(
  weight: 'bold' | 'normal',
  selectedNodeIds: Set<string>,
  selectedEdgeIds: Set<string>,
  selectedDecorationIds: Set<string>,
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  decorations: Decoration[]
): boolean {
  for (const nodeId of selectedNodeIds) {
    const node = nodes.find(n => n.id === nodeId);
    if (node && (node.text_font_weight || 'normal') !== weight) {
      return false;
    }
  }

  for (const edgeId of selectedEdgeIds) {
    const edge = edges.find(e => e.id === edgeId);
    if (edge && (edge.label_font_weight || 'normal') !== weight) {
      return false;
    }
  }

  for (const decorationId of selectedDecorationIds) {
    const decoration = decorations.find(d => d.id === decorationId);
    if (decoration && (decoration.text_font_weight || 'normal') !== weight) {
      return false;
    }
  }

  return true;
}

// Check if all selected items have a particular font style
function allHaveFontStyle(
  style: 'italic' | 'normal',
  selectedNodeIds: Set<string>,
  selectedEdgeIds: Set<string>,
  selectedDecorationIds: Set<string>,
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  decorations: Decoration[]
): boolean {
  for (const nodeId of selectedNodeIds) {
    const node = nodes.find(n => n.id === nodeId);
    if (node && (node.text_font_style || 'normal') !== style) {
      return false;
    }
  }

  for (const edgeId of selectedEdgeIds) {
    const edge = edges.find(e => e.id === edgeId);
    if (edge && (edge.label_font_style || 'normal') !== style) {
      return false;
    }
  }

  for (const decorationId of selectedDecorationIds) {
    const decoration = decorations.find(d => d.id === decorationId);
    if (decoration && (decoration.text_font_style || 'normal') !== style) {
      return false;
    }
  }

  return true;
}

// Check if all selected items have a particular text decoration
function allHaveTextDecoration(
  decoration: 'underline' | 'none',
  selectedNodeIds: Set<string>,
  selectedEdgeIds: Set<string>,
  selectedDecorationIds: Set<string>,
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  decorations: Decoration[]
): boolean {
  for (const nodeId of selectedNodeIds) {
    const node = nodes.find(n => n.id === nodeId);
    if (node && (node.text_text_decoration || 'none') !== decoration) {
      return false;
    }
  }

  for (const edgeId of selectedEdgeIds) {
    const edge = edges.find(e => e.id === edgeId);
    if (edge && (edge.label_text_decoration || 'none') !== decoration) {
      return false;
    }
  }

  for (const decorationId of selectedDecorationIds) {
    const deco = decorations.find(d => d.id === decorationId);
    if (deco && (deco.text_text_decoration || 'none') !== decoration) {
      return false;
    }
  }

  return true;
}

// Get common horizontal alignment across selected rectangular nodes only
function getCommonHAlign(
  selectedNodeIds: Set<string>,
  nodes: DiagramNode[]
): TextHorizontalAlign | null {
  const aligns: TextHorizontalAlign[] = [];

  for (const nodeId of selectedNodeIds) {
    const node = nodes.find(n => n.id === nodeId);
    if (node && node.entity_type !== 'BUSINESS_USER') {
      aligns.push(node.text_h_align || 'CENTER');
    }
  }

  if (aligns.length === 0) return null;

  const firstAlign = aligns[0];
  return aligns.every(a => a === firstAlign) ? firstAlign : null;
}

// Get common vertical alignment across selected rectangular nodes only
function getCommonVAlign(
  selectedNodeIds: Set<string>,
  nodes: DiagramNode[]
): TextVerticalAlign | null {
  const aligns: TextVerticalAlign[] = [];

  for (const nodeId of selectedNodeIds) {
    const node = nodes.find(n => n.id === nodeId);
    if (node && node.entity_type !== 'BUSINESS_USER') {
      aligns.push(node.text_v_align || 'MIDDLE');
    }
  }

  if (aligns.length === 0) return null;

  const firstAlign = aligns[0];
  return aligns.every(a => a === firstAlign) ? firstAlign : null;
}

// Get common horizontal alignment across selected shape decorations
function getCommonDecorationHAlign(
  selectedDecorationIds: Set<string>,
  decorations: Decoration[]
): DecorationHAlign | null {
  const aligns: DecorationHAlign[] = [];

  for (const decorationId of selectedDecorationIds) {
    const decoration = decorations.find(d => d.id === decorationId);
    if (decoration && SHAPE_DECORATION_TYPES.includes(decoration.type as any)) {
      aligns.push(decoration.text_h_align || 'CENTER');
    }
  }

  if (aligns.length === 0) return null;

  const firstAlign = aligns[0];
  return aligns.every(a => a === firstAlign) ? firstAlign : null;
}

// Get common vertical alignment across selected shape decorations
function getCommonDecorationVAlign(
  selectedDecorationIds: Set<string>,
  decorations: Decoration[]
): DecorationVAlign | null {
  const aligns: DecorationVAlign[] = [];

  for (const decorationId of selectedDecorationIds) {
    const decoration = decorations.find(d => d.id === decorationId);
    if (decoration && SHAPE_DECORATION_TYPES.includes(decoration.type as any)) {
      aligns.push(decoration.text_v_align || 'TOP');
    }
  }

  if (aligns.length === 0) return null;

  const firstAlign = aligns[0];
  return aligns.every(a => a === firstAlign) ? firstAlign : null;
}

// Check for rectangular nodes in selection
function hasRectangularNodesInSelection(
  selectedNodeIds: Set<string>,
  nodes: DiagramNode[]
): boolean {
  for (const nodeId of selectedNodeIds) {
    const node = nodes.find(n => n.id === nodeId);
    if (node && node.entity_type !== 'BUSINESS_USER') {
      return true;
    }
  }
  return false;
}

// Check if selection contains shape decorations (any shape type, not lines)
function hasShapeDecorationsInSelection(
  selectedDecorationIds: Set<string>,
  decorations: Decoration[]
): boolean {
  for (const decorationId of selectedDecorationIds) {
    const decoration = decorations.find(d => d.id === decorationId);
    if (decoration && SHAPE_DECORATION_TYPES.includes(decoration.type as any)) {
      return true;
    }
  }
  return false;
}

// Check if selection has items that support background colour
function hasBackgroundSupportingItems(
  selectedNodeIds: Set<string>,
  selectedDecorationIds: Set<string>,
  decorations: Decoration[]
): boolean {
  if (selectedNodeIds.size > 0) return true;

  for (const decorationId of selectedDecorationIds) {
    const decoration = decorations.find(d => d.id === decorationId);
    if (decoration && SHAPE_DECORATION_TYPES.includes(decoration.type as any)) {
      return true;
    }
  }

  return false;
}

// =========================================
// Task Group 2: POSITION Controls Helper Functions
// =========================================

/**
 * Check if position controls should be enabled based on selection
 * Enabled: single node or single shape decoration selected
 * Disabled: no selection, multi-select, line, edge, or line decoration
 */
function isPositionControlsEnabled(
  selectedNodeIds: Set<string>,
  selectedEdgeIds: Set<string>,
  selectedDecorationIds: Set<string>,
  decorations: Decoration[]
): boolean {
  const nodeCount = selectedNodeIds.size;
  const edgeCount = selectedEdgeIds.size;
  const decorationCount = selectedDecorationIds.size;
  const totalCount = nodeCount + edgeCount + decorationCount;

  // Disabled if no selection
  if (totalCount === 0) {
    return false;
  }

  // Disabled if multiple elements selected
  if (totalCount > 1) {
    return false;
  }

  // Disabled if edge is selected
  if (edgeCount > 0) {
    return false;
  }

  // Enabled if single node is selected
  if (nodeCount === 1) {
    return true;
  }

  // For single decoration, check if it's a shape decoration (not line)
  if (decorationCount === 1) {
    const decorationId = Array.from(selectedDecorationIds)[0];
    const decoration = decorations.find(d => d.id === decorationId);
    if (decoration && SHAPE_DECORATION_TYPES.includes(decoration.type as any)) {
      return true;
    }
    // Line decorations don't have position controls
    return false;
  }

  return false;
}

/**
 * Get position values from selection (for single node or shape decoration)
 */
function getPositionValues(
  selectedNodeIds: Set<string>,
  selectedDecorationIds: Set<string>,
  nodes: DiagramNode[],
  decorations: Decoration[]
): { posX: number | null; posY: number | null; width: number | null; height: number | null } {
  const nodeCount = selectedNodeIds.size;
  const decorationCount = selectedDecorationIds.size;

  if (nodeCount === 1) {
    const nodeId = Array.from(selectedNodeIds)[0];
    const node = nodes.find(n => n.id === nodeId);
    if (node) {
      return {
        posX: node.pos_x,
        posY: node.pos_y,
        width: node.width,
        height: node.height,
      };
    }
  }

  if (decorationCount === 1) {
    const decorationId = Array.from(selectedDecorationIds)[0];
    const decoration = decorations.find(d => d.id === decorationId);
    if (decoration && 'pos_x' in decoration) {
      const shapeDec = decoration as ShapeDecoration;
      return {
        posX: shapeDec.pos_x,
        posY: shapeDec.pos_y,
        width: shapeDec.width,
        height: shapeDec.height,
      };
    }
  }

  return {
    posX: null,
    posY: null,
    width: null,
    height: null,
  };
}

/**
 * Get stroke value from the selected element (node, edge, or decoration).
 * Returns the numeric stroke width, or null if nothing applicable is selected.
 */
function getStrokeValue(
  selectedNodeIds: Set<string>,
  selectedEdgeIds: Set<string>,
  selectedDecorationIds: Set<string>,
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  decorations: Decoration[]
): number | null {
  const totalCount = selectedNodeIds.size + selectedEdgeIds.size + selectedDecorationIds.size;
  if (totalCount !== 1) return null;

  if (selectedNodeIds.size === 1) {
    const node = nodes.find(n => n.id === Array.from(selectedNodeIds)[0]);
    if (node) return parseLineWeight(node.line_weight);
  }

  if (selectedEdgeIds.size === 1) {
    const edge = edges.find(e => e.id === Array.from(selectedEdgeIds)[0]);
    if (edge) return parseLineWeight(edge.line_weight);
  }

  if (selectedDecorationIds.size === 1) {
    const dec = decorations.find(d => d.id === Array.from(selectedDecorationIds)[0]);
    if (dec) return parseLineWeight(dec.line_weight);
  }

  return null;
}

/**
 * Clamp position value to valid range (0-9999)
 */
function clampPosition(value: number): number {
  return Math.max(0, Math.min(9999, Math.round(value)));
}

/**
 * Clamp size value to valid range (1-9999)
 */
function clampSize(value: number): number {
  return Math.max(1, Math.min(9999, Math.round(value)));
}

// =========================================
// Task Group 4 (A3): Condition Modal State Interface
// =========================================

/**
 * State for the decision flow condition modal
 */
interface ConditionModalState {
  /** Whether the modal is open */
  isOpen: boolean;
  /** The ID of the ActivityFlow entity being edited */
  flowId: string | null;
}

/**
 * Initial state for condition modal
 */
const initialConditionModalState: ConditionModalState = {
  isOpen: false,
  flowId: null,
};

// =========================================
// Spec 2026-01-02 Task Group 8: Initial UI Workflow Transition Mode
// =========================================

/**
 * Initial state for UI workflow transition creation mode
 */
const initialWorkflowTransitionMode: WorkflowTransitionCreationMode = createIdleWorkflowTransitionMode();

// =========================================
// Spec 2026-03-26: Temporary Diagram State
// Task Group 4, Task 4.2: Temporary diagram state management
// =========================================

/**
 * State for temporary diagram mode within DiagramsView.
 */
interface TemporaryDiagramState {
  /** Whether temporary diagram mode is active */
  active: boolean;
  /** The project UUID */
  projectId: string;
  /** The client/LLM-provided diagram identifier */
  temporaryDiagramId: string;
  /** The loaded temporary diagram data, or null if not yet loaded */
  data: TemporaryArchitectureDiagram | null;
  /** Whether the diagram is currently being fetched */
  loading: boolean;
  /** Error message if fetch or validation failed, or null */
  error: string | null;
  /** Spec 2026-03-27 Task 7.2: Mapping result from the deterministic auto-mapping engine, or null if not yet computed */
  mappingResult: DiagramMappingResult | null;
  /** Spec 2026-03-27 Increment 6 Task 4.2: Completed mapping from user confirmation, or null */
  completedDiagramMapping: CompletedDiagramMapping | null;
}

/** Default (inactive) state for temporary diagram mode */
const initialTemporaryDiagramState: TemporaryDiagramState = {
  active: false,
  projectId: '',
  temporaryDiagramId: '',
  data: null,
  loading: false,
  error: null,
  mappingResult: null,
  completedDiagramMapping: null,
};

export function DiagramsView() {
  const state = useArchitecture();
  const dispatch = useArchitectureDispatch();
  // Spec 2026-05-02 Multi-Architecture Selector + URL Routing -- Task Group 4
  // navigate replaces the SET_VIEW dispatch path for the journey/overview
  // review-close transitions and other view-switch effects in this view.
  const navigate = useNavigate();
  // Spec 2026-05-02 Multi-Architecture Selector + URL Routing -- Task Group 4
  // currentView is URL-derived (was state.currentView). DiagramsView is
  // only mounted on /.../diagrams so this is always 'diagrams' in
  // practice; declared early so the journey/overview callbacks below can
  // reference it without TDZ errors.
  const currentView = useCurrentViewHook();
  // Spec 2026-05-01 Multi-Architecture Plumbing -- Task Group 4
  const activeArchitectureId = useActiveArchitectureId();
  // Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 5
  // URL-derived selected diagram id. The URL is the source of truth;
  // an effect below syncs reducer `selectedDiagramId` from this value
  // so existing Canvas / palette / inspector consumers continue to read
  // from the reducer field unchanged.
  const urlSelectedDiagramId = useSelectedDiagramId();

  const { undo, canUndo } = useUndo();
  const [zoom, setZoom] = useState(appConfig.zoom.default);
  const [errorModalOpen, setErrorModalOpen] = useState(false);
  const [errorMessages, setErrorMessages] = useState<string[]>([]);
  const canvasContainerRef = useRef<HTMLDivElement>(null);

  // Selection state - lifted from Canvas for sharing with InspectorPanel
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<Set<string>>(new Set());
  // Task 1.6: Add decoration selection state
  const [selectedDecorationIds, setSelectedDecorationIds] = useState<Set<string>>(new Set());

  // Viewport center fix: Ref to Canvas scroll container for on-demand viewport queries
  const canvasScrollContainerRef = useRef<HTMLDivElement>(null);

  // Task Group 4: Bottom panel state (now empty, kept for future repurposing)
  const [isDecorationsPanelExpanded, setIsDecorationsPanelExpanded] = useState(false);
  // Task Group 3: Decoration add mode - used by left panel (InspectorPanel) and canvas
  const [decorationAddMode, setDecorationAddMode] = useState<DecorationAddMode>(null);

  // Sticky shape styles: remember the last-used colors and opacity for new shapes
  const [stickyShapeStyles, setStickyShapeStyles] = useState<{
    background_color?: string;
    line_color?: string;
    background_opacity?: number;
    border_opacity?: number;
  }>({});

  // Clipboard state for copy-paste of diagram elements
  const [clipboard, setClipboard] = useState<{
    nodes: DiagramNode[];
    edges: DiagramEdge[];
    decorations: Decoration[];
  } | null>(null);
  // Flag to distinguish paste-triggered additions from user-triggered additions
  const isPasteInProgressRef = useRef(false);

  // Task Group 4: Activity Flow creation mode state
  const [activityFlowCreationMode, setActivityFlowCreationMode] = useState<ActivityFlowCreationMode>(
    initialActivityFlowCreationMode
  );

  // Spec 2026-01-01 Task Group 4: State Transition creation mode state
  const [stateTransitionCreationMode, setStateTransitionCreationMode] = useState<TransitionCreationMode>(
    initialTransitionCreationMode
  );

  // Spec 2026-01-02 Task Group 8: UI Workflow Transition creation mode state
  const [workflowTransitionCreationMode, setWorkflowTransitionCreationMode] = useState<WorkflowTransitionCreationMode>(
    initialWorkflowTransitionMode
  );

  // Task Group 4 (A3): Decision flow condition modal state
  const [conditionModalState, setConditionModalState] = useState<ConditionModalState>(
    initialConditionModalState
  );

  // =========================================
  // Context Menu State (Task Groups 2-4)
  // =========================================
  const [elementContextMenu, setElementContextMenu] = useState<ElementContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    elementType: 'node',
    elementId: '',
    currentAutoSize: false,
  });

  // Add Link modal state
  const [addLinkModalState, setAddLinkModalState] = useState<{
    isOpen: boolean;
    elementType: ElementContextMenuType;
    elementId: string;
    currentLinkedDiagramId?: string;
  }>({ isOpen: false, elementType: 'node', elementId: '' });

  // Advanced Edit dialog state
  const [advancedEditDialogState, setAdvancedEditDialogState] = useState<{
    isOpen: boolean;
    rootEntity: { id: string; name: string; type: string } | null;
    nodeId: string;
    initialSelectedKeys: Set<string>;
  }>({ isOpen: false, rootEntity: null, nodeId: '', initialSelectedKeys: new Set() });

  // Task Group 2: Row 2 Font Size editing state
  const [fontSizeInputValue, setFontSizeInputValue] = useState<string>('');
  const [isEditingFontSize, setIsEditingFontSize] = useState(false);

  // Task Group 2: Position controls editing state
  const [posXInputValue, setPosXInputValue] = useState<string>('');
  const [posYInputValue, setPosYInputValue] = useState<string>('');
  const [widthInputValue, setWidthInputValue] = useState<string>('');
  const [heightInputValue, setHeightInputValue] = useState<string>('');
  const [isEditingPosX, setIsEditingPosX] = useState(false);
  const [isEditingPosY, setIsEditingPosY] = useState(false);
  const [isEditingWidth, setIsEditingWidth] = useState(false);
  const [isEditingHeight, setIsEditingHeight] = useState(false);
  const [strokeInputValue, setStrokeInputValue] = useState<string>('');
  const [isEditingStroke, setIsEditingStroke] = useState(false);

  // Refs for hidden colour inputs (Row 2)
  const backgroundColourRef = useRef<HTMLInputElement>(null);
  const lineColourRef = useRef<HTMLInputElement>(null);
  const textColourRef = useRef<HTMLInputElement>(null);

  // Spec: Export Diagrams as SVG - Export state
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // =========================================
  // Spec 2026-03-26: Temporary Diagram State and Hooks
  // Task Group 4: Temporary diagram mode state management
  // =========================================

  // Task 4.2: Temporary diagram state
  const [temporaryDiagramState, setTemporaryDiagramState] = useState<TemporaryDiagramState>(
    initialTemporaryDiagramState
  );

  // Spec 2026-03-27 Increment 6 Task 4.2: Mapping confirmation modal state and open-once guard
  const [showMappingConfirmationModal, setShowMappingConfirmationModal] = useState(false);
  const mappingResultHandledRef = useRef(false);

  // Spec 2026-03-27 Increment 7 Task 3.2: Toast state for finalization feedback
  const [toastState, setToastState] = useState<{ visible: boolean; message: string; type: ToastType }>({ visible: false, message: '', type: 'success' });
  const handleDismissToast = useCallback(() => setToastState(prev => ({ ...prev, visible: false })), []);

  // Task 4.7: Read the external activation context
  const {
    temporaryDiagramRequest,
    clearTemporaryDiagramRequest,
  } = useTemporaryDiagramContext();

  // Spec 2026-04-03: User Journey Review Context
  const journeyReview = useUserJourneyReviewContext();
  // Spec 2026-04-07: User Journey Overview Review Context
  const overviewReview = useUserJourneyOverviewReviewContext();
  // Spec 2026-04-07: State for "Generate Journey Overview" entry point
  const [showOverviewSelector, setShowOverviewSelector] = useState(false);
  const [overviewSelectedBusinessUserId, setOverviewSelectedBusinessUserId] = useState<string>('');
  const [overviewGenerating, setOverviewGenerating] = useState(false);
  // Spec 2026-04-07: Hoisted from below for use in overview generate handler
  const activeProject = useProject();
  // Spec 2026-04-03: User Journey Diagram Edit and Save Flow - modal state
  const [showSaveJourneyModal, setShowSaveJourneyModal] = useState(false);
  // Spec 2026-04-13: Save All Diagrams as PDF - progress tracking state (server-side, no longer needed)
  const pdfProgress = { generating: false, current: 0, total: 0 };
  // Task 4.7: Consume external activation requests from TemporaryDiagramContext
  // When a request comes in, activate temporary diagram mode and clear the request
  React.useEffect(() => {
    if (temporaryDiagramRequest) {
      setTemporaryDiagramState({
        active: true,
        projectId: temporaryDiagramRequest.projectId,
        temporaryDiagramId: temporaryDiagramRequest.temporaryDiagramId,
        data: null,
        loading: false,
        error: null,
        mappingResult: null,
        completedDiagramMapping: null,
      });
      // Spec 2026-03-27 Increment 6 Task 4.2: Reset modal state for new diagram
      mappingResultHandledRef.current = false;
      setShowMappingConfirmationModal(false);
      clearTemporaryDiagramRequest();
    }
  }, [temporaryDiagramRequest, clearTemporaryDiagramRequest]);

  // Task 4.3: Fetch temporary diagram when activated
  // Uses a ref to track fetch-in-progress to avoid the cleanup/cancelled race
  // condition that occurs when setTemporaryDiagramState(...loading: true) triggers
  // a re-render which re-runs the effect and its cleanup.
  const fetchInProgressRef = useRef(false);
  React.useEffect(() => {
    if (!temporaryDiagramState.active || temporaryDiagramState.data !== null || temporaryDiagramState.error !== null) {
      return;
    }
    if (fetchInProgressRef.current) {
      return;
    }
    // Spec 2026-05-01 Multi-Architecture Plumbing -- Task Group 4
    // Wait until activeArchitectureId resolves -- do NOT default.
    if (!activeArchitectureId) {
      return;
    }

    fetchInProgressRef.current = true;
    setTemporaryDiagramState(prev => ({ ...prev, loading: true }));

    // Spec 2026-05-01 Multi-Architecture Plumbing -- Task Group 4: thread architectureId through
    fetchTemporaryDiagram(temporaryDiagramState.projectId, activeArchitectureId!, temporaryDiagramState.temporaryDiagramId)
      .then(data => {
        fetchInProgressRef.current = false;
        // Spec 2026-03-27 Task 7.3: Compute mapping result after diagram data loads
        const mappingResult = state.model.metaModel
          ? mapTemporaryDiagram(data, state.model.metaModel)
          : null;
        setTemporaryDiagramState(prev => ({ ...prev, data, loading: false, mappingResult }));
      })
      .catch(err => {
        fetchInProgressRef.current = false;
        setTemporaryDiagramState(prev => ({
          ...prev,
          error: err instanceof Error ? err.message : String(err),
          loading: false,
        }));
      });
  }, [temporaryDiagramState.active, temporaryDiagramState.data, temporaryDiagramState.error, temporaryDiagramState.projectId, temporaryDiagramState.temporaryDiagramId, activeArchitectureId]);

  // Spec 2026-03-27 Increment 6 Task 4.3: Trigger mapping confirmation modal after mapping result is set
  React.useEffect(() => {
    const mappingResult = temporaryDiagramState.mappingResult;
    if (!mappingResult || mappingResultHandledRef.current) {
      return;
    }
    mappingResultHandledRef.current = true;
    if (mappingResult.overallStatus === 'partially_matched' || mappingResult.overallStatus === 'no_matches') {
      setShowMappingConfirmationModal(true);
    }
    // Spec 2026-03-27 Increment 7 Task 3.3: Auto-finalization for fully_matched diagrams
    else if (mappingResult.overallStatus === 'fully_matched' && temporaryDiagramState.data) {
      const derived = buildCompletedMappingFromFullMatch(mappingResult, temporaryDiagramState.data);
      setTemporaryDiagramState(prev => ({ ...prev, completedDiagramMapping: derived }));
    }
  }, [temporaryDiagramState.mappingResult]);

  // Task 4.5: Handler to close/exit temporary diagram mode
  const handleCloseTemporaryDiagram = useCallback(() => {
    fetchInProgressRef.current = false;
    setTemporaryDiagramState(initialTemporaryDiagramState);
    // Spec 2026-03-27 Increment 6 Task 4.2: Reset modal state on deactivation
    mappingResultHandledRef.current = false;
    setShowMappingConfirmationModal(false);
  }, []);

  // Spec 2026-03-27 Increment 7 Task 3.4: Shared finalization effect
  // Triggers when completedDiagramMapping becomes non-null (from fully_matched auto-trigger or post-modal confirmation)
  React.useEffect(() => {
    const completedMapping = temporaryDiagramState.completedDiagramMapping;
    if (!completedMapping || !temporaryDiagramState.data) {
      return;
    }
    try {
      // Persist any newly-created LogicalDataEntityRelationship entries before
      // the diagram references them. Generated when the user picked [NEW] in
      // the Mapping Confirmation modal.
      for (const newRel of completedMapping.newRelationships || []) {
        dispatch({
          type: 'ADD_RELATIONSHIP',
          relationshipType: 'logical_data_entity_relationships',
          relationship: {
            id: newRel.id,
            cardinality: newRel.cardinality,
            relationship: newRel.relationship,
            description: newRel.description,
            tags: newRel.tags,
            fromDataEntityPointId: newRel.fromDataEntityPointId,
            toDataEntityPointId: newRel.toDataEntityPointId,
          },
        });
      }
      const nativeDiagram = buildNativeDiagramFromMapping(completedMapping, temporaryDiagramState.data);
      dispatch({ type: 'ADD_DIAGRAM', payload: nativeDiagram });
      handleCloseTemporaryDiagram();
      setToastState({ visible: true, message: `Diagram '${nativeDiagram.name}' created successfully`, type: 'success' });
    } catch (err) {
      setToastState({ visible: true, message: `Failed to create diagram: ${err instanceof Error ? err.message : String(err)}`, type: 'error' });
      // Do NOT call handleCloseTemporaryDiagram -- keep temporary diagram intact for retry
    }
  }, [temporaryDiagramState.completedDiagramMapping, temporaryDiagramState.data, dispatch, handleCloseTemporaryDiagram]);

  // Spec 2026-04-03: User Journey Diagram Edit and Save Flow - save handler
  // Spec 2026-04-03: User Journey One-Way Sync from Meta-Model - v2 envelope with sync metadata
  const handleSaveJourneyDiagram = useCallback(async (name: string) => {
    try {
      if (journeyReview.selectedIndex === null) return;
      const currentJourney: UserJourneyDiagramDto = journeyReview.journeys[journeyReview.selectedIndex];

      // Build v2 content with sync metadata
      const contentWithSync = {
        ...(currentJourney as any),
        sync: {
          source_user_journey_id: currentJourney.journey.id,
          source_project_id: journeyReview.projectId,
          source_model_file_id: null,
          source_projection_version: '1.0',
          last_synced_at: new Date().toISOString(),
          last_synced_hash: '',
          sync_status: 'IN_SYNC',
          stale_reason: null,
        },
      };

      const newDiagram: Diagram = {
        id: generatePrefixedId('diag'),
        name,
        description: '',
        diagram_type: 'USER_JOURNEY',
        diagram_nodes: [],
        diagram_edges: [],
        typedContent: {
          type: 'USER_JOURNEY',
          version: 2,
          content: contentWithSync as any,
        },
      };

      dispatch({ type: 'ADD_DIAGRAM', payload: newDiagram });
      setShowSaveJourneyModal(false);

      const savedIndex = journeyReview.selectedIndex!;
      journeyReview.markJourneySaved(savedIndex);

      // Persist to backend
      if (state.loadedFileName) {
        // Spec 2026-05-11: architecture-scoped save requires active project + architecture
        if (!activeProject?.id || !activeArchitectureId) {
          setToastState({ visible: true, message: 'No active project or architecture. Open a project first.', type: 'error' });
          return;
        }
        const updatedModel = { ...state.model, diagrams: [...state.model.diagrams, newDiagram] };
        const result = await saveModelToBackend(updatedModel, state.loadedFileName, activeProject.id, activeArchitectureId, dispatch);
        if (!result.success) {
          setToastState({ visible: true, message: `Diagram saved locally but failed to persist: ${result.error || 'Validation errors'}`, type: 'error' });
          return;
        }
      }

      if (journeyReview.totalCount > 1) {
        // Return to chooser so user can save remaining diagrams
        journeyReview.returnToChooser();
        setToastState({ visible: true, message: `Diagram '${name}' saved. Select another journey or click Done.`, type: 'success' });
      } else {
        // Single journey — close review as before
        journeyReview.closeReviewSession();
        // Spec 2026-05-02 Multi-Architecture Selector + URL Routing -- Task Group 4
        // Stay on the canonical diagrams URL. We are already on it -- this
        // call is a no-op in practice but kept for parity with the old
        // SET_VIEW dispatch that restored the view explicitly.
        if (activeProject?.id && activeArchitectureId) {
          navigate(`/projects/${activeProject.id}/architectures/${activeArchitectureId}/diagrams`);
        }
        setToastState({ visible: true, message: `Diagram '${name}' saved successfully`, type: 'success' });
      }
    } catch (err) {
      setToastState({ visible: true, message: `Failed to save diagram: ${err instanceof Error ? err.message : String(err)}`, type: 'error' });
    }
  }, [journeyReview, state.model, state.loadedFileName, dispatch, setToastState, navigate, activeProject, activeArchitectureId]);

  // Spec 2026-04-07: User Journey Overview - save handler
  const handleSaveOverviewDiagram = useCallback(async () => {
    try {
      if (!overviewReview.overviewDiagram) return;
      const dto: UserJourneyOverviewDiagramDto = overviewReview.overviewDiagram;
      const overviewContent = {
        overview: dto.overview,
        lanes: dto.lanes,
        nodes: dto.nodes,
        edges: dto.edges,
        render_hints: dto.render_hints,
        diagram_type: dto.diagram_type,
        version: dto.version,
      };
      const newDiagram: Diagram = {
        id: generatePrefixedId('diag'),
        name: dto.overview?.title || 'Journey Overview',
        description: '',
        diagram_type: 'USER_JOURNEY_OVERVIEW',
        diagram_nodes: [],
        diagram_edges: [],
        typedContent: {
          type: 'USER_JOURNEY_OVERVIEW',
          version: 1,
          content: overviewContent as any,
        },
      };
      dispatch({ type: 'ADD_DIAGRAM', payload: newDiagram });
      overviewReview.markOverviewSaved();

      // Persist to backend
      if (state.loadedFileName) {
        // Spec 2026-05-11: architecture-scoped save requires active project + architecture
        if (!activeProject?.id || !activeArchitectureId) {
          setToastState({ visible: true, message: 'No active project or architecture. Open a project first.', type: 'error' });
          return;
        }
        const updatedModel = { ...state.model, diagrams: [...state.model.diagrams, newDiagram] };
        const result = await saveModelToBackend(updatedModel, state.loadedFileName, activeProject.id, activeArchitectureId, dispatch);
        if (!result.success) {
          setToastState({ visible: true, message: `Diagram saved locally but failed to persist: ${result.error || 'Validation errors'}`, type: 'error' });
          return;
        }
      }
      setToastState({ visible: true, message: `Diagram '${newDiagram.name}' saved successfully`, type: 'success' });
    } catch (err) {
      setToastState({ visible: true, message: `Failed to save overview diagram: ${err instanceof Error ? err.message : String(err)}`, type: 'error' });
    }
  }, [overviewReview, state.model, state.loadedFileName, dispatch, setToastState]);

  /**
   * Build a map of journey entity ID → saved diagram ID from all child journey
   * diagrams (both already-saved and about-to-be-saved). Used to patch overview
   * node link fields before saving overview diagrams.
   */
  const buildJourneyLinkMap = useCallback((): Map<string, { diagramId: string; diagramName: string }> => {
    const linkMap = new Map<string, { diagramId: string; diagramName: string }>();
    for (const diag of state.model.diagrams) {
      if (diag.diagram_type === 'USER_JOURNEY') {
        const content = diag.typedContent?.content as any;
        if (content?.journey?.id) {
          linkMap.set(content.journey.id, { diagramId: diag.id, diagramName: diag.name });
        }
      }
    }
    return linkMap;
  }, [state.model.diagrams]);

  /**
   * Patch overview nodes with link data from saved child journey diagrams.
   * Returns a new nodes array with link fields populated.
   */
  const patchOverviewNodesWithLinks = useCallback((
    nodes: UserJourneyOverviewNodeDto[],
    linkMap: Map<string, { diagramId: string; diagramName: string }>
  ): UserJourneyOverviewNodeDto[] => {
    return nodes.map(node => {
      const match = linkMap.get(node.id);
      if (match) {
        return {
          ...node,
          link: {
            linked_diagram_id: match.diagramId,
            linked_diagram_name: match.diagramName,
            link_status: 'LINKED' as const,
          },
        };
      }
      return node;
    });
  }, []);

  /**
   * Enrich overview diagram with application details, summary counts, and related colleagues.
   * Delegates to the enrichOverviewFull utility for consistent enrichment at all render sites.
   *
   * Spec 2026-04-10: User Journey Overview Diagram Enhancements
   * Task Group 3, Task 3.4: Apply enrichment in DiagramsView.tsx at all overview render sites
   */
  const enrichOverviewWithApps = useCallback((dto: UserJourneyOverviewDiagramDto): UserJourneyOverviewDiagramDto => {
    const meta: OverviewEnrichmentMetaData = {
      activitySteps: state.model?.metaModel?.entities?.activity_steps ?? [],
      applications: state.model?.metaModel?.entities?.applications ?? [],
      businessUserBusinessPoints: state.model?.metaModel?.relationships?.business_user_business_points ?? [],
      businessUsers: state.model?.metaModel?.entities?.business_users ?? [],
      userJourneys: state.model?.metaModel?.entities?.user_journeys ?? [],
    };
    const enriched = enrichOverviewFull(dto, meta);
    // Patch node links so preview mode can navigate to already-saved child diagrams
    const linkMap = buildJourneyLinkMap();
    if (linkMap.size > 0) {
      const patchedNodes = patchOverviewNodesWithLinks(enriched.nodes, linkMap);
      return { ...enriched, nodes: patchedNodes };
    }
    return enriched;
  }, [
    state.model?.metaModel?.entities?.activity_steps,
    state.model?.metaModel?.entities?.applications,
    state.model?.metaModel?.relationships?.business_user_business_points,
    state.model?.metaModel?.entities?.business_users,
    state.model?.metaModel?.entities?.user_journeys,
    buildJourneyLinkMap,
    patchOverviewNodesWithLinks,
  ]);

  // Save an overview diagram from within the journey review context
  const handleSaveOverviewFromReview = useCallback(async () => {
    try {
      if (!journeyReview.isOverview || journeyReview.selectedIndex === null) return;
      const dto = journeyReview.currentOverview;
      if (!dto) return;

      // Patch overview nodes with links to already-saved child journey diagrams
      const linkMap = buildJourneyLinkMap();
      const patchedNodes = patchOverviewNodesWithLinks(dto.nodes, linkMap);

      const overviewContent = {
        overview: dto.overview,
        lanes: dto.lanes,
        nodes: patchedNodes,
        edges: dto.edges,
        render_hints: dto.render_hints,
        diagram_type: dto.diagram_type,
        version: dto.version,
      };
      const newDiagram: Diagram = {
        id: generatePrefixedId('diag'),
        name: dto.overview?.title || 'Journey Overview',
        description: '',
        diagram_type: 'USER_JOURNEY_OVERVIEW',
        diagram_nodes: [],
        diagram_edges: [],
        typedContent: {
          type: 'USER_JOURNEY_OVERVIEW',
          version: 1,
          content: overviewContent as any,
        },
      };
      dispatch({ type: 'ADD_DIAGRAM', payload: newDiagram });
      journeyReview.markSaved(journeyReview.selectedIndex!);
      journeyReview.returnToChooser();

      // Persist to backend
      if (state.loadedFileName) {
        // Spec 2026-05-11: architecture-scoped save requires active project + architecture
        if (!activeProject?.id || !activeArchitectureId) {
          setToastState({ visible: true, message: 'No active project or architecture. Open a project first.', type: 'error' });
          return;
        }
        const updatedModel = { ...state.model, diagrams: [...state.model.diagrams, newDiagram] };
        const result = await saveModelToBackend(updatedModel, state.loadedFileName, activeProject.id, activeArchitectureId, dispatch);
        if (!result.success) {
          setToastState({ visible: true, message: `Diagram saved locally but failed to persist: ${result.error || 'Validation errors'}`, type: 'error' });
          return;
        }
      }
      setToastState({ visible: true, message: `Diagram '${newDiagram.name}' saved. Select another diagram or click Done.`, type: 'success' });
    } catch (err) {
      setToastState({ visible: true, message: `Failed to save overview diagram: ${err instanceof Error ? err.message : String(err)}`, type: 'error' });
    }
  }, [journeyReview, state.model, state.loadedFileName, dispatch, setToastState, buildJourneyLinkMap, patchOverviewNodesWithLinks, navigate, activeProject, activeArchitectureId]);

  // Save all unsaved diagrams (journeys + overviews) in one action, then close review
  const handleSaveAllDiagrams = useCallback(async () => {
    try {
      let savedCount = 0;
      const newDiagrams: Diagram[] = [];

      console.log(`[SaveAll] Starting: ${journeyReview.journeys.length} journeys, ${journeyReview.overviews.length} overviews, ${journeyReview.savedIndices.size} already saved`);

      // Phase 1: Save unsaved child journeys and collect entity→diagram ID mapping
      const linkMap = buildJourneyLinkMap();

      for (let i = 0; i < journeyReview.journeys.length; i++) {
        if (journeyReview.savedIndices.has(i)) continue;
        const currentJourney: UserJourneyDiagramDto = journeyReview.journeys[i];
        const contentWithSync = {
          ...(currentJourney as any),
          sync: {
            source_user_journey_id: currentJourney.journey.id,
            source_project_id: journeyReview.projectId,
            source_model_file_id: null,
            source_projection_version: '1.0',
            last_synced_at: new Date().toISOString(),
            last_synced_hash: '',
            sync_status: 'IN_SYNC',
            stale_reason: null,
          },
        };
        const newDiagram: Diagram = {
          id: generatePrefixedId('diag'),
          name: currentJourney.journey.name,
          description: '',
          diagram_type: 'USER_JOURNEY',
          diagram_nodes: [],
          diagram_edges: [],
          typedContent: {
            type: 'USER_JOURNEY',
            version: 2,
            content: contentWithSync as any,
          },
        };
        dispatch({ type: 'ADD_DIAGRAM', payload: newDiagram });
        newDiagrams.push(newDiagram);
        linkMap.set(currentJourney.journey.id, { diagramId: newDiagram.id, diagramName: newDiagram.name });
        savedCount++;
      }

      // Phase 2: Save unsaved overviews with patched node links
      for (let i = 0; i < journeyReview.overviews.length; i++) {
        const unifiedIndex = journeyReview.journeys.length + i;
        if (journeyReview.savedIndices.has(unifiedIndex)) continue;
        const dto = journeyReview.overviews[i];
        const patchedNodes = patchOverviewNodesWithLinks(dto.nodes, linkMap);
        const overviewContent = {
          overview: dto.overview,
          lanes: dto.lanes,
          nodes: patchedNodes,
          edges: dto.edges,
          render_hints: dto.render_hints,
          diagram_type: dto.diagram_type,
          version: dto.version,
        };
        const newDiagram: Diagram = {
          id: generatePrefixedId('diag'),
          name: dto.overview?.title || 'Journey Overview',
          description: '',
          diagram_type: 'USER_JOURNEY_OVERVIEW',
          diagram_nodes: [],
          diagram_edges: [],
          typedContent: {
            type: 'USER_JOURNEY_OVERVIEW',
            version: 1,
            content: overviewContent as any,
          },
        };
        dispatch({ type: 'ADD_DIAGRAM', payload: newDiagram });
        newDiagrams.push(newDiagram);
        savedCount++;
      }

      console.log(`[SaveAll] Collected ${newDiagrams.length} new diagrams (${newDiagrams.filter(d => d.diagram_type === 'USER_JOURNEY').length} journeys, ${newDiagrams.filter(d => d.diagram_type === 'USER_JOURNEY_OVERVIEW').length} overviews)`);

      // Close the review session and navigate back
      const prevView = journeyReview.previousView;
      journeyReview.closeReviewSession();
      // Spec 2026-05-02 Multi-Architecture Selector + URL Routing -- Task Group 4
                  if (prevView && activeProject?.id && activeArchitectureId) {
                    navigate(`/projects/${activeProject.id}/architectures/${activeArchitectureId}/${prevView}`);
                  }

      // Persist to backend
      if (state.loadedFileName && newDiagrams.length > 0) {
        // Spec 2026-05-11: architecture-scoped save requires active project + architecture
        if (!activeProject?.id || !activeArchitectureId) {
          setToastState({ visible: true, message: 'No active project or architecture. Open a project first.', type: 'error' });
          return;
        }
        const updatedModel = { ...state.model, diagrams: [...state.model.diagrams, ...newDiagrams] };
        console.log(`[SaveAll] Persisting ${updatedModel.diagrams.length} total diagrams to backend`);
        const result = await saveModelToBackend(updatedModel, state.loadedFileName, activeProject.id, activeArchitectureId, dispatch);
        if (!result.success) {
          setToastState({ visible: true, message: `${savedCount} diagram(s) saved locally but failed to persist: ${result.error || 'Validation errors'}`, type: 'error' });
          return;
        }
      }
      setToastState({ visible: true, message: `${savedCount} diagram${savedCount !== 1 ? 's' : ''} saved successfully`, type: 'success' });
    } catch (err) {
      setToastState({ visible: true, message: `Failed to save diagrams: ${err instanceof Error ? err.message : String(err)}`, type: 'error' });
    }
  }, [journeyReview, state.model, state.loadedFileName, dispatch, setToastState, buildJourneyLinkMap, patchOverviewNodesWithLinks, navigate, activeProject, activeArchitectureId]);

  // Spec 2026-04-13: Save All Diagrams as PDF (server-side) - save all diagrams first, then generate PDF
  const handleSaveAllAsPdf = useCallback(async () => {
    try {
      // Phase 1: Save all unsaved diagrams (reuse logic from handleSaveAllDiagrams but without closing review)
      let savedCount = 0;
      const newDiagrams: Diagram[] = [];

      const linkMap = buildJourneyLinkMap();

      // Save unsaved child journeys
      for (let i = 0; i < journeyReview.journeys.length; i++) {
        if (journeyReview.savedIndices.has(i)) continue;
        const currentJourney: UserJourneyDiagramDto = journeyReview.journeys[i];
        const contentWithSync = {
          ...(currentJourney as any),
          sync: {
            source_user_journey_id: currentJourney.journey.id,
            source_project_id: journeyReview.projectId,
            source_model_file_id: null,
            source_projection_version: '1.0',
            last_synced_at: new Date().toISOString(),
            last_synced_hash: '',
            sync_status: 'IN_SYNC',
            stale_reason: null,
          },
        };
        const newDiagram: Diagram = {
          id: generatePrefixedId('diag'),
          name: currentJourney.journey.name,
          description: '',
          diagram_type: 'USER_JOURNEY',
          diagram_nodes: [],
          diagram_edges: [],
          typedContent: {
            type: 'USER_JOURNEY',
            version: 2,
            content: contentWithSync as any,
          },
        };
        dispatch({ type: 'ADD_DIAGRAM', payload: newDiagram });
        newDiagrams.push(newDiagram);
        linkMap.set(currentJourney.journey.id, { diagramId: newDiagram.id, diagramName: newDiagram.name });
        savedCount++;
      }

      // Save unsaved overviews with patched node links
      for (let i = 0; i < journeyReview.overviews.length; i++) {
        const unifiedIndex = journeyReview.journeys.length + i;
        if (journeyReview.savedIndices.has(unifiedIndex)) continue;
        const dto = journeyReview.overviews[i];
        const patchedNodes = patchOverviewNodesWithLinks(dto.nodes, linkMap);
        const overviewContent = {
          overview: dto.overview,
          lanes: dto.lanes,
          nodes: patchedNodes,
          edges: dto.edges,
          render_hints: dto.render_hints,
          diagram_type: dto.diagram_type,
          version: dto.version,
        };
        const newDiagram: Diagram = {
          id: generatePrefixedId('diag'),
          name: dto.overview?.title || 'Journey Overview',
          description: '',
          diagram_type: 'USER_JOURNEY_OVERVIEW',
          diagram_nodes: [],
          diagram_edges: [],
          typedContent: {
            type: 'USER_JOURNEY_OVERVIEW',
            version: 1,
            content: overviewContent as any,
          },
        };
        dispatch({ type: 'ADD_DIAGRAM', payload: newDiagram });
        newDiagrams.push(newDiagram);
        savedCount++;
      }

      console.log(`[SaveAll+PDF] Saved ${newDiagrams.length} new diagrams, generating PDF via server...`);

      // Phase 2: Build server-side PDF request payload
      const allDiagrams = [...state.model.diagrams, ...newDiagrams];
      const metaModel = state.model.metaModel;
      const groups = groupDiagramsByBusinessUser(allDiagrams);

      // Build journey entity ID → diagram ID map for co-worker links
      const journeyDiagramMap: Record<string, string> = {};
      for (const d of allDiagrams) {
        if (d.diagram_type !== 'USER_JOURNEY') continue;
        const content = d.typedContent?.content as any;
        const entityId = content?.journey?.id;
        if (entityId) journeyDiagramMap[entityId] = d.id;
      }

      // Build enriched PDF groups
      const pdfGroups: PdfDiagramGroup[] = groups.map(group => ({
        businessUserName: group.businessUserName,
        diagrams: group.diagrams.map(de => {
          if (de.type === 'USER_JOURNEY') {
            const rawData = extractUserJourneyDiagram(de.diagram);
            if (!rawData) return { id: de.diagram.id, name: de.name, type: de.type, content: null };
            const enrichedData = enrichJourneySteps(
              rawData,
              metaModel?.entities?.process_activities ?? [],
              metaModel?.entities?.activity_steps ?? [],
              metaModel?.entities?.business_users ?? [],
            );

            // Compute nav links
            const journeyEntityId = rawData.journey?.id;
            let parentOverview: { id: string; name: string } | null = null;
            const linkedJourneys: { id: string; name: string }[] = [];

            // Find parent overview
            for (const d of allDiagrams) {
              if (d.diagram_type !== 'USER_JOURNEY_OVERVIEW') continue;
              const overviewContent = d.typedContent?.content as any;
              const nodes = overviewContent?.nodes ?? [];
              if (nodes.some((n: any) => n.id === journeyEntityId)) {
                parentOverview = { id: d.id, name: d.name };
                break;
              }
            }

            // Find linked journeys (from shared process activities)
            const steps = (rawData as any).steps ?? [];
            const paIds = new Set<string>(steps.map((s: any) => s.process_activity_id).filter(Boolean));
            const linkedEntityIds = new Set<string>();
            const allActivitySteps = metaModel?.entities?.activity_steps ?? [];
            for (const actStep of allActivitySteps) {
              if (paIds.has(actStep.process_activity_id) && actStep.user_journey_id !== journeyEntityId) {
                linkedEntityIds.add(actStep.user_journey_id);
              }
            }
            for (const d of allDiagrams) {
              if (d.diagram_type !== 'USER_JOURNEY' || d.id === de.diagram.id) continue;
              const content = d.typedContent?.content as any;
              const entityId = content?.journey?.id;
              if (entityId && linkedEntityIds.has(entityId)) {
                linkedJourneys.push({ id: d.id, name: d.name });
              }
            }

            return {
              id: de.diagram.id,
              name: de.name,
              type: de.type,
              content: enrichedData,
              navLinks: { parentOverview, linkedJourneys, coWorkerDiagramMap: journeyDiagramMap },
            };
          } else {
            // USER_JOURNEY_OVERVIEW
            const rawData = extractUserJourneyOverviewDiagram(de.diagram);
            if (!rawData) return { id: de.diagram.id, name: de.name, type: de.type, content: null };
            const enrichMeta: OverviewEnrichmentMetaData = {
              activitySteps: metaModel?.entities?.activity_steps ?? [],
              applications: metaModel?.entities?.applications ?? [],
              businessUserBusinessPoints: metaModel?.relationships?.business_user_business_points ?? [],
              businessUsers: metaModel?.entities?.business_users ?? [],
              userJourneys: metaModel?.entities?.user_journeys ?? [],
            };
            const enrichedData = enrichOverviewFull(rawData, enrichMeta);
            return { id: de.diagram.id, name: de.name, type: de.type, content: enrichedData };
          }
        }).filter(d => d.content !== null),
      })).filter(g => g.diagrams.length > 0);

      // Phase 3: Generate PDF on the server
      const pdfResult = await generatePdfOnServer({
        projectId: journeyReview.projectId,
        projectName: state.loadedFileName || 'User Journey Diagrams',
        groups: pdfGroups,
      });

      // Phase 4: Close review session and navigate back
      const prevView = journeyReview.previousView;
      journeyReview.closeReviewSession();
      // Spec 2026-05-02 Multi-Architecture Selector + URL Routing -- Task Group 4
                  if (prevView && activeProject?.id && activeArchitectureId) {
                    navigate(`/projects/${activeProject.id}/architectures/${activeArchitectureId}/${prevView}`);
                  }

      // Phase 5: Persist to backend
      if (state.loadedFileName && newDiagrams.length > 0) {
        // Spec 2026-05-11: architecture-scoped save requires active project + architecture
        if (!activeProject?.id || !activeArchitectureId) {
          setToastState({ visible: true, message: 'No active project or architecture. Open a project first.', type: 'error' });
          return;
        }
        const updatedModel = { ...state.model, diagrams: [...state.model.diagrams, ...newDiagrams] };
        const result = await saveModelToBackend(updatedModel, state.loadedFileName, activeProject.id, activeArchitectureId, dispatch);
        if (!result.success) {
          setToastState({ visible: true, message: `${savedCount} diagram(s) saved locally but failed to persist: ${result.error || 'Validation errors'}`, type: 'error' });
          return;
        }
      }

      // Phase 6: Show result
      if (!pdfResult.success) {
        setToastState({ visible: true, message: pdfResult.error || 'No diagrams found for PDF export.', type: 'error' });
      } else {
        const pathMsg = pdfResult.filePath ? ` Saved to: ${pdfResult.filePath}` : '';
        setToastState({ visible: true, message: `${savedCount} diagram${savedCount !== 1 ? 's' : ''} saved and PDF exported successfully.${pathMsg}`, type: 'success' });
      }
    } catch (err) {
      setToastState({ visible: true, message: `Failed to save diagrams & export PDF: ${err instanceof Error ? err.message : String(err)}`, type: 'error' });
    }
  }, [journeyReview, state.model, state.loadedFileName, dispatch, setToastState, buildJourneyLinkMap, patchOverviewNodesWithLinks, navigate, activeProject, activeArchitectureId]);

  // Spec 2026-04-07: User Journey Overview - generate handler
  const handleGenerateOverview = useCallback(async (projectId: string, businessUserId: string) => {
    if (!projectId || !businessUserId) return;
    // Spec 2026-05-01 Multi-Architecture Plumbing -- Task Group 4: require architectureId
    if (!activeArchitectureId) return;
    setOverviewGenerating(true);
    try {
      const dto = await fetchTemporaryUserJourneyOverviewDiagram(projectId, activeArchitectureId, businessUserId);
      overviewReview.activateOverviewReview(projectId, dto, currentView);
      setShowOverviewSelector(false);
      setOverviewSelectedBusinessUserId('');
    } catch (err) {
      setToastState({ visible: true, message: `Failed to generate overview: ${err instanceof Error ? err.message : String(err)}`, type: 'error' });
    } finally {
      setOverviewGenerating(false);
    }
  }, [overviewReview, currentView, activeArchitectureId, setToastState]);

  // Spec 2026-04-10: User Journey Overview Diagram Enhancements
  // Task Group 4, Task 4.8: Colleague click handler for overview navigation
  const handleColleagueClick = useCallback(async (businessUserId: string) => {
    const projectId = journeyReview.active ? journeyReview.projectId
      : overviewReview.active ? overviewReview.projectId
      : activeProject?.id;
    if (!projectId) return;
    // Spec 2026-05-01 Multi-Architecture Plumbing -- Task Group 4: require architectureId
    if (!activeArchitectureId) return;
    try {
      const dto = await fetchTemporaryUserJourneyOverviewDiagram(projectId, activeArchitectureId, businessUserId);
      // If currently in journeyReview, close it and switch to standalone overview review
      if (journeyReview.active) {
        journeyReview.closeReviewSession();
      }
      overviewReview.activateOverviewReview(projectId, dto, currentView);
    } catch (err) {
      setToastState({ visible: true, message: `Failed to load colleague overview: ${err instanceof Error ? err.message : String(err)}`, type: 'error' });
    }
  }, [journeyReview, overviewReview, activeProject, activeArchitectureId, currentView, setToastState]);


  const { selectedDiagramId, isPalettePanelCollapsed, isInspectorPanelCollapsed, paletteSearchQuery, sectionExpandStates } = state;
  const diagram = state.model.diagrams.find((d) => d.id === selectedDiagramId);

  // Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 5
  // URL -> reducer sync. Keeps `state.selectedDiagramId` in step with the
  // URL on mount and on every URL change. Existing Canvas / palette /
  // inspector consumers continue to read from the reducer field; the URL
  // is the source of truth and the dispatch is a no-op when the reducer
  // already matches. The bare `/.../diagrams` URL (no `:diagramId`) maps
  // to `urlSelectedDiagramId === null`, which clears the reducer so the
  // 'Select a diagram to view' empty state renders. Per spec, an unknown
  // `:diagramId` does NOT redirect -- the dispatch still runs, the canvas
  // shows an empty state, and the URL is preserved so the user can see
  // what they navigated to.
  React.useEffect(() => {
    if (selectedDiagramId !== urlSelectedDiagramId) {
      dispatch({ type: 'SELECT_DIAGRAM', payload: urlSelectedDiagramId });
    }
  }, [urlSelectedDiagramId, selectedDiagramId, dispatch]);

  // Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 5
  // Imperative navigation helper used by the diagram-selection UI
  // (DiagramSelector autocomplete, journey/overview link clicks, etc.)
  // to swap the URL to `/.../diagrams/<id>` (or back to the bare list
  // URL when called with null). The URL change re-runs the sync effect
  // above and updates the reducer. Falls back to a dispatch when the
  // architecture id has not yet hydrated (rare; preserves pre-routing
  // behaviour during the initial-mount window).
  const navigateToDiagram = React.useCallback((diagramId: string | null) => {
    if (activeProject?.id && activeArchitectureId) {
      const base = `/projects/${activeProject.id}/architectures/${activeArchitectureId}/diagrams`;
      navigate(diagramId ? `${base}/${diagramId}` : base);
    } else if (diagramId !== null) {
      // Hydration window fallback: dispatch directly so the user does
      // not lose their click. The next sync tick will re-align the URL.
      dispatch({ type: 'SELECT_DIAGRAM', payload: diagramId });
    }
  }, [navigate, activeProject?.id, activeArchitectureId, dispatch]);

  // Spec 2026-04-03: User Journey One-Way Sync from Meta-Model - sync status hook
  // Spec 2026-05-01 Multi-Architecture Plumbing -- Task Group 4: thread architectureId
  const syncStatusHook = useUserJourneySyncStatus(
    activeProject?.id,
    activeArchitectureId ?? undefined,
    diagram?.id,
    diagram?.typedContent
  );

  // Spec 2026-04-03: Handle sync refresh completion
  const handleSyncRefresh = React.useCallback(async () => {
    const updatedDiagram = await syncStatusHook.refresh();
    if (updatedDiagram && diagram) {
      // Update the diagram's typedContent in state
      const newTypedContent = (updatedDiagram as any).typed_content || (updatedDiagram as any).typedContent || diagram.typedContent;
      dispatch({
        type: 'UPDATE_DIAGRAM',
        diagramId: diagram.id,
        updates: { typedContent: newTypedContent },
      });
      setToastState({ visible: true, message: 'Diagram refreshed from model', type: 'success' });
    }
  }, [syncStatusHook, diagram, dispatch, setToastState]);

  // Get nodes, edges, decorations for Row 2 styling controls
  const nodes = diagram?.diagram_nodes || [];
  const edges = diagram?.diagram_edges || [];
  const decorations = diagram?.decorations || [];

  // Compute navigation props for child journey diagrams (parent overview + linked journeys)
  const journeyNavProps = useMemo(() => {
    if (!diagram || diagram.diagram_type !== 'USER_JOURNEY') return { parentOverview: null, linkedJourneys: [] as JourneyNavLink[] };

    // Extract journey entity ID from typedContent
    const journeyContent = diagram.typedContent?.content as any;
    const journeyEntityId = journeyContent?.journey?.id;
    if (!journeyEntityId) return { parentOverview: null, linkedJourneys: [] as JourneyNavLink[] };

    // Find parent overview: look for USER_JOURNEY_OVERVIEW diagrams that have a node
    // referencing this journey (by matching journey entity IDs in nodes)
    let parentOverview: JourneyNavLink | null = null;
    for (const d of state.model.diagrams) {
      if (d.diagram_type !== 'USER_JOURNEY_OVERVIEW') continue;
      const overviewContent = d.typedContent?.content as any;
      const overviewNodes = overviewContent?.nodes ?? [];
      const hasThisJourney = overviewNodes.some((n: any) => n.id === journeyEntityId);
      if (hasThisJourney) {
        parentOverview = { id: d.id, name: d.name };
        break;
      }
    }

    // Find linked journeys: use explicit user_journey_links from meta model
    const links = state.model?.metaModel?.relationships?.user_journey_links ?? [];
    const linkedJourneyEntityIds = new Set<string>();
    for (const link of links) {
      if (link.source_user_journey_id === journeyEntityId) {
        linkedJourneyEntityIds.add(link.target_user_journey_id);
      }
      if (link.target_user_journey_id === journeyEntityId) {
        linkedJourneyEntityIds.add(link.source_user_journey_id);
      }
    }

    // Also derive linked journeys from shared process activities (co-workers):
    // If any step in this journey shares a process_activity_id with activity steps
    // belonging to other user journeys, those journeys are implicitly linked.
    const diagramSteps = journeyContent?.steps ?? [];
    const currentProcessActivityIds = new Set<string>(
      diagramSteps.map((s: any) => s.process_activity_id).filter(Boolean)
    );
    const allActivitySteps = state.model?.metaModel?.entities?.activity_steps ?? [];
    for (const as of allActivitySteps) {
      if (currentProcessActivityIds.has(as.process_activity_id) && as.user_journey_id !== journeyEntityId) {
        linkedJourneyEntityIds.add(as.user_journey_id);
      }
    }

    // Map linked journey entity IDs to saved diagram IDs
    const linkedJourneys: JourneyNavLink[] = [];
    for (const d of state.model.diagrams) {
      if (d.diagram_type !== 'USER_JOURNEY' || d.id === diagram.id) continue;
      const content = d.typedContent?.content as any;
      const entityId = content?.journey?.id;
      if (entityId && linkedJourneyEntityIds.has(entityId)) {
        linkedJourneys.push({ id: d.id, name: d.name });
      }
    }

    return { parentOverview, linkedJourneys };
  }, [diagram, state.model.diagrams, state.model?.metaModel?.relationships?.user_journey_links, state.model?.metaModel?.entities?.activity_steps]);

  // Map from user journey entity ID → saved diagram ID (for co-worker link navigation)
  const journeyDiagramMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of state.model.diagrams) {
      if (d.diagram_type !== 'USER_JOURNEY') continue;
      const content = d.typedContent?.content as any;
      const entityId = content?.journey?.id;
      if (entityId) map.set(entityId, d.id);
    }
    return map;
  }, [state.model.diagrams]);

  // Click handler for navigating to parent overview diagram
  // Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 5:
  // navigate to the URL; the sync effect updates the reducer.
  const handleParentOverviewClick = useCallback((diagramId: string) => {
    navigateToDiagram(diagramId);
  }, [navigateToDiagram]);

  // Click handler for navigating to a linked journey diagram
  const handleLinkedJourneyClick = useCallback((diagramId: string) => {
    navigateToDiagram(diagramId);
  }, [navigateToDiagram]);

  // Click handler for navigating to a co-worker's journey diagram
  const handleCoWorkerClick = useCallback((diagramId: string) => {
    navigateToDiagram(diagramId);
  }, [navigateToDiagram]);

  // Clear selection when diagram changes (including decorations)
  // Task Group 4: Also reset activity flow creation mode and condition modal
  // Spec 2026-01-02 Task Group 8: Also reset workflow transition creation mode
  React.useEffect(() => {
    setSelectedNodeIds(new Set());
    setSelectedEdgeIds(new Set());
    setSelectedDecorationIds(new Set());
    // Task Group 4: Reset activity flow creation mode on diagram change
    setActivityFlowCreationMode(initialActivityFlowCreationMode);
    // Spec 2026-01-01 Task Group 4: Reset state transition creation mode on diagram change
    setStateTransitionCreationMode(initialTransitionCreationMode);
    // Spec 2026-01-02 Task Group 8: Reset workflow transition creation mode on diagram change
    setWorkflowTransitionCreationMode(initialWorkflowTransitionMode);
    // Task Group 4 (A3): Close condition modal on diagram change
    setConditionModalState(initialConditionModalState);
    // Close context menu and modals on diagram change
    setElementContextMenu(prev => ({ ...prev, visible: false }));
    setAddLinkModalState(prev => ({ ...prev, isOpen: false }));
    setAdvancedEditDialogState({ isOpen: false, rootEntity: null, nodeId: '', initialSelectedKeys: new Set() });
  }, [selectedDiagramId]);

  // Update sticky shape styles when a single shape decoration is selected
  React.useEffect(() => {
    if (selectedDecorationIds.size !== 1) return;
    const selectedId = Array.from(selectedDecorationIds)[0];
    const deco = decorations.find(d => d.id === selectedId);
    if (!deco || !SHAPE_DECORATION_TYPES.includes(deco.type as ShapeDecorationType)) return;
    const shape = deco as ShapeDecoration;
    // Don't pick up TEXT's zero-opacity or NOTE's post-it defaults as sticky styles
    if (shape.type === 'TEXT' || shape.type === 'NOTE') return;
    setStickyShapeStyles({
      background_color: shape.background_color,
      line_color: shape.line_color,
      background_opacity: shape.background_opacity,
      border_opacity: shape.border_opacity,
    });
  }, [selectedDecorationIds, decorations]);

  // Validate diagram nodes when diagram is selected
  React.useEffect(() => {
    if (selectedDiagramId) {
      try {
        const errors = validateDiagramNodes(selectedDiagramId, state.model);
        if (errors.length > 0) {
          setErrorMessages(errors);
          setErrorModalOpen(true);
        }
      } catch (err) {
        console.error('Error validating diagram nodes:', err);
      }
    }
  }, [selectedDiagramId, state.model]);

  // =========================================
  // Spec 2026-01-02 Task Group 8: Escape key handler for creation modes
  // =========================================
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Cancel workflow transition creation mode
        if (workflowTransitionCreationMode.step !== 'idle') {
          setWorkflowTransitionCreationMode(initialWorkflowTransitionMode);
          e.preventDefault();
          return;
        }
        // Cancel activity flow creation mode
        if (activityFlowCreationMode.active) {
          setActivityFlowCreationMode(initialActivityFlowCreationMode);
          e.preventDefault();
          return;
        }
        // Cancel state transition creation mode
        if (stateTransitionCreationMode.active) {
          setStateTransitionCreationMode(initialTransitionCreationMode);
          e.preventDefault();
          return;
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [workflowTransitionCreationMode, activityFlowCreationMode, stateTransitionCreationMode]);

  // =========================================
  // Task Group 4 (A3): Helper to get Activity entity from metaModel
  // =========================================

  /**
   * Get Activity entity by ID from the metaModel
   */
  const getActivityById = useCallback((activityId: string): Activity | null => {
    const activities = state.model.metaModel?.entities?.activities || [];
    return activities.find((a: Activity) => a.id === activityId) || null;
  }, [state.model.metaModel]);

  /**
   * Get ActivityFlow entity by ID from the metaModel
   */
  const getActivityFlowById = useCallback((flowId: string): ActivityFlow | null => {
    const flows = state.model.metaModel?.entities?.activity_flows || [];
    return flows.find((f: ActivityFlow) => f.id === flowId) || null;
  }, [state.model.metaModel]);

  // Selection callback handlers
  // Task Group 4: Handler for activity flow creation from node clicks
  // Task Group 4 (A3): Updated to check for Decision source and open condition modal
  const handleActivityFlowNodeClick = useCallback((nodeId: string) => {
    if (!activityFlowCreationMode.active || !diagram || !selectedDiagramId) {
      return false; // Not in activity flow mode, let normal selection proceed
    }

    // Find the clicked node
    const clickedNode = nodes.find(n => n.id === nodeId);
    if (!clickedNode) {
      return false;
    }

    // Only handle ACTIVITY nodes (ignore ACTIVITY_PARTITION etc.)
    if (clickedNode.entity_type !== 'ACTIVITY') {
      return false; // Ignore non-Activity nodes
    }

    // If no source selected, set this as source
    if (activityFlowCreationMode.sourceActivityNodeId === null) {
      const newMode = setActivityFlowSourceNode(activityFlowCreationMode, nodeId);
      setActivityFlowCreationMode(newMode);
      return true; // Handled, don't do normal selection
    }

    // Source already selected - this is the target
    const sourceNodeId = activityFlowCreationMode.sourceActivityNodeId;
    const targetNodeId = nodeId;

    // Prevent self-loops
    if (sourceNodeId === targetNodeId) {
      return true; // Handled (rejected), don't do normal selection
    }

    // Get source and target nodes
    const sourceNode = nodes.find(n => n.id === sourceNodeId);
    const targetNode = clickedNode;

    if (!sourceNode || !targetNode) {
      return true; // Nodes not found, reject
    }

    // Create the activity flow entity
    const flow = createActivityFlowEntity(
      sourceNode.entity_id,
      targetNode.entity_id
    );

    // Dispatch ADD_ENTITY action for the flow
    dispatch({
      type: 'ADD_ENTITY',
      entityType: 'activity_flows',
      entity: flow,
    });

    // Create the diagram edge
    const edge = createActivityFlowDiagramEdge(
      flow.id,
      sourceNodeId,
      targetNodeId,
      sourceNode,
      targetNode
    );

    // Dispatch ADD_DIAGRAM_EDGE action
    dispatch({
      type: 'ADD_DIAGRAM_EDGE',
      payload: {
        diagramId: selectedDiagramId,
        edge,
      },
    });

    // Task Group 4 (A3): Check if source activity is Decision type
    // If Decision, open condition modal; otherwise just exit creation mode
    const sourceActivity = getActivityById(sourceNode.entity_id);
    if (isDecisionActivityKind(sourceActivity?.activity_kind)) {
      // Open condition modal for Decision source
      setConditionModalState({
        isOpen: true,
        flowId: flow.id,
      });
    }

    // Exit activity flow creation mode
    setActivityFlowCreationMode(exitActivityFlowCreationMode());

    return true; // Handled
  }, [activityFlowCreationMode, diagram, selectedDiagramId, nodes, dispatch, getActivityById]);

  // =========================================
  // Spec 2026-01-01 Task Group 4: State Transition Node Click Handler
  // =========================================

  /**
   * Handle node clicks when in state transition creation mode.
   * Similar pattern to handleActivityFlowNodeClick.
   *
   * @param nodeId - The ID of the clicked node
   * @returns true if the click was handled, false otherwise
   */
  const handleStateTransitionNodeClick = useCallback((nodeId: string): boolean => {
    if (!stateTransitionCreationMode.active || !diagram || !selectedDiagramId) {
      return false; // Not in state transition mode, let normal selection proceed
    }

    // Find the clicked node
    const clickedNode = nodes.find(n => n.id === nodeId);
    if (!clickedNode) {
      return false;
    }

    // Only handle STATE nodes (ignore other entity types)
    if (clickedNode.entity_type !== 'STATE') {
      return true; // Ignore non-STATE nodes but consider click handled
    }

    // If no source selected, set this as source
    if (stateTransitionCreationMode.sourceStateNodeId === null) {
      const newMode = setTransitionSourceState(stateTransitionCreationMode, nodeId);
      setStateTransitionCreationMode(newMode);
      return true; // Handled, don't do normal selection
    }

    // Source already selected - this is the target
    const sourceNodeId = stateTransitionCreationMode.sourceStateNodeId;
    const targetNodeId = nodeId;

    // Prevent self-loops
    if (sourceNodeId === targetNodeId) {
      return true; // Handled (rejected), don't do normal selection
    }

    // Get source and target nodes
    const sourceNode = nodes.find(n => n.id === sourceNodeId);
    const targetNode = clickedNode;

    if (!sourceNode || !targetNode) {
      return true; // Nodes not found, reject
    }

    // Create the state transition entity
    const transition = createStateTransitionEntity(
      sourceNode.entity_id,
      targetNode.entity_id
    );

    // Dispatch ADD_ENTITY action for the transition
    dispatch({
      type: 'ADD_ENTITY',
      entityType: 'state_transitions',
      entity: transition,
    });

    // Lookup State entities for shape-aware boundary calculation
    const sourceState = state.model.metaModel?.entities?.states?.find(
      (s: { id: string }) => s.id === sourceNode.entity_id
    );
    const targetState = state.model.metaModel?.entities?.states?.find(
      (s: { id: string }) => s.id === targetNode.entity_id
    );

    // Create the diagram edge with boundary-positioned edge_points
    const edge = createTransitionDiagramEdge(
      transition.id,
      sourceNodeId,
      targetNodeId,
      sourceNode,
      targetNode,
      sourceState,
      targetState
    );

    // Dispatch ADD_DIAGRAM_EDGE action
    dispatch({
      type: 'ADD_DIAGRAM_EDGE',
      payload: {
        diagramId: selectedDiagramId,
        edge,
      },
    });

    // Exit state transition creation mode
    setStateTransitionCreationMode(exitTransitionCreationMode());

    return true; // Handled
  }, [stateTransitionCreationMode, diagram, selectedDiagramId, nodes, dispatch]);

  // =========================================
  // Spec 2026-01-02 Task Group 8: UI Workflow Transition Node Click Handler
  // =========================================

  /**
   * Handle node clicks when in UI workflow transition creation mode.
   * Similar pattern to handleStateTransitionNodeClick.
   *
   * @param nodeId - The ID of the clicked node
   * @returns true if the click was handled, false otherwise
   */
  const handleWorkflowTransitionNodeClick = useCallback((nodeId: string): boolean => {
    // Only handle if in active creation mode (not 'idle')
    if (workflowTransitionCreationMode.step === 'idle' || !diagram || !selectedDiagramId) {
      return false; // Not in workflow transition mode, let normal selection proceed
    }

    // Find the clicked node
    const clickedNode = nodes.find(n => n.id === nodeId);
    if (!clickedNode) {
      return false;
    }

    // Only handle UI_SCREEN nodes
    if (!isValidUIScreenNode(clickedNode)) {
      return true; // Ignore non-UI_SCREEN nodes but consider click handled
    }

    // Step 1: Selecting source
    if (workflowTransitionCreationMode.step === 'selecting-source') {
      const newMode = advanceToTargetSelection(
        workflowTransitionCreationMode,
        nodeId,
        clickedNode.entity_id
      );
      setWorkflowTransitionCreationMode(newMode);
      return true; // Handled, don't do normal selection
    }

    // Step 2: Selecting target
    if (workflowTransitionCreationMode.step === 'selecting-target') {
      const sourceNodeId = workflowTransitionCreationMode.sourceNodeId;
      const sourceScreenId = workflowTransitionCreationMode.sourceScreenId;
      const targetNodeId = nodeId;
      const targetScreenId = clickedNode.entity_id;

      // Prevent self-loops
      if (sourceNodeId === targetNodeId) {
        return true; // Handled (rejected), don't do normal selection
      }

      // Validate source node ID and screen ID exist
      if (!sourceNodeId || !sourceScreenId) {
        console.error('Source node ID or screen ID missing');
        setWorkflowTransitionCreationMode(initialWorkflowTransitionMode);
        return true;
      }

      // Get source and target nodes
      const sourceNode = nodes.find(n => n.id === sourceNodeId);
      const targetNode = clickedNode;

      if (!sourceNode || !targetNode) {
        console.error('Source or target node not found');
        setWorkflowTransitionCreationMode(initialWorkflowTransitionMode);
        return true; // Nodes not found, reject
      }

      // Create the UI workflow transition entity
      const transition = createUIWorkflowTransition(sourceScreenId, targetScreenId);

      // Dispatch ADD_RELATIONSHIP action for the transition
      dispatch({
        type: 'ADD_RELATIONSHIP',
        relationshipType: 'ui_workflow_transitions',
        relationship: transition,
      });

      // Create the diagram edge
      const edge = createUIWorkflowTransitionEdge(
        transition,
        sourceNodeId,
        targetNodeId,
        sourceNode,
        targetNode
      );

      // Dispatch ADD_DIAGRAM_EDGE action
      dispatch({
        type: 'ADD_DIAGRAM_EDGE',
        payload: {
          diagramId: selectedDiagramId,
          edge,
        },
      });

      // Exit workflow transition creation mode
      setWorkflowTransitionCreationMode(initialWorkflowTransitionMode);

      return true; // Handled
    }

    return false;
  }, [workflowTransitionCreationMode, diagram, selectedDiagramId, nodes, dispatch]);

  // =========================================
  // Task Group 4 (A3): Condition Modal Handlers
  // =========================================

  /**
   * Handle Save from condition modal - updates the ActivityFlow entity
   */
  const handleConditionModalSave = useCallback((updates: Partial<ActivityFlow>) => {
    if (!conditionModalState.flowId) return;

    // Dispatch UPDATE_ENTITY action to update the ActivityFlow
    const currentFlow = getActivityFlowById(conditionModalState.flowId);
    if (currentFlow) {
      dispatch({
        type: 'UPDATE_ENTITY',
        entityType: 'activity_flows',
        entity: {
          ...currentFlow,
          ...updates,
        },
      });
    }

    // Close the modal
    setConditionModalState(initialConditionModalState);
  }, [conditionModalState.flowId, getActivityFlowById, dispatch]);

  /**
   * Handle Skip from condition modal - closes without changes
   */
  const handleConditionModalSkip = useCallback(() => {
    setConditionModalState(initialConditionModalState);
  }, []);

  const handleNodeSelect = useCallback((nodeId: string, isMultiSelect: boolean) => {
    // Task Group 4: Intercept node clicks when in activity flow creation mode
    if (activityFlowCreationMode.active) {
      const handled = handleActivityFlowNodeClick(nodeId);
      if (handled) {
        return; // Activity flow mode handled this click
      }
    }

    // Spec 2026-01-01 Task Group 4: Intercept node clicks when in state transition creation mode
    if (stateTransitionCreationMode.active) {
      const handled = handleStateTransitionNodeClick(nodeId);
      if (handled) {
        return; // State transition mode handled this click
      }
    }

    // Spec 2026-01-02 Task Group 8: Intercept node clicks when in workflow transition creation mode
    if (workflowTransitionCreationMode.step !== 'idle') {
      const handled = handleWorkflowTransitionNodeClick(nodeId);
      if (handled) {
        return; // Workflow transition mode handled this click
      }
    }

    if (isMultiSelect) {
      // Toggle logic: add if not present, remove if present
      setSelectedNodeIds((prev) => {
        const newSet = new Set(prev);
        if (newSet.has(nodeId)) {
          newSet.delete(nodeId);
        } else {
          newSet.add(nodeId);
        }
        return newSet;
      });
    } else {
      // Single-select: clear all, then add single item
      setSelectedNodeIds(new Set([nodeId]));
      setSelectedEdgeIds(new Set());
      setSelectedDecorationIds(new Set());
    }
  }, [activityFlowCreationMode.active, handleActivityFlowNodeClick, stateTransitionCreationMode.active, handleStateTransitionNodeClick, workflowTransitionCreationMode.step, handleWorkflowTransitionNodeClick]);

  const handleEdgeSelect = useCallback((edgeId: string, isMultiSelect: boolean) => {
    if (isMultiSelect) {
      // Toggle logic: add if not present, remove if present
      setSelectedEdgeIds((prev) => {
        const newSet = new Set(prev);
        if (newSet.has(edgeId)) {
          newSet.delete(edgeId);
        } else {
          newSet.add(edgeId);
        }
        return newSet;
      });
    } else {
      // Single-select: clear all, then add single item
      setSelectedNodeIds(new Set());
      setSelectedEdgeIds(new Set([edgeId]));
      setSelectedDecorationIds(new Set());
    }
  }, []);

  // Task 1.6: Decoration selection handler
  const handleDecorationSelect = useCallback((decorationId: string, isMultiSelect: boolean) => {
    if (isMultiSelect) {
      // Toggle logic: add if not present, remove if present
      setSelectedDecorationIds((prev) => {
        const newSet = new Set(prev);
        if (newSet.has(decorationId)) {
          newSet.delete(decorationId);
        } else {
          newSet.add(decorationId);
        }
        return newSet;
      });
    } else {
      // Single-select: clear all, then add single item
      setSelectedNodeIds(new Set());
      setSelectedEdgeIds(new Set());
      setSelectedDecorationIds(new Set([decorationId]));
    }
  }, []);

  const handleClearSelection = useCallback(() => {
    setSelectedNodeIds(new Set());
    setSelectedEdgeIds(new Set());
    setSelectedDecorationIds(new Set());
  }, []);

  // Bulk selection handler for box-select (updated to include decorations)
  const handleBulkSelect = useCallback((
    nodeIds: Set<string>,
    edgeIds: Set<string>,
    decorationIds: Set<string>,
    addToExisting: boolean
  ) => {
    if (addToExisting) {
      // Union with existing selection
      setSelectedNodeIds((prev) => {
        const newSet = new Set(prev);
        nodeIds.forEach(id => newSet.add(id));
        return newSet;
      });
      setSelectedEdgeIds((prev) => {
        const newSet = new Set(prev);
        edgeIds.forEach(id => newSet.add(id));
        return newSet;
      });
      setSelectedDecorationIds((prev) => {
        const newSet = new Set(prev);
        decorationIds.forEach(id => newSet.add(id));
        return newSet;
      });
    } else {
      // Replace current selection
      setSelectedNodeIds(new Set(nodeIds));
      setSelectedEdgeIds(new Set(edgeIds));
      setSelectedDecorationIds(new Set(decorationIds));
    }
  }, []);

  // =========================================
  // Copy-Paste Handlers
  // =========================================

  // Copy is only available for decorations — architecture items (nodes/edges)
  // cannot be duplicated since each entity should appear at most once per diagram.
  const isCopyEnabled = selectedDecorationIds.size > 0 && selectedNodeIds.size === 0 && selectedEdgeIds.size === 0;

  const handleCopy = useCallback(() => {
    if (!selectedDiagramId || !diagram) return;
    // Only decorations can be copied (no architecture nodes/edges)
    if (selectedNodeIds.size > 0 || selectedEdgeIds.size > 0) return;
    if (selectedDecorationIds.size === 0) return;

    const copiedDecorations = decorations.filter(d => selectedDecorationIds.has(d.id));
    if (copiedDecorations.length === 0) return;

    setClipboard({
      nodes: [],
      edges: [],
      decorations: copiedDecorations,
    });
  }, [selectedDiagramId, diagram, selectedNodeIds, selectedEdgeIds, selectedDecorationIds, decorations]);

  const handlePaste = useCallback(() => {
    if (!clipboard || !selectedDiagramId) return;
    if (clipboard.decorations.length === 0) return;

    const OFFSET = 100;

    // Clone decorations with offset
    const newDecorations: Decoration[] = clipboard.decorations.map(d => {
      const newId = generateDecorationId(d.type as DecorationType);
      if ('pos_x' in d) {
        // Shape decoration
        return { ...d, id: newId, pos_x: d.pos_x + OFFSET, pos_y: d.pos_y + OFFSET };
      } else {
        // Line decoration
        const lineDec = d as LineDecoration;
        return {
          ...lineDec,
          id: newId,
          line_points: lineDec.line_points.map(pt => ({ ...pt, x: pt.x + OFFSET, y: pt.y + OFFSET })),
          label_pos_x: lineDec.label_pos_x != null ? lineDec.label_pos_x + OFFSET : undefined,
          label_pos_y: lineDec.label_pos_y != null ? lineDec.label_pos_y + OFFSET : undefined,
        } as Decoration;
      }
    });

    // Dispatch all additions
    isPasteInProgressRef.current = true;
    for (const dec of newDecorations) {
      dispatch({ type: 'ADD_DECORATION', diagramId: selectedDiagramId, decoration: dec });
    }
    isPasteInProgressRef.current = false;

    // Select the newly pasted items
    setSelectedNodeIds(new Set());
    setSelectedEdgeIds(new Set());
    setSelectedDecorationIds(new Set(newDecorations.map(d => d.id)));
  }, [clipboard, selectedDiagramId, dispatch]);

  // Canvas-level right-click handler (for Paste on empty space)
  const [canvasContextMenu, setCanvasContextMenu] = useState<{ visible: boolean; x: number; y: number }>({ visible: false, x: 0, y: 0 });

  const handleCanvasContextMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    // Close element context menu if open
    setElementContextMenu(prev => ({ ...prev, visible: false }));
    setCanvasContextMenu({ visible: true, x: event.clientX, y: event.clientY });
  }, []);

  const handleCloseCanvasContextMenu = useCallback(() => {
    setCanvasContextMenu(prev => ({ ...prev, visible: false }));
  }, []);

  // =========================================
  // Keyboard shortcuts (Ctrl+C / Ctrl+V / Ctrl+Z)
  // =========================================
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (currentView !== 'diagrams') return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        handleCopy();
        e.preventDefault();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        handlePaste();
        e.preventDefault();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        undo();
        e.preventDefault();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [currentView, handleCopy, handlePaste, undo]);

  // Clear clipboard when navigating away from diagrams view
  React.useEffect(() => {
    if (currentView !== 'diagrams') {
      setClipboard(null);
    }
  }, [currentView]);

  // =========================================
  // Context Menu Handlers (Task Groups 2-4)
  // =========================================

  /**
   * Handle element context menu (right-click)
   * Task Group 2: Add context menu state and handlers
   */
  const handleElementContextMenu = useCallback((
    event: React.MouseEvent,
    elementType: ElementContextMenuType,
    elementId: string,
    currentAutoSize?: boolean
  ) => {
    event.preventDefault();
    event.stopPropagation();

    // Close canvas context menu if open
    setCanvasContextMenu(prev => ({ ...prev, visible: false }));

    // Select the element if not already selected, but preserve multi-selection
    // when right-clicking on an already-selected element
    const isAlreadySelected =
      (elementType === 'node' && selectedNodeIds.has(elementId)) ||
      (elementType === 'edge' && selectedEdgeIds.has(elementId)) ||
      ((elementType === 'shape-decoration' || elementType === 'line-decoration') && selectedDecorationIds.has(elementId));

    if (!isAlreadySelected) {
      if (elementType === 'node') {
        setSelectedNodeIds(new Set([elementId]));
        setSelectedEdgeIds(new Set());
        setSelectedDecorationIds(new Set());
      } else if (elementType === 'edge') {
        setSelectedNodeIds(new Set());
        setSelectedEdgeIds(new Set([elementId]));
        setSelectedDecorationIds(new Set());
      } else if (elementType === 'shape-decoration' || elementType === 'line-decoration') {
        setSelectedNodeIds(new Set());
        setSelectedEdgeIds(new Set());
        setSelectedDecorationIds(new Set([elementId]));
      }
    }

    // Update context menu state
    setElementContextMenu({
      visible: true,
      x: event.clientX,
      y: event.clientY,
      elementType,
      elementId,
      currentAutoSize,
    });
  }, [selectedNodeIds, selectedEdgeIds, selectedDecorationIds]);

  /**
   * Close the context menu
   * Task Group 2: Implement handleCloseContextMenu callback
   */
  const handleCloseContextMenu = useCallback(() => {
    setElementContextMenu(prev => ({ ...prev, visible: false }));
  }, []);

  /**
   * Handle auto-size toggle from context menu
   * Task Group 3: Implement handleAutoSizeToggle callback
   */
  const handleAutoSizeToggle = useCallback((elementId: string, newValue: boolean) => {
    if (!selectedDiagramId) return;

    // Find the element by checking what type is selected
    const node = nodes.find(n => n.id === elementId);
    if (node) {
      dispatch({
        type: 'UPDATE_DIAGRAM_NODE',
        diagramId: selectedDiagramId,
        nodeId: elementId,
        updates: { auto_size: newValue },
      });
      handleCloseContextMenu();
      return;
    }

    const decoration = decorations.find(d => d.id === elementId);
    if (decoration && 'pos_x' in decoration) {
      dispatch({
        type: 'UPDATE_DECORATION',
        diagramId: selectedDiagramId,
        decorationId: elementId,
        updates: { auto_size: newValue },
      });
      handleCloseContextMenu();
      return;
    }

    handleCloseContextMenu();
  }, [selectedDiagramId, nodes, decorations, dispatch, handleCloseContextMenu]);

  /**
   * Handle z-index change from context menu
   * Task Group 3: Implement handleZIndexChange callback
   */
  const handleZIndexChange = useCallback((elementId: string, action: ZIndexAction) => {
    if (!selectedDiagramId) return;

    // Calculate current z-index bounds
    const bounds = getZIndexBounds(nodes, edges, decorations);

    // Find the element and get its current z-index
    let currentZIndex: number;
    let elementType: 'node' | 'edge' | 'decoration' | null = null;

    const node = nodes.find(n => n.id === elementId);
    if (node) {
      currentZIndex = node.z_index ?? Z_INDEX_DEFAULTS.DIAGRAM_NODE;
      elementType = 'node';
    } else {
      const edge = edges.find(e => e.id === elementId);
      if (edge) {
        currentZIndex = edge.z_index ?? Z_INDEX_DEFAULTS.DIAGRAM_EDGE;
        elementType = 'edge';
      } else {
        const decoration = decorations.find(d => d.id === elementId);
        if (decoration) {
          if ('pos_x' in decoration) {
            currentZIndex = decoration.z_index ?? Z_INDEX_DEFAULTS.BOX_DECORATION;
          } else {
            currentZIndex = decoration.z_index ?? Z_INDEX_DEFAULTS.LINE_DECORATION;
          }
          elementType = 'decoration';
        } else {
          handleCloseContextMenu();
          return;
        }
      }
    }

    // Calculate new z-index
    const newZIndex = calculateNewZIndex(currentZIndex, action, bounds);

    // Dispatch appropriate update action
    if (elementType === 'node') {
      dispatch({
        type: 'UPDATE_DIAGRAM_NODE',
        diagramId: selectedDiagramId,
        nodeId: elementId,
        updates: { z_index: newZIndex },
      });
    } else if (elementType === 'edge') {
      dispatch({
        type: 'UPDATE_DIAGRAM_EDGE',
        diagramId: selectedDiagramId,
        edgeId: elementId,
        updates: { z_index: newZIndex },
      });
    } else if (elementType === 'decoration') {
      dispatch({
        type: 'UPDATE_DECORATION',
        diagramId: selectedDiagramId,
        decorationId: elementId,
        updates: { z_index: newZIndex },
      });
    }

    handleCloseContextMenu();
  }, [selectedDiagramId, nodes, edges, decorations, dispatch, handleCloseContextMenu]);

  /**
   * Handle "Link" context menu click - open AddLinkModal
   */
  const handleLink = useCallback((elementId: string) => {
    const elementType = elementContextMenu.elementType;
    let currentLinkedDiagramId: string | undefined;

    if (elementType === 'node') {
      currentLinkedDiagramId = nodes.find(n => n.id === elementId)?.linkedDiagramId;
    } else if (elementType === 'edge') {
      currentLinkedDiagramId = edges.find(e => e.id === elementId)?.linkedDiagramId;
    } else {
      currentLinkedDiagramId = decorations.find(d => d.id === elementId)?.linkedDiagramId;
    }

    setAddLinkModalState({
      isOpen: true,
      elementType,
      elementId,
      currentLinkedDiagramId,
    });
  }, [elementContextMenu.elementType, nodes, edges, decorations]);

  /**
   * Handle "Unlink" context menu click - remove link
   */
  const handleUnlink = useCallback((elementId: string) => {
    if (!selectedDiagramId) return;
    const elementType = elementContextMenu.elementType;

    if (elementType === 'node') {
      dispatch({
        type: 'UPDATE_DIAGRAM_NODE',
        diagramId: selectedDiagramId,
        nodeId: elementId,
        updates: { linkedDiagramId: undefined },
      });
    } else if (elementType === 'edge') {
      dispatch({
        type: 'UPDATE_DIAGRAM_EDGE',
        diagramId: selectedDiagramId,
        edgeId: elementId,
        updates: { linkedDiagramId: undefined },
      });
    } else {
      dispatch({
        type: 'UPDATE_DECORATION',
        diagramId: selectedDiagramId,
        decorationId: elementId,
        updates: { linkedDiagramId: undefined },
      });
    }
  }, [selectedDiagramId, elementContextMenu.elementType, dispatch]);

  /**
   * Handle "Reset Edge" context menu click - recalculate edge points as a fresh straight line
   */
  const handleEdgeReset = useCallback((edgeId: string) => {
    if (!selectedDiagramId) return;
    const edge = edges.find(e => e.id === edgeId);
    if (!edge) return;
    const sourceNode = nodes.find(n => n.id === edge.source_node_id);
    const targetNode = nodes.find(n => n.id === edge.target_node_id);
    if (!sourceNode || !targetNode) return;

    const newEdgePoints = calculateEdgePoints(sourceNode, targetNode);
    dispatch({
      type: 'UPDATE_DIAGRAM_EDGE_POINTS',
      diagramId: selectedDiagramId,
      edgeId,
      edgePoints: newEdgePoints,
    });
  }, [selectedDiagramId, edges, nodes, dispatch]);

  /**
   * Handle AddLinkModal submit - set linkedDiagramId on the element
   */
  const handleLinkSubmit = useCallback((linkedDiagramId: string) => {
    if (!selectedDiagramId) return;

    if (addLinkModalState.elementType === 'node') {
      dispatch({
        type: 'UPDATE_DIAGRAM_NODE',
        diagramId: selectedDiagramId,
        nodeId: addLinkModalState.elementId,
        updates: { linkedDiagramId },
      });
    } else if (addLinkModalState.elementType === 'edge') {
      dispatch({
        type: 'UPDATE_DIAGRAM_EDGE',
        diagramId: selectedDiagramId,
        edgeId: addLinkModalState.elementId,
        updates: { linkedDiagramId },
      });
    } else {
      dispatch({
        type: 'UPDATE_DECORATION',
        diagramId: selectedDiagramId,
        decorationId: addLinkModalState.elementId,
        updates: { linkedDiagramId },
      });
    }

    setAddLinkModalState(prev => ({ ...prev, isOpen: false }));
  }, [selectedDiagramId, addLinkModalState.elementType, addLinkModalState.elementId, dispatch]);

  // =========================================
  // Advanced Edit: Computed value and handlers
  // =========================================

  const showAdvancedEdit = useMemo(() => {
    if (elementContextMenu.elementType !== 'node') return false;
    const node = nodes.find(n => n.id === elementContextMenu.elementId);
    if (!node) return false;
    return [ENTITY_TYPES.APPLICATION, ENTITY_TYPES.APP_COMPONENT, ENTITY_TYPES.SERVICE, ENTITY_TYPES.INTERFACE].includes(node.entity_type as any);
  }, [elementContextMenu.elementType, elementContextMenu.elementId, nodes]);

  /**
   * Handle "Advanced Edit" context menu click - opens AdvancedAddDialog in edit mode
   * Pre-selects existing children based on current diagram state.
   */
  const handleAdvancedEdit = useCallback((elementId: string) => {
    const metaModel = state.model.metaModel;
    if (!metaModel || !diagram) return;

    const node = nodes.find(n => n.id === elementId);
    if (!node) return;

    const entityName = getEntityLabel(node.entity_type, node.entity_id, state.model);
    const rootEntity = { id: node.entity_id, name: entityName, type: node.entity_type };

    // Build tree data for this entity
    const treeData = buildTreeData(metaModel, rootEntity);

    // Collect all tree nodes into a flat list and build entityType:entityId -> treeKey map
    const entityKeyToTreeKey = new Map<string, string>();
    function collectTreeNodes(treeNode: TreeNodeData) {
      entityKeyToTreeKey.set(`${treeNode.entityType}:${treeNode.entityId}`, treeNode.key);
      treeNode.children.forEach(collectTreeNodes);
    }
    collectTreeNodes(treeData);

    // Build pre-selected keys from existing diagram children
    const preSelectedKeys = new Set<string>();
    // Always include root
    preSelectedKeys.add(treeData.key);

    // 1. Child diagram nodes (direct children and their descendants)
    const childNodes = nodes.filter(n => n.parent_node_id === elementId);
    for (const child of childNodes) {
      const treeKey = entityKeyToTreeKey.get(`${child.entity_type}:${child.entity_id}`);
      if (treeKey) {
        preSelectedKeys.add(treeKey);
        // Add ancestor keys to maintain tree invariant
        const ancestors = getAncestorKeys(treeData, treeKey);
        ancestors.forEach(k => preSelectedKeys.add(k));
      }
      // Also include descendants of child nodes
      const descendants = getDescendantNodes(child.id, nodes);
      for (const desc of descendants) {
        const descTreeKey = entityKeyToTreeKey.get(`${desc.entity_type}:${desc.entity_id}`);
        if (descTreeKey) {
          preSelectedKeys.add(descTreeKey);
          const ancestors = getAncestorKeys(treeData, descTreeKey);
          ancestors.forEach(k => preSelectedKeys.add(k));
        }
      }
    }

    // 2. Embedded attributes (selected_attribute_ids or embedded_attribute_ids)
    const attributeIds = node.selected_attribute_ids || node.embedded_attribute_ids || [];
    for (const attrId of attributeIds) {
      // Try both logical and physical attribute types
      const logKey = entityKeyToTreeKey.get(`${ENTITY_TYPES.LOGICAL_DATA_ATTRIBUTE}:${attrId}`);
      const phyKey = entityKeyToTreeKey.get(`${ENTITY_TYPES.PHYSICAL_DATA_ATTRIBUTE}:${attrId}`);
      const attrTreeKey = logKey || phyKey;
      if (attrTreeKey) {
        preSelectedKeys.add(attrTreeKey);
        const ancestors = getAncestorKeys(treeData, attrTreeKey);
        ancestors.forEach(k => preSelectedKeys.add(k));
      }
    }

    // 3. Embedded endpoints
    const endpointIds = node.embedded_endpoint_ids || [];
    for (const epId of endpointIds) {
      const epTreeKey = entityKeyToTreeKey.get(`${ENTITY_TYPES.ENDPOINT}:${epId}`);
      if (epTreeKey) {
        preSelectedKeys.add(epTreeKey);
        const ancestors = getAncestorKeys(treeData, epTreeKey);
        ancestors.forEach(k => preSelectedKeys.add(k));
      }
    }

    // 4. Embedded entities (logical or physical data entities)
    const embeddedEntityIds = node.embedded_entity_ids || [];
    for (const entId of embeddedEntityIds) {
      const logEntKey = entityKeyToTreeKey.get(`${ENTITY_TYPES.LOGICAL_DATA_ENTITY}:${entId}`);
      const phyEntKey = entityKeyToTreeKey.get(`${ENTITY_TYPES.PHYSICAL_DATA_ENTITY}:${entId}`);
      const entTreeKey = logEntKey || phyEntKey;
      if (entTreeKey) {
        preSelectedKeys.add(entTreeKey);
        const ancestors = getAncestorKeys(treeData, entTreeKey);
        ancestors.forEach(k => preSelectedKeys.add(k));
      }
    }

    setAdvancedEditDialogState({
      isOpen: true,
      rootEntity,
      nodeId: elementId,
      initialSelectedKeys: preSelectedKeys,
    });
  }, [state.model, diagram, nodes]);

  // Viewport center fix: On-demand function to get current viewport center
  // This queries the scroll container directly at call time, avoiding stale state
  const getViewportCenter: GetViewportCenterFn = useCallback(() => {
    const container = canvasScrollContainerRef.current;
    if (!container) {
      // Fallback to canvas center if container not available
      return { ...DEFAULT_CANVAS_CENTER };
    }

    return getViewportCenterFromRaw(
      container.scrollLeft,
      container.scrollTop,
      container.clientWidth,
      container.clientHeight,
      zoom
    );
  }, [zoom]);

  /**
   * Handle Advanced Edit confirmation - processes additions and removals
   */
  const handleAdvancedEditConfirm = useCallback((result: AdvancedAddResult) => {
    if (!selectedDiagramId || !diagram || !state.model.metaModel || !advancedEditDialogState.rootEntity) {
      return;
    }

    const metaModel = state.model.metaModel;
    const { treeData, selectedKeys, spacingPreset, childColumns, childNodeWidth } = result;
    const editNodeId = advancedEditDialogState.nodeId;

    // Collect all tree nodes for lookup
    const entityKeyToTreeKey = new Map<string, string>();
    function collectTreeNodes(treeNode: TreeNodeData) {
      entityKeyToTreeKey.set(`${treeNode.entityType}:${treeNode.entityId}`, treeNode.key);
      treeNode.children.forEach(collectTreeNodes);
    }
    collectTreeNodes(treeData);

    // Find existing child diagram nodes and all descendants
    const existingChildNodes = nodes.filter(n => n.parent_node_id === editNodeId);
    const nodeIdsToRemove: string[] = [];
    const edgeIdsToRemove: string[] = [];

    for (const child of existingChildNodes) {
      const treeKey = entityKeyToTreeKey.get(`${child.entity_type}:${child.entity_id}`);
      if (treeKey && !selectedKeys.has(treeKey)) {
        // This child was deselected - remove it and all its descendants
        nodeIdsToRemove.push(child.id);
        const descendants = getDescendantNodes(child.id, nodes);
        descendants.forEach(d => nodeIdsToRemove.push(d.id));
      }
    }

    // Find connected edges to removed nodes
    if (nodeIdsToRemove.length > 0) {
      const removeSet = new Set(nodeIdsToRemove);
      const diagramEdges = diagram.diagram_edges || [];
      for (const edge of diagramEdges) {
        if (removeSet.has(edge.source_node_id) || removeSet.has(edge.target_node_id)) {
          edgeIdsToRemove.push(edge.id);
        }
      }
    }

    // Dispatch DELETE_DIAGRAM_ELEMENTS for removed nodes/edges
    if (nodeIdsToRemove.length > 0 || edgeIdsToRemove.length > 0) {
      dispatch({
        type: 'DELETE_DIAGRAM_ELEMENTS',
        diagramId: selectedDiagramId,
        nodeIds: nodeIdsToRemove,
        edgeIds: edgeIdsToRemove,
      });
    }

    // Build post-removal diagram for correct layout
    const removeNodeSet = new Set(nodeIdsToRemove);
    const removeEdgeSet = new Set(edgeIdsToRemove);
    const postRemovalDiagram = {
      ...diagram,
      diagram_nodes: nodes.filter(n => !removeNodeSet.has(n.id)),
      diagram_edges: (diagram.diagram_edges || []).filter(e => !removeEdgeSet.has(e.id)),
    };

    // Build ordered nodes for new additions and updates
    const orderedNodes = buildOrderedNodeListFromLeaves(selectedKeys, treeData);

    if (orderedNodes.length === 0) {
      setAdvancedEditDialogState({ isOpen: false, rootEntity: null, nodeId: '', initialSelectedKeys: new Set() });
      return;
    }

    // Get center from the existing node position for layout
    const editNode = nodes.find(n => n.id === editNodeId);
    const center = editNode
      ? { x: editNode.pos_x + editNode.width / 2, y: editNode.pos_y + editNode.height / 2 }
      : getViewportCenter();

    const effectiveSpacingPreset = spacingPreset || DEFAULT_SPACING_PRESET;
    let layoutConfig: LayoutConfig | undefined = undefined;
    if (childColumns !== undefined || childNodeWidth !== undefined) {
      const spacingConfig = SPACING_PRESETS[effectiveSpacingPreset];
      layoutConfig = {
        ...spacingConfig,
        childColumns: childColumns ?? DEFAULT_LAYOUT_CONFIG.childColumns,
        childNodeWidth: childNodeWidth ?? DEFAULT_LAYOUT_CONFIG.childNodeWidth,
      };
    }

    const wrappedResult = buildWrappedNodeHierarchy(
      orderedNodes,
      treeData,
      metaModel,
      postRemovalDiagram,
      center,
      effectiveSpacingPreset,
      layoutConfig
    );

    // Add new nodes
    if (wrappedResult.nodesToAdd.length > 0) {
      dispatch({
        type: 'ADD_DIAGRAM_NODES',
        payload: { diagramId: selectedDiagramId, nodes: wrappedResult.nodesToAdd },
      });
    }

    // Update existing nodes (resize, restyle for containment)
    for (const update of wrappedResult.nodesToUpdate) {
      dispatch({
        type: 'UPDATE_DIAGRAM_NODE',
        diagramId: selectedDiagramId,
        nodeId: update.nodeId,
        updates: update.updates,
      });
    }

    // Update embedded fields for existing Interface nodes
    // buildWrappedNodeHierarchy only updates styling for existing nodes but doesn't set
    // embedded_endpoint_ids, embedded_entity_ids, or render_style
    const diagramId = selectedDiagramId; // captured as non-null (guarded above)
    function updateInterfaceEmbeddedFields(treeNode: TreeNodeData) {
      if (treeNode.entityType === ENTITY_TYPES.INTERFACE && selectedKeys.has(treeNode.key)) {
        const existingNode = postRemovalDiagram.diagram_nodes.find(
          n => n.entity_type === ENTITY_TYPES.INTERFACE && n.entity_id === treeNode.entityId
        );

        if (existingNode) {
          // Collect selected endpoint and data entity IDs from tree children
          const selectedEndpointIds = treeNode.children
            .filter(child => child.entityType === ENTITY_TYPES.ENDPOINT && selectedKeys.has(child.key))
            .map(child => child.entityId);

          const selectedLogicalEntityIds = treeNode.children
            .filter(child => child.entityType === ENTITY_TYPES.LOGICAL_DATA_ENTITY && selectedKeys.has(child.key))
            .map(child => child.entityId);

          const selectedPhysicalEntityIds = treeNode.children
            .filter(child => child.entityType === ENTITY_TYPES.PHYSICAL_DATA_ENTITY && selectedKeys.has(child.key))
            .map(child => child.entityId);

          const allEmbeddedEntityIds = [...selectedLogicalEntityIds, ...selectedPhysicalEntityIds];
          const hasEmbeddedContent = selectedEndpointIds.length > 0 || allEmbeddedEntityIds.length > 0;

          if (hasEmbeddedContent) {
            // Use buildInterfaceCompositeNodes to compute correct dimensions
            const nodeCenter = {
              x: existingNode.pos_x + existingNode.width / 2,
              y: existingNode.pos_y + existingNode.height / 2,
            };
            const dataEntityIds: DataEntityIdsForInterface = {
              logicalEntityIds: selectedLogicalEntityIds,
              physicalEntityIds: selectedPhysicalEntityIds,
            };
            const { interfaceNode: computedNode, entityNodes: computedEntityNodes } = buildInterfaceCompositeNodes(
              treeNode.entityId,
              selectedEndpointIds,
              dataEntityIds,
              new Map(), // Empty map = all attributes
              metaModel,
              nodeCenter,
              existingNode.z_index ?? 0,
              existingNode.parent_node_id
            );

            // Update the existing Interface node with embedded fields and dimensions
            dispatch({
              type: 'UPDATE_DIAGRAM_NODE',
              diagramId,
              nodeId: existingNode.id,
              updates: {
                render_style: 'contract',
                embedded_endpoint_ids: selectedEndpointIds,
                embedded_entity_ids: allEmbeddedEntityIds,
                width: computedNode.width,
                height: computedNode.height,
              },
            });

            // Add new entity child nodes (data entities rendered inside the Interface)
            const newEntityNodes = computedEntityNodes
              .filter(en => !postRemovalDiagram.diagram_nodes.some(
                n => n.entity_type === en.entity_type && n.entity_id === en.entity_id
              ))
              .map(en => ({ ...en, parent_node_id: existingNode.id }));

            if (newEntityNodes.length > 0) {
              dispatch({
                type: 'ADD_DIAGRAM_NODES',
                payload: { diagramId, nodes: newEntityNodes },
              });
            }
          } else {
            // Clear embedded fields if no embedded content selected
            dispatch({
              type: 'UPDATE_DIAGRAM_NODE',
              diagramId,
              nodeId: existingNode.id,
              updates: {
                render_style: undefined,
                embedded_endpoint_ids: undefined,
                embedded_entity_ids: undefined,
              },
            });
          }
        }
      }

      // Recurse into children to handle nested Interfaces
      treeNode.children.forEach(updateInterfaceEmbeddedFields);
    }
    updateInterfaceEmbeddedFields(treeData);

    // Close dialog
    setAdvancedEditDialogState({ isOpen: false, rootEntity: null, nodeId: '', initialSelectedKeys: new Set() });
  }, [selectedDiagramId, diagram, state.model.metaModel, advancedEditDialogState.rootEntity, advancedEditDialogState.nodeId, nodes, dispatch, getViewportCenter]);

  const handleAdvancedEditClose = useCallback(() => {
    setAdvancedEditDialogState({ isOpen: false, rootEntity: null, nodeId: '', initialSelectedKeys: new Set() });
  }, []);

  // Task Group 4: Bottom panel toggle handler (panel is now empty but structure preserved)
  const handleToggleDecorationsPanel = useCallback(() => {
    setIsDecorationsPanelExpanded(prev => !prev);
  }, []);

  // Task Group 3: Handler for decoration add mode (used by left panel and canvas)
  const handleDecorationAddModeChange = useCallback((mode: DecorationAddMode) => {
    setDecorationAddMode(mode);
  }, []);

  // Task Group 3: Handler for updating decoration text (used by left panel)
  const handleUpdateDecorationText = useCallback((decorationId: string, text: string) => {
    if (!selectedDiagramId) return;
    dispatch({
      type: 'UPDATE_DECORATION',
      diagramId: selectedDiagramId,
      decorationId,
      updates: { text },
    });
  }, [dispatch, selectedDiagramId]);

  // Handler for updating decoration properties (opacity, etc.)
  const handleUpdateDecoration = useCallback((decorationId: string, updates: Partial<Decoration>) => {
    if (!selectedDiagramId) return;
    dispatch({
      type: 'UPDATE_DECORATION',
      diagramId: selectedDiagramId,
      decorationId,
      updates,
    });
    // Update sticky styles when user changes style properties (exclude TEXT and NOTE)
    const deco = decorations.find(d => d.id === decorationId);
    if (deco && deco.type !== 'TEXT' && deco.type !== 'NOTE' && SHAPE_DECORATION_TYPES.includes(deco.type as ShapeDecorationType)) {
      setStickyShapeStyles(prev => {
        const next = { ...prev };
        if ('background_color' in updates) next.background_color = updates.background_color as string;
        if ('line_color' in updates) next.line_color = updates.line_color as string;
        if ('background_opacity' in updates) next.background_opacity = updates.background_opacity as number;
        if ('border_opacity' in updates) next.border_opacity = updates.border_opacity as number;
        return next;
      });
    }
  }, [dispatch, selectedDiagramId, decorations]);

  const handleZoomIn = () => {
    setZoom((prev) => Math.min(prev + appConfig.zoom.step, appConfig.zoom.max));
  };

  const handleZoomOut = () => {
    setZoom((prev) => Math.max(prev - appConfig.zoom.step, appConfig.zoom.min));
  };

  const handleFitToView = () => {
    if (!selectedDiagramId || !canvasContainerRef.current) {
      setZoom(appConfig.zoom.default);
      return;
    }

    // Get viewport dimensions from canvas container
    const container = canvasContainerRef.current;
    const viewportWidth = container.clientWidth;
    const viewportHeight = container.clientHeight;

    // Calculate fit zoom
    const { zoom: fitZoom } = calculateDiagramFitZoom(
      selectedDiagramId,
      state.model,
      viewportWidth,
      viewportHeight
    );

    setZoom(fitZoom);
  };

  const handleZoomChange = (newZoom: number) => {
    setZoom(Math.max(appConfig.zoom.min, Math.min(newZoom, appConfig.zoom.max)));
  };

  const handleTogglePalettePanel = () => {
    dispatch({ type: 'TOGGLE_PALETTE_PANEL' });
  };

  const handleToggleInspectorPanel = () => {
    dispatch({ type: 'TOGGLE_INSPECTOR_PANEL' });
  };

  const handleSearchChange = (query: string) => {
    dispatch({ type: 'SET_PALETTE_SEARCH', payload: query });
  };

  const handleToggleSection = (sectionId: string) => {
    dispatch({ type: 'TOGGLE_PALETTE_SECTION', payload: { sectionId } });
  };

  // Handler for adding a single node
  const handleAddNode = useCallback((node: DiagramNode) => {
    if (!selectedDiagramId) return;
    if (!isPasteInProgressRef.current) setClipboard(null);
    dispatch({
      type: 'ADD_DIAGRAM_NODE',
      payload: { diagramId: selectedDiagramId, node },
    });
  }, [dispatch, selectedDiagramId]);

  // Handler for adding multiple nodes (batch add for compound operations)
  const handleAddNodes = useCallback((nodes: DiagramNode[]) => {
    if (!selectedDiagramId) return;
    if (!isPasteInProgressRef.current) setClipboard(null);
    dispatch({
      type: 'ADD_DIAGRAM_NODES',
      payload: { diagramId: selectedDiagramId, nodes },
    });
  }, [dispatch, selectedDiagramId]);

  // ============================================================================
  // Data Movement Add Fix: Handler for adding a diagram edge
  // Task Group 2: Wire onAddEdge Prop in DiagramsView
  // Follows same pattern as handleAddNode - dispatches ADD_DIAGRAM_EDGE action
  // ============================================================================
  const handleAddEdge = useCallback((edge: DiagramEdge) => {
    if (!selectedDiagramId) return;
    if (!isPasteInProgressRef.current) setClipboard(null);
    dispatch({
      type: 'ADD_DIAGRAM_EDGE',
      payload: { diagramId: selectedDiagramId, edge },
    });
  }, [dispatch, selectedDiagramId]);

  // Handler for updating a node
  const handleUpdateNode = useCallback((nodeId: string, updates: Partial<DiagramNode>) => {
    if (!selectedDiagramId) return;
    dispatch({
      type: 'UPDATE_DIAGRAM_NODE',
      diagramId: selectedDiagramId,
      nodeId,
      updates,
    });
  }, [dispatch, selectedDiagramId]);

  // Handler for deleting a node
  const handleDeleteNode = useCallback((nodeId: string) => {
    if (!selectedDiagramId) return;
    dispatch({
      type: 'DELETE_DIAGRAM_ELEMENTS',
      diagramId: selectedDiagramId,
      nodeIds: [nodeId],
      edgeIds: [],
    });
  }, [dispatch, selectedDiagramId]);

  // ============================================================================
  // Task Group 3: Handler for deleting diagram edges
  // Used by PalettePanel to delete User Interaction edges
  // ============================================================================
  const handleDeleteEdges = useCallback((edgeIds: string[]) => {
    if (!selectedDiagramId) return;
    dispatch({
      type: 'DELETE_DIAGRAM_ELEMENTS',
      diagramId: selectedDiagramId,
      nodeIds: [],
      edgeIds: edgeIds,
    });
  }, [dispatch, selectedDiagramId]);

  // ============================================================================
  // Task Group 1: Handler for updating diagram (used by SequenceEditorPanel)
  // Dispatches UPDATE_DIAGRAM action with partial updates
  // ============================================================================
  const handleUpdateDiagram = useCallback((updates: Partial<Diagram>) => {
    if (!diagram?.id) return;
    dispatch({
      type: 'UPDATE_DIAGRAM',
      diagramId: diagram.id,
      updates,
    });
  }, [dispatch, diagram?.id]);

  // UI Architecture Phase 1 Increment 2: Handler that accepts diagramId for UIScreenDiagramEditorPanel
  const handleUpdateDiagramById = useCallback((diagramId: string, updates: Partial<Diagram>) => {
    dispatch({
      type: 'UPDATE_DIAGRAM',
      diagramId,
      updates,
    });
  }, [dispatch]);

  // Handle time navigation
  const handleTimeNavigate = (newQuarter: string) => {
    if (!selectedDiagramId) return;
    dispatch({
      type: 'UPDATE_DIAGRAM_VIEW_QUARTER',
      diagramId: selectedDiagramId,
      view_quarter: newQuarter,
    });
  };

  // =========================================
  // Task Group 2: Row 2 Styling Control Handlers
  // =========================================

  // Update handlers for selected items
  const updateSelectedNodes = useCallback((updates: Partial<DiagramNode>) => {
    if (!selectedDiagramId || selectedNodeIds.size === 0) return;
    dispatch({
      type: 'UPDATE_DIAGRAM_NODES',
      diagramId: selectedDiagramId,
      nodeIds: Array.from(selectedNodeIds),
      updates,
    });
  }, [dispatch, selectedDiagramId, selectedNodeIds]);

  const updateSelectedEdges = useCallback((updates: Partial<DiagramEdge>) => {
    if (!selectedDiagramId || selectedEdgeIds.size === 0) return;
    dispatch({
      type: 'UPDATE_DIAGRAM_EDGES',
      diagramId: selectedDiagramId,
      edgeIds: Array.from(selectedEdgeIds),
      updates,
    });
  }, [dispatch, selectedDiagramId, selectedEdgeIds]);

  const updateSelectedDecorations = useCallback((updates: Partial<Decoration>) => {
    if (!selectedDiagramId || selectedDecorationIds.size === 0) return;
    dispatch({
      type: 'UPDATE_DECORATIONS',
      diagramId: selectedDiagramId,
      decorationIds: Array.from(selectedDecorationIds),
      updates,
    });
  }, [dispatch, selectedDiagramId, selectedDecorationIds]);

  // Compute common values for Row 2 controls
  const commonFontSize = getCommonFontSize(selectedNodeIds, selectedEdgeIds, selectedDecorationIds, nodes, edges, decorations);
  const commonHAlign = getCommonHAlign(selectedNodeIds, nodes);
  const commonVAlign = getCommonVAlign(selectedNodeIds, nodes);
  const commonDecorationHAlign = getCommonDecorationHAlign(selectedDecorationIds, decorations);
  const commonDecorationVAlign = getCommonDecorationVAlign(selectedDecorationIds, decorations);

  // Row 2 visibility and state
  const hasSelection = selectedNodeIds.size > 0 || selectedEdgeIds.size > 0 || selectedDecorationIds.size > 0;
  const hasRectangularNodes = hasRectangularNodesInSelection(selectedNodeIds, nodes);
  const hasBoxDecorations = hasShapeDecorationsInSelection(selectedDecorationIds, decorations);
  const showNodeAlignmentControls = hasRectangularNodes;
  const showDecorationAlignmentControls = hasBoxDecorations;
  const isBackgroundDisabled = !hasBackgroundSupportingItems(selectedNodeIds, selectedDecorationIds, decorations);

  // Task Group 2: Position controls state
  const positionControlsEnabled = isPositionControlsEnabled(selectedNodeIds, selectedEdgeIds, selectedDecorationIds, decorations);
  const positionValues = getPositionValues(selectedNodeIds, selectedDecorationIds, nodes, decorations);
  const strokeValue = getStrokeValue(selectedNodeIds, selectedEdgeIds, selectedDecorationIds, nodes, edges, decorations);
  const strokeControlEnabled = strokeValue !== null;

  // Font Size handlers
  const handleFontSizeDecrease = useCallback(() => {
    const currentSize = commonFontSize ?? 12;
    const newSize = Math.max(currentSize - 1, 1);
    const newSizeStr = `${newSize}px`;

    if (selectedNodeIds.size > 0) {
      updateSelectedNodes({ text_font_size: newSizeStr });
    }
    if (selectedEdgeIds.size > 0) {
      updateSelectedEdges({ label_font_size: newSizeStr });
    }
    if (selectedDecorationIds.size > 0) {
      updateSelectedDecorations({ text_font_size: newSize });
    }
  }, [commonFontSize, selectedNodeIds.size, selectedEdgeIds.size, selectedDecorationIds.size, updateSelectedNodes, updateSelectedEdges, updateSelectedDecorations]);

  const handleFontSizeIncrease = useCallback(() => {
    const currentSize = commonFontSize ?? 12;
    const newSize = Math.min(currentSize + 1, 99);
    const newSizeStr = `${newSize}px`;

    if (selectedNodeIds.size > 0) {
      updateSelectedNodes({ text_font_size: newSizeStr });
    }
    if (selectedEdgeIds.size > 0) {
      updateSelectedEdges({ label_font_size: newSizeStr });
    }
    if (selectedDecorationIds.size > 0) {
      updateSelectedDecorations({ text_font_size: newSize });
    }
  }, [commonFontSize, selectedNodeIds.size, selectedEdgeIds.size, selectedDecorationIds.size, updateSelectedNodes, updateSelectedEdges, updateSelectedDecorations]);

  const handleFontSizeInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setFontSizeInputValue(e.target.value);
  }, []);

  const handleFontSizeInputFocus = useCallback(() => {
    setIsEditingFontSize(true);
    setFontSizeInputValue(commonFontSize !== null ? String(commonFontSize) : '');
  }, [commonFontSize]);

  const handleFontSizeInputBlur = useCallback(() => {
    setIsEditingFontSize(false);

    const parsed = parseInt(fontSizeInputValue, 10);
    if (isNaN(parsed)) {
      setFontSizeInputValue('');
      return;
    }

    const clampedSize = Math.max(1, Math.min(99, parsed));
    const newSizeStr = `${clampedSize}px`;

    if (selectedNodeIds.size > 0) {
      updateSelectedNodes({ text_font_size: newSizeStr });
    }
    if (selectedEdgeIds.size > 0) {
      updateSelectedEdges({ label_font_size: newSizeStr });
    }
    if (selectedDecorationIds.size > 0) {
      updateSelectedDecorations({ text_font_size: clampedSize });
    }

    setFontSizeInputValue('');
  }, [fontSizeInputValue, selectedNodeIds.size, selectedEdgeIds.size, selectedDecorationIds.size, updateSelectedNodes, updateSelectedEdges, updateSelectedDecorations]);

  const handleFontSizeInputKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      (e.target as HTMLInputElement).blur();
    } else if (e.key === 'Escape') {
      setIsEditingFontSize(false);
      setFontSizeInputValue('');
    }
  }, []);

  // Font Style handlers
  const handleBoldToggle = useCallback(() => {
    const allBold = allHaveFontWeight('bold', selectedNodeIds, selectedEdgeIds, selectedDecorationIds, nodes, edges, decorations);
    const newWeight = allBold ? 'normal' : 'bold';

    if (selectedNodeIds.size > 0) {
      updateSelectedNodes({ text_font_weight: newWeight });
    }
    if (selectedEdgeIds.size > 0) {
      updateSelectedEdges({ label_font_weight: newWeight });
    }
    if (selectedDecorationIds.size > 0) {
      updateSelectedDecorations({ text_font_weight: newWeight });
    }
  }, [selectedNodeIds, selectedEdgeIds, selectedDecorationIds, nodes, edges, decorations, updateSelectedNodes, updateSelectedEdges, updateSelectedDecorations]);

  const handleItalicToggle = useCallback(() => {
    const allItalic = allHaveFontStyle('italic', selectedNodeIds, selectedEdgeIds, selectedDecorationIds, nodes, edges, decorations);
    const newStyle = allItalic ? 'normal' : 'italic';

    if (selectedNodeIds.size > 0) {
      updateSelectedNodes({ text_font_style: newStyle });
    }
    if (selectedEdgeIds.size > 0) {
      updateSelectedEdges({ label_font_style: newStyle });
    }
    if (selectedDecorationIds.size > 0) {
      updateSelectedDecorations({ text_font_style: newStyle });
    }
  }, [selectedNodeIds, selectedEdgeIds, selectedDecorationIds, nodes, edges, decorations, updateSelectedNodes, updateSelectedEdges, updateSelectedDecorations]);

  const handleUnderlineToggle = useCallback(() => {
    const allUnderlined = allHaveTextDecoration('underline', selectedNodeIds, selectedEdgeIds, selectedDecorationIds, nodes, edges, decorations);
    const newDecoration = allUnderlined ? 'none' : 'underline';

    if (selectedNodeIds.size > 0) {
      updateSelectedNodes({ text_text_decoration: newDecoration });
    }
    if (selectedEdgeIds.size > 0) {
      updateSelectedEdges({ label_text_decoration: newDecoration });
    }
    if (selectedDecorationIds.size > 0) {
      updateSelectedDecorations({ text_text_decoration: newDecoration });
    }
  }, [selectedNodeIds, selectedEdgeIds, selectedDecorationIds, nodes, edges, decorations, updateSelectedNodes, updateSelectedEdges, updateSelectedDecorations]);

  // Text Alignment handlers for nodes
  const handleHAlignChange = useCallback((align: TextHorizontalAlign) => {
    if (!selectedDiagramId) return;

    const rectangularNodeIds = Array.from(selectedNodeIds).filter(nodeId => {
      const node = nodes.find(n => n.id === nodeId);
      return node && node.entity_type !== 'BUSINESS_USER';
    });

    if (rectangularNodeIds.length > 0) {
      dispatch({
        type: 'UPDATE_DIAGRAM_NODES',
        diagramId: selectedDiagramId,
        nodeIds: rectangularNodeIds,
        updates: { text_h_align: align },
      });
    }
  }, [dispatch, selectedDiagramId, selectedNodeIds, nodes]);

  const handleVAlignChange = useCallback((align: TextVerticalAlign) => {
    if (!selectedDiagramId) return;

    const rectangularNodeIds = Array.from(selectedNodeIds).filter(nodeId => {
      const node = nodes.find(n => n.id === nodeId);
      return node && node.entity_type !== 'BUSINESS_USER';
    });

    if (rectangularNodeIds.length > 0) {
      dispatch({
        type: 'UPDATE_DIAGRAM_NODES',
        diagramId: selectedDiagramId,
        nodeIds: rectangularNodeIds,
        updates: { text_v_align: align },
      });
    }
  }, [dispatch, selectedDiagramId, selectedNodeIds, nodes]);

  // Decoration Alignment handlers
  const handleDecorationHAlignChange = useCallback((align: DecorationHAlign) => {
    if (!selectedDiagramId) return;

    const shapeDecorationIds = Array.from(selectedDecorationIds).filter(decorationId => {
      const decoration = decorations.find(d => d.id === decorationId);
      return decoration && SHAPE_DECORATION_TYPES.includes(decoration.type as any);
    });

    if (shapeDecorationIds.length > 0) {
      dispatch({
        type: 'UPDATE_DECORATIONS',
        diagramId: selectedDiagramId,
        decorationIds: shapeDecorationIds,
        updates: { text_h_align: align },
      });
    }
  }, [dispatch, selectedDiagramId, selectedDecorationIds, decorations]);

  const handleDecorationVAlignChange = useCallback((align: DecorationVAlign) => {
    if (!selectedDiagramId) return;

    const shapeDecorationIds = Array.from(selectedDecorationIds).filter(decorationId => {
      const decoration = decorations.find(d => d.id === decorationId);
      return decoration && SHAPE_DECORATION_TYPES.includes(decoration.type as any);
    });

    if (shapeDecorationIds.length > 0) {
      dispatch({
        type: 'UPDATE_DECORATIONS',
        diagramId: selectedDiagramId,
        decorationIds: shapeDecorationIds,
        updates: { text_v_align: align },
      });
    }
  }, [dispatch, selectedDiagramId, selectedDecorationIds, decorations]);

  // Colour Change Handlers
  const handleBackgroundColourChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const colour = e.target.value;

    if (selectedNodeIds.size > 0) {
      updateSelectedNodes({ background_color: colour });
    }

    if (selectedDecorationIds.size > 0) {
      const shapeDecorationIds = Array.from(selectedDecorationIds).filter(decorationId => {
        const decoration = decorations.find(d => d.id === decorationId);
        return decoration && SHAPE_DECORATION_TYPES.includes(decoration.type as any);
      });

      if (shapeDecorationIds.length > 0 && selectedDiagramId) {
        dispatch({
          type: 'UPDATE_DECORATIONS',
          diagramId: selectedDiagramId,
          decorationIds: shapeDecorationIds,
          updates: { background_color: colour },
        });
      }
    }
  }, [selectedNodeIds.size, selectedDecorationIds, decorations, selectedDiagramId, dispatch, updateSelectedNodes]);

  const handleLineColourChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const colour = e.target.value;

    if (selectedNodeIds.size > 0) {
      updateSelectedNodes({ line_color: colour });
    }
    if (selectedEdgeIds.size > 0) {
      updateSelectedEdges({ line_color: colour });
    }
    if (selectedDecorationIds.size > 0) {
      updateSelectedDecorations({ line_color: colour });
    }
  }, [selectedNodeIds.size, selectedEdgeIds.size, selectedDecorationIds.size, updateSelectedNodes, updateSelectedEdges, updateSelectedDecorations]);

  const handleTextColourChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const colour = e.target.value;

    if (selectedNodeIds.size > 0) {
      updateSelectedNodes({ text_color: colour });
    }
    if (selectedEdgeIds.size > 0) {
      updateSelectedEdges({ text_color: colour });
    }
    if (selectedDecorationIds.size > 0) {
      updateSelectedDecorations({ text_color: colour });
    }
  }, [selectedNodeIds.size, selectedEdgeIds.size, selectedDecorationIds.size, updateSelectedNodes, updateSelectedEdges, updateSelectedDecorations]);

  // Button click handlers to trigger colour pickers
  const handleBackgroundButtonClick = useCallback(() => {
    if (!isBackgroundDisabled && backgroundColourRef.current) {
      backgroundColourRef.current.click();
    }
  }, [isBackgroundDisabled]);

  const handleLineButtonClick = useCallback(() => {
    if (lineColourRef.current) {
      lineColourRef.current.click();
    }
  }, []);

  const handleTextButtonClick = useCallback(() => {
    if (textColourRef.current) {
      textColourRef.current.click();
    }
  }, []);

  // =========================================
  // Spec: Export Diagrams as SVG - Export Handlers
  // =========================================

  /**
   * Handle export of current diagram as SVG
   * Downloads the SVG file to the browser
   */
  const handleExportCurrentAsSvg = useCallback(async () => {
    if (!selectedDiagramId || !state.loadedFileName || isExporting) return;

    setIsExporting(true);
    setExportError(null);

    try {
      const response = await exportDiagramAsSvg(state.loadedFileName, selectedDiagramId);
      const blob = await response.blob();

      // Parse filename from Content-Disposition header
      const contentDisposition = response.headers.get('Content-Disposition');
      const downloadFileName = parseContentDispositionFilename(
        contentDisposition,
        `diagram_${selectedDiagramId}.svg`
      );

      // Create blob URL and trigger download
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = downloadFileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to export diagram';
      setExportError(errorMessage);
      console.error('Export error:', err);
    } finally {
      setIsExporting(false);
    }
  }, [selectedDiagramId, state.loadedFileName, isExporting]);

  /**
   * Handle export of all diagrams as ZIP
   * Downloads a ZIP archive containing all diagram SVGs
   */
  const handleExportAllAsSvg = useCallback(async () => {
    if (!state.loadedFileName || isExporting) return;

    setIsExporting(true);
    setExportError(null);

    try {
      const response = await exportAllDiagramsAsZip(state.loadedFileName);
      const blob = await response.blob();

      // Parse filename from Content-Disposition header
      const contentDisposition = response.headers.get('Content-Disposition');
      const downloadFileName = parseContentDispositionFilename(
        contentDisposition,
        'diagrams_export.zip'
      );

      // Create blob URL and trigger download
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = downloadFileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to export diagrams';
      setExportError(errorMessage);
      console.error('Export error:', err);
    } finally {
      setIsExporting(false);
    }
  }, [state.loadedFileName, isExporting]);

  // =========================================
  // Task Group 2: Position Control Handlers
  // =========================================

  // Generic position update function
  const applyPositionUpdate = useCallback((updates: Partial<DiagramNode>) => {
    if (!selectedDiagramId) return;

    if (selectedNodeIds.size === 1) {
      const nodeId = Array.from(selectedNodeIds)[0];
      dispatch({
        type: 'UPDATE_DIAGRAM_NODE',
        diagramId: selectedDiagramId,
        nodeId,
        updates,
      });
    } else if (selectedDecorationIds.size === 1) {
      const decorationId = Array.from(selectedDecorationIds)[0];
      dispatch({
        type: 'UPDATE_DECORATION',
        diagramId: selectedDiagramId,
        decorationId,
        updates: updates as Partial<Decoration>,
      });
    }
  }, [dispatch, selectedDiagramId, selectedNodeIds, selectedDecorationIds]);

  // Position X handlers
  const handlePosXFocus = useCallback(() => {
    setIsEditingPosX(true);
    setPosXInputValue(positionValues.posX !== null ? String(positionValues.posX) : '');
  }, [positionValues.posX]);

  const handlePosXChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setPosXInputValue(e.target.value);
  }, []);

  const handlePosXBlur = useCallback(() => {
    setIsEditingPosX(false);
    const parsed = parseInt(posXInputValue, 10);
    if (!isNaN(parsed)) {
      const clamped = clampPosition(parsed);
      applyPositionUpdate({ pos_x: clamped });
    }
    setPosXInputValue('');
  }, [posXInputValue, applyPositionUpdate]);

  const handlePosXKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      (e.target as HTMLInputElement).blur();
    } else if (e.key === 'Escape') {
      setIsEditingPosX(false);
      setPosXInputValue('');
    }
  }, []);

  // Position Y handlers
  const handlePosYFocus = useCallback(() => {
    setIsEditingPosY(true);
    setPosYInputValue(positionValues.posY !== null ? String(positionValues.posY) : '');
  }, [positionValues.posY]);

  const handlePosYChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setPosYInputValue(e.target.value);
  }, []);

  const handlePosYBlur = useCallback(() => {
    setIsEditingPosY(false);
    const parsed = parseInt(posYInputValue, 10);
    if (!isNaN(parsed)) {
      const clamped = clampPosition(parsed);
      applyPositionUpdate({ pos_y: clamped });
    }
    setPosYInputValue('');
  }, [posYInputValue, applyPositionUpdate]);

  const handlePosYKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      (e.target as HTMLInputElement).blur();
    } else if (e.key === 'Escape') {
      setIsEditingPosY(false);
      setPosYInputValue('');
    }
  }, []);

  // Width handlers
  const handleWidthFocus = useCallback(() => {
    setIsEditingWidth(true);
    setWidthInputValue(positionValues.width !== null ? String(positionValues.width) : '');
  }, [positionValues.width]);

  const handleWidthChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setWidthInputValue(e.target.value);
  }, []);

  const handleWidthBlur = useCallback(() => {
    setIsEditingWidth(false);
    const parsed = parseInt(widthInputValue, 10);
    if (!isNaN(parsed)) {
      const clamped = clampSize(parsed);
      applyPositionUpdate({ width: clamped });
    }
    setWidthInputValue('');
  }, [widthInputValue, applyPositionUpdate]);

  const handleWidthKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      (e.target as HTMLInputElement).blur();
    } else if (e.key === 'Escape') {
      setIsEditingWidth(false);
      setWidthInputValue('');
    }
  }, []);

  // Height handlers
  const handleHeightFocus = useCallback(() => {
    setIsEditingHeight(true);
    setHeightInputValue(positionValues.height !== null ? String(positionValues.height) : '');
  }, [positionValues.height]);

  const handleHeightChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setHeightInputValue(e.target.value);
  }, []);

  const handleHeightBlur = useCallback(() => {
    setIsEditingHeight(false);
    const parsed = parseInt(heightInputValue, 10);
    if (!isNaN(parsed)) {
      const clamped = clampSize(parsed);
      applyPositionUpdate({ height: clamped });
    }
    setHeightInputValue('');
  }, [heightInputValue, applyPositionUpdate]);

  const handleHeightKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      (e.target as HTMLInputElement).blur();
    } else if (e.key === 'Escape') {
      setIsEditingHeight(false);
      setHeightInputValue('');
    }
  }, []);

  // Stroke handlers
  const applyStrokeUpdate = useCallback((value: number) => {
    if (!selectedDiagramId) return;
    const lineWeight = `${value}px`;

    if (selectedNodeIds.size === 1) {
      dispatch({
        type: 'UPDATE_DIAGRAM_NODE',
        diagramId: selectedDiagramId,
        nodeId: Array.from(selectedNodeIds)[0],
        updates: { line_weight: lineWeight },
      });
    } else if (selectedEdgeIds.size === 1) {
      dispatch({
        type: 'UPDATE_DIAGRAM_EDGE',
        diagramId: selectedDiagramId,
        edgeId: Array.from(selectedEdgeIds)[0],
        updates: { line_weight: lineWeight },
      });
    } else if (selectedDecorationIds.size === 1) {
      dispatch({
        type: 'UPDATE_DECORATION',
        diagramId: selectedDiagramId,
        decorationId: Array.from(selectedDecorationIds)[0],
        updates: { line_weight: lineWeight },
      });
    }
  }, [dispatch, selectedDiagramId, selectedNodeIds, selectedEdgeIds, selectedDecorationIds]);

  const handleStrokeFocus = useCallback(() => {
    setIsEditingStroke(true);
    setStrokeInputValue(strokeValue !== null ? String(strokeValue) : '');
  }, [strokeValue]);

  const handleStrokeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setStrokeInputValue(e.target.value);
  }, []);

  const handleStrokeBlur = useCallback(() => {
    setIsEditingStroke(false);
    const parsed = parseFloat(strokeInputValue);
    if (!isNaN(parsed) && parsed > 0) {
      const clamped = Math.max(0.5, Math.min(20, parsed));
      applyStrokeUpdate(clamped);
    }
    setStrokeInputValue('');
  }, [strokeInputValue, applyStrokeUpdate]);

  const handleStrokeKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      (e.target as HTMLInputElement).blur();
    } else if (e.key === 'Escape') {
      setIsEditingStroke(false);
      setStrokeInputValue('');
    }
  }, []);

  // Sync stroke input when selection changes
  React.useEffect(() => {
    setStrokeInputValue(strokeValue !== null ? String(strokeValue) : '');
  }, [strokeValue]);

  const zoomPercentage = Math.round(zoom * 100);

  // Task Group 2: Compute Row 2 control states
  const isDecreaseDisabled = commonFontSize !== null && commonFontSize <= 1;
  const isIncreaseDisabled = commonFontSize !== null && commonFontSize >= 99;

  // Determine font style toggle active states
  const isBoldActive = allHaveFontWeight('bold', selectedNodeIds, selectedEdgeIds, selectedDecorationIds, nodes, edges, decorations) && hasSelection;
  const isItalicActive = allHaveFontStyle('italic', selectedNodeIds, selectedEdgeIds, selectedDecorationIds, nodes, edges, decorations) && hasSelection;
  const isUnderlineActive = allHaveTextDecoration('underline', selectedNodeIds, selectedEdgeIds, selectedDecorationIds, nodes, edges, decorations) && hasSelection;

  // Row 2 should only be visible in Diagram view (not Meta-model view)
  // Spec 2026-03-26: Hide Row 2 when in temporary diagram mode
  const showRow2 = currentView === 'diagrams' && diagram !== undefined && !temporaryDiagramState.active && !journeyReview.active && !overviewReview.active;

  // Task Group 1: Determine if this is a Sequence diagram for conditional panel rendering
  const isSequenceDiagram = getDiagramType(diagram) === 'Sequence';

  // UI Architecture Phase 1 Increment 2: Determine if this is a UI_SCREEN diagram
  const isUIScreenDiagram = getDiagramType(diagram) === 'UI_SCREEN';

  // Spec 2026-05-05 Task Group 3: Determine if this is an Infrastructure (V2 auto-laid-out) diagram
  const isInfrastructureDiagram = getDiagramType(diagram) === 'Infrastructure';

  // Task Group 4 (A3): Get current flow for condition modal
  const currentFlowForModal = conditionModalState.flowId
    ? getActivityFlowById(conditionModalState.flowId)
    : null;

  return (
    <div className={styles.container}>
      {/* Header bar with toolbar rows */}
      <div className={styles.headerBar}>
        {/* Row 1: Diagram selection, New Diagram, Period, Zoom controls
         * Task Group 1: Row 1 Structure and Vertical Dividers
         * Layout: Diagram Selection | New Diagram Controls | DIVIDER | Period Controls | DIVIDER | Zoom Controls
         */}
        <div className={styles.toolbarRow1}>
          {/* Spec 2026-03-26: Task 4.4/4.5 - Conditional rendering for temporary diagram mode */}
          {temporaryDiagramState.active ? (
            <>
              {/* Task 4.5: Temporary diagram banner */}
              <div data-testid="temporary-diagram-banner" style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                flex: 1,
              }}>
                <span style={{
                  background: '#E3F2FD',
                  color: '#1565C0',
                  padding: '4px 10px',
                  borderRadius: '4px',
                  fontSize: '12px',
                  fontWeight: 600,
                  letterSpacing: '0.5px',
                  textTransform: 'uppercase',
                }}>
                  Preview
                </span>
                {temporaryDiagramState.data && (
                  <span style={{ fontSize: '14px', fontWeight: 500, color: '#333' }}>
                    {temporaryDiagramState.data.name}
                  </span>
                )}
                <button
                  data-testid="temporary-diagram-close-button"
                  onClick={handleCloseTemporaryDiagram}
                  style={{
                    padding: '6px 12px',
                    border: '1px solid #ddd',
                    background: 'white',
                    borderRadius: '4px',
                    fontSize: '12px',
                    cursor: 'pointer',
                    marginLeft: '8px',
                  }}
                >
                  Back to Diagrams
                </button>
              </div>
            </>
          ) : journeyReview.active && journeyReview.selectedIndex !== null ? (
            <>
              {/* Unified banner for both journey and overview diagrams */}
              <JourneyReviewBanner
                journey={journeyReview.isOverview
                  ? { id: '', name: `${journeyReview.currentOverview?.overview?.business_user_name || 'Unknown'} — Journey Overview`, description: '', user_role_id: '', user_role_name: '', parent_business_process_id: '', parent_business_process_name: '' }
                  : journeyReview.currentJourney!.journey
                }
                selectedIndex={journeyReview.selectedIndex}
                totalJourneys={journeyReview.totalCount}
                onPrevious={journeyReview.selectPrevious}
                onNext={journeyReview.selectNext}
                onReturnToChooser={journeyReview.returnToChooser}
                onSaveAsDiagram={journeyReview.isOverview ? handleSaveOverviewFromReview : () => setShowSaveJourneyModal(true)}
                onSaveAllAsDiagrams={handleSaveAllDiagrams}
                isSaved={journeyReview.savedIndices.has(journeyReview.selectedIndex)}
                allSaved={journeyReview.savedIndices.size >= journeyReview.totalCount}
                onSaveAllAsPdf={handleSaveAllAsPdf}
                pdfProgress={pdfProgress}
                onCloseReview={() => {
                  const prevView = journeyReview.previousView;
                  journeyReview.closeReviewSession();
                  // Spec 2026-05-02 Multi-Architecture Selector + URL Routing -- Task Group 4
                  if (prevView && activeProject?.id && activeArchitectureId) {
                    navigate(`/projects/${activeProject.id}/architectures/${activeArchitectureId}/${prevView}`);
                  }
                }}
              />
            </>
          ) : journeyReview.active ? (
            <>
              {/* Journey Chooser mode header */}
              <div data-testid="journey-chooser-banner" style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                flex: 1,
              }}>
                <span style={{
                  background: '#E3F2FD',
                  color: '#1565C0',
                  padding: '4px 10px',
                  borderRadius: '4px',
                  fontSize: '12px',
                  fontWeight: 600,
                  letterSpacing: '0.5px',
                  textTransform: 'uppercase' as const,
                }}>
                  Preview
                </span>
                <span style={{ fontSize: '14px', fontWeight: 500, color: '#333' }}>
                  User Journey Review
                </span>
                <button
                  data-testid="journey-chooser-close"
                  onClick={() => {
                    const prevView = journeyReview.previousView;
                    journeyReview.closeReviewSession();
                    // Spec 2026-05-02 Multi-Architecture Selector + URL Routing -- Task Group 4
                  if (prevView && activeProject?.id && activeArchitectureId) {
                    navigate(`/projects/${activeProject.id}/architectures/${activeArchitectureId}/${prevView}`);
                  }
                  }}
                  style={{
                    padding: '6px 12px',
                    border: '1px solid #ddd',
                    background: 'white',
                    borderRadius: '4px',
                    fontSize: '12px',
                    cursor: 'pointer',
                    marginLeft: '8px',
                  }}
                >
                  Close Review
                </button>
              </div>
            </>
          ) : overviewReview.active ? (
            <>
              {/* Overview Review Banner (standalone) */}
              <OverviewReviewBanner
                overviewDiagram={overviewReview.overviewDiagram!}
                isSaved={overviewReview.saved}
                onSaveAsDiagram={handleSaveOverviewDiagram}
                onDiscard={() => {
                  const prevView = overviewReview.previousView;
                  overviewReview.closeOverviewReview();
                  // Spec 2026-05-02 Multi-Architecture Selector + URL Routing -- Task Group 4
                  if (prevView && activeProject?.id && activeArchitectureId) {
                    navigate(`/projects/${activeProject.id}/architectures/${activeArchitectureId}/${prevView}`);
                  }
                }}
              />
            </>
          ) : (
            <>
              {/* Section A: Diagram Selection (normal mode) */}
              <div className={styles.diagramSelectionSection}>
                <label className={styles.selectorLabel}>Current:</label>
                {/* DiagramSelector is always visible - it handles both empty and populated states */}
                <DiagramSelector />
              </div>

              {/* Spec 2026-04-07: Generate Journey Overview entry point */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: '8px', position: 'relative' }}>
                <button
                  data-testid="generate-overview-button"
                  onClick={() => setShowOverviewSelector(!showOverviewSelector)}
                  style={{
                    padding: '6px 12px',
                    border: '1px solid #ddd',
                    background: 'white',
                    borderRadius: '4px',
                    fontSize: '12px',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap' as const,
                  }}
                >
                  Generate Journey Overview
                </button>
                {showOverviewSelector && (
                  <div
                    data-testid="overview-business-user-selector"
                    style={{
                      position: 'absolute',
                      top: '100%',
                      left: 0,
                      marginTop: '4px',
                      background: 'white',
                      border: '1px solid #ddd',
                      borderRadius: '4px',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                      padding: '12px',
                      zIndex: 1000,
                      minWidth: '260px',
                    }}
                  >
                    <label style={{ fontSize: '12px', fontWeight: 500, color: '#333', display: 'block', marginBottom: '6px' }}>
                      Select Business User:
                    </label>
                    <select
                      data-testid="overview-business-user-dropdown"
                      value={overviewSelectedBusinessUserId}
                      onChange={(e) => setOverviewSelectedBusinessUserId(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '6px 8px',
                        border: '1px solid #ddd',
                        borderRadius: '4px',
                        fontSize: '12px',
                        marginBottom: '8px',
                      }}
                    >
                      <option value="">-- Select --</option>
                      {(state.model.metaModel?.entities?.business_users || []).map((bu: any) => (
                        <option key={bu.id} value={bu.id}>{bu.name}</option>
                      ))}
                    </select>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        data-testid="overview-generate-confirm"
                        onClick={() => {
                          if (activeProject?.id && overviewSelectedBusinessUserId) {
                            handleGenerateOverview(activeProject.id, overviewSelectedBusinessUserId);
                          }
                        }}
                        disabled={!overviewSelectedBusinessUserId || overviewGenerating}
                        style={{
                          padding: '6px 12px',
                          border: 'none',
                          background: overviewSelectedBusinessUserId && !overviewGenerating ? '#1565C0' : '#ccc',
                          color: 'white',
                          borderRadius: '4px',
                          fontSize: '12px',
                          cursor: overviewSelectedBusinessUserId && !overviewGenerating ? 'pointer' : 'default',
                          fontWeight: 500,
                        }}
                      >
                        {overviewGenerating ? 'Generating...' : 'Generate'}
                      </button>
                      <button
                        data-testid="overview-selector-cancel"
                        onClick={() => {
                          setShowOverviewSelector(false);
                          setOverviewSelectedBusinessUserId('');
                        }}
                        style={{
                          padding: '6px 12px',
                          border: '1px solid #ddd',
                          background: 'white',
                          borderRadius: '4px',
                          fontSize: '12px',
                          cursor: 'pointer',
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Spec 2026-04-03: Sync Status Banner for saved USER_JOURNEY v2 diagrams */}
          {!temporaryDiagramState.active && !journeyReview.active && !overviewReview.active && diagram &&
            diagram.diagram_type === 'USER_JOURNEY' &&
            diagram.typedContent?.version === 2 &&
            syncStatusHook.syncStatus !== null && (
            <SyncStatusBanner
              syncStatus={syncStatusHook.syncStatus as any}
              staleReason={syncStatusHook.staleReason}
              isLoading={syncStatusHook.isLoading}
              onRefresh={handleSyncRefresh}
            />
          )}

          {/* Vertical divider after New/Copy section (included in DiagramSelector)
           * Task 1.3: Add vertical dividers after New/Copy section and after Period section
           */}
          {!temporaryDiagramState.active && !journeyReview.active && !overviewReview.active && <div className={styles.verticalDivider} />}

          {/* Section C: Period/Time Controls */}
          {!temporaryDiagramState.active && !journeyReview.active && !overviewReview.active && diagram && (
            <div className={styles.periodSection}>
              <TimeNavigationControls
                currentQuarter={diagram.view_quarter || getDefaultViewQuarter()}
                onNavigate={handleTimeNavigate}
              />
            </div>
          )}

          {/* Vertical divider after Period section */}
          {!temporaryDiagramState.active && !journeyReview.active && diagram && <div className={styles.verticalDivider} />}

          {/* Section D: Zoom Controls - shown in both normal and temporary diagram modes */}
          {(diagram || temporaryDiagramState.active || journeyReview.active || overviewReview.active) && (
            <div className={styles.zoomSection}>
              <button className={styles.zoomButton} onClick={handleZoomIn}>
                +
              </button>
              <span className={styles.zoomLevel}>{zoomPercentage}%</span>
              <button className={styles.zoomButton} onClick={handleZoomOut}>
                -
              </button>
              <button className={styles.fitButton} onClick={handleFitToView}>
                Fit to View
              </button>

              {/* Spec: Export Diagrams as SVG - Export Section */}
              {!temporaryDiagramState.active && !journeyReview.active && !overviewReview.active && <>
              <div className={styles.verticalDivider} />
              <div className={styles.exportSection}>
                <button
                  className={styles.exportButton}
                  onClick={handleExportCurrentAsSvg}
                  disabled={!selectedDiagramId || !state.loadedFileName || isExporting}
                  title="Export current diagram as SVG"
                >
                  {isExporting ? 'Exporting...' : 'Export Current SVG'}
                </button>
                <button
                  className={styles.exportButton}
                  onClick={handleExportAllAsSvg}
                  disabled={!state.model.diagrams?.length || !state.loadedFileName || isExporting}
                  title="Export all diagrams as ZIP"
                >
                  {isExporting ? 'Exporting...' : 'Export All SVG'}
                </button>
                {exportError && (
                  <span className={styles.exportError}>{exportError}</span>
                )}
              </div>
              </>}
            </div>
          )}
        </div>

        {/* Row 2: Styling Controls
         * Task Group 2: Row 2 Styling Controls Toolbar
         * Layout: FONT SIZE | DIVIDER | FONT STYLES | DIVIDER | BOX ALIGNMENT | DIVIDER | COLOUR | DIVIDER | POSITION
         * Only visible in Diagram view (not Meta-model view)
         */}
        {showRow2 && (
          <div className={styles.toolbarRow2}>
            {/* Section A: Font Size */}
            <div className={styles.row2Section}>
              <span className={styles.row2SectionLabel}>FONT SIZE</span>
              <div className={styles.row2Controls}>
                <button
                  className={styles.row2Button}
                  onClick={handleFontSizeDecrease}
                  disabled={!hasSelection || isDecreaseDisabled}
                  title="Decrease font size"
                >
                  -
                </button>
                <input
                  type="text"
                  className={styles.row2FontSizeInput}
                  value={isEditingFontSize ? fontSizeInputValue : (commonFontSize !== null ? String(commonFontSize) : '')}
                  placeholder={!hasSelection ? '-' : (commonFontSize === null ? '-' : '')}
                  onChange={handleFontSizeInputChange}
                  onFocus={handleFontSizeInputFocus}
                  onBlur={handleFontSizeInputBlur}
                  onKeyDown={handleFontSizeInputKeyDown}
                  disabled={!hasSelection}
                />
                <button
                  className={styles.row2Button}
                  onClick={handleFontSizeIncrease}
                  disabled={!hasSelection || isIncreaseDisabled}
                  title="Increase font size"
                >
                  +
                </button>
                <span className={styles.row2UnitLabel}>px</span>
              </div>
            </div>

            {/* Vertical divider after Font Size */}
            <div className={styles.verticalDivider} />

            {/* Section B: Font Styles */}
            <div className={styles.row2Section}>
              <span className={styles.row2SectionLabel}>FONT STYLES</span>
              <div className={styles.row2Controls}>
                <button
                  className={`${styles.row2ToggleButton} ${styles.row2ToggleBold} ${isBoldActive ? styles.row2ToggleActive : ''}`}
                  onClick={handleBoldToggle}
                  disabled={!hasSelection}
                  title="Bold (font-weight: bold)"
                >
                  B
                </button>
                <button
                  className={`${styles.row2ToggleButton} ${styles.row2ToggleItalic} ${isItalicActive ? styles.row2ToggleActive : ''}`}
                  onClick={handleItalicToggle}
                  disabled={!hasSelection}
                  title="Italic (font-style: italic)"
                >
                  I
                </button>
                <button
                  className={`${styles.row2ToggleButton} ${styles.row2ToggleUnderline} ${isUnderlineActive ? styles.row2ToggleActive : ''}`}
                  onClick={handleUnderlineToggle}
                  disabled={!hasSelection}
                  title="Underline (text-decoration: underline)"
                >
                  U
                </button>
              </div>
            </div>

            {/* Vertical divider after Font Styles */}
            <div className={styles.verticalDivider} />

            {/* Section C: Box Alignment */}
            <div className={styles.row2Section}>
              <span className={styles.row2SectionLabel}>BOX ALIGNMENT</span>
              <div className={styles.row2AlignmentControls}>
                {/* Horizontal Alignment */}
                <div className={styles.row2AlignmentGroup}>
                  <span className={styles.row2AlignmentLabel}>H:</span>
                  <div className={styles.row2AlignmentButtons}>
                    <button
                      className={`${styles.row2AlignButton} ${(showNodeAlignmentControls && commonHAlign === 'LEFT') || (showDecorationAlignmentControls && commonDecorationHAlign === 'LEFT') ? styles.row2AlignButtonActive : ''}`}
                      onClick={() => {
                        if (showNodeAlignmentControls) handleHAlignChange('LEFT');
                        if (showDecorationAlignmentControls) handleDecorationHAlignChange('LEFT');
                      }}
                      disabled={!showNodeAlignmentControls && !showDecorationAlignmentControls}
                      title="Align left"
                    >
                      L
                    </button>
                    <button
                      className={`${styles.row2AlignButton} ${(showNodeAlignmentControls && commonHAlign === 'CENTER') || (showDecorationAlignmentControls && commonDecorationHAlign === 'CENTER') ? styles.row2AlignButtonActive : ''}`}
                      onClick={() => {
                        if (showNodeAlignmentControls) handleHAlignChange('CENTER');
                        if (showDecorationAlignmentControls) handleDecorationHAlignChange('CENTER');
                      }}
                      disabled={!showNodeAlignmentControls && !showDecorationAlignmentControls}
                      title="Align center"
                    >
                      C
                    </button>
                    <button
                      className={`${styles.row2AlignButton} ${(showNodeAlignmentControls && commonHAlign === 'RIGHT') || (showDecorationAlignmentControls && commonDecorationHAlign === 'RIGHT') ? styles.row2AlignButtonActive : ''}`}
                      onClick={() => {
                        if (showNodeAlignmentControls) handleHAlignChange('RIGHT');
                        if (showDecorationAlignmentControls) handleDecorationHAlignChange('RIGHT');
                      }}
                      disabled={!showNodeAlignmentControls && !showDecorationAlignmentControls}
                      title="Align right"
                    >
                      R
                    </button>
                  </div>
                </div>

                {/* Vertical Alignment */}
                <div className={styles.row2AlignmentGroup}>
                  <span className={styles.row2AlignmentLabel}>V:</span>
                  <div className={styles.row2AlignmentButtons}>
                    <button
                      className={`${styles.row2AlignButton} ${(showNodeAlignmentControls && commonVAlign === 'TOP') || (showDecorationAlignmentControls && commonDecorationVAlign === 'TOP') ? styles.row2AlignButtonActive : ''}`}
                      onClick={() => {
                        if (showNodeAlignmentControls) handleVAlignChange('TOP');
                        if (showDecorationAlignmentControls) handleDecorationVAlignChange('TOP');
                      }}
                      disabled={!showNodeAlignmentControls && !showDecorationAlignmentControls}
                      title="Align top"
                    >
                      T
                    </button>
                    <button
                      className={`${styles.row2AlignButton} ${(showNodeAlignmentControls && commonVAlign === 'MIDDLE') || (showDecorationAlignmentControls && commonDecorationVAlign === 'MIDDLE') ? styles.row2AlignButtonActive : ''}`}
                      onClick={() => {
                        if (showNodeAlignmentControls) handleVAlignChange('MIDDLE');
                        if (showDecorationAlignmentControls) handleDecorationVAlignChange('MIDDLE');
                      }}
                      disabled={!showNodeAlignmentControls && !showDecorationAlignmentControls}
                      title="Align middle"
                    >
                      M
                    </button>
                    <button
                      className={`${styles.row2AlignButton} ${(showNodeAlignmentControls && commonVAlign === 'BOTTOM') || (showDecorationAlignmentControls && commonDecorationVAlign === 'BOTTOM') ? styles.row2AlignButtonActive : ''}`}
                      onClick={() => {
                        if (showNodeAlignmentControls) handleVAlignChange('BOTTOM');
                        if (showDecorationAlignmentControls) handleDecorationVAlignChange('BOTTOM');
                      }}
                      disabled={!showNodeAlignmentControls && !showDecorationAlignmentControls}
                      title="Align bottom"
                    >
                      B
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Vertical divider after Box Alignment */}
            <div className={styles.verticalDivider} />

            {/* Section D: Colour */}
            <div className={styles.row2Section}>
              <span className={styles.row2SectionLabel}>COLOUR</span>
              <div className={styles.row2Controls}>
                {/* Background colour button - filled square icon */}
                <button
                  className={`${styles.row2ColourButton} ${(!hasSelection || isBackgroundDisabled) ? styles.row2ColourButtonDisabled : ''}`}
                  onClick={handleBackgroundButtonClick}
                  title="Set background colour"
                  disabled={!hasSelection || isBackgroundDisabled}
                >
                  {/* Filled square icon representing background/fill */}
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                    <rect x="1" y="1" width="12" height="12" rx="1" />
                  </svg>
                </button>

                {/* Line/border colour button - square outline icon */}
                <button
                  className={`${styles.row2ColourButton} ${!hasSelection ? styles.row2ColourButtonDisabled : ''}`}
                  onClick={handleLineButtonClick}
                  title="Set line/border colour"
                  disabled={!hasSelection}
                >
                  {/* Square outline icon representing line/border */}
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="2" y="2" width="10" height="10" rx="1" />
                  </svg>
                </button>

                {/* Text colour button - "A" letter icon */}
                <button
                  className={`${styles.row2ColourButton} ${!hasSelection ? styles.row2ColourButtonDisabled : ''}`}
                  onClick={handleTextButtonClick}
                  title="Set text colour"
                  disabled={!hasSelection}
                >
                  {/* "A" letter icon representing text colour */}
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                    <text x="7" y="11" textAnchor="middle" fontSize="11" fontWeight="bold">A</text>
                    <rect x="2" y="12" width="10" height="2" rx="0.5" />
                  </svg>
                </button>
              </div>

              {/* Hidden colour inputs */}
              <input
                ref={backgroundColourRef}
                type="color"
                className={styles.hiddenColourInput}
                onChange={handleBackgroundColourChange}
                defaultValue="#ffffff"
              />
              <input
                ref={lineColourRef}
                type="color"
                className={styles.hiddenColourInput}
                onChange={handleLineColourChange}
                defaultValue="#333333"
              />
              <input
                ref={textColourRef}
                type="color"
                className={styles.hiddenColourInput}
                onChange={handleTextColourChange}
                defaultValue="#333333"
              />
            </div>

            {/* Vertical divider after Colour */}
            <div className={styles.verticalDivider} />

            {/* Section E: Position
             * Task Group 2: POSITION Controls
             * Shows X, Y, W, H inputs for single node or shape decoration selection
             */}
            <div className={styles.row2Section}>
              <span className={styles.row2SectionLabel}>POSITION</span>
              <div className={styles.row2Controls}>
                {/* X position */}
                <span className={styles.row2PositionLabel}>X:</span>
                <input
                  type="text"
                  className={styles.row2PositionInput}
                  value={isEditingPosX ? posXInputValue : (positionValues.posX !== null ? String(positionValues.posX) : '')}
                  placeholder={!positionControlsEnabled ? '-' : ''}
                  onChange={handlePosXChange}
                  onFocus={handlePosXFocus}
                  onBlur={handlePosXBlur}
                  onKeyDown={handlePosXKeyDown}
                  disabled={!positionControlsEnabled}
                  title="X position (0-9999)"
                />

                {/* Y position */}
                <span className={styles.row2PositionLabel}>Y:</span>
                <input
                  type="text"
                  className={styles.row2PositionInput}
                  value={isEditingPosY ? posYInputValue : (positionValues.posY !== null ? String(positionValues.posY) : '')}
                  placeholder={!positionControlsEnabled ? '-' : ''}
                  onChange={handlePosYChange}
                  onFocus={handlePosYFocus}
                  onBlur={handlePosYBlur}
                  onKeyDown={handlePosYKeyDown}
                  disabled={!positionControlsEnabled}
                  title="Y position (0-9999)"
                />

                {/* Width */}
                <span className={styles.row2PositionLabel}>W:</span>
                <input
                  type="text"
                  className={styles.row2PositionInput}
                  value={isEditingWidth ? widthInputValue : (positionValues.width !== null ? String(positionValues.width) : '')}
                  placeholder={!positionControlsEnabled ? '-' : ''}
                  onChange={handleWidthChange}
                  onFocus={handleWidthFocus}
                  onBlur={handleWidthBlur}
                  onKeyDown={handleWidthKeyDown}
                  disabled={!positionControlsEnabled}
                  title="Width (1-9999)"
                />

                {/* Height */}
                <span className={styles.row2PositionLabel}>H:</span>
                <input
                  type="text"
                  className={styles.row2PositionInput}
                  value={isEditingHeight ? heightInputValue : (positionValues.height !== null ? String(positionValues.height) : '')}
                  placeholder={!positionControlsEnabled ? '-' : ''}
                  onChange={handleHeightChange}
                  onFocus={handleHeightFocus}
                  onBlur={handleHeightBlur}
                  onKeyDown={handleHeightKeyDown}
                  disabled={!positionControlsEnabled}
                  title="Height (1-9999)"
                />

                {/* Stroke */}
                <span className={styles.row2PositionLabel}>S:</span>
                <input
                  type="text"
                  className={styles.row2PositionInput}
                  value={isEditingStroke ? strokeInputValue : (strokeValue !== null ? String(strokeValue) : '')}
                  placeholder={!strokeControlEnabled ? '-' : ''}
                  onChange={handleStrokeChange}
                  onFocus={handleStrokeFocus}
                  onBlur={handleStrokeBlur}
                  onKeyDown={handleStrokeKeyDown}
                  disabled={!strokeControlEnabled}
                  title="Stroke width (0.5-20)"
                />
              </div>
            </div>
          </div>
        )}
      </div>

      <div className={styles.mainContent}>
        {/* Spec 2026-03-26: Hide InspectorPanel in temporary diagram mode */}
        {!temporaryDiagramState.active && !journeyReview.active && (
          <InspectorPanel
            isCollapsed={isInspectorPanelCollapsed}
            onToggleCollapse={handleToggleInspectorPanel}
            selectedDecorationIds={selectedDecorationIds}
            decorations={diagram?.decorations || []}
            addMode={decorationAddMode}
            onAddModeChange={handleDecorationAddModeChange}
            onUpdateDecorationText={handleUpdateDecorationText}
            onUpdateDecoration={handleUpdateDecoration}
          />
        )}

        {/* Canvas Container - center */}
        <div className={styles.canvasContainer} ref={canvasContainerRef}>
          {/* Spec 2026-03-26: Task 4.4 - Conditional rendering for temporary diagram mode */}
          {temporaryDiagramState.active ? (
            <>
              {/* Task 4.6: Loading state */}
              {temporaryDiagramState.loading && (
                <div data-testid="temporary-diagram-loading" className={styles.emptyMessage}>
                  Loading temporary diagram...
                </div>
              )}
              {/* Task 4.6: Error state */}
              {temporaryDiagramState.error && (
                <div data-testid="temporary-diagram-error" style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: '100%',
                  gap: '16px',
                  color: '#d32f2f',
                  padding: '24px',
                  textAlign: 'center',
                }}>
                  <span style={{ fontSize: '14px' }}>{temporaryDiagramState.error}</span>
                  <button
                    data-testid="temporary-diagram-error-close"
                    onClick={handleCloseTemporaryDiagram}
                    style={{
                      padding: '8px 16px',
                      border: '1px solid #ddd',
                      background: 'white',
                      borderRadius: '4px',
                      fontSize: '12px',
                      cursor: 'pointer',
                      color: '#333',
                    }}
                  >
                    Back to Diagrams
                  </button>
                </div>
              )}
              {/* Task 4.4: Render TemporaryDiagramRenderer when data is loaded */}
              {temporaryDiagramState.data && !temporaryDiagramState.loading && !temporaryDiagramState.error && (
                <div data-testid="temporary-diagram-canvas-wrapper" className={styles.canvas}>
                  <svg
                    width={appConfig.canvas.defaultWidth * zoom}
                    height={appConfig.canvas.defaultHeight * zoom}
                    viewBox={`0 0 ${appConfig.canvas.defaultWidth} ${appConfig.canvas.defaultHeight}`}
                    className={styles.svg}
                  >
                    {/* Background grid for visual consistency */}
                    <defs>
                      <pattern id="temp-grid" width="20" height="20" patternUnits="userSpaceOnUse">
                        <path
                          d="M 20 0 L 0 0 0 20"
                          fill="none"
                          stroke="#f0f0f0"
                          strokeWidth="0.5"
                        />
                      </pattern>
                    </defs>
                    <rect width={appConfig.canvas.defaultWidth} height={appConfig.canvas.defaultHeight} fill="url(#temp-grid)" />
                    <TemporaryDiagramRenderer
                      diagram={temporaryDiagramState.data}
                      zoom={zoom}
                    />
                  </svg>
                </div>
              )}
            </>
          ) : journeyReview.active ? (
            <>
              {/* Journey Review Mode Canvas — unified navigation */}
              {journeyReview.selectedIndex === null ? (
                <JourneyChooser
                  journeys={journeyReview.journeys}
                  onSelectJourney={journeyReview.selectJourney}
                  savedIndices={journeyReview.savedIndices}
                  overviews={journeyReview.overviews}
                  onSelectOverview={journeyReview.selectOverview}
                  savedOverviewIndices={journeyReview.savedOverviewIndices}
                  onDone={() => {
                    const prevView = journeyReview.previousView;
                    journeyReview.closeReviewSession();
                    // Spec 2026-05-02 Multi-Architecture Selector + URL Routing -- Task Group 4
                  if (prevView && activeProject?.id && activeArchitectureId) {
                    navigate(`/projects/${activeProject.id}/architectures/${activeArchitectureId}/${prevView}`);
                  }
                  }}
                />
              ) : journeyReview.isOverview && journeyReview.currentOverview ? (
                <div data-testid="overview-review-canvas-wrapper" className={styles.canvas}>
                  <svg
                    width={appConfig.canvas.defaultWidth * zoom}
                    height={appConfig.canvas.defaultHeight * zoom}
                    viewBox={`0 0 ${appConfig.canvas.defaultWidth} ${appConfig.canvas.defaultHeight}`}
                    className={styles.svg}
                  >
                    <defs>
                      <pattern id="overview-grid-review" width="20" height="20" patternUnits="userSpaceOnUse">
                        <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#f0f0f0" strokeWidth="0.5" />
                      </pattern>
                    </defs>
                    <rect width={appConfig.canvas.defaultWidth} height={appConfig.canvas.defaultHeight} fill="url(#overview-grid-review)" />
                    <UserJourneyOverviewDiagramRenderer
                      overviewData={enrichOverviewWithApps(journeyReview.currentOverview)}
                      onContentBounds={undefined}
                      onNodeClick={(node) => {
                        const status = node.link?.link_status;
                        if (status === "LINKED" || status === "AMBIGUOUS_RESOLVED") {
                          journeyReview.returnToChooser();
                          dispatch({ type: "SELECT_DIAGRAM", payload: node.link!.linked_diagram_id! });
                        } else {
                          setToastState({ visible: true, message: "No linked child diagram saved yet", type: "info" });
                        }
                      }}
                      onColleagueClick={handleColleagueClick}
                    />
                  </svg>
                </div>
              ) : journeyReview.currentJourney ? (
                <div data-testid="journey-review-canvas-wrapper" className={styles.canvas}>
                  <svg
                    width={appConfig.canvas.defaultWidth * zoom}
                    height={appConfig.canvas.defaultHeight * zoom}
                    viewBox={`0 0 ${appConfig.canvas.defaultWidth} ${appConfig.canvas.defaultHeight}`}
                    className={styles.svg}
                  >
                    <defs>
                      <pattern id="journey-grid" width="20" height="20" patternUnits="userSpaceOnUse">
                        <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#f0f0f0" strokeWidth="0.5" />
                      </pattern>
                    </defs>
                    <rect width={appConfig.canvas.defaultWidth} height={appConfig.canvas.defaultHeight} fill="url(#journey-grid)" />
                    <UserJourneyDiagramRenderer
                      diagram={enrichJourneySteps(
                        journeyReview.currentJourney,
                        state.model?.metaModel?.entities?.process_activities ?? [],
                        state.model?.metaModel?.entities?.activity_steps ?? [],
                        state.model?.metaModel?.entities?.business_users ?? [],
                      )}
                      zoom={zoom}
                      parentOverview={journeyNavProps.parentOverview}
                      linkedJourneys={journeyNavProps.linkedJourneys}
                      onParentOverviewClick={handleParentOverviewClick}
                      onLinkedJourneyClick={handleLinkedJourneyClick}
                      journeyDiagramMap={journeyDiagramMap}
                      onCoWorkerClick={handleCoWorkerClick}
                    />
                  </svg>
                </div>
              ) : null}
            </>
          ) : overviewReview.active && overviewReview.overviewDiagram ? (
            <>
              {/* Standalone Overview Review Mode Canvas */}
              <div data-testid="overview-review-canvas-wrapper" className={styles.canvas}>
                <svg
                  width={appConfig.canvas.defaultWidth * zoom}
                  height={appConfig.canvas.defaultHeight * zoom}
                  viewBox={`0 0 ${appConfig.canvas.defaultWidth} ${appConfig.canvas.defaultHeight}`}
                  className={styles.svg}
                >
                  <defs>
                    <pattern id="overview-grid" width="20" height="20" patternUnits="userSpaceOnUse">
                      <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#f0f0f0" strokeWidth="0.5" />
                    </pattern>
                  </defs>
                  <rect width={appConfig.canvas.defaultWidth} height={appConfig.canvas.defaultHeight} fill="url(#overview-grid)" />
                  <UserJourneyOverviewDiagramRenderer
                    overviewData={enrichOverviewWithApps(overviewReview.overviewDiagram)}
                    onContentBounds={undefined}
                    onNodeClick={(node) => {
                      const status = node.link?.link_status;
                      if (status === "LINKED" || status === "AMBIGUOUS_RESOLVED") {
                        overviewReview.closeOverviewReview();
                        dispatch({ type: "SELECT_DIAGRAM", payload: node.link!.linked_diagram_id! });
                      } else {
                        setToastState({ visible: true, message: "No linked child diagram saved yet", type: "info" });
                      }
                    }}
                    onColleagueClick={handleColleagueClick}
                  />
                </svg>
              </div>
            </>
          ) : (
            <>
              {state.model.diagrams.length === 0 ? (
                <div className={styles.emptyMessage}>
                  No diagrams defined in this model
                </div>
              ) : !diagram ? (
                <div className={styles.emptyMessage}>
                  Select a diagram to view
                </div>
              ) : isInfrastructureDiagram ? (
                /* Spec 2026-05-05 Task Group 3: Infrastructure V2 parallel renderer (bypasses Canvas) */
                <InfrastructureDiagramRenderer
                  diagram={diagram}
                  metaModel={state.model.metaModel}
                  dispatch={dispatch}
                  onSelect={(event) => {
                    if (event.kind === 'entity') {
                      // Route into the existing local node-selection state used by SelectionInspector arms
                      setSelectedNodeIds(new Set([event.entity_id]));
                      setSelectedEdgeIds(new Set());
                      setSelectedDecorationIds(new Set());
                    } else if (event.kind === 'relationship') {
                      // Route relationship selection into the edge-selection state (mirrors Canvas edge-select)
                      setSelectedNodeIds(new Set());
                      setSelectedEdgeIds(new Set([event.relationship_id]));
                      setSelectedDecorationIds(new Set());
                    }
                  }}
                />
              ) : (
                <>
                  <Canvas
                    diagramId={selectedDiagramId!}
                    zoom={zoom}
                    onZoomChange={handleZoomChange}
                    selectedNodeIds={selectedNodeIds}
                    selectedEdgeIds={selectedEdgeIds}
                    selectedDecorationIds={selectedDecorationIds}
                    onNodeSelect={handleNodeSelect}
                    onEdgeSelect={handleEdgeSelect}
                    onDecorationSelect={handleDecorationSelect}
                    onClearSelection={handleClearSelection}
                    onBulkSelect={handleBulkSelect}
                    decorationAddMode={decorationAddMode}
                    onDecorationAddModeChange={handleDecorationAddModeChange}
                    stickyShapeStyles={stickyShapeStyles}
                    scrollContainerRef={canvasScrollContainerRef}
                    onElementContextMenu={handleElementContextMenu}
                    onCanvasContextMenu={handleCanvasContextMenu}
                    onNewElementAdded={() => { if (!isPasteInProgressRef.current) setClipboard(null); }}
                    onUnlinkedNodeClick={() => setToastState({ visible: true, message: 'No linked child diagram saved yet', type: 'info' })}
                    onColleagueClick={handleColleagueClick}
                    journeyParentOverview={journeyNavProps.parentOverview}
                    journeyLinkedJourneys={journeyNavProps.linkedJourneys}
                    onParentOverviewClick={handleParentOverviewClick}
                    onLinkedJourneyClick={handleLinkedJourneyClick}
                    journeyDiagramMap={journeyDiagramMap}
                    onCoWorkerClick={handleCoWorkerClick}
                  />
                  {/* Task Group 4: Bottom Panel - cleaned up and empty
                   * Decoration tools have moved to InspectorPanel (left panel)
                   * This panel structure is kept for future repurposing
                   */}
                  <DecorationsPanel
                    isExpanded={isDecorationsPanelExpanded}
                    onToggleExpanded={handleToggleDecorationsPanel}
                  />
                </>
              )}
            </>
          )}
        </div>

        {/* Spec 2026-03-26: Hide right side panel in temporary diagram mode */}
        {!temporaryDiagramState.active && !journeyReview.active && !overviewReview.active && <>
        {/* Right Side Panel - Conditional rendering based on diagram type
         * Task Group 1: Wire SequenceEditorPanel for Sequence diagrams
         * - Sequence diagrams: Show SequenceEditorPanel
         * - All other diagrams (General, Activity, State, ER): Show PalettePanel
         */}
        {isInfrastructureDiagram ? (
          /* Spec 2026-05-05 Task Group 3: Infrastructure V2 has no right-side panel
           * (no palette / no inspector wiring on this side). Authoring stays in Tables UI.
           */
          null
        ) : isSequenceDiagram ? (
          <SequenceEditorPanel
            activeDiagram={diagram ?? null}
            onUpdateDiagram={handleUpdateDiagram}
            isCollapsed={isPalettePanelCollapsed}
            onToggleCollapse={handleTogglePalettePanel}
            metaModel={state.model.metaModel}
          />
        ) : isUIScreenDiagram && diagram ? (
          <UIScreenDiagramEditorPanel
            diagram={diagram}
            onUpdateDiagram={handleUpdateDiagramById}
            metaModel={state.model.metaModel}
          />
        ) : (
          <PalettePanel
            isCollapsed={isPalettePanelCollapsed}
            onToggleCollapse={handleTogglePalettePanel}
            metaModel={state.model.metaModel}
            currentDiagramId={selectedDiagramId}
            searchQuery={paletteSearchQuery}
            onSearchChange={handleSearchChange}
            sectionExpandStates={sectionExpandStates}
            onToggleSection={handleToggleSection}
            onAddNode={handleAddNode}
            onAddNodes={handleAddNodes}
            onAddEdge={handleAddEdge}
            onUpdateNode={handleUpdateNode}
            onDeleteNode={handleDeleteNode}
            onDeleteEdges={handleDeleteEdges}
            diagram={diagram}
            getViewportCenter={getViewportCenter}
            activityFlowCreationModeValue={activityFlowCreationMode}
            onActivityFlowCreationModeChange={setActivityFlowCreationMode}
            stateTransitionCreationModeValue={stateTransitionCreationMode}
            onStateTransitionCreationModeChange={setStateTransitionCreationMode}
            workflowTransitionCreationModeValue={workflowTransitionCreationMode}
            onWorkflowTransitionCreationModeChange={setWorkflowTransitionCreationMode}
          />
        )}
        </>}
      </div>

      {/* Spec 2026-03-26: Hide context menus and modals in temporary diagram mode */}
      {!temporaryDiagramState.active && !journeyReview.active && !overviewReview.active && <>
      {/* Element Context Menu - Task Group 4 */}
      <ElementContextMenu
        visible={elementContextMenu.visible}
        x={elementContextMenu.x}
        y={elementContextMenu.y}
        elementType={elementContextMenu.elementType}
        elementId={elementContextMenu.elementId}
        currentAutoSize={elementContextMenu.currentAutoSize}
        currentLinkedDiagramId={
          elementContextMenu.elementType === 'node'
            ? nodes.find(n => n.id === elementContextMenu.elementId)?.linkedDiagramId
            : elementContextMenu.elementType === 'edge'
              ? edges.find(e => e.id === elementContextMenu.elementId)?.linkedDiagramId
              : decorations.find(d => d.id === elementContextMenu.elementId)?.linkedDiagramId
        }
        onClose={handleCloseContextMenu}
        onAutoSizeToggle={handleAutoSizeToggle}
        onZIndexChange={handleZIndexChange}
        onLink={handleLink}
        onUnlink={handleUnlink}
        showAdvancedEdit={showAdvancedEdit}
        onAdvancedEdit={handleAdvancedEdit}
        onEdgeReset={handleEdgeReset}
        copyEnabled={isCopyEnabled}
        pasteEnabled={clipboard !== null}
        undoEnabled={canUndo}
        onCopy={handleCopy}
        onPaste={handlePaste}
        onUndo={undo}
      />

      {/* Canvas-level context menu (for Copy/Paste/Undo on empty space) */}
      {canvasContextMenu.visible && (
        <CanvasContextMenu
          x={canvasContextMenu.x}
          y={canvasContextMenu.y}
          copyEnabled={isCopyEnabled}
          pasteEnabled={clipboard !== null}
          undoEnabled={canUndo}
          onCopy={() => { handleCopy(); handleCloseCanvasContextMenu(); }}
          onPaste={() => { handlePaste(); handleCloseCanvasContextMenu(); }}
          onUndo={() => { undo(); handleCloseCanvasContextMenu(); }}
          onClose={handleCloseCanvasContextMenu}
        />
      )}

      {/* Advanced Edit Dialog */}
      {advancedEditDialogState.isOpen && advancedEditDialogState.rootEntity && state.model.metaModel && (
        <AdvancedAddDialog
          isOpen={advancedEditDialogState.isOpen}
          onClose={handleAdvancedEditClose}
          onAdd={handleAdvancedEditConfirm}
          rootEntity={advancedEditDialogState.rootEntity}
          metaModel={state.model.metaModel}
          mode="edit"
          initialSelectedKeys={advancedEditDialogState.initialSelectedKeys}
        />
      )}

      {/* Add Link Modal */}
      <AddLinkModal
        isOpen={addLinkModalState.isOpen}
        onClose={() => setAddLinkModalState(prev => ({ ...prev, isOpen: false }))}
        onSubmit={handleLinkSubmit}
        diagrams={state.model.diagrams.filter(d => d.id !== selectedDiagramId)}
        currentLinkedDiagramId={addLinkModalState.currentLinkedDiagramId}
      />

      {/* Task Group 4 (A3): Decision Flow Condition Modal */}
      <EditActivityFlowConditionModal
        flowId={conditionModalState.flowId || ''}
        isOpen={conditionModalState.isOpen}
        flow={currentFlowForModal}
        metaModel={state.model.metaModel}
        onSave={handleConditionModalSave}
        onSkip={handleConditionModalSkip}
      />

      <ErrorModal
        isOpen={errorModalOpen}
        onClose={() => setErrorModalOpen(false)}
        errors={errorMessages}
      />
      </>}

      {/* Spec 2026-03-27 Increment 6 Task 4.4: Mapping Confirmation Modal (outside !active guard) */}
      {showMappingConfirmationModal && temporaryDiagramState.data && temporaryDiagramState.mappingResult && state.model.metaModel && (
        <MappingConfirmationModal
          isOpen={showMappingConfirmationModal}
          onClose={() => setShowMappingConfirmationModal(false)}
          onConfirm={(completed: CompletedDiagramMapping) => {
            setTemporaryDiagramState(prev => ({ ...prev, completedDiagramMapping: completed }));
            setShowMappingConfirmationModal(false);
          }}
          mappingResult={temporaryDiagramState.mappingResult}
          temporaryDiagram={temporaryDiagramState.data}
          metaModel={state.model.metaModel}
        />
      )}


      {/* Spec 2026-04-03: User Journey Diagram Edit and Save Flow - Save modal */}
      {journeyReview.active && journeyReview.selectedIndex !== null && !journeyReview.isOverview && journeyReview.currentJourney && (
        <SaveJourneyDiagramModal
          isOpen={showSaveJourneyModal}
          onClose={() => setShowSaveJourneyModal(false)}
          onSubmit={handleSaveJourneyDiagram}
          defaultName={journeyReview.currentJourney.journey.name}
          existingDiagrams={state.model.diagrams}
        />
      )}
      {/* Spec 2026-03-27 Increment 7 Task 3.2: Toast notification for finalization feedback */}
      <Toast visible={toastState.visible} message={toastState.message} type={toastState.type} onDismiss={handleDismissToast} />
    </div>
  );
}
