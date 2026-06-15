/**
 * Tests for the V3 migration of the spring-classic pack.
 *
 * Spec: V3 Discovery Pipeline Foundation (Task Group 4)
 *
 * Covers the reference-pack split:
 *  - `javaLangPack` (LanguagePack): wraps `extractJavaIR` + `filterJavaFiles` +
 *    `isTestFile`, producing `Map<filePath, SourceFileIR>` for .java files
 *    and omitting test files.
 *  - `springClassicFrameworkPack` (FrameworkPack): delegates to the existing
 *    `runSpringClassicAdapter` and emits candidates tagged
 *    `_addedBy: 'spring-classic-adapter'`.
 *  - `register.ts` registers both via the V3 registry surface so
 *    `findLanguagePack({ language: 'Java' })` and
 *    `findFrameworkPacks({ language: 'Java', technology: 'Spring' })`
 *    return them.
 *
 * Adapter-logic exhaustive coverage is deliberately skipped here — OpenMRS
 * parity in Task Group 7 is the acceptance vehicle. The smoke-level
 * assertions here only verify that the V3 wrappers are wired correctly.
 *
 * Modeled on `extensionPackFramework.test.ts` and
 * `extensionPackRegistryV3.test.ts`.
 */

import type { SourceFileIR, TechHints } from '../services/extensionPacks';
import { javaLangPack } from '../services/extensionPacks/languagePacks/javaLangPack/index';
import { springClassicFrameworkPack } from '../services/extensionPacks/frameworkPacks/springClassicFrameworkPack/index';

// --------------------------------------------------------------------------
// Fixture sources — minimal Java inputs sufficient for smoke assertions.
// --------------------------------------------------------------------------

const CONTROLLER_SRC = `
package org.example.web;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.GetMapping;

@Controller
@RequestMapping("/patients")
public class PatientController {
  @GetMapping
  public String listPatients() { return "patients/list"; }
}
`;

const javaOnlyHints: TechHints = {
  '0': { language: 'Java' },
};

const classicSpringHints: TechHints = {
  '0': { language: 'Java' },
  '1': { technology: 'Spring' },
};

describe('Task Group 4: spring-classic V3 migration', () => {
  // -------------------------------------------------------------------------
  // Test 1: javaLangPack.extract returns IR for .java files (non-test only).
  // -------------------------------------------------------------------------
  test('javaLangPack.extract returns Map<filePath, SourceFileIR> for .java files, omitting test files', () => {
    const sourceFiles = new Map<string, string>([
      ['src/main/java/org/example/web/PatientController.java', CONTROLLER_SRC],
      ['src/test/java/org/example/web/PatientControllerTest.java', CONTROLLER_SRC],
      ['src/main/java/org/example/util/README.md', '# docs'],
    ]);

    const ir = javaLangPack.extract(sourceFiles, javaOnlyHints);

    // Non-test .java file is present.
    expect(
      ir.has('src/main/java/org/example/web/PatientController.java'),
    ).toBe(true);
    const entry = ir.get(
      'src/main/java/org/example/web/PatientController.java',
    )!;
    expect(entry.filePath).toBe(
      'src/main/java/org/example/web/PatientController.java',
    );
    expect(entry.language).toBe('java');

    // Test file is filtered out.
    expect(
      ir.has('src/test/java/org/example/web/PatientControllerTest.java'),
    ).toBe(false);

    // Non-.java file is filtered out.
    expect(ir.has('src/main/java/org/example/util/README.md')).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Test 2: springClassicFrameworkPack.adapt emits spring-classic-adapter
  // candidates against a minimal IR map.
  // -------------------------------------------------------------------------
  test('springClassicFrameworkPack.adapt emits candidates tagged _addedBy: "spring-classic-adapter"', () => {
    const sourceFiles = new Map<string, string>([
      ['src/main/java/org/example/web/PatientController.java', CONTROLLER_SRC],
    ]);
    const irFiles = javaLangPack.extract(sourceFiles, classicSpringHints);
    expect(irFiles.size).toBeGreaterThan(0);

    const candidates = springClassicFrameworkPack.adapt(
      irFiles,
      'run-v3-smoke',
      classicSpringHints,
    );

    // The controller fixture produces at least an `interface` + `endpoint`.
    expect(candidates.length).toBeGreaterThan(0);
    for (const c of candidates) {
      expect((c.data as Record<string, unknown>)._addedBy).toBe(
        'spring-classic-adapter',
      );
      expect(c.runId).toBe('run-v3-smoke');
    }
    // Interface candidate names the controller class.
    const ifaces = candidates.filter((c) => c.candidateType === 'interfaces');
    expect(ifaces.map((c) => c.name)).toContain('PatientController');
  });

  // -------------------------------------------------------------------------
  // Test 3: Registry smoke — after `register.ts` runs, the V3 lookups
  // return the migrated packs for classic-Spring techHints.
  //
  // `register.ts` runs its registrations as a side-effect at module load.
  // We use `jest.isolateModules` so both `register` AND the registry it
  // writes to resolve to the same isolated module instance — otherwise
  // the registrations land in a copy the outer `findLanguagePack` /
  // `findFrameworkPacks` would never see.
  // -------------------------------------------------------------------------
  test('register.ts registers javaLangPack + springClassicFrameworkPack for Java/Spring techHints', () => {
    jest.isolateModules(() => {
      const registry = require('../services/extensionPackRegistry');
      registry.clearRegistry();
      // Side-effect import: top-level `registerLanguagePack` /
      // `registerFrameworkPack` calls in `register.ts` populate the
      // registry now cleared above.
      require('../services/extensionPacks/register');

      const language = registry.findLanguagePack(javaOnlyHints);
      expect(language).not.toBeNull();
      expect(language.id).toBe('java-lang');

      const frameworks = registry.findFrameworkPacks(classicSpringHints);
      const ids = frameworks.map((p: { id: string }) => p.id);
      expect(ids).toContain('spring-classic');

      // Spring Boot hints must NOT surface the classic pack (per-field AND
      // predicate distinction preserved — `{technology: 'Spring Boot'}`
      // does not satisfy a classic-Spring `{technology: 'Spring'}` predicate).
      const bootHints: TechHints = {
        '0': { language: 'Java' },
        '1': { technology: 'Spring Boot' },
      };
      const bootFrameworks = registry.findFrameworkPacks(bootHints);
      expect(
        bootFrameworks.map((p: { id: string }) => p.id),
      ).not.toContain('spring-classic');
    });
  });
});

// Keep lint happy for the unused helper type imports.
export type _KeepSourceFileIRImport = SourceFileIR;
export const _keepPackImports = { javaLangPack, springClassicFrameworkPack };
