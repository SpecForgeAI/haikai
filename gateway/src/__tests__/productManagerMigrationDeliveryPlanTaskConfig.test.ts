/**
 * Tests for the Product Manager Migration Delivery Plan task configuration + prompt.
 *
 * Spec: 2026-05-17 PM Migration Delivery Plan + Draft Book-of-Work Generation
 * Task Group 4: PM Task Config + Markdown Prompt
 *
 * Verifies:
 * 1. Task JSON exists at the documented path with the required identity fields.
 * 2. `contextNeeds` array includes the migration-discovery-context resolver.
 * 3. `responseFormat` references the GeneratedMigrationBookOfWork schema with
 *    the 14-value workstream enum (Q-7) and the four-value readiness enum.
 * 4. Persistence is scoped on (projectId, currentArchitectureId, targetArchitectureId)
 *    per Q-6 (regenerate-on-same-tuple semantics).
 * 5. `availableFrom` matches the backlog task config verbatim per Q-17.
 * 6. The markdown prompt at `product-manager.migration-delivery-plan.task.md`
 *    contains the eight numbered hard-constraint rules from spec.md.
 */

import * as fs from 'fs';
import * as path from 'path';

const CONFIG_DIR = path.resolve(__dirname, '..', 'config');
const TASK_PATH = path.resolve(
  CONFIG_DIR,
  'tasks',
  'product-manager--migration-delivery-plan.json'
);
const BACKLOG_TASK_PATH = path.resolve(
  CONFIG_DIR,
  'tasks',
  'product-manager--backlog.json'
);
const PROMPT_PATH = path.resolve(
  CONFIG_DIR,
  'prompts',
  'product-manager.migration-delivery-plan.task.md'
);

describe('Product Manager Migration Delivery Plan task config (Spec 2026-05-17, Task Group 4)', () => {
  // Test 1: identity fields
  it('loads the task JSON with the required identity fields', () => {
    const raw = fs.readFileSync(TASK_PATH, 'utf-8');
    const task = JSON.parse(raw);

    expect(task.id).toBe('product-manager--migration-delivery-plan');
    expect(task.personaId).toBe('product-manager');
    expect(task.mode).toBe('discovery');
    expect(task.menuLabel).toBe('Create Migration Delivery Plan');
    expect(typeof task.description).toBe('string');
    expect(task.description.length).toBeGreaterThan(0);
    expect(task.taskPromptRef).toBe(
      'prompts/product-manager.migration-delivery-plan.task.md'
    );
  });

  // Test 2: contextNeeds includes migration-discovery-context
  it('declares contextNeeds including migration-discovery-context (Q-12)', () => {
    const raw = fs.readFileSync(TASK_PATH, 'utf-8');
    const task = JSON.parse(raw);

    expect(Array.isArray(task.contextNeeds)).toBe(true);
    expect(task.contextNeeds).toContain('migration-discovery-context');
    // Should also include other PM-style context entries (mission is in
    // backlog.json; we keep the same convention)
    expect(task.contextNeeds).toContain('mission');
  });

  // Test 3: responseFormat references the GeneratedMigrationBookOfWork schema
  // and carries the 14-value workstream enum (Q-7).
  it('declares responseFormat with the GeneratedMigrationBookOfWork schema reference and 14-value workstream enum (Q-7)', () => {
    const raw = fs.readFileSync(TASK_PATH, 'utf-8');
    const task = JSON.parse(raw);

    expect(task.responseFormat).toBeDefined();
    expect(task.responseFormat.type).toBe('object');
    expect(task.responseFormat.schemaRef).toBe('GeneratedMigrationBookOfWork');
    expect(task.responseFormat.required).toEqual(
      expect.arrayContaining([
        'title',
        'summary',
        'generationInputs',
        'generationSummary',
        'qualityAssessment',
        'items',
      ])
    );

    const itemsSchema = task.responseFormat.properties.items.items;
    expect(itemsSchema.properties.type.enum).toEqual([
      'initiative',
      'epic',
      'feature',
      'story',
    ]);
    expect(itemsSchema.properties.workstream.enum).toEqual([
      'target_service_api_implementation',
      'target_frontend_implementation',
      'target_database_schema_implementation',
      'target_infrastructure_environment_implementation',
      'data_migration',
      'api_soap_integration_compatibility',
      'migration_test_pack',
      'reconciliation_reporting',
      'cutover_rollback_decommission',
      'architecture_refinement',
      'discovery_gap_resolution',
      'test_strategy',
      'other',
      'unknown',
    ]);
    expect(itemsSchema.properties.workstream.enum.length).toBe(14);

    expect(itemsSchema.properties.readiness.enum).toEqual([
      'ready_for_spec',
      'needs_focused_context',
      'needs_user_decision',
      'blocked',
    ]);
    expect(itemsSchema.properties.confidence.enum).toEqual([
      'high',
      'medium',
      'low',
    ]);
  });

  // Test 4: persistence scope keyed on (projectId, currentArchitectureId, targetArchitectureId) per Q-6
  it('declares persistence scope on (projectId, currentArchitectureId, targetArchitectureId) per Q-6', () => {
    const raw = fs.readFileSync(TASK_PATH, 'utf-8');
    const task = JSON.parse(raw);

    expect(task.persistenceScope).toBeDefined();
    expect(task.persistenceScope).toEqual([
      'projectId',
      'currentArchitectureId',
      'targetArchitectureId',
    ]);
  });

  // Test 5: availableFrom matches the backlog config verbatim (Q-17)
  it('declares availableFrom matching product-manager--backlog.json verbatim (Q-17)', () => {
    const taskRaw = fs.readFileSync(TASK_PATH, 'utf-8');
    const task = JSON.parse(taskRaw);
    const backlogRaw = fs.readFileSync(BACKLOG_TASK_PATH, 'utf-8');
    const backlog = JSON.parse(backlogRaw);

    expect(task.availableFrom).toEqual(backlog.availableFrom);
    // personaId is the auth/role gating surface in the existing PM task configs
    // (no separate role/permission field); deep-equal-confirm it matches.
    expect(task.personaId).toEqual(backlog.personaId);
  });

  // Test 6: prompt contains all eight numbered hard-constraint rules verbatim from spec.md
  it('declares the markdown prompt with the eight hard-constraint rules verbatim from spec.md', () => {
    const prompt = fs.readFileSync(PROMPT_PATH, 'utf-8');

    // Rule 1 — Functional equivalence is mandatory (Q-7: bold "mandatory")
    expect(prompt).toMatch(/Functional equivalence is\s*\*\*mandatory\*\*/i);
    expect(prompt).toMatch(/never ask the user/i);
    expect(prompt).toMatch(/never propose a non-equivalent target/i);

    // Rule 2 — Generate a book of work, not a migration plan document.
    expect(prompt).toMatch(/Generate a\s*\*\*book of work\*\*,?\s*not a migration plan/i);

    // Rule 3 — Use only the provided evidence; do not invent contracts, mappings, or data details.
    expect(prompt).toMatch(/\*\*do not invent\*\*/i);
    expect(prompt).toMatch(/contracts, mappings, or data details/i);

    // Rule 4 — prerequisite / refinement stories
    expect(prompt).toMatch(/\*\*prerequisite\s*\/\s*refinement stories\*\*/i);
    expect(prompt).toMatch(/needs_focused_context/);
    expect(prompt).toMatch(/needs_user_decision/);

    // Rule 5 — practical delivery dependencies via sequenceOrder
    expect(prompt).toMatch(/\*\*practical delivery dependencies\*\*/i);
    expect(prompt).toMatch(/`sequenceOrder`/);

    // Rule 6 — migration test pack work as backlog items, not test artifacts
    expect(prompt).toMatch(/migration test pack work as\s*\*\*backlog items\*\*/i);
    expect(prompt).toMatch(/not as immediate test artifacts/i);

    // Rule 7 — traceabilitySummary + confidence + readiness on every item
    expect(prompt).toMatch(/`traceabilitySummary`/);
    expect(prompt).toMatch(/`confidence`/);
    expect(prompt).toMatch(/`readiness`/);
    expect(prompt).toMatch(/on every item/i);

    // Rule 8 — Workstream `unknown` only when no other applies; never a guess or hedge (Q-7)
    expect(prompt).toMatch(/Workstream `unknown` is used\s*\*\*only\*\*/i);
    expect(prompt).toMatch(/never as a guess or hedge/i);
  });
});
