/**
 * context-chips-hydration.test.ts
 *
 * Spec 2026-01-17: Fix Context Chips Hydrate Labels After Navigation
 * Task Groups 1 and 2: Hydration on Context Fetch and Re-Hydration on Architecture Data Load
 *
 * Tests:
 * Task Group 1:
 * - Context with labels matching IDs + loaded metaModel -> hydrated labels resolve to entity names
 * - Diagram refs hydrate to diagram.name from diagrams array
 * - Relationship refs hydrate using resolveRelationshipLabel() to computed label
 *
 * Task Group 2:
 * - Context loads before architecture data -> shows "Loading..."; architecture data loads -> labels resolve
 * - metaModel.entities updates -> entity refs re-hydrate
 * - model.diagrams updates -> diagram refs re-hydrate
 * - metaModel.relationships updates -> relationship refs re-hydrate
 */

import { describe, it, expect } from 'vitest';
import { rehydrateContextLabels } from '../utils/contextLabelResolver';
import type { ContextState, EntityRef, DiagramRef, RelationshipRef } from '../utils/contextStorage';
import type { MetaModelEntities, MetaModelRelationships, Diagram } from '../types/model';

// ============================================================================
// Mock Data - MetaModel Entities
// ============================================================================

const mockMetaModelEntities: MetaModelEntities = {
  business_users: [],
  business_processes: [],
  process_activities: [],
  business_points: [],
  applications: [
    { id: 'app-123', name: 'Portal Application', description: '', app_type: 'web', status: 'active', tags: '' },
    { id: 'app-456', name: 'Backend Service', description: '', app_type: 'api', status: 'active', tags: '' },
  ],
  app_components: [],
  services: [
    { id: 'svc-789', name: 'Auth Service', description: '', application_id: 'app-123', service_type: 'api', tags: '' },
  ],
  interfaces: [],
  endpoints: [],
  classes: [],
  methods: [],
  application_points: [
    {
      id: 'ap-1',
      name: 'Portal App Point',
      description: '',
      kind: 'APPLICATION',
      application_id: 'app-123',
      point_type: '',
      tags: '',
    },
    {
      id: 'ap-2',
      name: 'Backend App Point',
      description: '',
      kind: 'APPLICATION',
      application_id: 'app-456',
      point_type: '',
      tags: '',
    },
  ],
  logical_data_entities: [
    { id: 'lde-1', name: 'Customer Entity', description: '', tags: '' },
  ],
  logical_data_attributes: [],
  physical_data_entities: [],
  physical_data_attributes: [],
  interactions: [],
  app_business_points: [],
  events: [],
  states: [],
  state_transitions: [],
  activities: [],
  activity_flows: [],
  activity_partitions: [],
  business_logics: [],
  ui_screens: [],
  ui_components: [],
  ui_actions: [],
  package_sets: [],
  packages: [],
};

const mockDiagrams: Diagram[] = [
  {
    id: 'diag-1',
    name: 'System Architecture Diagram',
    description: 'Overview of system',
    diagram_nodes: [],
    diagram_edges: [],
  },
  {
    id: 'diag-2',
    name: 'Data Flow Diagram',
    description: 'Data flows',
    diagram_nodes: [],
    diagram_edges: [],
  },
];

const mockMetaModelRelationships: MetaModelRelationships = {
  business_user_business_points: [],
  application_point_business_points: [],
  application_point_business_logics: [],
  logical_data_entity_relationships: [],
  logical_data_entity_physical_data_entities: [],
  logical_data_attribute_physical_data_attributes: [],
  data_movements: [
    {
      id: 'dm-1',
      source_application_point_id: 'ap-1',
      target_application_point_id: 'ap-2',
      movement_type: 'sync',
      description: 'Data sync',
      tags: '',
      dataEntityPointId: 'dep_log_lde-1',
    },
  ],
  interface_logical_entities: [],
  ui_workflow_transitions: [],
};

// ============================================================================
// Task Group 1: Hydration on Context Fetch Tests
// ============================================================================

describe('Task Group 1: Hydration on Context Fetch', () => {
  it('hydrates entity refs with labels matching IDs to entity names', () => {
    // Arrange: Context where label === entity_id (simulating backend-loaded state)
    const contextState: ContextState = {
      version: 1,
      entity_refs: [
        { kind: 'ENTITY', entity_type: 'applications', entity_id: 'app-123', label: 'app-123' },
        { kind: 'ENTITY', entity_type: 'services', entity_id: 'svc-789', label: 'svc-789' },
      ],
      diagram_refs: [],
      relationship_refs: [],
    };

    // Act
    const rehydrated = rehydrateContextLabels(
      contextState,
      mockMetaModelEntities,
      mockDiagrams,
      mockMetaModelRelationships
    );

    // Assert: Labels should now be the entity names
    expect(rehydrated.entity_refs[0].label).toBe('Portal Application');
    expect(rehydrated.entity_refs[1].label).toBe('Auth Service');
  });

  it('hydrates diagram refs to diagram.name from diagrams array', () => {
    // Arrange: Context where diagram label === diagram_id
    const contextState: ContextState = {
      version: 1,
      entity_refs: [],
      diagram_refs: [
        { kind: 'DIAGRAM', diagram_id: 'diag-1', label: 'diag-1' },
        { kind: 'DIAGRAM', diagram_id: 'diag-2', label: '' }, // Empty label
      ],
      relationship_refs: [],
    };

    // Act
    const rehydrated = rehydrateContextLabels(
      contextState,
      mockMetaModelEntities,
      mockDiagrams,
      mockMetaModelRelationships
    );

    // Assert: Labels should now be the diagram names
    expect(rehydrated.diagram_refs[0].label).toBe('System Architecture Diagram');
    expect(rehydrated.diagram_refs[1].label).toBe('Data Flow Diagram');
  });

  it('hydrates relationship refs using resolveRelationshipLabel()', () => {
    // Arrange: Context where relationship label === relationship_id
    const contextState: ContextState = {
      version: 1,
      entity_refs: [],
      diagram_refs: [],
      relationship_refs: [
        { kind: 'RELATIONSHIP', relationship_type: 'data_movements', relationship_id: 'dm-1', label: 'dm-1' },
      ],
    };

    // Act
    const rehydrated = rehydrateContextLabels(
      contextState,
      mockMetaModelEntities,
      mockDiagrams,
      mockMetaModelRelationships
    );

    // Assert: Label should be computed from participant entities
    // Expected format: "Portal App Point [APPLICATION] | Backend App Point [APPLICATION]"
    expect(rehydrated.relationship_refs).toBeDefined();
    expect(rehydrated.relationship_refs!.length).toBe(1);
    expect(rehydrated.relationship_refs![0].label).toContain('Portal App Point');
    expect(rehydrated.relationship_refs![0].label).toContain('Backend App Point');
    expect(rehydrated.relationship_refs![0].label).not.toBe('dm-1');
  });

  it('preserves valid labels that are already hydrated', () => {
    // Arrange: Context where labels are already valid names
    const contextState: ContextState = {
      version: 1,
      entity_refs: [
        { kind: 'ENTITY', entity_type: 'applications', entity_id: 'app-123', label: 'Portal Application' },
      ],
      diagram_refs: [
        { kind: 'DIAGRAM', diagram_id: 'diag-1', label: 'System Architecture Diagram' },
      ],
      relationship_refs: [],
    };

    // Act
    const rehydrated = rehydrateContextLabels(
      contextState,
      mockMetaModelEntities,
      mockDiagrams,
      mockMetaModelRelationships
    );

    // Assert: Labels should remain unchanged (not re-resolved)
    expect(rehydrated.entity_refs[0].label).toBe('Portal Application');
    expect(rehydrated.diagram_refs[0].label).toBe('System Architecture Diagram');
  });
});

// ============================================================================
// Task Group 2: Re-Hydration on Architecture Data Load Tests
// ============================================================================

describe('Task Group 2: Re-Hydration on Architecture Data Load', () => {
  it('returns Loading... labels when architecture data is not yet loaded', () => {
    // Arrange: Context with ID-as-labels, but no architecture data
    const contextState: ContextState = {
      version: 1,
      entity_refs: [
        { kind: 'ENTITY', entity_type: 'applications', entity_id: 'app-123', label: 'app-123' },
      ],
      diagram_refs: [
        { kind: 'DIAGRAM', diagram_id: 'diag-1', label: 'diag-1' },
      ],
      relationship_refs: [
        { kind: 'RELATIONSHIP', relationship_type: 'data_movements', relationship_id: 'dm-1', label: 'dm-1' },
      ],
    };

    // Act: Call with undefined/empty architecture data
    const rehydrated = rehydrateContextLabels(
      contextState,
      undefined, // No entities loaded yet
      undefined, // No diagrams loaded yet
      undefined  // No relationships loaded yet
    );

    // Assert: Labels should be "Loading..."
    expect(rehydrated.entity_refs[0].label).toBe('Loading...');
    expect(rehydrated.diagram_refs[0].label).toBe('Loading...');
    expect(rehydrated.relationship_refs![0].label).toBe('Loading...');
  });

  it('re-hydrates entity refs when metaModel.entities updates', () => {
    // Arrange: Start with Loading... labels
    const contextState: ContextState = {
      version: 1,
      entity_refs: [
        { kind: 'ENTITY', entity_type: 'applications', entity_id: 'app-123', label: 'Loading...' },
      ],
      diagram_refs: [],
      relationship_refs: [],
    };

    // Act: Call with loaded entities
    const rehydrated = rehydrateContextLabels(
      contextState,
      mockMetaModelEntities,
      [],
      { ...mockMetaModelRelationships }
    );

    // Assert: Entity label should now be resolved
    expect(rehydrated.entity_refs[0].label).toBe('Portal Application');
  });

  it('re-hydrates diagram refs when model.diagrams updates', () => {
    // Arrange: Start with Loading... labels
    const contextState: ContextState = {
      version: 1,
      entity_refs: [],
      diagram_refs: [
        { kind: 'DIAGRAM', diagram_id: 'diag-1', label: 'Loading...' },
      ],
      relationship_refs: [],
    };

    // Act: Call with loaded diagrams
    const rehydrated = rehydrateContextLabels(
      contextState,
      mockMetaModelEntities,
      mockDiagrams,
      mockMetaModelRelationships
    );

    // Assert: Diagram label should now be resolved
    expect(rehydrated.diagram_refs[0].label).toBe('System Architecture Diagram');
  });

  it('re-hydrates relationship refs when metaModel.relationships updates', () => {
    // Arrange: Start with Loading... labels
    const contextState: ContextState = {
      version: 1,
      entity_refs: [],
      diagram_refs: [],
      relationship_refs: [
        { kind: 'RELATIONSHIP', relationship_type: 'data_movements', relationship_id: 'dm-1', label: 'Loading...' },
      ],
    };

    // Act: Call with loaded relationships and entities
    const rehydrated = rehydrateContextLabels(
      contextState,
      mockMetaModelEntities,
      mockDiagrams,
      mockMetaModelRelationships
    );

    // Assert: Relationship label should now be computed
    expect(rehydrated.relationship_refs![0].label).toContain('Portal App Point');
    expect(rehydrated.relationship_refs![0].label).toContain('Backend App Point');
    expect(rehydrated.relationship_refs![0].label).not.toBe('Loading...');
  });

  it('returns Unknown Entity when entity not found after data loaded', () => {
    // Arrange: Context with an entity ID that doesn't exist
    const contextState: ContextState = {
      version: 1,
      entity_refs: [
        { kind: 'ENTITY', entity_type: 'applications', entity_id: 'nonexistent-id', label: 'Loading...' },
      ],
      diagram_refs: [],
      relationship_refs: [],
    };

    // Act
    const rehydrated = rehydrateContextLabels(
      contextState,
      mockMetaModelEntities,
      mockDiagrams,
      mockMetaModelRelationships
    );

    // Assert: Should show Unknown Entity, not the ID
    expect(rehydrated.entity_refs[0].label).toBe('Unknown Entity');
  });

  it('returns Unknown Diagram when diagram not found after data loaded', () => {
    // Arrange: Context with a diagram ID that doesn't exist
    const contextState: ContextState = {
      version: 1,
      entity_refs: [],
      diagram_refs: [
        { kind: 'DIAGRAM', diagram_id: 'nonexistent-diag', label: 'Loading...' },
      ],
      relationship_refs: [],
    };

    // Act
    const rehydrated = rehydrateContextLabels(
      contextState,
      mockMetaModelEntities,
      mockDiagrams,
      mockMetaModelRelationships
    );

    // Assert: Should show Unknown Diagram, not the ID
    expect(rehydrated.diagram_refs[0].label).toBe('Unknown Diagram');
  });
});

// ============================================================================
// Helper Function: hasLabelsChanged (used for infinite loop prevention)
// ============================================================================

describe('hasLabelsChanged helper function', () => {
  // This tests the comparison logic that will be used in ProductImplementPage
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

  it('returns true when labels have changed', () => {
    const oldState: ContextState = {
      version: 1,
      entity_refs: [{ kind: 'ENTITY', entity_type: 'applications', entity_id: 'app-1', label: 'app-1' }],
      diagram_refs: [],
      relationship_refs: [],
    };

    const newState: ContextState = {
      version: 1,
      entity_refs: [{ kind: 'ENTITY', entity_type: 'applications', entity_id: 'app-1', label: 'My Application' }],
      diagram_refs: [],
      relationship_refs: [],
    };

    expect(hasLabelsChanged(oldState, newState)).toBe(true);
  });

  it('returns false when labels are unchanged', () => {
    const oldState: ContextState = {
      version: 1,
      entity_refs: [{ kind: 'ENTITY', entity_type: 'applications', entity_id: 'app-1', label: 'My Application' }],
      diagram_refs: [],
      relationship_refs: [],
    };

    const newState: ContextState = {
      version: 1,
      entity_refs: [{ kind: 'ENTITY', entity_type: 'applications', entity_id: 'app-1', label: 'My Application' }],
      diagram_refs: [],
      relationship_refs: [],
    };

    expect(hasLabelsChanged(oldState, newState)).toBe(false);
  });
});
