/**
 * Tests for the V3 migration of the java-spring-boot pack.
 *
 * Spec: V3 Pack Migration Batch (Task Group 2)
 *
 * Covers the V3 wiring for spring-boot:
 *  - `springBootFrameworkPack.adapt` produces non-empty candidates against
 *    a small seeded IR fixture and tags them with
 *    `_addedBy: 'spring-boot-adapter'`.
 *  - `register.ts` exposes the new pack via the V3 registry surface for
 *    Spring Boot techHints, without colliding with the classic-Spring
 *    pack (per-field AND predicate semantics preserved).
 *
 * Adapter-logic exhaustive coverage is deliberately skipped — covered by
 * the per-pack 98% gate (`scripts/run-pack-local.ts` against PetClinic)
 * and the migrated smoke test (`springBootAdapter.smoke.test.ts`).
 *
 * Modeled on `springClassicPackV3Migration.test.ts`.
 */

import type { TechHints } from '../services/extensionPacks';
import { javaLangPack } from '../services/extensionPacks/languagePacks/javaLangPack/index';
import { springBootFrameworkPack } from '../services/extensionPacks/frameworkPacks/springBootFrameworkPack/index';
import { springClassicFrameworkPack } from '../services/extensionPacks/frameworkPacks/springClassicFrameworkPack/index';

// --------------------------------------------------------------------------
// Fixture sources — minimal Spring Boot inputs sufficient for smoke assertions.
// --------------------------------------------------------------------------

const REST_CONTROLLER_SRC = `
package org.example.owner;

import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;

@RestController
@RequestMapping("/api/owners")
public class OwnerRestController {
  @GetMapping("/{id}")
  public String findOne(@PathVariable Long id) { return "owner-" + id; }
}
`;

const ENTITY_SRC = `
package org.example.owner;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Column;
import jakarta.persistence.Table;

@Entity
@Table(name = "owners")
public class Owner {
  @Id
  private Long id;

  @Column(name = "first_name", nullable = false)
  private String firstName;
}
`;

const springBootHints: TechHints = {
  '0': { language: 'Java' },
  '1': { technology: 'Spring Boot' },
};

const classicSpringHints: TechHints = {
  '0': { language: 'Java' },
  '1': { technology: 'Spring' },
};

describe('Task Group 2: java-spring-boot V3 migration', () => {
  // -------------------------------------------------------------------------
  // Test 1: springBootFrameworkPack.adapt emits spring-boot-adapter
  // candidates against a minimal IR map and preserves the runId.
  // -------------------------------------------------------------------------
  test('springBootFrameworkPack.adapt emits candidates tagged _addedBy: "spring-boot-adapter"', () => {
    const sourceFiles = new Map<string, string>([
      ['src/main/java/org/example/owner/OwnerRestController.java', REST_CONTROLLER_SRC],
      ['src/main/java/org/example/owner/Owner.java', ENTITY_SRC],
    ]);
    const irFiles = javaLangPack.extract(sourceFiles, springBootHints);
    expect(irFiles.size).toBe(2);

    const candidates = springBootFrameworkPack.adapt(
      irFiles,
      'run-v3-springboot-smoke',
      springBootHints,
    );

    expect(candidates.length).toBeGreaterThan(0);
    for (const c of candidates) {
      expect((c.data as Record<string, unknown>)._addedBy).toBe(
        'spring-boot-adapter',
      );
      expect(c.runId).toBe('run-v3-springboot-smoke');
    }

    // Controller fixture produces an `interface` named after the class.
    const ifaces = candidates.filter((c) => c.candidateType === 'interfaces');
    expect(ifaces.map((c) => c.name)).toContain('OwnerRestController');

    // Entity fixture produces a `physical_entity` named after the class.
    const entities = candidates.filter(
      (c) => c.candidateType === 'physical_data_entities',
    );
    expect(entities.map((c) => c.name)).toContain('Owner');
  });

  // -------------------------------------------------------------------------
  // Test 2: empty IR map returns empty candidate list (no crashes when the
  // language pack filters everything away).
  // -------------------------------------------------------------------------
  test('springBootFrameworkPack.adapt on empty IR map returns []', () => {
    const candidates = springBootFrameworkPack.adapt(
      new Map(),
      'run-empty',
      springBootHints,
    );
    expect(candidates).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Test 3: Registry smoke — `register.ts` registers springBootFrameworkPack
  // for Spring Boot techHints and does NOT collide with the spring-classic
  // pack (per-field AND predicate semantics).
  // -------------------------------------------------------------------------
  test('register.ts registers springBootFrameworkPack for Spring Boot, distinct from spring-classic', () => {
    jest.isolateModules(() => {
      const registry = require('../services/extensionPackRegistry');
      registry.clearRegistry();
      // Side-effect import: top-level `registerLanguagePack` /
      // `registerFrameworkPack` calls in `register.ts` populate the
      // registry now cleared above.
      require('../services/extensionPacks/register');

      // Spring Boot hints must surface the new java-spring-boot pack.
      const bootFrameworks = registry.findFrameworkPacks(springBootHints);
      const bootIds = bootFrameworks.map((p: { id: string }) => p.id);
      expect(bootIds).toContain('java-spring-boot');
      // ...and must NOT surface the classic-Spring pack.
      expect(bootIds).not.toContain('spring-classic');

      // Classic Spring hints must surface spring-classic and NOT
      // java-spring-boot — the per-field AND predicate distinguishes
      // `{technology: 'Spring'}` from `{technology: 'Spring Boot'}`.
      const classicFrameworks = registry.findFrameworkPacks(classicSpringHints);
      const classicIds = classicFrameworks.map((p: { id: string }) => p.id);
      expect(classicIds).toContain('spring-classic');
      expect(classicIds).not.toContain('java-spring-boot');
    });
  });

  // -------------------------------------------------------------------------
  // Test 4: pack id + predicate shape sanity check (catches accidental
  // copy-paste errors from the spring-classic template).
  // -------------------------------------------------------------------------
  test('springBootFrameworkPack has the correct id and predicate', () => {
    expect(springBootFrameworkPack.id).toBe('java-spring-boot');
    expect(springBootFrameworkPack.when).toEqual({
      language: 'Java',
      technology: 'Spring Boot',
    });
    // Make sure it's not accidentally aliased to the classic pack.
    expect(springBootFrameworkPack).not.toBe(springClassicFrameworkPack);
    expect(springBootFrameworkPack.id).not.toBe(springClassicFrameworkPack.id);
  });
});
