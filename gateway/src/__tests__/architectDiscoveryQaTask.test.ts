/**
 * Tests for Architect Discovery-QA Task Configuration
 *
 * Spec 2026-04-06: Hypothesis-First Discovery Q&A with Users
 * Task Group 5: Architect Discovery-QA Task and Prompt
 *
 * Verifies:
 * 1. architect--discovery-qa.json is valid JSON with all required fields
 * 2. responseFormat schema includes phase, verdicts, summary, and questions
 * 3. architect.json persona tasks array includes "architect--discovery-qa"
 * 4. Prompt file architect.discovery-qa.task.md exists and is non-empty
 */

import * as fs from 'fs';
import * as path from 'path';

const CONFIG_DIR = path.resolve(__dirname, '..', 'config');

const TASK_DEF_PATH = path.resolve(
  CONFIG_DIR,
  'tasks',
  'architect--discovery-qa.json'
);

const PERSONA_PATH = path.resolve(
  CONFIG_DIR,
  'personas',
  'architect.json'
);

const PROMPT_PATH = path.resolve(
  CONFIG_DIR,
  'prompts',
  'architect.discovery-qa.task.md'
);

describe('Architect Discovery-QA Task Configuration (Spec 2026-04-06, Task Group 5)', () => {
  // ========================================================================
  // Test 1: Task JSON is valid and contains all required fields
  // ========================================================================
  it('should load architect--discovery-qa.json with all required fields', () => {
    const raw = fs.readFileSync(TASK_DEF_PATH, 'utf-8');
    const taskDef = JSON.parse(raw);

    expect(taskDef.id).toBe('architect--discovery-qa');
    expect(taskDef.personaId).toBe('architect');
    expect(taskDef.mode).toBe('discovery');
    expect(taskDef.taskPromptRef).toBe('prompts/architect.discovery-qa.task.md');
    expect(taskDef.responseFormat).toBeDefined();
    expect(taskDef.responseFormat).not.toBeNull();
    expect(taskDef.contextNeeds).toEqual(['discovery-run-id', 'project-id']);
    expect(taskDef.persistence).toBe('hub');
    expect(taskDef.availableFrom).toEqual(['hub']);
    expect(typeof taskDef.menuLabel).toBe('string');
    expect(taskDef.menuLabel.length).toBeGreaterThan(0);
    expect(typeof taskDef.description).toBe('string');
    expect(taskDef.description.length).toBeGreaterThan(0);
    expect(taskDef.artifacts).toEqual([]);
    expect(taskDef.phases).toBeNull();
  });

  // ========================================================================
  // Test 2: responseFormat schema includes phase, verdicts, summary, questions
  // ========================================================================
  it('should have responseFormat with phase (enum: questions, done), verdicts (array of hypothesisId/verdict/notes), summary, and questions', () => {
    const raw = fs.readFileSync(TASK_DEF_PATH, 'utf-8');
    const taskDef = JSON.parse(raw);
    const rf = taskDef.responseFormat;

    // Top-level structure
    expect(rf.type).toBe('object');
    expect(rf.required).toEqual(expect.arrayContaining(['phase', 'verdicts', 'questions', 'summary']));

    // phase enum
    const phase = rf.properties.phase;
    expect(phase.type).toBe('string');
    expect(phase.enum).toEqual(['questions', 'done']);

    // verdicts array
    const verdicts = rf.properties.verdicts;
    expect(verdicts.type).toBe('array');
    const verdictItem = verdicts.items;
    expect(verdictItem.type).toBe('object');
    expect(verdictItem.required).toEqual(expect.arrayContaining(['hypothesisId', 'verdict', 'notes']));
    expect(verdictItem.properties.hypothesisId).toBeDefined();
    expect(verdictItem.properties.verdict).toBeDefined();
    expect(verdictItem.properties.verdict.enum).toEqual(
      expect.arrayContaining(['confirmed', 'denied', 'partially_confirmed', 'needs_more_info'])
    );
    expect(verdictItem.properties.notes).toBeDefined();

    // summary
    expect(rf.properties.summary.type).toBe('string');

    // questions
    expect(rf.properties.questions.type).toBe('array');
    expect(rf.properties.questions.items.type).toBe('string');
  });

  // ========================================================================
  // Test 3: Architect persona tasks array includes "architect--discovery-qa"
  // ========================================================================
  it('should include architect--discovery-qa in the architect persona tasks array after architect--discovery-framing', () => {
    const raw = fs.readFileSync(PERSONA_PATH, 'utf-8');
    const persona = JSON.parse(raw);

    expect(persona.id).toBe('architect');
    expect(Array.isArray(persona.tasks)).toBe(true);
    expect(persona.tasks).toContain('architect--discovery-qa');

    // Verify ordering: discovery-qa comes after discovery-framing
    const framingIndex = persona.tasks.indexOf('architect--discovery-framing');
    const qaIndex = persona.tasks.indexOf('architect--discovery-qa');
    expect(framingIndex).toBeGreaterThanOrEqual(0);
    expect(qaIndex).toBeGreaterThan(framingIndex);
  });

  // ========================================================================
  // Test 4: Prompt file exists and is non-empty with key sections
  // ========================================================================
  it('should have prompt file architect.discovery-qa.task.md that exists, is non-empty, and contains key sections', () => {
    const content = fs.readFileSync(PROMPT_PATH, 'utf-8');

    expect(content.length).toBeGreaterThan(0);

    // Verify key sections from the spec requirements
    expect(content).toContain('YOUR ROLE');
    expect(content).toContain('HYPOTHESIS PRESENTATION');
    expect(content).toContain('QUESTION STRATEGY');
    expect(content).toContain('HANDLING UNCERTAINTY');
    expect(content).toContain('READINESS GATE');
    expect(content).toContain('RESPONSE FORMAT');
    expect(content).toContain('RULES');

    // Verify JSON-only response requirement
    expect(content).toContain('valid JSON');

    // Verify verdict types are documented
    expect(content).toContain('confirmed');
    expect(content).toContain('denied');
    expect(content).toContain('partially_confirmed');
    expect(content).toContain('needs_more_info');

    // Verify phase values are documented
    expect(content).toContain('"questions"');
    expect(content).toContain('"done"');

    // Verify question batch size guidance
    expect(content).toMatch(/2-4/);
  });
});
