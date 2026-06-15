/**
 * RelationshipGrid Component
 *
 * Multi-select support: Shift+click (range), Alt+click (toggle), multi-delete, multi-drag.
 *
 * A grid component for displaying and editing relationship data
 * (e.g., data_movements, logical_data_entity_relationships, etc.).
 *
 * Spec: Standardize Relationship Dropdown Display Labels
 * Task Groups 3-4: Updated to pass relationshipKey to GridCell for label cache dispatch.
 *
 * Spec 2026-01-11: Data Movement Interface Schema Extension
 * - Added mutual exclusivity UX for dataEntityPointId and interfaceWithSchemaId
 * - When one XOR field is set, the other is automatically cleared
 */

import { useState, useMemo, useCallback, useEffect } from 'react';
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
import { RelationshipType, AnyRelationship, EntityType, AnyEntity } from '../../types/model';
import { gridConfigs } from '../../config/gridConfigs';
import { generateRelationshipId, generateEntityId } from '../../utils/idGenerator';
import { GridCell } from './GridCell';
import styles from './Grid.module.css';

interface RelationshipGridProps {
  relationshipType: RelationshipType;
}

/**
 * Determines if a relationship type is actually stored in entities rather than relationships.
 * This is the case for "interactions" which is displayed in the Relationships row
 * but stored in metaModel.entities.interactions.
 */
function isEntityStoredRelationshipType(type: string): boolean {
  return type === 'interactions';
}

/**
 * Spec 2026-01-11: Data Movement Interface Schema Extension
 * XOR field groups for mutual exclusivity.
 * When a field in the group is set, the other fields in the group are cleared.
 */
const XOR_FIELD_GROUPS: Record<string, Record<string, string[]>> = {
  data_movements: {
    dataEntityPointId: ['interfaceWithSchemaId'],
    interfaceWithSchemaId: ['dataEntityPointId'],
  },
};

interface SortableRelationshipRowProps {
  id: string;
  isSelected: boolean;
  onClick: (e: React.MouseEvent) => void;
  children: React.ReactNode;
}

function SortableRelationshipRow({ id, isSelected, onClick, children }: SortableRelationshipRowProps) {
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

export function RelationshipGrid({ relationshipType }: RelationshipGridProps) {
  const state = useArchitecture();
  const dispatch = useArchitectureDispatch();
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set());
  const [anchorRowId, setAnchorRowId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  // Clear search term and selection when relationship type changes
  useEffect(() => {
    setSearchTerm('');
    setSelectedRowIds(new Set());
    setAnchorRowId(null);
  }, [relationshipType]);

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(KeyboardSensor)
  );

  const columns = gridConfigs[relationshipType];

  // Task Group 3.2: Add fallback to entities for types like "interactions"
  // that are stored in entities but displayed as relationships
  const relationships = (
    state.model.metaModel.relationships[relationshipType] ||
    state.model.metaModel.entities[relationshipType as keyof typeof state.model.metaModel.entities]
  ) as AnyRelationship[] | undefined;

  // Resolve FK entity name by looking up entity ID in the metaModel
  const resolveEntityName = useCallback((fkTarget: string, entityId: string): string => {
    const entityArray = (state.model.metaModel.entities as unknown as Record<string, { id: string; name?: string }[]>)[fkTarget];
    if (!entityArray) return '';
    const entity = entityArray.find(e => e.id === entityId);
    return entity?.name ?? '';
  }, [state.model.metaModel.entities]);

  // Filter relationships by search term (matches on FK-resolved entity names or name field)
  const filteredRelationships = useMemo(() => {
    if (!searchTerm || !relationships || !columns) return relationships ?? [];
    const term = searchTerm.toLowerCase();
    const fkColumns = columns.filter(c => c.cellType === 'fk_typeahead' && c.fkTarget);

    return relationships.filter(rel => {
      // Check name field if it exists
      const rec = rel as unknown as Record<string, unknown>;
      if (typeof rec.name === 'string' && rec.name.toLowerCase().includes(term)) return true;

      // Check FK columns - resolve referenced entity names
      return fkColumns.some(col => {
        const fkValue = rec[col.field];
        if (typeof fkValue !== 'string' || !fkValue) return false;
        const resolvedName = resolveEntityName(col.fkTarget!, fkValue);
        return resolvedName.toLowerCase().includes(term);
      });
    });
  }, [relationships, searchTerm, columns, resolveEntityName]);

  const filteredRelationshipIds = useMemo(
    () => filteredRelationships.map(r => r.id),
    [filteredRelationships]
  );

  // Handle drag end - reorder the full relationships array (supports multi-row block move)
  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !relationships) return;

    let reordered: AnyRelationship[];

    if (selectedRowIds.size > 1 && selectedRowIds.has(active.id as string)) {
      // Multi-row block move: collect selected rows in their current order
      const selectedInOrder = relationships.filter(r => selectedRowIds.has(r.id));
      const remaining = relationships.filter(r => !selectedRowIds.has(r.id));
      const overIndex = remaining.findIndex(r => r.id === over.id);
      if (overIndex === -1) return;
      const activeOriginalIndex = relationships.findIndex(r => r.id === active.id);
      const overOriginalIndex = relationships.findIndex(r => r.id === over.id);
      const insertIdx = activeOriginalIndex < overOriginalIndex ? overIndex + 1 : overIndex;
      reordered = [...remaining.slice(0, insertIdx), ...selectedInOrder, ...remaining.slice(insertIdx)];
    } else {
      // Single row drag
      const oldFullIndex = relationships.findIndex(r => r.id === active.id);
      const newFullIndex = relationships.findIndex(r => r.id === over.id);
      if (oldFullIndex === -1 || newFullIndex === -1) return;
      reordered = arrayMove(relationships, oldFullIndex, newFullIndex);
    }

    if (isEntityStoredRelationshipType(relationshipType)) {
      dispatch({
        type: 'REORDER_ENTITIES',
        entityType: relationshipType as EntityType,
        entities: reordered as unknown as AnyEntity[],
      });
    } else {
      dispatch({
        type: 'REORDER_RELATIONSHIPS',
        relationshipType,
        relationships: reordered,
      });
    }
  }, [relationships, selectedRowIds, dispatch, relationshipType]);

  // Defensive handling: show error if columns configuration is missing
  if (!columns) {
    return (
      <div className={styles.gridWrapper}>
        <div style={{ padding: '20px', color: '#dc3545', textAlign: 'center' }}>
          No configuration found for relationship type: {relationshipType}
        </div>
      </div>
    );
  }

  // Defensive handling: show error if relationships data is missing
  if (!relationships) {
    return (
      <div className={styles.gridWrapper}>
        <div style={{ padding: '20px', color: '#dc3545', textAlign: 'center' }}>
          No data found for relationship type: {relationshipType}
        </div>
      </div>
    );
  }

  const handleAddRow = () => {
    // Task Group 3.4: Use entity actions for interactions
    if (isEntityStoredRelationshipType(relationshipType)) {
      const newEntity = createEmptyInteraction(relationshipType);
      dispatch({
        type: 'ADD_ENTITY',
        entityType: relationshipType as EntityType,
        entity: newEntity as AnyEntity,
      });
      setSelectedRowIds(new Set([newEntity.id]));
      setAnchorRowId(newEntity.id);
    } else {
      const newRelationship = createEmptyRelationship(relationshipType);
      dispatch({ type: 'ADD_RELATIONSHIP', relationshipType, relationship: newRelationship });
      setSelectedRowIds(new Set([newRelationship.id]));
      setAnchorRowId(newRelationship.id);
    }
  };

  const handleDeleteRow = () => {
    if (selectedRowIds.size === 0) return;
    for (const id of selectedRowIds) {
      // Task Group 3.4: Use entity actions for interactions
      if (isEntityStoredRelationshipType(relationshipType)) {
        dispatch({
          type: 'DELETE_ENTITY',
          entityType: relationshipType as EntityType,
          id,
        });
      } else {
        dispatch({ type: 'DELETE_RELATIONSHIP', relationshipType, id });
      }
    }
    setSelectedRowIds(new Set());
    setAnchorRowId(null);
  };

  const handleRowClick = (id: string, e: React.MouseEvent) => {
    if (e.shiftKey && anchorRowId) {
      // Shift+click: select contiguous range from anchor to clicked row
      const anchorIdx = filteredRelationships.findIndex(r => r.id === anchorRowId);
      const clickIdx = filteredRelationships.findIndex(r => r.id === id);
      if (anchorIdx !== -1 && clickIdx !== -1) {
        const start = Math.min(anchorIdx, clickIdx);
        const end = Math.max(anchorIdx, clickIdx);
        const rangeIds = new Set(filteredRelationships.slice(start, end + 1).map(r => r.id));
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
      setSelectedRowIds(new Set([id]));
      setAnchorRowId(id);
    }
  };

  const handleCellChange = (relationshipId: string, field: string, value: unknown) => {
    const relationship = relationships.find((r) => r.id === relationshipId);
    if (relationship) {
      let updatedRelationship = { ...relationship, [field]: value };

      // ============================================================================
      // Spec 2026-01-11: Data Movement Interface Schema Extension
      // Mutual Exclusivity UX: When setting an XOR field, clear other fields in group
      // ============================================================================
      const xorGroups = XOR_FIELD_GROUPS[relationshipType];
      if (xorGroups && xorGroups[field] && value && value !== '') {
        // Clear other fields in the XOR group when this field gets a value
        xorGroups[field].forEach((otherField) => {
          (updatedRelationship as Record<string, unknown>)[otherField] = '';
        });
      }

      // Task Group 3.4: Use entity actions for interactions
      if (isEntityStoredRelationshipType(relationshipType)) {
        dispatch({
          type: 'UPDATE_ENTITY',
          entityType: relationshipType as EntityType,
          entity: updatedRelationship as unknown as AnyEntity,
        });
      } else {
        dispatch({ type: 'UPDATE_RELATIONSHIP', relationshipType, relationship: updatedRelationship });
      }
    }
  };

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
              items={filteredRelationshipIds}
              strategy={verticalListSortingStrategy}
            >
              <tbody>
                {filteredRelationships.map((relationship) => (
                  <SortableRelationshipRow
                    key={relationship.id}
                    id={relationship.id}
                    isSelected={selectedRowIds.has(relationship.id)}
                    onClick={(e) => handleRowClick(relationship.id, e)}
                  >
                    {columns.map((column) => (
                      <td key={`${relationship.id}-${column.field}`} className={styles.dataCell}>
                        <GridCell
                          entity={relationship as unknown as import('../../types/model').AnyEntity}
                          column={column}
                          entityType={'business_users'} // This is just for type compatibility
                          model={state.model}
                          errors={[]}
                          onChange={(value) => handleCellChange(relationship.id, column.field, value)}
                          // Spec: Standardize Relationship Dropdown Display Labels
                          // Pass relationshipType as relationshipKey for label cache dispatch
                          relationshipKey={relationshipType}
                        />
                      </td>
                    ))}
                  </SortableRelationshipRow>
                ))}
              </tbody>
            </SortableContext>
          </DndContext>
        </table>
      </div>
    </div>
  );
}

function createEmptyRelationship(relationshipType: RelationshipType): AnyRelationship {
  const id = generateRelationshipId(relationshipType);

  const baseRelationship = {
    id,
    description: '',
    tags: '',
  };

  switch (relationshipType) {
    // New Business Point relationship types
    case 'business_user_business_points':
      return {
        ...baseRelationship,
        business_user_id: '',
        business_point_id: '',
      };

    case 'application_point_business_points':
      return {
        ...baseRelationship,
        application_point_id: '',
        business_point_id: '',
      };

    case 'logical_data_entity_relationships':
      // Logical ER Meta-Model Upgrade: Updated to use new field names
      // - from_ref_kind, from_ref_id (polymorphic source endpoint)
      // - to_ref_kind, to_ref_id (polymorphic target endpoint)
      // - cardinality (optional, renamed from relationship_type)
      // - relationship (optional, new UML relationship type field)
      return {
        ...baseRelationship,
        from_ref_kind: 'LOGICAL_ENTITY',
        from_ref_id: '',
        to_ref_kind: 'LOGICAL_ENTITY',
        to_ref_id: '',
        // cardinality and relationship are optional - user can set later via grid editing
      } as AnyRelationship;

    case 'logical_data_entity_physical_data_entities':
      return {
        ...baseRelationship,
        logical_entity_id: '',
        physical_entity_id: '',
      };

    case 'logical_data_attribute_physical_data_attributes':
      return {
        ...baseRelationship,
        logical_attribute_id: '',
        physical_attribute_id: '',
      };

    case 'data_movements':
      // Spec 2026-01-11: Data Movement Interface Schema Extension
      // Neither dataEntityPointId nor interfaceWithSchemaId is set by default
      // (XOR constraint: exactly one must be set, user chooses which)
      return {
        ...baseRelationship,
        // References Application Points
        source_application_point_id: '',
        target_application_point_id: '',
        // XOR fields: dataEntityPointId OR interfaceWithSchemaId
        // Both start empty - user must set one
        dataEntityPointId: '',
        interfaceWithSchemaId: '',
        biDirectional: false,
        movement_type: '',
      } as AnyRelationship;

    case 'interface_logical_entities':
      return {
        ...baseRelationship,
        interface_id: '',
        logical_entity_id: '',
      };

    default:
      return baseRelationship as AnyRelationship;
  }
}

/**
 * Task Group 3.3: Creates an empty Interaction entity for use in RelationshipGrid.
 * Interactions are stored in metaModel.entities.interactions but displayed via RelationshipGrid.
 */
function createEmptyInteraction(relationshipType: string): AnyEntity {
  const id = generateEntityId(relationshipType as EntityType);

  // Match the shape defined in gridConfigs.interactions columns
  return {
    id,
    name: '',
    description: '',
    user_id: '',
    primary_app_business_point_id: '',
    secondary_app_business_point_id: '',
    tags: '',
  } as AnyEntity;
}
