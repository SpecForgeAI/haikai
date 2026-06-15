/**
 * Diagram typedContent Tests
 * Task Group 6: Tests for Diagram interface typedContent field and fileOperations handling
 *
 * These tests verify:
 * 1. Diagram interface includes optional typedContent field
 * 2. fileOperations parse correctly reads typedContent from JSON
 * 3. fileOperations serialize correctly includes typedContent in JSON
 */

import { Diagram } from '../types/model';
import {
  TypedContentEnvelope,
  SequenceContent,
  ERContent,
  ActivityContent,
  StateContent,
  DiagramTypedContentType,
} from '../types/typedContent';
import { parseJSON, buildModelFromData, serializeModel } from '../utils/fileOperations';

describe('Diagram typedContent Field', () => {
  describe('Test 1: Diagram interface includes optional typedContent field', () => {
    it('should allow creating a Diagram without typedContent (General diagram)', () => {
      const generalDiagram: Diagram = {
        id: 'diag-001',
        name: 'General Diagram',
        description: 'A general purpose diagram',
        diagram_type: 'General',
        diagram_nodes: [],
        diagram_edges: [],
      };

      expect(generalDiagram.id).toBe('diag-001');
      expect(generalDiagram.typedContent).toBeUndefined();
    });

    it('should allow creating a Diagram with typedContent (Sequence diagram)', () => {
      const sequenceDiagram: Diagram = {
        id: 'diag-002',
        name: 'Sequence Diagram',
        description: 'A sequence diagram',
        diagram_type: 'Sequence',
        diagram_nodes: [],
        diagram_edges: [],
        typedContent: {
          type: 'Sequence',
          version: 1,
          content: {
            participants: [],
            messages: [],
            fragments: [],
            operands: [],
            sequenceNodes: [],
          },
        },
      };

      expect(sequenceDiagram.id).toBe('diag-002');
      expect(sequenceDiagram.typedContent).toBeDefined();
      expect(sequenceDiagram.typedContent?.type).toBe('Sequence');
      expect(sequenceDiagram.typedContent?.version).toBe(1);
    });

    it('should allow creating a Diagram with typedContent (ER diagram)', () => {
      const erDiagram: Diagram = {
        id: 'diag-003',
        name: 'ER Diagram',
        description: 'An ER diagram',
        diagram_type: 'ER',
        diagram_nodes: [],
        diagram_edges: [],
        typedContent: {
          type: 'ER',
          version: 1,
          content: {
            entityRefs: [],
            relationshipRefs: [],
          },
        },
      };

      expect(erDiagram.typedContent?.type).toBe('ER');
    });

    it('should allow creating a Diagram with typedContent (Activity diagram)', () => {
      const activityDiagram: Diagram = {
        id: 'diag-004',
        name: 'Activity Diagram',
        description: 'An activity diagram',
        diagram_type: 'Activity',
        diagram_nodes: [],
        diagram_edges: [],
        typedContent: {
          type: 'Activity',
          version: 1,
          content: {
            partitions: [],
            flows: [],
          },
        },
      };

      expect(activityDiagram.typedContent?.type).toBe('Activity');
    });

    it('should allow creating a Diagram with typedContent (State diagram)', () => {
      const stateDiagram: Diagram = {
        id: 'diag-005',
        name: 'State Diagram',
        description: 'A state diagram',
        diagram_type: 'State',
        diagram_nodes: [],
        diagram_edges: [],
        typedContent: {
          type: 'State',
          version: 1,
          content: {
            states: [],
            transitions: [],
          },
        },
      };

      expect(stateDiagram.typedContent?.type).toBe('State');
    });
  });

  describe('Test 2: fileOperations parse correctly reads typedContent from JSON', () => {
    it('should parse a model with typedContent in diagrams', () => {
      const jsonData = {
        metaModel: {
          entities: {},
          relationships: {},
        },
        diagrams: [
          {
            id: 'diag-seq-001',
            name: 'Test Sequence',
            description: 'Test',
            diagram_type: 'Sequence',
            diagram_nodes: [],
            diagram_edges: [],
            typed_content: {
              type: 'Sequence',
              version: 1,
              content: {
                participants: [{ id: 'p1', ref_kind: 'Service', ref_id: 'svc-1', order_index: 0 }],
                messages: [],
                fragments: [],
                operands: [],
                sequenceNodes: [],
              },
            },
          },
        ],
      };

      const model = buildModelFromData(jsonData);

      expect(model.diagrams).toHaveLength(1);
      expect(model.diagrams[0].typedContent).toBeDefined();
      expect(model.diagrams[0].typedContent?.type).toBe('Sequence');
      expect(model.diagrams[0].typedContent?.version).toBe(1);
      const content = model.diagrams[0].typedContent?.content as SequenceContent;
      expect(content.participants).toHaveLength(1);
      expect(content.participants[0].id).toBe('p1');
    });

    it('should parse a model without typedContent (General diagram)', () => {
      const jsonData = {
        metaModel: {
          entities: {},
          relationships: {},
        },
        diagrams: [
          {
            id: 'diag-gen-001',
            name: 'General Diagram',
            description: 'Test',
            diagram_type: 'General',
            diagram_nodes: [],
            diagram_edges: [],
          },
        ],
      };

      const model = buildModelFromData(jsonData);

      expect(model.diagrams).toHaveLength(1);
      expect(model.diagrams[0].typedContent).toBeUndefined();
    });

    it('should handle JSON with null typed_content', () => {
      const jsonData = {
        metaModel: {
          entities: {},
          relationships: {},
        },
        diagrams: [
          {
            id: 'diag-null-001',
            name: 'Null TypedContent',
            description: 'Test',
            diagram_type: 'General',
            diagram_nodes: [],
            diagram_edges: [],
            typed_content: null,
          },
        ],
      };

      const model = buildModelFromData(jsonData);

      expect(model.diagrams).toHaveLength(1);
      expect(model.diagrams[0].typedContent).toBeUndefined();
    });
  });

  describe('Test 3: fileOperations serialize correctly includes typedContent in JSON', () => {
    it('should serialize a model with typedContent in diagrams', () => {
      const model = {
        metaModel: {
          entities: {
            business_users: [],
            business_processes: [],
            process_activities: [],
            business_points: [],
            applications: [],
            app_components: [],
            services: [],
            interfaces: [],
            endpoints: [],
            classes: [],
            methods: [],
            application_points: [],
            logical_data_entities: [],
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
          },
          relationships: {
            business_user_business_points: [],
            application_point_business_points: [],
            logical_data_entity_relationships: [],
            logical_data_entity_physical_data_entities: [],
            logical_data_attribute_physical_data_attributes: [],
            data_movements: [],
            interface_logical_entities: [],
          },
        },
        diagrams: [
          {
            id: 'diag-seq-001',
            name: 'Test Sequence',
            description: 'Test',
            diagram_type: 'Sequence',
            diagram_nodes: [],
            diagram_edges: [],
            typedContent: {
              type: 'Sequence' as DiagramTypedContentType,
              version: 1,
              content: {
                participants: [{ id: 'p1', ref_kind: 'Service', ref_id: 'svc-1', order_index: 0 }],
                messages: [],
                fragments: [],
                operands: [],
                sequenceNodes: [],
              } as SequenceContent,
            },
          },
        ],
      };

      const json = serializeModel(model);
      const parsed = JSON.parse(json);

      expect(parsed.diagrams[0].typedContent).toBeDefined();
      expect(parsed.diagrams[0].typedContent.type).toBe('Sequence');
      expect(parsed.diagrams[0].typedContent.version).toBe(1);
      expect(parsed.diagrams[0].typedContent.content.participants).toHaveLength(1);
    });

    it('should serialize a General diagram without typedContent', () => {
      const model = {
        metaModel: {
          entities: {
            business_users: [],
            business_processes: [],
            process_activities: [],
            business_points: [],
            applications: [],
            app_components: [],
            services: [],
            interfaces: [],
            endpoints: [],
            classes: [],
            methods: [],
            application_points: [],
            logical_data_entities: [],
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
          },
          relationships: {
            business_user_business_points: [],
            application_point_business_points: [],
            logical_data_entity_relationships: [],
            logical_data_entity_physical_data_entities: [],
            logical_data_attribute_physical_data_attributes: [],
            data_movements: [],
            interface_logical_entities: [],
          },
        },
        diagrams: [
          {
            id: 'diag-gen-001',
            name: 'General Diagram',
            description: 'Test',
            diagram_type: 'General',
            diagram_nodes: [],
            diagram_edges: [],
          },
        ],
      };

      const json = serializeModel(model);
      const parsed = JSON.parse(json);

      expect(parsed.diagrams[0].typedContent).toBeUndefined();
    });

    it('should preserve typedContent during round-trip parse-serialize', () => {
      const originalJson = {
        metaModel: {
          entities: {},
          relationships: {},
        },
        diagrams: [
          {
            id: 'diag-er-001',
            name: 'ER Diagram',
            description: 'Test',
            diagram_type: 'ER',
            diagram_nodes: [],
            diagram_edges: [],
            typed_content: {
              type: 'ER',
              version: 1,
              content: {
                entityRefs: [{ id: 'er1', entity_id: 'ent-1' }],
                relationshipRefs: [],
              },
            },
          },
        ],
      };

      // Parse
      const model = buildModelFromData(originalJson);

      // Serialize (need to provide full model structure)
      const fullModel = {
        metaModel: {
          entities: {
            business_users: [],
            business_processes: [],
            process_activities: [],
            business_points: [],
            applications: [],
            app_components: [],
            services: [],
            interfaces: [],
            endpoints: [],
            classes: [],
            methods: [],
            application_points: [],
            logical_data_entities: [],
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
          },
          relationships: {
            business_user_business_points: [],
            application_point_business_points: [],
            logical_data_entity_relationships: [],
            logical_data_entity_physical_data_entities: [],
            logical_data_attribute_physical_data_attributes: [],
            data_movements: [],
            interface_logical_entities: [],
          },
        },
        diagrams: model.diagrams,
      };

      const serialized = serializeModel(fullModel);
      const reparsed = JSON.parse(serialized);

      expect(reparsed.diagrams[0].typedContent).toBeDefined();
      expect(reparsed.diagrams[0].typedContent.type).toBe('ER');
      expect(reparsed.diagrams[0].typedContent.version).toBe(1);
      expect(reparsed.diagrams[0].typedContent.content.entityRefs).toHaveLength(1);
    });
  });
});

describe('TypedContent Type Definitions', () => {
  describe('TypedContentEnvelope', () => {
    it('should accept valid Sequence envelope', () => {
      const envelope: TypedContentEnvelope = {
        type: 'Sequence',
        version: 1,
        content: {
          participants: [],
          messages: [],
          fragments: [],
          operands: [],
          sequenceNodes: [],
        },
      };

      expect(envelope.type).toBe('Sequence');
      expect(envelope.version).toBe(1);
    });

    it('should accept valid ER envelope', () => {
      const envelope: TypedContentEnvelope = {
        type: 'ER',
        version: 1,
        content: {
          entityRefs: [],
          relationshipRefs: [],
        },
      };

      expect(envelope.type).toBe('ER');
    });

    it('should accept valid Activity envelope', () => {
      const envelope: TypedContentEnvelope = {
        type: 'Activity',
        version: 1,
        content: {
          partitions: [],
          flows: [],
        },
      };

      expect(envelope.type).toBe('Activity');
    });

    it('should accept valid State envelope', () => {
      const envelope: TypedContentEnvelope = {
        type: 'State',
        version: 1,
        content: {
          states: [],
          transitions: [],
        },
      };

      expect(envelope.type).toBe('State');
    });
  });

  describe('SequenceContent', () => {
    it('should have all required array fields', () => {
      const content: SequenceContent = {
        participants: [],
        messages: [],
        fragments: [],
        operands: [],
        sequenceNodes: [],
      };

      expect(Array.isArray(content.participants)).toBe(true);
      expect(Array.isArray(content.messages)).toBe(true);
      expect(Array.isArray(content.fragments)).toBe(true);
      expect(Array.isArray(content.operands)).toBe(true);
      expect(Array.isArray(content.sequenceNodes)).toBe(true);
    });
  });

  describe('ERContent', () => {
    it('should have all required array fields', () => {
      const content: ERContent = {
        entityRefs: [],
        relationshipRefs: [],
      };

      expect(Array.isArray(content.entityRefs)).toBe(true);
      expect(Array.isArray(content.relationshipRefs)).toBe(true);
    });
  });

  describe('ActivityContent', () => {
    it('should have all required array fields', () => {
      const content: ActivityContent = {
        partitions: [],
        flows: [],
      };

      expect(Array.isArray(content.partitions)).toBe(true);
      expect(Array.isArray(content.flows)).toBe(true);
    });
  });

  describe('StateContent', () => {
    it('should have all required array fields', () => {
      const content: StateContent = {
        states: [],
        transitions: [],
      };

      expect(Array.isArray(content.states)).toBe(true);
      expect(Array.isArray(content.transitions)).toBe(true);
    });
  });
});
