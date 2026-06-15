/**
 * Tests for Participant Styling type definitions
 * Spec: Sequence Diagram Participant Colour and Icons for Services and Components
 * Task Group 3: TypeScript Type Updates
 *
 * Tests that Application, ApplicationComponent, and Service interfaces
 * accept the new optional fields: is_internal and tech_type
 */

import { describe, it, expect } from 'vitest';
import type {
  Application,
  ApplicationComponent,
  Service,
  TechType,
} from '../types/model';
import { TECH_TYPE_OPTIONS } from '../types/model';

describe('Participant Styling Type Definitions', () => {
  describe('Application interface', () => {
    it('should accept is_internal optional field', () => {
      // Application without is_internal (backward compatible)
      const appWithoutIsInternal: Application = {
        id: 'app-001',
        name: 'Test Application',
        description: 'A test application',
        app_type: 'Web',
        status: 'Active',
        tags: 'test',
      };
      expect(appWithoutIsInternal.id).toBe('app-001');
      expect(appWithoutIsInternal.is_internal).toBeUndefined();

      // Application with is_internal = true (internal)
      const appInternal: Application = {
        id: 'app-002',
        name: 'Internal Application',
        description: 'An internal application',
        app_type: 'Service',
        status: 'Active',
        tags: 'internal',
        is_internal: true,
      };
      expect(appInternal.is_internal).toBe(true);

      // Application with is_internal = false (external)
      const appExternal: Application = {
        id: 'app-003',
        name: 'External Application',
        description: 'An external application',
        app_type: 'ThirdParty',
        status: 'Active',
        tags: 'external',
        is_internal: false,
      };
      expect(appExternal.is_internal).toBe(false);
    });
  });

  describe('ApplicationComponent interface', () => {
    it('should accept is_internal and tech_type optional fields', () => {
      // ApplicationComponent without new fields (backward compatible)
      const compWithoutNewFields: ApplicationComponent = {
        id: 'comp-001',
        name: 'Test Component',
        description: 'A test component',
        application_id: 'app-001',
        tags: 'test',
      };
      expect(compWithoutNewFields.id).toBe('comp-001');
      expect(compWithoutNewFields.is_internal).toBeUndefined();
      expect(compWithoutNewFields.tech_type).toBeUndefined();

      // ApplicationComponent with is_internal and tech_type set
      const compWithFields: ApplicationComponent = {
        id: 'comp-002',
        name: 'UI Component',
        description: 'A UI tier component',
        application_id: 'app-001',
        tags: 'ui',
        is_internal: true,
        tech_type: 'UI Tier',
      };
      expect(compWithFields.is_internal).toBe(true);
      expect(compWithFields.tech_type).toBe('UI Tier');

      // ApplicationComponent marked as external
      const compExternal: ApplicationComponent = {
        id: 'comp-003',
        name: 'External Component',
        description: 'An external component',
        application_id: 'app-002',
        tags: 'external',
        is_internal: false,
        tech_type: 'Other',
      };
      expect(compExternal.is_internal).toBe(false);
      expect(compExternal.tech_type).toBe('Other');

      // Test all tech_type values
      const techTypes: TechType[] = ['UI Tier', 'Service Tier', 'Persistence Tier', 'Other'];
      techTypes.forEach(techType => {
        const comp: ApplicationComponent = {
          id: `comp-${techType.replace(' ', '-').toLowerCase()}`,
          name: `${techType} Component`,
          description: `A ${techType} component`,
          application_id: 'app-001',
          tags: techType.toLowerCase(),
          tech_type: techType,
        };
        expect(comp.tech_type).toBe(techType);
      });
    });
  });

  describe('Service interface', () => {
    it('should accept is_internal optional field', () => {
      // Service without is_internal (backward compatible)
      const serviceWithoutIsInternal: Service = {
        id: 'svc-001',
        name: 'Test Service',
        description: 'A test service',
        application_id: 'app-001',
        service_type: 'REST',
        tags: 'test',
      };
      expect(serviceWithoutIsInternal.id).toBe('svc-001');
      expect(serviceWithoutIsInternal.is_internal).toBeUndefined();

      // Service with is_internal = true (internal)
      const serviceInternal: Service = {
        id: 'svc-002',
        name: 'Internal Service',
        description: 'An internal service',
        application_id: 'app-001',
        app_component_id: 'comp-001',
        service_type: 'REST',
        tags: 'internal',
        is_internal: true,
      };
      expect(serviceInternal.is_internal).toBe(true);

      // Service with is_internal = false (external)
      const serviceExternal: Service = {
        id: 'svc-003',
        name: 'External Service',
        description: 'An external service',
        application_id: 'app-002',
        service_type: 'SOAP',
        tags: 'external',
        is_internal: false,
      };
      expect(serviceExternal.is_internal).toBe(false);
    });
  });

  describe('TechType type and TECH_TYPE_OPTIONS constant', () => {
    it('should export TECH_TYPE_OPTIONS with all 4 valid values', () => {
      expect(TECH_TYPE_OPTIONS).toContain('UI Tier');
      expect(TECH_TYPE_OPTIONS).toContain('Service Tier');
      expect(TECH_TYPE_OPTIONS).toContain('Persistence Tier');
      expect(TECH_TYPE_OPTIONS).toContain('Other');
      expect(TECH_TYPE_OPTIONS.length).toBe(4);
    });

    it('should have TECH_TYPE_OPTIONS in correct order as per spec', () => {
      // Spec order: UI Tier, Service Tier, Persistence Tier, Other
      expect(TECH_TYPE_OPTIONS[0]).toBe('UI Tier');
      expect(TECH_TYPE_OPTIONS[1]).toBe('Service Tier');
      expect(TECH_TYPE_OPTIONS[2]).toBe('Persistence Tier');
      expect(TECH_TYPE_OPTIONS[3]).toBe('Other');
    });
  });
});
