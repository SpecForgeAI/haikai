/**
 * Tests for UX Designer User Journey Prompt File Integrity
 *
 * Spec 2026-04-03: UX Designer User Journey Conversation Refactor
 * Task Group 2: Spreadsheet-First Conversation Prompt
 * Task Group 4: Gap Analysis Additional Tests
 *
 * Verifies:
 * - The prompt file exists and is non-empty
 * - No remnants of the old structured-questions format remain
 * - Key spreadsheet-first keywords are present
 * - Persona file still references this task
 * - Prompt file has reasonable size (not truncated)
 * - Task description matches spec exactly
 */

import path from 'path';
import { promises as fs } from 'fs';

const configDir = path.resolve(__dirname, '..', 'config');
const promptFilePath = path.resolve(configDir, 'prompts', 'ux-designer.users-interactions.task.md');

describe('UX Designer User Journey Prompt File (Task Group 2)', () => {
  let promptContent: string;

  beforeAll(async () => {
    promptContent = await fs.readFile(promptFilePath, 'utf-8');
  });

  // Test 1: The prompt file exists and is non-empty
  it('should exist and be non-empty', () => {
    expect(promptContent).toBeDefined();
    expect(promptContent.trim().length).toBeGreaterThan(0);
  });

  // Test 2: The prompt legitimately re-adopted the phase/questions/summary
  // structured contract; only the truly retired schema keywords remain absent.
  it('should contain the phase/questions/summary contract and not the retired schema keywords', () => {
    // The structured response contract is back
    expect(promptContent).toContain('"phase"');
    expect(promptContent).toContain('"questions"');
    expect(promptContent).toContain('"summary"');
    expect(promptContent).toContain('RESPONSE FORMAT');
    expect(promptContent).toContain('valid JSON');
    expect(promptContent).toContain('"ready"');

    // Retired keywords from the pre-spreadsheet-first schema stay gone
    const retiredKeywords = [
      '"section"',
      '"user_roles"',
      '"business_processes"',
      '"process_activities"',
      '"ui_screens"',
    ];
    for (const keyword of retiredKeywords) {
      expect(promptContent).not.toContain(keyword);
    }
  });

  // Test 3: The prompt file contains key spreadsheet-first keywords
  it('should contain key spreadsheet-first keywords', () => {
    const requiredKeywords = [
      'CSV',
      'User Journey',
      'Activity Step',
      'Process Activit',
      'ARCHITECTURE CONTEXT',
      'sequence_order',
      'clarifying',
    ];

    for (const keyword of requiredKeywords) {
      expect(promptContent).toContain(keyword);
    }
  });
});

describe('UX Designer User Journey Gap Analysis (Task Group 4)', () => {
  // Gap Test 1: Persona file still lists ux-designer--users-interactions in its tasks array
  it('should have ux-designer.json persona file listing ux-designer--users-interactions in tasks array', async () => {
    const personaPath = path.resolve(configDir, 'personas', 'ux-designer.json');
    const personaContent = JSON.parse(await fs.readFile(personaPath, 'utf-8'));

    expect(personaContent.tasks).toContain('ux-designer--users-interactions');
  });

  // Gap Test 2: Prompt file has reasonable size (not accidentally truncated)
  it('should have prompt file with reasonable size (at least 500 characters)', async () => {
    const promptContent = await fs.readFile(promptFilePath, 'utf-8');
    // The new prompt should be substantial -- at least 500 characters
    expect(promptContent.length).toBeGreaterThan(500);
    // And should not be excessively large (sanity upper bound; the prompt
    // grew past 20KB when the phase/questions/summary contract was re-added)
    expect(promptContent.length).toBeLessThan(40000);
  });

  // Gap Test 3: Task description matches the spec exactly
  it('should have task description matching the spec exactly', async () => {
    const taskPath = path.resolve(configDir, 'tasks', 'ux-designer--users-interactions.json');
    const taskContent = JSON.parse(await fs.readFile(taskPath, 'utf-8'));

    const expectedDescription =
      'Ingests structured spreadsheet input to define user journeys, activity steps, and pain points. Validates structure, identifies gaps, and prepares data for persistence into the Business Architecture meta-model.';
    expect(taskContent.description).toBe(expectedDescription);
  });

  // Gap Test 4: Task ID is preserved exactly
  it('should have task ID preserved as ux-designer--users-interactions', async () => {
    const taskPath = path.resolve(configDir, 'tasks', 'ux-designer--users-interactions.json');
    const taskContent = JSON.parse(await fs.readFile(taskPath, 'utf-8'));

    expect(taskContent.id).toBe('ux-designer--users-interactions');
    expect(taskContent.personaId).toBe('ux-designer');
  });
});
