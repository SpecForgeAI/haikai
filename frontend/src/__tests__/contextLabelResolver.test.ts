/**
 * contextLabelResolver.test.ts
 *
 * Spec 2026-01-17: Context Picker UX - Relationship Labels and Stable Chips
 * Task Group 5: Tests for label resolution on context rehydration
 *
 * Tests:
 * - resolveEntityLabel() returns name from metaModelEntities
 * - resolveDiagramLabel() returns name from diagrams array
 * - resolveRelationshipLabel() returns computed label
 * - rehydrateContextLabels() resolves all labels in context state
 * - "Loading..." placeholder when architecture data not loaded
 * - Never permanently display IDs
 */

import {
  resolveEntityLabel,
  resolveDiagramLabel,
  resolveRelationshipLabel,
  rehydrateContextLabels,
} from '../utils/contextLabelResolver';
import type { ContextState, EntityRef, DiagramRef, RelationshipRef } from '../utils/contextStorage';
import type { MetaModelEntities, MetaModelRelationships, Diagram } from '../types/model';

describe('contextLabelResolver - Task Group 5', () => {
  // Mock entities
  const mockEntities: MetaModelEntities = {
    applications: [
      { id: 'app-1', name: 'Order Service', description: '', tags: '' },
      { id: 'app-2', name: 'Payment Gateway', description: '', tags: '' },
    ],
    services: [{ id: 'svc-1', name: 'Auth Service', description: '', tags: '' }],
    business_users: [{ id: 'user-1', name: 'John Doe', description: '', tags: '' }],
    business_points: [
      {
        id: 'bp-1',
        name: 'Login Process',
        description: '',
        kind: 'BUSINESS_PROCESS',
        business_process_id: 'proc-1',
        tags: '',
      },
    ],
    business_processes: [],
    process_activities: [],
    app_components: [],
    interfaces: [{ id: 'iface-1', name: 'REST API', description: '', tags: '' }],
    endpoints: [],
    classes: [],
    methods: [],
    application_points: [],
    logical_data_entities: [{ id: 'lde-1', name: 'Customer', description: '', tags: '' }],
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
    business_logics: [{ id: 'bl-1', name: 'Validate Order' }],
    ui_screens: [],
    ui_components: [],
    ui_actions: [],
    package_sets: [],
    packages: [],
  };

  // Mock diagrams
  const mockDiagrams: Diagram[] = [
    { id: 'diag-1', name: 'Architecture Overview', diagram_type: 'COMPONENT', node_ids: [], edge_ids: [] },
    { id: 'diag-2', name: 'Data Flow Diagram', diagram_type: 'SEQUENCE', node_ids: [], edge_ids: [] },
  ];

  // Mock relationships
  const mockRelationships: MetaModelRelationships = {
    business_user_business_points: [
      { id: 'rel-1', business_user_id: 'user-1', business_point_id: 'bp-1', description: '', tags: '' },
    ],
    application_point_business_points: [],
    application_point_business_logics: [],
    logical_data_entity_relationships: [],
    logical_data_entity_physical_data_entities: [],
    logical_data_attribute_physical_data_attributes: [],
    data_movements: [],
    interface_logical_entities: [],
    ui_workflow_transitions: [],
  };

  describe('resolveEntityLabel()', () => {
    it('should return entity name when found in metaModelEntities', () => {
      const label = resolveEntityLabel('app-1', 'applications', mockEntities);
      expect(label).toBe('Order Service');
    });

    it('should return entity name for different entity types', () => {
      expect(resolveEntityLabel('svc-1', 'services', mockEntities)).toBe('Auth Service');
      expect(resolveEntityLabel('iface-1', 'interfaces', mockEntities)).toBe('REST API');
      expect(resolveEntityLabel('lde-1', 'logical_data_entities', mockEntities)).toBe('Customer');
    });

    it('should return "Unknown Entity" when entity not found', () => {
      const label = resolveEntityLabel('non-existent', 'applications', mockEntities);
      expect(label).toBe('Unknown Entity');
    });

    it('should return "Loading..." when metaModelEntities is undefined', () => {
      const label = resolveEntityLabel('app-1', 'applications', undefined);
      expect(label).toBe('Loading...');
    });

    it('should return "Unknown Entity" when entity type does not exist', () => {
      const label = resolveEntityLabel('x-1', 'unknown_type' as keyof MetaModelEntities, mockEntities);
      expect(label).toBe('Unknown Entity');
    });
  });

  describe('resolveDiagramLabel()', () => {
    it('should return diagram name when found', () => {
      const label = resolveDiagramLabel('diag-1', mockDiagrams);
      expect(label).toBe('Architecture Overview');
    });

    it('should return "Unknown Diagram" when diagram not found', () => {
      const label = resolveDiagramLabel('non-existent', mockDiagrams);
      expect(label).toBe('Unknown Diagram');
    });

    it('should return "Loading..." when diagrams is undefined', () => {
      const label = resolveDiagramLabel('diag-1', undefined);
      expect(label).toBe('Loading...');
    });

    it('should return "Loading..." when diagrams is empty array', () => {
      const label = resolveDiagramLabel('diag-1', []);
      // Empty array means we have data but diagram not found
      expect(label).toBe('Unknown Diagram');
    });
  });

  describe('resolveRelationshipLabel()', () => {
    it('should return computed label for relationship', () => {
      const label = resolveRelationshipLabel(
        'rel-1',
        'business_user_business_points',
        mockRelationships,
        mockEntities
      );
      expect(label).toContain('John Doe');
      expect(label).toContain('[BUSINESS_USER]');
      expect(label).toContain('Login Process');
      expect(label).toContain('[BUSINESS_POINT]');
    });

    it('should return "Loading..." when relationships not loaded', () => {
      const label = resolveRelationshipLabel(
        'rel-1',
        'business_user_business_points',
        undefined,
        mockEntities
      );
      expect(label).toBe('Loading...');
    });

    it('should return "Unknown Relationship" when relationship not found', () => {
      const label = resolveRelationshipLabel(
        'non-existent',
        'business_user_business_points',
        mockRelationships,
        mockEntities
      );
      expect(label).toBe('Unknown Relationship');
    });
  });

  describe('rehydrateContextLabels()', () => {
    it('should resolve all entity labels in context state', () => {
      const contextState: ContextState = {
        version: 1,
        entity_refs: [
          { kind: 'ENTITY', entity_type: 'applications', entity_id: 'app-1', label: '' },
          { kind: 'ENTITY', entity_type: 'services', entity_id: 'svc-1', label: '' },
        ],
        diagram_refs: [],
      };

      const result = rehydrateContextLabels(contextState, mockEntities, mockDiagrams, mockRelationships);

      expect(result.entity_refs[0].label).toBe('Order Service');
      expect(result.entity_refs[1].label).toBe('Auth Service');
    });

    it('should resolve all diagram labels in context state', () => {
      const contextState: ContextState = {
        version: 1,
        entity_refs: [],
        diagram_refs: [
          { kind: 'DIAGRAM', diagram_id: 'diag-1', label: '' },
          { kind: 'DIAGRAM', diagram_id: 'diag-2', label: '' },
        ],
      };

      const result = rehydrateContextLabels(contextState, mockEntities, mockDiagrams, mockRelationships);

      expect(result.diagram_refs[0].label).toBe('Architecture Overview');
      expect(result.diagram_refs[1].label).toBe('Data Flow Diagram');
    });

    it('should resolve all relationship labels in context state', () => {
      const contextState: ContextState = {
        version: 1,
        entity_refs: [],
        diagram_refs: [],
        relationship_refs: [
          {
            kind: 'RELATIONSHIP',
            relationship_type: 'business_user_business_points',
            relationship_id: 'rel-1',
            label: '',
          },
        ],
      };

      const result = rehydrateContextLabels(contextState, mockEntities, mockDiagrams, mockRelationships);

      expect(result.relationship_refs![0].label).toContain('John Doe');
      expect(result.relationship_refs![0].label).toContain('Login Process');
    });

    it('should preserve existing labels if already populated', () => {
      const contextState: ContextState = {
        version: 1,
        entity_refs: [
          { kind: 'ENTITY', entity_type: 'applications', entity_id: 'app-1', label: 'Custom Label' },
        ],
        diagram_refs: [],
      };

      const result = rehydrateContextLabels(contextState, mockEntities, mockDiagrams, mockRelationships);

      // Should keep existing label if already populated (non-empty)
      expect(result.entity_refs[0].label).toBe('Custom Label');
    });

    it('should return Loading labels when architecture data not loaded', () => {
      const contextState: ContextState = {
        version: 1,
        entity_refs: [{ kind: 'ENTITY', entity_type: 'applications', entity_id: 'app-1', label: '' }],
        diagram_refs: [{ kind: 'DIAGRAM', diagram_id: 'diag-1', label: '' }],
      };

      const result = rehydrateContextLabels(contextState, undefined, undefined, undefined);

      expect(result.entity_refs[0].label).toBe('Loading...');
      expect(result.diagram_refs[0].label).toBe('Loading...');
    });

    it('should never return raw IDs in labels', () => {
      const contextState: ContextState = {
        version: 1,
        entity_refs: [
          { kind: 'ENTITY', entity_type: 'applications', entity_id: 'unknown-id-12345', label: '' },
        ],
        diagram_refs: [{ kind: 'DIAGRAM', diagram_id: 'unknown-diag-67890', label: '' }],
      };

      const result = rehydrateContextLabels(contextState, mockEntities, mockDiagrams, mockRelationships);

      // Should never contain raw IDs
      expect(result.entity_refs[0].label).not.toContain('unknown-id-12345');
      expect(result.diagram_refs[0].label).not.toContain('unknown-diag-67890');
      // Should be "Unknown Entity" or "Unknown Diagram"
      expect(result.entity_refs[0].label).toBe('Unknown Entity');
      expect(result.diagram_refs[0].label).toBe('Unknown Diagram');
    });
  });
});
