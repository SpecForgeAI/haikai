/**
 * Business Logic Templates for Creation Flow
 * Spec: Add Business Logic templates to prefill description on create
 *
 * Provides template options when creating Business Logic entities,
 * prefilling the description with markdown skeletons to accelerate
 * authoring of common business logic types.
 *
 * Task Group 1: Template Definitions Module
 */

/**
 * BusinessLogicTemplate interface - defines the structure of a template.
 *
 * @property id - unique template identifier
 * @property label - display name for dropdown
 * @property suggestedType - prefill value for Type field (undefined for Blank)
 * @property descriptionMarkdown - markdown skeleton content
 */
export interface BusinessLogicTemplate {
  id: string;
  label: string;
  suggestedType: string | undefined;
  descriptionMarkdown: string;
}

/**
 * BUSINESS_LOGIC_TEMPLATES - array of all available templates.
 *
 * Templates:
 * - Blank: Empty template with no prefilled content
 * - Calculation: For formulas, pricing, aggregations
 * - Validation: For input/data validation rules
 * - Transformation/Mapping: For data transformation and field mappings
 * - Policy/Decision: For business rules and decision logic
 * - Workflow: For multi-step processes and flows
 */
export const BUSINESS_LOGIC_TEMPLATES: BusinessLogicTemplate[] = [
  // Blank template - empty description and no suggested type
  {
    id: 'blank',
    label: 'Blank',
    suggestedType: undefined,
    descriptionMarkdown: '',
  },

  // Calculation template
  {
    id: 'calculation',
    label: 'Calculation',
    suggestedType: 'Calculation',
    descriptionMarkdown: `## Purpose

## Inputs

## Steps / Formula

## Rounding / Precision

## Edge Cases

## Examples`,
  },

  // Validation template
  {
    id: 'validation',
    label: 'Validation',
    suggestedType: 'Validation',
    descriptionMarkdown: `## Purpose

## Inputs / Context

## Preconditions

## Rules

## Error Messages / Codes

## Examples`,
  },

  // Transformation / Mapping template
  {
    id: 'transformation',
    label: 'Transformation / Mapping',
    suggestedType: 'Transformation',
    descriptionMarkdown: `## Purpose

## Source

## Target

## Field Mappings

## Transform Rules

## Null/Default Handling

## Examples`,
  },

  // Policy / Decision template
  {
    id: 'policy',
    label: 'Policy / Decision',
    suggestedType: 'Policy',
    descriptionMarkdown: `## Decision

## Inputs

## Rules / Criteria

## Exceptions

## Examples`,
  },

  // Workflow template
  {
    id: 'workflow',
    label: 'Workflow',
    suggestedType: 'Workflow',
    descriptionMarkdown: `## Goal

## Steps

## Branches / Conditions

## Retries / Idempotency

## Observability

## Examples`,
  },
];

/**
 * Helper function to find a template by ID.
 * @param templateId - The template ID to find
 * @returns The matching template or undefined
 */
export function findTemplateById(templateId: string): BusinessLogicTemplate | undefined {
  return BUSINESS_LOGIC_TEMPLATES.find((t) => t.id === templateId);
}
