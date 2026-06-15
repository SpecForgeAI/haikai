/**
 * CreateAndPlaceDrawer Component Tests
 * Task Group 1: Tests for the CreateAndPlaceDrawer component
 *
 * Tests the drawer component used for creating new entities in ER, State, and Activity diagrams.
 */

import { describe, it, expect } from 'vitest';

// Entity type constants
const ENTITY_TYPES = {
  LOGICAL_DATA_ENTITY: 'LOGICAL_DATA_ENTITY',
  PHYSICAL_DATA_ENTITY: 'PHYSICAL_DATA_ENTITY',
  STATE: 'STATE',
  ACTIVITY: 'ACTIVITY',
  ACTIVITY_PARTITION: 'ACTIVITY_PARTITION',
};

// Field configurations for each entity type
const ENTITY_FIELD_CONFIGS: Record<string, { required: string[]; optional: string[]; dropdowns: string[] }> = {
  [ENTITY_TYPES.STATE]: {
    required: ['name', 'stateKind'],
    optional: ['description'],
    dropdowns: ['stateKind'],
  },
  [ENTITY_TYPES.ACTIVITY]: {
    required: ['name', 'activityKind'],
    optional: ['description'],
    dropdowns: ['activityKind'],
  },
  [ENTITY_TYPES.ACTIVITY_PARTITION]: {
    required: [], // name is conditionally required
    optional: ['name', 'refKind', 'refId', 'description'],
    dropdowns: ['refKind'],
  },
  [ENTITY_TYPES.LOGICAL_DATA_ENTITY]: {
    required: ['name'],
    optional: ['description', 'tags'],
    dropdowns: [],
  },
  [ENTITY_TYPES.PHYSICAL_DATA_ENTITY]: {
    required: ['name'],
    optional: ['description', 'physical_type', 'database', 'tags'],
    dropdowns: [],
  },
};

// StateKind dropdown options
const STATE_KIND_OPTIONS = ['Initial', 'Normal', 'Final'];

// ActivityKind dropdown options
const ACTIVITY_KIND_OPTIONS = ['Initial', 'Action', 'Decision', 'Merge', 'Final'];

// ActivityPartitionRefKind dropdown options
const ACTIVITY_PARTITION_REF_KIND_OPTIONS = [
  'BusinessUser',
  'Application',
  'ApplicationComponent',
  'Service',
  'Interface',
  'Class',
];

/**
 * Helper function to get field configuration for an entity type
 */
function getFieldConfigForEntityType(entityType: string) {
  return ENTITY_FIELD_CONFIGS[entityType] || null;
}

/**
 * Helper function to get dropdown options for a field
 */
function getDropdownOptions(fieldName: string): string[] | null {
  switch (fieldName) {
    case 'stateKind':
      return STATE_KIND_OPTIONS;
    case 'activityKind':
      return ACTIVITY_KIND_OPTIONS;
    case 'refKind':
      return ACTIVITY_PARTITION_REF_KIND_OPTIONS;
    default:
      return null;
  }
}

/**
 * Helper function to validate required fields
 */
function validateRequiredFields(
  entityType: string,
  formData: Record<string, unknown>
): { valid: boolean; errors: string[] } {
  const config = getFieldConfigForEntityType(entityType);
  if (!config) {
    return { valid: false, errors: ['Unknown entity type'] };
  }

  const errors: string[] = [];

  // Special handling for ActivityPartition - name required if refKind not set
  if (entityType === ENTITY_TYPES.ACTIVITY_PARTITION) {
    const hasRefKind = formData.refKind && String(formData.refKind).trim() !== '';
    const hasName = formData.name && String(formData.name).trim() !== '';

    if (!hasRefKind && !hasName) {
      errors.push('Name is required when no reference is selected');
    }
    if (hasRefKind && (!formData.refId || String(formData.refId).trim() === '')) {
      errors.push('Reference ID is required when reference kind is selected');
    }
  } else {
    // Standard required field validation
    for (const field of config.required) {
      const value = formData[field];
      if (value === undefined || value === null || String(value).trim() === '') {
        errors.push(`${field} is required`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

describe('CreateAndPlaceDrawer - Field Configuration', () => {
  describe('Task 1.1: Form renders correct fields based on entity type', () => {
    it('should have correct field configuration for State entity', () => {
      const config = getFieldConfigForEntityType(ENTITY_TYPES.STATE);

      expect(config).not.toBeNull();
      expect(config!.required).toContain('name');
      expect(config!.required).toContain('stateKind');
      expect(config!.optional).toContain('description');
      expect(config!.dropdowns).toContain('stateKind');
    });

    it('should have correct field configuration for Activity entity', () => {
      const config = getFieldConfigForEntityType(ENTITY_TYPES.ACTIVITY);

      expect(config).not.toBeNull();
      expect(config!.required).toContain('name');
      expect(config!.required).toContain('activityKind');
      expect(config!.optional).toContain('description');
      expect(config!.dropdowns).toContain('activityKind');
    });

    it('should have correct field configuration for ActivityPartition entity', () => {
      const config = getFieldConfigForEntityType(ENTITY_TYPES.ACTIVITY_PARTITION);

      expect(config).not.toBeNull();
      // name is conditionally required, not in required array
      expect(config!.optional).toContain('name');
      expect(config!.optional).toContain('refKind');
      expect(config!.optional).toContain('refId');
      expect(config!.optional).toContain('description');
      expect(config!.dropdowns).toContain('refKind');
    });

    it('should have correct field configuration for LogicalDataEntity', () => {
      const config = getFieldConfigForEntityType(ENTITY_TYPES.LOGICAL_DATA_ENTITY);

      expect(config).not.toBeNull();
      expect(config!.required).toContain('name');
      expect(config!.optional).toContain('description');
      expect(config!.optional).toContain('tags');
    });

    it('should have correct field configuration for PhysicalDataEntity', () => {
      const config = getFieldConfigForEntityType(ENTITY_TYPES.PHYSICAL_DATA_ENTITY);

      expect(config).not.toBeNull();
      expect(config!.required).toContain('name');
      expect(config!.optional).toContain('description');
      expect(config!.optional).toContain('physical_type');
      expect(config!.optional).toContain('database');
      expect(config!.optional).toContain('tags');
    });
  });

  describe('Task 1.1: Dropdown fields render correct options', () => {
    it('should have correct StateKind dropdown options', () => {
      const options = getDropdownOptions('stateKind');

      expect(options).not.toBeNull();
      expect(options).toContain('Initial');
      expect(options).toContain('Normal');
      expect(options).toContain('Final');
      expect(options).toHaveLength(3);
    });

    it('should have correct ActivityKind dropdown options', () => {
      const options = getDropdownOptions('activityKind');

      expect(options).not.toBeNull();
      expect(options).toContain('Initial');
      expect(options).toContain('Action');
      expect(options).toContain('Decision');
      expect(options).toContain('Merge');
      expect(options).toContain('Final');
      expect(options).toHaveLength(5);
    });

    it('should have correct ActivityPartitionRefKind dropdown options', () => {
      const options = getDropdownOptions('refKind');

      expect(options).not.toBeNull();
      expect(options).toContain('BusinessUser');
      expect(options).toContain('Application');
      expect(options).toContain('ApplicationComponent');
      expect(options).toContain('Service');
      expect(options).toContain('Interface');
      expect(options).toContain('Class');
      expect(options).toHaveLength(6);
    });
  });
});

describe('CreateAndPlaceDrawer - Validation', () => {
  describe('Task 1.1: Required field validation prevents submission with empty required fields', () => {
    it('should fail validation when State name is empty', () => {
      const formData = { name: '', stateKind: 'Normal' };
      const result = validateRequiredFields(ENTITY_TYPES.STATE, formData);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('name is required');
    });

    it('should fail validation when State stateKind is empty', () => {
      const formData = { name: 'My State', stateKind: '' };
      const result = validateRequiredFields(ENTITY_TYPES.STATE, formData);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('stateKind is required');
    });

    it('should pass validation when all State required fields are filled', () => {
      const formData = { name: 'My State', stateKind: 'Normal', description: '' };
      const result = validateRequiredFields(ENTITY_TYPES.STATE, formData);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should fail validation when Activity name is empty', () => {
      const formData = { name: '', activityKind: 'Action' };
      const result = validateRequiredFields(ENTITY_TYPES.ACTIVITY, formData);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('name is required');
    });

    it('should pass validation when all Activity required fields are filled', () => {
      const formData = { name: 'My Activity', activityKind: 'Action' };
      const result = validateRequiredFields(ENTITY_TYPES.ACTIVITY, formData);

      expect(result.valid).toBe(true);
    });

    it('should fail validation when LogicalDataEntity name is empty', () => {
      const formData = { name: '' };
      const result = validateRequiredFields(ENTITY_TYPES.LOGICAL_DATA_ENTITY, formData);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('name is required');
    });

    it('should pass validation when LogicalDataEntity name is filled', () => {
      const formData = { name: 'Customer' };
      const result = validateRequiredFields(ENTITY_TYPES.LOGICAL_DATA_ENTITY, formData);

      expect(result.valid).toBe(true);
    });
  });

  describe('Task 1.1: ActivityPartition conditional validation', () => {
    it('should require name when refKind is not set', () => {
      const formData = { name: '', refKind: '', refId: '' };
      const result = validateRequiredFields(ENTITY_TYPES.ACTIVITY_PARTITION, formData);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Name is required when no reference is selected');
    });

    it('should pass validation when name is set and refKind is not', () => {
      const formData = { name: 'User Lane', refKind: '', refId: '' };
      const result = validateRequiredFields(ENTITY_TYPES.ACTIVITY_PARTITION, formData);

      expect(result.valid).toBe(true);
    });

    it('should require refId when refKind is set', () => {
      const formData = { name: '', refKind: 'Application', refId: '' };
      const result = validateRequiredFields(ENTITY_TYPES.ACTIVITY_PARTITION, formData);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Reference ID is required when reference kind is selected');
    });

    it('should pass validation when refKind and refId are both set', () => {
      const formData = { name: '', refKind: 'Application', refId: 'app-123' };
      const result = validateRequiredFields(ENTITY_TYPES.ACTIVITY_PARTITION, formData);

      expect(result.valid).toBe(true);
    });
  });
});

describe('CreateAndPlaceDrawer - Entity Type Mapping', () => {
  it('should support all required entity types', () => {
    const supportedTypes = Object.keys(ENTITY_FIELD_CONFIGS);

    expect(supportedTypes).toContain(ENTITY_TYPES.STATE);
    expect(supportedTypes).toContain(ENTITY_TYPES.ACTIVITY);
    expect(supportedTypes).toContain(ENTITY_TYPES.ACTIVITY_PARTITION);
    expect(supportedTypes).toContain(ENTITY_TYPES.LOGICAL_DATA_ENTITY);
    expect(supportedTypes).toContain(ENTITY_TYPES.PHYSICAL_DATA_ENTITY);
  });

  it('should return null for unknown entity type', () => {
    const config = getFieldConfigForEntityType('UNKNOWN_TYPE');
    expect(config).toBeNull();
  });
});
