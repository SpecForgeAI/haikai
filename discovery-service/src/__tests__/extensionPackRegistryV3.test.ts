/**
 * Tests for V3 Extension Pack Registry refactor.
 *
 * Spec: V3 Discovery Pipeline Foundation (Task Group 3)
 *
 * Covers the new two-tier registry surface:
 *  - `registerLanguagePack` / `registerFrameworkPack`
 *  - `findLanguagePack` / `findFrameworkPacks`
 *  - `computeTier` returning 'A' | 'B' | 'C'
 *  - `clearRegistry` resets both new registries
 *  - Per-field AND semantics on predicates (classic-Spring vs Spring Boot)
 *
 * Modeled on `extensionPackFramework.test.ts`.
 */

import type { DiscoveryCandidate } from '../types/candidate';
import type {
  LanguagePack,
  FrameworkPack,
  SourceFileIR,
  TechHints,
} from '../services/extensionPacks';
import {
  clearRegistry,
  computeTier,
  findFrameworkPacks,
  findLanguagePack,
  registerFrameworkPack,
  registerLanguagePack,
} from '../services/extensionPackRegistry';

// -- Helpers ----------------------------------------------------------------

function makeLanguagePack(overrides: Partial<LanguagePack> = {}): LanguagePack {
  return {
    id: 'java-lang',
    when: { language: 'Java' },
    extract: (_sourceFiles: Map<string, string>, _techHints: TechHints) =>
      new Map<string, SourceFileIR>(),
    ...overrides,
  };
}

function makeFrameworkPack(overrides: Partial<FrameworkPack> = {}): FrameworkPack {
  return {
    id: 'spring-classic',
    when: { language: 'Java', technology: 'Spring' },
    adapt: (
      _irFiles: Map<string, SourceFileIR>,
      _runId: string,
      _techHints: TechHints,
    ): DiscoveryCandidate[] => [],
    ...overrides,
  };
}

// TechHints shape produced by `parseCoretech("Java, Spring")` — one hint with
// language only, another with technology only.
const classicSpringHints: TechHints = {
  '0': { language: 'Java' },
  '1': { technology: 'Spring' },
};

// TechHints where only a language hint is available (no framework tech).
const javaOnlyHints: TechHints = {
  '0': { language: 'Java' },
};

// TechHints with no java/spring presence at all.
const pythonOnlyHints: TechHints = {
  '0': { language: 'Python' },
};

// TechHints that include Spring Boot instead of classic Spring — the
// per-field AND predicate must NOT match a classic-Spring pack here.
const springBootHints: TechHints = {
  '0': { language: 'Java' },
  '1': { technology: 'Spring Boot' },
};

describe('Task Group 3: V3 Registry refactor', () => {
  beforeEach(() => {
    clearRegistry();
  });

  // -------------------------------------------------------------------------
  // Test 1: computeTier() returns 'A' when both language AND framework match
  // -------------------------------------------------------------------------
  test("computeTier() returns 'A' when both a language pack and a framework pack match", () => {
    registerLanguagePack(makeLanguagePack());
    registerFrameworkPack(makeFrameworkPack());

    expect(computeTier(classicSpringHints)).toBe('A');
  });

  // -------------------------------------------------------------------------
  // Test 2: computeTier() returns 'B' when only a language pack matches
  // -------------------------------------------------------------------------
  test("computeTier() returns 'B' when only a language pack matches", () => {
    registerLanguagePack(makeLanguagePack());
    registerFrameworkPack(makeFrameworkPack()); // spring-classic, requires tech:'Spring'

    // Only a Java hint — no Spring technology hint, so the framework pack
    // cannot match while the language pack still does.
    expect(computeTier(javaOnlyHints)).toBe('B');
  });

  // -------------------------------------------------------------------------
  // Test 3: computeTier() returns 'C' when neither language nor framework match
  // -------------------------------------------------------------------------
  test("computeTier() returns 'C' when neither a language pack nor a framework pack matches", () => {
    registerLanguagePack(makeLanguagePack()); // Java
    registerFrameworkPack(makeFrameworkPack()); // Java + Spring

    expect(computeTier(pythonOnlyHints)).toBe('C');
  });

  // -------------------------------------------------------------------------
  // Test 4: findLanguagePack() returns the correct pack for Java techHints
  // -------------------------------------------------------------------------
  test('findLanguagePack() returns the correct pack for Java techHints', () => {
    const javaPack = makeLanguagePack({ id: 'java-lang' });
    const tsPack = makeLanguagePack({
      id: 'typescript-lang',
      when: { language: 'TypeScript' },
    });

    registerLanguagePack(javaPack);
    registerLanguagePack(tsPack);

    const found = findLanguagePack(javaOnlyHints);
    expect(found).not.toBeNull();
    expect(found!.id).toBe('java-lang');

    // TypeScript hints resolve the TypeScript pack, not Java.
    const tsHints: TechHints = { '0': { language: 'TypeScript' } };
    const foundTs = findLanguagePack(tsHints);
    expect(foundTs).not.toBeNull();
    expect(foundTs!.id).toBe('typescript-lang');

    // Unknown language -> null.
    expect(findLanguagePack(pythonOnlyHints)).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Test 5: findFrameworkPacks() returns [] when techHints match no framework
  // -------------------------------------------------------------------------
  test('findFrameworkPacks() returns [] when techHints match no registered framework', () => {
    // No packs registered at all.
    expect(findFrameworkPacks(classicSpringHints)).toEqual([]);

    // Register a framework pack — but query with unrelated hints.
    registerFrameworkPack(makeFrameworkPack());
    expect(findFrameworkPacks(pythonOnlyHints)).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Test 6: Pins per-field AND semantics — classic-Spring hints match a
  // classic-Spring framework pack but NOT a Spring-Boot framework pack.
  // -------------------------------------------------------------------------
  test('findFrameworkPacks preserves per-field AND semantics: classic Spring matches classic, not Boot', () => {
    const classicPack = makeFrameworkPack({
      id: 'spring-classic',
      when: { language: 'Java', technology: 'Spring' },
    });
    const bootPack = makeFrameworkPack({
      id: 'spring-boot',
      when: { language: 'Java', technology: 'Spring Boot' },
    });

    registerFrameworkPack(classicPack);
    registerFrameworkPack(bootPack);

    // classicSpringHints => only classicPack matches.
    const classicMatches = findFrameworkPacks(classicSpringHints);
    expect(classicMatches.map((p) => p.id)).toEqual(['spring-classic']);

    // springBootHints => only bootPack matches, NOT classicPack.
    const bootMatches = findFrameworkPacks(springBootHints);
    expect(bootMatches.map((p) => p.id)).toEqual(['spring-boot']);
  });

  // -------------------------------------------------------------------------
  // Test 7: clearRegistry() resets both new registries
  // -------------------------------------------------------------------------
  test('clearRegistry() resets both the language and framework registries', () => {
    registerLanguagePack(makeLanguagePack());
    registerFrameworkPack(makeFrameworkPack());

    // Sanity — populated before clearing.
    expect(findLanguagePack(javaOnlyHints)).not.toBeNull();
    expect(findFrameworkPacks(classicSpringHints)).toHaveLength(1);

    clearRegistry();

    expect(findLanguagePack(javaOnlyHints)).toBeNull();
    expect(findFrameworkPacks(classicSpringHints)).toEqual([]);
  });
});
