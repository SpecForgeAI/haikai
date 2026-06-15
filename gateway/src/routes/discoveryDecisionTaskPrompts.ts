/**
 * Prompt Template Loader and Interpolation for Discovery DecisionTasks
 *
 * Reads prompt template files from gateway/src/config/prompts/,
 * interpolates task-specific variables, and builds the message array
 * for sendChatRequest().
 *
 * Spec 2026-04-05: Phase 1b Linker and DecisionTask Engine
 * Task Group 8.3: Prompt Template Loader Utility
 *
 * Dead code from former Phase 1c (Clustering) and Phase 1d (Candidate Generation)
 * removed as part of Spec 2026-04-07, Task Group 12.
 *
 * V2 LLM file-analysis helpers (`DEFAULT_CANDIDATE_TYPES`,
 * `SERVICE_SCOPED_CANDIDATE_TYPES`, `loadFileAnalysisPromptTemplate`,
 * `interpolateFileAnalysis`, `buildMessagesForFileAnalysis`, `FileAnalysisInput`)
 * were removed 2026-04-20 together with the V2 `/analyze-files` endpoint.
 * The V3 pipeline composes prompts in discovery-service and relays them via
 * the stateless `/api/v1/discovery/v3/gap-fill` route.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { OpenAIMessage } from '../services/openaiClient';

// ============================================================================
// Type Alias
// ============================================================================

/**
 * All supported DecisionTask type strings.
 *
 * Phase 1b types:
 *   - confirm_relationship
 *   - resolve_competing_relationships
 */
export type DecisionTaskTypeString =
  | 'confirm_relationship'
  | 'resolve_competing_relationships';

// ============================================================================
// Constants
// ============================================================================

/** Map from task type to prompt template filename */
const PROMPT_TEMPLATE_FILES: Record<string, string> = {
  'confirm_relationship': 'discovery.confirm-relationship.prompt.md',
  'resolve_competing_relationships': 'discovery.resolve-competing-relationships.prompt.md',
};

/** Base directory for prompt template files */
const PROMPTS_DIR = path.resolve(__dirname, '..', 'config', 'prompts');

// ============================================================================
// Template Loading
// ============================================================================

/**
 * Load the prompt template file for a given task type.
 *
 * @param taskType - The DecisionTask type
 * @returns The raw template string
 * @throws Error if the task type is unknown or the file cannot be read
 */
export async function loadPromptTemplate(
  taskType: DecisionTaskTypeString
): Promise<string> {
  const filename = PROMPT_TEMPLATE_FILES[taskType];
  if (!filename) {
    throw new Error(`Unknown DecisionTask type: ${taskType}`);
  }

  const filePath = path.join(PROMPTS_DIR, filename);
  return fs.readFile(filePath, 'utf-8');
}

// ============================================================================
// Template Interpolation
// ============================================================================

/**
 * Interpolate task input data variables into the prompt template.
 *
 * For confirm_relationship tasks:
 *   - {{SOURCE_ATOM_TYPE}}, {{SOURCE_ATOM_FILE_PATH}}, {{SOURCE_ATOM_DATA}}
 *   - {{TARGET_ATOM_TYPE}}, {{TARGET_ATOM_FILE_PATH}}, {{TARGET_ATOM_DATA}}
 *   - {{RELATIONSHIP_TYPE}}, {{CONFIDENCE}}, {{RULE_ID}}
 *
 * For resolve_competing_relationships tasks:
 *   - {{SOURCE_ATOM_TYPE}}, {{SOURCE_ATOM_FILE_PATH}}, {{SOURCE_ATOM_DATA}}
 *   - {{COMPETING_TARGETS}} (formatted list of competing targets)
 *
 * @param template - The raw prompt template string
 * @param taskType - The DecisionTask type
 * @param inputData - The task's inputData object
 * @returns The interpolated prompt string
 */
export function interpolateTemplate(
  template: string,
  taskType: DecisionTaskTypeString,
  inputData: Record<string, unknown>
): string {
  let result = template;

  if (taskType === 'confirm_relationship') {
    const sourceAtom = inputData.sourceAtom as Record<string, unknown> | undefined;
    const targetAtom = inputData.targetAtom as Record<string, unknown> | undefined;
    const sourceData = sourceAtom?.data as Record<string, unknown> | undefined;
    const targetData = targetAtom?.data as Record<string, unknown> | undefined;

    result = result
      .replace(/\{\{SOURCE_ATOM_TYPE\}\}/g, String(sourceAtom?.type || 'unknown'))
      .replace(/\{\{SOURCE_ATOM_FILE_PATH\}\}/g, String((sourceData as any)?.relativePath || (sourceData as any)?.filePath || 'unknown'))
      .replace(/\{\{SOURCE_ATOM_DATA\}\}/g, JSON.stringify(sourceData || {}, null, 2))
      .replace(/\{\{TARGET_ATOM_TYPE\}\}/g, String(targetAtom?.type || 'unknown'))
      .replace(/\{\{TARGET_ATOM_FILE_PATH\}\}/g, String((targetData as any)?.relativePath || (targetData as any)?.filePath || 'unknown'))
      .replace(/\{\{TARGET_ATOM_DATA\}\}/g, JSON.stringify(targetData || {}, null, 2))
      .replace(/\{\{RELATIONSHIP_TYPE\}\}/g, String(inputData.proposedRelationshipType || 'unknown'))
      .replace(/\{\{CONFIDENCE\}\}/g, String(inputData.confidence || 0))
      .replace(/\{\{RULE_ID\}\}/g, String(inputData.ruleId || 'unknown'));
  } else if (taskType === 'resolve_competing_relationships') {
    const sourceAtom = inputData.sourceAtom as Record<string, unknown> | undefined;
    const sourceData = sourceAtom?.data as Record<string, unknown> | undefined;
    const competitors = inputData.competitors as Array<Record<string, unknown>> | undefined;

    result = result
      .replace(/\{\{SOURCE_ATOM_TYPE\}\}/g, String(sourceAtom?.type || 'unknown'))
      .replace(/\{\{SOURCE_ATOM_FILE_PATH\}\}/g, String((sourceData as any)?.relativePath || (sourceData as any)?.filePath || 'unknown'))
      .replace(/\{\{SOURCE_ATOM_DATA\}\}/g, JSON.stringify(sourceData || {}, null, 2));

    // Build the competing targets section
    const competingTargetsText = buildCompetingTargetsSection(competitors || []);
    result = result.replace(/\{\{COMPETING_TARGETS\}\}/g, competingTargetsText);
  }

  return result;
}

// ============================================================================
// 1b Interpolation Helpers
// ============================================================================

/**
 * Build a formatted text section describing competing targets for the
 * resolve_competing_relationships prompt.
 *
 * @param competitors - Array of competing target objects
 * @returns Formatted markdown section for competing targets
 */
function buildCompetingTargetsSection(competitors: Array<Record<string, unknown>>): string {
  if (competitors.length === 0) {
    return '*No competing targets provided.*';
  }

  return competitors.map((competitor, index) => {
    const targetAtom = competitor.targetAtom as Record<string, unknown> | undefined;
    const targetData = targetAtom?.data as Record<string, unknown> | undefined;

    return [
      `### Target ${index} (Index: ${index})`,
      '',
      `- **Type:** ${String(targetAtom?.type || 'unknown')}`,
      `- **File Path:** ${String((targetData as any)?.relativePath || (targetData as any)?.filePath || 'unknown')}`,
      `- **Relationship Type:** ${String(competitor.relationshipType || 'unknown')}`,
      `- **Confidence:** ${String(competitor.confidence || 0)}`,
      `- **Rule ID:** ${String(competitor.ruleId || 'unknown')}`,
      `- **Data:**`,
      '```json',
      JSON.stringify(targetData || {}, null, 2),
      '```',
    ].join('\n');
  }).join('\n\n');
}

// ============================================================================
// Message Builder
// ============================================================================

/**
 * Build the full message array for sendChatRequest().
 *
 * Uses the interpolated prompt template as the system message and
 * constructs a user message with the specific task data.
 *
 * @param interpolatedPrompt - The interpolated system prompt
 * @param taskType - The DecisionTask type
 * @param inputData - The task's inputData object
 * @returns Array of OpenAI messages ready for sendChatRequest()
 */
export function buildMessagesForTask(
  interpolatedPrompt: string,
  taskType: DecisionTaskTypeString,
  inputData: Record<string, unknown>
): OpenAIMessage[] {
  const messages: OpenAIMessage[] = [
    {
      role: 'system',
      content: interpolatedPrompt,
    },
    {
      role: 'user',
      content: buildUserMessage(taskType, inputData),
    },
  ];

  return messages;
}

/**
 * Build a user message summarizing the task to be resolved.
 *
 * @param taskType - The DecisionTask type
 * @param inputData - The task's inputData object
 * @returns The user message string
 */
function buildUserMessage(
  taskType: DecisionTaskTypeString,
  inputData: Record<string, unknown>
): string {
  if (taskType === 'confirm_relationship') {
    return `Please evaluate the proposed ${inputData.proposedRelationshipType || 'unknown'} relationship described above and return your decision as valid JSON.`;
  }

  if (taskType === 'resolve_competing_relationships') {
    const competitors = inputData.competitors as Array<Record<string, unknown>> | undefined;
    return `Please evaluate the ${competitors?.length || 0} competing relationship targets described above and select the best match, or reject all if none are convincing. Return your decision as valid JSON.`;
  }

  return 'Please evaluate the task described above and return your decision as valid JSON.';
}
