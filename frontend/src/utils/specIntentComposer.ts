/**
 * Spec Intent Composer
 *
 * Spec 2026-01-28: Implement Button Starts Shape-Spec Stream
 * Task Group 2: Spec Intent Composition Function
 *
 * Composes a spec intent message from PlannerResponse for the Shape-Spec stream endpoint.
 * The output is an LLM-friendly string prefixed with `/shape-spec `.
 *
 * Spec 2026-02-10: Added composeFullFeatureContext() for split-path messages.
 * Renders the full feature definition (as displayed on the LHS) as structured
 * markdown so the implementation LLM has the broader feature context when
 * working on an individual increment.
 */

import type { PlannerResponse } from '../api/chatApi';

/**
 * Composes a spec intent message from a PlannerResponse.
 *
 * Extracts the following fields from the PlannerResponse:
 * - featureUnderstanding: Primary feature description
 * - scope.in: Items explicitly in scope
 * - scope.out: Items explicitly out of scope
 * - assumptions: Working assumptions
 * - acceptanceCriteria: Completion criteria
 *
 * The output is formatted as an LLM-friendly string with:
 * - `/shape-spec ` prefix (required by the endpoint)
 * - Markdown-style section headers (## Header)
 * - Bulleted lists for array fields
 * - Empty sections are preserved (not omitted)
 *
 * @param plannerResponse - The PlannerResponse to compose from, or null
 * @returns The composed spec intent string, or null if input is null/undefined
 */
export function composeSpecIntent(
  plannerResponse: PlannerResponse | null,
  siblingStories?: Array<{ title: string; description: string | null; status: string }>,
): string | null {
  // Handle null/undefined input
  if (plannerResponse === null || plannerResponse === undefined) {
    return null;
  }

  const {
    featureUnderstanding,
    scope,
    assumptions,
    acceptanceCriteria,
  } = plannerResponse;

  // Build the spec intent sections
  const sections: string[] = [];

  // Feature Description section
  sections.push('## Feature Description');
  sections.push(featureUnderstanding || '');
  sections.push('');

  // In Scope section
  sections.push('## In Scope');
  if (scope?.in && scope.in.length > 0) {
    for (const item of scope.in) {
      sections.push(`- ${item}`);
    }
  }
  sections.push('');

  // Out of Scope section
  sections.push('## Out of Scope');
  if (scope?.out && scope.out.length > 0) {
    for (const item of scope.out) {
      sections.push(`- ${item}`);
    }
  }
  sections.push('');

  // Sibling items section — scope boundary awareness for the implementation LLM
  if (siblingStories && siblingStories.length > 0) {
    sections.push('## Sibling Items (handled separately — do NOT implement these)');
    for (const s of siblingStories) {
      const desc = s.description ? `: ${s.description}` : '';
      sections.push(`- [${s.status}] ${s.title}${desc}`);
    }
    sections.push('');
  }

  // Assumptions section
  sections.push('## Assumptions');
  if (assumptions && assumptions.length > 0) {
    for (const item of assumptions) {
      sections.push(`- ${item}`);
    }
  }
  sections.push('');

  // Acceptance Criteria section
  sections.push('## Acceptance Criteria');
  if (acceptanceCriteria && acceptanceCriteria.length > 0) {
    for (const item of acceptanceCriteria) {
      sections.push(`- ${item}`);
    }
  }

  // Join all sections and prefix with /shape-spec
  const content = sections.join('\n');
  return `/shape-spec ${content}`;
}

/**
 * Spec 2026-02-10: Compose the full feature context as structured markdown.
 *
 * Renders the same information displayed on the LHS FeatureDefinitionPanel:
 * feature understanding, scope (in/out), assumptions, and acceptance criteria.
 *
 * Used by the split-path to give the implementation LLM the broader feature
 * context alongside the increment-specific elaboration.
 *
 * @param plannerResponse - The PlannerResponse containing feature context
 * @returns Formatted markdown string, or null if input is null/undefined
 */
export function composeFullFeatureContext(plannerResponse: PlannerResponse | null): string | null {
  if (!plannerResponse) {
    return null;
  }

  const {
    featureUnderstanding,
    scope,
    assumptions,
    acceptanceCriteria,
  } = plannerResponse;

  const sections: string[] = [];

  sections.push('## Full Feature Context');
  sections.push('Here is the full understanding of this feature, as agreed by the tool user and product owner:\n');

  sections.push('### Feature Understanding');
  sections.push(featureUnderstanding || '');
  sections.push('');

  if (scope?.in && scope.in.length > 0) {
    sections.push('### In Scope');
    for (const item of scope.in) {
      sections.push(`- ${item}`);
    }
    sections.push('');
  }

  if (scope?.out && scope.out.length > 0) {
    sections.push('### Out of Scope');
    for (const item of scope.out) {
      sections.push(`- ${item}`);
    }
    sections.push('');
  }

  if (assumptions && assumptions.length > 0) {
    sections.push('### Assumptions');
    for (const item of assumptions) {
      sections.push(`- ${item}`);
    }
    sections.push('');
  }

  sections.push('### Acceptance Criteria');
  if (acceptanceCriteria && acceptanceCriteria.length > 0) {
    for (const item of acceptanceCriteria) {
      sections.push(`- ${item}`);
    }
  } else {
    sections.push('No acceptance criteria defined yet.');
  }

  return sections.join('\n');
}
