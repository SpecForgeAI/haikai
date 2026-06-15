/**
 * Tests for GET /discovery/packs/applicable tier/mode/warnings enrichment.
 *
 * Spec: 2026-04-20 V3 Tier UX — Task Group 5.
 *
 * The preflight endpoint must surface the SAME tier + mode + warnings copy
 * that the POST /discovery/runs gate surfaces so callers can decide whether
 * to opt in (Tier C) before submitting a run. The copy originates from the
 * shared `tierCopy` helpers — this suite is the regression net that proves
 * both endpoints stay in lock-step.
 *
 * Coverage:
 *   1. Tier A (Java + Spring Boot) — mode='pack-supervised', warnings=[].
 *   2. Tier B (Java language pack, no framework match) — mode='language-only',
 *      warnings = [Tier B copy].
 *   3. Tier C (no pack matches at all) — mode='llm-solo',
 *      warnings = [Tier C copy].
 *   4. Existing response fields (coreTech, techHints, applicable,
 *      notApplicable) still present alongside the new fields.
 *   5. Missing `coreTech` query param still returns 400 (unchanged behaviour).
 */

jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

import express from 'express';
import supertest from 'supertest';
import {
  clearRegistry,
  registerFrameworkPack,
  registerLanguagePack,
} from '../services/extensionPackRegistry';
import type { FrameworkPack, LanguagePack } from '../services/extensionPacks';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Minimal LanguagePack matching `{ language: '<lang>' }` (case-sensitive). */
function makeLanguagePack(id: string, language: string): LanguagePack {
  return {
    id,
    when: { language },
    extract: () => new Map(),
  };
}

/** Minimal FrameworkPack matching `{ language, technology }`. */
function makeFrameworkPack(
  id: string,
  language: string,
  technology: string,
): FrameworkPack {
  return {
    id,
    when: { language, technology },
    adapt: () => [],
  };
}

function buildApp() {
  // Require inside the helper so mocks are in place before the route wires
  // up its imports. Matches the pattern used by `runsRouteTierGate.test.ts`.
  const { packsRouter } = require('../routes/packs');
  const app = express();
  app.use(express.json());
  app.use('/discovery/packs', packsRouter);
  return app;
}

// Exact copy strings (duplicated here intentionally — we want the test to
// fail loudly if someone paraphrases the warning copy, even by a character).
const TIER_B_WARNING =
  "Discovery will run in language-only mode. No framework-specific adapter matches your service's tech stack. Candidate quality depends on LLM gap-fill.";
const TIER_C_WARNING =
  'Discovery will run in LLM-only mode. No language or framework pack matches. Pass confirmLlmSolo: true to proceed.';

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('GET /discovery/packs/applicable — V3 tier fields (Task Group 5)', () => {
  beforeEach(() => {
    clearRegistry();
  });

  // -------------------------------------------------------------------------
  // 1. Tier A — language AND framework pack match.
  // -------------------------------------------------------------------------
  test('Java + Spring Boot preflights as tier=A, mode=pack-supervised, warnings=[]', async () => {
    registerLanguagePack(makeLanguagePack('java-lang', 'Java'));
    registerFrameworkPack(makeFrameworkPack('spring-boot', 'Java', 'Spring Boot'));

    const app = buildApp();
    const res = await supertest(app)
      .get('/discovery/packs/applicable')
      .query({ coreTech: 'Java, Spring Boot' });

    expect(res.status).toBe(200);
    expect(res.body.tier).toBe('A');
    expect(res.body.mode).toBe('pack-supervised');
    expect(res.body.warnings).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // 2. Tier B — only a language pack matches (Java present but Spring Boot
  //    framework pack is NOT registered, and the coreTech string has only a
  //    language token).
  // -------------------------------------------------------------------------
  test('Java-only (no framework pack) preflights as tier=B, mode=language-only, warnings=[B copy]', async () => {
    // Only the Java language pack is registered — findFrameworkPacks returns
    // []. computeTier -> 'B'.
    registerLanguagePack(makeLanguagePack('java-lang', 'Java'));

    const app = buildApp();
    const res = await supertest(app)
      .get('/discovery/packs/applicable')
      .query({ coreTech: 'Java' });

    expect(res.status).toBe(200);
    expect(res.body.tier).toBe('B');
    expect(res.body.mode).toBe('language-only');
    expect(res.body.warnings).toEqual([TIER_B_WARNING]);
  });

  // -------------------------------------------------------------------------
  // 3. Tier C — neither a language nor framework pack matches (Kotlin has no
  //    language pack registered in this test fixture).
  // -------------------------------------------------------------------------
  test('unsupported language (Kotlin) preflights as tier=C, mode=llm-solo, warnings=[C copy]', async () => {
    // No packs registered at all -> guaranteed tier C.
    const app = buildApp();
    const res = await supertest(app)
      .get('/discovery/packs/applicable')
      .query({ coreTech: 'Kotlin' });

    expect(res.status).toBe(200);
    expect(res.body.tier).toBe('C');
    expect(res.body.mode).toBe('llm-solo');
    expect(res.body.warnings).toEqual([TIER_C_WARNING]);
  });

  // -------------------------------------------------------------------------
  // 4. Existing fields (coreTech, techHints, applicable, notApplicable) stay
  //    present alongside the new fields — additive contract.
  // -------------------------------------------------------------------------
  test('existing response fields (coreTech, techHints, applicable, notApplicable) are preserved', async () => {
    registerLanguagePack(makeLanguagePack('java-lang', 'Java'));
    registerFrameworkPack(makeFrameworkPack('spring-boot', 'Java', 'Spring Boot'));
    // Register an extra pack that will NOT match so notApplicable is non-empty.
    registerLanguagePack(makeLanguagePack('python-lang', 'Python'));

    const app = buildApp();
    const res = await supertest(app)
      .get('/discovery/packs/applicable')
      .query({ coreTech: 'Java, Spring Boot' });

    expect(res.status).toBe(200);

    // Legacy fields still present
    expect(res.body.coreTech).toBe('Java, Spring Boot');
    expect(res.body.techHints).toBeDefined();
    expect(Array.isArray(res.body.applicable)).toBe(true);
    expect(Array.isArray(res.body.notApplicable)).toBe(true);

    // Applicable contains the Java language + Spring Boot framework pack.
    const applicableIds = res.body.applicable.map((p: { id: string }) => p.id).sort();
    expect(applicableIds).toEqual(['java-lang', 'spring-boot']);

    // Python language pack goes to notApplicable.
    const notApplicableIds = res.body.notApplicable.map((p: { id: string }) => p.id);
    expect(notApplicableIds).toContain('python-lang');

    // Additive fields also present.
    expect(res.body.tier).toBe('A');
    expect(res.body.mode).toBe('pack-supervised');
    expect(res.body.warnings).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // 5. Missing coreTech query param still returns 400 unchanged.
  // -------------------------------------------------------------------------
  test('missing coreTech query param still returns 400 (unchanged behaviour)', async () => {
    const app = buildApp();
    const res = await supertest(app).get('/discovery/packs/applicable');

    expect(res.status).toBe(400);
    // New tier fields must NOT leak onto the error payload.
    expect(res.body.tier).toBeUndefined();
    expect(res.body.mode).toBeUndefined();
    expect(res.body.warnings).toBeUndefined();
  });
});
