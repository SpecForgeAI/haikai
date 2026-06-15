/**
 * Tests for PM "Define Product" task definition update
 *
 * Spec 2026-02-28: Hub Bootstrap 1 -- Product Definition (PM) End-to-End
 * Task Group 1: Task Definition Update and Backend Configuration
 *
 * Tests:
 * 1. product-manager--define-product.json parses as valid JSON and contains an
 *    artifacts array with at least one entry where artifactId === 'mission-md'
 * 2. The artifacts[0] entry has the expected shape:
 *    { artifactId: 'mission-md', filename: 'MISSION.MD', tool: 'save_product_artifacts', description: string }
 */

import * as fs from 'fs';
import * as path from 'path';

const TASK_DEF_PATH = path.resolve(
  __dirname,
  '..',
  'config',
  'tasks',
  'product-manager--define-product.json'
);

describe('PM Define Product Task Definition (Spec 2026-02-28, Task Group 1)', () => {
  let taskDef: Record<string, unknown>;

  beforeAll(() => {
    const raw = fs.readFileSync(TASK_DEF_PATH, 'utf-8');
    taskDef = JSON.parse(raw);
  });

  // ========================================================================
  // Test 1: JSON parses and contains artifacts array with mission-md entry
  // ========================================================================
  it('should parse as valid JSON and contain an artifacts array with a mission-md entry', () => {
    // File must parse as valid JSON (handled by beforeAll -- would throw if invalid)
    expect(taskDef).toBeDefined();
    expect(typeof taskDef).toBe('object');

    // Must have an artifacts array
    expect(Array.isArray(taskDef.artifacts)).toBe(true);
    const artifacts = taskDef.artifacts as Array<Record<string, unknown>>;
    expect(artifacts.length).toBeGreaterThanOrEqual(1);

    // At least one entry must have artifactId === 'mission-md'
    const missionEntry = artifacts.find((a) => a.artifactId === 'mission-md');
    expect(missionEntry).toBeDefined();
  });

  // ========================================================================
  // Test 2: artifacts[0] has the expected shape for the mission-md slot
  // ========================================================================
  it('should have artifacts[0] with expected shape: { artifactId, filename, tool, description }', () => {
    const artifacts = taskDef.artifacts as Array<Record<string, unknown>>;
    const entry = artifacts[0];

    expect(entry.artifactId).toBe('mission-md');
    expect(entry.filename).toBe('MISSION.MD');
    expect(entry.tool).toBe('save_product_artifacts');
    expect(typeof entry.description).toBe('string');
    expect((entry.description as string).length).toBeGreaterThan(0);
  });
});
