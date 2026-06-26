/**
 * Guard-rail contract test — versionControlConfig <-> gateway question library
 * (Spec 2026-06-26-target-conversation-versioned-answer-bare-stem-ux, Task 3.1;
 * hard requirement).
 *
 * Goal: any chip / choice / default / cascade-seed DRIFT goes RED in CI. This
 * pins three invariants that span the gateway question library and the frontend
 * versioned-answer config:
 *
 *   (0) `VERSIONED_DECISION_CODES` mirrors the gateway `versioned: true` closed
 *       set EXACTLY (the 24 codes).
 *   (1) Every single-choice value the system EMITS (each cascade seed value) is a
 *       real member of its target code's `questionLibrary.choices` — or, when the
 *       target is itself versioned, a real BARE STEM of those choices. A drifted
 *       / mis-re-keyed seed fails here.
 *   (2) Every versioned chip STEM carries a curated default version in
 *       `RECOMMENDED_VERSION_BY_FRAMEWORK`. Version-less mixed stems
 *       (`none` / `manual` / `in-house` / `native`-style) are the EXPLICIT
 *       exception and must carry NO default.
 *
 * Cross-package import rationale: unlike the closed enum contracts
 * (`scopeRefType`, `frameworkVersionShape`) which have a JSON source of truth,
 * the question library is TS-only and has no JSON form. Detecting choice/seed
 * drift REQUIRES reading the real library, so this test imports the gateway
 * `QUESTION_LIBRARY` directly (Vitest transpiles it via esbuild — no whole-repo
 * build). A local fixture copy would itself drift and defeat the guard-rail.
 */

import { describe, it, expect } from 'vitest';

import {
  VERSIONED_DECISION_CODES,
  RECOMMENDED_VERSION_BY_FRAMEWORK,
  recommendedVersionFor,
  dedupeBareStemChoices,
  deriveBareStem,
  isVersionLessStem,
} from '../versionControlConfig';
// Cross-package TS import. Path resolves six levels up:
// __tests__ -> architectConversation -> targetState -> components -> src ->
// frontend -> repo root, then into gateway.
import { QUESTION_LIBRARY } from '../../../../../../gateway/src/config/architect-conversation/questionLibrary';

const versionedEntries = QUESTION_LIBRARY.filter((q) => q.versioned);
const entryByCode = new Map(QUESTION_LIBRARY.map((q) => [q.code, q]));

describe('versionControlConfig guard-rail contract', () => {
  it('(0) VERSIONED_DECISION_CODES mirrors the gateway versioned:true closed set (24)', () => {
    const gatewayVersioned = versionedEntries.map((q) => q.code).sort();
    expect([...VERSIONED_DECISION_CODES].sort()).toEqual(gatewayVersioned);
    // Belt-and-braces: pin the closed-set size so an accidental add/remove on
    // either side surfaces as a clear failure, not a silent re-sort match.
    expect(VERSIONED_DECISION_CODES.length).toBe(24);
    expect(gatewayVersioned.length).toBe(24);
  });

  it('(2) every non-version-less stem of every versioned code has a curated default', () => {
    for (const q of versionedEntries) {
      const choices = q.choices ?? [];
      expect(choices.length, `versioned code ${q.code} must declare choices`).toBeGreaterThan(0);

      for (const { stem, defaultVersion } of dedupeBareStemChoices(choices)) {
        if (isVersionLessStem(stem)) {
          // EXPLICIT exception: version-less stems carry NO default + NO entry.
          expect(
            defaultVersion,
            `${q.code} version-less stem "${stem}" must carry no version`,
          ).toBeNull();
          expect(
            RECOMMENDED_VERSION_BY_FRAMEWORK[stem],
            `${q.code} version-less stem "${stem}" must have no curated default`,
          ).toBeUndefined();
        } else {
          const curated = RECOMMENDED_VERSION_BY_FRAMEWORK[stem];
          expect(
            typeof curated === 'string' && curated.length > 0,
            `${q.code} stem "${stem}" needs a curated default version`,
          ).toBe(true);
          // The dedup seam resolves the SAME curated value the control commits.
          expect(defaultVersion).toBe(curated);
          expect(recommendedVersionFor(stem)).toBe(curated);
        }
      }
    }
  });

  it('(1) every cascade seed value is a real choice (or bare stem) of its target code', () => {
    for (const q of QUESTION_LIBRARY) {
      for (const cascade of q.cascades) {
        const target = entryByCode.get(cascade.decisionCode);
        expect(
          target,
          `${q.code} cascade targets unknown code ${cascade.decisionCode}`,
        ).toBeTruthy();
        if (!target) continue;

        const targetChoices = target.choices ?? [];
        const targetStems = dedupeBareStemChoices(targetChoices).map((c) => c.stem);

        for (const seed of Object.values(cascade.valueByTriggerValue)) {
          if (typeof seed !== 'string') continue; // structured seeds are not chip values
          if (target.versioned) {
            // Versioned target: a cascaded value must match a BARE STEM so it
            // pre-selects that stem's curated default downstream.
            expect(
              targetStems,
              `${q.code} -> ${target.code} seed "${seed}" must be a bare stem of ${target.code}`,
            ).toContain(seed);
          } else {
            // Single-choice target: the seed must be a literal choice member.
            expect(
              targetChoices,
              `${q.code} -> ${target.code} seed "${seed}" must be a choice of ${target.code}`,
            ).toContain(seed);
          }
        }
      }
    }
  });
});

describe('bare-stem dedup helper', () => {
  it('de-doubles build.tool: Maven 3.9 -> { Maven, 3.9 } and Gradle 8 -> { Gradle, 8 }', () => {
    const buildTool = entryByCode.get('build.tool');
    expect(buildTool?.versioned).toBe(true);

    const deduped = dedupeBareStemChoices(buildTool?.choices ?? []);
    expect(deduped).toContainEqual({ stem: 'Maven', defaultVersion: '3.9' });
    expect(deduped).toContainEqual({ stem: 'Gradle', defaultVersion: '8' });
    // The doubled stem ('Maven 3.9' as both framework AND version) is gone.
    expect(deduped.map((c) => c.stem)).not.toContain('Maven 3.9');
  });

  it('collapses Java 21 + Java 17 into ONE Java chip carrying its curated default', () => {
    const lang = entryByCode.get('service.language');
    const deduped = dedupeBareStemChoices(lang?.choices ?? []);
    const javaChips = deduped.filter((c) => c.stem === 'Java');

    expect(javaChips).toHaveLength(1);
    expect(javaChips[0]).toEqual({ stem: 'Java', defaultVersion: '21.0.5' });
    // Version-laden chips never leak through the seam.
    expect(deduped.map((c) => c.stem)).not.toContain('Java 21');
    expect(deduped.map((c) => c.stem)).not.toContain('Java 17');
  });

  it('emits a version-less stem with no version field (Spring Boot default is 4.0)', () => {
    expect(deriveBareStem('Spring Boot 3.4')).toBe('Spring Boot');
    expect(recommendedVersionFor('Spring Boot')).toBe('4.0');

    const migrations = entryByCode.get('db.migrations');
    const deduped = dedupeBareStemChoices(migrations?.choices ?? []);
    expect(deduped).toContainEqual({
      stem: 'none-managed-by-app',
      defaultVersion: null,
    });
  });
});
