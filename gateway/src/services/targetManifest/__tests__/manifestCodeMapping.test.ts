/**
 * Spec 2 (2026-06-26-target-dependency-manifest-auto-answer-comprehensive) —
 * Task Group 2 tests: the coordinate registry's UNION answer shape + closed-
 * choice witness coverage.
 *
 * Scope (focused): the union shapes (bare-stem framework-version vs single-choice
 * value), first-matching-rule-wins, the selection boundary (a not-manifest code
 * is never emitted), an unmatched coordinate => null, and the bare-stem
 * `build.tool` answer. Per-library exhaustive coverage is intentionally skipped;
 * the full questionLibrary guard-rail is Task Group 10.
 */

import {
  matchManifestCoordinate,
  buildToolAnswerForEcosystem,
  DEPENDENCY_ANSWERABLE_CODES,
  COORDINATE_ANSWERABLE_CODES,
} from '../manifestCodeMapping';
import { ManifestEcosystem } from '../manifestDependencyResolvers';
import { ResolvedDependency } from '../manifestVersionResolution';
import { QUESTION_LIBRARY } from '../../../config/architect-conversation/questionLibrary';

/** Minimal ResolvedDependency for a coordinate name (version is irrelevant here). */
function dep(name: string, ecosystem: ManifestEcosystem = 'MAVEN'): ResolvedDependency {
  return {
    name,
    ecosystem,
    tag: 'svc',
    manifestPath: ecosystem === 'MAVEN' ? 'pom.xml' : 'package.json',
    resolvedVersion: '1.2.3',
    versionUnknown: false,
    source: 'declared',
    declaredVersion: '1.2.3',
    declaredScope: 'compile',
    evidence: `${name} 1.2.3`,
  };
}

function choicesFor(code: string): readonly string[] {
  return QUESTION_LIBRARY.find((q) => q.code === code)?.choices ?? [];
}

describe('manifest coordinate registry — union answer shape (Spec 2 Group 2)', () => {
  it('a versioned-code witness returns a bare-stem framework-version answer', () => {
    // Flyway runtime lib => db.migrations (a Spec-1 versioned code) as a BARE STEM.
    const match = matchManifestCoordinate(dep('org.flywaydb:flyway-core'));
    expect(match).toEqual({
      decisionCode: 'db.migrations',
      kind: 'framework-version',
      framework: 'Flyway',
    });

    // A driver witness is likewise a bare stem (no version baked into the stem).
    expect(matchManifestCoordinate(dep('org.postgresql:postgresql'))).toEqual({
      decisionCode: 'db.driver',
      kind: 'framework-version',
      framework: 'pgjdbc',
    });
  });

  it('a genuinely-non-versioned residue witness returns a single-choice value (exact questionLibrary choice)', () => {
    const eureka = matchManifestCoordinate(
      dep('org.springframework.cloud:spring-cloud-starter-netflix-eureka-client'),
    );
    expect(eureka).toEqual({
      decisionCode: 'interservice.discoveryMechanism',
      kind: 'single-choice',
      value: 'Eureka',
    });
    const consul = matchManifestCoordinate(
      dep('org.springframework.cloud:spring-cloud-starter-consul-discovery'),
    );
    expect(consul).toEqual({
      decisionCode: 'interservice.discoveryMechanism',
      kind: 'single-choice',
      value: 'Consul',
    });

    // The emitted single-choice values are VERBATIM questionLibrary choices.
    const discoveryChoices = choicesFor('interservice.discoveryMechanism');
    expect(discoveryChoices).toContain('Eureka');
    expect(discoveryChoices).toContain('Consul');
  });

  it('first-matching-rule-wins: a spring-boot starter maps to service.framework, not a narrower code', () => {
    // spring-boot-starter-validation would "look like" validation.framework, but
    // the broad Spring Boot rule is declared first and wins.
    const match = matchManifestCoordinate(
      dep('org.springframework.boot:spring-boot-starter-validation'),
    );
    expect(match).toEqual({
      decisionCode: 'service.framework',
      kind: 'framework-version',
      framework: 'Spring Boot',
    });
  });

  it('npm @angular/cli maps to ui.buildTool (Angular CLI), not ui.framework (Angular)', () => {
    const match = matchManifestCoordinate(dep('@angular/cli', 'NPM'));
    expect(match).toEqual({
      decisionCode: 'ui.buildTool',
      kind: 'framework-version',
      framework: 'Angular CLI',
    });
    // ...while @angular/core still witnesses the framework.
    expect(matchManifestCoordinate(dep('@angular/core', 'NPM'))).toMatchObject({
      decisionCode: 'ui.framework',
      framework: 'Angular',
    });
  });

  it('an unmatched coordinate returns null (most coordinates are ordinary libraries)', () => {
    expect(matchManifestCoordinate(dep('com.example:some-random-lib'))).toBeNull();
    expect(matchManifestCoordinate(dep('left-pad', 'NPM'))).toBeNull();
  });

  it('never emits / answers a not-manifest code (selection boundary)', () => {
    for (const notManifest of [
      'cutover.strategy',
      'api.auth',
      'secrets.management',
      'service.processModel',
      'logging.format',
      'container.runtime',
      'ci.pipeline',
      'deployment.target',
    ]) {
      expect(DEPENDENCY_ANSWERABLE_CODES.has(notManifest)).toBe(false);
      expect(COORDINATE_ANSWERABLE_CODES.has(notManifest)).toBe(false);
    }
  });

  it('build.tool emits a bare-stem framework-version answer (de-doubled per Spec 1)', () => {
    expect(buildToolAnswerForEcosystem('MAVEN')).toEqual({
      framework: 'Maven',
      version: '3.9',
    });
    expect(buildToolAnswerForEcosystem('NPM')).toEqual({
      framework: 'npm + tsc',
      version: '10.9.0',
    });
    // The bare stems are valid build.tool choice stems. Version-decoupling
    // (2026-06-27, target-state 3-spec initiative) made the library choices
    // BARE stems ('Maven', not 'Maven 3.9') — the version rides the
    // framework-version answer, never the choice label.
    const buildToolChoices = choicesFor('build.tool');
    expect(buildToolChoices).toContain('Maven');
    expect(buildToolChoices).toContain('npm + tsc');
  });
});
