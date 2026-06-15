/**
 * Task Group 1 tests for V3 Layered Prompt System.
 *
 * Spec: agent-os/specs/2026-04-19-v3-layered-prompts
 *
 * Verifies prompt layer markdown files exist and carry the minimum
 * contract content required by downstream composer/injection stages.
 */

import * as fs from 'fs';
import * as path from 'path';

const PROMPTS_ROOT = path.resolve(
  __dirname,
  '..',
  'services',
  'prompts',
);

const REQUIRED_FILES = [
  'base.md',
  'generic-language.md',
  'languages/java.md',
  'languages/typescript.md',
  'frameworks/spring-classic.md',
  'frameworks/_no-framework-with-ir.md',
  'frameworks/_no-ir.md',
];

const CANONICAL_TYPES = [
  'interfaces',
  'endpoints',
  'logical_data_entities',
  'logical_data_attributes',
  'physical_data_entities',
  'physical_data_attributes',
  'logical_data_entity_relationships',
  'interface_logical_entities',
  'business_logics',
  'ui_screens',
  'ui_components',
];

// V2-era type names that must NOT appear inside the JSON schema block of
// base.md as example/legal `type` values. They caused Bug 2 in the first
// real V3 run: the LLM dutifully returned candidates with these types and
// none were canonical.
const V2_LEGACY_TYPES_IN_SCHEMA = [
  'DomainEntity',
  'Integration',
  'Scheduler',
  'Configuration',
];

function readLayer(relPath: string): string {
  return fs.readFileSync(path.join(PROMPTS_ROOT, relPath), 'utf8');
}

describe('Prompt layer markdown files (Task Group 1)', () => {
  test('all seven required layer files exist and are non-empty', () => {
    for (const rel of REQUIRED_FILES) {
      const abs = path.join(PROMPTS_ROOT, rel);
      expect(fs.existsSync(abs)).toBe(true);
      const contents = fs.readFileSync(abs, 'utf8');
      expect(contents.trim().length).toBeGreaterThan(0);
    }
  });

  test('base.md declares the JSON output schema contract', () => {
    const base = readLayer('base.md');
    // Must reference each required field by name.
    expect(base).toMatch(/\btype\b/);
    expect(base).toMatch(/\bname\b/);
    expect(base).toMatch(/\bfilePath\b/);
    expect(base).toMatch(/\bconfidence\b/);
    // Optional description should also be documented.
    expect(base).toMatch(/\bdescription\b/);
    // Schema should be expressed as a JSON-shaped block.
    expect(base).toMatch(/\{[\s\S]*"type"[\s\S]*"name"[\s\S]*"filePath"[\s\S]*"confidence"[\s\S]*\}/);
  });

  test('base.md carries the confidence scale and the anti-restate hard rule', () => {
    const base = readLayer('base.md');
    // Confidence scale 0.0-1.0.
    expect(base).toMatch(/0\.0/);
    expect(base).toMatch(/1\.0/);
    // Anti-restate rule must be prominent.
    expect(/do not restate|never restate|not restate/i.test(base)).toBe(true);
    expect(/pack output|pack-output/i.test(base)).toBe(true);
    // The rule should be flagged as a HARD RULE (case-insensitive).
    expect(/hard rule/i.test(base)).toBe(true);
  });

  test('base.md constrains the type field to the V3 canonical enum', () => {
    const base = readLayer('base.md');

    // All eleven canonical type values must be listed verbatim.
    for (const canonical of CANONICAL_TYPES) {
      expect(base).toContain(canonical);
    }

    // The schema block must express `type` as a closed enumeration — look
    // for the "one of" phrasing with pipe separators containing the
    // canonical anchors, not a bare `string`.
    expect(base).toMatch(/one of:[^`]*interfaces[^`]*endpoints[^`]*ui_components/);

    // Isolate the schema block (the fenced code block containing the
    // JSON contract) and assert that V2-era legacy types do not appear
    // inside it as example/legal `type` values. They may still appear
    // OUTSIDE the block (e.g. the "do not invent synonyms" ban list).
    const schemaBlockMatch = base.match(/```\s*\n([\s\S]*?)\n```/);
    expect(schemaBlockMatch).not.toBeNull();
    const schemaBlock = schemaBlockMatch ? schemaBlockMatch[1] : '';
    for (const legacy of V2_LEGACY_TYPES_IN_SCHEMA) {
      expect(schemaBlock).not.toContain(legacy);
    }
  });

  test('spring-classic.md enumerates adapter catches and misses', () => {
    const spring = readLayer('frameworks/spring-classic.md');

    // Catches: stereotype annotations at the class level.
    expect(/@Controller|@RestController/i.test(spring)).toBe(true);
    expect(/@Service/i.test(spring)).toBe(true);
    expect(/@Repository/i.test(spring)).toBe(true);

    // Misses: the four canonical gap categories.
    expect(/XML bean|bean configuration|applicationContext\.xml|beans\.xml/i.test(spring)).toBe(true);
    expect(/HBM|hbm\.xml|Hibernate/i.test(spring)).toBe(true);
    expect(/AOP|Aspect|@Aspect/i.test(spring)).toBe(true);
    expect(/RestTemplate/i.test(spring)).toBe(true);
    expect(/FeignClient|@FeignClient|Feign/i.test(spring)).toBe(true);

    // Must instruct LLM to surface only misses, never duplicates.
    expect(/miss|gap/i.test(spring)).toBe(true);
    expect(/duplicate|restate|already/i.test(spring)).toBe(true);
  });

  test('tier B and tier C framework variants are present and distinct', () => {
    const tierB = readLayer('frameworks/_no-framework-with-ir.md');
    const tierC = readLayer('frameworks/_no-ir.md');
    // Tier B must mention the injected IR.
    expect(/IR|intermediate representation|classes.*methods.*imports/i.test(tierB)).toBe(true);
    // Tier C must disclaim structural info and lower confidence.
    expect(/no structural|raw source|lowered confidence|lower.*confidence/i.test(tierC)).toBe(true);
    // They must be different files with materially different content.
    expect(tierB).not.toEqual(tierC);
  });
});
