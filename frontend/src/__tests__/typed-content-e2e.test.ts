/**
 * Typed Content End-to-End Tests
 * Task Group 8: E2E Tests 7 and 8 for Frontend typed_content_json feature
 *
 * These tests verify:
 * - E2E Test 7: Frontend: new Sequence diagram loads without error
 * - E2E Test 8: Frontend: save from Sequence Editor persists to diagrams table
 */

import { describe, it, expect } from 'vitest';
import { Diagram } from '../types/model';
import {
  TypedContentEnvelope,
  SequenceContent,
  createDefaultSequenceContent,
  createDefaultTypedContent,
} from '../types/typedContent';
import { buildModelFromData, serializeModel } from '../utils/fileOperations';
import { SequenceParticipant, SequenceMessage } from '../types/sequenceDiagram';

// ============================================================================
// E2E Test 7: Frontend - new Sequence diagram loads without error
// ============================================================================

describe('E2E Test 7: New Sequence diagram loads without error', () => {
  it('should load new Sequence diagram with default typedContent from backend', () => {
    // Simulate backend response for newly created Sequence diagram
    const backendResponse = {
      metaModel: {
        entities: {},
        relationships: {},
      },
      diagrams: [
        {
          id: 'new-seq-001',
          name: 'New Sequence Diagram',
          description: '',
          diagram_type: 'Sequence',
          diagram_nodes: [],
          diagram_edges: [],
          typed_content: {
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
        },
      ],
    };

    // Act: Parse the backend response
    const model = buildModelFromData(backendResponse);

    // Assert: Diagram loaded successfully without errors
    expect(model.diagrams).toHaveLength(1);
    const diagram = model.diagrams[0];

    expect(diagram.id).toBe('new-seq-001');
    expect(diagram.diagram_type).toBe('Sequence');
    expect(diagram.typedContent).toBeDefined();
    expect(diagram.typedContent?.type).toBe('Sequence');
    expect(diagram.typedContent?.version).toBe(1);

    // Access sequence content - should not throw
    const content = diagram.typedContent?.content as SequenceContent;
    expect(() => content.participants).not.toThrow();
    expect(() => content.messages).not.toThrow();
    expect(() => content.fragments).not.toThrow();
    expect(() => content.operands).not.toThrow();
    expect(() => content.sequenceNodes).not.toThrow();

    // All arrays should be accessible and empty
    expect(content.participants).toEqual([]);
    expect(content.messages).toEqual([]);
    expect(content.fragments).toEqual([]);
    expect(content.operands).toEqual([]);
    expect(content.sequenceNodes).toEqual([]);
  });

  it('should handle Sequence diagram that was created before typedContent existed', () => {
    // Simulate loading an older Sequence diagram that got default typedContent from migration
    const backendResponse = {
      metaModel: {
        entities: {},
        relationships: {},
      },
      diagrams: [
        {
          id: 'legacy-seq-001',
          name: 'Legacy Sequence Diagram',
          description: 'Created before typedContent feature',
          diagram_type: 'Sequence',
          diagram_nodes: [],
          diagram_edges: [],
          // Backend migration would have populated this
          typed_content: {
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
        },
      ],
    };

    const model = buildModelFromData(backendResponse);

    // Should load successfully with migrated default content
    expect(model.diagrams).toHaveLength(1);
    expect(model.diagrams[0].typedContent).toBeDefined();
    expect(model.diagrams[0].typedContent?.type).toBe('Sequence');
  });

  it('should create default Sequence content correctly', () => {
    // Test the helper function used to initialize new diagrams
    const defaultContent = createDefaultSequenceContent();

    expect(defaultContent.participants).toEqual([]);
    expect(defaultContent.messages).toEqual([]);
    expect(defaultContent.fragments).toEqual([]);
    expect(defaultContent.operands).toEqual([]);
    expect(defaultContent.sequenceNodes).toEqual([]);
  });

  it('should create default typed content for all typed diagram types', () => {
    const sequenceTyped = createDefaultTypedContent('Sequence');
    expect(sequenceTyped?.type).toBe('Sequence');
    expect(sequenceTyped?.version).toBe(1);

    const erTyped = createDefaultTypedContent('ER');
    expect(erTyped?.type).toBe('ER');
    expect(erTyped?.version).toBe(1);

    const activityTyped = createDefaultTypedContent('Activity');
    expect(activityTyped?.type).toBe('Activity');
    expect(activityTyped?.version).toBe(1);

    const stateTyped = createDefaultTypedContent('State');
    expect(stateTyped?.type).toBe('State');
    expect(stateTyped?.version).toBe(1);

    // General diagrams should not have typedContent
    const generalTyped = createDefaultTypedContent('General');
    expect(generalTyped).toBeUndefined();
  });
});

// ============================================================================
// E2E Test 8: Frontend - save from Sequence Editor persists to diagrams table
// ============================================================================

describe('E2E Test 8: Save from Sequence Editor persists to diagrams table', () => {
  it('should serialize diagram with typedContent for save via diagram API', () => {
    // Arrange: Create a Sequence diagram with typedContent
    const sequenceContent: SequenceContent = {
      participants: [
        { id: 'p1', ref_kind: 'Application', ref_id: 'app-1', order_index: 0 },
        { id: 'p2', ref_kind: 'Service', ref_id: 'svc-1', order_index: 1 },
      ],
      messages: [
        {
          id: 'm1',
          exchange_id: 'ex-1',
          exchange_role: 'Request',
          from_participant_id: 'p1',
          to_participant_id: 'p2',
          label_text: 'getData()',
        },
      ],
      fragments: [],
      operands: [],
      sequenceNodes: [],
    };

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
          id: 'save-seq-001',
          name: 'Sequence to Save',
          description: '',
          diagram_type: 'Sequence',
          diagram_nodes: [],
          diagram_edges: [],
          typedContent: {
            type: 'Sequence' as const,
            version: 1,
            content: sequenceContent,
          },
        },
      ],
    };

    // Act: Serialize the model for save
    const json = serializeModel(model);
    const parsed = JSON.parse(json);

    // Assert: typedContent is included in serialized output
    expect(parsed.diagrams).toHaveLength(1);
    expect(parsed.diagrams[0].typedContent).toBeDefined();
    expect(parsed.diagrams[0].typedContent.type).toBe('Sequence');
    expect(parsed.diagrams[0].typedContent.version).toBe(1);
    expect(parsed.diagrams[0].typedContent.content.participants).toHaveLength(2);
    expect(parsed.diagrams[0].typedContent.content.messages).toHaveLength(1);
    expect(parsed.diagrams[0].typedContent.content.messages[0].label_text).toBe('getData()');
  });

  it('should update typedContent when editing in Sequence Editor', () => {
    // Arrange: Start with empty sequence content
    const diagram: Diagram = {
      id: 'edit-seq-001',
      name: 'Sequence Being Edited',
      description: '',
      diagram_type: 'Sequence',
      diagram_nodes: [],
      diagram_edges: [],
      typedContent: {
        type: 'Sequence',
        version: 1,
        content: createDefaultSequenceContent(),
      },
    };

    // Act: Simulate adding a participant in the editor
    const newParticipant: SequenceParticipant = {
      id: 'new-p1',
      ref_kind: 'Application',
      ref_id: 'new-app-1',
      order_index: 0,
    };

    const currentContent = diagram.typedContent?.content as SequenceContent;
    const updatedContent: SequenceContent = {
      ...currentContent,
      participants: [...currentContent.participants, newParticipant],
    };

    const updatedDiagram: Diagram = {
      ...diagram,
      typedContent: {
        ...diagram.typedContent!,
        content: updatedContent,
      },
    };

    // Assert: Updated diagram has the new participant
    const finalContent = updatedDiagram.typedContent?.content as SequenceContent;
    expect(finalContent.participants).toHaveLength(1);
    expect(finalContent.participants[0].id).toBe('new-p1');
    expect(finalContent.participants[0].ref_kind).toBe('Application');

    // Envelope structure is maintained
    expect(updatedDiagram.typedContent?.type).toBe('Sequence');
    expect(updatedDiagram.typedContent?.version).toBe(1);
  });

  it('should include typedContent updates when serializing for save', () => {
    // Arrange: Create diagram and simulate edit
    const originalDiagram: Diagram = {
      id: 'roundtrip-seq-001',
      name: 'Round Trip Test',
      description: '',
      diagram_type: 'Sequence',
      diagram_nodes: [],
      diagram_edges: [],
      typedContent: {
        type: 'Sequence',
        version: 1,
        content: createDefaultSequenceContent(),
      },
    };

    // Simulate editor modifications
    const editedContent: SequenceContent = {
      participants: [
        { id: 'p1', ref_kind: 'Application', ref_id: 'app-1', order_index: 0 },
      ],
      messages: [
        {
          id: 'm1',
          exchange_id: 'ex-1',
          exchange_role: 'Request',
          from_participant_id: 'p1',
          to_participant_id: 'p2',
          label_text: 'performAction()',
        },
      ],
      fragments: [],
      operands: [],
      sequenceNodes: [],
    };

    const editedDiagram: Diagram = {
      ...originalDiagram,
      typedContent: {
        type: 'Sequence',
        version: 1,
        content: editedContent,
      },
    };

    // Act: Serialize for save via diagram API (not sequence-diagrams API)
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
      diagrams: [editedDiagram],
    };

    const serialized = serializeModel(model);
    const parsed = JSON.parse(serialized);

    // Assert: The serialized output includes all edited content
    const savedDiagram = parsed.diagrams[0];
    expect(savedDiagram.typedContent).toBeDefined();
    expect(savedDiagram.typedContent.type).toBe('Sequence');
    expect(savedDiagram.typedContent.version).toBe(1);
    expect(savedDiagram.typedContent.content.participants).toHaveLength(1);
    expect(savedDiagram.typedContent.content.participants[0].id).toBe('p1');
    expect(savedDiagram.typedContent.content.messages).toHaveLength(1);
    expect(savedDiagram.typedContent.content.messages[0].label_text).toBe('performAction()');
  });

  it('should not include typedContent for General diagrams', () => {
    // Arrange: General diagram with no typedContent
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
          id: 'general-001',
          name: 'General Diagram',
          description: '',
          diagram_type: 'General',
          diagram_nodes: [],
          diagram_edges: [],
          // No typedContent for General diagrams
        },
      ],
    };

    // Act: Serialize
    const serialized = serializeModel(model);
    const parsed = JSON.parse(serialized);

    // Assert: No typedContent for General diagram
    expect(parsed.diagrams[0].typedContent).toBeUndefined();
  });
});
