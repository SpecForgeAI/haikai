/**
 * Tests for the Product Manager Migration Shape-Spec Generation task configuration + prompt.
 *
 * Spec: 2026-05-19 PM Migration Shape-Spec Batch Generation
 * Task Group 3: PM Task Config + Markdown Prompt
 *
 * Verifies:
 * 1. Task JSON exists at the documented path and parses cleanly with the
 *    required identity fields (id, personaId, menuLabel, mode, taskPromptRef).
 * 2. `contextNeeds` includes the NEW `migration-spec-context` resolver
 *    identifier (A-5) plus saved-book-of-work + saved-WorkItems entries.
 * 3. `responseFormat` references the three structured-response variants
 *    (Generated / InsufficientContext / Failed) per A-4.
 * 4. `persistence` scope keys on (projectId, bookOfWorkId) per spec.md.
 * 5. `availableFrom` matches `product-manager--migration-delivery-plan.json`
 *    (Spec 1) verbatim per R-11.
 * 6. The markdown prompt at `product-manager.migration-shape-spec-generation.task.md`
 *    contains the eight numbered hard-constraint rules from spec.md verbatim.
 */

import * as fs from 'fs';
import * as path from 'path';

const CONFIG_DIR = path.resolve(__dirname, '..', 'config');
const TASK_PATH = path.resolve(
  CONFIG_DIR,
  'tasks',
  'product-manager--migration-shape-spec-generation.json'
);
const SPEC1_TASK_PATH = path.resolve(
  CONFIG_DIR,
  'tasks',
  'product-manager--migration-delivery-plan.json'
);
const PROMPT_PATH = path.resolve(
  CONFIG_DIR,
  'prompts',
  'product-manager.migration-shape-spec-generation.task.md'
);

describe('Product Manager Migration Shape-Spec Generation task config (Spec 2026-05-19, Task Group 3)', () => {
  // Test 1: identity fields + parses cleanly
  it('task config file exists and parses cleanly with the required identity fields', () => {
    expect(fs.existsSync(TASK_PATH)).toBe(true);
    const raw = fs.readFileSync(TASK_PATH, 'utf-8');
    const task = JSON.parse(raw);

    expect(task.id).toBe('product-manager--migration-shape-spec-generation');
    expect(task.personaId).toBe('product-manager');
    expect(task.menuLabel).toBe('Generate Migration Shape-Specs');
    expect(typeof task.mode).toBe('string');
    expect(task.mode.length).toBeGreaterThan(0);
    expect(task.taskPromptRef).toBe(
      'prompts/product-manager.migration-shape-spec-generation.task.md'
    );
    expect(typeof task.description).toBe('string');
    expect(task.description.length).toBeGreaterThan(0);
  });

  // Test 2: contextNeeds includes the NEW migration-spec-context resolver (A-5)
  it('declares contextNeeds including the new migration-spec-context resolver (A-5) plus saved book-of-work and saved WorkItems', () => {
    const raw = fs.readFileSync(TASK_PATH, 'utf-8');
    const task = JSON.parse(raw);

    expect(Array.isArray(task.contextNeeds)).toBe(true);
    // Primary new entry per A-5
    expect(task.contextNeeds).toContain('migration-spec-context');
    // Saved book of work + saved WorkItems per spec.md
    expect(task.contextNeeds).toContain('book-of-work');
    expect(task.contextNeeds).toContain('saved-work-items');
  });

  // Test 3: responseFormat references the three variants validated by assertSpecGenerationResponse (A-4)
  it('declares responseFormat with the three structured-response variants (Generated / InsufficientContext / Failed) per A-4', () => {
    const raw = fs.readFileSync(TASK_PATH, 'utf-8');
    const task = JSON.parse(raw);

    expect(task.responseFormat).toBeDefined();
    // The validator branches on the top-level `status` field
    expect(task.responseFormat.required).toEqual(
      expect.arrayContaining(['status'])
    );
    expect(task.responseFormat.properties.status.enum).toEqual(
      expect.arrayContaining([
        'generated',
        'generated_with_warnings',
        'insufficient_context',
        'failed',
      ])
    );
    // All three variants are documented
    expect(task.responseFormat.variants).toBeDefined();
    expect(task.responseFormat.variants.Generated).toBeDefined();
    expect(task.responseFormat.variants.InsufficientContext).toBeDefined();
    expect(task.responseFormat.variants.Failed).toBeDefined();
    // schemaRef points at the new validator family
    expect(task.responseFormat.schemaRef).toBe('SpecGenerationResponse');
  });

  // Test 4: persistence scope keyed on (projectId, bookOfWorkId) per spec.md
  it('declares persistence scope on (projectId, bookOfWorkId) per spec.md', () => {
    const raw = fs.readFileSync(TASK_PATH, 'utf-8');
    const task = JSON.parse(raw);

    expect(task.persistenceScope).toBeDefined();
    expect(task.persistenceScope).toEqual(['projectId', 'bookOfWorkId']);
  });

  // Test 5: availableFrom matches Spec 1's PM task verbatim (R-11)
  it('declares availableFrom matching product-manager--migration-delivery-plan.json verbatim (R-11)', () => {
    const taskRaw = fs.readFileSync(TASK_PATH, 'utf-8');
    const task = JSON.parse(taskRaw);
    const spec1Raw = fs.readFileSync(SPEC1_TASK_PATH, 'utf-8');
    const spec1 = JSON.parse(spec1Raw);

    expect(task.availableFrom).toEqual(spec1.availableFrom);
    // personaId is the auth/role gating surface in the existing PM task configs
    // (no separate role/permission field); deep-equal-confirm it matches Spec 1.
    expect(task.personaId).toEqual(spec1.personaId);
  });

  // Test 6: prompt contains the eight numbered hard-constraint rules from spec.md verbatim
  it('declares the markdown prompt with the eight hard-constraint rules verbatim from spec.md', () => {
    expect(fs.existsSync(PROMPT_PATH)).toBe(true);
    const prompt = fs.readFileSync(PROMPT_PATH, 'utf-8');

    // Rule 1 — Output MUST be literal /agent-os:shape-spec
    expect(prompt).toMatch(/Output MUST be literal\s*`\/agent-os:shape-spec/);

    // Rule 2 — Do NOT invent missing contracts, mappings, data details, or architecture details
    expect(prompt).toMatch(/Do NOT invent missing contracts, mappings, data details, or architecture details/);
    expect(prompt).toMatch(/insufficient_context/);

    // Rule 3 — Use the provided focused migration context and evidence references
    expect(prompt).toMatch(/Use the provided focused migration context and evidence references/);

    // Rule 4 — Include implementation steps, affected files / modules / components where known, acceptance criteria, test requirements, and evidence references
    expect(prompt).toMatch(/Include implementation steps, affected files\s*\/\s*modules\s*\/\s*components where known, acceptance criteria, test requirements, and evidence references/);

    // Rule 5 — Preserve the functional like-for-like migration goal
    expect(prompt).toMatch(/Preserve the functional like-for-like migration goal/);
    expect(prompt).toMatch(/never propose a non-equivalent target/);

    // Rule 6 — Keep each spec scoped to its single story / WorkItem; no unrelated roadmap or backlog context
    expect(prompt).toMatch(/Keep each spec scoped to its single story\s*\/\s*WorkItem/);
    expect(prompt).toMatch(/no unrelated roadmap or backlog context/i);

    // Rule 7 — Prerequisite-work stories must describe the prerequisite clearly
    expect(prompt).toMatch(/Prerequisite-work stories must describe the prerequisite clearly/);

    // Rule 8 — The LLM self-rates `confidence`; gateway validates and may downgrade
    expect(prompt).toMatch(/The LLM self-rates `confidence`/);
    expect(prompt).toMatch(/the gateway validates and may downgrade/);
  });
});
