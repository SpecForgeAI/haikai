/**
 * Guard-rail contract test — manifest witness registry <-> gateway question
 * library (Spec 2026-06-26-target-dependency-manifest-auto-answer-comprehensive,
 * R10 / Task Group 10; hard requirement).
 *
 * Goal: any DRIFT between what the DETERMINISTIC manifest auto-answer can EMIT and
 * the question library's closed `choices` goes RED in CI. Mirrors the SPIRIT of
 * Spec 1's `versionControlConfig.guardrail.test.ts` (which reads the real
 * `QUESTION_LIBRARY` rather than a fixture copy). Three invariants:
 *
 *   (1) Every single-choice `value` the coordinate registry can emit is a
 *       VERBATIM member of that decision code's `questionLibrary.choices`.
 *   (2) Every bare-stem `framework` the coordinate registry / build-tool answer /
 *       property+plugin extractors can emit is a real BARE STEM of that code's
 *       choices (derived via Spec 1's `deriveBareStem` algorithm), i.e. it
 *       pre-selects a real chip downstream. A drifted / mis-keyed framework fails.
 *   (3) Every decision code the registry emits is a real library code, AND is one
 *       of Spec 1's `versioned: true` codes when emitted as `framework-version`
 *       (so the bare-stem `{ framework, version }` envelope is the right shape).
 *
 * ENUMERATION SOURCE = the REAL registry, never a fixture copy:
 *   - `ALL_COORDINATE_RULE_ANSWERS` (an additive projection of MAVEN_RULES +
 *     NPM_RULES on `manifestCodeMapping.ts`) — so adding a rule with a bad
 *     value/stem fails here automatically;
 *   - `buildToolAnswerForEcosystem` (the ecosystem-derived build tool); and
 *   - the REAL extractor functions (`deriveServiceLanguageFromProperties` /
 *     `deriveDbMigrationsFromPlugins`) driven with representative inputs (the
 *     closed set they can emit — Java/Kotlin, Flyway/Liquibase; a NEW extractor
 *     framework must be represented below or invariant (2) under-covers it).
 *
 * `deriveBareStem` is reimplemented locally (BYTE-IDENTICAL algorithm) because the
 * Spec 1 helper lives in the FRONTEND package and this is a gateway Jest suite
 * whose tsconfig `rootDir` is `./src` (a cross-package import would break the
 * compile). Spec 1's OWN guard-rail pins that helper against THIS same library, so
 * the two stay aligned. A local copy of the trivial, stable stripping rule is the
 * pragmatic faithful mirror.
 *
 * Violations are collected into arrays and asserted empty so a failure DIFF names
 * every offending `code -> value/framework` (Jest `expect` has no message arg).
 */

import {
  ALL_COORDINATE_RULE_ANSWERS,
  buildToolAnswerForEcosystem,
} from '../manifestCodeMapping';
import {
  deriveServiceLanguageFromProperties,
  deriveDbMigrationsFromPlugins,
} from '../manifestFactExtractors';
import { PomPlugin } from '../mavenPomMetadata';
import { QUESTION_LIBRARY } from '../../../config/architect-conversation/questionLibrary';

// ---------------------------------------------------------------------------
// Spec 1 `deriveBareStem` — local byte-identical mirror (see header rationale).
// Strip ONLY a trailing whitespace-separated token that BEGINS WITH A DIGIT
// (`Java 21` -> `Java`, `Spring Boot 3.4` -> `Spring Boot`, `Maven 3.9` ->
// `Maven`); a choice whose final token is non-numeric is already a bare stem and
// is returned verbatim (`pgjdbc`, `Node 20 LTS`, `Chakra v3`, `npm + tsc`).
// ---------------------------------------------------------------------------
function deriveBareStem(choice: string): string {
  const trimmed = choice.trim();
  const lastSpace = trimmed.lastIndexOf(' ');
  if (lastSpace === -1) return trimmed;
  const lastToken = trimmed.slice(lastSpace + 1);
  if (/^[0-9]/.test(lastToken)) return trimmed.slice(0, lastSpace).trim();
  return trimmed;
}

const entryByCode = new Map(QUESTION_LIBRARY.map((q) => [q.code, q]));

/** The library code's literal `choices` (empty when the code is unknown). */
function choicesFor(code: string): readonly string[] {
  return entryByCode.get(code)?.choices ?? [];
}

/** The deduped bare-stem set of a code's choices (Spec 1 chip set). */
function stemsFor(code: string): string[] {
  return choicesFor(code).map(deriveBareStem);
}

const isVersioned = (code: string): boolean =>
  entryByCode.get(code)?.versioned === true;

describe('manifest registry guard-rail — emissions subset of questionLibrary choices (R10)', () => {
  it('(0) the enumeration source is non-empty and emits only real library codes', () => {
    // Non-vacuous: the registry must actually emit something to guard.
    expect(ALL_COORDINATE_RULE_ANSWERS.length).toBeGreaterThan(0);

    const unknownCodes = ALL_COORDINATE_RULE_ANSWERS.filter(
      (a) => !entryByCode.has(a.decisionCode),
    ).map((a) => a.decisionCode);
    expect(unknownCodes).toEqual([]);
  });

  it('(1) every single-choice value the registry emits is a VERBATIM questionLibrary choice', () => {
    const singleChoice = ALL_COORDINATE_RULE_ANSWERS.filter(
      (a) => a.kind === 'single-choice',
    );
    // Non-vacuous: interservice.discoveryMechanism (Eureka/Consul) is the residue.
    expect(singleChoice.length).toBeGreaterThan(0);

    const violations = singleChoice
      .filter(
        (a) =>
          a.kind === 'single-choice' && !choicesFor(a.decisionCode).includes(a.value),
      )
      .map((a) =>
        a.kind === 'single-choice'
          ? `${a.decisionCode} -> "${a.value}" (choices: ${choicesFor(a.decisionCode).join(' | ')})`
          : '',
      );
    expect(violations).toEqual([]);
  });

  it('(2) every bare-stem framework the registry emits is a real bare stem of its code choices', () => {
    const fwAnswers = ALL_COORDINATE_RULE_ANSWERS.filter(
      (a) => a.kind === 'framework-version',
    );
    expect(fwAnswers.length).toBeGreaterThan(0);

    const violations = fwAnswers
      .filter(
        (a) =>
          a.kind === 'framework-version' &&
          !stemsFor(a.decisionCode).includes(a.framework),
      )
      .map((a) =>
        a.kind === 'framework-version'
          ? `${a.decisionCode} -> "${a.framework}" (stems: ${stemsFor(a.decisionCode).join(' | ')})`
          : '',
      );
    expect(violations).toEqual([]);
  });

  it('(3) every framework-version emission targets a Spec-1 versioned:true code', () => {
    // A bare-stem `{ framework, version }` envelope is only correct for a
    // versioned code; a non-versioned code must be emitted as single-choice.
    const violations = ALL_COORDINATE_RULE_ANSWERS.filter(
      (a) => a.kind === 'framework-version' && !isVersioned(a.decisionCode),
    ).map((a) => `${a.decisionCode} (framework-version on a non-versioned code)`);
    expect(violations).toEqual([]);
  });

  it('(4) the ecosystem build-tool answers are bare stems of build.tool choices', () => {
    const stems = stemsFor('build.tool');
    const maven = buildToolAnswerForEcosystem('MAVEN');
    const npm = buildToolAnswerForEcosystem('NPM');
    expect(maven).not.toBeNull();
    expect(npm).not.toBeNull();
    expect(stems).toContain(maven!.framework); // Maven
    expect(stems).toContain(npm!.framework); // npm + tsc
    // build.tool is itself a versioned code (so the bare-stem envelope is right).
    expect(isVersioned('build.tool')).toBe(true);
  });

  it('(5) every property + plugin extractor framework is a bare stem of its code', () => {
    // Drive the REAL extractors with representative inputs spanning the closed set
    // they can emit. New extractor frameworks MUST be added here to stay covered.
    const plugin = (groupId: string, artifactId: string): PomPlugin => ({
      groupId,
      artifactId,
      version: null,
      configSummary: null,
      isManaged: false,
    });

    const extractorEmissions: { code: string; framework: string }[] = [
      // service.language (property extractor).
      {
        code: 'service.language',
        framework: deriveServiceLanguageFromProperties({ 'java.version': '21' })!
          .framework,
      },
      {
        code: 'service.language',
        framework: deriveServiceLanguageFromProperties({
          'maven.compiler.release': '21',
        })!.framework,
      },
      {
        code: 'service.language',
        framework: deriveServiceLanguageFromProperties({
          'kotlin.version': '2.0.21',
        })!.framework,
      },
      // db.migrations (plugin extractor).
      {
        code: 'db.migrations',
        framework: deriveDbMigrationsFromPlugins([
          plugin('org.flywaydb', 'flyway-maven-plugin'),
        ])!.framework,
      },
      {
        code: 'db.migrations',
        framework: deriveDbMigrationsFromPlugins([
          plugin('org.liquibase', 'liquibase-maven-plugin'),
        ])!.framework,
      },
    ];

    const violations = extractorEmissions
      .filter((e) => !stemsFor(e.code).includes(e.framework))
      .map(
        (e) =>
          `${e.code} -> "${e.framework}" (stems: ${stemsFor(e.code).join(' | ')})`,
      );
    expect(violations).toEqual([]);

    // Both extractor codes are Spec-1 versioned (bare-stem envelope is correct).
    expect(isVersioned('service.language')).toBe(true);
    expect(isVersioned('db.migrations')).toBe(true);
  });
});
