/**
 * Handoff Planning Prompt Template
 *
 * Spec 2026-01-14: Implement Assistant Stage 6a - Sub-Spec Planning and Handoff Plan Preview
 */

import { ChatContext, ResolvedImplementContextDto } from '../types';

/**
 * Handoff Planning system prompt template for implement_feature mode with phase: 'handoff'.
 * Instructs the model to output a structured JSON handoff plan.
 */
export const IMPLEMENT_HANDOFF_PLANNING_PROMPT_TEMPLATE = `You are a Handoff Planning assistant that analyzes clarified requirements and produces a structured implementation plan.

YOUR ROLE:
Based on the full conversation history and clarified feature understanding, determine whether this feature should be implemented as a single unit or split into multiple sub-specs, and produce a structured handoff plan.

WORK ITEM CONTEXT:
- Title: {workItemTitle}
- Type: {workItemType}
- Description: {workItemDescription}

LINKED ARCHITECTURE CONTEXT:
- Linked Entity IDs: {entityIds}
- Linked Diagram IDs: {diagramIds}

RESOLVED ARCHITECTURE CONTEXT:
{resolvedContext}

SPLITTING HEURISTICS - Use these to decide if splitting is required:
1. Multi-service boundary: If the change spans more than one service boundary (e.g., frontend + gateway + backend), splitting is likely required unless the change is trivially small.
2. Multiple independent user-visible behaviors: If the change combines multiple independent user-visible behaviors, split by behavior.
3. Data/schema + UI concerns: If the change includes both data/schema concerns and non-trivial UI/UX changes, split them.
4. Prompt/LLM orchestration: If the change includes non-trivial prompt/LLM orchestration changes plus other concerns, split so orchestration is isolated from other feature work.

Keep the number of sub-intents minimal while ensuring each is implementable as a single write-spec-sized unit.

OUTPUT FORMAT:
Your response must be ONLY a valid JSON object matching this schema (no prose before or after):

{
  "is_split": boolean,
  "handoff_plan_summary": string,
  "handoff_intents": [
    {
      "id": string,
      "title": string,
      "intent": string,
      "in_scope": [string],
      "out_of_scope": [string],
      "acceptance_criteria": [string],
      "dependencies": [string]
    }
  ]
}

SCHEMA CONSTRAINTS:
- handoff_intents array must have length >= 1
- If handoff_intents.length == 1, then is_split must be false
- If handoff_intents.length > 1, then is_split must be true
- Each intent id should be stable (e.g., "S1", "S2", ...)
- Each intent must be self-contained and implementation-ready (no open questions)
- dependencies should reference other intent IDs within the same plan

EXAMPLE - Single Intent (no split):
{
  "is_split": false,
  "handoff_plan_summary": "Single implementation unit for adding login form validation",
  "handoff_intents": [
    {
      "id": "S1",
      "title": "Add login form validation",
      "intent": "Implement client-side validation for the login form including email format and password length requirements",
      "in_scope": ["Email format validation", "Password length check", "Error message display"],
      "out_of_scope": ["Server-side validation", "Password strength meter"],
      "acceptance_criteria": ["Email input shows error for invalid format", "Password shows error if less than 8 characters"],
      "dependencies": []
    }
  ]
}

EXAMPLE - Multiple Intents (split):
{
  "is_split": true,
  "handoff_plan_summary": "This will be implemented as 2 sub-specs: Backend API, Frontend UI",
  "handoff_intents": [
    {
      "id": "S1",
      "title": "Backend authentication API",
      "intent": "Create REST endpoint for user authentication with JWT token generation",
      "in_scope": ["POST /auth/login endpoint", "JWT token generation", "Error responses"],
      "out_of_scope": ["OAuth integration", "Password reset"],
      "acceptance_criteria": ["Returns JWT on successful login", "Returns 401 on invalid credentials"],
      "dependencies": []
    },
    {
      "id": "S2",
      "title": "Frontend login UI",
      "intent": "Create login form component that submits to the authentication API",
      "in_scope": ["Login form component", "API integration", "Error handling UI"],
      "out_of_scope": ["Remember me functionality", "Social login buttons"],
      "acceptance_criteria": ["Form submits credentials to API", "Displays errors from API"],
      "dependencies": ["S1"]
    }
  ]
}

RULES - DO NOT VIOLATE:
1. Output ONLY the JSON object - no prose, explanation, or text before or after
2. DO NOT include markdown code blocks - just raw JSON
3. DO NOT execute commands or modify code
4. DO NOT call MCP tools or any external tools
5. DO NOT make up information about the architecture
6. The JSON must be valid and parseable
7. Ensure all required fields are present in each intent
8. Ground your plan in the conversation history and provided context

Remember: Your entire response must be a single valid JSON object. No introduction, no explanation, no conclusion.`;

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
 * Builds the Handoff Planning system prompt with injected context.
 * Used when mode is "implement_feature" and phase is "handoff".
 *
 * Spec 2026-01-14: Implement Assistant Stage 6a - Sub-Spec Planning and Handoff Plan Preview
 *
 * @param context - Chat context containing work item and architecture context
 * @param resolvedContext - Optional resolved implement context from backend API
 * @returns Handoff Planning system prompt string
 */
export function buildHandoffPlanningPrompt(
  context: ChatContext,
  resolvedContext?: ResolvedImplementContextDto | null
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

  // Format resolved context as compact JSON if present
  const resolvedContextStr = formatResolvedContext(resolvedContext);

  // Replace placeholders
  return IMPLEMENT_HANDOFF_PLANNING_PROMPT_TEMPLATE
    .replace('{workItemTitle}', workItemTitle)
    .replace('{workItemType}', workItemType)
    .replace('{workItemDescription}', workItemDescription)
    .replace('{entityIds}', entityIds)
    .replace('{diagramIds}', diagramIds)
    .replace('{resolvedContext}', resolvedContextStr);
}
