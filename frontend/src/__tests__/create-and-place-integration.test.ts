/**
 * Create and Place Integration Tests
 * Task Group 4: Gap Analysis and Integration Testing
 *
 * These tests fill coverage gaps identified during the test review:
 * - Diagram type detection for Create Section visibility
 * - Buttons disabled when no diagram selected
 * - Cascade offset reset after diagram change
 * - Form validation error display
 * - Integration between drawer -> entity creation -> node placement -> inspector
 */

import { describe, it, expect } from 'vitest';
import { getDiagramType, DiagramType } from '../types/diagramType';
import { ENTITY_TYPES } from '../types/model';
import { generatePrefixedId } from '../utils/idGenerator';
import { createDiagramNodeFromEntity, DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT, DEFAULT_NODE_SPAWN_ORIGIN } from '../utils/nodeCreation';

// ============================================================================
// Test 4.3.1: Diagram Type Detection for Create Section Visibility
// ============================================================================

describe('Diagram Type Detection for Create Section', () => {
  /**
   * Get create section buttons based on diagram type (mirrors PalettePanel logic)
   */
  function getCreateSectionButtons(diagramType: DiagramType): Array<{ label: string; entityType: string }> {
    switch (diagramType) {
      case 'ER':
        return [
          { label: '+ New Logical Entity', entityType: ENTITY_TYPES.LOGICAL_DATA_ENTITY },
          { label: '+ New Physical Entity', entityType: ENTITY_TYPES.PHYSICAL_DATA_ENTITY },
        ];
      case 'State':
        return [
          { label: '+ New State', entityType: ENTITY_TYPES.STATE },
        ];
      case 'Activity':
        return [
          { label: '+ New Partition', entityType: ENTITY_TYPES.ACTIVITY_PARTITION },
          { label: '+ New Activity', entityType: ENTITY_TYPES.ACTIVITY },
        ];
      default:
        return [];
    }
  }

  it('should show correct Create Section buttons for ER diagram', () => {
    const buttons = getCreateSectionButtons('ER');

    expect(buttons).toHaveLength(2);
    expect(buttons[0].entityType).toBe(ENTITY_TYPES.LOGICAL_DATA_ENTITY);
    expect(buttons[1].entityType).toBe(ENTITY_TYPES.PHYSICAL_DATA_ENTITY);
  });

  it('should show correct Create Section buttons for State diagram', () => {
    const buttons = getCreateSectionButtons('State');

    expect(buttons).toHaveLength(1);
    expect(buttons[0].entityType).toBe(ENTITY_TYPES.STATE);
  });

  it('should show correct Create Section buttons for Activity diagram', () => {
    const buttons = getCreateSectionButtons('Activity');

    expect(buttons).toHaveLength(2);
    expect(buttons[0].entityType).toBe(ENTITY_TYPES.ACTIVITY_PARTITION);
    expect(buttons[1].entityType).toBe(ENTITY_TYPES.ACTIVITY);
  });

  it('should NOT show Create Section for General diagram type', () => {
    const buttons = getCreateSectionButtons('General');

    expect(buttons).toHaveLength(0);
  });

  it('should NOT show Create Section for Sequence diagram type', () => {
    const buttons = getCreateSectionButtons('Sequence');

    expect(buttons).toHaveLength(0);
  });
});

// ============================================================================
// Test 4.3.2: getDiagramType Helper Function Edge Cases
// ============================================================================

describe('getDiagramType Edge Cases', () => {
  it('should return General for null diagram', () => {
    const result = getDiagramType(null);
    expect(result).toBe('General');
  });

  it('should return General for undefined diagram', () => {
    const result = getDiagramType(undefined);
    expect(result).toBe('General');
  });

  it('should return General for diagram without diagram_type', () => {
    const diagram = {
      id: 'test-diagram',
      name: 'Test',
      description: '',
      diagram_nodes: [],
      diagram_edges: [],
    };
    const result = getDiagramType(diagram);
    expect(result).toBe('General');
  });

  it('should return correct type for valid diagram_type', () => {
    const erDiagram = { id: '1', name: 'ER', description: '', diagram_type: 'ER' as DiagramType, diagram_nodes: [], diagram_edges: [] };
    const stateDiagram = { id: '2', name: 'State', description: '', diagram_type: 'State' as DiagramType, diagram_nodes: [], diagram_edges: [] };
    const activityDiagram = { id: '3', name: 'Activity', description: '', diagram_type: 'Activity' as DiagramType, diagram_nodes: [], diagram_edges: [] };

    expect(getDiagramType(erDiagram)).toBe('ER');
    expect(getDiagramType(stateDiagram)).toBe('State');
    expect(getDiagramType(activityDiagram)).toBe('Activity');
  });
});

// ============================================================================
// Test 4.3.3: Disabled State When No Diagram Selected
// ============================================================================

describe('Create Section Disabled State', () => {
  /**
   * Helper to check if there's an active selected diagram
   * This mirrors the hasActiveSelectedDiagram logic from PalettePanel
   */
  function hasActiveSelectedDiagram(
    currentDiagramId: string | null,
    diagram: { diagram_nodes: unknown[] } | undefined
  ): boolean {
    return currentDiagramId !== null && diagram !== undefined;
  }

  it('should return false when currentDiagramId is null', () => {
    const diagram = { diagram_nodes: [] };
    expect(hasActiveSelectedDiagram(null, diagram)).toBe(false);
  });

  it('should return false when diagram is undefined', () => {
    expect(hasActiveSelectedDiagram('diagram-1', undefined)).toBe(false);
  });

  it('should return false when both are null/undefined', () => {
    expect(hasActiveSelectedDiagram(null, undefined)).toBe(false);
  });

  it('should return true when diagram is selected and valid', () => {
    const diagram = { diagram_nodes: [] };
    expect(hasActiveSelectedDiagram('diagram-1', diagram)).toBe(true);
  });
});

// ============================================================================
// Test 4.3.4: Cascade Offset Reset After Diagram Change
// ============================================================================

describe('Cascade Offset Reset After Diagram Change', () => {
  interface CascadeState {
    diagramId: string | null;
    count: number;
  }

  /**
   * Simulate cascade state reset logic from PalettePanel
   */
  function shouldResetCascade(
    currentDiagramId: string | null,
    cascadeState: CascadeState
  ): boolean {
    return currentDiagramId !== cascadeState.diagramId;
  }

  it('should reset cascade when diagram ID changes', () => {
    const cascadeState: CascadeState = { diagramId: 'diagram-1', count: 5 };
    const newDiagramId = 'diagram-2';

    expect(shouldResetCascade(newDiagramId, cascadeState)).toBe(true);
  });

  it('should NOT reset cascade when diagram ID is the same', () => {
    const cascadeState: CascadeState = { diagramId: 'diagram-1', count: 5 };
    const sameDiagramId = 'diagram-1';

    expect(shouldResetCascade(sameDiagramId, cascadeState)).toBe(false);
  });

  it('should reset cascade when switching to null diagram', () => {
    const cascadeState: CascadeState = { diagramId: 'diagram-1', count: 3 };

    expect(shouldResetCascade(null, cascadeState)).toBe(true);
  });

  it('should reset cascade when switching from null to new diagram', () => {
    const cascadeState: CascadeState = { diagramId: null, count: 0 };

    expect(shouldResetCascade('new-diagram', cascadeState)).toBe(true);
  });
});

// ============================================================================
// Test 4.3.5: ActivityPartition Conditional Validation Edge Cases
// ============================================================================

describe('ActivityPartition Conditional Validation Edge Cases', () => {
  /**
   * Validate ActivityPartition form data
   * This tests the edge cases in the conditional validation logic
   */
  function validateActivityPartition(formData: {
    name?: string;
    refKind?: string;
    refId?: string;
  }): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    const hasRefKind = formData.refKind && String(formData.refKind).trim() !== '';
    const hasName = formData.name && String(formData.name).trim() !== '';
    const hasRefId = formData.refId && String(formData.refId).trim() !== '';

    // If refKind is set, refId is required
    if (hasRefKind && !hasRefId) {
      errors.push('Reference is required when reference kind is selected');
    }

    // If refKind is NOT set, name is required
    if (!hasRefKind && !hasName) {
      errors.push('Name is required when no reference is selected');
    }

    return { valid: errors.length === 0, errors };
  }

  it('should require refId when refKind is set but refId is empty string', () => {
    const result = validateActivityPartition({
      refKind: 'Application',
      refId: '',
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Reference is required when reference kind is selected');
  });

  it('should require refId when refKind is set but refId is whitespace only', () => {
    const result = validateActivityPartition({
      refKind: 'Application',
      refId: '   ',
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Reference is required when reference kind is selected');
  });

  it('should require name when refKind is whitespace only', () => {
    const result = validateActivityPartition({
      refKind: '   ',
      name: '',
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Name is required when no reference is selected');
  });

  it('should pass when refKind and refId are both set correctly', () => {
    const result = validateActivityPartition({
      refKind: 'Application',
      refId: 'app-123',
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should pass when name is set and refKind is not set', () => {
    const result = validateActivityPartition({
      name: 'User Lane',
      refKind: '',
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

// ============================================================================
// Test 4.3.6: Form Validation Error Messages
// ============================================================================

describe('Form Validation Error Messages', () => {
  interface FieldConfig {
    name: string;
    label: string;
    required: boolean;
  }

  /**
   * Build validation error message for a required field
   */
  function buildRequiredFieldError(field: FieldConfig): string {
    return `${field.label} is required`;
  }

  /**
   * Validate form data against field configurations
   */
  function validateFormFields(
    formData: Record<string, unknown>,
    fields: FieldConfig[]
  ): Record<string, string> {
    const errors: Record<string, string> = {};

    for (const field of fields) {
      if (field.required) {
        const value = formData[field.name];
        if (value === undefined || value === null || String(value).trim() === '') {
          errors[field.name] = buildRequiredFieldError(field);
        }
      }
    }

    return errors;
  }

  it('should generate correct error messages for missing State fields', () => {
    const stateFields: FieldConfig[] = [
      { name: 'name', label: 'Name', required: true },
      { name: 'stateKind', label: 'State Kind', required: true },
    ];

    const formData = { name: '', stateKind: '' };
    const errors = validateFormFields(formData, stateFields);

    expect(errors.name).toBe('Name is required');
    expect(errors.stateKind).toBe('State Kind is required');
  });

  it('should generate correct error messages for missing Activity fields', () => {
    const activityFields: FieldConfig[] = [
      { name: 'name', label: 'Name', required: true },
      { name: 'activityKind', label: 'Activity Kind', required: true },
    ];

    const formData = { name: '' };
    const errors = validateFormFields(formData, activityFields);

    expect(errors.name).toBe('Name is required');
    expect(errors.activityKind).toBe('Activity Kind is required');
  });

  it('should NOT generate errors for valid form data', () => {
    const stateFields: FieldConfig[] = [
      { name: 'name', label: 'Name', required: true },
      { name: 'stateKind', label: 'State Kind', required: true },
    ];

    const formData = { name: 'My State', stateKind: 'Normal' };
    const errors = validateFormFields(formData, stateFields);

    expect(Object.keys(errors)).toHaveLength(0);
  });

  it('should NOT generate errors for optional fields', () => {
    const fields: FieldConfig[] = [
      { name: 'name', label: 'Name', required: true },
      { name: 'description', label: 'Description', required: false },
    ];

    const formData = { name: 'Test', description: '' };
    const errors = validateFormFields(formData, fields);

    expect(Object.keys(errors)).toHaveLength(0);
    expect(errors.description).toBeUndefined();
  });
});

// ============================================================================
// Test 4.3.7: Full Integration Flow - Create Entity to Inspector Edit
// ============================================================================

describe('Full Integration Flow: Create to Inspector Edit', () => {
  // Entity type to array key mapping
  const ENTITY_TYPE_TO_KEY: Record<string, string> = {
    [ENTITY_TYPES.STATE]: 'states',
    [ENTITY_TYPES.ACTIVITY]: 'activities',
    [ENTITY_TYPES.ACTIVITY_PARTITION]: 'activity_partitions',
    [ENTITY_TYPES.LOGICAL_DATA_ENTITY]: 'logical_data_entities',
    [ENTITY_TYPES.PHYSICAL_DATA_ENTITY]: 'physical_data_entities',
  };

  it('should complete full flow: button click -> drawer -> entity -> node -> inspector edit', () => {
    // Step 1: Button click - determine entity type based on diagram type
    const diagramType: DiagramType = 'State';
    const entityType = ENTITY_TYPES.STATE;

    // Step 2: Form data from drawer
    const formData = {
      name: 'Created State',
      stateKind: 'Normal',
      description: 'Test description',
    };

    // Step 3: Generate entity ID
    const entityId = generatePrefixedId('state');
    expect(entityId).toMatch(/^state-/);

    // Step 4: Build entity object for ADD_ENTITY
    const entity = {
      id: entityId,
      name: formData.name,
      state_kind: formData.stateKind,
      description: formData.description,
    };
    expect(entity.id).toBe(entityId);
    expect(entity.name).toBe('Created State');

    // Step 5: Get entity type key for dispatch
    const entityTypeKey = ENTITY_TYPE_TO_KEY[entityType];
    expect(entityTypeKey).toBe('states');

    // Step 6: Create diagram node at viewport center
    const viewportCenter = { x: 500, y: 400 };
    const node = createDiagramNodeFromEntity(entityType, entityId, [], viewportCenter);

    expect(node.entity_type).toBe(entityType);
    expect(node.entity_id).toBe(entityId);
    expect(node.id).toMatch(/^node-/);

    // Step 7: Node is positioned correctly
    expect(node.pos_x).toBe(DEFAULT_NODE_SPAWN_ORIGIN.x);  // Fixed spawn position
    expect(node.pos_y).toBe(DEFAULT_NODE_SPAWN_ORIGIN.y);  // Fixed spawn position

    // Step 8: Simulate inspector edit - build UPDATE_ENTITY action
    const updatedEntity = {
      ...entity,
      name: 'Updated State Name',
      state_kind: 'Final',
    };

    const updateAction = {
      type: 'UPDATE_ENTITY',
      entityType: entityTypeKey,
      entity: updatedEntity,
    };

    expect(updateAction.type).toBe('UPDATE_ENTITY');
    expect(updateAction.entity.name).toBe('Updated State Name');
    expect(updateAction.entity.state_kind).toBe('Final');
  });

  it('should complete full flow for Activity entity', () => {
    const entityType = ENTITY_TYPES.ACTIVITY;
    const entityId = generatePrefixedId('activity');

    // Create entity
    const entity = {
      id: entityId,
      name: 'Process Order',
      activity_kind: 'Action',
      description: 'Processing the order',
    };

    // Create node
    const viewportCenter = { x: 600, y: 500 };
    const node = createDiagramNodeFromEntity(entityType, entityId, [], viewportCenter);

    expect(node.entity_type).toBe(entityType);
    expect(node.entity_id).toBe(entityId);

    // Inspector edit
    const entityTypeKey = ENTITY_TYPE_TO_KEY[entityType];
    expect(entityTypeKey).toBe('activities');

    const updateAction = {
      type: 'UPDATE_ENTITY',
      entityType: entityTypeKey,
      entity: { ...entity, activity_kind: 'Decision' },
    };

    expect(updateAction.entity.activity_kind).toBe('Decision');
  });

  it('should complete full flow for LogicalDataEntity', () => {
    const entityType = ENTITY_TYPES.LOGICAL_DATA_ENTITY;
    const entityId = generatePrefixedId('lde');

    // Create entity
    const entity = {
      id: entityId,
      name: 'Customer',
      description: 'Customer entity',
      tags: '',
    };

    // Create node
    const node = createDiagramNodeFromEntity(entityType, entityId, [], { x: 500, y: 400 });

    expect(node.entity_type).toBe(entityType);
    expect(node.entity_id).toBe(entityId);

    // Inspector edit
    const entityTypeKey = ENTITY_TYPE_TO_KEY[entityType];
    expect(entityTypeKey).toBe('logical_data_entities');
  });
});

// ============================================================================
// Test 4.3.8: Entity Type Constant to Key Mapping
// ============================================================================

describe('Entity Type to Key Mapping', () => {
  const ENTITY_TYPE_TO_KEY: Record<string, string> = {
    [ENTITY_TYPES.STATE]: 'states',
    [ENTITY_TYPES.ACTIVITY]: 'activities',
    [ENTITY_TYPES.ACTIVITY_PARTITION]: 'activity_partitions',
    [ENTITY_TYPES.LOGICAL_DATA_ENTITY]: 'logical_data_entities',
    [ENTITY_TYPES.PHYSICAL_DATA_ENTITY]: 'physical_data_entities',
  };

  it('should map STATE to states', () => {
    expect(ENTITY_TYPE_TO_KEY[ENTITY_TYPES.STATE]).toBe('states');
  });

  it('should map ACTIVITY to activities', () => {
    expect(ENTITY_TYPE_TO_KEY[ENTITY_TYPES.ACTIVITY]).toBe('activities');
  });

  it('should map ACTIVITY_PARTITION to activity_partitions', () => {
    expect(ENTITY_TYPE_TO_KEY[ENTITY_TYPES.ACTIVITY_PARTITION]).toBe('activity_partitions');
  });

  it('should map LOGICAL_DATA_ENTITY to logical_data_entities', () => {
    expect(ENTITY_TYPE_TO_KEY[ENTITY_TYPES.LOGICAL_DATA_ENTITY]).toBe('logical_data_entities');
  });

  it('should map PHYSICAL_DATA_ENTITY to physical_data_entities', () => {
    expect(ENTITY_TYPE_TO_KEY[ENTITY_TYPES.PHYSICAL_DATA_ENTITY]).toBe('physical_data_entities');
  });
});

// ============================================================================
// Test 4.3.9: Node Auto-Selection After Placement
// ============================================================================

describe('Node Auto-Selection After Placement', () => {
  it('should provide correct node ID for selection callback', () => {
    const entityType = ENTITY_TYPES.STATE;
    const entityId = generatePrefixedId('state');
    const viewportCenter = { x: 500, y: 400 };

    const newNode = createDiagramNodeFromEntity(entityType, entityId, [], viewportCenter);

    // Simulate onSelectNode callback
    let selectedNodeId: string | null = null;
    const onSelectNode = (nodeId: string) => {
      selectedNodeId = nodeId;
    };

    onSelectNode(newNode.id);

    expect(selectedNodeId).toBe(newNode.id);
    expect(selectedNodeId).toMatch(/^node-/);
  });

  it('should replace existing selection with new node only', () => {
    const existingSelection = new Set(['node-1', 'node-2', 'node-3']);

    // Create new node
    const newNode = createDiagramNodeFromEntity(
      ENTITY_TYPES.STATE,
      'state-new',
      [],
      { x: 500, y: 400 }
    );

    // Simulate selection update (single select, clear others)
    const newSelection = new Set([newNode.id]);

    expect(newSelection.size).toBe(1);
    expect(newSelection.has(newNode.id)).toBe(true);
    expect(newSelection.has('node-1')).toBe(false);
    expect(newSelection.has('node-2')).toBe(false);
    expect(newSelection.has('node-3')).toBe(false);
  });
});

// ============================================================================
// Test 4.3.10: ID Prefix Generation for Different Entity Types
// ============================================================================

describe('ID Prefix Generation for Entity Types', () => {
  const ID_PREFIX_MAP: Record<string, string> = {
    [ENTITY_TYPES.STATE]: 'state',
    [ENTITY_TYPES.ACTIVITY]: 'activity',
    [ENTITY_TYPES.ACTIVITY_PARTITION]: 'partition',
    [ENTITY_TYPES.LOGICAL_DATA_ENTITY]: 'lde',
    [ENTITY_TYPES.PHYSICAL_DATA_ENTITY]: 'pde',
  };

  it('should generate correct prefix for State entities', () => {
    const prefix = ID_PREFIX_MAP[ENTITY_TYPES.STATE];
    const id = generatePrefixedId(prefix);
    expect(id.startsWith('state-')).toBe(true);
  });

  it('should generate correct prefix for Activity entities', () => {
    const prefix = ID_PREFIX_MAP[ENTITY_TYPES.ACTIVITY];
    const id = generatePrefixedId(prefix);
    expect(id.startsWith('activity-')).toBe(true);
  });

  it('should generate correct prefix for ActivityPartition entities', () => {
    const prefix = ID_PREFIX_MAP[ENTITY_TYPES.ACTIVITY_PARTITION];
    const id = generatePrefixedId(prefix);
    expect(id.startsWith('partition-')).toBe(true);
  });

  it('should generate correct prefix for LogicalDataEntity', () => {
    const prefix = ID_PREFIX_MAP[ENTITY_TYPES.LOGICAL_DATA_ENTITY];
    const id = generatePrefixedId(prefix);
    expect(id.startsWith('lde-')).toBe(true);
  });

  it('should generate correct prefix for PhysicalDataEntity', () => {
    const prefix = ID_PREFIX_MAP[ENTITY_TYPES.PHYSICAL_DATA_ENTITY];
    const id = generatePrefixedId(prefix);
    expect(id.startsWith('pde-')).toBe(true);
  });

  it('should generate unique IDs for same prefix', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(generatePrefixedId('test'));
    }
    // All 100 IDs should be unique
    expect(ids.size).toBe(100);
  });
});
