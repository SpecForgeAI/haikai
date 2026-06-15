/**
 * Endpoint Configuration Layer Tests
 * Task Group 2: Tests for configuration layer additions for Endpoint entity
 */

import {
  endpointTypeOptions,
  endpointDirectionOptions,
  endpointLifecycleStatusOptions,
  entityColors,
  emptyModel,
} from '../config/defaults';
import { gridConfigs, tabToEntityType, entityTabNames, domainGroupings } from '../config/gridConfigs';
import { ENTITY_TYPES } from '../types/model';

describe('Endpoint Configuration Layer', () => {
  describe('defaults.ts - Option Arrays', () => {
    it('should have endpointTypeOptions array with all values', () => {
      expect(endpointTypeOptions).toBeDefined();
      expect(Array.isArray(endpointTypeOptions)).toBe(true);
      expect(endpointTypeOptions).toContainEqual({ value: 'HTTP_REST', label: 'HTTP REST' });
      expect(endpointTypeOptions).toContainEqual({ value: 'MESSAGE_QUEUE', label: 'Message Queue' });
      expect(endpointTypeOptions).toContainEqual({ value: 'MESSAGE_TOPIC', label: 'Message Topic' });
      expect(endpointTypeOptions).toContainEqual({ value: 'FILE_TRANSFER', label: 'File Transfer' });
      expect(endpointTypeOptions).toContainEqual({ value: 'OTHER', label: 'Other' });
    });

    it('should have endpointDirectionOptions array with all values', () => {
      expect(endpointDirectionOptions).toBeDefined();
      expect(Array.isArray(endpointDirectionOptions)).toBe(true);
      expect(endpointDirectionOptions).toContainEqual({ value: 'INBOUND', label: 'Inbound' });
      expect(endpointDirectionOptions).toContainEqual({ value: 'OUTBOUND', label: 'Outbound' });
      expect(endpointDirectionOptions).toContainEqual({ value: 'BIDIRECTIONAL', label: 'Bidirectional' });
    });

    it('should have endpointLifecycleStatusOptions array with all values', () => {
      expect(endpointLifecycleStatusOptions).toBeDefined();
      expect(Array.isArray(endpointLifecycleStatusOptions)).toBe(true);
      expect(endpointLifecycleStatusOptions).toContainEqual({ value: 'ACTIVE', label: 'Active' });
      expect(endpointLifecycleStatusOptions).toContainEqual({ value: 'DEPRECATED', label: 'Deprecated' });
      expect(endpointLifecycleStatusOptions).toContainEqual({ value: 'PLANNED', label: 'Planned' });
      expect(endpointLifecycleStatusOptions).toContainEqual({ value: 'RETIRED', label: 'Retired' });
    });
  });

  describe('defaults.ts - Entity Colors', () => {
    it('should have ENDPOINT color defined with background and border', () => {
      expect(entityColors[ENTITY_TYPES.ENDPOINT]).toBeDefined();
      expect(typeof entityColors[ENTITY_TYPES.ENDPOINT]).toBe('object');
      expect(entityColors[ENTITY_TYPES.ENDPOINT].background).toBeDefined();
      expect(entityColors[ENTITY_TYPES.ENDPOINT].border).toBeDefined();
      expect(entityColors[ENTITY_TYPES.ENDPOINT].background).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(entityColors[ENTITY_TYPES.ENDPOINT].border).toMatch(/^#[0-9A-Fa-f]{6}$/);
    });
  });

  describe('defaults.ts - Empty Model', () => {
    it('should have endpoints array in emptyModel', () => {
      expect(emptyModel.metaModel.entities.endpoints).toBeDefined();
      expect(Array.isArray(emptyModel.metaModel.entities.endpoints)).toBe(true);
      expect(emptyModel.metaModel.entities.endpoints.length).toBe(0);
    });
  });

  describe('gridConfigs.ts - Grid Configuration', () => {
    it('should have endpoints grid configuration', () => {
      expect(gridConfigs.endpoints).toBeDefined();
      expect(Array.isArray(gridConfigs.endpoints)).toBe(true);
      expect(gridConfigs.endpoints.length).toBeGreaterThan(0);
    });

    it('should have required columns in endpoints grid config', () => {
      const columns = gridConfigs.endpoints;
      const columnFields = columns.map((c: { field: string }) => c.field);

      expect(columnFields).toContain('id');
      expect(columnFields).toContain('name');
      expect(columnFields).toContain('interface_id');
      expect(columnFields).toContain('endpoint_type');
      expect(columnFields).toContain('path_or_address');
    });

    it('should have Endpoints in tabToEntityType mapping', () => {
      expect(tabToEntityType['Endpoints']).toBe('endpoints');
    });

    it('should have Endpoints in entityTabNames array after Interfaces', () => {
      expect(entityTabNames).toContain('Endpoints');
      const interfacesIndex = entityTabNames.indexOf('Interfaces');
      const endpointsIndex = entityTabNames.indexOf('Endpoints');
      expect(endpointsIndex).toBe(interfacesIndex + 1);
    });

    it('should have Endpoints in domainGroupings application section', () => {
      expect(domainGroupings.application).toContain('Endpoints');
    });
  });
});
