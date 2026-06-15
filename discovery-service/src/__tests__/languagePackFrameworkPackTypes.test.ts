/**
 * Tests for V3 pack type contracts (`LanguagePack` + `FrameworkPack`).
 *
 * Spec: V3 Discovery Pipeline Foundation (Task Group 2)
 *
 * These are compile-smoke / structural tests only — they verify that the
 * `LanguagePack` and `FrameworkPack` interfaces exist, expose the right
 * fields, and can be imported from the `services/extensionPacks` barrel.
 * The legacy V2 `ExtensionPack` type was atomically removed in Task
 * Group 11 of the V3 Pack Migration Batch spec.
 *
 * Model: `src/__tests__/extensionPackFramework.test.ts`.
 *
 * NOTE: these tests do NOT exercise the registry, the pipeline, or any
 * V2 pack behaviour. Those are covered by later task groups / existing
 * tests.
 */

import type {
  LanguagePack,
  FrameworkPack,
  SourceFileIR,
  TechHints,
} from '../services/extensionPacks';

import type { DiscoveryCandidate } from '../types/candidate';

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function emptyIR(filePath: string): SourceFileIR {
  return {
    filePath,
    language: 'java',
    packageOrNamespace: null,
    imports: [],
    classes: [],
    functions: [],
  };
}

function fakeCandidate(runId: string, name: string): DiscoveryCandidate {
  return {
    id: `cand-${name}`,
    runId,
    candidateType: 'service',
    name,
    confidence: 0.9,
    status: 'proposed',
    sourceClusterIds: [],
    data: { _addedBy: 'test-adapter' },
    synthesizedAt: '2026-04-19T00:00:00Z',
  };
}

describe('V3 pack type contracts (Task Group 2)', () => {
  // ========================================================================
  // Test 1: LanguagePack minimal implementation compiles and exposes the
  // required surface (id, when.language, extract).
  // ========================================================================
  test('LanguagePack minimal implementation exposes id, when.language, and extract()', () => {
    const javaLangPack: LanguagePack = {
      id: 'java-lang',
      when: { language: 'Java' },
      extract(sourceFiles: Map<string, string>, _techHints: TechHints) {
        const out = new Map<string, SourceFileIR>();
        for (const [filePath] of sourceFiles) {
          if (filePath.endsWith('.java')) out.set(filePath, emptyIR(filePath));
        }
        return out;
      },
    };

    expect(javaLangPack.id).toBe('java-lang');
    expect(javaLangPack.when.language).toBe('Java');
    expect(typeof javaLangPack.extract).toBe('function');

    const sources = new Map<string, string>([
      ['src/Foo.java', 'class Foo {}'],
      ['src/Bar.ts', 'export {}'],
    ]);
    const ir = javaLangPack.extract(sources, {});
    expect(ir.size).toBe(1);
    expect(ir.get('src/Foo.java')?.filePath).toBe('src/Foo.java');
    expect(ir.has('src/Bar.ts')).toBe(false);
  });

  // ========================================================================
  // Test 2: FrameworkPack minimal implementation compiles and exposes the
  // required surface (id, when.language, when.technology, adapt).
  // ========================================================================
  test('FrameworkPack minimal implementation exposes id, when.language, when.technology, and adapt()', () => {
    const springClassic: FrameworkPack = {
      id: 'spring-classic',
      when: { language: 'Java', technology: 'Spring' },
      adapt(irFiles: Map<string, SourceFileIR>, runId: string, _techHints: TechHints) {
        const out: DiscoveryCandidate[] = [];
        for (const [filePath] of irFiles) {
          out.push({
            ...fakeCandidate(runId, filePath),
            data: { _addedBy: 'spring-classic-adapter' },
          });
        }
        return out;
      },
    };

    expect(springClassic.id).toBe('spring-classic');
    expect(springClassic.when.language).toBe('Java');
    expect(springClassic.when.technology).toBe('Spring');
    expect(typeof springClassic.adapt).toBe('function');

    const ir = new Map<string, SourceFileIR>([
      ['src/UserController.java', emptyIR('src/UserController.java')],
    ]);
    const candidates = springClassic.adapt(ir, 'run-123', {});
    expect(candidates).toHaveLength(1);
    expect(candidates[0].runId).toBe('run-123');
    expect(candidates[0].data._addedBy).toBe('spring-classic-adapter');
  });

  // ========================================================================
  // Test 4: The V3 types are importable from the `services/extensionPacks`
  // barrel (spec acceptance: "LanguagePack and FrameworkPack types
  // importable from services/extensionPacks"). Also verifies the
  // unchanged `SourceFileIR` re-export path.
  // ========================================================================
  test('LanguagePack, FrameworkPack, and SourceFileIR are importable from services/extensionPacks', () => {
    // Wrap the imports in `require` so we can assert the barrel resolves
    // at runtime, in addition to the compile-time `import type` above.
    const barrel = require('../services/extensionPacks');
    // Type re-exports are erased at runtime, so we only verify the module
    // loads. Confirming it loads without throwing is enough.
    expect(barrel).toBeDefined();

    // Compile-time: construct values whose types come from the barrel.
    const lang: LanguagePack = {
      id: 'noop-lang',
      when: { language: 'None' },
      extract: () => new Map<string, SourceFileIR>(),
    };
    const fwk: FrameworkPack = {
      id: 'noop-fwk',
      when: { language: 'None', technology: 'None' },
      adapt: () => [],
    };
    expect(lang.extract(new Map(), {}).size).toBe(0);
    expect(fwk.adapt(new Map(), 'run-x', {})).toEqual([]);
  });
});
