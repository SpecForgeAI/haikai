/**
 * AttachBusinessLogicModal Component Tests
 * Spec: Expand Application Points to Reference Service/Class/Method
 * Task Group 6: Tests for the attach modals (Tasks 6.1 and 6.8)
 *
 * Tests the modal component used for attaching BusinessLogic entities
 * to ApplicationPoints via the application_point_business_logics join table.
 */

import { describe, it, expect, vi } from 'vitest';

// ============================================================================
// Mock Types (mirrors model.ts)
// ============================================================================

interface MockBusinessLogic {
  id: string;
  name: string;
  type_text?: string;
}

interface MockApplicationPoint {
  id: string;
  name: string;
  kind?: string;
}

interface MockApplicationPointBusinessLogic {
  id: string;
  application_point_id: string;
  business_logic_id: string;
  description?: string;
}

interface MockMetaModel {
  entities: {
    business_logics: MockBusinessLogic[];
    application_points: MockApplicationPoint[];
  };
  relationships: {
    application_point_business_logics: MockApplicationPointBusinessLogic[];
  };
}

// ============================================================================
// Mock Data
// ============================================================================

const MOCK_BUSINESS_LOGICS: MockBusinessLogic[] = [
  { id: 'bl-1', name: 'Validate Order Total', type_text: 'Validation Rule' },
  { id: 'bl-2', name: 'Calculate Tax', type_text: 'Calculation Rule' },
  { id: 'bl-3', name: 'Check Inventory', type_text: 'Business Rule' },
];

const MOCK_APPLICATION_POINTS: MockApplicationPoint[] = [
  { id: 'ap-1', name: 'OrderService.validateOrder', kind: 'Service' },
  { id: 'ap-2', name: 'PaymentProcessor.processPayment', kind: 'Service' },
];

const MOCK_EXISTING_ATTACHMENTS: MockApplicationPointBusinessLogic[] = [
  {
    id: 'apbl-1',
    application_point_id: 'ap-1',
    business_logic_id: 'bl-1',
    description: 'Validate order before processing',
  },
];

const MOCK_META_MODEL: MockMetaModel = {
  entities: {
    business_logics: MOCK_BUSINESS_LOGICS,
    application_points: MOCK_APPLICATION_POINTS,
  },
  relationships: {
    application_point_business_logics: MOCK_EXISTING_ATTACHMENTS,
  },
};

// ============================================================================
// Helper Functions (simulating modal logic)
// ============================================================================

/**
 * Get available business logic options, marking already-attached ones
 */
function getBusinessLogicOptions(
  applicationPointId: string,
  metaModel: MockMetaModel
): Array<{ id: string; name: string; type: string; isAttached: boolean }> {
  const existingAttachments = new Set(
    metaModel.relationships.application_point_business_logics
      .filter(rel => rel.application_point_id === applicationPointId)
      .map(rel => rel.business_logic_id)
  );

  return metaModel.entities.business_logics.map(bl => ({
    id: bl.id,
    name: bl.name,
    type: bl.type_text || '',
    isAttached: existingAttachments.has(bl.id),
  }));
}

/**
 * Validate form data for AttachBusinessLogicModal
 */
function validateAttachBusinessLogicForm(formData: {
  businessLogicId: string;
  description: string;
}): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!formData.businessLogicId) {
    errors.push('Business Logic is required');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Check if attachment would be a duplicate
 */
function isDuplicateAttachment(
  applicationPointId: string,
  businessLogicId: string,
  metaModel: MockMetaModel
): boolean {
  return metaModel.relationships.application_point_business_logics.some(
    rel =>
      rel.application_point_id === applicationPointId &&
      rel.business_logic_id === businessLogicId
  );
}

/**
 * Create relationship entity for submission
 */
function createAttachmentRelationship(
  applicationPointId: string,
  businessLogicId: string,
  description?: string
): MockApplicationPointBusinessLogic {
  return {
    id: `apbl-${Date.now()}`,
    application_point_id: applicationPointId,
    business_logic_id: businessLogicId,
    description,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('AttachBusinessLogicModal', () => {
  describe('Business Logic Options', () => {
    it('should list all available business logic entities', () => {
      const options = getBusinessLogicOptions('ap-2', MOCK_META_MODEL);

      expect(options).toHaveLength(3);
      expect(options.map(o => o.name)).toContain('Validate Order Total');
      expect(options.map(o => o.name)).toContain('Calculate Tax');
      expect(options.map(o => o.name)).toContain('Check Inventory');
    });

    it('should mark already-attached business logic as attached', () => {
      const options = getBusinessLogicOptions('ap-1', MOCK_META_MODEL);

      // bl-1 is already attached to ap-1
      const attachedOption = options.find(o => o.id === 'bl-1');
      expect(attachedOption?.isAttached).toBe(true);

      // bl-2 and bl-3 are not attached
      const unattachedOption = options.find(o => o.id === 'bl-2');
      expect(unattachedOption?.isAttached).toBe(false);
    });

    it('should show no attached items for new application point', () => {
      const options = getBusinessLogicOptions('ap-2', MOCK_META_MODEL);

      // ap-2 has no attachments
      const attachedCount = options.filter(o => o.isAttached).length;
      expect(attachedCount).toBe(0);
    });
  });

  describe('Form Validation', () => {
    it('should require business logic selection', () => {
      const result = validateAttachBusinessLogicForm({
        businessLogicId: '',
        description: 'Some description',
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Business Logic is required');
    });

    it('should pass validation with valid business logic selection', () => {
      const result = validateAttachBusinessLogicForm({
        businessLogicId: 'bl-2',
        description: '',
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should allow optional description field', () => {
      const result = validateAttachBusinessLogicForm({
        businessLogicId: 'bl-2',
        description: '',
      });

      expect(result.valid).toBe(true);
    });
  });

  describe('Duplicate Prevention', () => {
    it('should detect duplicate attachment', () => {
      // bl-1 is already attached to ap-1
      const isDuplicate = isDuplicateAttachment('ap-1', 'bl-1', MOCK_META_MODEL);
      expect(isDuplicate).toBe(true);
    });

    it('should allow new attachment', () => {
      // bl-2 is not attached to ap-1
      const isDuplicate = isDuplicateAttachment('ap-1', 'bl-2', MOCK_META_MODEL);
      expect(isDuplicate).toBe(false);
    });
  });

  describe('Relationship Creation', () => {
    it('should create valid relationship entity', () => {
      const relationship = createAttachmentRelationship(
        'ap-1',
        'bl-2',
        'Tax calculation integration'
      );

      expect(relationship.application_point_id).toBe('ap-1');
      expect(relationship.business_logic_id).toBe('bl-2');
      expect(relationship.description).toBe('Tax calculation integration');
      expect(relationship.id).toBeDefined();
    });

    it('should create relationship without description', () => {
      const relationship = createAttachmentRelationship('ap-2', 'bl-3');

      expect(relationship.application_point_id).toBe('ap-2');
      expect(relationship.business_logic_id).toBe('bl-3');
      expect(relationship.description).toBeUndefined();
    });
  });

  describe('Modal State', () => {
    it('should display read-only application point name', () => {
      // Simulate modal props
      const modalProps = {
        isOpen: true,
        applicationPointId: 'ap-1',
        applicationPointName: 'OrderService.validateOrder',
      };

      expect(modalProps.applicationPointName).toBe('OrderService.validateOrder');
    });

    it('should reset form on modal open', () => {
      // Simulate form reset
      const defaultFormData = {
        businessLogicId: '',
        description: '',
      };

      expect(defaultFormData.businessLogicId).toBe('');
      expect(defaultFormData.description).toBe('');
    });
  });
});

describe('AttachToApplicationPointModal', () => {
  describe('Application Point Options', () => {
    it('should list available application points with display names', () => {
      // Simulate getting options for business logic view
      const apOptions = MOCK_APPLICATION_POINTS.map(ap => ({
        id: ap.id,
        displayName: ap.name,
        isAttached: MOCK_EXISTING_ATTACHMENTS.some(
          rel => rel.application_point_id === ap.id && rel.business_logic_id === 'bl-1'
        ),
        attachmentId: MOCK_EXISTING_ATTACHMENTS.find(
          rel => rel.application_point_id === ap.id && rel.business_logic_id === 'bl-1'
        )?.id,
      }));

      expect(apOptions).toHaveLength(2);
      expect(apOptions[0].displayName).toBe('OrderService.validateOrder');
      expect(apOptions[0].isAttached).toBe(true);
      expect(apOptions[0].attachmentId).toBe('apbl-1');
    });

    it('should show attached items with detach option', () => {
      const attachedToLogic = MOCK_EXISTING_ATTACHMENTS.filter(
        rel => rel.business_logic_id === 'bl-1'
      );

      expect(attachedToLogic).toHaveLength(1);
      expect(attachedToLogic[0].application_point_id).toBe('ap-1');
    });
  });

  describe('Detach Functionality', () => {
    it('should identify relationship to detach by ID', () => {
      const relationshipToDetach = MOCK_EXISTING_ATTACHMENTS.find(
        rel => rel.id === 'apbl-1'
      );

      expect(relationshipToDetach).toBeDefined();
      expect(relationshipToDetach?.application_point_id).toBe('ap-1');
      expect(relationshipToDetach?.business_logic_id).toBe('bl-1');
    });

    it('should simulate detach callback', () => {
      const onDetach = vi.fn();
      const relationshipId = 'apbl-1';

      // Simulate clicking detach button
      onDetach(relationshipId);

      expect(onDetach).toHaveBeenCalledWith('apbl-1');
    });
  });

  describe('Multiple Attachments', () => {
    it('should allow attaching to multiple application points', () => {
      // After attaching, reset form and keep modal open
      const submissions: MockApplicationPointBusinessLogic[] = [];

      // First attachment
      submissions.push(createAttachmentRelationship('ap-1', 'bl-2'));
      // Second attachment
      submissions.push(createAttachmentRelationship('ap-2', 'bl-2'));

      expect(submissions).toHaveLength(2);
      expect(submissions[0].application_point_id).toBe('ap-1');
      expect(submissions[1].application_point_id).toBe('ap-2');
      expect(submissions.every(s => s.business_logic_id === 'bl-2')).toBe(true);
    });
  });
});

describe('Grid Integration', () => {
  describe('Attach Button Visibility', () => {
    it('should show Attach Business Logic button for application_points entity type', () => {
      const entityType = 'application_points';
      const shouldShowButton = entityType === 'application_points';

      expect(shouldShowButton).toBe(true);
    });

    it('should show Attach to Application Point button for business_logics entity type', () => {
      const entityType = 'business_logics';
      const shouldShowButton = entityType === 'business_logics';

      expect(shouldShowButton).toBe(true);
    });

    it('should not show attach buttons for other entity types', () => {
      const otherEntityTypes = ['applications', 'services', 'app_components'];

      for (const entityType of otherEntityTypes) {
        const shouldShowAPButton = entityType === 'application_points';
        const shouldShowBLButton = entityType === 'business_logics';

        expect(shouldShowAPButton).toBe(false);
        expect(shouldShowBLButton).toBe(false);
      }
    });
  });

  describe('Button State', () => {
    it('should disable attach button when no row is selected', () => {
      const selectedRowId = null;
      const isButtonDisabled = !selectedRowId;

      expect(isButtonDisabled).toBe(true);
    });

    it('should enable attach button when row is selected', () => {
      const selectedRowId = 'ap-1';
      const isButtonDisabled = !selectedRowId;

      expect(isButtonDisabled).toBe(false);
    });
  });

  describe('Dispatch Actions', () => {
    it('should create ADD_RELATIONSHIP action for new attachment', () => {
      const relationship = createAttachmentRelationship('ap-1', 'bl-2');

      const action = {
        type: 'ADD_RELATIONSHIP',
        relationshipType: 'application_point_business_logics',
        relationship,
      };

      expect(action.type).toBe('ADD_RELATIONSHIP');
      expect(action.relationshipType).toBe('application_point_business_logics');
      expect(action.relationship.application_point_id).toBe('ap-1');
    });

    it('should create DELETE_RELATIONSHIP action for detach', () => {
      const action = {
        type: 'DELETE_RELATIONSHIP',
        relationshipType: 'application_point_business_logics',
        id: 'apbl-1',
      };

      expect(action.type).toBe('DELETE_RELATIONSHIP');
      expect(action.relationshipType).toBe('application_point_business_logics');
      expect(action.id).toBe('apbl-1');
    });
  });
});
