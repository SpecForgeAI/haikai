/**
 * Tests for Task Group 6 -- PM Book of Work + Shape-Spec prompt updates and
 * `contextNeeds` additions wiring the new `target-tech-stack-context`
 * resolver into the two Product Manager migration tasks.
 *
 * Spec: 2026-05-25 Tech-Stack.md Pre-fill + Target-Tech-Stack.md Write
 *
 * Verifies (structural substring assertions only):
 *
 *   1. The migration-delivery-plan prompt file contains the new "Target Tech
 *      Stack Context" section heading.
 *   2. The migration-shape-spec-generation prompt file contains the same
 *      new section heading.
 *   3. The migration-shape-spec-generation prompt carries the
 *      Postgres-vs-MySQL anti-rule phrasing tying the rule to the target
 *      tech stack file.
 *   4. The migration-delivery-plan task config JSON includes
 *      `target-tech-stack-context` in `contextNeeds`, alongside the existing
 *      `target-state-decisions-context` (regression guard from Spec 4).
 *   5. The migration-shape-spec-generation task config JSON includes
 *      `target-tech-stack-context` in `contextNeeds`, alongside the existing
 *      Spec 4 entries.
 *   6. Both prompt files still contain their hard-constraint rule headings
 *      (regression guard against accidental deletions).
 *   7. The new resolver file is registered in `KNOWN_CONTEXT_KEYS` under
 *      `target-tech-stack-context` (file-presence + import check).
 */

import * as fs from 'fs';
import * as path from 'path';

const CONFIG_DIR = path.resolve(__dirname, '..', 'config');
const DELIVERY_PLAN_PROMPT_PATH = path.resolve(
  CONFIG_DIR,
  'prompts',
  'product-manager.migration-delivery-plan.task.md',
);
const SHAPE_SPEC_PROMPT_PATH = path.resolve(
  CONFIG_DIR,
  'prompts',
  'product-manager.migration-shape-spec-generation.task.md',
);
const DELIVERY_PLAN_TASK_PATH = path.resolve(
  CONFIG_DIR,
  'tasks',
  'product-manager--migration-delivery-plan.json',
);
const SHAPE_SPEC_TASK_PATH = path.resolve(
  CONFIG_DIR,
  'tasks',
  'product-manager--migration-shape-spec-generation.json',
);

describe('PM Tech Stack Context wiring -- Spec 2026-05-25 (Task Group 6)', () => {
  // -------------------------------------------------------------------------
  // Test 1: delivery-plan prompt -- new section heading + supporting copy
  // -------------------------------------------------------------------------
  it('delivery-plan prompt contains the new "Target Tech Stack Context" section heading and the migration-target anti-rule', () => {
    const prompt = fs.readFileSync(DELIVERY_PLAN_PROMPT_PATH, 'utf-8');

    // New section heading present (plain-English -- "Target Tech Stack Context").
    expect(prompt).toMatch(/##\s+Target Tech Stack Context/);

    // The new section names the resolver key the gateway exposes.
    expect(prompt).toContain('target-tech-stack-context');

    // Plain-English reference to the file (not an acronym).
    expect(prompt.toLowerCase()).toContain('target tech stack');

    // The rule that the Book of Work must honour the target tech stack the
    // architect captured -- worded plainly, not as a slogan.
    expect(prompt.toLowerCase()).toContain(
      'book of work must honour the target tech stack',
    );
  });

  // -------------------------------------------------------------------------
  // Test 2: shape-spec-generation prompt -- new section heading + anti-rule
  // -------------------------------------------------------------------------
  it('shape-spec-generation prompt contains the new "Target Tech Stack Context" section heading and the implementation-guidance rule', () => {
    const prompt = fs.readFileSync(SHAPE_SPEC_PROMPT_PATH, 'utf-8');

    expect(prompt).toMatch(/##\s+Target Tech Stack Context/);
    expect(prompt).toContain('target-tech-stack-context');

    // The rule that the implementation guidance must match the captured
    // target tech stack -- plain-English.
    expect(prompt.toLowerCase()).toContain(
      'implementation guidance must match the target tech stack',
    );
  });

  // -------------------------------------------------------------------------
  // Test 3: shape-spec-generation prompt -- Postgres-vs-MySQL anti-rule wording
  // -------------------------------------------------------------------------
  it('shape-spec-generation prompt carries the Postgres-vs-MySQL anti-rule example tied to the target tech stack', () => {
    const prompt = fs.readFileSync(SHAPE_SPEC_PROMPT_PATH, 'utf-8');

    // The new section must include the concrete example tying the rule to
    // the captured target tech stack file.
    const section = extractSection(prompt, 'Target Tech Stack Context');
    expect(section).toBeTruthy();

    // The example explicitly names both database engines so the LLM cannot
    // miss the contradiction case.
    expect(section).toMatch(/Postgres\s*18/);
    expect(section).toMatch(/MySQL/i);
    expect(section.toLowerCase()).toContain('must not propose');
  });

  // -------------------------------------------------------------------------
  // Test 4: delivery-plan task config -- new context key added, existing
  // entries preserved
  // -------------------------------------------------------------------------
  it('delivery-plan task config includes `target-tech-stack-context` in `contextNeeds` alongside the existing Spec 4 entries', () => {
    const config = JSON.parse(
      fs.readFileSync(DELIVERY_PLAN_TASK_PATH, 'utf-8'),
    );

    expect(Array.isArray(config.contextNeeds)).toBe(true);
    expect(config.contextNeeds).toContain('target-tech-stack-context');

    // Regression guard: Spec 4's addition stays.
    expect(config.contextNeeds).toContain('target-state-decisions-context');

    // Regression guard: original entries from the Spec 1 (Book of Work) commit.
    expect(config.contextNeeds).toContain('mission');
    expect(config.contextNeeds).toContain('product-summary');
    expect(config.contextNeeds).toContain('migration-discovery-context');
    expect(config.contextNeeds).toContain('meta-model-summary');
    expect(config.contextNeeds).toContain('existing-roadmap');

    // Identity preserved.
    expect(config.id).toBe('product-manager--migration-delivery-plan');
  });

  // -------------------------------------------------------------------------
  // Test 5: shape-spec-generation task config -- new context key added,
  // existing entries preserved
  // -------------------------------------------------------------------------
  it('shape-spec-generation task config includes `target-tech-stack-context` in `contextNeeds` alongside the existing Spec 4 entries', () => {
    const config = JSON.parse(
      fs.readFileSync(SHAPE_SPEC_TASK_PATH, 'utf-8'),
    );

    expect(Array.isArray(config.contextNeeds)).toBe(true);
    expect(config.contextNeeds).toContain('target-tech-stack-context');

    // Regression guard: Spec 4's addition stays.
    expect(config.contextNeeds).toContain('target-state-decisions-context');

    // Regression guard: original entries from the shape-spec batch commit.
    expect(config.contextNeeds).toContain('book-of-work');
    expect(config.contextNeeds).toContain('saved-work-items');
    expect(config.contextNeeds).toContain('migration-spec-context');
    expect(config.contextNeeds).toContain('api-baselines');
    expect(config.contextNeeds).toContain('architecture-mappings');
    expect(config.contextNeeds).toContain('discovery-findings');

    // Identity preserved.
    expect(config.id).toBe('product-manager--migration-shape-spec-generation');
  });

  // -------------------------------------------------------------------------
  // Test 6: both prompt files still contain their existing hard-constraint
  // rule headings (regression guard against accidental deletions)
  // -------------------------------------------------------------------------
  it('existing hard-constraint rule headings are preserved in both prompt files', () => {
    const deliveryPlan = fs.readFileSync(DELIVERY_PLAN_PROMPT_PATH, 'utf-8');
    const shapeSpec = fs.readFileSync(SHAPE_SPEC_PROMPT_PATH, 'utf-8');

    // delivery-plan: HARD CONSTRAINTS header + functional-equivalence rule
    expect(deliveryPlan).toMatch(/##\s*HARD CONSTRAINTS/);
    expect(deliveryPlan).toMatch(/Functional equivalence is\s*\*\*mandatory\*\*/i);
    // Existing Spec 4 section also still present.
    expect(deliveryPlan).toMatch(/##\s+Target State Decisions Context/);

    // shape-spec-generation: HARD CONSTRAINTS header + spec-text rule
    expect(shapeSpec).toMatch(/##\s*HARD CONSTRAINTS/);
    expect(shapeSpec).toMatch(/Output MUST be literal `\/agent-os:shape-spec/);
    expect(shapeSpec).toMatch(/##\s+Target State Decisions Context/);
  });

  // -------------------------------------------------------------------------
  // Test 7: registry registration -- target-tech-stack-context is a known key
  // -------------------------------------------------------------------------
  it('`target-tech-stack-context` is registered in the gateway context-resolver registry (Group 4 prerequisite holds)', async () => {
    // The Group 4 resolver landed in `services/contextResolvers.ts`.
    // We do a light structural check via the source file rather than a full
    // resolver instantiation (which would require AMS network mocks).
    const contextResolversPath = path.resolve(
      __dirname,
      '..',
      'services',
      'contextResolvers.ts',
    );
    expect(fs.existsSync(contextResolversPath)).toBe(true);
    const src = fs.readFileSync(contextResolversPath, 'utf-8');
    expect(src).toContain("'target-tech-stack-context'");
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extracts the body of a level-2 markdown section, starting at the heading
 * line and ending at the next level-2 heading (or end of file). Returns an
 * empty string when the heading is not found.
 */
function extractSection(prompt: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`##\\s+${escaped}[\\s\\S]*?(?=\\n##\\s|$)`, 'i');
  const match = prompt.match(regex);
  return match ? match[0] : '';
}
