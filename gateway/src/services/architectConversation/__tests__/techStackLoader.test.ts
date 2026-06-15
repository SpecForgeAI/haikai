/**
 * Tests — Two-file Tech-Stack Loader
 * Spec 2026-05-25 Tech-Stack.md Pre-fill + Target-Tech-Stack.md Write, Task Group 1.
 *
 * Per tasks.md §1.1 — 4-8 focused tests covering:
 *   1. Both files present returns both markdowns + both paths
 *   2. Only org present returns org with `projectMarkdown: null`
 *   3. Only project present returns project with `orgMarkdown: null`
 *   4. Neither present returns both null
 *   5. `project.name` containing `..` rejected with InvalidProjectFolderNameError
 *   6. Oversized file (>50K chars) truncated, `*Truncated` flag set
 *   7. Lowercase + uppercase filename variants both resolved
 *
 * AMS calls (`fetchProjectFolder`, `fetchProductName`) are mocked at the
 * `architectureModelClient` import boundary.
 */

import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Mocks BEFORE imports of the units under test.
// ---------------------------------------------------------------------------

jest.mock('../../architectureModelClient', () => {
  const actual = jest.requireActual('../../architectureModelClient');
  return {
    ...actual,
    fetchProjectFolder: jest.fn(),
    fetchProductName: jest.fn(),
  };
});

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
import {
  TECH_STACK_MARKDOWN_MAX_CHARS,
  loadTechStackMarkdown,
} from '../techStackLoader';
import { InvalidProjectFolderNameError } from '../projectNameSanitiser';

const mockFetchProjectFolder = fetchProjectFolder as jest.MockedFunction<
  typeof fetchProjectFolder
>;
const mockFetchProductName = fetchProductName as jest.MockedFunction<
  typeof fetchProductName
>;

// ---------------------------------------------------------------------------
// Test fixture root: a per-test temporary directory the loader treats as the
// organisation root.
// ---------------------------------------------------------------------------

let testRoot: string;

async function writeOrgFile(content: string, filename: string = 'tech-stack.md'): Promise<string> {
  const dir = path.join(testRoot, 'agent-os', 'product');
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, filename);
  await fs.writeFile(filePath, content, 'utf-8');
  return filePath;
}

async function writeProjectFile(
  projectName: string,
  content: string,
  filename: string = 'tech-stack.md',
): Promise<string> {
  const dir = path.join(testRoot, projectName, 'agent-os', 'product');
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, filename);
  await fs.writeFile(filePath, content, 'utf-8');
  return filePath;
}

/**
 * Compare two resolved file paths in a case-insensitive way so the assertion
 * passes on both POSIX (which preserves the test-input filename casing) and
 * Windows (which is case-insensitive — the loader's uppercase-first lookup
 * may resolve to `TECH-STACK.MD` even though the test wrote `tech-stack.md`).
 * The loader contract is "the path that resolved to the file content" — both
 * variants identify the same on-disk content on case-insensitive filesystems.
 */
function assertSameFile(actual: string | null, expected: string): void {
  expect(actual).not.toBeNull();
  expect(actual!.toLowerCase()).toBe(expected.toLowerCase());
}

beforeEach(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tech-stack-loader-test-'));
  mockFetchProjectFolder.mockReset();
  mockFetchProductName.mockReset();
});

afterEach(async () => {
  await fs.rm(testRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Test 1: both files present
// ---------------------------------------------------------------------------

test('returns both markdowns + both paths when both files exist', async () => {
  mockFetchProjectFolder.mockResolvedValue(testRoot);
  mockFetchProductName.mockResolvedValue('alpha-project');

  const orgPath = await writeOrgFile('# Organisation Standards\n- Java 21');
  const projectPath = await writeProjectFile(
    'alpha-project',
    '# Project Standards\n- Java 21, Spring Boot 3',
  );

  const result = await loadTechStackMarkdown('proj-1');

  expect(result.orgMarkdown).toContain('Organisation Standards');
  expect(result.projectMarkdown).toContain('Project Standards');
  assertSameFile(result.orgPath, orgPath);
  assertSameFile(result.projectPath, projectPath);
  expect(result.orgTruncated).toBe(false);
  expect(result.projectTruncated).toBe(false);
});

// ---------------------------------------------------------------------------
// Test 2: only org present
// ---------------------------------------------------------------------------

test('returns org markdown with projectMarkdown null when only org file exists', async () => {
  mockFetchProjectFolder.mockResolvedValue(testRoot);
  mockFetchProductName.mockResolvedValue('alpha-project');

  await writeOrgFile('# Organisation Standards');

  const result = await loadTechStackMarkdown('proj-1');

  expect(result.orgMarkdown).toContain('Organisation Standards');
  expect(result.projectMarkdown).toBeNull();
  expect(result.orgPath).not.toBeNull();
  expect(result.projectPath).toBeNull();
});

// ---------------------------------------------------------------------------
// Test 3: only project present
// ---------------------------------------------------------------------------

test('returns project markdown with orgMarkdown null when only project file exists', async () => {
  mockFetchProjectFolder.mockResolvedValue(testRoot);
  mockFetchProductName.mockResolvedValue('alpha-project');

  await writeProjectFile('alpha-project', '# Project Standards');

  const result = await loadTechStackMarkdown('proj-1');

  expect(result.orgMarkdown).toBeNull();
  expect(result.projectMarkdown).toContain('Project Standards');
  expect(result.orgPath).toBeNull();
  expect(result.projectPath).not.toBeNull();
});

// ---------------------------------------------------------------------------
// Test 4: neither file present
// ---------------------------------------------------------------------------

test('returns both null when no tech-stack files exist', async () => {
  mockFetchProjectFolder.mockResolvedValue(testRoot);
  mockFetchProductName.mockResolvedValue('alpha-project');

  const result = await loadTechStackMarkdown('proj-1');

  expect(result.orgMarkdown).toBeNull();
  expect(result.projectMarkdown).toBeNull();
  expect(result.orgPath).toBeNull();
  expect(result.projectPath).toBeNull();
  expect(result.orgTruncated).toBe(false);
  expect(result.projectTruncated).toBe(false);
});

// ---------------------------------------------------------------------------
// Test 5: malicious project.name rejected
// ---------------------------------------------------------------------------

test('rejects project.name containing path-traversal characters', async () => {
  mockFetchProjectFolder.mockResolvedValue(testRoot);
  mockFetchProductName.mockResolvedValue('../../etc');

  await expect(loadTechStackMarkdown('proj-1')).rejects.toBeInstanceOf(
    InvalidProjectFolderNameError,
  );
});

test('rejects project.name containing forward slash', async () => {
  mockFetchProjectFolder.mockResolvedValue(testRoot);
  mockFetchProductName.mockResolvedValue('alpha/beta');

  await expect(loadTechStackMarkdown('proj-1')).rejects.toBeInstanceOf(
    InvalidProjectFolderNameError,
  );
});

// ---------------------------------------------------------------------------
// Test 6: oversized file truncated with flag set
// ---------------------------------------------------------------------------

test('truncates files larger than 50K chars and sets the *Truncated flag', async () => {
  mockFetchProjectFolder.mockResolvedValue(testRoot);
  mockFetchProductName.mockResolvedValue('alpha-project');

  const oversize = 'x'.repeat(TECH_STACK_MARKDOWN_MAX_CHARS + 10_000);
  await writeOrgFile(oversize);

  const result = await loadTechStackMarkdown('proj-1');

  expect(result.orgMarkdown).not.toBeNull();
  expect(result.orgMarkdown!.length).toBe(TECH_STACK_MARKDOWN_MAX_CHARS);
  expect(result.orgTruncated).toBe(true);
});

// ---------------------------------------------------------------------------
// Test 7: uppercase + lowercase filename variants both resolved
// ---------------------------------------------------------------------------

test('resolves uppercase filename variant for org file', async () => {
  mockFetchProjectFolder.mockResolvedValue(testRoot);
  mockFetchProductName.mockResolvedValue('alpha-project');

  await writeOrgFile('# Uppercase Org', 'TECH-STACK.MD');

  const result = await loadTechStackMarkdown('proj-1');

  expect(result.orgMarkdown).toContain('Uppercase Org');
});

test('resolves lowercase filename variant for project file', async () => {
  mockFetchProjectFolder.mockResolvedValue(testRoot);
  mockFetchProductName.mockResolvedValue('alpha-project');

  await writeProjectFile('alpha-project', '# Lowercase Project', 'tech-stack.md');

  const result = await loadTechStackMarkdown('proj-1');

  expect(result.projectMarkdown).toContain('Lowercase Project');
});
