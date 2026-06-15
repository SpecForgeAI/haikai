/**
 * Tests for PM "Build Roadmap" task definition and prompt configuration
 *
 * Spec 2026-03-01: Hub Bootstrap 2 -- Roadmap (PM) End-to-End
 * Task Group 1: Task Definition and Prompt Configuration
 *
 * Tests:
 * 1. product-manager--roadmap.json parses as valid JSON and contains an
 *    artifacts array with at least one entry where artifactId === 'roadmap'
 * 2. artifacts[0] has the expected shape:
 *    { artifactId: 'roadmap', filename: 'ROADMAP', tool: 'save_roadmap_structure', description: string }
 * 3. product-manager.roadmap.task.md contains the string 'JIRA ROADMAP AWARENESS'
 *    (verifying the JIRA awareness block was appended)
 */

import * as fs from 'fs';
import * as path from 'path';

const TASK_DEF_PATH = path.resolve(
  __dirname,
  '..',
  'config',
  'tasks',
  'product-manager--roadmap.json'
);

const TASK_PROMPT_PATH = path.resolve(
  __dirname,
  '..',
  'config',
  'prompts',
  'product-manager.roadmap.task.md'
);

describe('PM Build Roadmap Task Definition and Prompt (Spec 2026-03-01, Task Group 1)', () => {
  let taskDef: Record<string, unknown>;
  let promptContent: string;

  beforeAll(() => {
    const raw = fs.readFileSync(TASK_DEF_PATH, 'utf-8');
    taskDef = JSON.parse(raw);

    promptContent = fs.readFileSync(TASK_PROMPT_PATH, 'utf-8');
  });

  // ========================================================================
  // Test 1: JSON parses and contains artifacts array with roadmap entry
  // ========================================================================
  it('should parse as valid JSON and contain an artifacts array with a roadmap entry', () => {
    // File must parse as valid JSON (handled by beforeAll -- would throw if invalid)
    expect(taskDef).toBeDefined();
    expect(typeof taskDef).toBe('object');

    // Must have an artifacts array
    expect(Array.isArray(taskDef.artifacts)).toBe(true);
    const artifacts = taskDef.artifacts as Array<Record<string, unknown>>;
    expect(artifacts.length).toBeGreaterThanOrEqual(1);

    // At least one entry must have artifactId === 'roadmap'
    const roadmapEntry = artifacts.find((a) => a.artifactId === 'roadmap');
    expect(roadmapEntry).toBeDefined();
  });

  // ========================================================================
  // Test 2: artifacts[0] has the expected shape for the roadmap slot
  // ========================================================================
  it('should have artifacts[0] with expected shape: { artifactId, filename, tool, description }', () => {
    const artifacts = taskDef.artifacts as Array<Record<string, unknown>>;
    const entry = artifacts[0];

    expect(entry.artifactId).toBe('roadmap');
    expect(entry.filename).toBe('ROADMAP');
    expect(entry.tool).toBe('save_roadmap_structure');
    expect(typeof entry.description).toBe('string');
    expect((entry.description as string).length).toBeGreaterThan(0);
  });

  // ========================================================================
  // Test 3: Task prompt contains JIRA ROADMAP AWARENESS section
  // ========================================================================
  it('should contain the JIRA ROADMAP AWARENESS section in the task prompt', () => {
    expect(promptContent).toContain('JIRA ROADMAP AWARENESS');
    // Also verify the key instruction content is present
    expect(promptContent).toContain('Jira import is coming in a future increment');
    expect(promptContent).toContain('Do not attempt any actual Jira API calls or import operations');
  });
});
