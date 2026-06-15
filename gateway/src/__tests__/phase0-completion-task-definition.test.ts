/**
 * Tests for Phase 0 Completion and Handoff -- Task Definition + Configuration
 *
 * Spec 2026-04-04: Phase 0 Completion and Handoff
 * Task Group 5: Task Definition + Frontend TASK_ARTIFACT_MAP
 *
 * Test 1: architect--discovery-framing.json has artifacts with artifactId="discovery-framing"
 * Test 2: TASK_ARTIFACT_MAP has correct entry (tested separately in frontend)
 *
 * Note: Test 2 for TASK_ARTIFACT_MAP is in the frontend test file since it imports
 * from the frontend module. This file tests the gateway-side task definition JSON.
 */

import * as fs from 'fs';
import * as path from 'path';

const TASKS_DIR = path.resolve(__dirname, '..', 'config', 'tasks');
const DISCOVERY_FRAMING_TASK_PATH = path.join(TASKS_DIR, 'architect--discovery-framing.json');

describe('Phase 0 Completion -- Task Definition (Spec 2026-04-04, Task Group 5)', () => {
  let discoveryFramingTask: Record<string, unknown>;

  beforeAll(() => {
    const raw = fs.readFileSync(DISCOVERY_FRAMING_TASK_PATH, 'utf-8');
    discoveryFramingTask = JSON.parse(raw);
  });

  // ========================================================================
  // Test 1: architect--discovery-framing.json has artifacts with discovery-framing entry
  // ========================================================================
  it('should have a non-empty artifacts array with artifactId === "discovery-framing"', () => {
    expect(discoveryFramingTask).toBeDefined();
    expect(typeof discoveryFramingTask).toBe('object');

    // Must have an artifacts array
    expect(Array.isArray(discoveryFramingTask.artifacts)).toBe(true);
    const artifacts = discoveryFramingTask.artifacts as Array<Record<string, unknown>>;
    expect(artifacts.length).toBeGreaterThanOrEqual(1);

    // At least one entry must have artifactId === 'discovery-framing'
    const entry = artifacts.find((a) => a.artifactId === 'discovery-framing');
    expect(entry).toBeDefined();

    // Verify artifact shape
    expect(entry!.artifactId).toBe('discovery-framing');
    expect(entry!.filename).toBe('DISCOVERY_BRIEF');
    expect(entry!.tool).toBe('save_discovery_config');
    expect(typeof entry!.description).toBe('string');
    expect((entry!.description as string).length).toBeGreaterThan(0);

    // Verify task-level fields are preserved
    expect(discoveryFramingTask.id).toBe('architect--discovery-framing');
    expect(discoveryFramingTask.personaId).toBe('architect');
    expect(discoveryFramingTask.mode).toBe('discovery');
    expect(discoveryFramingTask.persistence).toBe('hub');
  });
});
