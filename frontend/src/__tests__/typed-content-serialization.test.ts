/**
 * Typed Content Serialization Tests
 *
 * Regression tests for API boundary key mapping between:
 * - Backend snake_case: `typed_content`
 * - Frontend camelCase: `typedContent`
 *
 * These tests verify:
 * - normalizeModelFromApi maps snake_case to camelCase
 * - prepareModelForApiSave maps camelCase to snake_case
 * - Round-trip preserves data integrity
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeModelFromApi,
  prepareModelForApiSave,
} from '../api/modelSerialization';

/**
 * Sample typed content for testing
 */
const sampleSequenceContent = {
  type: 'Sequence' as const,
  version: 1,
  content: {
    participants: [
      { id: 'p1', ref_kind: 'Application', ref_id: 'app1', order_index: 0 },
    ],
    messages: [
      {
        id: 'm1',
        exchange_id: 'ex1',
        exchange_role: 'REQUEST',
        from_participant_id: 'p1',
        to_participant_id: 'p2',
        label_text: 'Test Message',
      },
    ],
    fragments: [],
    operands: [],
    sequenceNodes: [],
  },
};

/**
 * Create a raw model with snake_case typed_content (simulating backend response)
 */
function createRawModelWithSnakeCaseTypedContent() {
  return {
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
        ui_screens: [],
      },
      relationships: {
        business_user_business_points: [],
        application_point_business_points: [],
        logical_data_entity_relationships: [],
        logical_data_entity_physical_data_entities: [],
        logical_data_attribute_physical_data_attributes: [],
        data_movements: [],
        interface_logical_entities: [],
        ui_workflow_transitions: [],
      },
    },
    diagrams: [
      {
        id: 'diagram-1',
        name: 'Test Sequence Diagram',
        description: 'A test diagram',
        diagram_type: 'Sequence',
        diagram_nodes: [],
        diagram_edges: [],
        // Backend uses snake_case: typed_content
        typed_content: sampleSequenceContent,
      },
      {
        id: 'diagram-2',
        name: 'General Diagram',
        description: 'No typed content',
        diagram_type: 'General',
        diagram_nodes: [],
        diagram_edges: [],
        // General diagrams have no typed_content
      },
    ],
  };
}

/**
 * Create an app model with camelCase typedContent (simulating in-memory state)
 */
function createAppModelWithCamelCaseTypedContent() {
  return {
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
        ui_screens: [],
      },
      relationships: {
        business_user_business_points: [],
        application_point_business_points: [],
        logical_data_entity_relationships: [],
        logical_data_entity_physical_data_entities: [],
        logical_data_attribute_physical_data_attributes: [],
        data_movements: [],
        interface_logical_entities: [],
        ui_workflow_transitions: [],
      },
    },
    diagrams: [
      {
        id: 'diagram-1',
        name: 'Test Sequence Diagram',
        description: 'A test diagram',
        diagram_type: 'Sequence',
        diagram_nodes: [],
        diagram_edges: [],
        // Frontend uses camelCase: typedContent
        typedContent: sampleSequenceContent,
      },
      {
        id: 'diagram-2',
        name: 'General Diagram',
        description: 'No typed content',
        diagram_type: 'General',
        diagram_nodes: [],
        diagram_edges: [],
        // General diagrams have no typedContent
      },
    ],
  };
}

describe('modelSerialization', () => {
  describe('normalizeModelFromApi', () => {
    it('maps typed_content (snake_case) to typedContent (camelCase)', () => {
      // Arrange
      const rawModel = createRawModelWithSnakeCaseTypedContent();

      // Act
      const normalized = normalizeModelFromApi(rawModel);

      // Assert - typedContent should be present with correct content
      expect(normalized.diagrams[0].typedContent).toBeDefined();
      expect(normalized.diagrams[0].typedContent?.type).toBe('Sequence');
      expect(normalized.diagrams[0].typedContent?.version).toBe(1);
      expect(normalized.diagrams[0].typedContent?.content).toEqual(
        sampleSequenceContent.content
      );
    });

    it('removes typed_content key after copying to typedContent', () => {
      // Arrange
      const rawModel = createRawModelWithSnakeCaseTypedContent();

      // Act
      const normalized = normalizeModelFromApi(rawModel);

      // Assert - snake_case key should be removed
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((normalized.diagrams[0] as any).typed_content).toBeUndefined();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((normalized.diagrams[1] as any).typed_content).toBeUndefined();
    });

    it('does not mutate the input object', () => {
      // Arrange
      const rawModel = createRawModelWithSnakeCaseTypedContent();
      const originalTypedContent = JSON.stringify(
        (rawModel.diagrams[0] as { typed_content?: unknown }).typed_content
      );

      // Act
      normalizeModelFromApi(rawModel);

      // Assert - original should be unchanged
      expect(
        JSON.stringify(
          (rawModel.diagrams[0] as { typed_content?: unknown }).typed_content
        )
      ).toBe(originalTypedContent);
    });

    it('handles models with empty diagrams array', () => {
      // Arrange
      const rawModel = {
        metaModel: {
          entities: {},
          relationships: {},
        },
        diagrams: [],
      };

      // Act
      const normalized = normalizeModelFromApi(rawModel);

      // Assert
      expect(normalized.diagrams).toEqual([]);
    });

    it('handles models with undefined diagrams', () => {
      // Arrange
      const rawModel = {
        metaModel: {
          entities: {},
          relationships: {},
        },
      };

      // Act
      const normalized = normalizeModelFromApi(rawModel);

      // Assert - should handle gracefully
      expect(normalized).toBeDefined();
    });

    it('preserves existing typedContent if typed_content is not present', () => {
      // Arrange - model already has camelCase typedContent
      const rawModel = createAppModelWithCamelCaseTypedContent();

      // Act
      const normalized = normalizeModelFromApi(rawModel);

      // Assert - typedContent should still be present
      expect(normalized.diagrams[0].typedContent).toBeDefined();
      expect(normalized.diagrams[0].typedContent?.type).toBe('Sequence');
    });
  });

  describe('prepareModelForApiSave', () => {
    it('maps typedContent (camelCase) to typed_content (snake_case)', () => {
      // Arrange
      const appModel = createAppModelWithCamelCaseTypedContent();

      // Act
      const payload = prepareModelForApiSave(appModel);

      // Assert - typed_content should be present with correct content
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const payloadDiagram = (payload as any).diagrams[0];
      expect(payloadDiagram.typed_content).toBeDefined();
      expect(payloadDiagram.typed_content.type).toBe('Sequence');
      expect(payloadDiagram.typed_content.version).toBe(1);
      expect(payloadDiagram.typed_content.content).toEqual(
        sampleSequenceContent.content
      );
    });

    it('removes typedContent key after copying to typed_content', () => {
      // Arrange
      const appModel = createAppModelWithCamelCaseTypedContent();

      // Act
      const payload = prepareModelForApiSave(appModel);

      // Assert - camelCase key should be removed
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((payload as any).diagrams[0].typedContent).toBeUndefined();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((payload as any).diagrams[1].typedContent).toBeUndefined();
    });

    it('does not mutate the input model', () => {
      // Arrange
      const appModel = createAppModelWithCamelCaseTypedContent();
      const originalTypedContent = JSON.stringify(
        appModel.diagrams[0].typedContent
      );

      // Act
      prepareModelForApiSave(appModel);

      // Assert - original should be unchanged
      expect(JSON.stringify(appModel.diagrams[0].typedContent)).toBe(
        originalTypedContent
      );
    });

    it('handles diagrams without typedContent', () => {
      // Arrange
      const appModel = createAppModelWithCamelCaseTypedContent();

      // Act
      const payload = prepareModelForApiSave(appModel);

      // Assert - General diagram should have no typed_content
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((payload as any).diagrams[1].typed_content).toBeUndefined();
    });

    it('handles models with empty diagrams array', () => {
      // Arrange
      const appModel = {
        metaModel: {
          entities: {},
          relationships: {},
        },
        diagrams: [],
      };

      // Act
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const payload = prepareModelForApiSave(appModel as any);

      // Assert
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((payload as any).diagrams).toEqual([]);
    });
  });

  describe('Round-trip sanity', () => {
    it('preserves typed content through load -> save cycle', () => {
      // Arrange - start with raw API response (snake_case)
      const rawModel = createRawModelWithSnakeCaseTypedContent();

      // Act - normalize (load) then prepare for save
      const normalized = normalizeModelFromApi(rawModel);
      const payload = prepareModelForApiSave(normalized);

      // Assert - payload should have snake_case keys with preserved content
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const payloadDiagram = (payload as any).diagrams[0];
      expect(payloadDiagram.typed_content).toBeDefined();
      expect(payloadDiagram.typed_content.type).toBe('Sequence');
      expect(payloadDiagram.typed_content.version).toBe(1);

      // Verify content is fully preserved
      expect(payloadDiagram.typed_content.content.participants).toHaveLength(1);
      expect(payloadDiagram.typed_content.content.messages).toHaveLength(1);
      expect(payloadDiagram.typed_content.content.messages[0].label_text).toBe(
        'Test Message'
      );

      // Verify camelCase key is removed
      expect(payloadDiagram.typedContent).toBeUndefined();
    });

    it('handles General diagrams (no typed content) through round-trip', () => {
      // Arrange
      const rawModel = createRawModelWithSnakeCaseTypedContent();

      // Act
      const normalized = normalizeModelFromApi(rawModel);
      const payload = prepareModelForApiSave(normalized);

      // Assert - General diagram should have neither key
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const generalDiagram = (payload as any).diagrams[1];
      expect(generalDiagram.typed_content).toBeUndefined();
      expect(generalDiagram.typedContent).toBeUndefined();
    });
  });
});
