/**
 * Tests for Architecture Diagram Generation task registration and prompt loading
 *
 * Spec 2026-03-26: Architecture Diagram Generation Task Framework
 * Task Group 1: Task Definition, Persona Registration, and Prompt Files
 *
 * Tests:
 * 1. Verify architect--generate-architecture-diagram.json loads from disk and has required fields
 * 2. Verify architect.json persona tasks array contains the new task ID
 * 3. Verify the task prompt file loads and contains key markers
 */

import * as fs from 'fs';
import * as path from 'path';

const CONFIG_DIR = path.resolve(__dirname, '..', 'config');

const TASK_DEF_PATH = path.resolve(
  CONFIG_DIR,
  'tasks',
  'architect--generate-architecture-diagram.json'
);

const PERSONA_PATH = path.resolve(
  CONFIG_DIR,
  'personas',
  'architect.json'
);

const TASK_PROMPT_PATH = path.resolve(
  CONFIG_DIR,
  'prompts',
  'architect.generate-architecture-diagram.task.md'
);

describe('Architecture Diagram Generation Task Registration (Spec 2026-03-26, Task Group 1)', () => {
  // ========================================================================
  // Test 1: Task JSON loads and has required fields
  // ========================================================================
  it('should load architect--generate-architecture-diagram.json with all required fields', () => {
    const raw = fs.readFileSync(TASK_DEF_PATH, 'utf-8');
    const taskDef = JSON.parse(raw);

    expect(taskDef.id).toBe('architect--generate-architecture-diagram');
    expect(taskDef.personaId).toBe('architect');
    expect(taskDef.mode).toBe('workflow');
    // Task now carries a structured responseFormat contract
    // (phase / section [configuration|confirmation] / questions / summary)
    expect(taskDef.responseFormat).toEqual({
      type: 'object',
      required: ['phase', 'questions', 'summary'],
      properties: {
        phase: { type: 'string', enum: ['questions', 'ready'] },
        section: { type: 'string', enum: ['configuration', 'confirmation'] },
        questions: { type: 'array', items: { type: 'string' } },
        summary: { type: 'string' },
      },
    });
    expect(taskDef.persistence).toBe('panel');
    expect(taskDef.availableFrom).toEqual(['panel']);
    expect(taskDef.menuLabel).toBe('Generate ER Diagram');
    expect(typeof taskDef.description).toBe('string');
    expect(taskDef.description.length).toBeGreaterThan(0);
    expect(taskDef.taskPromptRef).toBe('prompts/architect.generate-architecture-diagram.task.md');
    expect(taskDef.contextNeeds).toEqual([]);
    expect(taskDef.artifacts).toEqual([]);
    expect(taskDef.phases).toBeNull();
  });

  // ========================================================================
  // Test 2: Architect persona tasks array contains the new task ID
  // ========================================================================
  it('should include architect--generate-architecture-diagram in the architect persona tasks array', () => {
    const raw = fs.readFileSync(PERSONA_PATH, 'utf-8');
    const persona = JSON.parse(raw);

    expect(persona.id).toBe('architect');
    expect(Array.isArray(persona.tasks)).toBe(true);
    expect(persona.tasks).toContain('architect--generate-architecture-diagram');
  });

  // ========================================================================
  // Test 3: Task prompt file loads and contains key markers
  // ========================================================================
  it('should load the task prompt file containing 4 questions and the json:temporaryArchitectureDiagram tag', () => {
    const content = fs.readFileSync(TASK_PROMPT_PATH, 'utf-8');

    // Verify the 4 questions are present
    expect(content).toContain('Should this be a logical or physical ER diagram?');
    expect(content).toContain('Which entities should be included: all entities or a specific subset?');
    expect(content).toContain('Which attributes should be shown: all, none, or key attributes (primary and foreign keys)?');
    expect(content).toContain('Should relationship cardinalities be shown?');

    // Verify the fenced code block tag instruction
    expect(content).toContain('json:temporaryArchitectureDiagram');

    // Verify key behavioral rules are present (prompt was rewritten around the
    // phase/section/questions/summary contract; old "stop" wording is gone)
    expect(content).toContain('Do not proceed until all answers are clear');
    expect(content).toContain('_points');
    expect(content).toContain('EXACT');
    expect(content).toContain('version = 1');
    expect(content).toContain('source_architecture_domain');
  });
});
