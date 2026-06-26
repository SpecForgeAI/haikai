/**
 * Tests — Target-Tech-Stack Context Resolver
 * Spec 2026-05-25 Tech-Stack.md Pre-fill + Target-Tech-Stack.md Write, Task Group 4.
 *
 * Per tasks.md §4.1 — resolver tests:
 *   - Resolver returns raw markdown when the file exists
 *   - Resolver returns distinct "no migration target tech stack written yet"
 *     message when the file is absent
 *   - Resolver scopes the read via fetchMostRecentSavedTargetArchitectureId
 *   - Per-invocation cache hits do not re-read
 *   - Existing TechStackContextResolver behaviour unchanged (file-presence
 *     assertion)
 *   - Registry lookup of 'target-tech-stack-context' resolves to the new
 *     resolver and the key appears in KNOWN_CONTEXT_KEYS
 */

jest.mock('../config', () => ({
  getConfig: () => ({
    architectureModelServiceBaseUrl: 'http://localhost:8080',
  }),
  resetConfig: jest.fn(),
}));

jest.mock('../services/architectureModelClient', () => {
  const actual = jest.requireActual('../services/architectureModelClient');
  return {
    ...actual,
    fetchProjectFolder: jest.fn(),
    fetchProductName: jest.fn(),
  };
});

jest.mock('../services/targetStateCapturedDecisionsClient', () => ({
  fetchActiveTargetArchitectureId: jest.fn(),
  fetchMostRecentSavedTargetArchitectureId: jest.fn(),
  fetchLatestCapturedDecisions: jest.fn(),
}));

jest.mock('../services/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  fetchProductName,
  fetchProjectFolder,
} from '../services/architectureModelClient';
import { fetchMostRecentSavedTargetArchitectureId } from '../services/targetStateCapturedDecisionsClient';
import {
  TargetTechStackContextResolver,
  TechStackContextResolver,
  getContextResolverRegistry,
  getKnownContextKeys,
  initializeContextResolverRegistry,
} from '../services/contextResolvers';

const mockProjFolder = fetchProjectFolder as jest.MockedFunction<typeof fetchProjectFolder>;
const mockProdName = fetchProductName as jest.MockedFunction<typeof fetchProductName>;
const mockActiveTarget = fetchMostRecentSavedTargetArchitectureId as jest.MockedFunction<
  typeof fetchMostRecentSavedTargetArchitectureId
>;

let testRoot: string;

beforeEach(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'target-tech-stack-resolver-test-'));
  mockProjFolder.mockReset();
  mockProdName.mockReset();
  mockActiveTarget.mockReset();
  initializeContextResolverRegistry();
});

afterEach(async () => {
  await fs.rm(testRoot, { recursive: true, force: true });
});

async function writeTargetFile(projectName: string, lowercasedUuid: string, content: string): Promise<string> {
  const dir = path.join(testRoot, projectName, 'agent-os', 'product');
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `target-tech-stack-${lowercasedUuid}.md`);
  await fs.writeFile(filePath, content, 'utf-8');
  return filePath;
}

// ---------------------------------------------------------------------------
// Test 1: file exists → raw markdown returned
// ---------------------------------------------------------------------------

test('returns raw markdown when the target-tech-stack file exists', async () => {
  mockActiveTarget.mockResolvedValue({ savedTargetArchitectureId: 'TARGET-A1B2' });
  mockProjFolder.mockResolvedValue(testRoot);
  mockProdName.mockResolvedValue('alpha-project');

  await writeTargetFile('alpha-project', 'target-a1b2', '# Target Tech Stack\n\n## Backend\n- Java 21');

  const resolver = new TargetTechStackContextResolver();
  const content = await resolver.resolve('proj-1', 'thread-key');

  expect(content).toContain('# Target Tech Stack');
  expect(content).toContain('Java 21');
});

// ---------------------------------------------------------------------------
// Test 2: file absent → distinct miss message
// ---------------------------------------------------------------------------

test('returns the distinct "no migration target tech stack written yet" message when the file is absent', async () => {
  mockActiveTarget.mockResolvedValue({ savedTargetArchitectureId: 'TARGET-A1B2' });
  mockProjFolder.mockResolvedValue(testRoot);
  mockProdName.mockResolvedValue('alpha-project');
  // No file written.

  const resolver = new TargetTechStackContextResolver();
  const content = await resolver.resolve('proj-1', 'thread-key');

  expect(content).toBe('no migration target tech stack written yet');
});

// ---------------------------------------------------------------------------
// Test 3: no active target architecture id → distinct miss message
// ---------------------------------------------------------------------------

test('returns miss message when no active target architecture id exists', async () => {
  mockActiveTarget.mockResolvedValue({ savedTargetArchitectureId: null });

  const resolver = new TargetTechStackContextResolver();
  const content = await resolver.resolve('proj-1', 'thread-key');

  expect(content).toBe('no migration target tech stack written yet');
});

// ---------------------------------------------------------------------------
// Test 4: per-invocation cache hit does not re-read
// ---------------------------------------------------------------------------

test('per-invocation cache: a second resolve on the same instance does not re-read', async () => {
  mockActiveTarget.mockResolvedValue({ savedTargetArchitectureId: 'TARGET-A1B2' });
  mockProjFolder.mockResolvedValue(testRoot);
  mockProdName.mockResolvedValue('alpha-project');

  const filePath = await writeTargetFile('alpha-project', 'target-a1b2', '# Original Content');

  const resolver = new TargetTechStackContextResolver();
  const first = await resolver.resolve('proj-1', 'thread-key');
  expect(first).toContain('Original Content');

  // Mutate the file on disk between calls.
  await fs.writeFile(filePath, '# Different Content', 'utf-8');

  // Second resolve should hit the per-invocation cache and return the
  // original content — proving no re-read.
  const second = await resolver.resolve('proj-1', 'thread-key');
  expect(second).toContain('Original Content');
  expect(second).not.toContain('Different Content');
});

// ---------------------------------------------------------------------------
// Test 5: path-traversal sanitisation rejects malicious project names
// ---------------------------------------------------------------------------

test('sanitises the project name and returns a fail-soft string on path-traversal attempts', async () => {
  mockActiveTarget.mockResolvedValue({ savedTargetArchitectureId: 'TARGET-A1B2' });
  mockProjFolder.mockResolvedValue(testRoot);
  mockProdName.mockResolvedValue('../etc');

  const resolver = new TargetTechStackContextResolver();
  const content = await resolver.resolve('proj-1', 'thread-key');

  expect(content).toContain('Path-traversal');
});

// ---------------------------------------------------------------------------
// Test 6: registry registration + KNOWN_CONTEXT_KEYS
// ---------------------------------------------------------------------------

test('target-tech-stack-context appears in KNOWN_CONTEXT_KEYS and the registry binds it to the new resolver', () => {
  const keys = getKnownContextKeys();
  expect(keys).toContain('target-tech-stack-context');

  const registry = getContextResolverRegistry();
  const resolver = registry.get('target-tech-stack-context');
  expect(resolver).toBeInstanceOf(TargetTechStackContextResolver);
});

// ---------------------------------------------------------------------------
// Test 7: existing TechStackContextResolver behaviour unchanged
// ---------------------------------------------------------------------------

test('existing TechStackContextResolver still reads only the organisation-level file', async () => {
  mockProjFolder.mockResolvedValue(testRoot);
  // Write the OLD-style organisation-level file.
  const dir = path.join(testRoot, 'agent-os', 'product');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'tech-stack.md'), '# Org Tech Stack', 'utf-8');

  const resolver = new TechStackContextResolver();
  const content = await resolver.resolve('proj-1', 'thread-key');
  expect(content).toContain('# Org Tech Stack');
});
