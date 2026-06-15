/**
 * Tests for SA "Define Architecture" task definition validation
 *
 * Spec 2026-03-01: Hub Bootstrap 3 -- Solution Architect Baseline Architecture End-to-End
 * Task Group 1: Task Definition Update
 *
 * Tests:
 * 1. architect--define-architecture.json parses as valid JSON and contains an
 *    artifacts array with at least one entry where artifactId === 'architecture-baseline'
 * 2. artifacts[0] has the expected shape:
 *    { artifactId: 'architecture-baseline', filename: 'ARCHITECTURE_BASELINE', tool: 'save_architecture_baseline', description: string }
 * 3. contextNeeds remains ["mission", "tech-stack"] and responseFormat remains unchanged
 *    (required fields: phase, section, questions, summary)
 */

import * as fs from 'fs';
import * as path from 'path';

const TASK_DEF_PATH = path.resolve(
  __dirname,
  '..',
  'config',
  'tasks',
  'architect--define-architecture.json'
);

describe('SA Define Architecture Task Definition (Spec 2026-03-01, Task Group 1)', () => {
  let taskDef: Record<string, unknown>;

  beforeAll(() => {
    const raw = fs.readFileSync(TASK_DEF_PATH, 'utf-8');
    taskDef = JSON.parse(raw);
  });

  // ========================================================================
  // Test 1: JSON parses and contains artifacts array with architecture-baseline entry
  // ========================================================================
  it('should parse as valid JSON and contain an artifacts array with an architecture-baseline entry', () => {
    // File must parse as valid JSON (handled by beforeAll -- would throw if invalid)
    expect(taskDef).toBeDefined();
    expect(typeof taskDef).toBe('object');

    // Must have an artifacts array
    expect(Array.isArray(taskDef.artifacts)).toBe(true);
    const artifacts = taskDef.artifacts as Array<Record<string, unknown>>;
    expect(artifacts.length).toBeGreaterThanOrEqual(1);

    // At least one entry must have artifactId === 'architecture-baseline'
    const baselineEntry = artifacts.find((a) => a.artifactId === 'architecture-baseline');
    expect(baselineEntry).toBeDefined();
  });

  // ========================================================================
  // Test 2: artifacts[0] has the expected shape for the architecture-baseline slot
  // ========================================================================
  it('should have artifacts[0] with expected shape: { artifactId, filename, tool, description }', () => {
    const artifacts = taskDef.artifacts as Array<Record<string, unknown>>;
    const entry = artifacts[0];

    expect(entry.artifactId).toBe('architecture-baseline');
    expect(entry.filename).toBe('ARCHITECTURE_BASELINE');
    expect(entry.tool).toBe('save_architecture_baseline');
    expect(typeof entry.description).toBe('string');
    expect((entry.description as string).length).toBeGreaterThan(0);
  });

  // ========================================================================
  // Test 3: contextNeeds and responseFormat remain unchanged
  // ========================================================================
  it('should have contextNeeds ["mission", "tech-stack"] and responseFormat with required fields phase, section, questions, summary', () => {
    // contextNeeds must be exactly ["mission", "tech-stack"]
    expect(Array.isArray(taskDef.contextNeeds)).toBe(true);
    expect(taskDef.contextNeeds).toEqual(['mission', 'tech-stack']);

    // responseFormat must be an object with required fields
    expect(taskDef.responseFormat).toBeDefined();
    const responseFormat = taskDef.responseFormat as Record<string, unknown>;
    expect(responseFormat.type).toBe('object');
    expect(Array.isArray(responseFormat.required)).toBe(true);
    expect(responseFormat.required).toEqual(['phase', 'section', 'questions', 'summary']);

    // responseFormat.properties must contain all required fields
    const properties = responseFormat.properties as Record<string, unknown>;
    expect(properties).toBeDefined();
    expect(properties.phase).toBeDefined();
    expect(properties.section).toBeDefined();
    expect(properties.questions).toBeDefined();
    expect(properties.summary).toBeDefined();
  });
});
