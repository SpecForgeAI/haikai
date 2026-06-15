/**
 * Tests for Registry Loader and Context Resolver Interfaces
 *
 * Spec 2026-02-28: Unified Conversation Engine v1 (Backend)
 * Task Group 4: Registry Loader and Context Resolver Interfaces
 *
 * Tests:
 * 1. initializeRegistries() loads all 6 persona definitions into the persona registry map
 * 2. initializeRegistries() loads all ~16 task definitions into the task registry map
 * 3. A persona JSON referencing a non-existent .md file logs a warning and is skipped
 * 4. A task JSON referencing a non-existent persona ID logs a warning and is skipped
 * 5. getPersonaRegistry() returns a Map keyed by persona ID
 * 6. getTaskRegistry() returns a Map keyed by task ID with personaId correctly set
 *
 * Uses the real config files from gateway/src/config/ (created in Task Group 3).
 */

import path from 'path';
import { promises as fs } from 'fs';
import os from 'os';

// Mock the config module to point registryBasePath at the real config directory
// (or a temp directory for negative-path tests)
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

// Mock the logger to capture warn calls and suppress output
const mockLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};
jest.mock('../services/logger', () => ({
  logger: mockLogger,
}));

import {
  initializeRegistries,
  getPersonaRegistry,
  getTaskRegistry,
} from '../services/registryLoader';
import { getContextResolverRegistry } from '../services/contextResolvers';

describe('Registry Loader (Spec 2026-02-28, Task Group 4)', () => {
  beforeEach(() => {
    // Reset to real config directory before each test
    configState.registryBasePath = realConfigDir;
    // Clear mock call history
    mockLogger.debug.mockClear();
    mockLogger.info.mockClear();
    mockLogger.warn.mockClear();
    mockLogger.error.mockClear();
  });

  // ========================================================================
  // Test 1: initializeRegistries() loads all 6 persona definitions
  // ========================================================================
  it('should load all 6 persona definitions into the persona registry', async () => {
    await initializeRegistries();

    const personas = getPersonaRegistry();
    expect(personas).toBeInstanceOf(Map);
    expect(personas.size).toBe(6);

    const expectedPersonaIds = [
      'assistant',
      'product-manager',
      'architect',
      'ux-designer',
      'test-engineer',
      'software-developer',
    ];
    for (const id of expectedPersonaIds) {
      expect(personas.has(id)).toBe(true);
    }
  });

  // ========================================================================
  // Test 2: initializeRegistries() loads all ~16 task definitions
  // ========================================================================
  it('should load all task definitions into the task registry', async () => {
    await initializeRegistries();

    const tasks = getTaskRegistry();
    expect(tasks).toBeInstanceOf(Map);
    // Task files in the config directory grow over time; only assert a
    // reasonable lower bound (no brittle upper bound on task count)
    expect(tasks.size).toBeGreaterThanOrEqual(15);

    // Spot-check a few known task IDs
    const expectedTaskIds = [
      'product-manager--define-product',
      'product-manager--roadmap',
      'architect--define-architecture',
      'architect--oas-spec',
      'product-manager--implement-support',
      'assistant--whats-next',
      'assistant--freeform',
      'test-engineer--test-strategy',
      'ux-designer--ui-domain',
    ];
    for (const id of expectedTaskIds) {
      expect(tasks.has(id)).toBe(true);
    }
  });

  // ========================================================================
  // Test 3: Persona with non-existent .md file is skipped with warning
  // ========================================================================
  it('should skip a persona whose identityPromptRef references a non-existent .md file and log a warning', async () => {
    // Create a temp directory with one valid persona and one invalid persona
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'reg-test-'));
    const personasDir = path.join(tmpDir, 'personas');
    const promptsDir = path.join(tmpDir, 'prompts');
    await fs.mkdir(personasDir, { recursive: true });
    await fs.mkdir(promptsDir, { recursive: true });
    // Also create tasks dir (empty) so task loading does not error
    await fs.mkdir(path.join(tmpDir, 'tasks'), { recursive: true });

    // Valid persona: identity file exists
    const validPersona = {
      id: 'valid-persona',
      displayName: 'Valid',
      color: '#000',
      identityPromptRef: 'prompts/valid.identity.md',
      tasks: [],
      menuLabel: 'Valid',
    };
    await fs.writeFile(path.join(personasDir, 'valid-persona.json'), JSON.stringify(validPersona));
    await fs.writeFile(path.join(promptsDir, 'valid.identity.md'), '# Valid persona identity');

    // Invalid persona: identity file does NOT exist
    const invalidPersona = {
      id: 'invalid-persona',
      displayName: 'Invalid',
      color: '#FFF',
      identityPromptRef: 'prompts/nonexistent.identity.md',
      tasks: [],
      menuLabel: 'Invalid',
    };
    await fs.writeFile(path.join(personasDir, 'invalid-persona.json'), JSON.stringify(invalidPersona));

    // Point config at the temp directory
    configState.registryBasePath = tmpDir;
    mockLogger.warn.mockClear();

    await initializeRegistries();

    const personas = getPersonaRegistry();
    expect(personas.size).toBe(1);
    expect(personas.has('valid-persona')).toBe(true);
    expect(personas.has('invalid-persona')).toBe(false);

    // Verify a warning was logged for the invalid persona
    const warnCalls = mockLogger.warn.mock.calls;
    const skipWarning = warnCalls.find(
      (call: unknown[]) =>
        typeof call[0] === 'string' &&
        call[0].includes('identityPromptRef not found')
    );
    expect(skipWarning).toBeDefined();

    // Cleanup
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // ========================================================================
  // Test 4: Task with non-existent persona ID is skipped with warning
  // ========================================================================
  it('should skip a task whose personaId references a non-existent persona and log a warning', async () => {
    // Create a temp directory with one valid persona and one task referencing a missing persona
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'reg-test-'));
    const personasDir = path.join(tmpDir, 'personas');
    const tasksDir = path.join(tmpDir, 'tasks');
    const promptsDir = path.join(tmpDir, 'prompts');
    await fs.mkdir(personasDir, { recursive: true });
    await fs.mkdir(tasksDir, { recursive: true });
    await fs.mkdir(promptsDir, { recursive: true });

    // Create a valid persona
    const persona = {
      id: 'real-persona',
      displayName: 'Real',
      color: '#000',
      identityPromptRef: 'prompts/real.identity.md',
      tasks: ['real-persona--valid-task'],
      menuLabel: 'Real',
    };
    await fs.writeFile(path.join(personasDir, 'real-persona.json'), JSON.stringify(persona));
    await fs.writeFile(path.join(promptsDir, 'real.identity.md'), '# Real persona identity');

    // Create a valid task (belongs to real persona)
    const validTask = {
      id: 'real-persona--valid-task',
      personaId: 'real-persona',
      menuLabel: 'Valid Task',
      description: 'A valid task',
      mode: 'advisory',
      taskPromptRef: 'prompts/real-persona.valid-task.task.md',
      responseFormat: null,
      contextNeeds: [],
      persistence: 'hub',
      artifacts: [],
      phases: null,
      availableFrom: ['hub'],
    };
    await fs.writeFile(path.join(tasksDir, 'real-persona--valid-task.json'), JSON.stringify(validTask));
    await fs.writeFile(path.join(promptsDir, 'real-persona.valid-task.task.md'), '# Valid task prompt');

    // Create an invalid task (references a persona that does not exist)
    const invalidTask = {
      id: 'ghost-persona--orphan-task',
      personaId: 'ghost-persona',
      menuLabel: 'Orphan Task',
      description: 'An orphaned task',
      mode: 'advisory',
      taskPromptRef: 'prompts/ghost.orphan.task.md',
      responseFormat: null,
      contextNeeds: [],
      persistence: 'hub',
      artifacts: [],
      phases: null,
      availableFrom: ['hub'],
    };
    await fs.writeFile(path.join(tasksDir, 'ghost-persona--orphan-task.json'), JSON.stringify(invalidTask));
    await fs.writeFile(path.join(promptsDir, 'ghost.orphan.task.md'), '# Orphan task prompt');

    configState.registryBasePath = tmpDir;
    mockLogger.warn.mockClear();

    await initializeRegistries();

    const tasks = getTaskRegistry();
    expect(tasks.size).toBe(1);
    expect(tasks.has('real-persona--valid-task')).toBe(true);
    expect(tasks.has('ghost-persona--orphan-task')).toBe(false);

    // Verify a warning was logged for the invalid task
    const warnCalls = mockLogger.warn.mock.calls;
    const skipWarning = warnCalls.find(
      (call: unknown[]) =>
        typeof call[0] === 'string' &&
        call[0].includes('personaId not found')
    );
    expect(skipWarning).toBeDefined();

    // Cleanup
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // ========================================================================
  // Test 5: getPersonaRegistry() returns a Map keyed by persona ID
  // ========================================================================
  it('should return a Map keyed by persona ID from getPersonaRegistry()', async () => {
    await initializeRegistries();

    const personas = getPersonaRegistry();
    expect(personas).toBeInstanceOf(Map);

    // Verify every key matches the persona's id field
    for (const [key, persona] of personas) {
      expect(key).toBe(persona.id);
      expect(typeof persona.displayName).toBe('string');
      expect(typeof persona.color).toBe('string');
      expect(typeof persona.identityPromptRef).toBe('string');
      expect(Array.isArray(persona.tasks)).toBe(true);
      expect(typeof persona.menuLabel).toBe('string');
    }
  });

  // ========================================================================
  // Test 6: getTaskRegistry() returns a Map keyed by task ID with personaId set
  // ========================================================================
  it('should return a Map keyed by task ID with personaId correctly set from getTaskRegistry()', async () => {
    await initializeRegistries();

    const tasks = getTaskRegistry();
    expect(tasks).toBeInstanceOf(Map);

    // Verify every key matches the task's id field and personaId is set
    const personas = getPersonaRegistry();
    for (const [key, task] of tasks) {
      expect(key).toBe(task.id);
      expect(typeof task.personaId).toBe('string');
      expect(task.personaId.length).toBeGreaterThan(0);
      // The personaId should reference a valid persona in the registry
      expect(personas.has(task.personaId)).toBe(true);
      // Verify core task fields are present
      expect(typeof task.menuLabel).toBe('string');
      expect(typeof task.description).toBe('string');
      expect(['discovery', 'advisory', 'workflow', 'assessment']).toContain(task.mode);
      expect(typeof task.taskPromptRef).toBe('string');
    }
  });

  // ========================================================================
  // Context Resolver Registry: populated during initializeRegistries()
  // ========================================================================
  it('should populate the context resolver registry with stub resolvers during initializeRegistries()', async () => {
    await initializeRegistries();

    const resolvers = getContextResolverRegistry();
    expect(resolvers).toBeInstanceOf(Map);
    expect(resolvers.size).toBeGreaterThanOrEqual(6);

    const expectedKeys = [
      'mission',
      'tech-stack',
      'roadmap-summary',
      'meta-model-summary',
      'product-summary',
      'existing-roadmap',
    ];
    for (const key of expectedKeys) {
      expect(resolvers.has(key)).toBe(true);
      // Stub resolvers should return empty strings
      const resolver = resolvers.get(key)!;
      const result = await resolver.resolve('test-project', 'project:test-project:hub');
      expect(result).toBe('');
    }
  });
});
