/**
 * Tests for Scan Plan Builder.
 *
 * Spec: Extension Pack Framework & LLM File-Level Analysis
 * Task Group 4: Scan Plan Builder
 *
 * 6 focused tests:
 * 1. Files with symbol atoms (class, interface, method, annotation) are included in scan plan
 * 2. Files with only file_structure atoms (package.json, .gitignore, lock files) are excluded
 * 3. Inbound import count from 1b relationships is computed and used for prioritization
 * 4. Files are sorted by priority (symbol count + inbound import count descending)
 * 5. Scan plan output shape matches { filePath, lineCount, symbolCount, inboundImportCount, atomSummary, relationshipContext }
 * 6. The configurable file line limit is exported and accessible
 */

import { buildScanPlan, buildScanPlanFromFilesystem, ScanPlanEntry } from '../services/scanPlanBuilder';
import { EvidenceAtom } from '../types/evidenceAtom';
import { EvidenceRelationship } from '../types/relationship';
import { DISCOVERY_FILE_LINE_LIMIT } from '../config';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

// Helper to build a minimal file_structure atom
function makeFileStructureAtom(
  filePath: string,
  lineCount: number,
  overrides: Partial<EvidenceAtom> = {}
): EvidenceAtom {
  return {
    id: `fs-${filePath}`,
    runId: 'run-001',
    repoUrl: 'https://github.com/test/repo',
    filePath,
    type: 'file_structure',
    data: {
      relativePath: filePath,
      extension: filePath.split('.').pop() || '',
      sizeBytes: lineCount * 80,
      lineCount,
    },
    extractedAt: '2026-04-07T10:00:00Z',
    ...overrides,
  };
}

// Helper to build a minimal symbol atom
function makeSymbolAtom(
  filePath: string,
  kind: string,
  name: string,
  overrides: Partial<EvidenceAtom> = {}
): EvidenceAtom {
  return {
    id: `sym-${filePath}-${name}`,
    runId: 'run-001',
    repoUrl: 'https://github.com/test/repo',
    filePath,
    type: 'symbol',
    data: {
      name,
      kind,
      line: 1,
      scope: null,
      language: 'Java',
    },
    extractedAt: '2026-04-07T10:00:00Z',
    ...overrides,
  };
}

// Helper to build a minimal relationship
function makeRelationship(
  sourceAtomId: string,
  targetAtomId: string,
  relationshipType: string = 'imports',
  overrides: Partial<EvidenceRelationship> = {}
): EvidenceRelationship {
  return {
    id: `rel-${sourceAtomId}-${targetAtomId}`,
    runId: 'run-001',
    sourceAtomId,
    targetAtomId,
    relationshipType: relationshipType as EvidenceRelationship['relationshipType'],
    confidence: 0.9,
    data: {
      importStatement: `import { X } from './target'`,
      line: 1,
      isDefault: false,
    },
    inferredAt: '2026-04-07T10:00:00Z',
    ...overrides,
  };
}

describe('Task Group 4: Scan Plan Builder', () => {

  // ==========================================================================
  // Test 1: Files with symbol atoms are included in scan plan
  // ==========================================================================
  test('files with symbol atoms (class, interface, method, annotation) are included in scan plan', () => {
    const atoms: EvidenceAtom[] = [
      makeFileStructureAtom('src/UserController.java', 200),
      makeSymbolAtom('src/UserController.java', 'class', 'UserController'),
      makeSymbolAtom('src/UserController.java', 'method', 'getUsers'),
      makeSymbolAtom('src/UserController.java', 'annotation', 'RestController'),
      makeFileStructureAtom('src/UserService.java', 150),
      makeSymbolAtom('src/UserService.java', 'class', 'UserService'),
      makeSymbolAtom('src/UserService.java', 'interface', 'IUserService'),
    ];

    const result = buildScanPlan(atoms, []);

    expect(result).toHaveLength(2);

    const controllerEntry = result.find(e => e.filePath === 'src/UserController.java');
    expect(controllerEntry).toBeDefined();
    expect(controllerEntry!.symbolCount).toBe(3);

    const serviceEntry = result.find(e => e.filePath === 'src/UserService.java');
    expect(serviceEntry).toBeDefined();
    expect(serviceEntry!.symbolCount).toBe(2);
  });

  // ==========================================================================
  // Test 2: Files with only file_structure atoms are excluded
  // ==========================================================================
  test('files with only file_structure atoms (package.json, .gitignore, lock files) are excluded', () => {
    const atoms: EvidenceAtom[] = [
      // Boilerplate files -- only file_structure atoms
      makeFileStructureAtom('package.json', 50),
      makeFileStructureAtom('.gitignore', 20),
      makeFileStructureAtom('yarn.lock', 5000),
      makeFileStructureAtom('tsconfig.json', 30),
      // Architecturally interesting file -- has symbol atoms
      makeFileStructureAtom('src/App.ts', 100),
      makeSymbolAtom('src/App.ts', 'class', 'App'),
    ];

    const result = buildScanPlan(atoms, []);

    expect(result).toHaveLength(1);
    expect(result[0].filePath).toBe('src/App.ts');

    // Verify boilerplate files are not in the result
    const filePaths = result.map(e => e.filePath);
    expect(filePaths).not.toContain('package.json');
    expect(filePaths).not.toContain('.gitignore');
    expect(filePaths).not.toContain('yarn.lock');
    expect(filePaths).not.toContain('tsconfig.json');
  });

  // ==========================================================================
  // Test 3: Inbound import count from 1b relationships is computed
  // ==========================================================================
  test('inbound import count from 1b relationships is computed and used for prioritization', () => {
    const atoms: EvidenceAtom[] = [
      makeFileStructureAtom('src/UserService.java', 100),
      makeSymbolAtom('src/UserService.java', 'class', 'UserService'),
      makeFileStructureAtom('src/UserController.java', 100),
      makeSymbolAtom('src/UserController.java', 'class', 'UserController'),
      makeFileStructureAtom('src/OrderController.java', 100),
      makeSymbolAtom('src/OrderController.java', 'class', 'OrderController'),
    ];

    // UserService is imported by both controllers
    const relationships: EvidenceRelationship[] = [
      makeRelationship(
        'sym-src/UserController.java-UserController',
        'sym-src/UserService.java-UserService',
        'imports'
      ),
      makeRelationship(
        'sym-src/OrderController.java-OrderController',
        'sym-src/UserService.java-UserService',
        'imports'
      ),
    ];

    const result = buildScanPlan(atoms, relationships);

    const serviceEntry = result.find(e => e.filePath === 'src/UserService.java');
    expect(serviceEntry).toBeDefined();
    expect(serviceEntry!.inboundImportCount).toBe(2);

    const controllerEntry = result.find(e => e.filePath === 'src/UserController.java');
    expect(controllerEntry).toBeDefined();
    expect(controllerEntry!.inboundImportCount).toBe(0);
  });

  // ==========================================================================
  // Test 4: Files are sorted by priority (symbolCount + inboundImportCount) descending
  // ==========================================================================
  test('files are sorted by priority (symbolCount + inboundImportCount) descending', () => {
    const atoms: EvidenceAtom[] = [
      // File A: 1 symbol, 0 imports => priority 1
      makeFileStructureAtom('src/FileA.java', 50),
      makeSymbolAtom('src/FileA.java', 'class', 'FileA'),
      // File B: 3 symbols, 0 imports => priority 3
      makeFileStructureAtom('src/FileB.java', 80),
      makeSymbolAtom('src/FileB.java', 'class', 'FileB'),
      makeSymbolAtom('src/FileB.java', 'method', 'doStuff'),
      makeSymbolAtom('src/FileB.java', 'method', 'doMoreStuff'),
      // File C: 1 symbol, 2 imports => priority 3 (tied with B)
      makeFileStructureAtom('src/FileC.java', 120),
      makeSymbolAtom('src/FileC.java', 'class', 'FileC'),
    ];

    // FileC has 2 inbound imports
    const relationships: EvidenceRelationship[] = [
      makeRelationship('sym-src/FileA.java-FileA', 'sym-src/FileC.java-FileC', 'imports'),
      makeRelationship('sym-src/FileB.java-FileB', 'sym-src/FileC.java-FileC', 'imports'),
    ];

    const result = buildScanPlan(atoms, relationships);

    expect(result).toHaveLength(3);

    // B and C both have priority 3, should come before A (priority 1)
    const priorities = result.map(e => e.symbolCount + e.inboundImportCount);
    expect(priorities[0]).toBeGreaterThanOrEqual(priorities[1]);
    expect(priorities[1]).toBeGreaterThanOrEqual(priorities[2]);

    // A should be last
    expect(result[2].filePath).toBe('src/FileA.java');
  });

  // ==========================================================================
  // Test 5: Scan plan output shape matches expected interface
  // ==========================================================================
  test('scan plan output shape matches ScanPlanEntry interface', () => {
    const atoms: EvidenceAtom[] = [
      makeFileStructureAtom('src/Main.java', 300),
      makeSymbolAtom('src/Main.java', 'class', 'Main'),
      makeSymbolAtom('src/Main.java', 'method', 'run'),
    ];

    const relationships: EvidenceRelationship[] = [
      makeRelationship('sym-other-file-Caller', 'sym-src/Main.java-Main', 'imports', {
        id: 'rel-ext-main',
      }),
    ];

    // Add the source atom so atom-to-file mapping resolves
    const atomsWithCaller: EvidenceAtom[] = [
      ...atoms,
      makeSymbolAtom('src/Caller.java', 'class', 'Caller', { id: 'sym-other-file-Caller' }),
    ];

    const result = buildScanPlan(atomsWithCaller, relationships);

    const mainEntry = result.find(e => e.filePath === 'src/Main.java');
    expect(mainEntry).toBeDefined();

    // Verify all expected fields exist
    expect(mainEntry).toHaveProperty('filePath');
    expect(mainEntry).toHaveProperty('lineCount');
    expect(mainEntry).toHaveProperty('symbolCount');
    expect(mainEntry).toHaveProperty('inboundImportCount');
    expect(mainEntry).toHaveProperty('atomSummary');
    expect(mainEntry).toHaveProperty('relationshipContext');

    // Verify types
    expect(typeof mainEntry!.filePath).toBe('string');
    expect(typeof mainEntry!.lineCount).toBe('number');
    expect(typeof mainEntry!.symbolCount).toBe('number');
    expect(typeof mainEntry!.inboundImportCount).toBe('number');
    expect(typeof mainEntry!.atomSummary).toBe('string');
    expect(typeof mainEntry!.relationshipContext).toBe('string');

    // Verify values
    expect(mainEntry!.filePath).toBe('src/Main.java');
    expect(mainEntry!.lineCount).toBe(300);
    expect(mainEntry!.symbolCount).toBe(2);
    expect(mainEntry!.inboundImportCount).toBe(1);
    expect(mainEntry!.atomSummary).toContain('class');
    expect(mainEntry!.atomSummary).toContain('method');
    expect(mainEntry!.relationshipContext).toContain('imported by');
  });

  // ==========================================================================
  // Test 6: DISCOVERY_FILE_LINE_LIMIT config is accessible and has default value
  // ==========================================================================
  test('DISCOVERY_FILE_LINE_LIMIT config is exported and has default value of 10000', () => {
    expect(DISCOVERY_FILE_LINE_LIMIT).toBeDefined();
    expect(typeof DISCOVERY_FILE_LINE_LIMIT).toBe('number');
    // Default value should be 10000 (or whatever env var is set -- in test env, default)
    expect(DISCOVERY_FILE_LINE_LIMIT).toBe(10000);
  });
});

// =============================================================================
// buildScanPlanFromFilesystem — service-scoped walk + includePaths filter.
//
// Regression cover for the "0 candidates on a local folder that clearly has
// source files" bug surfaced on 2026-04-24. The walker silently swallowed
// `fs.readdir` errors, so a misconfigured `repo_location` or `repo_subfolder`
// produced no files with no diagnostic. Behaviour we pin here:
//
//   - happy path: files under `<scanRoot>/<subfolder>/…` are found when
//     `includePaths = [subfolder]`.
//   - non-existent scan root returns [] AND emits a `console.error` line
//     tagged `[ScanPlanBuilder:fs] readdir FAILED at scan root` — the loud
//     diagnostic that replaced the silent swallow.
//   - `repo_subfolder` edge shapes ("fire-ui/", "fire-ui/src") match as
//     expected after the route-boundary normalization strips trailing
//     slashes. Leading-slash and backslash normalization is handled by
//     `normalizeRepoSubfolder` at the boundary and is covered by the
//     repoAccess tests; here we only verify the walker's own filter logic.
//   - `file:///…` as scan root does NOT match any OS path and must therefore
//     fail loudly via the new readdir log (not silently yield []).
// =============================================================================
describe('buildScanPlanFromFilesystem (service-scoped local walk)', () => {
  let tmpRoot: string;
  let errorSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  async function seed(files: Record<string, string>): Promise<void> {
    for (const [rel, content] of Object.entries(files)) {
      const full = path.join(tmpRoot, rel);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, content, 'utf-8');
    }
  }

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'scanplan-fs-'));
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(async () => {
    errorSpy.mockRestore();
    warnSpy.mockRestore();
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  test('happy path: includePaths=[subfolder] finds files under <repo>/<subfolder>/**', async () => {
    await seed({
      'fire-ui/src/main/webapp/app.js': '// entry',
      'fire-ui/src/main/webapp/lib/controller.ts': 'export class C {}',
      'fire-ui/pom.xml': '<project/>',
      'unrelated/other.js': '// should be filtered out',
    });

    const plan = await buildScanPlanFromFilesystem(tmpRoot, undefined, {
      includePaths: ['fire-ui'],
      excludePaths: [],
    });

    const paths = plan.map(e => e.filePath).sort();
    expect(paths).toEqual([
      'fire-ui/pom.xml',
      'fire-ui/src/main/webapp/app.js',
      'fire-ui/src/main/webapp/lib/controller.ts',
    ]);
  });

  test('deeper includePaths prefix (subfolder/sub) restricts to that subtree only', async () => {
    await seed({
      'fire-ui/src/main/java/A.java': 'class A {}',
      'fire-ui/src/main/webapp/app.js': '// entry',
      'fire-ui/pom.xml': '<project/>',
    });

    const plan = await buildScanPlanFromFilesystem(tmpRoot, undefined, {
      includePaths: ['fire-ui/src/main/java'],
      excludePaths: [],
    });

    expect(plan.map(e => e.filePath)).toEqual(['fire-ui/src/main/java/A.java']);
  });

  test('trailing slash in includePaths is tolerated (prefix normalized by filter)', async () => {
    await seed({
      'fire-ui/src/main/java/A.java': 'class A {}',
      'other/B.java': 'class B {}',
    });

    const plan = await buildScanPlanFromFilesystem(tmpRoot, undefined, {
      includePaths: ['fire-ui/'],
      excludePaths: [],
    });

    expect(plan.map(e => e.filePath)).toEqual(['fire-ui/src/main/java/A.java']);
  });

  test('non-existent scan root returns [] AND logs error at scan root level', async () => {
    const nonExistent = path.join(tmpRoot, 'does-not-exist', 'nested');

    const plan = await buildScanPlanFromFilesystem(nonExistent, undefined, {
      includePaths: [],
      excludePaths: [],
    });

    expect(plan).toEqual([]);
    // The diagnostic that replaces the old silent swallow.
    expect(errorSpy).toHaveBeenCalled();
    const messages = errorSpy.mock.calls.map(args => String(args[0]));
    const hasScanRootFailure = messages.some(m =>
      m.includes('[ScanPlanBuilder:fs] readdir FAILED at scan root') &&
      m.includes(nonExistent),
    );
    expect(hasScanRootFailure).toBe(true);
  });

  test('file:///… prefix as scan root is NOT treated as a valid path — fails loudly', async () => {
    // Simulates the regression shape where `repo_location` was saved with a
    // stray `file://` prefix and flowed through to the walker unnormalized.
    // The walker must log the failure instead of silently returning [].
    const fileUrlRoot = `file:///${tmpRoot.replace(/\\/g, '/')}`;

    const plan = await buildScanPlanFromFilesystem(fileUrlRoot, undefined, {
      includePaths: [],
      excludePaths: [],
    });

    expect(plan).toEqual([]);
    expect(errorSpy).toHaveBeenCalled();
    const hasFileUrlFailure = errorSpy.mock.calls
      .map(args => String(args[0]))
      .some(m => m.includes('[ScanPlanBuilder:fs] readdir FAILED at scan root') && m.includes('file:'));
    expect(hasFileUrlFailure).toBe(true);
  });

});
