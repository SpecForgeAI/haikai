/**
 * Tests for additive prompt + config updates on the two existing PM migration
 * tasks introduced by Spec 2026-05-25 PM Tasks Captured Decisions Integration
 * (Group 1).
 *
 * Verifies (structural substring assertions only -- per Q6 we deliberately
 * skip golden-file diffs):
 *   1. delivery-plan prompt: new "Target State Decisions Context" section heading is present.
 *   2. delivery-plan prompt: anti-rule against asking the user follow-up
 *      technology-choice questions is present.
 *   3. delivery-plan prompt: `[decision:<code>]` inline tagging convention mention is present.
 *   4. delivery-plan prompt: each of the 8 existing hard-constraint rules is still present.
 *   5. shape-spec-generation prompt: new section heading + evidenceRefs[] +
 *      captured_decision object-shape mention + Postgres/MySQL anti-rule + 8 existing rules.
 *   6. Both task-config .json files include `target-state-decisions-context` in `contextNeeds`
 *      AND still contain `migration-discovery-context` (delivery-plan) /
 *      `migration-spec-context` (shape-spec-generation).
 *   7. Both task-config .json files have not had top-level keys removed by this edit.
 */

import * as fs from 'fs';
import * as path from 'path';

const CONFIG_DIR = path.resolve(__dirname, '..', 'config');
const DELIVERY_PLAN_PROMPT_PATH = path.resolve(
  CONFIG_DIR,
  'prompts',
  'product-manager.migration-delivery-plan.task.md'
);
const SHAPE_SPEC_PROMPT_PATH = path.resolve(
  CONFIG_DIR,
  'prompts',
  'product-manager.migration-shape-spec-generation.task.md'
);
const DELIVERY_PLAN_TASK_PATH = path.resolve(
  CONFIG_DIR,
  'tasks',
  'product-manager--migration-delivery-plan.json'
);
const SHAPE_SPEC_TASK_PATH = path.resolve(
  CONFIG_DIR,
  'tasks',
  'product-manager--migration-shape-spec-generation.json'
);

describe('PM task prompt + config updates -- Spec 2026-05-25 (Group 1)', () => {
  // Test 1: delivery-plan prompt new section heading + critical phrases
  it('delivery-plan prompt -- contains "Target State Decisions Context" section, anti-rule, and `[decision:<code>]` mention', () => {
    const prompt = fs.readFileSync(DELIVERY_PLAN_PROMPT_PATH, 'utf-8');

    // New section heading present
    expect(prompt).toMatch(/##\s+Target State Decisions Context/);

    // Anti-rule against asking user follow-up questions about technology choices
    expect(prompt.toLowerCase()).toContain(
      'do not ask the user follow-up questions about technology choices'
    );

    // [decision:<code>] tagging convention mention
    expect(prompt).toContain('[decision:<code>]');

    // Initiative grouping must align with captured decisions (db.engine / service.framework examples)
    expect(prompt).toMatch(/Initiative grouping must align with captured decisions/i);
    expect(prompt).toContain('db.engine');
    expect(prompt).toContain('service.framework');
  });

  // Test 2: delivery-plan prompt -- the 8 existing hard-constraint rules are preserved
  it('delivery-plan prompt -- the 8 existing hard-constraint rules are preserved', () => {
    const prompt = fs.readFileSync(DELIVERY_PLAN_PROMPT_PATH, 'utf-8');

    // Rule 1 -- Functional equivalence is mandatory
    expect(prompt).toMatch(/Functional equivalence is\s*\*\*mandatory\*\*/i);
    // Rule 2 -- Generate a book of work, not a migration plan document
    expect(prompt).toMatch(/Generate a\s*\*\*book of work\*\*,?\s*not a migration plan/i);
    // Rule 3 -- do not invent
    expect(prompt).toMatch(/\*\*do not invent\*\*/i);
    // Rule 4 -- prerequisite / refinement stories
    expect(prompt).toMatch(/\*\*prerequisite\s*\/\s*refinement stories\*\*/i);
    // Rule 5 -- practical delivery dependencies via sequenceOrder
    expect(prompt).toMatch(/\*\*practical delivery dependencies\*\*/i);
    expect(prompt).toContain('`sequenceOrder`');
    // Rule 6 -- migration test pack work as backlog items
    expect(prompt).toMatch(/migration test pack work as\s*\*\*backlog items\*\*/i);
    // Rule 7 -- traceabilitySummary + confidence + readiness on every item
    expect(prompt).toContain('`traceabilitySummary`');
    expect(prompt).toContain('`confidence`');
    expect(prompt).toContain('`readiness`');
    // Rule 8 -- workstream `unknown` only as last resort
    expect(prompt).toMatch(/Workstream `unknown` is used\s*\*\*only\*\*/i);
  });

  // Test 3: shape-spec-generation prompt -- new section + evidenceRefs +
  // captured_decision shape + Postgres/MySQL anti-rule + tagging convention
  it('shape-spec-generation prompt -- contains decisions section, evidenceRefs/captured_decision mention, Postgres-not-MySQL anti-rule, and `[decision:<code>]` mention', () => {
    const prompt = fs.readFileSync(SHAPE_SPEC_PROMPT_PATH, 'utf-8');

    // New section heading
    expect(prompt).toMatch(/##\s+Target State Decisions Context/);

    // evidenceRefs requirement + captured_decision object shape
    expect(prompt).toContain('evidenceRefs');
    expect(prompt).toContain("captured_decision");
    // Object-shape example must mention the snake_case type field
    expect(prompt).toMatch(/"type":\s*"captured_decision"/);

    // Tagging convention
    expect(prompt).toContain('[decision:<code>]');

    // Anti-rule mentioning Postgres / MySQL contradiction example
    expect(prompt).toMatch(/Postgres/);
    expect(prompt).toMatch(/MySQL/);
    expect(prompt.toLowerCase()).toContain('do not generate technology-specific implementation detail that contradicts a captured decision');
  });

  // Test 4: shape-spec-generation prompt -- the 8 existing hard-constraint rules are preserved
  it('shape-spec-generation prompt -- the 8 existing hard-constraint rules are preserved', () => {
    const prompt = fs.readFileSync(SHAPE_SPEC_PROMPT_PATH, 'utf-8');

    // Rule 1 -- Output MUST be literal /agent-os:shape-spec
    expect(prompt).toMatch(/Output MUST be literal `\/agent-os:shape-spec/);
    // Rule 2 -- Do NOT invent missing contracts, mappings, data details, or architecture details
    expect(prompt).toMatch(/Do NOT invent missing contracts/i);
    // Rule 3 -- Use the provided focused migration context and evidence references
    expect(prompt).toMatch(/Use the provided focused migration context and evidence references/i);
    // Rule 4 -- Include implementation steps, affected files / modules / components
    expect(prompt).toMatch(/Include implementation steps, affected files \/ modules \/ components/i);
    // Rule 5 -- Preserve the functional like-for-like migration goal
    expect(prompt).toMatch(/Preserve the functional like-for-like migration goal/i);
    // Rule 6 -- Keep each spec scoped to its single story / WorkItem
    expect(prompt).toMatch(/Keep each spec scoped to its single story \/ WorkItem/i);
    // Rule 7 -- Prerequisite-work stories must describe the prerequisite clearly
    expect(prompt).toMatch(/Prerequisite-work stories must describe the prerequisite clearly/i);
    // Rule 8 -- The LLM self-rates `confidence`
    expect(prompt).toMatch(/The LLM self-rates `confidence`/);
  });

  // Test 5: both task-config .json files contain `target-state-decisions-context` in `contextNeeds`
  it('both task-config JSON files include `target-state-decisions-context` in `contextNeeds` alongside the pre-existing entries', () => {
    const deliveryPlan = JSON.parse(fs.readFileSync(DELIVERY_PLAN_TASK_PATH, 'utf-8'));
    const shapeSpec = JSON.parse(fs.readFileSync(SHAPE_SPEC_TASK_PATH, 'utf-8'));

    // delivery-plan
    expect(Array.isArray(deliveryPlan.contextNeeds)).toBe(true);
    expect(deliveryPlan.contextNeeds).toContain('target-state-decisions-context');
    // existing migration-discovery-context still present
    expect(deliveryPlan.contextNeeds).toContain('migration-discovery-context');
    // mission still present (sanity check that we did not remove other entries)
    expect(deliveryPlan.contextNeeds).toContain('mission');

    // shape-spec-generation
    expect(Array.isArray(shapeSpec.contextNeeds)).toBe(true);
    expect(shapeSpec.contextNeeds).toContain('target-state-decisions-context');
    // existing entries still present
    expect(shapeSpec.contextNeeds).toContain('migration-spec-context');
    expect(shapeSpec.contextNeeds).toContain('book-of-work');
    expect(shapeSpec.contextNeeds).toContain('saved-work-items');
  });

  // Test 6: both task-config .json files retain their pre-existing top-level keys
  it('both task-config JSON files retain their pre-existing top-level keys (no accidental key deletions)', () => {
    const deliveryPlan = JSON.parse(fs.readFileSync(DELIVERY_PLAN_TASK_PATH, 'utf-8'));
    const shapeSpec = JSON.parse(fs.readFileSync(SHAPE_SPEC_TASK_PATH, 'utf-8'));

    // Required top-level keys per the existing config conventions
    const requiredKeys = [
      'id',
      'personaId',
      'menuLabel',
      'description',
      'mode',
      'taskPromptRef',
      'responseFormat',
      'contextNeeds',
      'persistence',
      'persistenceScope',
      'artifacts',
      'availableFrom',
    ];
    for (const key of requiredKeys) {
      expect(deliveryPlan).toHaveProperty(key);
      expect(shapeSpec).toHaveProperty(key);
    }
    // identity preserved
    expect(deliveryPlan.id).toBe('product-manager--migration-delivery-plan');
    expect(shapeSpec.id).toBe('product-manager--migration-shape-spec-generation');
    // availableFrom shape preserved
    expect(deliveryPlan.availableFrom).toEqual(['hub', 'panel']);
    expect(shapeSpec.availableFrom).toEqual(['hub', 'panel']);
  });
});
