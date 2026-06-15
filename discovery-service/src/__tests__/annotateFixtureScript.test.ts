/**
 * Focused tests for the V3 evaluation harness Task Group 5:
 * `scripts/annotate-fixture.ts` — fixture scaffolding CLI.
 *
 * Spec: `agent-os/specs/2026-04-19-v3-evaluation-harness` (Task Group 5.1).
 *
 * Scope of this file:
 *   1. Happy path: annotating a tiny Java source file for `spring-classic`
 *      creates a fixture dir, copies the source, writes `expected.json`
 *      with pack-tagged candidates, and writes a stub `README.md`.
 *   2. The written `expected.json` round-trips through the Group 1
 *      `parseExpectedJson` validator (schema-valid).
 *   3. `--framework django` warns that the framework is not yet V3-migrated
 *      and produces an `expected.json` with an empty `expected` array.
 *   4. The annotate tool refuses to overwrite an existing fixture directory
 *      unless `force: true` is passed.
 *   5. Every pre-tagged entry uses `'pack'` (no auto-detection of gap-fill
 *      or either).
 *
 * Out of scope:
 *   - CLI argv parsing correctness beyond the exported `annotateFixture`
 *     function (the arg-parser is a thin wrapper and is exercised by
 *     integration use once fixtures land in Group 6).
 *   - Exhaustive filesystem edge cases.
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import * as os from 'os';

import { annotateFixture } from '../../scripts/annotate-fixture';
import { parseExpectedJson } from '../evaluation/fixtureLoader';

// ---------------------------------------------------------------------------
// Temp-dir harness.
// ---------------------------------------------------------------------------

let tmpRoot: string;
let fixturesRoot: string;
let sourceFilePath: string;

// Tiny Spring `@Controller` source — intentionally minimal but structurally
// sufficient for `javaLangPack.extract` + `springClassicFrameworkPack.adapt`
// to produce at least one interface candidate.
const TINY_CONTROLLER_JAVA = `
package com.example.sample;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

@Controller
public class PatientController {
  @GetMapping("/patients")
  public String list() {
    return "patients";
  }
}
`.trim();

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'annotate-fixture-'));
  fixturesRoot = path.join(tmpRoot, 'fixtures');
  await fs.mkdir(fixturesRoot, { recursive: true });

  // Drop a Java source file on disk — the annotate tool copies it into the
  // fixture dir (preserving the original filename / extension).
  const sourceDir = path.join(tmpRoot, 'upstream');
  await fs.mkdir(sourceDir, { recursive: true });
  sourceFilePath = path.join(sourceDir, 'PatientController.java');
  await fs.writeFile(sourceFilePath, TINY_CONTROLLER_JAVA, 'utf-8');
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests.
// ---------------------------------------------------------------------------

describe('annotate-fixture script — Task Group 5', () => {
  // Test 1: happy path.
  test('spring-classic: scaffolds fixture dir, copies source, writes expected.json + README', async () => {
    const result = await annotateFixture({
      framework: 'spring-classic',
      caseId: 'patient-controller',
      sourcePath: sourceFilePath,
      sourceRepo: 'https://github.com/example/openmrs-core',
      sourceCommit: 'abc1234',
      license: 'MPL-2.0',
      fixturesRoot,
    });

    const fixtureDir = path.join(fixturesRoot, 'spring-classic', 'patient-controller');
    expect(fsSync.existsSync(fixtureDir)).toBe(true);

    // Source copied as <caseId>.<originalExt> so the fixtureLoader can
    // find it unambiguously inside <caseId>/. The upstream original filename
    // (PatientController.java) is recorded in README for provenance.
    const copiedSource = path.join(fixtureDir, 'patient-controller.java');
    expect(fsSync.existsSync(copiedSource)).toBe(true);
    const copiedContents = await fs.readFile(copiedSource, 'utf-8');
    expect(copiedContents).toBe(TINY_CONTROLLER_JAVA);

    // expected.json exists and has content.
    const expectedJsonPath = path.join(
      fixtureDir,
      'patient-controller.expected.json',
    );
    expect(fsSync.existsSync(expectedJsonPath)).toBe(true);
    const rawExpected = await fs.readFile(expectedJsonPath, 'utf-8');
    const parsed = JSON.parse(rawExpected);

    // shouldNotEmit initialized as empty array.
    expect(parsed.shouldNotEmit).toEqual([]);

    // At least one candidate was produced (the @Controller should be picked
    // up by springClassicFrameworkPack as an interface).
    expect(Array.isArray(parsed.expected)).toBe(true);
    expect(parsed.expected.length).toBeGreaterThan(0);
    expect(result.candidateCount).toBe(parsed.expected.length);

    // README contains the source-metadata placeholders.
    const readmePath = path.join(fixtureDir, 'README.md');
    expect(fsSync.existsSync(readmePath)).toBe(true);
    const readme = await fs.readFile(readmePath, 'utf-8');
    expect(readme).toMatch(/patient-controller/);
    expect(readme).toMatch(/https:\/\/github\.com\/example\/openmrs-core/);
    expect(readme).toMatch(/abc1234/);
    expect(readme).toMatch(/MPL-2\.0/);
    // Original path should appear so the human reviewer knows the upstream file location.
    expect(readme).toMatch(/PatientController\.java/);
    // TODO placeholder for "why this fixture" rationale.
    expect(readme).toMatch(/TODO/);
  });

  // Test 2: the written expected.json round-trips the Group 1 validator.
  test('written expected.json is schema-valid per Group 1 parseExpectedJson', async () => {
    await annotateFixture({
      framework: 'spring-classic',
      caseId: 'patient-controller',
      sourcePath: sourceFilePath,
      sourceRepo: 'https://github.com/example/openmrs-core',
      sourceCommit: 'abc1234',
      license: 'MPL-2.0',
      fixturesRoot,
    });

    const expectedJsonPath = path.join(
      fixturesRoot,
      'spring-classic',
      'patient-controller',
      'patient-controller.expected.json',
    );
    const raw = await fs.readFile(expectedJsonPath, 'utf-8');

    // Must not throw — Group 1's validator is the authoritative schema check.
    const parsed = parseExpectedJson(raw, expectedJsonPath);
    expect(parsed.shouldNotEmit).toEqual([]);

    // Every entry is pre-tagged `'pack'` (spec Q14: no auto-detection of
    // gap-fill / either tiers).
    for (const entry of parsed.expected) {
      expect(entry.tag).toBe('pack');
      expect(entry.type).toBeTruthy();
      expect(entry.name).toBeTruthy();
    }
  });

  // Test 3: django is now V3-migrated (django got a framework pack in the V3
  // Pack Migration Batch), so the tool runs the real Python lang-pack +
  // djangoFrameworkPack pipeline rather than scaffolding an empty fixture with
  // a "not yet V3-migrated" warning. A bare `class Product: pass` has no Django
  // model fields/base, so the pack pipeline legitimately yields zero candidates.
  test('django: runs the V3 pack pipeline (no not-migrated warning) and yields no candidates for a bare class', async () => {
    const djangoSource = path.join(tmpRoot, 'upstream', 'models.py');
    await fs.writeFile(djangoSource, 'class Product: pass\n', 'utf-8');

    const warnings: string[] = [];
    const result = await annotateFixture({
      framework: 'django',
      caseId: 'product-model',
      sourcePath: djangoSource,
      sourceRepo: 'https://github.com/saleor/saleor',
      sourceCommit: 'def5678',
      license: 'BSD-3-Clause',
      fixturesRoot,
      warn: (msg) => warnings.push(msg),
    });

    // django is migrated now: NO "not yet V3-migrated" warning is emitted.
    expect(warnings.some((w) => /django/i.test(w) && /V3/i.test(w))).toBe(false);
    expect(result.candidateCount).toBe(0);

    const expectedJsonPath = path.join(
      fixturesRoot,
      'django',
      'product-model',
      'product-model.expected.json',
    );
    const parsed = JSON.parse(await fs.readFile(expectedJsonPath, 'utf-8'));
    expect(parsed.expected).toEqual([]);
    expect(parsed.shouldNotEmit).toEqual([]);
  });

  // Test 4: refuses to overwrite without --force.
  test('refuses to overwrite an existing fixture directory unless force=true', async () => {
    // First run to create the fixture dir.
    await annotateFixture({
      framework: 'spring-classic',
      caseId: 'patient-controller',
      sourcePath: sourceFilePath,
      sourceRepo: 'https://github.com/example/openmrs-core',
      sourceCommit: 'abc1234',
      license: 'MPL-2.0',
      fixturesRoot,
    });

    // Second run without force must throw.
    await expect(
      annotateFixture({
        framework: 'spring-classic',
        caseId: 'patient-controller',
        sourcePath: sourceFilePath,
        sourceRepo: 'https://github.com/example/openmrs-core',
        sourceCommit: 'abc1234',
        license: 'MPL-2.0',
        fixturesRoot,
      }),
    ).rejects.toThrow(/already exists/i);

    // With force=true, the call proceeds and overwrites.
    await expect(
      annotateFixture({
        framework: 'spring-classic',
        caseId: 'patient-controller',
        sourcePath: sourceFilePath,
        sourceRepo: 'https://github.com/example/openmrs-core',
        sourceCommit: 'abc1234',
        license: 'MPL-2.0',
        fixturesRoot,
        force: true,
      }),
    ).resolves.toBeDefined();
  });

  // Test 5: all entries pre-tagged `'pack'`; no auto-detected gap-fill / either.
  test('every pre-tagged entry uses pack (no auto-detection)', async () => {
    await annotateFixture({
      framework: 'spring-classic',
      caseId: 'patient-controller',
      sourcePath: sourceFilePath,
      sourceRepo: 'https://github.com/example/openmrs-core',
      sourceCommit: 'abc1234',
      license: 'MPL-2.0',
      fixturesRoot,
    });

    const expectedJsonPath = path.join(
      fixturesRoot,
      'spring-classic',
      'patient-controller',
      'patient-controller.expected.json',
    );
    const parsed = JSON.parse(await fs.readFile(expectedJsonPath, 'utf-8'));
    expect(parsed.expected.length).toBeGreaterThan(0);
    const tags = new Set<string>(parsed.expected.map((e: { tag: string }) => e.tag));
    expect(Array.from(tags)).toEqual(['pack']);
  });
});
