/**
 * Implementation-Ready Migration Spec Generation -- screen-state mapping.
 *
 * Spec: 2026-06-14 Implementation-Ready Migration Spec Generation (Spec 1 of 4)
 * Task Group 2 (inline Test Pack rendering) + Task Group 3 (PlannerResponse /
 * TestPlannerResponse / PersistedImplementationState construction + the
 * implement-state PUT contract).
 *
 * Why this lives here, not in the frontend serializer:
 *   `frontend/src/utils/implementStateSerializer.ts` (`serializeImplementState`)
 *   depends on in-memory React Maps/Dates and is NOT importable into the
 *   gateway. This module constructs the EQUIVALENT JSON literal directly --
 *   the same field shape `serializeImplementState` emits (schemaVersion 1) --
 *   so the implement panel's deserializer (`deserializeImplementState`)
 *   hydrates cleanly with NO panel re-plumbing (D1/D2/D8).
 *
 * "Ready to implement" is exactly (D4):
 *   plannerReadyForSpec=true + empty openQuestions + populated testPlan +
 *   hasTestPlan=true.
 * NO new ready flag, NO `implementation_mode` gate.
 *
 * The structured `tests` array (validated as
 * `{ title, description, type: 'unit' | 'functional' }` -- D6) maps 1:1 to the
 * Test Engineer `TestDefinition` shape so it populates
 * `latestTestPlannerResponse.testPlan` directly.
 */

import { StructuredTest } from './specGenerationResponseValidator';
import type { GeneratedShapeSpecResponseA } from './specGenerationResponseValidator';

// ---------------------------------------------------------------------------
// Mirror of the render-driving frontend shapes (gateway-local, no import).
// ---------------------------------------------------------------------------

/** Mirror of the frontend OpenQuestion shape (chatApi.ts). */
export interface OpenQuestionLiteral {
  id: string;
  question: string;
}

/** Mirror of the frontend PlannerResponse shape (chatApi.ts). */
export interface PlannerResponseLiteral {
  schemaVersion: '1.1';
  message: string;
  featureUnderstanding: string;
  scope: { in: string[]; out: string[] };
  assumptions: string[];
  acceptanceCriteria: string[];
  openQuestions: OpenQuestionLiteral[];
  plannerReadyForSpec: boolean;
  implementationPlan: null;
}

/**
 * Mirror of the frontend TestDefinition shape (chatApi.ts). The frontend union
 * is `'unit' | 'functional' | 'integration' | 'e2e'`; Spec 1's per-story
 * generator only ever emits `unit` / `functional`, while the Spec 2 holistic
 * TEST-item flow (2026-06-14 Holistic Integration/E2E TEST Work Items) emits
 * `integration` / `e2e`. The union mirrors the real frontend contract so both
 * flows hydrate the implement screen's Test Pack uniformly.
 */
export interface TestDefinitionLiteral {
  title: string;
  description: string;
  type: 'unit' | 'functional' | 'integration' | 'e2e';
}

/** Mirror of the frontend TestPlannerResponse shape (chatApi.ts). */
export interface TestPlannerResponseLiteral {
  schemaVersion: string;
  message: string;
  testPlan: TestDefinitionLiteral[];
  openQuestions: OpenQuestionLiteral[];
}

/**
 * Mirror of the frontend PersistedImplementationState shape emitted by
 * `serializeImplementState` (schemaVersion 1). Only the render-driving fields
 * carry real content; every other field gets a benign default so the panel
 * deserializer hydrates without errors. Plain JSON object -- NO Maps/Dates.
 */
export interface PersistedImplementStateLiteral {
  schemaVersion: 1;
  sessionId: string | null;
  latestPlannerResponse: PlannerResponseLiteral | null;
  answers: Record<string, string>;
  questionStatuses: Record<string, 'Open' | 'Answered'>;
  streamedQuestions: unknown[];
  streamedAnswers: Record<string, string>;
  latestFolder: string | null;
  incrementStatuses: Record<string, string>;
  activeIncrementId: string | null;
  prefetchedSpecs: Record<string, unknown>;
  partStatuses: Record<string, string>;
  activePartIndex: number | null;
  currentJobId: string | null;
  partTranscripts: Record<string, unknown[]>;
  hasBootstrapped: boolean;
  hasPlan: boolean;
  hasTriggeredOrchestration: boolean;
  inputDraft: string;
  messages: unknown[];
  latestTestPlannerResponse: TestPlannerResponseLiteral | null;
  hasTestPlan: boolean;
  teAnswers: Record<string, string>;
  teQuestionStatuses: Record<string, 'Open' | 'Answered'>;
  specIntentTexts: Record<string, string>;
  shapeSpecSessionId: string | null;
}

// ---------------------------------------------------------------------------
// Inline Test Pack rendering (Task Group 2.5)
// ---------------------------------------------------------------------------

/**
 * Render the structured unit/functional test pack as a human-viewable Markdown
 * section. Appended INLINE into `generated_spec_text` (D3) so the canonical
 * combined "view spec" body includes the tests. The `/agent-os:shape-spec`
 * prefix is NOT touched -- this only appends a trailing section.
 *
 * Returns an empty string when there are no tests (defensive; the prompt
 * mandates >=1, but a sparse generation should not crash the render).
 */
export function renderInlineTestPack(tests: readonly StructuredTest[]): string {
  if (!Array.isArray(tests) || tests.length === 0) return '';
  const lines: string[] = [];
  lines.push('');
  lines.push('## Test Pack (unit / functional)');
  lines.push('');
  for (const t of tests) {
    lines.push(`- [${t.type}] ${t.title}`);
    if (t.description && t.description.length > 0) {
      lines.push(`  ${t.description}`);
    }
  }
  return lines.join('\n');
}

/**
 * Append the inline Test Pack to a spec body. Idempotent-ish: only appends when
 * there are tests; never alters the leading prefix.
 */
export function appendInlineTestPack(
  specText: string,
  tests: readonly StructuredTest[]
): string {
  const section = renderInlineTestPack(tests);
  if (section.length === 0) return specText;
  // Ensure exactly one blank line between the body and the section.
  const trimmed = specText.replace(/\s+$/, '');
  return `${trimmed}\n${section}\n`;
}

// ---------------------------------------------------------------------------
// PlannerResponse / TestPlannerResponse construction (Task Group 3.2 + 3.3)
// ---------------------------------------------------------------------------

/**
 * Pull a `Heading:` ... block out of the spec body. Returns the lines that
 * follow the heading until the next blank line / next heading, stripped of any
 * leading `- ` / `* ` bullet markers. Best-effort: returns [] when the heading
 * is absent. Case-insensitive heading match.
 *
 * The migration prompt instructs the LLM to emit `Scope in:` / `Scope out:` /
 * `Acceptance criteria:` sections; this reader lifts them so the screen's
 * Feature Definition is populated even though the generator does not call the
 * PM conversation prompt at runtime.
 */
export function extractSpecSection(
  specText: string,
  headingAliases: readonly string[]
): string[] {
  if (typeof specText !== 'string' || specText.length === 0) return [];
  const lines = specText.split(/\r?\n/);
  const aliasSet = headingAliases.map((h) => h.toLowerCase());
  const out: string[] = [];
  let capturing = false;
  for (const raw of lines) {
    const line = raw.trim();
    const headingMatch = line.match(/^#{0,6}\s*([A-Za-z][^:]*):\s*(.*)$/);
    if (headingMatch) {
      const headingName = headingMatch[1].trim().toLowerCase();
      if (aliasSet.includes(headingName)) {
        capturing = true;
        // Inline content on the heading line itself (e.g. "Scope out: none").
        const inline = headingMatch[2].trim();
        if (inline.length > 0) out.push(inline);
        continue;
      }
      if (capturing) {
        // A different heading ends the captured section.
        break;
      }
    }
    if (capturing) {
      if (line.length === 0) {
        // Blank line ends the section.
        break;
      }
      const item = line.replace(/^[-*]\s+/, '').replace(/^\d+\.\s+/, '').trim();
      if (item.length > 0) out.push(item);
    }
  }
  return out;
}

/**
 * Build a ready PlannerResponse from the validated Generated response (D1, D4).
 * Sources scope-in/out + acceptance criteria from the spec body sections; falls
 * back to a single high-level entry when a section is absent so the screen
 * never renders an empty Feature Definition for a generated story.
 *
 * Hard-set for ready-to-implement:
 *   - openQuestions: []           (no follow-up conversation -- D4)
 *   - plannerReadyForSpec: true
 *   - schemaVersion: '1.1'
 *   - implementationPlan: null    (plans are an implementation-phase concern)
 *
 * `message` is a short generated summary, NOT a chat turn.
 */
export function buildPlannerResponseFromGenerated(
  generated: GeneratedShapeSpecResponseA,
  storyTitle: string
): PlannerResponseLiteral {
  const scopeIn = extractSpecSection(generated.specText, [
    'scope in',
    'scope-in',
    'in scope',
    'in-scope',
  ]);
  const scopeOut = extractSpecSection(generated.specText, [
    'scope out',
    'scope-out',
    'out of scope',
    'out-of-scope',
  ]);
  const acceptanceCriteria = extractSpecSection(generated.specText, [
    'acceptance criteria',
    'acceptance criterion',
  ]);
  const featureSummary = extractSpecSection(generated.specText, [
    'feature summary',
    'feature understanding',
    'summary',
  ]);

  const featureUnderstanding =
    featureSummary.length > 0
      ? featureSummary.join(' ')
      : `Migration story: ${storyTitle}. Implementation-ready spec generated from the focused migration context (functional like-for-like).`;

  return {
    schemaVersion: '1.1',
    message: `Generated an implementation-ready spec for "${storyTitle}" with scope, acceptance criteria, and a unit/functional test pack. Ready to implement.`,
    featureUnderstanding,
    scope: {
      in: scopeIn.length > 0 ? scopeIn : [`Implement: ${storyTitle}`],
      out: scopeOut,
    },
    assumptions: Array.isArray(generated.assumptions) ? generated.assumptions : [],
    acceptanceCriteria,
    openQuestions: [],
    plannerReadyForSpec: true,
    implementationPlan: null,
  };
}

/**
 * Build a TestPlannerResponse from the structured tests (D1, D4). The
 * structured `tests` array maps 1:1 to `TestDefinition` (`type` is already
 * constrained to `unit | functional` by the validator).
 *
 * `message` is a short generated summary, NOT a chat turn.
 */
export function buildTestPlannerResponseFromTests(
  tests: readonly StructuredTest[],
  storyTitle: string
): TestPlannerResponseLiteral {
  const testPlan: TestDefinitionLiteral[] = (Array.isArray(tests) ? tests : []).map(
    (t) => ({
      title: t.title,
      description: t.description,
      type: t.type,
    })
  );
  const unitCount = testPlan.filter((t) => t.type === 'unit').length;
  const functionalCount = testPlan.filter((t) => t.type === 'functional').length;
  return {
    schemaVersion: '1.0',
    message: `Test pack for "${storyTitle}": ${unitCount} unit + ${functionalCount} functional test(s).`,
    testPlan,
    openQuestions: [],
  };
}

// ---------------------------------------------------------------------------
// PersistedImplementationState literal (Task Group 3.4)
// ---------------------------------------------------------------------------

/**
 * Assemble the `PersistedImplementationState` JSON literal (schemaVersion 1)
 * with the ready PlannerResponse + TestPlannerResponse and benign defaults for
 * every other field so the panel deserializer hydrates cleanly. Keeps it a
 * plain JSON object (no Maps) -- the gateway is NOT the React serializer.
 */
export function buildPersistedImplementStateLiteral(
  planner: PlannerResponseLiteral,
  testPlanner: TestPlannerResponseLiteral
): PersistedImplementStateLiteral {
  return {
    schemaVersion: 1,
    sessionId: null,
    latestPlannerResponse: planner,
    answers: {},
    questionStatuses: {},
    streamedQuestions: [],
    streamedAnswers: {},
    latestFolder: null,
    incrementStatuses: {},
    activeIncrementId: null,
    prefetchedSpecs: {},
    partStatuses: {},
    activePartIndex: null,
    currentJobId: null,
    partTranscripts: {},
    hasBootstrapped: true,
    hasPlan: true,
    hasTriggeredOrchestration: false,
    inputDraft: '',
    messages: [],
    latestTestPlannerResponse: testPlanner,
    hasTestPlan: true,
    teAnswers: {},
    teQuestionStatuses: {},
    specIntentTexts: {},
    shapeSpecSessionId: null,
  };
}

// ---------------------------------------------------------------------------
// implement-state PUT contract (Task Group 3.5)
// ---------------------------------------------------------------------------

/**
 * Body shape PUT to `gateway/src/routes/implementState.ts` (`PUT
 * /api/implement-state`). The route derives the on-disk
 * `{projectParentFolder}/threads/{kind}/implementation-state.json` path from
 * these fields.
 */
export interface ImplementStatePutBody {
  projectId: string;
  featureId: string;
  projectParentFolder: string;
  featureTitle: string;
  state: PersistedImplementStateLiteral;
  kind?: string;
}

/** Injection seam for the implement-state PUT (tests override). */
export type ImplementStatePutter = (
  body: ImplementStatePutBody
) => Promise<{ success: boolean }>;
