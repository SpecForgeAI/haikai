/**
 * Grid Component
 * Task Group 7: Added context menu support for interfaces
 *
 * 2026-01-03: Null-safety hardening (spec: metamodel-ui-workflow-transitions-crash-fix)
 * - Added null-safe entity array access with ?? [] fallback
 * - Added null-safe columns config access with ?? [] fallback
 * - Prevents crashes when entity type key is missing from metaModel.entities
 *
 * Spec 2026-01-05: Application Point Targeting (Task Group 6)
 * - Added "Attach Business Logic" button for application_points entity type
 * - Added "Attach to Application Point" button for business_logics entity type
 * - Integrated AttachBusinessLogicModal and AttachToApplicationPointModal
 *
 * Spec 2026-01-05: Business Logic Templates (Task Group 6)
 * - Intercepts "+ Add Row" for business_logics to open CreateBusinessLogicModal
 * - Modal allows template selection to prefill description
 *
 * Spec 2026-01-06: Global Application Point Picker (Task Group 4)
 * - Added onAddEntity callback for ApplicationPointPickerCell derived APs
 * - Wired to GridCell for ADD_ENTITY dispatch
 *
 * Spec 2026-01-06: Service Package Set Assignment Dropdown (Task Groups 3-4)
 * - Added PackageSet modal state management for create/clone workflows
 * - Integrated CreatePackageSetModal for package_set_dropdown cell type
 * - Wired service.package_set_id update after modal submission
 *
 * Spec 2026-01-20: UI Characteristics Entity (Task Groups 4.7-4.8)
 * - Added type-clearing behavior: when 'type' field changes, clears 'key' field
 * - Added createEmptyEntity case for ui_characteristics
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import { useArchitecture, useArchitectureDispatch } from '../../contexts/ArchitectureContext';
import {
  EntityType,
  AnyEntity,
  ENTITY_TYPES,
  EndpointType,
  Event,
  Method,
  State,
  StateTransition,
  Class,
  ApplicationPoint,
  BusinessLogic,
  ApplicationPointBusinessLogic,
  PackageSet,
  Package,
  Service,
  ApplicationComponent,
  UICharacteristic,
} from '../../types/model';
import { gridConfigs } from '../../config/gridConfigs';
import { generateEntityId } from '../../utils/idGenerator';
import { GridCell } from './GridCell';
import { GridRowContextMenu } from './GridRowContextMenu';
// Spec 2026-06-06: derive the right-clicked service's parent-component tier +
// classify its Core Tech, so the context menu can offer (and only enable) the
// correct discovery-run flavour (code vs database).
import { deriveServiceTier } from '../../utils/deriveServiceTier';
import { checkPersistenceCoreTech } from './coreTechPersistenceCheck';
import { StartDiscoveryRunConfirmModal } from './StartDiscoveryRunConfirmModal';
import { PreflightModal, ScanPlan } from './PreflightModal';
// Spec 2026-05-10 Task Group 4.5: pre-run modal for the default Start Discovery
// Run flow + multipart upload API client. The modal owns selectedFiles state
// and orchestrates create-run-first -> upload-after for the no-PreflightModal
// path. The Library-Scan path performs the same orchestration in
// handlePreflightConfirm below using the same upload client.
import { StartDiscoveryRunModal, type SourceMode } from '../Discovery/StartDiscoveryRunModal';
import { uploadDiscoveryRunLogFiles } from '../../api/discoveryApi';
import { Toast, ToastType } from '../common/Toast';
import {
  startDiscoveryRun,
  StartDiscoveryRunError,
  previewLibraryScanForService,
  previewLibraryScanForLibrary,
  startLibraryScanForService,
  startLibraryScanForLibrary,
} from '../../services/gatewayClient';
import { useProject } from '../../contexts/ProjectContext';
// Spec 2026-05-02 Multi-Architecture Selector + URL Routing -- Task Group 4
// useNavigate replaces the SET_VIEW dispatch when redirecting the user to
// the dashboard after a discovery run is queued.
import { useNavigate } from 'react-router-dom';
import { useActiveArchitectureId } from '../../contexts/ArchitectureContext';
import { AdvancedAddDialog } from '../DiagramsView/AdvancedAddDialog';
import { AttachBusinessLogicModal } from '../DiagramsView/modals/AttachBusinessLogicModal';
import { AttachToApplicationPointModal } from '../DiagramsView/modals/AttachToApplicationPointModal';
import { CreateBusinessLogicModal } from '../DiagramsView/modals/CreateBusinessLogicModal';
import { CreatePackageSetModal, PackageSetFormData } from '../MetaModelView/CreatePackageSetModal';
import { AdvancedAddResult } from '../../types/advancedAdd';
import { validateModel } from '../../utils/validation';
// Fix #6b: auto-save before kicking off a discovery run from the row context
// menu, so a Service created in the Grid can be discovered without an
// explicit save step.
import { saveModelToBackend } from '../../utils/saveUtils';
import styles from './Grid.module.css';
import type { DiscoveryOriginsMap } from '../../hooks/useDiscoveryOrigins';

interface GridProps {
  entityType: EntityType;
  /** Spec: Discovery Results Visibility (Increment 12) - Task Group 6 */
  discoveryOrigins?: DiscoveryOriginsMap;
}

interface ContextMenuState {
  isOpen: boolean;
  position: { x: number; y: number };
  entityId: string;
  entityName: string;
  /**
   * Spec 2026-06-06: whether the right-clicked Service is a database-scan
   * candidate (Persistence-Tier parent + Core Tech showing a supported DB
   * pack). Computed at right-click time and passed to GridRowContextMenu to
   * drive the mutual exclusivity of the three discovery-run items.
   */
  isDatabaseService: boolean;
}

interface AdvancedAddDialogState {
  isOpen: boolean;
  entityId: string;
  entityName: string;
  entityType: string;
}

// State for Attach Business Logic Modal
interface AttachBusinessLogicModalState {
  isOpen: boolean;
  applicationPointId: string;
  applicationPointName: string;
}

// State for Attach to Application Point Modal
interface AttachToApplicationPointModalState {
  isOpen: boolean;
  businessLogicId: string;
  businessLogicName: string;
}

// ============================================================================
// Spec 2026-01-06: Package Set Modal State (Task Group 4)
// ============================================================================
interface PackageSetModalState {
  isOpen: boolean;
  mode: 'create' | 'clone';
  /** Service ID that triggered the modal - will have package_set_id updated on submit */
  serviceId: string;
  /** Clone initial data (when mode === 'clone') */
  cloneData?: {
    name: string;
    packages: Array<{ name: string; purpose: string; sort_order?: number }>;
  };
}

/**
 * Helper to get entity name or fallback to ID for entities without name field.
 * StateTransition entities do not have a 'name' property.
 */
function getEntityDisplayName(entity: AnyEntity): string {
  if ('name' in entity && typeof entity.name === 'string' && entity.name) {
    return entity.name;
  }
  return entity.id;
}
interface SortableRowProps {
  id: string;
  isSelected: boolean;
  onClick: (e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  children: React.ReactNode;
}

function SortableRow({ id, isSelected, onClick, onContextMenu, children }: SortableRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <tr
      ref={setNodeRef}
      style={style}
      className={`${styles.dataRow} ${isSelected ? styles.selectedRow : ''} ${isDragging ? styles.draggingRow : ''}`}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      <td className={`${styles.dataCell} ${styles.dragHandleCell}`}>
        <span
          ref={setActivatorNodeRef}
          className={styles.dragHandle}
          title="Drag to reorder"
          {...attributes}
          {...listeners}
        >
          <GripVertical size={14} />
        </span>
      </td>
      {children}
    </tr>
  );
}

export function Grid({ entityType, discoveryOrigins }: GridProps) {
  const state = useArchitecture();
  const dispatch = useArchitectureDispatch();
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set());
  const [anchorRowId, setAnchorRowId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  // Clear search term and selection when entity type changes
  useEffect(() => {
    setSearchTerm('');
    setSelectedRowIds(new Set());
    setAnchorRowId(null);
  }, [entityType]);

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(KeyboardSensor)
  );

  // Task Group 7: Context menu state
  const [contextMenuState, setContextMenuState] = useState<ContextMenuState>({
    isOpen: false,
    position: { x: 0, y: 0 },
    entityId: '',
    entityName: '',
    isDatabaseService: false,
  });

  // Task Group 7: Advanced Add dialog state
  const [advancedAddDialogState, setAdvancedAddDialogState] = useState<AdvancedAddDialogState>({
    isOpen: false,
    entityId: '',
    entityName: '',
    entityType: '',
  });

  // Spec 2026-01-05: Attach Business Logic Modal state
  const [attachBusinessLogicModalState, setAttachBusinessLogicModalState] = useState<AttachBusinessLogicModalState>({
    isOpen: false,
    applicationPointId: '',
    applicationPointName: '',
  });

  // Spec 2026-01-05: Attach to Application Point Modal state
  const [attachToApplicationPointModalState, setAttachToApplicationPointModalState] = useState<AttachToApplicationPointModalState>({
    isOpen: false,
    businessLogicId: '',
    businessLogicName: '',
  });

  // ============================================================================
  // Spec 2026-01-05: Create Business Logic Modal state (Task Group 6)
  // ============================================================================
  const [isCreateBusinessLogicModalOpen, setIsCreateBusinessLogicModalOpen] = useState(false);

  // ============================================================================
  // Spec 2026-01-06: Package Set Modal state (Task Group 4)
  // ============================================================================
  const [packageSetModalState, setPackageSetModalState] = useState<PackageSetModalState>({
    isOpen: false,
    mode: 'create',
    serviceId: '',
  });

  // 2026-01-03: Null-safe columns config access (spec: metamodel-ui-workflow-transitions-crash-fix)
  // If columns config is missing for an entityType, fallback to empty array to prevent crash
  const columns = gridConfigs[entityType] ?? [];

  // 2026-01-03: Null-safe entity array access (spec: metamodel-ui-workflow-transitions-crash-fix)
  // If entityType key is missing from metaModel.entities (e.g., old projects without UI entities),
  // fallback to empty array to prevent undefined.map crash
  const entities = (state.model?.metaModel?.entities?.[entityType] ?? []) as AnyEntity[];

  // Filter entities by search term (matches on name)
  const filteredEntities = useMemo(() => {
    if (!searchTerm) return entities;
    const term = searchTerm.toLowerCase();
    return entities.filter(e => {
      const name = ('name' in e && typeof e.name === 'string') ? e.name : '';
      return name.toLowerCase().includes(term);
    });
  }, [entities, searchTerm]);

  const filteredEntityIds = useMemo(() => filteredEntities.map(e => e.id), [filteredEntities]);

  // Handle drag end - reorder the full entities array
  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    // If the dragged row is part of a multi-selection, move all selected rows as a block
    if (selectedRowIds.size > 1 && selectedRowIds.has(active.id as string)) {
      // Collect selected rows in their current order
      const selectedInOrder = entities.filter(e => selectedRowIds.has(e.id));
      // Remove selected rows from array
      const remaining = entities.filter(e => !selectedRowIds.has(e.id));
      // Find where to insert (the position of the drop target in the remaining array)
      const overIndex = remaining.findIndex(e => e.id === over.id);
      if (overIndex === -1) return;
      // Determine insert position: if dragging down, insert after; if dragging up, insert before
      const activeOriginalIndex = entities.findIndex(e => e.id === active.id);
      const overOriginalIndex = entities.findIndex(e => e.id === over.id);
      const insertIdx = activeOriginalIndex < overOriginalIndex ? overIndex + 1 : overIndex;
      // Splice selected rows into position
      const reordered = [...remaining.slice(0, insertIdx), ...selectedInOrder, ...remaining.slice(insertIdx)];
      dispatch({ type: 'REORDER_ENTITIES', entityType, entities: reordered });
    } else {
      // Single row drag (existing behavior)
      const oldFilteredIndex = filteredEntities.findIndex(e => e.id === active.id);
      const newFilteredIndex = filteredEntities.findIndex(e => e.id === over.id);
      if (oldFilteredIndex === -1 || newFilteredIndex === -1) return;

      if (!searchTerm) {
        // No filter active - simple reorder
        const reordered = arrayMove(entities, oldFilteredIndex, newFilteredIndex);
        dispatch({ type: 'REORDER_ENTITIES', entityType, entities: reordered });
      } else {
        // Filter active - map filtered positions back to full array
        const oldFullIndex = entities.findIndex(e => e.id === active.id);
        const newFullIndex = entities.findIndex(e => e.id === over.id);
        if (oldFullIndex === -1 || newFullIndex === -1) return;
        const reordered = arrayMove(entities, oldFullIndex, newFullIndex);
        dispatch({ type: 'REORDER_ENTITIES', entityType, entities: reordered });
      }
    }
  }, [filteredEntities, entities, selectedRowIds, searchTerm, dispatch, entityType]);

  // Get validation errors for current entity type
  const allErrors = validateModel(state.model);
  const entityErrors = allErrors.filter((e) => e.entityType === entityType);

  // Get the selected entity for attach modals
  const selectedEntity = useMemo(() => {
    if (selectedRowIds.size !== 1) return null;
    const id = [...selectedRowIds][0];
    return entities.find((e) => e.id === id) || null;
  }, [selectedRowIds, entities]);

  // ============================================================================
  // Spec 2026-01-06: onAddEntity callback for ApplicationPointPickerCell
  // Dispatches ADD_ENTITY when a derived ApplicationPoint is created
  // ============================================================================
  const handleAddEntity = useCallback((addEntityType: string, entity: AnyEntity) => {
    dispatch({
      type: 'ADD_ENTITY',
      entityType: addEntityType as EntityType,
      entity,
    });
  }, [dispatch]);

  // ============================================================================
  // Spec 2026-01-05: Modified handleAddRow (Task Group 6)
  // Intercepts business_logics to open CreateBusinessLogicModal instead of direct creation
  // ============================================================================
  const handleAddRow = useCallback(() => {
    // Task Group 6: Intercept business_logics to open modal
    if (entityType === 'business_logics') {
      setIsCreateBusinessLogicModalOpen(true);
      return;
    }

    // Default behavior for other entity types
    const newEntity = createEmptyEntity(entityType);
    dispatch({ type: 'ADD_ENTITY', entityType, entity: newEntity });
    setSelectedRowIds(new Set([newEntity.id]));
    setAnchorRowId(newEntity.id);
  }, [entityType, dispatch]);

  const handleDeleteRow = () => {
    if (selectedRowIds.size === 0) return;
    for (const id of selectedRowIds) {
      dispatch({ type: 'DELETE_ENTITY', entityType, id });
    }
    setSelectedRowIds(new Set());
    setAnchorRowId(null);
  };

  const handleRowClick = (id: string, e: React.MouseEvent) => {
    if (e.shiftKey && anchorRowId) {
      // Shift+click: select contiguous range from anchor to clicked row
      const anchorIdx = filteredEntities.findIndex(ent => ent.id === anchorRowId);
      const clickIdx = filteredEntities.findIndex(ent => ent.id === id);
      if (anchorIdx !== -1 && clickIdx !== -1) {
        const start = Math.min(anchorIdx, clickIdx);
        const end = Math.max(anchorIdx, clickIdx);
        const rangeIds = new Set(filteredEntities.slice(start, end + 1).map(ent => ent.id));
        setSelectedRowIds(rangeIds);
      }
    } else if (e.altKey) {
      // Alt+click: toggle individual row
      setSelectedRowIds(prev => {
        const next = new Set(prev);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return next;
      });
      if (!anchorRowId) setAnchorRowId(id);
    } else {
      // Normal click
      if (selectedRowIds.size > 1 && selectedRowIds.has(id)) {
        // Clicking an already-selected row in a multi-selection: keep selection
        return;
      }
      // Single select
      setSelectedRowIds(new Set([id]));
      setAnchorRowId(id);
    }
  };

  // Task Group 7 (+ 2026-04-22 services extension): Handle right-click on
  // grid row. Currently enabled on `interfaces` (Add endpoints/entities)
  // and `services` (Start Discovery Run). Other entity types fall
  // through with no context menu.
  const handleRowContextMenu = useCallback(
    (e: React.MouseEvent, entity: AnyEntity) => {
      if (
        entityType === 'interfaces' ||
        entityType === 'services' ||
        entityType === 'libraries'
      ) {
        e.preventDefault();
        let fallback = 'Unnamed';
        if (entityType === 'interfaces') fallback = 'Unnamed Interface';
        else if (entityType === 'services') fallback = 'Unnamed Service';
        else if (entityType === 'libraries') fallback = 'Unnamed Library';
        // Spec 2026-06-06: a Service is a database-scan candidate when its
        // parent application component is Persistence Tier AND its Core Tech
        // resolves to a supported database pack (PostgreSQL / Sybase) -- the
        // same condition that surfaces the green note in the Core Tech cell.
        let isDatabaseService = false;
        if (entityType === 'services') {
          const svc = entity as Service;
          const appComponentsById = new Map<string, ApplicationComponent>();
          for (const ac of state.model?.metaModel?.entities?.app_components ?? []) {
            appComponentsById.set(ac.id, ac);
          }
          const hasCodePack =
            !!svc.core_tech_language_pack ||
            (svc.core_tech_framework_packs?.length ?? 0) > 0;
          isDatabaseService =
            deriveServiceTier(svc, appComponentsById) === 'Persistence' &&
            checkPersistenceCoreTech(svc.core_tech, hasCodePack).status === 'ok';
        }
        setContextMenuState({
          isOpen: true,
          position: { x: e.clientX, y: e.clientY },
          entityId: entity.id,
          entityName: getEntityDisplayName(entity) || fallback,
          isDatabaseService,
        });
      }
    },
    [entityType, state.model]
  );

  // Task Group 7: Close context menu
  const handleCloseContextMenu = useCallback(() => {
    setContextMenuState((prev) => ({
      ...prev,
      isOpen: false,
    }));
  }, []);

  // Task Group 7: Open Advanced Add dialog from context menu
  const handleAddEndpointsAndEntities = useCallback(() => {
    setAdvancedAddDialogState({
      isOpen: true,
      entityId: contextMenuState.entityId,
      entityName: contextMenuState.entityName,
      entityType: ENTITY_TYPES.INTERFACE,
    });
  }, [contextMenuState.entityId, contextMenuState.entityName]);

  // Task Group 7: Close Advanced Add dialog
  const handleCloseAdvancedAddDialog = useCallback(() => {
    setAdvancedAddDialogState((prev) => ({
      ...prev,
      isOpen: false,
    }));
  }, []);

  // Task Group 7: Handle Advanced Add result
  // Note: In the grid context, we just close the dialog
  // The actual diagram-related functionality would be handled
  // by DiagramsView when the grid is used within that context
  const handleAdvancedAddResult = useCallback((_result: AdvancedAddResult) => {
    // Close the dialog - the result could be used for diagram operations
    // when integrated with DiagramsView
    handleCloseAdvancedAddDialog();
  }, [handleCloseAdvancedAddDialog]);

  // ============================================================================
  // 2026-04-22: Start Discovery Run from services row context menu.
  //
  // Flow:
  //   1. User right-clicks a service row → context menu → "Start Discovery Run".
  //   2. handleStartDiscoveryRun() POSTs to the gateway relay with
  //      `confirmLlmSolo: false`.
  //   3. On 201 (run queued): toast + navigate to the dashboard's Discovery
  //      Detail view via a sessionStorage signal read by DashboardView on
  //      mount.
  //   4. On 409 TECH_HINTS_UNRESOLVED: toast directing the user to resolve
  //      the service's tech hints first. No dialog.
  //   5. On 409 LLM_SOLO_CONFIRMATION_REQUIRED: open the LLM-only confirm
  //      modal; if the user continues, re-POST with `confirmLlmSolo: true`.
  //   6. All other failures surface as an error toast.
  // ============================================================================
  const activeProject = useProject();
  // Spec 2026-05-02 Multi-Architecture Selector + URL Routing -- Task Group 4
  // navigate + activeArchitectureId replace the SET_VIEW dispatch path
  // when sending the user to the dashboard after start-discovery-run.
  const navigate = useNavigate();
  const activeArchitectureId = useActiveArchitectureId();
  const [startRunConfirmState, setStartRunConfirmState] = useState<{
    isOpen: boolean;
    serviceId: string;
    serviceName: string;
    warnings?: string[];
  }>({ isOpen: false, serviceId: '', serviceName: '' });
  // Spec 2026-05-10 Task Group 4.5: pre-run modal state for the default
  // 'Start Discovery Run' context-menu action. Distinct from
  // startRunConfirmState above (which is the Tier-C 409 retry gate -- a
  // SEPARATE, unchanged dialog).
  const [startRunModalState, setStartRunModalState] = useState<{
    isOpen: boolean;
    serviceId: string;
    serviceName: string;
    architectureId: string;
    // Spec 2026-06-06: locks (and hides) the modal's Code/Database toggle.
    // 'code' for "Start Discovery Run (No Libraries)", 'database' for "Start
    // Discovery Run (Database)".
    lockedSourceMode: SourceMode | null;
  }>({ isOpen: false, serviceId: '', serviceName: '', architectureId: '', lockedSourceMode: null });
  const [toastState, setToastState] = useState<{
    visible: boolean;
    type: ToastType;
    message: string;
  }>({ visible: false, type: 'info', message: '' });

  const dismissToast = useCallback(() => {
    setToastState((prev) => ({ ...prev, visible: false }));
  }, []);

  const showToast = useCallback((type: ToastType, message: string) => {
    setToastState({ visible: true, type, message });
  }, []);

  const invokeStartRun = useCallback(
    async (
      serviceId: string,
      confirmLlmSolo: boolean,
      serviceName: string,
      // Spec #4 Task Group 6: explicit architectureId becomes the run's
      // bound architecture for life. The first call (from the context
      // menu) passes the URL active id. The retry call (from the modal
      // Confirm button) passes the picker's chosen id, which may differ.
      architectureId: string,
    ) => {
      if (!activeProject?.id) {
        showToast('error', 'No active project. Open a project first.');
        return;
      }
      if (!architectureId) {
        showToast('error', 'No active architecture. Wait for the project to load.');
        return;
      }
      try {
        // Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 7 (Task 7.7)
        // Capture the new run id so we can navigate directly to the
        // run-detail URL once the run is queued. The previous flow set
        // `sessionStorage.pendingDiscoveryDetail` and bounced through the
        // dashboard auto-open effect; now we navigate to the first-class
        // discovery run-detail route, which is deep-linkable.
        const created = await startDiscoveryRun(activeProject.id, architectureId, serviceId, confirmLlmSolo);
        showToast(
          'success',
          `Discovery run started for "${serviceName}". Opening run detail...`,
        );
        // Spec 2026-05-02 Multi-Architecture Selector + URL Routing -- Task Group 4
        // Spec 2026-05-01 Discovery Integration -- Task Group 6: navigate
        // to the architecture the run was bound to (the picker's choice
        // when retried from the modal), so the dashboard renders the
        // run's results in the correct architecture-scoped view.
        // Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 7
        // Land directly on the run-detail URL using the id returned by
        // startDiscoveryRun. The dashboard sessionStorage handoff is gone.
        if (activeProject?.id && created?.id) {
          navigate(
            `/projects/${activeProject.id}/architectures/${architectureId}/discovery/runs/${created.id}`
          );
        } else if (activeProject?.id) {
          // Defensive: if the response unexpectedly lacked an id, fall back
          // to the discovery list page so the user still lands somewhere
          // useful.
          navigate(
            `/projects/${activeProject.id}/architectures/${architectureId}/discovery`
          );
        }
      } catch (err) {
        const runErr = err as StartDiscoveryRunError;
        if (runErr.status === 409 && runErr.code === 'TECH_HINTS_UNRESOLVED') {
          showToast('error', 'Resolve tech hints before starting discovery');
          return;
        }
        if (runErr.status === 409 && runErr.code === 'LLM_SOLO_CONFIRMATION_REQUIRED') {
          // Open the confirm dialog instead of auto-retrying.
          setStartRunConfirmState({
            isOpen: true,
            serviceId,
            serviceName,
            warnings: runErr.warnings,
          });
          return;
        }
        showToast('error', runErr.message ?? 'Failed to start discovery run');
      }
    },
    [activeProject, activeArchitectureId, dispatch, navigate, showToast],
  );

  const handleStartDiscoveryRunFromMenu = useCallback(async (lockedSourceMode: SourceMode = 'code') => {
    // Pulled out of context menu state at click time so the row remains
    // identifiable even after the menu closes.
    const serviceId = contextMenuState.entityId;
    const serviceName = contextMenuState.entityName;
    if (!serviceId) return;
    if (!activeArchitectureId) {
      showToast('error', 'No active architecture. Wait for the project to load.');
      return;
    }
    // Fix #6b: auto-save the model before kicking off the run so a Service
    // created in the Grid carries a derived ApplicationPoint (added by
    // Fix #6a in prepareModelForSave) that the discovery-service can resolve
    // without a follow-up self-heal create. The save is unconditional
    // (idempotent on the backend) -- there is no isDirty indicator in
    // ArchitectureContext to gate this. Trade-off: extra HTTP call on every
    // run, but guarantees freshness.
    if (state.model && state.loadedFileName) {
      // Spec 2026-05-11: architecture-scoped save requires active project + architecture
      if (!activeProject?.id || !activeArchitectureId) {
        showToast('error', 'No active project or architecture. Open a project first.');
        return;
      }
      try {
        const result = await saveModelToBackend(state.model, state.loadedFileName, activeProject.id, activeArchitectureId, dispatch);
        if (!result.success) {
          showToast('error', result.error ?? 'Failed to save model before discovery run.');
          return;
        }
      } catch (err) {
        showToast('error', err instanceof Error ? err.message : 'Failed to save model before discovery run.');
        return;
      }
    }
    // Spec 2026-05-10 Task Group 4.5: instead of firing the run
    // immediately, open StartDiscoveryRunModal so the user can optionally
    // attach runtime log files. The modal performs the locked
    // create-run-first -> upload-after orchestration via startDiscoveryRun
    // + uploadDiscoveryRunLogFiles. Tier-C 409 handling is unchanged --
    // run-start errors surface to handleStartRunModalError below, which
    // delegates to the same StartDiscoveryRunConfirmModal pipeline.
    setStartRunModalState({
      isOpen: true,
      serviceId,
      serviceName,
      architectureId: activeArchitectureId,
      lockedSourceMode,
    });
  }, [contextMenuState.entityId, contextMenuState.entityName, activeArchitectureId, showToast, state.model, state.loadedFileName, dispatch]);

  // Spec 2026-06-06: "Start Discovery Run (Database)" -- same save-first flow as
  // the No-Libraries item, but opens the modal locked to the Database source.
  const handleStartDatabaseScanFromMenu = useCallback(
    () => handleStartDiscoveryRunFromMenu('database'),
    [handleStartDiscoveryRunFromMenu],
  );

  // Spec 2026-05-10 Task Group 4.5: handlers for the pre-run StartDiscoveryRunModal.
  const handleCloseStartRunModal = useCallback(() => {
    setStartRunModalState((prev) => ({ ...prev, isOpen: false }));
  }, []);

  const handleStartRunModalRunStarted = useCallback(
    (runId: string) => {
      const { serviceName, architectureId } = startRunModalState;
      if (!activeProject?.id) return;
      showToast(
        'success',
        `Discovery run started for "${serviceName}". Opening run detail...`,
      );
      navigate(
        `/projects/${activeProject.id}/architectures/${architectureId}/discovery/runs/${runId}`,
      );
    },
    [startRunModalState, activeProject, navigate, showToast],
  );

  const handleStartRunModalError = useCallback(
    (err: unknown) => {
      // Mirror the existing invokeStartRun error pipeline so 409
      // TECH_HINTS_UNRESOLVED and 409 LLM_SOLO_CONFIRMATION_REQUIRED
      // continue to surface their existing UX (toast / Tier-C confirm
      // modal) rather than being collapsed into a generic upload error.
      const runErr = err as StartDiscoveryRunError;
      const { serviceId, serviceName } = startRunModalState;
      if (runErr?.status === 409 && runErr.code === 'TECH_HINTS_UNRESOLVED') {
        showToast('error', 'Resolve tech hints before starting discovery');
        return;
      }
      if (runErr?.status === 409 && runErr.code === 'LLM_SOLO_CONFIRMATION_REQUIRED') {
        // Hand off to the existing Tier-C confirm modal -- unchanged.
        setStartRunConfirmState({
          isOpen: true,
          serviceId,
          serviceName,
          warnings: runErr.warnings,
        });
        return;
      }
      showToast(
        'error',
        runErr?.message ?? (err instanceof Error ? err.message : 'Failed to start discovery run'),
      );
    },
    [startRunModalState, showToast],
  );

  const handleConfirmLlmSolo = useCallback(
    // Spec #4 Task Group 6: the modal hands back the picker's chosen
    // architectureId. This becomes the run's bound architecture for
    // life -- it is NOT necessarily the URL active id (the user may
    // have picked a different architecture in the picker).
    (architectureId: string) => {
      const { serviceId, serviceName } = startRunConfirmState;
      setStartRunConfirmState({ isOpen: false, serviceId: '', serviceName: '' });
      if (!serviceId) return;
      void invokeStartRun(serviceId, true, serviceName, architectureId);
    },
    [startRunConfirmState, invokeStartRun],
  );

  const handleCancelLlmSolo = useCallback(() => {
    setStartRunConfirmState({ isOpen: false, serviceId: '', serviceName: '' });
  }, []);

  // ============================================================================
  // Spec 2026-05-06: Library Discovery Integration -- Task Group 7
  //
  // PreflightModal state + handlers. The default "Start Discovery Run"
  // context-menu action opens this modal so the user can preview the
  // BFS scan plan and toggle external-library inclusion before any LLM
  // tokens are spent. The "Start Discovery Run (No Libraries)" action
  // bypasses the preflight and uses the existing single-entity flow.
  // ============================================================================
  const [preflightModalState, setPreflightModalState] = useState<{
    isOpen: boolean;
    rootKind: 'service' | 'library';
    rootId: string;
    rootName: string;
  }>({ isOpen: false, rootKind: 'service', rootId: '', rootName: '' });

  const handleClosePreflightModal = useCallback(() => {
    setPreflightModalState((prev) => ({ ...prev, isOpen: false }));
  }, []);

  const handleStartLibraryScanFromMenu = useCallback(async () => {
    const rootId = contextMenuState.entityId;
    const rootName = contextMenuState.entityName;
    if (!rootId) return;
    if (!activeArchitectureId) {
      showToast('error', 'No active architecture. Wait for the project to load.');
      return;
    }
    if (entityType !== 'services' && entityType !== 'libraries') return;
    // Fix #6b: auto-save before opening the preflight modal so the BFS scan
    // plan reflects the latest in-memory model (including any Service rows
    // the user just added in the Grid). prepareModelForSave (Fix #6a)
    // attaches a derived ApplicationPoint to every Service so the
    // discovery-service can resolve a real AP UUID for the root.
    if (state.model && state.loadedFileName) {
      // Spec 2026-05-11: architecture-scoped save requires active project + architecture
      if (!activeProject?.id || !activeArchitectureId) {
        showToast('error', 'No active project or architecture. Open a project first.');
        return;
      }
      try {
        const result = await saveModelToBackend(state.model, state.loadedFileName, activeProject.id, activeArchitectureId, dispatch);
        if (!result.success) {
          showToast('error', result.error ?? 'Failed to save model before discovery run.');
          return;
        }
      } catch (err) {
        showToast('error', err instanceof Error ? err.message : 'Failed to save model before discovery run.');
        return;
      }
    }
    setPreflightModalState({
      isOpen: true,
      rootKind: entityType === 'libraries' ? 'library' : 'service',
      rootId,
      rootName,
    });
  }, [
    contextMenuState.entityId,
    contextMenuState.entityName,
    activeArchitectureId,
    entityType,
    showToast,
    state.model,
    state.loadedFileName,
    dispatch,
  ]);

  const handlePreflightPreviewFn = useCallback(
    (includeExternal: boolean): Promise<ScanPlan> => {
      const projectId = activeProject?.id ?? '';
      const archId = activeArchitectureId ?? '';
      const { rootKind, rootId } = preflightModalState;
      const fn =
        rootKind === 'library'
          ? previewLibraryScanForLibrary(projectId, archId, rootId, includeExternal)
          : previewLibraryScanForService(projectId, archId, rootId, includeExternal);
      // The gatewayClient ScanPlanResponse and PreflightModal ScanPlan share
      // the same shape (snake_case at the wire boundary).
      return fn as Promise<ScanPlan>;
    },
    [activeProject, activeArchitectureId, preflightModalState]
  );

  const handlePreflightConfirm = useCallback(
    // Spec 2026-05-10 Task Group 4.4: signature now also receives the
    // selected log files from the embedded LogFileUploadInput. We perform
    // the locked create-run-first -> upload-after orchestration here so
    // the Library-Scan path matches the StartDiscoveryRunModal path
    // byte-for-byte. On upload failure: KEEP the run, surface a toast,
    // do NOT roll back.
    //
    // Spec 2026-05-11 Section 1: a third argument carries the per-run M
    // value (max log-path proxy prefix segments). It rides only the
    // log-files PATCH (via the multipart `runtimeEvidenceConfig` rider
    // field) -- the run-create POST shape is UNCHANGED.
    async (
      includeExternal: boolean,
      selectedLogFiles: File[],
      maxLogPathPrefixSegments: number
    ) => {
      const projectId = activeProject?.id;
      const archId = activeArchitectureId;
      const { rootKind, rootId, rootName } = preflightModalState;
      setPreflightModalState((prev) => ({ ...prev, isOpen: false }));
      if (!projectId || !archId || !rootId) {
        showToast('error', 'Missing project / architecture / root id; cannot start run.');
        return;
      }
      let createdRunId: string | null = null;
      try {
        const created =
          rootKind === 'library'
            ? await startLibraryScanForLibrary(projectId, archId, rootId, includeExternal)
            : await startLibraryScanForService(projectId, archId, rootId, includeExternal);
        createdRunId = created?.id ?? null;
        showToast(
          'success',
          `Library scan started for "${rootName}". Opening run detail...`
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to start library scan';
        showToast('error', msg);
        return;
      }

      // Step 4-6: upload-after only when the user picked log files. Run is
      // already created at this point; upload failure is non-rollback per
      // Spec 4 ACs -- surface a toast and continue with navigation.
      if (createdRunId && selectedLogFiles.length > 0) {
        try {
          await uploadDiscoveryRunLogFiles(
            projectId,
            archId,
            createdRunId,
            selectedLogFiles,
            maxLogPathPrefixSegments,
          );
        } catch (uploadErr) {
          const detail =
            uploadErr instanceof Error ? uploadErr.message : 'Log upload failed.';
          showToast(
            'error',
            `Run started but log upload failed: ${detail}`,
          );
          // Intentionally do NOT return here: the run exists and the user
          // should still land on the run-detail page so they can see its
          // partial-attach state (Spec 5 will surface the chip).
        }
      }

      if (createdRunId) {
        navigate(
          `/projects/${projectId}/architectures/${archId}/discovery/runs/${createdRunId}`
        );
      }
    },
    [activeProject, activeArchitectureId, preflightModalState, navigate, showToast]
  );

  // ============================================================================
  // Spec 2026-01-05: Attach Business Logic handlers (for application_points)
  // ============================================================================

  const handleOpenAttachBusinessLogicModal = useCallback(() => {
    if (!selectedEntity || entityType !== 'application_points') return;
    const ap = selectedEntity as ApplicationPoint;
    setAttachBusinessLogicModalState({
      isOpen: true,
      applicationPointId: ap.id,
      applicationPointName: ap.name || 'Unnamed Application Point',
    });
  }, [selectedEntity, entityType]);

  const handleCloseAttachBusinessLogicModal = useCallback(() => {
    setAttachBusinessLogicModalState((prev) => ({
      ...prev,
      isOpen: false,
    }));
  }, []);

  const handleAttachBusinessLogicSubmit = useCallback((relationship: ApplicationPointBusinessLogic) => {
    dispatch({
      type: 'ADD_RELATIONSHIP',
      relationshipType: 'application_point_business_logics',
      relationship,
    });
  }, [dispatch]);

  // ============================================================================
  // Spec 2026-01-05: Attach to Application Point handlers (for business_logics)
  // ============================================================================

  const handleOpenAttachToApplicationPointModal = useCallback(() => {
    if (!selectedEntity || entityType !== 'business_logics') return;
    const bl = selectedEntity as BusinessLogic;
    setAttachToApplicationPointModalState({
      isOpen: true,
      businessLogicId: bl.id,
      businessLogicName: bl.name || 'Unnamed Business Logic',
    });
  }, [selectedEntity, entityType]);

  const handleCloseAttachToApplicationPointModal = useCallback(() => {
    setAttachToApplicationPointModalState((prev) => ({
      ...prev,
      isOpen: false,
    }));
  }, []);

  const handleAttachToApplicationPointSubmit = useCallback((relationship: ApplicationPointBusinessLogic) => {
    dispatch({
      type: 'ADD_RELATIONSHIP',
      relationshipType: 'application_point_business_logics',
      relationship,
    });
  }, [dispatch]);

  const handleDetachFromApplicationPoint = useCallback((relationshipId: string) => {
    dispatch({
      type: 'DELETE_RELATIONSHIP',
      relationshipType: 'application_point_business_logics',
      id: relationshipId,
    });
  }, [dispatch]);

  // ============================================================================
  // Spec 2026-01-05: Create Business Logic Modal handlers (Task Group 6)
  // ============================================================================

  /**
   * Handle submission of CreateBusinessLogicModal.
   * Dispatches ADD_ENTITY and selects the new entity.
   */
  const handleCreateBusinessLogicSubmit = useCallback((entity: BusinessLogic) => {
    dispatch({ type: 'ADD_ENTITY', entityType: 'business_logics', entity });
    setSelectedRowIds(new Set([entity.id]));
    setAnchorRowId(entity.id);
    setIsCreateBusinessLogicModalOpen(false);
  }, [dispatch]);

  /**
   * Handle closing of CreateBusinessLogicModal.
   */
  const handleCloseCreateBusinessLogicModal = useCallback(() => {
    setIsCreateBusinessLogicModalOpen(false);
  }, []);

  // ============================================================================
  // Spec 2026-01-06: Package Set Modal handlers (Task Group 4)
  // ============================================================================

  /**
   * Open CreatePackageSetModal in "create" mode from a PackageSetCell.
   * Called when user clicks "Create new..." action.
   */
  const handlePackageSetCreateNew = useCallback((serviceId: string) => {
    setPackageSetModalState({
      isOpen: true,
      mode: 'create',
      serviceId,
    });
  }, []);

  /**
   * Open CreatePackageSetModal in "clone" mode from a PackageSetCell.
   * Called when user clicks "Clone and customize..." action.
   * Prepares clone data from the currently selected Package Set.
   */
  const handlePackageSetClone = useCallback((serviceId: string) => {
    // Get the service to find its current package_set_id
    const service = entities.find((e) => e.id === serviceId) as Service | undefined;
    if (!service || !service.package_set_id) return;

    // Get the Package Set to clone
    const packageSets = state.model?.metaModel?.entities?.package_sets ?? [];
    const packages = state.model?.metaModel?.entities?.packages ?? [];
    const sourcePackageSet = packageSets.find((ps) => ps.id === service.package_set_id);

    if (!sourcePackageSet) return;

    // Get packages belonging to this Package Set
    const sourcePackages = packages
      .filter((p) => p.package_set_id === sourcePackageSet.id)
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

    setPackageSetModalState({
      isOpen: true,
      mode: 'clone',
      serviceId,
      cloneData: {
        name: `${sourcePackageSet.name} (Copy)`,
        packages: sourcePackages.map((p) => ({
          name: p.name,
          purpose: p.purpose || '',
          sort_order: p.sort_order,
        })),
      },
    });
  }, [entities, state.model?.metaModel?.entities?.package_sets, state.model?.metaModel?.entities?.packages]);

  /**
   * Handle submission of CreatePackageSetModal.
   * Creates new PackageSet and Package entities, then updates the Service's package_set_id.
   */
  const handlePackageSetModalSubmit = useCallback((formData: PackageSetFormData) => {
    // Generate IDs for the new Package Set and Packages
    const newPackageSetId = generateEntityId('package_sets');

    // Create the PackageSet entity
    const newPackageSet: PackageSet = {
      id: newPackageSetId,
      name: formData.name,
    };

    // Dispatch ADD_ENTITY for PackageSet
    dispatch({ type: 'ADD_ENTITY', entityType: 'package_sets' as EntityType, entity: newPackageSet as unknown as AnyEntity });

    // Create Package entities for each package in the form
    formData.packages.forEach((pkg, index) => {
      const newPackage: Package = {
        id: generateEntityId('packages'),
        package_set_id: newPackageSetId,
        name: pkg.name,
        purpose: pkg.purpose,
        sort_order: pkg.sort_order ?? index + 1,
      };

      dispatch({ type: 'ADD_ENTITY', entityType: 'packages' as EntityType, entity: newPackage as unknown as AnyEntity });
    });

    // Update the Service's package_set_id to point to the new Package Set
    if (packageSetModalState.serviceId) {
      const service = entities.find((e) => e.id === packageSetModalState.serviceId);
      if (service) {
        const updatedService = { ...service, package_set_id: newPackageSetId };
        dispatch({ type: 'UPDATE_ENTITY', entityType: 'services', entity: updatedService });
      }
    }

    // Close the modal
    setPackageSetModalState((prev) => ({ ...prev, isOpen: false }));
  }, [dispatch, entities, packageSetModalState.serviceId]);

  /**
   * Handle closing of CreatePackageSetModal.
   */
  const handleClosePackageSetModal = useCallback(() => {
    setPackageSetModalState((prev) => ({ ...prev, isOpen: false }));
  }, []);

  const handleCellChange = (entityId: string, field: string, value: unknown) => {
    // entities is now guaranteed to be an array (possibly empty), so find is safe
    const entity = entities.find((e) => e.id === entityId);
    if (entity) {
      let updatedEntity = { ...entity, [field]: value };

      // Auto-inference for Services: when app_component_id changes, auto-fill application_id
      if (entityType === 'services' && field === 'app_component_id' && value) {
        const component = state.model.metaModel.entities.app_components.find(
          (c) => c.id === value
        );
        if (component && component.application_id) {
          updatedEntity = { ...updatedEntity, application_id: component.application_id };
        }
      }

      // ============================================================================
      // Spec 2026-01-20: UI Characteristics Entity (Task 4.8)
      // When 'type' field changes for ui_characteristics, clear the 'key' field
      // This prevents mismatched suggestions from the previous type selection
      // ============================================================================
      if (entityType === 'ui_characteristics' && field === 'type') {
        updatedEntity = { ...updatedEntity, key: '' };
      }

      // Auto-generate abbreviation from name initials for business_users and applications
      if ((entityType === 'business_users' || entityType === 'applications') && field === 'name') {
        const oldName = (entity as any).name || '';
        const oldAbbrev = (entity as any).abbreviation || '';
        const oldInitials = oldName.split(/\s+/).filter(Boolean).map((w: string) => w[0].toUpperCase()).join('');
        // Only auto-fill if abbreviation was empty or matched the old name's initials
        if (!oldAbbrev || oldAbbrev === oldInitials) {
          const newName = (value as string) || '';
          const newInitials = newName.split(/\s+/).filter(Boolean).map((w: string) => w[0].toUpperCase()).join('');
          updatedEntity = { ...updatedEntity, abbreviation: newInitials };
        }
      }

      dispatch({ type: 'UPDATE_ENTITY', entityType, entity: updatedEntity });
    }
  };

  // 2026-01-03: Early return for missing columns config (spec: metamodel-ui-workflow-transitions-crash-fix)
  // If columns is empty (missing config for entityType), render an empty state message
  if (columns.length === 0) {
    return (
      <div className={styles.gridWrapper}>
        <div className={styles.toolbar}>
          <button className={styles.addButton} onClick={handleAddRow} disabled>
            + Add Row
          </button>
          <button className={styles.deleteButton} disabled>
            Delete Row
          </button>
        </div>
        <div className={styles.gridContainer}>
          <p style={{ padding: '1rem', color: '#666' }}>
            No column configuration available for entity type: {entityType}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.gridWrapper}>
      <div className={styles.toolbar}>
        <button className={styles.addButton} onClick={handleAddRow}>
          + Add Row
        </button>
        <button
          className={styles.deleteButton}
          onClick={handleDeleteRow}
          disabled={selectedRowIds.size === 0}
        >
          {selectedRowIds.size > 1 ? `Delete ${selectedRowIds.size} Rows` : 'Delete Row'}
        </button>

        <input
          type="text"
          className={styles.searchInput}
          placeholder="Search by name..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />

        {/* Spec 2026-01-05: Attach Business Logic button for application_points */}
        {entityType === 'application_points' && (
          <button
            className={styles.attachButton}
            onClick={handleOpenAttachBusinessLogicModal}
            disabled={selectedRowIds.size !== 1}
            title="Attach Business Logic to selected Application Point"
            data-testid="attach-business-logic-button"
          >
            Attach Business Logic
          </button>
        )}

        {/* Spec 2026-01-05: Attach to Application Point button for business_logics */}
        {entityType === 'business_logics' && (
          <button
            className={styles.attachButton}
            onClick={handleOpenAttachToApplicationPointModal}
            disabled={selectedRowIds.size !== 1}
            title="Attach selected Business Logic to Application Points"
            data-testid="attach-to-application-point-button"
          >
            Attach to Application Point
          </button>
        )}
      </div>

      <div className={styles.gridContainer}>
        <table className={styles.grid}>
          <thead>
            <tr className={styles.headerRow}>
              <th className={`${styles.headerCell} ${styles.dragHandleCell}`}></th>
              {columns.map((column) => (
                <th
                  key={column.field}
                  className={styles.headerCell}
                  style={{ width: column.width }}
                >
                  {column.displayName}
                  {column.required && <span className={styles.required}>*</span>}
                </th>
              ))}
            </tr>
          </thead>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={filteredEntityIds}
              strategy={verticalListSortingStrategy}
            >
              <tbody>
                {filteredEntities.map((entity) => (
                  <SortableRow
                    key={entity.id}
                    id={entity.id}
                    isSelected={selectedRowIds.has(entity.id)}
                    onClick={(e) => handleRowClick(entity.id, e)}
                    onContextMenu={(e) => handleRowContextMenu(e, entity)}
                  >
                    {columns.map((column) => (
                      <td key={`${entity.id}-${column.field}`} className={styles.dataCell}>
                        <GridCell
                          entity={entity}
                          column={column}
                          entityType={entityType}
                          model={state.model}
                          errors={entityErrors}
                          onChange={(value) => handleCellChange(entity.id, column.field, value)}
                          onAddEntity={handleAddEntity}
                          onPackageSetCreateNew={() => handlePackageSetCreateNew(entity.id)}
                          onPackageSetClone={() => handlePackageSetClone(entity.id)}
                        />
                        {/* Spec: Discovery Results Visibility (Increment 12) - Task Group 6 */}
                        {column.field === 'name' && discoveryOrigins?.get(entityType)?.has(entity.id) && (
                          <span className={styles.discoveredBadge} data-testid="discovered-badge">Discovered</span>
                        )}
                      </td>
                    ))}
                  </SortableRow>
                ))}
              </tbody>
            </SortableContext>
          </DndContext>
        </table>
      </div>

      {/* Task Group 7: Context menu for interfaces + services */}
      <GridRowContextMenu
        isOpen={contextMenuState.isOpen}
        position={contextMenuState.position}
        entityType={entityType}
        entityId={contextMenuState.entityId}
        entityName={contextMenuState.entityName}
        onClose={handleCloseContextMenu}
        onAddEndpointsAndEntities={handleAddEndpointsAndEntities}
        onStartLibraryScan={handleStartLibraryScanFromMenu}
        onStartScanNoLibraries={handleStartDiscoveryRunFromMenu}
        onStartDiscoveryRun={handleStartDiscoveryRunFromMenu}
        onStartDatabaseScan={handleStartDatabaseScanFromMenu}
        isDatabaseService={contextMenuState.isDatabaseService}
      />

      {/* 2026-04-22: Tier-C LLM-only confirm dialog + toast for Start Discovery Run. */}
      <StartDiscoveryRunConfirmModal
        isOpen={startRunConfirmState.isOpen}
        serviceName={startRunConfirmState.serviceName}
        warnings={startRunConfirmState.warnings}
        onClose={handleCancelLlmSolo}
        onConfirm={handleConfirmLlmSolo}
      />

      {/* Spec 2026-05-10 Task Group 4.5: pre-run modal for the default
          Start Discovery Run flow (Tier A / Tier B). The Tier-C 409
          confirmation flow above remains a SEPARATE gate -- this modal
          owns only the optional log-file upload. */}
      <StartDiscoveryRunModal
        isOpen={startRunModalState.isOpen}
        projectId={activeProject?.id ?? ''}
        architectureId={startRunModalState.architectureId}
        serviceId={startRunModalState.serviceId}
        serviceName={startRunModalState.serviceName}
        onClose={handleCloseStartRunModal}
        onRunStarted={handleStartRunModalRunStarted}
        onRunStartError={handleStartRunModalError}
        lockedSourceMode={startRunModalState.lockedSourceMode}
      />

      {/* Spec 2026-05-06: Library Discovery Integration -- Task Group 7
          Preflight modal for library-aware discovery runs. */}
      <PreflightModal
        isOpen={preflightModalState.isOpen}
        onClose={handleClosePreflightModal}
        onConfirm={handlePreflightConfirm}
        rootEntity={{
          kind: preflightModalState.rootKind,
          id: preflightModalState.rootId,
          name: preflightModalState.rootName,
        }}
        previewFn={handlePreflightPreviewFn}
      />
      <Toast
        message={toastState.message}
        type={toastState.type}
        visible={toastState.visible}
        onDismiss={dismissToast}
        data-testid="grid-start-run-toast"
      />

      {/* Task Group 7: Advanced Add dialog */}
      <AdvancedAddDialog
        isOpen={advancedAddDialogState.isOpen}
        onClose={handleCloseAdvancedAddDialog}
        onAdd={handleAdvancedAddResult}
        rootEntity={{
          id: advancedAddDialogState.entityId,
          name: advancedAddDialogState.entityName,
          type: advancedAddDialogState.entityType,
        }}
        metaModel={state.model.metaModel}
      />

      {/* Spec 2026-01-05: Attach Business Logic Modal */}
      <AttachBusinessLogicModal
        isOpen={attachBusinessLogicModalState.isOpen}
        onClose={handleCloseAttachBusinessLogicModal}
        onSubmit={handleAttachBusinessLogicSubmit}
        applicationPointId={attachBusinessLogicModalState.applicationPointId}
        applicationPointName={attachBusinessLogicModalState.applicationPointName}
        metaModel={state.model.metaModel}
      />

      {/* Spec 2026-01-05: Attach to Application Point Modal */}
      <AttachToApplicationPointModal
        isOpen={attachToApplicationPointModalState.isOpen}
        onClose={handleCloseAttachToApplicationPointModal}
        onSubmit={handleAttachToApplicationPointSubmit}
        onDetach={handleDetachFromApplicationPoint}
        businessLogicId={attachToApplicationPointModalState.businessLogicId}
        businessLogicName={attachToApplicationPointModalState.businessLogicName}
        metaModel={state.model.metaModel}
      />

      {/* Spec 2026-01-05: Create Business Logic Modal (Task Group 6) */}
      <CreateBusinessLogicModal
        isOpen={isCreateBusinessLogicModalOpen}
        onClose={handleCloseCreateBusinessLogicModal}
        onSubmit={handleCreateBusinessLogicSubmit}
      />

      {/* Spec 2026-01-06: Create Package Set Modal (Task Group 4) */}
      <CreatePackageSetModal
        isOpen={packageSetModalState.isOpen}
        onClose={handleClosePackageSetModal}
        onSubmit={handlePackageSetModalSubmit}
        mode={packageSetModalState.mode}
        initialData={packageSetModalState.cloneData}
      />
    </div>
  );
}

export function createEmptyEntity(entityType: EntityType): AnyEntity {
  const id = generateEntityId(entityType);

  const baseEntity = {
    id,
    name: '',
    description: '',
    tags: '',
  };

  switch (entityType) {
    case 'business_users':
    case 'business_processes':
    case 'logical_data_entities':
      return baseEntity;

    case 'applications':
      return {
        ...baseEntity,
        app_type: '',
        status: '',
      };

    case 'app_components':
      return {
        ...baseEntity,
        application_id: '',
      };

    case 'services':
      return {
        ...baseEntity,
        application_id: '',
        app_component_id: '',
        service_type: '',
        // Spec 2026-01-06: package_set_id defaults to null (Default Auto behavior)
        package_set_id: null,
      };

    case 'application_points':
      return {
        ...baseEntity,
        application_id: '',
        point_type: '',
      };

    case 'physical_data_entities':
      return {
        ...baseEntity,
        logical_entity_id: '',
        physical_type: '',
        database: '',
      };

    case 'logical_data_attributes':
      return {
        ...baseEntity,
        logical_entity_id: '',
        data_type: '',
        is_primary_key: false,
        is_nullable: true,
      };

    case 'physical_data_attributes':
      return {
        ...baseEntity,
        physical_entity_id: '',
        data_type: '',
        is_primary_key: false,
        is_nullable: true,
      };

    // Task Group 7: Add endpoints entity creation
    // Note: endpoint_type uses the EndpointType enum - HTTP_REST is a common default
    case 'endpoints':
      return {
        ...baseEntity,
        interface_id: '',
        endpoint_type: EndpointType.HTTP_REST,
        path_or_address: '',
      };

    // Task Group 7: Add interfaces entity creation
    // Note: interface_type uses the InterfaceType union - REST_API is a common default
    case 'interfaces':
      return {
        ...baseEntity,
        service_id: '',
        interface_type: 'REST_API' as const,
      };

    // Interactions entity creation - for Interactions meta-model tab
    case 'interactions':
      return {
        id,
        name: '',
        description: '',
        user_id: '',
        primary_app_business_point_id: '',
        secondary_app_business_point_id: '',
      };

    case 'process_activities':
      return {
        ...baseEntity,
        business_process_id: '',
        actor_hint: 'END_USER',
        user_interaction_level: 'MODERATE',
      };

    // Behavioural domain: Events
    // Event interface has: source_ref_kind, source_ref_id, payload_ref_kind, payload_ref_id, payload_primitive_type
    case 'events': {
      const eventEntity: Event = {
        id,
        name: '',
        description: '',
        tags: '',
        source_ref_kind: undefined,
        source_ref_id: undefined,
        payload_ref_kind: undefined,
        payload_ref_id: undefined,
        payload_primitive_type: undefined,
      };
      return eventEntity;
    }

    // Application Architecture domain: Classes
    // Class interface has: namespace, service_id
    // Spec: Extension Pack Framework - replaced application_point_id with service_id
    case 'classes': {
      const classEntity: Class = {
        id,
        name: '',
        description: '',
        namespace: undefined,
        service_id: undefined,
      };
      return classEntity;
    }

    // Behavioural domain: Methods
    // Method interface has: class_id, parameters_json, returns_json, throws_json
    case 'methods': {
      const methodEntity: Method = {
        id,
        class_id: '',
        name: '',
        description: '',
        parameters_json: undefined,
        returns_json: undefined,
        throws_json: undefined,
      };
      return methodEntity;
    }

    // Behavioural domain: States
    // State interface has: state_kind, owner_ref_kind, owner_ref_id
    case 'states': {
      const stateEntity: State = {
        id,
        name: '',
        description: '',
        state_kind: 'Normal' as const,
        owner_ref_kind: undefined,
        owner_ref_id: undefined,
      };
      return stateEntity;
    }

    // Behavioural domain: State Transitions (no name field)
    // StateTransition interface has many fields for trigger, guard, effect
    case 'state_transitions': {
      const transitionEntity: StateTransition = {
        id,
        from_state_id: '',
        to_state_id: '',
        order_index: undefined,
        description: '',
        trigger_ref_kind: undefined,
        trigger_ref_id: undefined,
        trigger_label_text: undefined,
        guard_ref_kind: undefined,
        guard_ref_id: undefined,
        guard_expression: undefined,
        effect_ref_kind: undefined,
        effect_ref_id: undefined,
        effect_label_text: undefined,
      };
      return transitionEntity;
    }

    // Behavioural domain: BusinessLogic
    // Note: This case is no longer reached for "+ Add Row" because we intercept
    // business_logics in handleAddRow to open CreateBusinessLogicModal.
    // Kept for completeness and potential programmatic entity creation.
    case 'business_logics': {
      const businessLogicEntity: BusinessLogic = {
        id,
        name: '',
        type_text: undefined,
        description_md: undefined,
        tags: '',
        valid_from: undefined,
        valid_to: undefined,
      };
      return businessLogicEntity;
    }

    // ============================================================================
    // Spec 2026-01-20: UI Characteristics Entity (Task Group 4)
    // UICharacteristic interface has: uiId, type, key, name, description, evidence
    // ============================================================================
    case 'ui_characteristics': {
      const uiCharacteristicEntity: UICharacteristic = {
        id,
        uiId: '',
        type: 'business_feature' as const,
        key: undefined,
        name: '',
        description: undefined,
        evidence: undefined,
      };
      return uiCharacteristicEntity;
    }

    // Spec 2026-04-01: User Journeys empty entity
    case 'user_journeys':
      return {
        ...baseEntity,
        primary_business_user_id: '',
        parent_business_process_id: '',
      };

    // Spec 2026-04-01: Activity Steps empty entity
    case 'activity_steps':
      return {
        ...baseEntity,
        user_journey_id: '',
        sequence_order: undefined,
        process_activity_id: '',
        business_user_id: '',
        application_id: '',
      };

    default:
      return baseEntity;
  }
}
