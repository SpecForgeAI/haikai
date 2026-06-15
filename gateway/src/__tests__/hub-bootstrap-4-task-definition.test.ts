/**
 * Tests for SA "Define Tech Stack" and TE "Test Strategy" task definition validation
 *
 * Spec 2026-03-01: Hub Bootstrap 4 -- SA Tech Stack + TE Test Strategy End-to-End
 * Task Group 1: Task Definitions + Discovery Prompts
 *
 * Tests:
 * 1. architect--define-tech-stack.json parses as valid JSON and contains an
 *    artifacts array with an entry where artifactId === 'tech-stack'
 * 2. architect--define-tech-stack.json artifact entry has expected shape and
 *    task-level fields (mode, persistence, availableFrom, contextNeeds)
 * 3. architect--define-tech-stack.json has responseFormat with correct required
 *    fields and section enum including key values
 * 4. test-engineer--test-strategy.json has been upgraded with responseFormat,
 *    contextNeeds, and artifacts
 * 5. test-engineer--test-strategy.json retains original fields unchanged
 * 6. architect--tech-standards.json is NOT modified
 */

import * as fs from 'fs';
import * as path from 'path';

const TASKS_DIR = path.resolve(__dirname, '..', 'config', 'tasks');

const TECH_STACK_TASK_PATH = path.join(TASKS_DIR, 'architect--define-tech-stack.json');
const TEST_STRATEGY_TASK_PATH = path.join(TASKS_DIR, 'test-engineer--test-strategy.json');
const TECH_STANDARDS_TASK_PATH = path.join(TASKS_DIR, 'architect--tech-standards.json');

describe('SA Define Tech Stack + TE Test Strategy Task Definitions (Spec 2026-03-01, Task Group 1)', () => {
  let techStackTask: Record<string, unknown>;
  let testStrategyTask: Record<string, unknown>;
  let techStandardsTask: Record<string, unknown>;

  beforeAll(() => {
    const techStackRaw = fs.readFileSync(TECH_STACK_TASK_PATH, 'utf-8');
    techStackTask = JSON.parse(techStackRaw);

    const testStrategyRaw = fs.readFileSync(TEST_STRATEGY_TASK_PATH, 'utf-8');
    testStrategyTask = JSON.parse(testStrategyRaw);

    const techStandardsRaw = fs.readFileSync(TECH_STANDARDS_TASK_PATH, 'utf-8');
    techStandardsTask = JSON.parse(techStandardsRaw);
  });

  // ========================================================================
  // Test 1: architect--define-tech-stack.json parses and contains tech-stack artifact
  // ========================================================================
  it('should parse architect--define-tech-stack.json as valid JSON with an artifacts array containing a tech-stack entry', () => {
    expect(techStackTask).toBeDefined();
    expect(typeof techStackTask).toBe('object');

    // Must have an artifacts array
    expect(Array.isArray(techStackTask.artifacts)).toBe(true);
    const artifacts = techStackTask.artifacts as Array<Record<string, unknown>>;
    expect(artifacts.length).toBeGreaterThanOrEqual(1);

    // At least one entry must have artifactId === 'tech-stack'
    const techStackEntry = artifacts.find((a) => a.artifactId === 'tech-stack');
    expect(techStackEntry).toBeDefined();
  });

  // ========================================================================
  // Test 2: architect--define-tech-stack.json artifact entry has expected shape
  //         and task-level fields are correct
  // ========================================================================
  it('should have artifact entry with expected shape and correct mode, persistence, availableFrom, contextNeeds', () => {
    const artifacts = techStackTask.artifacts as Array<Record<string, unknown>>;
    const entry = artifacts.find((a) => a.artifactId === 'tech-stack')!;

    // Artifact shape
    expect(entry.artifactId).toBe('tech-stack');
    expect(entry.filename).toBe('TECH-STACK.MD');
    expect(entry.tool).toBe('save_markdown_artifact');
    expect(typeof entry.description).toBe('string');
    expect((entry.description as string).length).toBeGreaterThan(0);

    // Task-level fields
    expect(techStackTask.mode).toBe('discovery');
    expect(techStackTask.persistence).toBe('hub');
    expect(techStackTask.availableFrom).toEqual(['hub', 'panel']);
    expect(techStackTask.contextNeeds).toEqual(['mission', 'architecture-baseline']);
  });

  // ========================================================================
  // Test 3: architect--define-tech-stack.json responseFormat has correct structure
  // ========================================================================
  it('should have responseFormat with required fields and section enum including key values', () => {
    expect(techStackTask.responseFormat).toBeDefined();
    const responseFormat = techStackTask.responseFormat as Record<string, unknown>;
    expect(responseFormat.type).toBe('object');
    expect(Array.isArray(responseFormat.required)).toBe(true);
    expect(responseFormat.required).toEqual(['phase', 'section', 'questions', 'summary']);

    // responseFormat.properties must contain all required fields
    const properties = responseFormat.properties as Record<string, Record<string, unknown>>;
    expect(properties).toBeDefined();
    expect(properties.phase).toBeDefined();
    expect(properties.section).toBeDefined();
    expect(properties.questions).toBeDefined();
    expect(properties.summary).toBeDefined();

    // section enum must include key values
    const sectionEnum = properties.section.enum as string[];
    expect(Array.isArray(sectionEnum)).toBe(true);
    expect(sectionEnum).toContain('current_landscape');
    expect(sectionEnum).toContain('frontend_tech');
    expect(sectionEnum).toContain('backend_tech');
    expect(sectionEnum).toContain('data_storage');
    expect(sectionEnum).toContain('final_review');
  });

  // ========================================================================
  // Test 4: test-engineer--test-strategy.json has been upgraded
  // ========================================================================
  it('should have test-engineer--test-strategy.json upgraded with responseFormat, contextNeeds, and artifacts', () => {
    // responseFormat is non-null with correct required fields
    expect(testStrategyTask.responseFormat).not.toBeNull();
    expect(testStrategyTask.responseFormat).toBeDefined();
    const responseFormat = testStrategyTask.responseFormat as Record<string, unknown>;
    expect(responseFormat.type).toBe('object');
    expect(Array.isArray(responseFormat.required)).toBe(true);
    expect(responseFormat.required).toEqual(['phase', 'section', 'questions', 'summary']);

    // section enum must include key values
    const properties = responseFormat.properties as Record<string, Record<string, unknown>>;
    const sectionEnum = properties.section.enum as string[];
    expect(Array.isArray(sectionEnum)).toBe(true);
    expect(sectionEnum).toContain('project_context');
    expect(sectionEnum).toContain('test_levels');
    expect(sectionEnum).toContain('coverage_targets');
    expect(sectionEnum).toContain('tooling');
    expect(sectionEnum).toContain('quality_gates');
    expect(sectionEnum).toContain('testing_principles');
    expect(sectionEnum).toContain('strategy_review');
    expect(sectionEnum).toContain('final_review');

    // contextNeeds
    expect(testStrategyTask.contextNeeds).toEqual(['mission', 'roadmap', 'tech-stack']);

    // artifacts array with test-strategy entry
    expect(Array.isArray(testStrategyTask.artifacts)).toBe(true);
    const artifacts = testStrategyTask.artifacts as Array<Record<string, unknown>>;
    expect(artifacts.length).toBeGreaterThanOrEqual(1);
    const testStrategyEntry = artifacts.find((a) => a.artifactId === 'test-strategy');
    expect(testStrategyEntry).toBeDefined();
    expect(testStrategyEntry!.filename).toBe('TEST-STRATEGY.MD');
    expect(testStrategyEntry!.tool).toBe('save_markdown_artifact');
    expect(typeof testStrategyEntry!.description).toBe('string');
  });

  // ========================================================================
  // Test 5: test-engineer--test-strategy.json retains original fields unchanged
  // ========================================================================
  it('should retain original fields in test-engineer--test-strategy.json: id, personaId, mode, persistence', () => {
    expect(testStrategyTask.id).toBe('test-engineer--test-strategy');
    expect(testStrategyTask.personaId).toBe('test-engineer');
    expect(testStrategyTask.mode).toBe('discovery');
    expect(testStrategyTask.persistence).toBe('hub');
    expect(testStrategyTask.availableFrom).toEqual(['hub', 'panel']);
    expect(testStrategyTask.menuLabel).toBe('Test Strategy');
    expect(typeof testStrategyTask.description).toBe('string');
    expect(typeof testStrategyTask.taskPromptRef).toBe('string');
  });

  // ========================================================================
  // Test 6: architect--tech-standards.json is NOT modified
  // ========================================================================
  it('should NOT have modified architect--tech-standards.json core identity fields (Inc8 updated contextNeeds and availableFrom)', () => {
    // Verify core identity fields remain unchanged
    expect(techStandardsTask.id).toBe('architect--tech-standards');
    expect(techStandardsTask.personaId).toBe('architect');
    expect(techStandardsTask.menuLabel).toBe('Technical Standards');
    expect(techStandardsTask.mode).toBe('advisory');
    expect(techStandardsTask.responseFormat).toBeNull();
    expect(techStandardsTask.artifacts).toEqual([]);
    expect(techStandardsTask.phases).toBeNull();
    expect(techStandardsTask.persistence).toBe('hub');
    // Inc8 intentionally updated contextNeeds and availableFrom for panel support
    expect(techStandardsTask.contextNeeds).toEqual(['mission', 'tech-stack']);
    expect(techStandardsTask.availableFrom).toEqual(['hub', 'panel']);
  });
});
