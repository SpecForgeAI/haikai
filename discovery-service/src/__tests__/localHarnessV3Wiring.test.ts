/**
 * Tests for the V3 local harness wiring.
 *
 * Spec: V3 Discovery Pipeline Foundation — Task Group 6
 * Updated: V3 Pack Migration Batch — Task Group 11 (V2 fallback removed
 * atomically along with the V2 registry surface).
 *
 * Focused tests:
 *   1. Dry-run smoke: `runHarness` invokes `LanguagePack.extract` then
 *      `FrameworkPack.adapt`.
 *   2. Harness emits per-framework-pack candidate counts (needed for the
 *      identity-equality spot-check).
 *   3. Per-candidate detail reported by the harness includes
 *      `(type, name, filePath, _addedBy)` — the identity tuple the OpenMRS
 *      acceptance uses.
 *   4. When only a LanguagePack matches (Tier B / no framework), the
 *      harness still runs `extract()` and produces zero candidates from
 *      Stage 2.
 *   5. `run-spring-classic-local` helper: `runSpringClassicV3` invokes
 *      `javaLangPack.extract` + `springClassicFrameworkPack.adapt`.
 *
 * Persistence / filesystem are mocked — the harness scripts import the
 * pack instances directly, so we can test the wiring without a repo clone.
 */

// Mock dotenv before anything loads — register.ts has side-effects.
jest.mock('dotenv', () => ({ config: jest.fn() }));

import type { DiscoveryCandidate } from '../types/candidate';
import type { SourceFileIR } from '../services/extensionPacks';
import type { LanguagePack, FrameworkPack } from '../services/extensionPacks';
import {
  clearRegistry,
  registerLanguagePack,
  registerFrameworkPack,
} from '../services/extensionPackRegistry';

import { runHarness } from '../../scripts/run-pack-local';
import { runSpringClassicV3 } from '../../scripts/run-spring-classic-local';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeFakeIr(filePath: string): SourceFileIR {
  return {
    filePath,
    language: 'java',
    packageOrNamespace: null,
    imports: [],
    classes: [],
    functions: [],
  };
}

function makeSpyLanguagePack(overrides: Partial<LanguagePack> = {}): {
  pack: LanguagePack;
  extractSpy: jest.Mock;
} {
  const extractSpy = jest.fn(
    (sourceFiles: Map<string, string>): Map<string, SourceFileIR> => {
      const out = new Map<string, SourceFileIR>();
      for (const p of sourceFiles.keys()) out.set(p, makeFakeIr(p));
      return out;
    },
  );
  const pack: LanguagePack = {
    id: 'java-lang',
    when: { language: 'Java' },
    extract: extractSpy as unknown as LanguagePack['extract'],
    ...overrides,
  };
  return { pack, extractSpy };
}

function makeSpyFrameworkPack(
  id: string,
  technology: string,
  adapterTag: string,
  candidateCount: number,
): { pack: FrameworkPack; adaptSpy: jest.Mock } {
  const adaptSpy = jest.fn(
    (irFiles: Map<string, SourceFileIR>, runId: string): DiscoveryCandidate[] => {
      const out: DiscoveryCandidate[] = [];
      const fileKeys = Array.from(irFiles.keys());
      for (let i = 0; i < candidateCount; i++) {
        out.push({
          id: `fake-cand-${id}-${i}`,
          runId,
          candidateType: 'service',
          name: `FakeService${i}`,
          confidence: 0.9,
          status: 'proposed',
          sourceClusterIds: fileKeys.slice(0, 1),
          data: { _addedBy: adapterTag },
          synthesizedAt: new Date().toISOString(),
        });
      }
      return out;
    },
  );
  const pack: FrameworkPack = {
    id,
    when: { language: 'Java', technology },
    adapt: adaptSpy as unknown as FrameworkPack['adapt'],
  };
  return { pack, adaptSpy };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('V3 local harness wiring', () => {
  beforeEach(() => {
    clearRegistry();
  });

  // =========================================================================
  // Test 1: V3 path — runHarness invokes LanguagePack.extract and
  // FrameworkPack.adapt.
  // =========================================================================
  test('runHarness invokes LanguagePack.extract then FrameworkPack.adapt for V3-registered stack', async () => {
    const { pack: langPack, extractSpy } = makeSpyLanguagePack();
    const { pack: fwPack, adaptSpy } = makeSpyFrameworkPack(
      'spring-classic',
      'Spring',
      'spring-classic-adapter',
      5,
    );
    registerLanguagePack(langPack);
    registerFrameworkPack(fwPack);

    const sourceFiles = new Map<string, string>([
      ['src/A.java', 'class A {}'],
      ['src/B.java', 'class B {}'],
    ]);

    const result = await runHarness({
      sourceFiles,
      coreTech: 'Java, Spring',
    });

    // Stage 1: LanguagePack.extract was invoked with the full source map.
    expect(extractSpy).toHaveBeenCalledTimes(1);
    const extractArgs = extractSpy.mock.calls[0];
    expect(extractArgs[0]).toBe(sourceFiles);

    // Stage 2: FrameworkPack.adapt was invoked.
    expect(adaptSpy).toHaveBeenCalledTimes(1);
    const adaptArgs = adaptSpy.mock.calls[0];
    const adaptIr = adaptArgs[0] as Map<string, SourceFileIR>;
    expect(adaptIr.size).toBe(2); // Both files ended up in the IR map.

    // Tier A (language + framework both matched).
    expect(result.tier).toBe('A');
    expect(result.languagePackId).toBe('java-lang');
    expect(result.irFileCount).toBe(2);

    // Exactly one pack result, invoked via V3 adapt.
    expect(result.packResults).toHaveLength(1);
    expect(result.packResults[0].invokedVia).toBe('v3-framework-pack.adapt');
    expect(result.packResults[0].packId).toBe('spring-classic');
    expect(result.packResults[0].candidates).toHaveLength(5);
  });

  // =========================================================================
  // Test 2: Per-framework-pack candidate counts are reported.
  // =========================================================================
  test('runHarness emits per-framework-pack candidate counts for every registered framework pack', async () => {
    const { pack: langPack } = makeSpyLanguagePack();
    // Two framework packs matching the same techHints — both must be
    // invoked and both must appear in packResults with their own count.
    const { pack: fw1 } = makeSpyFrameworkPack('spring-classic', 'Spring', 'spring-classic-adapter', 7);
    const { pack: fw2 } = makeSpyFrameworkPack('spring-extra', 'Spring', 'spring-extra-adapter', 3);
    registerLanguagePack(langPack);
    registerFrameworkPack(fw1);
    registerFrameworkPack(fw2);

    const result = await runHarness({
      sourceFiles: new Map([['src/A.java', 'class A {}']]),
      coreTech: 'Java, Spring',
    });

    // One PackRunResult per registered framework pack.
    expect(result.packResults).toHaveLength(2);
    const byId = new Map(result.packResults.map((p) => [p.packId, p]));
    expect(byId.get('spring-classic')?.candidates).toHaveLength(7);
    expect(byId.get('spring-extra')?.candidates).toHaveLength(3);
    // Both invoked via the V3 adapt path.
    for (const pr of result.packResults) {
      expect(pr.invokedVia).toBe('v3-framework-pack.adapt');
    }
    // Aggregate candidate list carries all of them.
    expect(result.allCandidates).toHaveLength(10);
  });

  // =========================================================================
  // Test 3: Per-candidate detail (type, name, filePath, _addedBy) is
  // recoverable from the harness output.
  // =========================================================================
  test('runHarness result carries identity-tuple detail (type, name, filePath, _addedBy) per candidate', async () => {
    const { pack: langPack } = makeSpyLanguagePack();
    const { pack: fwPack } = makeSpyFrameworkPack(
      'spring-classic',
      'Spring',
      'spring-classic-adapter',
      2,
    );
    registerLanguagePack(langPack);
    registerFrameworkPack(fwPack);

    const result = await runHarness({
      sourceFiles: new Map([['src/Foo.java', 'class Foo {}']]),
      coreTech: 'Java, Spring',
    });

    expect(result.allCandidates).toHaveLength(2);
    for (const c of result.allCandidates) {
      // Type
      expect(typeof c.candidateType).toBe('string');
      expect(c.candidateType.length).toBeGreaterThan(0);
      // Name
      expect(c.name.startsWith('FakeService')).toBe(true);
      // File path (from sourceClusterIds[0])
      expect(c.sourceClusterIds[0]).toBe('src/Foo.java');
      // _addedBy tag under data
      const addedBy = (c.data as Record<string, unknown>)._addedBy;
      expect(addedBy).toBe('spring-classic-adapter');
    }
  });

  // =========================================================================
  // Test 4: Tier B — LanguagePack only, no FrameworkPack. extract() runs,
  // no adapt() calls. Zero candidates, Tier B.
  // =========================================================================
  test('runHarness with only a LanguagePack registered (Tier B) runs extract() and produces zero candidates', async () => {
    const { pack: langPack, extractSpy } = makeSpyLanguagePack();
    registerLanguagePack(langPack);
    // No framework pack.

    const result = await runHarness({
      sourceFiles: new Map([['src/A.java', 'class A {}']]),
      coreTech: 'Java, Spring',
    });

    expect(extractSpy).toHaveBeenCalledTimes(1);
    expect(result.tier).toBe('B');
    expect(result.languagePackId).toBe('java-lang');
    expect(result.irFileCount).toBe(1);
    expect(result.packResults).toHaveLength(0);
    expect(result.allCandidates).toHaveLength(0);
  });

  // =========================================================================
  // Test 5: run-spring-classic-local V3 wrapper — confirms the script uses
  // the V3 pack pair (`javaLangPack.extract` + `springClassicFrameworkPack.adapt`).
  // =========================================================================
  test('runSpringClassicV3 drives javaLangPack.extract + springClassicFrameworkPack.adapt (V3 pair)', () => {
    // No mocks here — exercise the real V3 pack pair against a trivial Java
    // file so parsing is guaranteed to succeed.
    const sourceFiles = new Map<string, string>([
      [
        'api/src/main/java/Example.java',
        'package com.example;\npublic class Example {}\n',
      ],
    ]);

    const run = runSpringClassicV3(sourceFiles);

    // extract() produced at least one IR (real javaLangPack path).
    expect(run.irFileCount).toBeGreaterThanOrEqual(1);
    // adapt() returns a DiscoveryCandidate[] — empty is acceptable for the
    // trivial fixture; what matters is we drive the V3 pair. If any
    // candidates ARE produced they must carry the V3 tag.
    for (const c of run.candidates) {
      expect((c.data as Record<string, unknown>)._addedBy).toBe('spring-classic-adapter');
    }
    // Timing fields recorded (shape contract for the exported helper).
    expect(typeof run.extractMs).toBe('number');
    expect(typeof run.adaptMs).toBe('number');
  });
});
