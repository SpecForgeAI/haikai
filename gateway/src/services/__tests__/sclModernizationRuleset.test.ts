/**
 * SCL modernization pair ruleset (spec 5, 2026-08-18) — sanity pins:
 * unique modernize.* codes, non-empty families/from/to, and coverage of the
 * design doc's decision families for the seeded Java8+JAX-RS+Joda ->
 * Java21+Spring Boot pair.
 */

import {
  defaultModernizationRuleset,
  MODERNIZATION_RULESETS,
} from '../sclModernizationRuleset';

describe('MODERNIZATION_RULESETS — sanity', () => {
  it('seeds the java8-jaxrs-joda -> java21-springboot pair as the default', () => {
    expect(MODERNIZATION_RULESETS.length).toBeGreaterThanOrEqual(1);
    const ruleset = defaultModernizationRuleset();
    expect(ruleset.id).toBe('java8-jaxrs-joda__java21-springboot');
    expect(ruleset.sourceStack.language).toBe('java');
    expect(ruleset.sourceStack.frameworks).toEqual(expect.arrayContaining(['jaxrs', 'joda']));
    expect(ruleset.targetStack).toEqual({ language: 'java21', framework: 'spring-boot' });
  });

  it('every rule code is unique and starts with modernize.', () => {
    for (const ruleset of MODERNIZATION_RULESETS) {
      const codes = ruleset.rules.map((r) => r.code);
      expect(new Set(codes).size).toBe(codes.length);
      for (const code of codes) {
        expect(code.startsWith('modernize.')).toBe(true);
        // Convention: modernize.<family>.<slug>
        expect(code.split('.').length).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('every rule has a non-empty family / from / to, and code embeds its family', () => {
    for (const rule of defaultModernizationRuleset().rules) {
      expect(rule.family.length).toBeGreaterThan(0);
      expect(rule.from.length).toBeGreaterThan(0);
      expect(rule.to.length).toBeGreaterThan(0);
      expect(rule.code.startsWith(`modernize.${rule.family}.`)).toBe(true);
    }
  });

  it('covers the design-doc decision families', () => {
    const families = new Set(defaultModernizationRuleset().rules.map((r) => r.family));
    for (const family of [
      'collections',
      'dates',
      'http',
      'dto',
      'dataaccess',
      'serialization',
      'exceptions',
      'crosscutting',
      'concurrency',
      'caching',
      'config',
      'utility',
    ]) {
      expect(families.has(family)).toBe(true);
    }
  });

  it('seeds the specific mandated mappings', () => {
    const rules = defaultModernizationRuleset().rules;
    const byCode = new Map(rules.map((r) => [r.code, r]));

    expect(byCode.get('modernize.collections.vector')?.to).toBe('java.util.ArrayList');
    expect(byCode.get('modernize.collections.hashtable')?.to).toBe('java.util.HashMap');
    expect(byCode.get('modernize.collections.stringbuffer')?.to).toBe('java.lang.StringBuilder');
    expect(byCode.get('modernize.collections.enumeration')?.to).toBe('java.util.Iterator');
    expect(byCode.get('modernize.dates.joda-localdate')?.to).toBe('java.time.LocalDate');
    expect(byCode.get('modernize.dates.joda-datetime')?.to).toBe('java.time.ZonedDateTime');
    expect(byCode.get('modernize.dates.util-calendar')?.to).toBe('java.time.ZonedDateTime');
    expect(byCode.get('modernize.dates.xml-gregorian-calendar')?.to).toBe(
      'java.time.OffsetDateTime'
    );
    expect(byCode.get('modernize.http.jaxrs-response')?.to).toBe(
      'org.springframework.http.ResponseEntity'
    );
    expect(byCode.get('modernize.dto.pojo-record')?.to).toBe('Java record');
    expect(byCode.get('modernize.dto.pojo-record')?.notes).toContain('mutated-in-flight');
    expect(byCode.get('modernize.serialization.jaxb-jackson')?.notes).toContain('preserved');
    expect(byCode.get('modernize.config.legacy-properties')?.notes).toContain('verbatim');

    // The one JAX-RS annotation rule carries the full mapping table in notes.
    const jaxrs = byCode.get('modernize.http.jaxrs-annotations');
    expect(jaxrs?.matcher.kind).toBe('annotationPrefix');
    for (const fragment of [
      '@Path -> @RequestMapping',
      '@GET -> @GetMapping',
      '@HeaderParam -> @RequestHeader',
      '@PathParam -> @PathVariable',
      '@QueryParam -> @RequestParam',
    ]) {
      expect(jaxrs?.notes).toContain(fragment);
    }
  });
});
