/**
 * Tests for Phase 1b deterministic linker rules.
 *
 * Spec: Phase 1b Linker and DecisionTask Engine (Increment 8)
 * Task Group 3: Four Deterministic Linker Rules
 *
 * 8 focused tests (2 per rule):
 * 1. ContainsByPathRule: directory-prefix matching produces `contains` at 1.0 confidence
 * 2. ContainsByPathRule: non-matching paths produce no candidates
 * 3. ImportsByPatternRule: import atoms matched to symbols produce `imports` with correct confidence
 * 4. ImportsByPatternRule: no match returns empty
 * 5. ExtendsByPatternRule: inheritance atoms matched to class/interface symbols produce `extends`
 * 6. ExtendsByPatternRule: mismatched kind (function vs class) produces no candidates
 * 7. ReferencesBySymbolRule: catch-all produces `references` at 0.3-0.6 confidence
 * 8. ReferencesBySymbolRule: symbols already captured by import/extends rules are excluded
 */

import { EvidenceAtom } from '../types';
import { containsByPathRule } from '../services/linkerRules/containsByPathRule';
import { importsByPatternRule } from '../services/linkerRules/importsByPatternRule';
import { extendsByPatternRule } from '../services/linkerRules/extendsByPatternRule';
import { referencesBySymbolRule } from '../services/linkerRules/referencesBySymbolRule';

/** Helper: create a file_structure atom */
function makeFileAtom(id: string, relativePath: string): EvidenceAtom {
  return {
    id,
    runId: 'run-001',
    repoUrl: 'https://github.com/test/repo',
    filePath: relativePath,
    type: 'file_structure',
    data: {
      relativePath,
      extension: relativePath.includes('.') ? '.' + relativePath.split('.').pop()! : '',
      sizeBytes: 100,
      lineCount: 10,
    },
    extractedAt: '2026-04-05T10:00:00Z',
  };
}

/** Helper: create a symbol atom */
function makeSymbolAtom(
  id: string,
  name: string,
  kind: string,
  filePath: string = 'src/index.ts'
): EvidenceAtom {
  return {
    id,
    runId: 'run-001',
    repoUrl: 'https://github.com/test/repo',
    filePath,
    type: 'symbol',
    data: {
      name,
      kind,
      line: 1,
      scope: null,
      language: 'TypeScript',
    },
    extractedAt: '2026-04-05T10:00:00Z',
  };
}

/** Helper: create a string_pattern atom */
function makePatternAtom(
  id: string,
  patternName: string,
  matchedText: string,
  filePath: string = 'src/index.ts'
): EvidenceAtom {
  return {
    id,
    runId: 'run-001',
    repoUrl: 'https://github.com/test/repo',
    filePath,
    type: 'string_pattern',
    data: {
      patternName,
      matchedText,
      line: 5,
      contextSnippet: matchedText,
    },
    extractedAt: '2026-04-05T10:00:00Z',
  };
}

describe('Phase 1b Deterministic Linker Rules', () => {

  // ==========================================================================
  // ContainsByPathRule Tests
  // ==========================================================================
  describe('ContainsByPathRule', () => {

    // Test 1: directory-prefix matching produces contains relationships at 1.0 confidence
    test('directory-prefix matching produces contains relationships at 1.0 confidence', () => {
      const atoms: EvidenceAtom[] = [
        makeFileAtom('dir-src', 'src'),
        makeFileAtom('file-index', 'src/index.ts'),
        makeFileAtom('file-utils', 'src/utils.ts'),
      ];

      const candidates = containsByPathRule.match(atoms);

      // src should contain src/index.ts and src/utils.ts
      expect(candidates.length).toBe(2);

      for (const candidate of candidates) {
        expect(candidate.relationshipType).toBe('contains');
        expect(candidate.confidence).toBe(1.0);
        expect(candidate.ruleId).toBe('contains-by-path');
        expect(candidate.sourceAtomId).toBe('dir-src');
      }

      const targetIds = candidates.map(c => c.targetAtomId).sort();
      expect(targetIds).toEqual(['file-index', 'file-utils']);
    });

    // Test 2: non-matching paths produce no candidates
    test('non-matching paths produce no candidates', () => {
      const atoms: EvidenceAtom[] = [
        makeFileAtom('file-a', 'src/index.ts'),
        makeFileAtom('file-b', 'lib/utils.ts'),
        makeFileAtom('file-c', 'test/spec.ts'),
      ];

      const candidates = containsByPathRule.match(atoms);

      // No directory-prefix relationships between these sibling files
      expect(candidates.length).toBe(0);
    });
  });

  // ==========================================================================
  // ImportsByPatternRule Tests
  // ==========================================================================
  describe('ImportsByPatternRule', () => {

    // Test 3: import atoms matched to symbols produce imports with correct confidence bands
    test('import_statement/require_statement atoms matched to symbol atoms produce imports with correct confidence bands', () => {
      const atoms: EvidenceAtom[] = [
        makePatternAtom('import-1', 'import_statement', "import { UserService } from './services/userService'"),
        makePatternAtom('import-2', 'require_statement', "const helper = require('./helperModule')"),
        makeSymbolAtom('sym-1', 'UserService', 'class', 'src/services/userService.ts'),
        makeSymbolAtom('sym-2', 'helper', 'function', 'src/helperModule.ts'),
      ];

      const candidates = importsByPatternRule.match(atoms);

      // Should find matches: import-1 -> sym-1 (exact), import-2 -> sym-2 (exact)
      expect(candidates.length).toBeGreaterThanOrEqual(2);

      // Find the exact match for UserService
      const userServiceMatch = candidates.find(
        c => c.sourceAtomId === 'import-1' && c.targetAtomId === 'sym-1'
      );
      expect(userServiceMatch).toBeDefined();
      expect(userServiceMatch!.relationshipType).toBe('imports');
      expect(userServiceMatch!.confidence).toBe(0.9); // Exact word boundary match
      expect(userServiceMatch!.ruleId).toBe('imports-by-pattern');

      // Find the match for helper
      const helperMatch = candidates.find(
        c => c.sourceAtomId === 'import-2' && c.targetAtomId === 'sym-2'
      );
      expect(helperMatch).toBeDefined();
      expect(helperMatch!.confidence).toBe(0.9); // 'helper' appears as a word boundary
    });

    // Test 4: no match returns empty
    test('no matching symbols returns empty candidates', () => {
      const atoms: EvidenceAtom[] = [
        makePatternAtom('import-1', 'import_statement', "import { Foo } from './foo'"),
        makeSymbolAtom('sym-1', 'BarService', 'class'),
        makeSymbolAtom('sym-2', 'BazHelper', 'function'),
      ];

      const candidates = importsByPatternRule.match(atoms);

      // Foo is not found among the symbol names
      expect(candidates.length).toBe(0);
    });
  });

  // ==========================================================================
  // ExtendsByPatternRule Tests
  // ==========================================================================
  describe('ExtendsByPatternRule', () => {

    // Test 5: inheritance atoms matched to class/interface symbols produce extends
    test('inheritance pattern atoms matched to symbol atoms with matching name/kind produce extends relationships', () => {
      const atoms: EvidenceAtom[] = [
        makePatternAtom('extends-1', 'extends_keyword', 'class AdminUser extends BaseUser'),
        makePatternAtom('implements-1', 'implements_keyword', 'class OrderService implements Serializable'),
        makeSymbolAtom('sym-base', 'BaseUser', 'class'),
        makeSymbolAtom('sym-serial', 'Serializable', 'interface'),
      ];

      const candidates = extendsByPatternRule.match(atoms);

      // Should find: extends-1 -> sym-base, implements-1 -> sym-serial
      expect(candidates.length).toBe(2);

      const extendsMatch = candidates.find(
        c => c.sourceAtomId === 'extends-1' && c.targetAtomId === 'sym-base'
      );
      expect(extendsMatch).toBeDefined();
      expect(extendsMatch!.relationshipType).toBe('extends');
      expect(extendsMatch!.confidence).toBe(0.9); // Exact match
      expect(extendsMatch!.ruleId).toBe('extends-by-pattern');

      const implementsMatch = candidates.find(
        c => c.sourceAtomId === 'implements-1' && c.targetAtomId === 'sym-serial'
      );
      expect(implementsMatch).toBeDefined();
      expect(implementsMatch!.relationshipType).toBe('extends');
      expect(implementsMatch!.confidence).toBe(0.9);
    });

    // Test 6: mismatched kind (function vs class) produces no candidates
    test('mismatched kind (function vs class) produces no candidates', () => {
      const atoms: EvidenceAtom[] = [
        makePatternAtom('extends-1', 'extends_keyword', 'class Foo extends processData'),
        // processData is a function, not a class or interface -- should not match
        makeSymbolAtom('sym-func', 'processData', 'function'),
      ];

      const candidates = extendsByPatternRule.match(atoms);

      // Function kind is not in INHERITABLE_KINDS, so no match
      expect(candidates.length).toBe(0);
    });
  });

  // ==========================================================================
  // ReferencesBySymbolRule Tests
  // ==========================================================================
  describe('ReferencesBySymbolRule', () => {

    // Test 7: catch-all produces references at 0.3-0.6 confidence
    test('catch-all string_pattern-to-symbol matching produces references at 0.3-0.6 confidence', () => {
      const atoms: EvidenceAtom[] = [
        // A pattern that is NOT import or extends related
        makePatternAtom('ref-1', 'spring_service', '@Service class uses UserRepository'),
        makeSymbolAtom('sym-repo', 'UserRepository', 'class'),
      ];

      const candidates = referencesBySymbolRule.match(atoms);

      expect(candidates.length).toBe(1);
      expect(candidates[0].relationshipType).toBe('references');
      expect(candidates[0].confidence).toBeGreaterThanOrEqual(0.3);
      expect(candidates[0].confidence).toBeLessThanOrEqual(0.6);
      expect(candidates[0].ruleId).toBe('references-by-symbol');
      expect(candidates[0].sourceAtomId).toBe('ref-1');
      expect(candidates[0].targetAtomId).toBe('sym-repo');
    });

    // Test 8: symbols already captured by import/extends rules are excluded
    test('symbols already captured by more specific rules (import/extends patterns) are excluded', () => {
      const atoms: EvidenceAtom[] = [
        // Import pattern -- should be excluded by ReferencesBySymbolRule
        makePatternAtom('import-1', 'import_statement', "import { UserService } from './services'"),
        // Extends pattern -- should be excluded by ReferencesBySymbolRule
        makePatternAtom('extends-1', 'extends_keyword', 'class Admin extends BaseUser'),
        // Require pattern -- should be excluded
        makePatternAtom('require-1', 'require_statement', "const Foo = require('./foo')"),
        // Implements pattern -- should be excluded (contains 'implements')
        makePatternAtom('impl-1', 'implements_keyword', 'class OrderService implements Serializable'),
        // Symbol atoms
        makeSymbolAtom('sym-1', 'UserService', 'class'),
        makeSymbolAtom('sym-2', 'BaseUser', 'class'),
      ];

      const candidates = referencesBySymbolRule.match(atoms);

      // All patterns are import/extends/require/implements related,
      // so the references rule should produce no candidates
      expect(candidates.length).toBe(0);
    });
  });
});
