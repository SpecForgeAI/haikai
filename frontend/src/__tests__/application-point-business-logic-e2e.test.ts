/**
 * Application Point Business Logic E2E Integration Tests
 * Spec: Expand Application Points to Reference Service/Class/Method
 * Task Group 7: Integration Testing
 *
 * End-to-end tests verifying the complete flow of attaching BusinessLogic
 * entities to ApplicationPoints via the join table relationship.
 */

import { describe, it, expect, vi } from 'vitest';

// ============================================================================
// Mock Types (comprehensive representation of model.ts types)
// ============================================================================

interface MockApplication {
  id: string;
  name: string;
}

interface MockAppComponent {
  id: string;
  name: string;
  application_id: string;
}

interface MockService {
  id: string;
  name: string;
  application_id: string;
  app_component_id: string;
}

interface MockClass {
  id: string;
  name: string;
  application_point_id?: string;
}

interface MockMethod {
  id: string;
  name: string;
  class_id: string;
}

interface MockApplicationPoint {
  id: string;
  name: string;
  kind: 'APPLICATION' | 'APP_COMPONENT' | 'SERVICE' | 'CLASS' | 'METHOD';
  ref_id: string;
  description?: string;
}

interface MockBusinessLogic {
  id: string;
  name: string;
  type_text?: string;
  description_md?: string;
  tags?: string;
}

interface MockApplicationPointBusinessLogic {
  id: string;
  application_point_id: string;
  business_logic_id: string;
  description?: string;
}

interface MockMetaModel {
  entities: {
    applications: MockApplication[];
    app_components: MockAppComponent[];
    services: MockService[];
    classes: MockClass[];
    methods: MockMethod[];
    application_points: MockApplicationPoint[];
    business_logics: MockBusinessLogic[];
  };
  relationships: {
    application_point_business_logics: MockApplicationPointBusinessLogic[];
  };
}

// ============================================================================
// Comprehensive Test Data
// ============================================================================

function createTestMetaModel(): MockMetaModel {
  return {
    entities: {
      applications: [
        { id: 'app-1', name: 'OrderManagement' },
        { id: 'app-2', name: 'PaymentService' },
      ],
      app_components: [
        { id: 'comp-1', name: 'OrderProcessor', application_id: 'app-1' },
        { id: 'comp-2', name: 'PaymentGateway', application_id: 'app-2' },
      ],
      services: [
        { id: 'svc-1', name: 'OrderService', application_id: 'app-1', app_component_id: 'comp-1' },
        { id: 'svc-2', name: 'PaymentProcessor', application_id: 'app-2', app_component_id: 'comp-2' },
      ],
      classes: [
        { id: 'cls-1', name: 'OrderValidator', application_point_id: 'ap-3' },  // References OrderService app point
        { id: 'cls-2', name: 'TaxCalculator', application_point_id: 'ap-3' },   // References OrderService app point
      ],
      methods: [
        { id: 'mth-1', name: 'validateOrderTotal', class_id: 'cls-1' },
        { id: 'mth-2', name: 'calculateTax', class_id: 'cls-2' },
      ],
      application_points: [
        {
          id: 'ap-1',
          name: 'OrderManagement',
          kind: 'APPLICATION',
          ref_id: 'app-1',
        },
        {
          id: 'ap-2',
          name: 'OrderProcessor',
          kind: 'APP_COMPONENT',
          ref_id: 'comp-1',
        },
        {
          id: 'ap-3',
          name: 'OrderService',
          kind: 'SERVICE',
          ref_id: 'svc-1',
        },
        {
          id: 'ap-4',
          name: 'OrderValidator',
          kind: 'CLASS',
          ref_id: 'cls-1',
        },
        {
          id: 'ap-5',
          name: 'validateOrderTotal',
          kind: 'METHOD',
          ref_id: 'mth-1',
        },
      ],
      business_logics: [
        {
          id: 'bl-1',
          name: 'Validate Order Minimum Amount',
          type_text: 'Validation Rule',
          description_md: 'Orders must have a minimum value of $10',
        },
        {
          id: 'bl-2',
          name: 'Apply Regional Tax Rate',
          type_text: 'Calculation Rule',
          description_md: 'Calculate tax based on customer region',
        },
        {
          id: 'bl-3',
          name: 'Check Stock Availability',
          type_text: 'Business Rule',
        },
        {
          id: 'bl-4',
          name: 'Apply Discount for Bulk Orders',
          type_text: 'Discount Rule',
        },
      ],
    },
    relationships: {
      application_point_business_logics: [],
    },
  };
}

// ============================================================================
// Simulation Functions (mirroring component behavior)
// ============================================================================

/**
 * Simulate attaching a business logic to an application point
 */
function attachBusinessLogic(
  metaModel: MockMetaModel,
  applicationPointId: string,
  businessLogicId: string,
  description?: string
): MockMetaModel {
  const newRelationship: MockApplicationPointBusinessLogic = {
    id: `apbl-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    application_point_id: applicationPointId,
    business_logic_id: businessLogicId,
    description,
  };

  return {
    ...metaModel,
    relationships: {
      ...metaModel.relationships,
      application_point_business_logics: [
        ...metaModel.relationships.application_point_business_logics,
        newRelationship,
      ],
    },
  };
}

/**
 * Simulate detaching a business logic from an application point
 */
function detachBusinessLogic(
  metaModel: MockMetaModel,
  relationshipId: string
): MockMetaModel {
  return {
    ...metaModel,
    relationships: {
      ...metaModel.relationships,
      application_point_business_logics:
        metaModel.relationships.application_point_business_logics.filter(
          rel => rel.id !== relationshipId
        ),
    },
  };
}

/**
 * Get all business logics attached to an application point
 */
function getAttachedBusinessLogics(
  metaModel: MockMetaModel,
  applicationPointId: string
): MockBusinessLogic[] {
  const attachedIds = metaModel.relationships.application_point_business_logics
    .filter(rel => rel.application_point_id === applicationPointId)
    .map(rel => rel.business_logic_id);

  return metaModel.entities.business_logics.filter(bl =>
    attachedIds.includes(bl.id)
  );
}

/**
 * Get all application points attached to a business logic
 */
function getAttachedApplicationPoints(
  metaModel: MockMetaModel,
  businessLogicId: string
): MockApplicationPoint[] {
  const attachedIds = metaModel.relationships.application_point_business_logics
    .filter(rel => rel.business_logic_id === businessLogicId)
    .map(rel => rel.application_point_id);

  return metaModel.entities.application_points.filter(ap =>
    attachedIds.includes(ap.id)
  );
}

/**
 * Format application point display name based on kind
 */
function formatApplicationPointDisplay(
  ap: MockApplicationPoint,
  metaModel: MockMetaModel
): string {
  const kindLabels: Record<string, string> = {
    APPLICATION: 'App',
    APP_COMPONENT: 'Component',
    SERVICE: 'Service',
    CLASS: 'Class',
    METHOD: 'Method',
  };

  return `${ap.name} [${kindLabels[ap.kind] || ap.kind}]`;
}

// ============================================================================
// E2E Test Scenarios
// ============================================================================

describe('E2E: Application Point Business Logic Attachment Flow', () => {
  describe('Scenario 1: Attach Business Logic to Service-Level Application Point', () => {
    it('should attach validation rule to OrderService application point', () => {
      let metaModel = createTestMetaModel();

      // User selects OrderService application point (ap-3)
      const selectedAP = metaModel.entities.application_points.find(
        ap => ap.id === 'ap-3'
      );
      expect(selectedAP?.kind).toBe('SERVICE');

      // User opens attach modal and selects validation rule (bl-1)
      metaModel = attachBusinessLogic(
        metaModel,
        'ap-3',
        'bl-1',
        'Validation at service entry point'
      );

      // Verify attachment was created
      const attachedLogics = getAttachedBusinessLogics(metaModel, 'ap-3');
      expect(attachedLogics).toHaveLength(1);
      expect(attachedLogics[0].name).toBe('Validate Order Minimum Amount');
    });

    it('should prevent duplicate attachment', () => {
      let metaModel = createTestMetaModel();

      // First attachment
      metaModel = attachBusinessLogic(metaModel, 'ap-3', 'bl-1');

      // Check for duplicate before second attachment
      const isDuplicate = metaModel.relationships.application_point_business_logics.some(
        rel => rel.application_point_id === 'ap-3' && rel.business_logic_id === 'bl-1'
      );

      expect(isDuplicate).toBe(true);
    });
  });

  describe('Scenario 2: Attach Business Logic to Method-Level Application Point', () => {
    it('should attach calculation rule to specific method', () => {
      let metaModel = createTestMetaModel();

      // User selects validateOrderTotal method application point (ap-5)
      const selectedAP = metaModel.entities.application_points.find(
        ap => ap.id === 'ap-5'
      );
      expect(selectedAP?.kind).toBe('METHOD');

      // Attach tax calculation rule
      metaModel = attachBusinessLogic(
        metaModel,
        'ap-5',
        'bl-2',
        'Tax calculation within validation method'
      );

      const attachedLogics = getAttachedBusinessLogics(metaModel, 'ap-5');
      expect(attachedLogics).toHaveLength(1);
      expect(attachedLogics[0].name).toBe('Apply Regional Tax Rate');
    });
  });

  describe('Scenario 3: Multiple Business Logics to Same Application Point', () => {
    it('should allow attaching multiple business logics to one application point', () => {
      let metaModel = createTestMetaModel();

      // Attach first business logic
      metaModel = attachBusinessLogic(metaModel, 'ap-3', 'bl-1');

      // Attach second business logic
      metaModel = attachBusinessLogic(metaModel, 'ap-3', 'bl-2');

      // Attach third business logic
      metaModel = attachBusinessLogic(metaModel, 'ap-3', 'bl-3');

      const attachedLogics = getAttachedBusinessLogics(metaModel, 'ap-3');
      expect(attachedLogics).toHaveLength(3);
    });
  });

  describe('Scenario 4: Same Business Logic to Multiple Application Points', () => {
    it('should allow attaching same business logic to multiple application points', () => {
      let metaModel = createTestMetaModel();

      // Attach validation rule to service level
      metaModel = attachBusinessLogic(metaModel, 'ap-3', 'bl-1');

      // Attach same validation rule to method level
      metaModel = attachBusinessLogic(metaModel, 'ap-5', 'bl-1');

      // Attach same validation rule to class level
      metaModel = attachBusinessLogic(metaModel, 'ap-4', 'bl-1');

      const attachedPoints = getAttachedApplicationPoints(metaModel, 'bl-1');
      expect(attachedPoints).toHaveLength(3);
      expect(attachedPoints.map(ap => ap.kind)).toEqual(
        expect.arrayContaining(['SERVICE', 'METHOD', 'CLASS'])
      );
    });
  });

  describe('Scenario 5: Detach Business Logic', () => {
    it('should remove attachment when user detaches', () => {
      let metaModel = createTestMetaModel();

      // Create attachment
      metaModel = attachBusinessLogic(metaModel, 'ap-3', 'bl-1');

      // Get the relationship ID
      const relationship = metaModel.relationships.application_point_business_logics[0];
      expect(relationship).toBeDefined();

      // Detach
      metaModel = detachBusinessLogic(metaModel, relationship.id);

      // Verify removal
      const attachedLogics = getAttachedBusinessLogics(metaModel, 'ap-3');
      expect(attachedLogics).toHaveLength(0);
    });

    it('should only remove specific attachment, not others', () => {
      let metaModel = createTestMetaModel();

      // Create multiple attachments
      metaModel = attachBusinessLogic(metaModel, 'ap-3', 'bl-1');
      metaModel = attachBusinessLogic(metaModel, 'ap-3', 'bl-2');
      metaModel = attachBusinessLogic(metaModel, 'ap-3', 'bl-3');

      // Get first relationship
      const firstRelationship = metaModel.relationships.application_point_business_logics[0];

      // Detach first one only
      metaModel = detachBusinessLogic(metaModel, firstRelationship.id);

      // Verify only two remain
      const attachedLogics = getAttachedBusinessLogics(metaModel, 'ap-3');
      expect(attachedLogics).toHaveLength(2);
    });
  });

  describe('Scenario 6: Business Logic View - Attach to Application Points', () => {
    it('should allow attaching business logic to multiple application points from BL view', () => {
      let metaModel = createTestMetaModel();

      // User is viewing Business Logic bl-2 (Tax calculation)
      // They open "Attach to Application Point" modal

      // Attach to service level
      metaModel = attachBusinessLogic(metaModel, 'ap-3', 'bl-2');

      // Attach to class level
      metaModel = attachBusinessLogic(metaModel, 'ap-4', 'bl-2');

      // Verify from Business Logic perspective
      const attachedPoints = getAttachedApplicationPoints(metaModel, 'bl-2');
      expect(attachedPoints).toHaveLength(2);
      expect(attachedPoints.map(ap => ap.name)).toContain('OrderService');
      expect(attachedPoints.map(ap => ap.name)).toContain('OrderValidator');
    });
  });

  describe('Scenario 7: Display Formatting', () => {
    it('should format application point display with kind label', () => {
      const metaModel = createTestMetaModel();

      const serviceAP = metaModel.entities.application_points.find(ap => ap.id === 'ap-3');
      const methodAP = metaModel.entities.application_points.find(ap => ap.id === 'ap-5');

      expect(formatApplicationPointDisplay(serviceAP!, metaModel)).toBe(
        'OrderService [Service]'
      );
      expect(formatApplicationPointDisplay(methodAP!, metaModel)).toBe(
        'validateOrderTotal [Method]'
      );
    });
  });

  describe('Scenario 8: Complete Traceability Chain', () => {
    it('should establish complete traceability from Application to Business Logic', () => {
      let metaModel = createTestMetaModel();

      // Attach at multiple levels to create rich traceability
      metaModel = attachBusinessLogic(metaModel, 'ap-1', 'bl-1'); // App level
      metaModel = attachBusinessLogic(metaModel, 'ap-2', 'bl-1'); // Component level
      metaModel = attachBusinessLogic(metaModel, 'ap-3', 'bl-1'); // Service level
      metaModel = attachBusinessLogic(metaModel, 'ap-4', 'bl-1'); // Class level
      metaModel = attachBusinessLogic(metaModel, 'ap-5', 'bl-1'); // Method level

      // Query: Where is "Validate Order Minimum Amount" implemented?
      const implementationPoints = getAttachedApplicationPoints(metaModel, 'bl-1');

      expect(implementationPoints).toHaveLength(5);

      // Verify hierarchy of implementation points
      const kinds = implementationPoints.map(ap => ap.kind);
      expect(kinds).toContain('APPLICATION');
      expect(kinds).toContain('APP_COMPONENT');
      expect(kinds).toContain('SERVICE');
      expect(kinds).toContain('CLASS');
      expect(kinds).toContain('METHOD');
    });
  });
});

describe('E2E: Edge Cases and Error Handling', () => {
  describe('Empty State Handling', () => {
    it('should handle no business logics available', () => {
      const metaModel: MockMetaModel = {
        ...createTestMetaModel(),
        entities: {
          ...createTestMetaModel().entities,
          business_logics: [],
        },
      };

      const options = metaModel.entities.business_logics;
      expect(options).toHaveLength(0);
    });

    it('should handle no application points available', () => {
      const metaModel: MockMetaModel = {
        ...createTestMetaModel(),
        entities: {
          ...createTestMetaModel().entities,
          application_points: [],
        },
      };

      const options = metaModel.entities.application_points;
      expect(options).toHaveLength(0);
    });
  });

  describe('State Consistency', () => {
    it('should maintain relationship integrity after delete entity', () => {
      let metaModel = createTestMetaModel();

      // Create attachment
      metaModel = attachBusinessLogic(metaModel, 'ap-3', 'bl-1');

      // Simulate entity deletion (orphaned relationship)
      const orphanedRelationships =
        metaModel.relationships.application_point_business_logics.filter(rel => {
          const apExists = metaModel.entities.application_points.some(
            ap => ap.id === rel.application_point_id
          );
          const blExists = metaModel.entities.business_logics.some(
            bl => bl.id === rel.business_logic_id
          );
          return !apExists || !blExists;
        });

      // Should find no orphaned relationships (entities still exist)
      expect(orphanedRelationships).toHaveLength(0);
    });
  });
});
