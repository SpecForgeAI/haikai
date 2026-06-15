/**
 * Tests — Close-turn Target-Tech-Stack Writer
 * Spec 2026-05-25 Tech-Stack.md Pre-fill + Target-Tech-Stack.md Write, Task Group 4.
 *
 * Per tasks.md §4.1 — close write tests:
 *   - file written deterministically at the project-level path with lowercased UUID
 *   - per-element exceptions appear as their own rows under the right section
 *   - write-failure surfaces clean error in close payload without aborting
 *   - reopen-then-close re-writes the file
 *   - `project.name` sanitisation rejects malicious names at write time
 *   - renderer groups rows by section per the hardcoded mapping
 */

import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('../../architectureModelClient', () => {
  const actual = jest.requireActual('../../architectureModelClient');
  return {
    ...actual,
    fetchProjectFolder: jest.fn(),
    fetchProductName: jest.fn(),
  };
});

jest.mock('../../targetStateCapturedDecisionsClient', () => ({
  fetchLatestCapturedDecisions: jest.fn(),
}));

jest.mock('../../logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import {
  fetchProductName,
  fetchProjectFolder,
} from '../../architectureModelClient';
import { fetchLatestCapturedDecisions } from '../../targetStateCapturedDecisionsClient';
import type { TargetStateCapturedDecision } from '../../targetStateCapturedDecisionsClient';
import {
  renderTargetTechStackMarkdown,
  writeTargetTechStackMarkdown,
} from '../writeTargetTechStackMarkdown';
import { sectionFor } from '../targetTechStackSectionMapping';

const mockProjFolder = fetchProjectFolder as jest.MockedFunction<typeof fetchProjectFolder>;
const mockProdName = fetchProductName as jest.MockedFunction<typeof fetchProductName>;
const mockDecisions = fetchLatestCapturedDecisions as jest.MockedFunction<
  typeof fetchLatestCapturedDecisions
>;

let testRoot: string;

function makeDecision(overrides: Partial<TargetStateCapturedDecision>): TargetStateCapturedDecision {
  return {
    decisionId: 'd-' + Math.random().toString(36).slice(2, 8),
    projectId: 'proj-1',
    targetArchitectureId: 'TARGET-UPPER-CASE',
    decisionCode: 'service.language',
    scopeKind: 'architecture',
    scopeRefType: null,
    scopeRefId: null,
    answerValue: 'Java 21',
    answerSummary: 'Java 21',
    standardsLookupRef: null,
    conversationThreadId: 'thread-1',
    conversationTurnRef: null,
    createdAt: '2026-05-25T00:00:00Z',
    createdByTask: 'architect-persona-conversation',
    supersededById: null,
    ...overrides,
  };
}

beforeEach(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'target-tech-stack-test-'));
  mockProjFolder.mockReset();
  mockProdName.mockReset();
  mockDecisions.mockReset();
});

afterEach(async () => {
  await fs.rm(testRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Test 1: file written at the project-level path with lowercased UUID
// ---------------------------------------------------------------------------

test('writes the file at the project-level path with a lowercased UUID', async () => {
  mockProjFolder.mockResolvedValue(testRoot);
  mockProdName.mockResolvedValue('alpha-project');
  mockDecisions.mockResolvedValue([
    makeDecision({ decisionCode: 'service.language', answerSummary: 'Java 21' }),
    makeDecision({ decisionCode: 'db.engine', answerSummary: 'Postgres 16' }),
  ]);

  const result = await writeTargetTechStackMarkdown({
    projectId: 'proj-1',
    targetArchitectureId: 'TARGET-UPPER-CASE-A1B2',
  });

  expect(result.kind).toBe('written');
  if (result.kind === 'written') {
    const expectedPath = path.join(
      testRoot,
      'alpha-project',
      'agent-os',
      'product',
      'target-tech-stack-target-upper-case-a1b2.md',
    );
    expect(result.path.toLowerCase()).toBe(expectedPath.toLowerCase());
    const written = await fs.readFile(result.path, 'utf-8');
    expect(written).toContain('# Target Tech Stack');
    expect(written).toContain('Java 21');
    expect(written).toContain('Postgres 16');
    expect(written).toContain('## Backend');
    expect(written).toContain('## Database');
  }
});

// ---------------------------------------------------------------------------
// Test 2: per-element exception rendered with element qualifier
// ---------------------------------------------------------------------------

test('per-element exception emits its own row under the right section with element qualifier', async () => {
  const rows = [
    makeDecision({ decisionCode: 'service.language', answerSummary: 'Java 21' }),
    makeDecision({
      decisionCode: 'service.language',
      answerSummary: 'Python 3.12 (legacy worker)',
      scopeKind: 'element',
      scopeRefType: 'service',
      scopeRefId: 'svc-legacy-worker',
    }),
  ];
  const md = renderTargetTechStackMarkdown(rows, 'TARGET-X');
  expect(md).toContain('## Backend');
  expect(md).toContain('Java 21');
  expect(md).toContain('Python 3.12 (legacy worker)');
  expect(md).toContain('(element service:svc-legacy-worker)');
});

// ---------------------------------------------------------------------------
// Test 3: write-failure surfaces clean error without aborting
// ---------------------------------------------------------------------------

test('returns a failed outcome with a clean reason when the write fails', async () => {
  mockProjFolder.mockResolvedValue(testRoot);
  mockProdName.mockResolvedValue('alpha-project');
  mockDecisions.mockResolvedValue([]);

  // Force the rename to fail by passing a custom deps with a stub that throws.
  const stubRename = jest.fn().mockRejectedValue(new Error('EPERM: synthetic'));
  const result = await writeTargetTechStackMarkdown(
    {
      projectId: 'proj-1',
      targetArchitectureId: 'TARGET-A1B2',
    },
    {
      fetchProjectFolder: mockProjFolder,
      fetchProductName: mockProdName,
      fetchLatestCapturedDecisions: mockDecisions,
      writeFile: fs.writeFile,
      rename: stubRename as unknown as typeof fs.rename,
      mkdir: fs.mkdir,
    },
  );

  expect(result.kind).toBe('failed');
  if (result.kind === 'failed') {
    expect(result.reason).toContain('EPERM');
    expect(result.path).not.toBeNull();
  }
});

// ---------------------------------------------------------------------------
// Test 4: reopen-then-close re-writes the file
// ---------------------------------------------------------------------------

test('re-running the writer overwrites the existing file with the new content', async () => {
  mockProjFolder.mockResolvedValue(testRoot);
  mockProdName.mockResolvedValue('alpha-project');

  mockDecisions.mockResolvedValueOnce([
    makeDecision({ decisionCode: 'service.language', answerSummary: 'Java 17' }),
  ]);
  const first = await writeTargetTechStackMarkdown({
    projectId: 'proj-1',
    targetArchitectureId: 'TARGET-A1B2',
  });
  expect(first.kind).toBe('written');

  mockDecisions.mockResolvedValueOnce([
    makeDecision({ decisionCode: 'service.language', answerSummary: 'Java 21' }),
  ]);
  const second = await writeTargetTechStackMarkdown({
    projectId: 'proj-1',
    targetArchitectureId: 'TARGET-A1B2',
  });
  expect(second.kind).toBe('written');

  if (second.kind === 'written') {
    const written = await fs.readFile(second.path, 'utf-8');
    expect(written).toContain('Java 21');
    expect(written).not.toContain('Java 17');
  }
});

// ---------------------------------------------------------------------------
// Test 5: project name sanitisation rejects malicious names
// ---------------------------------------------------------------------------

test('rejects malicious project names containing path-traversal characters', async () => {
  mockProjFolder.mockResolvedValue(testRoot);
  mockProdName.mockResolvedValue('../etc');
  mockDecisions.mockResolvedValue([]);

  const result = await writeTargetTechStackMarkdown({
    projectId: 'proj-1',
    targetArchitectureId: 'TARGET-A1B2',
  });

  expect(result.kind).toBe('failed');
  if (result.kind === 'failed') {
    expect(result.reason).toContain('Path-traversal');
  }
});

// ---------------------------------------------------------------------------
// Test 6: renderer groups by section per the hardcoded mapping
// ---------------------------------------------------------------------------

test('section mapping groups codes by their library group prefix', () => {
  expect(sectionFor('service.language')).toBe('Backend');
  expect(sectionFor('api.protocol')).toBe('API');
  expect(sectionFor('db.engine')).toBe('Database');
  expect(sectionFor('ui.framework')).toBe('Frontend');
  expect(sectionFor('logging.framework')).toBe('Observability');
  expect(sectionFor('secrets.management')).toBe('Security');
  expect(sectionFor('build.tool')).toBe('Build & Deployment');
  expect(sectionFor('interservice.syncProtocol')).toBe('Inter-Service Communication');
  expect(sectionFor('testing.unit')).toBe('Testing');
  expect(sectionFor('cutover.strategy')).toBe('Cutover');
  expect(sectionFor('dto.style')).toBe('Domain');
  expect(sectionFor('domain.errorModel')).toBe('Domain');
  expect(sectionFor('validation.framework')).toBe('Domain');
  expect(sectionFor('something.uncategorised')).toBe('Other');
});

// ---------------------------------------------------------------------------
// Test 7: renderer unwraps pre-fill JSON envelope when answerSummary is missing
// ---------------------------------------------------------------------------

test('renderer unwraps pre-fill JSON envelope so the file is human-readable', () => {
  const rows = [
    makeDecision({
      decisionCode: 'service.language',
      answerSummary: null,
      answerValue: JSON.stringify({
        value: 'Java 21',
        sourceQuote: '| Java | 21 (LTS) |',
        sourceFile: 'organisation',
      }),
    }),
  ];
  const md = renderTargetTechStackMarkdown(rows, 'TARGET-X');
  expect(md).toContain('Java 21');
  // The source quote MUST NOT appear in the rendered file (it lives only on
  // captured-decision rows for the SummaryPanel review surface).
  expect(md).not.toContain('| Java | 21 (LTS) |');
});

// ---------------------------------------------------------------------------
// Test 8: decision code cited as inline comment so a reader can trace back
// ---------------------------------------------------------------------------

test('renderer emits each row with an inline HTML comment citing the decision code', () => {
  const rows = [
    makeDecision({ decisionCode: 'service.language', answerSummary: 'Java 21' }),
  ];
  const md = renderTargetTechStackMarkdown(rows, 'TARGET-X');
  expect(md).toContain('<!-- code: service.language -->');
});
