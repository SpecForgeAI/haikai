/**
 * Holistic Test Planning Prompt Template
 *
 * System prompt for the test_planning_holistic phase of implement_feature mode
 * AND for the headless holistic-review handler (Spec 2026-06-14 Holistic
 * Integration/E2E TEST Work Items).
 *
 * Instructs the LLM (as Test Engineer) to review ALL of a node's immediate
 * children's specs together and define cross-cutting INTEGRATION and END-TO-END
 * tests.
 *
 * The review runs at one of two LEVELS (Spec 2026-06-14):
 *   - FEATURE level: review the feature's STORIES' specs.
 *   - EPIC level:    review the epic's FEATURES' specs.
 * The generalization is purely textual -- the prompt nouns become
 * level-relative ("a {feature|epic} and all its {stories|features}") and the
 * per-spec heading becomes `### {Story|Feature} N`. The `StorySpecSummary[]`
 * input shape is unchanged; at EPIC level the array elements are the epic's
 * FEATURES' specs instead of a feature's STORIES' specs ("review the immediate
 * children's specs").
 *
 * This runs after the immediate children have been refined (per-story PM -> TE,
 * or per-feature holistic review). The per-child TE phase handles
 * unit/functional tests; this holistic phase handles cross-child integration
 * and E2E tests.
 */

import { ChatContext } from '../types';

/**
 * The level the holistic review runs at.
 *   - `feature`: the node is a FEATURE; its immediate children are STORIES.
 *   - `epic`:    the node is an EPIC; its immediate children are FEATURES.
 */
export type HolisticReviewLevel = 'feature' | 'epic';

/** Level-relative noun bundle injected into the prompt template + headings. */
interface LevelNouns {
  /** The node noun, lowercase singular: "feature" | "epic". */
  node: string;
  /** The child noun, lowercase singular: "story" | "feature". */
  child: string;
  /** The child noun, lowercase plural: "stories" | "features". */
  childPlural: string;
  /** The child noun, Title-cased singular for headings: "Story" | "Feature". */
  childTitle: string;
}

/**
 * Resolve the level-relative nouns. FEATURE level reviews STORIES; EPIC level
 * reviews FEATURES. Defaults to FEATURE level (the original behaviour) so
 * existing callers that do not pass a level keep working verbatim.
 */
function nounsForLevel(level: HolisticReviewLevel): LevelNouns {
  if (level === 'epic') {
    return { node: 'epic', child: 'feature', childPlural: 'features', childTitle: 'Feature' };
  }
  return { node: 'feature', child: 'story', childPlural: 'stories', childTitle: 'Story' };
}

/**
 * Story spec summary passed into the holistic review prompt. The name is
 * retained for backward-compatibility (Spec 1's consumers reference it); at
 * EPIC level each entry summarises a FEATURE's spec rather than a STORY's.
 */
export interface StorySpecSummary {
  storyTitle: string;
  featureUnderstanding?: string;
  scopeIn?: string[];
  scopeOut?: string[];
  acceptanceCriteria?: string[];
  implementationPlan?: string;
  testPlan?: Array<{ title: string; description: string; type: string }>;
  /**
   * D6 (2026-06-14): TRUE when this child is OPERATIONAL / non-API (recognised
   * via the `provenance` marker + the operational marker -- `source_capability_id`
   * present and/or `kind=operational`). Operational work has no API surface, so
   * reconciliation cannot diff it; when any reviewed child is operational the
   * prompt steers the reviewer toward EFFECT-asserting tests (run the pipeline ->
   * assert DB / message / snapshot). Absent/false for ordinary API stories.
   */
  operational?: boolean;
}

/**
 * Holistic Test Planning system prompt template.
 * Used when mode is "implement_feature" and phase is "test_planning_holistic",
 * AND by the headless holistic-review handler (Spec 2026-06-14).
 *
 * Level-relative tokens (replaced by {@link buildHolisticTestPlanningPrompt}):
 *   {nodeNoun}        -> "feature" | "epic"
 *   {childPlural}     -> "stories" | "features"
 *   {childNoun}       -> "story" | "feature"
 *   {nodeNounTitle}   -> "FEATURE" | "EPIC" (section header)
 *   {childPluralTitle}-> "STORY" | "FEATURE" (section header for the spec block)
 *   {nodeArticle}      -> "a" | "an" (article matching the node noun)
 */
export const IMPLEMENT_HOLISTIC_TEST_PLANNING_PROMPT_TEMPLATE = `You are a Test Engineer performing a holistic review of {nodeArticle} {nodeNoun} and all its {childPlural}.

## {nodeNounTitle} CONTEXT
{nodeNounTitle_cap}: {featureTitle}
Description: {featureDescription}

## ALL {childPluralTitle} SPECS
The following {childPlural} have been individually refined. Each {childNoun} has its own spec and unit/functional test plan.

{storySpecsBlock}

## PROJECT TEST STRATEGY
{testStrategy}

## YOUR TASK
You have already reviewed each {childNoun} individually and defined unit and functional tests for each.
Now review ALL {childPlural} together at the {nodeNoun} level. Your job is to identify:

1. **Integration tests** — tests that verify the interaction between two or more {childPlural}/components that were refined separately. Look for shared data flows, API contracts between {childPlural}, event chains, and state dependencies.

2. **End-to-end (E2E) tests** — tests that verify complete user journeys that span multiple {childPlural}. These should validate that the {nodeNoun} works as a whole from the user's perspective.

3. **Cross-cutting concerns** — tests for error handling across {childNoun} boundaries, data consistency, performance under combined load, security at integration points.
{operationalSteering}
Do NOT repeat unit or functional tests already defined per {childNoun}. Focus exclusively on what emerges from the combination of {childPlural}.

## RESPONSE FORMAT
You MUST respond with VALID JSON ONLY. No markdown, no prose outside the JSON structure.

\`\`\`json
{
  "schemaVersion": "1.0",
  "message": "Brief summary of holistic test review findings",
  "testPlan": [
    {
      "title": "Integration/E2E test title",
      "description": "What this test verifies and which {childPlural} it spans",
      "type": "integration"
    },
    {
      "title": "Integration/E2E test title",
      "description": "What this test verifies",
      "type": "e2e"
    }
  ],
  "openQuestions": []
}
\`\`\`

## RULES
1. Respond with ONLY valid JSON — no markdown fences, no commentary outside the JSON
2. "testPlan" must be an array (may be empty if no cross-{childNoun} tests are needed)
3. Each test object must have "title" (string), "description" (string), and "type" (string)
4. "type" must be "integration" or "e2e" — do NOT use "unit" or "functional"
5. In "description", reference which {childPlural} are involved
6. "openQuestions" should contain any ambiguities about {childNoun} interactions
7. "schemaVersion" must be "1.0"
8. "message" should summarize whether integration/E2E tests are needed and why
9. If no cross-{childNoun} tests are warranted, return an empty testPlan with a message explaining why`;

/**
 * Formats a single child spec for injection into the holistic prompt.
 * The heading is level-relative (`### Story N` at FEATURE level, `### Feature N`
 * at EPIC level).
 */
function formatStorySpec(
  story: StorySpecSummary,
  index: number,
  nouns: LevelNouns,
): string {
  const parts = [`### ${nouns.childTitle} ${index + 1}: ${story.storyTitle}`];

  if (story.operational) {
    // D6: flag the operational / non-API nature so the reviewer ties an effect
    // test to THIS child (reconciliation has no API surface to diff it).
    parts.push(`Nature: OPERATIONAL / non-API (verify by EFFECT — no HTTP request/response surface to reconcile).`);
  }
  if (story.featureUnderstanding) {
    parts.push(`Understanding: ${story.featureUnderstanding}`);
  }
  if (story.scopeIn?.length) {
    parts.push(`Scope In: ${story.scopeIn.join(', ')}`);
  }
  if (story.scopeOut?.length) {
    parts.push(`Scope Out: ${story.scopeOut.join(', ')}`);
  }
  if (story.acceptanceCriteria?.length) {
    parts.push(`Acceptance Criteria:\n${story.acceptanceCriteria.map(ac => `  - ${ac}`).join('\n')}`);
  }
  if (story.implementationPlan) {
    parts.push(`Implementation Plan: ${story.implementationPlan}`);
  }
  if (story.testPlan?.length) {
    parts.push(`Unit/Functional Tests:\n${story.testPlan.map(t => `  - [${t.type}] ${t.title}: ${t.description}`).join('\n')}`);
  }

  return parts.join('\n');
}

/**
 * Builds the Holistic Test Planning system prompt with injected context.
 *
 * @param context - Chat context containing work item information (the feature/epic node)
 * @param storySpecs - Array of immediate-children spec summaries (stories at FEATURE level, features at EPIC level)
 * @param testStrategy - Content of the project's TEST-STRATEGY.MD file
 * @param level - The review level ('feature' reviews stories; 'epic' reviews features). Defaults to 'feature'.
 * @returns Holistic Test Planning system prompt string
 */
export function buildHolisticTestPlanningPrompt(
  context: ChatContext,
  storySpecs: StorySpecSummary[],
  testStrategy: string | null,
  level: HolisticReviewLevel = 'feature',
): string {
  const nouns = nounsForLevel(level);
  const featureTitle = context.workItem?.title || 'not provided';
  const featureDescription = context.workItem?.description || 'not provided';

  const storySpecsBlock = storySpecs.length > 0
    ? storySpecs.map((spec, i) => formatStorySpec(spec, i, nouns)).join('\n\n')
    : `No ${nouns.child} specs available.`;

  // D6: when ANY reviewed child is operational / non-API, steer the reviewer to
  // emit EFFECT-asserting tests. Operational / batch work has NO HTTP surface, so
  // the API-only reconciliation diff can neither confirm nor deny it -- the ONLY
  // way to verify it is to run the pipeline and assert the downstream effect.
  const hasOperationalChild = storySpecs.some((s) => s.operational === true);
  const operationalSteering = hasOperationalChild
    ? `
## EFFECT-ASSERTING TESTS (operational / non-API ${nouns.childPlural})
One or more of the ${nouns.childPlural} above are OPERATIONAL / non-API (flagged "Nature: OPERATIONAL / non-API"). Operational / batch work has NO HTTP request/response surface, so the API-only reconciliation cannot diff it -- effect tests are the ONLY way to verify it was delivered correctly.
For those ${nouns.childPlural}, the integration/E2E tests you define MUST assert by EFFECT rather than by HTTP request/response:
- RUN THE PIPELINE / trigger the operational job, then ASSERT the downstream outcome.
- Assert concrete effects: rows written/updated in the expected DATABASE TABLES, the expected DOWNSTREAM MESSAGE published, and/or a SNAPSHOT of the produced output (file/report/extract).
- Do NOT assert an HTTP status/body for an operational ${nouns.child} (it has none); assert the persisted/emitted state the run produces.
Tests for ordinary API ${nouns.childPlural} stay request/response oriented as usual. The "type" stays "integration" or "e2e" either way.
`
    : '';

  // Section-header casings. The node noun is uppercased for the "## FEATURE
  // CONTEXT" / "## EPIC CONTEXT" header and Title-cased for the inline label.
  const nodeNounTitle = nouns.node.toUpperCase();
  const nodeNounTitleCap = nouns.node.charAt(0).toUpperCase() + nouns.node.slice(1);
  const childPluralTitle = nouns.childPlural.toUpperCase();
  // Article matching the node noun ("a feature" / "an epic").
  const nodeArticle = /^[aeiou]/i.test(nouns.node) ? 'an' : 'a';

  return IMPLEMENT_HOLISTIC_TEST_PLANNING_PROMPT_TEMPLATE
    .split('{nodeArticle}').join(nodeArticle)
    .split('{nodeNounTitle_cap}').join(nodeNounTitleCap)
    .split('{nodeNounTitle}').join(nodeNounTitle)
    .split('{childPluralTitle}').join(childPluralTitle)
    .split('{nodeNoun}').join(nouns.node)
    .split('{childPlural}').join(nouns.childPlural)
    .split('{childNoun}').join(nouns.child)
    .replace('{featureTitle}', featureTitle)
    .replace('{featureDescription}', featureDescription)
    .replace('{storySpecsBlock}', storySpecsBlock)
    .replace('{operationalSteering}', operationalSteering)
    .replace('{testStrategy}', testStrategy || 'No test strategy document available.');
}
