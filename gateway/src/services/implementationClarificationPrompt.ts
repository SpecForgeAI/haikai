/**
 * Implementation Clarification (Software Architect) System Prompt Builder
 *
 * This module builds the system prompt for the Software Architect (SA) persona
 * during the implementation_clarification phase. The SA reviews an increment's
 * proposedFinalSubFeatureDefinition and asks technical clarifying questions.
 *
 * Spec 2026-01-23: SA Handoff Per Increment
 * Task Group 3: Create Software Architect System Prompt Template
 */

import type {
  Increment,
  ChatContext,
  ResolvedImplementContextDto,
  ResolvedEntitySummary,
  ResolvedDiagramSummary,
} from '../types/chat';
import { logger } from './logger';

/**
 * Builds the system prompt for the Software Architect implementation clarification phase.
 *
 * The prompt instructs the LLM to act as a Software Architect reviewing an increment
 * before implementation. The SA should ask technical clarifying questions about
 * implementation details, edge cases, error handling, etc.
 *
 * @param increment - The increment being clarified with its proposedFinalSubFeatureDefinition
 * @param context - Chat context containing work item and architecture context
 * @param resolvedContext - Optional resolved entity and diagram summaries
 * @returns The complete system prompt for the SA clarification phase
 */
export function buildImplementationClarificationPrompt(
  increment: Increment,
  context: ChatContext,
  resolvedContext: ResolvedImplementContextDto | null
): string {
  logger.debug('[SA Prompt] Building implementation clarification prompt for increment', {
    incrementId: increment.id,
    incrementTitle: increment.title,
    hasResolvedContext: !!resolvedContext,
  });

  const sections: string[] = [];

  // ==========================================================================
  // Section 1: SA Persona and Role Definition
  // ==========================================================================
  sections.push(`You are a Software Architect (SA) reviewing an implementation increment before it is handed off to a developer agent.

Your role is to:
1. Understand the increment's specification thoroughly
2. Identify any ambiguities, missing details, or potential technical issues
3. Ask clarifying questions about implementation specifics
4. Help ensure the increment specification is clear enough for implementation

You are NOT implementing the increment - you are reviewing it and asking questions to ensure clarity.`);

  // ==========================================================================
  // Section 2: Work Item Context (Parent Feature)
  // ==========================================================================
  if (context.workItem) {
    sections.push(`## PARENT WORK ITEM

**Title:** ${context.workItem.title}
**Type:** ${context.workItem.type}
**ID:** ${context.workItem.id}

**Description:**
${context.workItem.description || '(No description provided)'}`);
  }

  // ==========================================================================
  // Section 3: Increment Specification (Primary Context)
  // ==========================================================================
  sections.push(`## CURRENT INCREMENT TO REVIEW

**Increment ID:** ${increment.id}
**Increment Title:** ${increment.title}

### Implementation Specification:

${increment.intent}`);

  // ==========================================================================
  // Section 4: Architecture Context (if available)
  // ==========================================================================
  if (resolvedContext) {
    const archContextSection = buildArchitectureContextSection(resolvedContext);
    if (archContextSection) {
      sections.push(archContextSection);
    }
  }

  // ==========================================================================
  // Section 5: Output Format Instructions
  // ==========================================================================
  sections.push(`## OUTPUT FORMAT

You MUST respond with valid JSON in the following format:

\`\`\`json
{
  "schemaVersion": "1.0",
  "message": "Your conversational message explaining your understanding and questions",
  "openQuestions": [
    { "id": "placeholder", "question": "Your first clarifying question?" },
    { "id": "placeholder", "question": "Your second clarifying question?" }
  ]
}
\`\`\`

### Field Descriptions:

- **schemaVersion**: Always "1.0"
- **message**: A conversational explanation for the user. Summarize what you understand and why you need clarification.
- **openQuestions**: An array of technical clarifying questions. Each has:
  - **id**: Use "placeholder" (will be assigned a UUID by the system)
  - **question**: A specific, technical question about implementation details

### Question Guidelines:

Ask questions about:
- **Implementation specifics**: Exact behavior, algorithms, data structures
- **Edge cases**: Error handling, boundary conditions, failure scenarios
- **Integration points**: How this increment connects to other components
- **Performance/security**: Non-functional requirements that may affect implementation
- **Dependencies**: External services, libraries, or components needed
- **Testing requirements**: How the implementation should be verified

DO NOT ask questions about:
- Business requirements already answered by the specification
- High-level architecture decisions already made
- Scope questions (what to include/exclude) - that was decided by the Product Owner

If you have NO questions and the specification is clear enough for implementation, respond with an empty openQuestions array:

\`\`\`json
{
  "schemaVersion": "1.0",
  "message": "The specification is clear and ready for implementation. [brief summary of what you understand]",
  "openQuestions": []
}
\`\`\``);

  // ==========================================================================
  // Section 6: Initial Review Instructions
  // ==========================================================================
  sections.push(`## YOUR TASK

Review the increment specification above and:
1. If this is the first message, introduce yourself as the Software Architect and acknowledge what you're reviewing
2. Ask technical clarifying questions to ensure the specification is implementable
3. Focus on implementation details, not business requirements

Remember: The goal is to ensure the developer agent has enough detail to implement this increment correctly. Ask specific, actionable questions.`);

  return sections.join('\n\n');
}

/**
 * Builds the architecture context section from resolved entities and diagrams.
 */
function buildArchitectureContextSection(
  resolvedContext: ResolvedImplementContextDto
): string | null {
  const parts: string[] = [];

  if (resolvedContext.resolved_entities.length > 0) {
    parts.push('### Relevant Entities:\n');
    parts.push(formatEntitySummaries(resolvedContext.resolved_entities));
  }

  if (resolvedContext.resolved_diagrams.length > 0) {
    parts.push('\n### Relevant Diagrams:\n');
    parts.push(formatDiagramSummaries(resolvedContext.resolved_diagrams));
  }

  if (parts.length === 0) {
    return null;
  }

  return `## ARCHITECTURE CONTEXT\n\n${parts.join('\n')}`;
}

/**
 * Formats resolved entity summaries for the prompt.
 */
function formatEntitySummaries(entities: ResolvedEntitySummary[]): string {
  return entities
    .map((entity) => {
      const fields = Object.entries(entity.relevant_fields || {})
        .map(([key, value]) => `  - ${key}: ${value}`)
        .join('\n');

      return `- **${entity.name}** (${entity.entity_type})
  Category: ${entity.category}${fields ? '\n' + fields : ''}`;
    })
    .join('\n');
}

/**
 * Formats resolved diagram summaries for the prompt.
 */
function formatDiagramSummaries(diagrams: ResolvedDiagramSummary[]): string {
  return diagrams
    .map((diagram) => {
      const referencedNames = diagram.referenced_entity_names?.length
        ? ` (references: ${diagram.referenced_entity_names.join(', ')})`
        : '';

      return `- **${diagram.name}** (${diagram.diagram_type})${referencedNames}`;
    })
    .join('\n');
}
