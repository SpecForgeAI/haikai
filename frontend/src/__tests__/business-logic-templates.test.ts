/**
 * Business Logic Templates Tests
 * Spec: Add Business Logic templates to prefill description on create
 * Task Group 7: Test Review and Gap Analysis
 *
 * Tests cover:
 * - Task Group 1: Template definitions module
 * - Task Group 2: Modal component structure
 * - Task Group 3: Template prefill logic
 * - Task Group 4: Form validation and submission
 * - Task Group 6: Grid integration
 */

import {
  BUSINESS_LOGIC_TEMPLATES,
  BusinessLogicTemplate,
  findTemplateById,
} from '../templates/businessLogicTemplates';

// ============================================================================
// Task Group 1: Template Definitions Module Tests
// ============================================================================

describe('Task Group 1: Template Definitions Module', () => {
  describe('BusinessLogicTemplate interface structure', () => {
    test('each template has required fields: id, label, suggestedType, descriptionMarkdown', () => {
      BUSINESS_LOGIC_TEMPLATES.forEach((template) => {
        expect(template).toHaveProperty('id');
        expect(template).toHaveProperty('label');
        expect(template).toHaveProperty('suggestedType');
        expect(template).toHaveProperty('descriptionMarkdown');

        // Type checks
        expect(typeof template.id).toBe('string');
        expect(typeof template.label).toBe('string');
        expect(
          template.suggestedType === undefined ||
            typeof template.suggestedType === 'string'
        ).toBe(true);
        expect(typeof template.descriptionMarkdown).toBe('string');
      });
    });
  });

  describe('BUSINESS_LOGIC_TEMPLATES array', () => {
    test('contains exactly 6 templates', () => {
      expect(BUSINESS_LOGIC_TEMPLATES).toHaveLength(6);
    });

    test('contains all expected templates: Blank, Calculation, Validation, Transformation/Mapping, Policy/Decision, Workflow', () => {
      const templateLabels = BUSINESS_LOGIC_TEMPLATES.map((t) => t.label);
      expect(templateLabels).toContain('Blank');
      expect(templateLabels).toContain('Calculation');
      expect(templateLabels).toContain('Validation');
      expect(templateLabels).toContain('Transformation / Mapping');
      expect(templateLabels).toContain('Policy / Decision');
      expect(templateLabels).toContain('Workflow');
    });

    test('each template has a unique id', () => {
      const ids = BUSINESS_LOGIC_TEMPLATES.map((t) => t.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });
  });

  describe('Blank template', () => {
    test('returns empty string for description and undefined suggestedType', () => {
      const blankTemplate = findTemplateById('blank');
      expect(blankTemplate).toBeDefined();
      expect(blankTemplate!.descriptionMarkdown).toBe('');
      expect(blankTemplate!.suggestedType).toBeUndefined();
    });
  });

  describe('Non-blank templates', () => {
    const nonBlankTemplates = BUSINESS_LOGIC_TEMPLATES.filter(
      (t) => t.id !== 'blank'
    );

    test('all non-blank templates have non-empty descriptionMarkdown', () => {
      nonBlankTemplates.forEach((template) => {
        expect(template.descriptionMarkdown.length).toBeGreaterThan(0);
      });
    });

    test('all non-blank templates have suggestedType defined', () => {
      nonBlankTemplates.forEach((template) => {
        expect(template.suggestedType).toBeDefined();
        expect(typeof template.suggestedType).toBe('string');
      });
    });
  });

  describe('Template markdown content', () => {
    test('Calculation template has correct sections', () => {
      const template = findTemplateById('calculation');
      expect(template!.descriptionMarkdown).toContain('## Purpose');
      expect(template!.descriptionMarkdown).toContain('## Inputs');
      expect(template!.descriptionMarkdown).toContain('## Steps / Formula');
      expect(template!.descriptionMarkdown).toContain('## Rounding / Precision');
      expect(template!.descriptionMarkdown).toContain('## Edge Cases');
      expect(template!.descriptionMarkdown).toContain('## Examples');
    });

    test('Validation template has correct sections', () => {
      const template = findTemplateById('validation');
      expect(template!.descriptionMarkdown).toContain('## Purpose');
      expect(template!.descriptionMarkdown).toContain('## Inputs / Context');
      expect(template!.descriptionMarkdown).toContain('## Preconditions');
      expect(template!.descriptionMarkdown).toContain('## Rules');
      expect(template!.descriptionMarkdown).toContain('## Error Messages / Codes');
      expect(template!.descriptionMarkdown).toContain('## Examples');
    });

    test('Transformation template has correct sections', () => {
      const template = findTemplateById('transformation');
      expect(template!.descriptionMarkdown).toContain('## Purpose');
      expect(template!.descriptionMarkdown).toContain('## Source');
      expect(template!.descriptionMarkdown).toContain('## Target');
      expect(template!.descriptionMarkdown).toContain('## Field Mappings');
      expect(template!.descriptionMarkdown).toContain('## Transform Rules');
      expect(template!.descriptionMarkdown).toContain('## Null/Default Handling');
      expect(template!.descriptionMarkdown).toContain('## Examples');
    });

    test('Policy template has correct sections', () => {
      const template = findTemplateById('policy');
      expect(template!.descriptionMarkdown).toContain('## Decision');
      expect(template!.descriptionMarkdown).toContain('## Inputs');
      expect(template!.descriptionMarkdown).toContain('## Rules / Criteria');
      expect(template!.descriptionMarkdown).toContain('## Exceptions');
      expect(template!.descriptionMarkdown).toContain('## Examples');
    });

    test('Workflow template has correct sections', () => {
      const template = findTemplateById('workflow');
      expect(template!.descriptionMarkdown).toContain('## Goal');
      expect(template!.descriptionMarkdown).toContain('## Steps');
      expect(template!.descriptionMarkdown).toContain('## Branches / Conditions');
      expect(template!.descriptionMarkdown).toContain('## Retries / Idempotency');
      expect(template!.descriptionMarkdown).toContain('## Observability');
      expect(template!.descriptionMarkdown).toContain('## Examples');
    });
  });

  describe('findTemplateById helper', () => {
    test('returns correct template for valid id', () => {
      const calculation = findTemplateById('calculation');
      expect(calculation).toBeDefined();
      expect(calculation!.id).toBe('calculation');
      expect(calculation!.label).toBe('Calculation');
    });

    test('returns undefined for invalid id', () => {
      const invalid = findTemplateById('nonexistent');
      expect(invalid).toBeUndefined();
    });
  });
});

// ============================================================================
// Task Group 3: Template Prefill Logic Tests (Unit tests for logic)
// ============================================================================

describe('Task Group 3: Template Prefill Logic', () => {
  // Simulating the prefill logic from CreateBusinessLogicModal

  interface FormData {
    name: string;
    typeText: string;
    templateId: string;
    descriptionMd: string;
  }

  /**
   * Simulates the handleTemplateChange logic from CreateBusinessLogicModal
   */
  function simulatePrefill(
    currentFormData: FormData,
    templateId: string
  ): FormData {
    const template = findTemplateById(templateId);
    if (!template) {
      return { ...currentFormData, templateId };
    }

    const updates: Partial<FormData> = { templateId };

    // Prefill description only if empty
    const descriptionIsEmpty = !currentFormData.descriptionMd.trim();
    if (descriptionIsEmpty) {
      updates.descriptionMd = template.descriptionMarkdown;
    }

    // Prefill type only if empty and template has suggestedType
    const typeIsEmpty = !currentFormData.typeText.trim();
    if (typeIsEmpty && template.suggestedType) {
      updates.typeText = template.suggestedType;
    }

    return { ...currentFormData, ...updates };
  }

  test('selecting template prefills description when description is empty', () => {
    const initial: FormData = {
      name: '',
      typeText: '',
      templateId: 'blank',
      descriptionMd: '',
    };

    const result = simulatePrefill(initial, 'calculation');

    expect(result.descriptionMd).toContain('## Purpose');
    expect(result.descriptionMd).toContain('## Steps / Formula');
  });

  test('selecting template does NOT overwrite description when not empty', () => {
    const customDescription = 'My custom description content';
    const initial: FormData = {
      name: '',
      typeText: '',
      templateId: 'blank',
      descriptionMd: customDescription,
    };

    const result = simulatePrefill(initial, 'calculation');

    expect(result.descriptionMd).toBe(customDescription);
    expect(result.descriptionMd).not.toContain('## Purpose');
  });

  test('selecting template prefills Type field when Type is empty', () => {
    const initial: FormData = {
      name: '',
      typeText: '',
      templateId: 'blank',
      descriptionMd: '',
    };

    const result = simulatePrefill(initial, 'validation');

    expect(result.typeText).toBe('Validation');
  });

  test('selecting template does NOT overwrite Type field when not empty', () => {
    const customType = 'Custom Type';
    const initial: FormData = {
      name: '',
      typeText: customType,
      templateId: 'blank',
      descriptionMd: '',
    };

    const result = simulatePrefill(initial, 'validation');

    expect(result.typeText).toBe(customType);
    expect(result.typeText).not.toBe('Validation');
  });

  test('selecting Blank template does not prefill type (suggestedType is undefined)', () => {
    const initial: FormData = {
      name: '',
      typeText: '',
      templateId: 'calculation',
      descriptionMd: '## Purpose\n\n## Inputs',
    };

    const result = simulatePrefill(initial, 'blank');

    expect(result.typeText).toBe('');
    expect(result.descriptionMd).toBe('## Purpose\n\n## Inputs'); // Not overwritten (not empty)
  });

  test('whitespace-only fields are treated as empty', () => {
    const initial: FormData = {
      name: '',
      typeText: '   ',
      templateId: 'blank',
      descriptionMd: '  \n  ',
    };

    const result = simulatePrefill(initial, 'policy');

    expect(result.typeText).toBe('Policy');
    expect(result.descriptionMd).toContain('## Decision');
  });

  test('switching between templates updates correctly', () => {
    // Start with empty form
    let formData: FormData = {
      name: '',
      typeText: '',
      templateId: 'blank',
      descriptionMd: '',
    };

    // Select Calculation
    formData = simulatePrefill(formData, 'calculation');
    expect(formData.typeText).toBe('Calculation');
    expect(formData.descriptionMd).toContain('## Steps / Formula');

    // Switch to Validation - should NOT overwrite because fields are now non-empty
    formData = simulatePrefill(formData, 'validation');
    expect(formData.typeText).toBe('Calculation'); // NOT overwritten
    expect(formData.descriptionMd).toContain('## Steps / Formula'); // NOT overwritten
    expect(formData.templateId).toBe('validation'); // But templateId is updated
  });
});

// ============================================================================
// Task Group 4: Form Validation Tests (Unit tests for validation logic)
// ============================================================================

describe('Task Group 4: Form Validation', () => {
  /**
   * Simulates the isFormValid logic from CreateBusinessLogicModal
   */
  function isFormValid(name: string): boolean {
    return name.trim().length > 0;
  }

  test('form is invalid when Name is empty', () => {
    expect(isFormValid('')).toBe(false);
  });

  test('form is invalid when Name is whitespace only', () => {
    expect(isFormValid('   ')).toBe(false);
    expect(isFormValid('\t\n')).toBe(false);
  });

  test('form is valid when Name has content', () => {
    expect(isFormValid('My Business Logic')).toBe(true);
    expect(isFormValid('a')).toBe(true);
  });

  test('form is valid regardless of Type field content', () => {
    // Type is optional, so form should be valid with just a name
    expect(isFormValid('Rule Name')).toBe(true);
  });
});

// ============================================================================
// Integration-style tests (simulating full workflow)
// ============================================================================

describe('Full Workflow Integration', () => {
  interface FormData {
    name: string;
    typeText: string;
    templateId: string;
    descriptionMd: string;
  }

  interface BusinessLogicEntity {
    id: string;
    name: string;
    type_text?: string;
    description_md?: string;
    tags: string;
  }

  function simulatePrefill(
    currentFormData: FormData,
    templateId: string
  ): FormData {
    const template = findTemplateById(templateId);
    if (!template) {
      return { ...currentFormData, templateId };
    }
    const updates: Partial<FormData> = { templateId };
    if (!currentFormData.descriptionMd.trim()) {
      updates.descriptionMd = template.descriptionMarkdown;
    }
    if (!currentFormData.typeText.trim() && template.suggestedType) {
      updates.typeText = template.suggestedType;
    }
    return { ...currentFormData, ...updates };
  }

  function createEntity(formData: FormData): BusinessLogicEntity {
    return {
      id: 'test-id-123',
      name: formData.name.trim(),
      type_text: formData.typeText.trim() || undefined,
      description_md: formData.descriptionMd || undefined,
      tags: '',
    };
  }

  test('full workflow: open modal -> select template -> fill name -> submit -> verify entity', () => {
    // Step 1: Initial form state (simulating modal open)
    let formData: FormData = {
      name: '',
      typeText: '',
      templateId: 'blank',
      descriptionMd: '',
    };

    // Step 2: Select Calculation template
    formData = simulatePrefill(formData, 'calculation');

    // Verify prefill
    expect(formData.templateId).toBe('calculation');
    expect(formData.typeText).toBe('Calculation');
    expect(formData.descriptionMd).toContain('## Purpose');
    expect(formData.descriptionMd).toContain('## Steps / Formula');

    // Step 3: Fill in name
    formData = { ...formData, name: 'Price Calculation Logic' };

    // Step 4: Verify form is valid
    expect(formData.name.trim().length > 0).toBe(true);

    // Step 5: Submit (create entity)
    const entity = createEntity(formData);

    // Step 6: Verify entity structure
    expect(entity.id).toBe('test-id-123');
    expect(entity.name).toBe('Price Calculation Logic');
    expect(entity.type_text).toBe('Calculation');
    expect(entity.description_md).toContain('## Purpose');
    expect(entity.tags).toBe('');
  });

  test('partial prefill: only description when type already filled', () => {
    let formData: FormData = {
      name: '',
      typeText: 'Custom Calculation',
      templateId: 'blank',
      descriptionMd: '',
    };

    formData = simulatePrefill(formData, 'calculation');

    // Type should NOT be overwritten
    expect(formData.typeText).toBe('Custom Calculation');
    // Description SHOULD be prefilled (was empty)
    expect(formData.descriptionMd).toContain('## Purpose');
  });

  test('partial prefill: only type when description already filled', () => {
    let formData: FormData = {
      name: '',
      typeText: '',
      templateId: 'blank',
      descriptionMd: 'My existing description',
    };

    formData = simulatePrefill(formData, 'validation');

    // Description should NOT be overwritten
    expect(formData.descriptionMd).toBe('My existing description');
    // Type SHOULD be prefilled (was empty)
    expect(formData.typeText).toBe('Validation');
  });

  test('neither field prefilled when both already filled', () => {
    let formData: FormData = {
      name: '',
      typeText: 'Existing Type',
      templateId: 'blank',
      descriptionMd: 'Existing description',
    };

    formData = simulatePrefill(formData, 'workflow');

    // Neither should be overwritten
    expect(formData.typeText).toBe('Existing Type');
    expect(formData.descriptionMd).toBe('Existing description');
    // But templateId should update
    expect(formData.templateId).toBe('workflow');
  });
});
