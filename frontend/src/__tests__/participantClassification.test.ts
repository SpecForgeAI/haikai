/**
 * Tests for Participant Classification Functions
 * Spec: Sequence Diagram Participant Colour and Icons for Services and Components
 * Task Group 5: Sequence Diagram Classification Logic
 *
 * Tests the classification functions that determine participant styling:
 * - classifyServiceParticipant
 * - classifyAppComponentParticipant
 * - shouldStyleParticipant
 * - classifyByTechType
 * - classifyParticipant
 */

import { describe, it, expect } from 'vitest';
import type { MetaModel, Service, ApplicationComponent } from '../types/model';
import {
  classifyServiceParticipant,
  classifyAppComponentParticipant,
  shouldStyleParticipant,
  classifyByTechType,
  classifyParticipant,
  ParticipantClassification,
  PARTICIPANT_FILL_COLOURS,
  CLASSIFICATION_ICONS,
  STYLED_PARTICIPANT_KINDS,
  PARTICIPANT_ICON_SIZE,
  ICON_TEXT_GAP,
} from '../components/DiagramsView/SequenceDiagramRenderer';

/**
 * Helper to create a minimal MetaModel with specified services and app_components
 */
function createMockMetaModel(overrides: {
  services?: Partial<Service>[];
  app_components?: Partial<ApplicationComponent>[];
}): MetaModel {
  const defaultService: Service = {
    id: 'default-svc',
    name: 'Default Service',
    description: '',
    application_id: 'app-1',
    service_type: 'REST',
    tags: '',
  };

  const defaultComponent: ApplicationComponent = {
    id: 'default-comp',
    name: 'Default Component',
    description: '',
    application_id: 'app-1',
    tags: '',
  };

  return {
    entities: {
      business_users: [],
      business_processes: [],
      process_activities: [],
      business_points: [],
      applications: [
        { id: 'app-1', name: 'Test App', description: '', app_type: 'Web', status: 'Active', tags: '' },
      ],
      app_components: (overrides.app_components || []).map(c => ({
        ...defaultComponent,
        ...c,
      })) as ApplicationComponent[],
      services: (overrides.services || []).map(s => ({
        ...defaultService,
        ...s,
      })) as Service[],
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
      business_logics: [],
      ui_screens: [],
      ui_components: [],
      ui_actions: [],
      ui_characteristics: [],
      package_sets: [],
      packages: [],
    },
    relationships: {
      business_user_business_points: [],
      application_point_business_points: [],
      application_point_business_logics: [],
      logical_data_entity_relationships: [],
      logical_data_entity_physical_data_entities: [],
      logical_data_attribute_physical_data_attributes: [],
      data_movements: [],
      interface_logical_entities: [],
      ui_workflow_transitions: [],
    },
  };
}

describe('Participant Classification Functions', () => {
  // ============================================================================
  // Test 1: classifyServiceParticipant returns EXTERNAL when is_internal=false
  // ============================================================================
  describe('classifyServiceParticipant', () => {
    it('should return EXTERNAL when service.is_internal is false', () => {
      const metaModel = createMockMetaModel({
        services: [{ id: 'svc-1', name: 'External Service', is_internal: false }],
      });

      const result = classifyServiceParticipant('svc-1', metaModel);

      expect(result).toBe('EXTERNAL');
    });

    // ============================================================================
    // Test 2: classifyServiceParticipant returns INTERNAL_UI when app_component.tech_type is "UI Tier"
    // ============================================================================
    it('should return INTERNAL_UI when app_component.tech_type is "UI Tier"', () => {
      const metaModel = createMockMetaModel({
        services: [
          { id: 'svc-1', name: 'UI Service', is_internal: true, app_component_id: 'comp-1' },
        ],
        app_components: [
          { id: 'comp-1', name: 'UI Component', tech_type: 'UI Tier' },
        ],
      });

      const result = classifyServiceParticipant('svc-1', metaModel);

      expect(result).toBe('INTERNAL_UI');
    });

    // ============================================================================
    // Test 3: classifyServiceParticipant returns INTERNAL_SERVICE when tech_type is "Service Tier"
    // ============================================================================
    it('should return INTERNAL_SERVICE when app_component.tech_type is "Service Tier"', () => {
      const metaModel = createMockMetaModel({
        services: [
          { id: 'svc-1', name: 'Backend Service', is_internal: true, app_component_id: 'comp-1' },
        ],
        app_components: [
          { id: 'comp-1', name: 'Service Component', tech_type: 'Service Tier' },
        ],
      });

      const result = classifyServiceParticipant('svc-1', metaModel);

      expect(result).toBe('INTERNAL_SERVICE');
    });

    // ============================================================================
    // Test 4: classifyServiceParticipant returns INTERNAL_PERSISTENCE when tech_type is "Persistence Tier"
    // ============================================================================
    it('should return INTERNAL_PERSISTENCE when app_component.tech_type is "Persistence Tier"', () => {
      const metaModel = createMockMetaModel({
        services: [
          { id: 'svc-1', name: 'Data Service', is_internal: true, app_component_id: 'comp-1' },
        ],
        app_components: [
          { id: 'comp-1', name: 'Database Component', tech_type: 'Persistence Tier' },
        ],
      });

      const result = classifyServiceParticipant('svc-1', metaModel);

      expect(result).toBe('INTERNAL_PERSISTENCE');
    });

    // ============================================================================
    // Test 5: classifyServiceParticipant returns OTHER when is_internal is missing (defaults to true)
    // ============================================================================
    it('should return OTHER when is_internal is missing (defaults to true) and no tech_type', () => {
      const metaModel = createMockMetaModel({
        services: [
          { id: 'svc-1', name: 'Internal Service' }, // is_internal not set, no app_component_id
        ],
      });

      const result = classifyServiceParticipant('svc-1', metaModel);

      expect(result).toBe('OTHER');
    });

    it('should return OTHER when service is not found', () => {
      const metaModel = createMockMetaModel({
        services: [],
      });

      const result = classifyServiceParticipant('non-existent-svc', metaModel);

      expect(result).toBe('OTHER');
    });

    it('should return OTHER when app_component has tech_type "Other"', () => {
      const metaModel = createMockMetaModel({
        services: [
          { id: 'svc-1', name: 'Other Service', is_internal: true, app_component_id: 'comp-1' },
        ],
        app_components: [
          { id: 'comp-1', name: 'Other Component', tech_type: 'Other' },
        ],
      });

      const result = classifyServiceParticipant('svc-1', metaModel);

      expect(result).toBe('OTHER');
    });

    it('should return OTHER when app_component_id references non-existent component', () => {
      const metaModel = createMockMetaModel({
        services: [
          { id: 'svc-1', name: 'Orphan Service', is_internal: true, app_component_id: 'non-existent-comp' },
        ],
        app_components: [],
      });

      const result = classifyServiceParticipant('svc-1', metaModel);

      expect(result).toBe('OTHER');
    });
  });

  // ============================================================================
  // Test 6: classifyAppComponentParticipant returns EXTERNAL when is_internal=false
  // ============================================================================
  describe('classifyAppComponentParticipant', () => {
    it('should return EXTERNAL when component.is_internal is false', () => {
      const metaModel = createMockMetaModel({
        app_components: [
          { id: 'comp-1', name: 'External Component', is_internal: false },
        ],
      });

      const result = classifyAppComponentParticipant('comp-1', metaModel);

      expect(result).toBe('EXTERNAL');
    });

    it('should return INTERNAL_UI when component.tech_type is "UI Tier"', () => {
      const metaModel = createMockMetaModel({
        app_components: [
          { id: 'comp-1', name: 'UI Component', is_internal: true, tech_type: 'UI Tier' },
        ],
      });

      const result = classifyAppComponentParticipant('comp-1', metaModel);

      expect(result).toBe('INTERNAL_UI');
    });

    it('should return INTERNAL_SERVICE when component.tech_type is "Service Tier"', () => {
      const metaModel = createMockMetaModel({
        app_components: [
          { id: 'comp-1', name: 'Service Component', is_internal: true, tech_type: 'Service Tier' },
        ],
      });

      const result = classifyAppComponentParticipant('comp-1', metaModel);

      expect(result).toBe('INTERNAL_SERVICE');
    });

    it('should return INTERNAL_PERSISTENCE when component.tech_type is "Persistence Tier"', () => {
      const metaModel = createMockMetaModel({
        app_components: [
          { id: 'comp-1', name: 'Data Component', is_internal: true, tech_type: 'Persistence Tier' },
        ],
      });

      const result = classifyAppComponentParticipant('comp-1', metaModel);

      expect(result).toBe('INTERNAL_PERSISTENCE');
    });

    it('should return OTHER when is_internal is missing (defaults to true) and no tech_type', () => {
      const metaModel = createMockMetaModel({
        app_components: [
          { id: 'comp-1', name: 'Default Component' }, // is_internal and tech_type not set
        ],
      });

      const result = classifyAppComponentParticipant('comp-1', metaModel);

      expect(result).toBe('OTHER');
    });

    it('should return OTHER when component is not found', () => {
      const metaModel = createMockMetaModel({
        app_components: [],
      });

      const result = classifyAppComponentParticipant('non-existent-comp', metaModel);

      expect(result).toBe('OTHER');
    });
  });

  // ============================================================================
  // Test 7: shouldStyleParticipant returns true for Service and ApplicationComponent
  // ============================================================================
  describe('shouldStyleParticipant', () => {
    it('should return true for Service', () => {
      expect(shouldStyleParticipant('Service')).toBe(true);
    });

    it('should return true for ApplicationComponent', () => {
      expect(shouldStyleParticipant('ApplicationComponent')).toBe(true);
    });

    // ============================================================================
    // Test 8: shouldStyleParticipant returns false for Application, Interface, BusinessUser
    // ============================================================================
    it('should return false for Application', () => {
      expect(shouldStyleParticipant('Application')).toBe(false);
    });

    it('should return false for Interface', () => {
      expect(shouldStyleParticipant('Interface')).toBe(false);
    });

    it('should return false for BusinessUser', () => {
      expect(shouldStyleParticipant('BusinessUser')).toBe(false);
    });

    it('should return false for InterfaceEndpoint', () => {
      expect(shouldStyleParticipant('InterfaceEndpoint')).toBe(false);
    });

    it('should return false for Class', () => {
      expect(shouldStyleParticipant('Class')).toBe(false);
    });

    it('should return false for unknown ref_kind', () => {
      expect(shouldStyleParticipant('UnknownKind')).toBe(false);
    });
  });

  // ============================================================================
  // Additional tests for classifyByTechType
  // ============================================================================
  describe('classifyByTechType', () => {
    it('should return INTERNAL_UI for "UI Tier"', () => {
      expect(classifyByTechType('UI Tier')).toBe('INTERNAL_UI');
    });

    it('should return INTERNAL_SERVICE for "Service Tier"', () => {
      expect(classifyByTechType('Service Tier')).toBe('INTERNAL_SERVICE');
    });

    it('should return INTERNAL_PERSISTENCE for "Persistence Tier"', () => {
      expect(classifyByTechType('Persistence Tier')).toBe('INTERNAL_PERSISTENCE');
    });

    it('should return OTHER for "Other"', () => {
      expect(classifyByTechType('Other')).toBe('OTHER');
    });

    it('should return OTHER for undefined', () => {
      expect(classifyByTechType(undefined)).toBe('OTHER');
    });

    it('should return OTHER for unknown tech_type', () => {
      expect(classifyByTechType('Unknown Type')).toBe('OTHER');
    });
  });

  // ============================================================================
  // Additional tests for classifyParticipant dispatcher
  // ============================================================================
  describe('classifyParticipant', () => {
    it('should route to classifyServiceParticipant for Service ref_kind', () => {
      const metaModel = createMockMetaModel({
        services: [
          { id: 'svc-1', name: 'External Service', is_internal: false },
        ],
      });

      const result = classifyParticipant('Service', 'svc-1', metaModel);

      expect(result).toBe('EXTERNAL');
    });

    it('should route to classifyAppComponentParticipant for ApplicationComponent ref_kind', () => {
      const metaModel = createMockMetaModel({
        app_components: [
          { id: 'comp-1', name: 'UI Component', is_internal: true, tech_type: 'UI Tier' },
        ],
      });

      const result = classifyParticipant('ApplicationComponent', 'comp-1', metaModel);

      expect(result).toBe('INTERNAL_UI');
    });

    it('should return OTHER for non-styled participant kinds', () => {
      const metaModel = createMockMetaModel({});

      expect(classifyParticipant('Application', 'app-1', metaModel)).toBe('OTHER');
      expect(classifyParticipant('Interface', 'int-1', metaModel)).toBe('OTHER');
      expect(classifyParticipant('BusinessUser', 'user-1', metaModel)).toBe('OTHER');
      expect(classifyParticipant('Class', 'class-1', metaModel)).toBe('OTHER');
    });
  });

  // ============================================================================
  // Tests for exported constants
  // ============================================================================
  describe('Exported Constants', () => {
    it('should export PARTICIPANT_FILL_COLOURS with 5 colour values', () => {
      expect(PARTICIPANT_FILL_COLOURS.EXTERNAL).toBe('#E3F2FD');
      expect(PARTICIPANT_FILL_COLOURS.INTERNAL_UI).toBe('#E8F5E9');
      expect(PARTICIPANT_FILL_COLOURS.INTERNAL_SERVICE).toBe('#FFF9C4');
      expect(PARTICIPANT_FILL_COLOURS.INTERNAL_PERSISTENCE).toBe('#F3E5F5');
      expect(PARTICIPANT_FILL_COLOURS.OTHER).toBe('#FFFFFF');
    });

    it('should export CLASSIFICATION_ICONS with correct icon names', () => {
      expect(CLASSIFICATION_ICONS.EXTERNAL).toBe('external-link');
      expect(CLASSIFICATION_ICONS.INTERNAL_UI).toBe('monitor-smartphone');
      expect(CLASSIFICATION_ICONS.INTERNAL_SERVICE).toBe('file-code');
      expect(CLASSIFICATION_ICONS.INTERNAL_PERSISTENCE).toBe('database');
      expect(CLASSIFICATION_ICONS.OTHER).toBeNull();
    });

    it('should export STYLED_PARTICIPANT_KINDS with Service and ApplicationComponent', () => {
      expect(STYLED_PARTICIPANT_KINDS).toContain('Service');
      expect(STYLED_PARTICIPANT_KINDS).toContain('ApplicationComponent');
      expect(STYLED_PARTICIPANT_KINDS.length).toBe(2);
    });

    it('should export PARTICIPANT_ICON_SIZE as 16', () => {
      expect(PARTICIPANT_ICON_SIZE).toBe(16);
    });

    it('should export ICON_TEXT_GAP as 5', () => {
      expect(ICON_TEXT_GAP).toBe(5);
    });
  });
});
