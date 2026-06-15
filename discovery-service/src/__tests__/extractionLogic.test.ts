import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { generateEvidenceId } from '../utils/evidenceId';
import { extractFileStructure } from '../services/extractors/fileStructureExtractor';
import { extractStringPatterns } from '../services/extractors/stringPatternExtractor';
import { shouldIncludeFile } from '../utils/fileFilter';

/**
 * Extraction Logic Tests
 *
 * 8 focused tests covering:
 * 1. Deterministic evidence ID generation
 * 2. File structure extractor atom shape
 * 3. File structure extractor binary file skipping
 * 4. File structure extractor size limit skipping
 * 5. File structure extractor excluded directory skipping
 * 6. String pattern extractor import/require matching
 * 7. String pattern extractor framework marker matching
 * 8. shouldIncludeFile() with includePaths and excludePaths
 *
 * Gap test (Task Group 5):
 * 9. File structure extractor with includePaths restricts to specific subtrees
 *
 * Tests use temporary directories with synthetic test files,
 * created in beforeEach and cleaned up in afterEach.
 */

let testTmpDir: string;

beforeEach(async () => {
  testTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'extraction-test-'));
});

afterEach(async () => {
  await fs.rm(testTmpDir, { recursive: true, force: true });
});

describe('Extraction Logic', () => {
  // Test 1: generateEvidenceId() produces deterministic IDs
  test('generateEvidenceId() produces deterministic IDs (same inputs produce same hash)', () => {
    const id1 = generateEvidenceId('run-1', 'https://github.com/org/repo', 'src/index.ts', 'file_structure', 'src/index.ts');
    const id2 = generateEvidenceId('run-1', 'https://github.com/org/repo', 'src/index.ts', 'file_structure', 'src/index.ts');

    expect(id1).toBe(id2);
    expect(typeof id1).toBe('string');
    // SHA-256 hash formatted as a 36-char UUID (8-4-4-4-12); deterministic.
    expect(id1.length).toBe(36);
    expect(id1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

    // Different inputs produce different IDs
    const id3 = generateEvidenceId('run-2', 'https://github.com/org/repo', 'src/index.ts', 'file_structure', 'src/index.ts');
    expect(id3).not.toBe(id1);

    // Different distinguishing key produces different ID
    const id4 = generateEvidenceId('run-1', 'https://github.com/org/repo', 'src/index.ts', 'symbol', 'MyClass:class:10');
    expect(id4).not.toBe(id1);
  });

  // Test 2: File structure extractor produces one atom per file with correct shape
  test('File structure extractor produces one atom per file with correct { relativePath, extension, sizeBytes, lineCount } shape', async () => {
    // Create test files
    const srcDir = path.join(testTmpDir, 'src');
    await fs.mkdir(srcDir, { recursive: true });
    await fs.writeFile(path.join(srcDir, 'index.ts'), 'const x = 1;\nconst y = 2;\nconst z = 3;\n');
    await fs.writeFile(path.join(srcDir, 'utils.js'), 'function hello() {}\n');
    await fs.writeFile(path.join(testTmpDir, 'README.md'), '# Hello\n\nThis is a readme.\n');

    const atoms = await extractFileStructure({
      repoDir: testTmpDir,
      runId: 'test-run-1',
      repoUrl: 'https://github.com/test/repo',
    });

    // Should produce one atom per file
    expect(atoms).toHaveLength(3);

    // Check shape of each atom
    for (const atom of atoms) {
      expect(atom.type).toBe('file_structure');
      expect(atom.runId).toBe('test-run-1');
      expect(atom.repoUrl).toBe('https://github.com/test/repo');
      expect(typeof atom.id).toBe('string');
      expect(typeof atom.extractedAt).toBe('string');
      expect(atom.data).toHaveProperty('relativePath');
      expect(atom.data).toHaveProperty('extension');
      expect(atom.data).toHaveProperty('sizeBytes');
      expect(atom.data).toHaveProperty('lineCount');
    }

    // Find specific atoms and validate data
    const indexAtom = atoms.find(a => a.filePath === 'src/index.ts');
    expect(indexAtom).toBeDefined();
    expect(indexAtom!.data).toMatchObject({
      relativePath: 'src/index.ts',
      extension: '.ts',
      lineCount: 3,
    });
    expect((indexAtom!.data as { sizeBytes: number }).sizeBytes).toBeGreaterThan(0);

    const readmeAtom = atoms.find(a => a.filePath === 'README.md');
    expect(readmeAtom).toBeDefined();
    expect(readmeAtom!.data).toMatchObject({
      relativePath: 'README.md',
      extension: '.md',
    });
  });

  // Test 3: File structure extractor skips binary files
  test('File structure extractor skips binary files (detected via extension list or null-byte check)', async () => {
    // Create a text file
    await fs.writeFile(path.join(testTmpDir, 'source.ts'), 'const x = 1;\n');

    // Create a binary file by extension
    await fs.writeFile(path.join(testTmpDir, 'image.png'), 'fake png content');

    // Create a file with binary content (null bytes) but text extension
    const binaryContent = Buffer.alloc(100);
    binaryContent.write('text start');
    binaryContent[20] = 0x00; // null byte
    await fs.writeFile(path.join(testTmpDir, 'binary.txt'), binaryContent);

    const atoms = await extractFileStructure({
      repoDir: testTmpDir,
      runId: 'test-run-binary',
      repoUrl: 'https://github.com/test/repo',
    });

    // Only the text source file should produce an atom
    expect(atoms).toHaveLength(1);
    expect(atoms[0].filePath).toBe('source.ts');
  });

  // Test 4: File structure extractor skips files exceeding MAX_FILE_SIZE_BYTES (1 MB)
  test('File structure extractor skips files exceeding MAX_FILE_SIZE_BYTES (1 MB)', async () => {
    // Create a small file (should be included)
    await fs.writeFile(path.join(testTmpDir, 'small.ts'), 'const x = 1;\n');

    // Create a file larger than 1 MB (should be excluded)
    const largeContent = 'x'.repeat(1_048_577); // 1 byte over 1 MB
    await fs.writeFile(path.join(testTmpDir, 'large.ts'), largeContent);

    const atoms = await extractFileStructure({
      repoDir: testTmpDir,
      runId: 'test-run-size',
      repoUrl: 'https://github.com/test/repo',
    });

    // Only the small file should produce an atom
    expect(atoms).toHaveLength(1);
    expect(atoms[0].filePath).toBe('small.ts');
  });

  // Test 5: File structure extractor skips default excluded directories
  test('File structure extractor skips default excluded directories (node_modules, .git, vendor, build, dist, target, etc.)', async () => {
    // Create files in excluded directories
    const excludedDirs = ['node_modules', '.git', 'vendor', 'build', 'dist', 'target'];
    for (const dir of excludedDirs) {
      const dirPath = path.join(testTmpDir, dir);
      await fs.mkdir(dirPath, { recursive: true });
      await fs.writeFile(path.join(dirPath, 'file.ts'), 'const x = 1;\n');
    }

    // Create a file in a non-excluded directory (should be included)
    const srcDir = path.join(testTmpDir, 'src');
    await fs.mkdir(srcDir, { recursive: true });
    await fs.writeFile(path.join(srcDir, 'app.ts'), 'const app = express();\n');

    // Create a file at root level (should be included)
    await fs.writeFile(path.join(testTmpDir, 'index.ts'), 'export {};\n');

    const atoms = await extractFileStructure({
      repoDir: testTmpDir,
      runId: 'test-run-excludedirs',
      repoUrl: 'https://github.com/test/repo',
    });

    // Only files NOT in excluded directories should produce atoms
    const filePaths = atoms.map(a => a.filePath);
    expect(filePaths).toContain('src/app.ts');
    expect(filePaths).toContain('index.ts');

    // None of the excluded directory files should be present
    for (const dir of excludedDirs) {
      expect(filePaths).not.toContain(`${dir}/file.ts`);
    }

    expect(atoms).toHaveLength(2);
  });

  // Test 6: String pattern extractor matches import/require statements
  test('String pattern extractor matches import/require statements and produces correct atom shape', async () => {
    const srcDir = path.join(testTmpDir, 'src');
    await fs.mkdir(srcDir, { recursive: true });

    const tsContent = [
      "import express from 'express';",
      "import { Router } from 'express';",
      "const logger = require('winston');",
      '',
      'const app = express();',
    ].join('\n');

    await fs.writeFile(path.join(srcDir, 'server.ts'), tsContent);

    const atoms = await extractStringPatterns({
      repoDir: testTmpDir,
      runId: 'test-run-patterns',
      repoUrl: 'https://github.com/test/repo',
    });

    // Should match import and require statements
    const importAtoms = atoms.filter(a => {
      const data = a.data as { patternName: string };
      return data.patternName === 'import_statement';
    });
    const requireAtoms = atoms.filter(a => {
      const data = a.data as { patternName: string };
      return data.patternName === 'require_statement';
    });

    expect(importAtoms.length).toBeGreaterThanOrEqual(2);
    expect(requireAtoms.length).toBeGreaterThanOrEqual(1);

    // Verify atom shape
    for (const atom of atoms) {
      expect(atom.type).toBe('string_pattern');
      expect(atom.runId).toBe('test-run-patterns');
      expect(atom.repoUrl).toBe('https://github.com/test/repo');
      expect(typeof atom.id).toBe('string');
      expect(atom.id.length).toBe(36);
      expect(atom.data).toHaveProperty('patternName');
      expect(atom.data).toHaveProperty('matchedText');
      expect(atom.data).toHaveProperty('line');
      expect(atom.data).toHaveProperty('contextSnippet');
    }

    // Check that an import atom has the right matched text
    const firstImport = importAtoms[0];
    const firstImportData = firstImport.data as { matchedText: string; line: number; contextSnippet: string };
    expect(firstImportData.matchedText).toContain('import');
    expect(firstImportData.line).toBe(1);
    expect(typeof firstImportData.contextSnippet).toBe('string');
    expect(firstImportData.contextSnippet.length).toBeGreaterThan(0);
  });

  // Test 7: String pattern extractor matches framework markers
  test('String pattern extractor matches framework markers (@SpringBootApplication, express(), etc.)', async () => {
    // Java file with Spring annotations
    const javaDir = path.join(testTmpDir, 'src', 'main', 'java');
    await fs.mkdir(javaDir, { recursive: true });
    const javaContent = [
      'package com.example;',
      '',
      '@SpringBootApplication',
      'public class MyApp {',
      '  public static void main(String[] args) {}',
      '}',
    ].join('\n');
    await fs.writeFile(path.join(javaDir, 'MyApp.java'), javaContent);

    // TypeScript file with express()
    const tsDir = path.join(testTmpDir, 'src');
    // tsDir already exists from javaDir creation
    const tsContent = [
      "import express from 'express';",
      '',
      'const app = express();',
      "app.get('/api/health', (req, res) => res.send('ok'));",
    ].join('\n');
    await fs.writeFile(path.join(tsDir, 'server.ts'), tsContent);

    const atoms = await extractStringPatterns({
      repoDir: testTmpDir,
      runId: 'test-run-framework',
      repoUrl: 'https://github.com/test/repo',
    });

    // Find Spring Boot marker
    const springAtoms = atoms.filter(a => {
      const data = a.data as { patternName: string };
      return data.patternName === 'spring_boot_application';
    });
    expect(springAtoms.length).toBe(1);
    expect((springAtoms[0].data as { matchedText: string }).matchedText).toBe('@SpringBootApplication');
    expect((springAtoms[0].data as { line: number }).line).toBe(3);

    // Find express() marker
    const expressAtoms = atoms.filter(a => {
      const data = a.data as { patternName: string };
      return data.patternName === 'express_app';
    });
    expect(expressAtoms.length).toBe(1);
    expect((expressAtoms[0].data as { matchedText: string }).matchedText).toBe('express()');

    // Find HTTP route definition
    const routeAtoms = atoms.filter(a => {
      const data = a.data as { patternName: string };
      return data.patternName === 'http_route_definition';
    });
    expect(routeAtoms.length).toBe(1);
  });

  // Test 8: shouldIncludeFile() correctly applies includePaths and excludePaths
  test('shouldIncludeFile() correctly applies includePaths and excludePaths from Phase 0 config', () => {
    // No include/exclude: all non-default-excluded paths are included
    expect(shouldIncludeFile('src/index.ts')).toBe(true);
    expect(shouldIncludeFile('lib/utils.js')).toBe(true);

    // Default excluded dirs are always excluded
    expect(shouldIncludeFile('node_modules/express/index.js')).toBe(false);
    expect(shouldIncludeFile('.git/config')).toBe(false);
    expect(shouldIncludeFile('vendor/lib/thing.rb')).toBe(false);
    expect(shouldIncludeFile('build/output.js')).toBe(false);
    expect(shouldIncludeFile('dist/bundle.js')).toBe(false);
    expect(shouldIncludeFile('target/classes/App.class')).toBe(false);

    // excludePaths: additional paths to exclude
    expect(shouldIncludeFile('src/index.ts', undefined, ['docs/', 'test/'])).toBe(true);
    expect(shouldIncludeFile('docs/readme.md', undefined, ['docs/', 'test/'])).toBe(false);
    expect(shouldIncludeFile('test/app.test.ts', undefined, ['docs/', 'test/'])).toBe(false);

    // includePaths: only matching paths are included
    expect(shouldIncludeFile('src/index.ts', ['src/'])).toBe(true);
    expect(shouldIncludeFile('src/utils/helper.ts', ['src/'])).toBe(true);
    expect(shouldIncludeFile('lib/index.ts', ['src/'])).toBe(false);
    expect(shouldIncludeFile('README.md', ['src/'])).toBe(false);

    // Multiple includePaths
    expect(shouldIncludeFile('src/index.ts', ['src/', 'lib/'])).toBe(true);
    expect(shouldIncludeFile('lib/index.ts', ['src/', 'lib/'])).toBe(true);
    expect(shouldIncludeFile('test/app.test.ts', ['src/', 'lib/'])).toBe(false);

    // includePaths + excludePaths combined
    expect(shouldIncludeFile('src/index.ts', ['src/'], ['src/generated/'])).toBe(true);
    expect(shouldIncludeFile('src/generated/types.ts', ['src/'], ['src/generated/'])).toBe(false);

    // Default excluded dirs take precedence even when inside includePaths
    expect(shouldIncludeFile('src/node_modules/pkg/index.js', ['src/'])).toBe(false);

    // Empty arrays are treated as "not provided" (no filtering)
    expect(shouldIncludeFile('src/index.ts', [], [])).toBe(true);
    expect(shouldIncludeFile('lib/utils.js', [], [])).toBe(true);
  });

  // ==========================================================================
  // Gap Test 7 (Task Group 5): File structure extractor with includePaths
  // restricts extraction to specific subtrees
  // ==========================================================================
  test('Gap 7: file structure extractor with includePaths restricts extraction to specific subtrees', async () => {
    // Create files in multiple directories
    const srcDir = path.join(testTmpDir, 'src');
    const libDir = path.join(testTmpDir, 'lib');
    const docsDir = path.join(testTmpDir, 'docs');
    await fs.mkdir(srcDir, { recursive: true });
    await fs.mkdir(libDir, { recursive: true });
    await fs.mkdir(docsDir, { recursive: true });

    await fs.writeFile(path.join(srcDir, 'app.ts'), 'const app = 1;\n');
    await fs.writeFile(path.join(srcDir, 'utils.ts'), 'const utils = 1;\n');
    await fs.writeFile(path.join(libDir, 'helper.ts'), 'const helper = 1;\n');
    await fs.writeFile(path.join(docsDir, 'guide.md'), '# Guide\n');
    await fs.writeFile(path.join(testTmpDir, 'README.md'), '# Readme\n');

    // Extract with includePaths restricting to src/ only
    const atoms = await extractFileStructure({
      repoDir: testTmpDir,
      runId: 'test-include-paths',
      repoUrl: 'https://github.com/test/repo',
      includePaths: ['src/'],
    });

    // Only src/ files should be included
    const filePaths = atoms.map(a => a.filePath);
    expect(filePaths).toContain('src/app.ts');
    expect(filePaths).toContain('src/utils.ts');
    expect(filePaths).not.toContain('lib/helper.ts');
    expect(filePaths).not.toContain('docs/guide.md');
    expect(filePaths).not.toContain('README.md');
    expect(atoms).toHaveLength(2);
  });
});
