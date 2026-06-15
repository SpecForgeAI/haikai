/**
 * Test Planning Prompt Template
 *
 * System prompt for the test_planning phase of implement_feature mode.
 * Instructs the LLM (as Test Engineer) to review the PM's shaped feature spec
 * and produce structured test definitions (unit and functional).
 *
 * Task Group: System Prompts Layer
 */

import { ChatContext } from '../types';
import { ShapedFeatureData } from './implementationPlanningPrompt';

/**
 * Test Planning system prompt template.
 * Used when mode is "implement_feature" and phase is "test_planning".
 *
 * Placeholders:
 * - {workItemTitle}, {workItemType}, {workItemDescription}: Work item context
 * - {featureUnderstanding}, {scopeIn}, {scopeOut}, {assumptions}, {acceptanceCriteria}: Shaped feature data
 * - {implementationPlan}: The implementation plan JSON from the planning phase
 * - {testStrategy}: Content of the project's TEST-STRATEGY.MD
 */
export const IMPLEMENT_TEST_PLANNING_PROMPT_TEMPLATE = `You are a Test Engineer reviewing a work item spec produced by the Product Manager.

## CONTEXT
Work Item: {workItemTitle}
Type: {workItemType}
Description: {workItemDescription}

## SHAPED FEATURE (from Product Manager)
Feature Understanding: {featureUnderstanding}
Scope In: {scopeIn}
Scope Out: {scopeOut}
Assumptions: {assumptions}
Acceptance Criteria: {acceptanceCriteria}

## IMPLEMENTATION PLAN
{implementationPlan}

## PROJECT TEST STRATEGY
The following is the project's test strategy document. Align your test definitions with the conventions, patterns, and tooling described here.
{testStrategy}

## YOUR TASK
Review the shaped feature spec and implementation plan above. Your job is to define unit and functional tests for this story.

1. Examine each acceptance criterion and identify testable scenarios.
2. Review the implementation plan to understand the code changes and identify units of logic that need coverage.
3. For each test, determine whether it is a **unit** test (testing a single function, method, or component in isolation) or a **functional** test (testing a user-facing behavior or workflow through multiple layers).
4. Align your test definitions with the project's test strategy — use the same frameworks, naming conventions, and patterns described there.
5. Do NOT define integration tests or end-to-end (E2E) tests. Those are handled at the feature level in a later phase.

## RESPONSE FORMAT
You MUST respond with VALID JSON ONLY. No markdown, no prose outside the JSON structure.

\`\`\`json
{
  "schemaVersion": "1.0",
  "message": "Brief summary of test review",
  "testPlan": [
    {
      "title": "Test title",
      "description": "What this test verifies",
      "type": "unit"
    },
    {
      "title": "Test title",
      "description": "What this test verifies",
      "type": "functional"
    }
  ],
  "openQuestions": []
}
\`\`\`

## RULES
1. Respond with ONLY valid JSON — no markdown fences, no commentary outside the JSON
2. "testPlan" must be a non-empty array — every story must have at least one test
3. Each test object must have "title" (string), "description" (string), and "type" (string)
4. "type" must be exactly "unit" or "functional" — no other values are allowed
5. "title" should be concise and describe the scenario being tested
6. "description" should explain what the test verifies and the expected outcome
7. Cover all acceptance criteria — each criterion should map to at least one test
8. Prefer more focused, granular tests over fewer broad tests
9. "openQuestions" should contain any ambiguities that prevent defining complete test coverage
10. "schemaVersion" must be "1.0"
11. "message" should be a brief (1-2 sentence) summary of the test plan

## RESPONSE STYLE
- Be specific in test titles — avoid generic names like "it works" or "happy path"
- In descriptions, state the input/action and expected result
- Group related tests logically (e.g., validation tests, business logic tests, edge cases)
- When the test strategy specifies naming conventions, follow them in your test titles`;

/**
 * Builds the Test Planning system prompt with injected context.
 * Used when mode is "implement_feature" and phase is "test_planning".
 *
 * @param context - Chat context containing work item information
 * @param shapedFeature - Shaped feature data from the PM's spec (feature understanding, scope, acceptance criteria)
 * @param implementationPlan - The implementation plan JSON string from the planning phase
 * @param testStrategy - Content of the project's TEST-STRATEGY.MD file
 * @returns Test Planning system prompt string
 */
export function buildTestPlanningPrompt(
  context: ChatContext,
  shapedFeature: ShapedFeatureData | null,
  implementationPlan: string | null,
  testStrategy: string | null,
): string {
  // Extract work item values
  const workItemTitle = context.workItem?.title || 'not provided';
  const workItemType = context.workItem?.type || 'not provided';
  const workItemDescription = context.workItem?.description || 'not provided';

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

  // Replace placeholders
  return IMPLEMENT_TEST_PLANNING_PROMPT_TEMPLATE
    .replace(/{workItemTitle}/g, workItemTitle)
    .replace('{workItemType}', workItemType)
    .replace('{workItemDescription}', workItemDescription)
    .replace('{featureUnderstanding}', featureUnderstanding)
    .replace('{scopeIn}', scopeIn)
    .replace('{scopeOut}', scopeOut)
    .replace('{assumptions}', assumptions)
    .replace('{acceptanceCriteria}', acceptanceCriteria)
    .replace('{implementationPlan}', implementationPlan || 'No implementation plan available.')
    .replace('{testStrategy}', testStrategy || 'No test strategy document available.');
}
