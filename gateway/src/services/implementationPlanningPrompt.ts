/**
 * Implementation Planning Prompt Template
 *
 * System prompt for the implementation_planning phase of implement_feature mode.
 * Instructs the LLM to generate a structured implementation plan with increments.
 *
 * Spec 2026-01-22: Expanded Planner JSON Contract (v1.1)
 * Task Group 3: System Prompts Layer
 */

import { ChatContext, ResolvedImplementContextDto } from '../types';
import { loadArchitectureExplainerSync } from './architectureContextBuilder';

/**
 * Implementation Planning system prompt template.
 * Used when mode is "implement_feature" and phase is "implementation_planning".
 *
 * Placeholders:
 * - {workItemTitle}, {workItemType}, {workItemDescription}: Work item context
 * - {entityIds}, {diagramIds}: Architecture context IDs
 * - {resolvedContext}: Resolved architecture context details
 * - {featureUnderstanding}, {scopeIn}, {scopeOut}, {assumptions}, {acceptanceCriteria}: Shaped feature data
 *
 * Spec 2026-01-22: Expanded Planner JSON Contract (v1.1)
 */
export const IMPLEMENT_PLANNING_PROMPT_TEMPLATE = `You are a Product Owner creating an implementation plan for a shaped feature.

## CONTEXT
Work Item: {workItemTitle}
Type: {workItemType}
Description: {workItemDescription}

## SIBLING ITEMS (other items under the same parent — their scope is OFF-LIMITS)
{siblingStories}
DO NOT expand this work item's scope to cover functionality described in the sibling items above. Each sibling is handled separately.

## PRIOR BACKLOG DISCUSSION
The following is the conversation from the Product Backlog screen where this work item was discussed and defined. Use this context to understand the reasoning and decisions behind the current scope.
{backlogConversation}

## Architecture Meta-Model Reference
{architectureExplainer}

## Full Architecture Model
{fullArchitectureModel}

Selected Architecture Context:
- Entity IDs: {entityIds}
- Diagram IDs: {diagramIds}

Resolved Context Details:
{resolvedContext}

## SHAPED FEATURE (from previous conversation)
Feature Understanding: {featureUnderstanding}
Scope In: {scopeIn}
Scope Out: {scopeOut}
Assumptions: {assumptions}
Acceptance Criteria: {acceptanceCriteria}

## YOUR TASK
Create an implementation plan for this feature. The VAST MAJORITY of features should
be a single increment — do NOT over-decompose.

## SINGLE INCREMENT IS THE DEFAULT
Almost every feature belongs in exactly 1 increment. One increment means one pass
through the Software Developer. This is correct for:
- Creating a new service, API, or endpoint (even with multiple files)
- Adding a new UI screen or component with backend wiring
- CRUD features spanning frontend, backend, and database
- Refactoring or migrating existing code
- Adding configuration, tooling, or infrastructure
- Bug fixes of any complexity
- Features touching up to ~15 files

Use 1 increment unless the feature is genuinely enormous (see below).

## WHEN TO USE 2-3 INCREMENTS (RARE)
Only create 2-3 increments when the feature is so large that a single increment would
contain MORE THAN 20 files across unrelated subsystems AND the increments are sequentially
dependent (increment 2 builds on the output of increment 1). Even then, prefer 2 over 3.

Each increment's "intent" must be detailed enough for a Software Developer to
implement without further clarification.

## WHEN TO SPLIT INTO INDEPENDENT PARTS (EXTREMELY RARE)
Set "isSplit": true ONLY when ALL of these conditions are met:
1. The feature would need 5+ increments AND
2. At least two groups of increments are truly independent (no shared interfaces, no shared data models, no sequential dependency) AND
3. Each group is independently large enough to be its own feature (not just a few files)

In practice, almost no feature should be split. If in doubt, use 1 increment.

## RESPONSE FORMAT
You MUST respond with VALID JSON ONLY. No markdown, no prose outside the JSON structure.

### Standard Plan (most features)

\`\`\`json
{
  "schemaVersion": "1.1",
  "message": "Here is the plan for {workItemTitle}.",
  "featureUnderstanding": "The full feature definition",
  "scope": {
    "in": ["Scope items"],
    "out": ["Out of scope items"]
  },
  "assumptions": ["Assumptions"],
  "acceptanceCriteria": ["All acceptance criteria"],
  "openQuestions": [],
  "plannerReadyForSpec": true,
  "implementationPlan": {
    "planTitle": "Implementation Plan for {workItemTitle}",
    "increments": [
      {
        "id": "INC-1",
        "partIndex": 1,
        "title": "Increment title",
        "intent": "Detailed specification for the Software Developer...",
        "dependencies": []
      }
    ]
  }
}
\`\`\`

### Split Plan (extremely rare — set "isSplit": true)
Same structure, but with "isSplit": true when the feature meets ALL splitting criteria above.

\`\`\`json
{
  "schemaVersion": "1.1",
  "message": "This feature should be split into independent parts.",
  "implementationPlan": {
    "planTitle": "Implementation Plan for {workItemTitle}",
    "isSplit": true,
    "increments": [
      { "id": "INC-1", "partIndex": 1, "title": "Part title", "intent": "Detailed intent...", "dependencies": [] },
      { "id": "INC-2", "partIndex": 2, "title": "Part title", "intent": "Detailed intent...", "dependencies": ["Part 1: ..."] }
    ]
  }
}
\`\`\`

## RULES
1. ALWAYS include ALL fields, even if arrays are empty
2. Default to 1 increment. Only create 2-3 when the feature is genuinely enormous (20+ files across unrelated subsystems). NEVER create more than 3 increments.
3. Each increment's "intent" must be comprehensive enough for a Software Developer to implement
4. All increment IDs should be sequential (INC-1, INC-2, etc.)
5. "partIndex" values MUST start at 1 and increment sequentially
6. "implementationPlan" must NOT be null in this phase
7. "plannerReadyForSpec" should be true
8. "openQuestions" should be empty (all questions resolved before this phase)
9. "dependencies" is optional; when present it must be an array of strings referencing earlier parts

## RESPONSE STYLE
- Be concise in the "message" field
- Be detailed in "intent" for each increment
- Use bullet points within intent fields where helpful
- Ground all content in the shaped feature and architecture context`;

/**
 * Formats the resolved context as a compact JSON string for prompt injection.
 */
function formatResolvedContext(resolvedContext?: ResolvedImplementContextDto | null): string {
  if (!resolvedContext) {
    return 'No resolved context available';
  }

  const hasEntities = resolvedContext.resolved_entities?.length > 0;
  const hasDiagrams = resolvedContext.resolved_diagrams?.length > 0;

  if (!hasEntities && !hasDiagrams) {
    return 'No resolved entities or diagrams';
  }

  // Build compact representation
  const formatted: Record<string, unknown> = {};

  if (hasEntities) {
    formatted.entities = resolvedContext.resolved_entities.map(entity => ({
      id: entity.id,
      name: entity.name,
      type: entity.entity_type,
      category: entity.category,
      ...entity.relevant_fields,
    }));
  }

  if (hasDiagrams) {
    formatted.diagrams = resolvedContext.resolved_diagrams.map(diagram => ({
      id: diagram.id,
      name: diagram.name,
      type: diagram.diagram_type,
      referencedEntities: diagram.referenced_entity_names?.length ? diagram.referenced_entity_names : diagram.referenced_entity_ids,
    }));
  }

  return JSON.stringify(formatted, null, 2);
}

/**
 * Shaped feature data for injection into the implementation planning prompt.
 */
export interface ShapedFeatureData {
  featureUnderstanding: string;
  scopeIn: string[];
  scopeOut: string[];
  assumptions: string[];
  acceptanceCriteria: string[];
}

/**
 * Builds the Implementation Planning system prompt with injected context.
 * Used when mode is "implement_feature" and phase is "implementation_planning".
 *
 * @param context - Chat context containing work item and architecture context
 * @param resolvedContext - Optional resolved implement context from backend API
 * @param shapedFeature - Optional shaped feature data from previous refine conversation
 * @returns Implementation Planning system prompt string
 */
export function buildImplementationPlanningPrompt(
  context: ChatContext,
  resolvedContext?: ResolvedImplementContextDto | null,
  shapedFeature?: ShapedFeatureData | null,
  fullArchitectureModel?: object | null,
  backlogConversation?: string | null,
): string {
  // Extract work item values
  const workItemTitle = context.workItem?.title || 'not provided';
  const workItemType = context.workItem?.type || 'not provided';
  const workItemDescription = context.workItem?.description || 'not provided';

  // Extract architecture context values
  const entityIds = context.architectureContext?.entityIds?.length
    ? context.architectureContext.entityIds.join(', ')
    : 'none';
  const diagramIds = context.architectureContext?.diagramIds?.length
    ? context.architectureContext.diagramIds.join(', ')
    : 'none';

  // Format resolved context
  const resolvedContextStr = formatResolvedContext(resolvedContext);

  // Format shaped feature data (with defaults)
  const featureUnderstanding = shapedFeature?.featureUnderstanding || context.workItem?.description || 'not provided';
  const scopeIn = shapedFeature?.scopeIn?.length
    ? shapedFeature.scopeIn.join(', ')
    : 'As described in work item';
  const scopeOut = shapedFeature?.scopeOut?.length
    ? shapedFeature.scopeOut.join(', ')
    : 'None specified';
  const assumptions = shapedFeature?.assumptions?.length
    ? shapedFeature.assumptions.join(', ')
    : 'None specified';
  const acceptanceCriteria = shapedFeature?.acceptanceCriteria?.length
    ? shapedFeature.acceptanceCriteria.join(', ')
    : 'Feature works as described';

  // Load architecture meta-model explainer (cached after first read)
  const architectureExplainer = loadArchitectureExplainerSync();

  // Format sibling stories for scope boundary awareness
  const siblings = context.workItem?.siblingStories;
  const siblingStoriesStr = (!siblings || siblings.length === 0)
    ? 'No sibling items.'
    : siblings.map((s) => {
        const desc = s.description ? `: ${s.description}` : '';
        return `- [${s.status}] ${s.title}${desc}`;
      }).join('\n');

  // Replace placeholders (use regex for workItemTitle since it appears 3+ times in template)
  return IMPLEMENT_PLANNING_PROMPT_TEMPLATE
    .replace(/{workItemTitle}/g, workItemTitle)
    .replace('{workItemType}', workItemType)
    .replace('{workItemDescription}', workItemDescription)
    .replace('{siblingStories}', siblingStoriesStr)
    .replace('{backlogConversation}', backlogConversation || 'No prior backlog conversation available.')
    .replace('{architectureExplainer}', architectureExplainer)
    .replace('{entityIds}', entityIds)
    .replace('{diagramIds}', diagramIds)
    .replace('{resolvedContext}', resolvedContextStr)
    .replace('{featureUnderstanding}', featureUnderstanding)
    .replace('{scopeIn}', scopeIn)
    .replace('{scopeOut}', scopeOut)
    .replace('{assumptions}', assumptions)
    .replace('{acceptanceCriteria}', acceptanceCriteria)
    .replace('{fullArchitectureModel}', fullArchitectureModel ? JSON.stringify(fullArchitectureModel) : 'No architecture model available');
}
