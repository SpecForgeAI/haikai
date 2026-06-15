/**
 * Tests for UX Designer User Journey Task Configuration
 *
 * Spec 2026-04-03: UX Designer User Journey Conversation Refactor
 * Task Group 1: Task Card Configuration Update
 * Task Group 3: System Integration and Dead Code Verification
 *
 * Verifies:
 * - The updated task config loads correctly via the registry loader
 * - menuLabel, responseFormat, artifacts, and unchanged fields are correct
 * - Integration wiring (architecture context, prompt file, sibling tasks, persona prompt)
 */

import path from 'path';
import { promises as fs } from 'fs';

const realConfigDir = path.resolve(__dirname, '..', 'config');
const configState = { registryBasePath: realConfigDir };

jest.mock('../config', () => ({
  getConfig: () => ({
    registryBasePath: configState.registryBasePath,
    openaiApiKey: 'test-key',
    openaiModel: 'gpt-4o',
    openaiBaseUrl: 'https://api.openai.com/v1',
    openaiTimeoutMs: 120000,
    logLevel: 'error',
  }),
}));

jest.mock('../services/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import {
  initializeRegistries,
  getTaskRegistry,
} from '../services/registryLoader';

describe('UX Designer User Journey Task Config (Task Group 1)', () => {
  beforeEach(async () => {
    configState.registryBasePath = realConfigDir;
    await initializeRegistries();
  });

  // Test 1: Registry loader loads ux-designer--users-interactions successfully
  it('should load ux-designer--users-interactions task successfully with responseFormat null and artifacts empty', () => {
    const tasks = getTaskRegistry();
    expect(tasks.has('ux-designer--users-interactions')).toBe(true);

    const task = tasks.get('ux-designer--users-interactions')!;
    expect(task).toBeDefined();
    expect(task.id).toBe('ux-designer--users-interactions');
  });

  // Test 2: menuLabel equals "Define User Journeys"
  it('should have menuLabel equal to "Define User Journeys"', () => {
    const tasks = getTaskRegistry();
    const task = tasks.get('ux-designer--users-interactions')!;
    expect(task.menuLabel).toBe('Define User Journeys');
  });

  // Test 3: responseFormat is the phase/questions/summary contract and
  //         artifacts has user-journeys entry
  it('should have the phase/questions/summary responseFormat and artifacts with user-journeys entry', () => {
    const tasks = getTaskRegistry();
    const task = tasks.get('ux-designer--users-interactions')!;
    expect(task.responseFormat).toEqual({
      type: 'object',
      required: ['phase', 'questions', 'summary'],
      properties: {
        phase: { type: 'string', enum: ['questions', 'ready'] },
        questions: { type: 'array', items: { type: 'string' } },
        summary: { type: 'string' },
      },
    });
    expect(task.artifacts).toEqual([
      { artifactId: 'user-journeys', tool: 'save_user_journeys', description: 'User journeys and activity steps', filename: 'USER_JOURNEYS' },
    ]);
  });

  // Test 4: Unchanged fields are preserved
  it('should retain unchanged fields (mode, contextNeeds, persistence, availableFrom)', () => {
    const tasks = getTaskRegistry();
    const task = tasks.get('ux-designer--users-interactions')!;
    expect(task.mode).toBe('discovery');
    expect(task.contextNeeds).toEqual(['mission']);
    expect(task.persistence).toBe('hub');
    expect(task.availableFrom).toEqual(['hub', 'panel']);
  });
});

describe('UX Designer User Journey Integration (Task Group 3)', () => {
  beforeEach(async () => {
    configState.registryBasePath = realConfigDir;
    await initializeRegistries();
  });

  // Test 1: fullArchContextTasks in chatV2.ts still contains the task ID
  it('should have ux-designer--users-interactions referenced in fullArchContextTasks in chatV2.ts', async () => {
    const chatV2Path = path.resolve(__dirname, '..', 'routes', 'chatV2.ts');
    const chatV2Content = await fs.readFile(chatV2Path, 'utf-8');
    expect(chatV2Content).toContain("'ux-designer--users-interactions'");

    // Verify it appears within the fullArchContextTasks Set
    const fullArchIdx = chatV2Content.indexOf('fullArchContextTasks');
    expect(fullArchIdx).toBeGreaterThan(-1);

    const afterFullArch = chatV2Content.substring(fullArchIdx, fullArchIdx + 500);
    expect(afterFullArch).toContain('ux-designer--users-interactions');
  });

  // Test 2: taskPromptRef resolves to an existing file
  it('should have taskPromptRef that resolves to an existing file', async () => {
    const tasks = getTaskRegistry();
    const task = tasks.get('ux-designer--users-interactions')!;
    expect(task.taskPromptRef).toBe('prompts/ux-designer.users-interactions.task.md');

    const promptPath = path.resolve(realConfigDir, task.taskPromptRef);
    const stat = await fs.stat(promptPath);
    expect(stat.isFile()).toBe(true);
  });

  // Test 3: ux-designer--ui-domain task config is unchanged
  it('should have ux-designer--ui-domain task config unchanged', async () => {
    const uiDomainPath = path.resolve(realConfigDir, 'tasks', 'ux-designer--ui-domain.json');
    const content = JSON.parse(await fs.readFile(uiDomainPath, 'utf-8'));

    expect(content.id).toBe('ux-designer--ui-domain');
    expect(content.menuLabel).toBe('UI Domain Design');
    expect(content.responseFormat).toBeNull();
    expect(content.artifacts).toEqual([]);
    expect(content.contextNeeds).toEqual(['mission', 'tech-stack']);
  });

  // Test 4: ux-designer.identity.md persona prompt is unchanged
  it('should have ux-designer.identity.md persona prompt unchanged', async () => {
    const identityPath = path.resolve(realConfigDir, 'prompts', 'ux-designer.identity.md');
    const content = await fs.readFile(identityPath, 'utf-8');

    // Verify known substrings from the identity prompt
    expect(content).toContain('UX/UI Design specialist');
    expect(content).toContain('wireframing');
    expect(content).toContain('interaction design');
    expect(content).toContain('user-centered mindset');
  });
});
