/**
 * Tests — Structured `{ framework, version }` capture
 * Spec 2026-06-24-target-conversation-tech-stack-constraints, Task Group 5
 * (FR5 capture half + FR8 contract — gateway side).
 *
 * Per tasks.md §5.1 (gateway half) — focused tests covering:
 *   - The captured row for a versioned question uses the EXISTING envelope
 *     `answerValue = JSON.stringify({ value: { framework, version }, sourceQuote,
 *     sourceFile })` and `answerSummary` = the resolved chip label.
 *   - The `structured` answer parser accepts a `{ framework, version }` object
 *     for a versioned code and REJECTS a malformed payload (missing framework or
 *     version); a non-versioned `structured` code keeps generic acceptance.
 *   - The `version-unknown` Spec 3 sentinel resolves to an honest chip label and
 *     stays a valid value (so manifest auto-answer degrades gracefully).
 *
 * Pure-validation module under test — no I/O, no LLM, no mocks needed.
 */

import { parseStructuredAnswer } from '../structuredAnswerParser';
import {
  buildFrameworkVersionEnvelope,
  parseFrameworkVersion,
  resolveCapturedAnswerSummary,
  resolveFrameworkVersionChip,
  isVersionSentinel,
  VERSION_UNKNOWN,
  VERSION_SENTINELS,
} from '../../../config/architect-conversation/frameworkVersionShape';

// A minimal versioned `structured` entry stand-in (the parser only reads
// `expectedAnswerShape` / `choices` / `code` / `versioned`).
const VERSIONED_ENTRY = {
  code: 'service.framework',
  expectedAnswerShape: 'structured' as const,
  choices: undefined,
  versioned: true,
};

const NON_VERSIONED_STRUCTURED_ENTRY = {
  code: 'adhoc.example',
  expectedAnswerShape: 'structured' as const,
  choices: undefined,
  versioned: false,
};

describe('framework/version capture envelope (TG5)', () => {
  it('writes the value through the existing {value, sourceQuote, sourceFile} envelope with a single resolved chip', () => {
    const env = buildFrameworkVersionEnvelope({
      value: { framework: 'Spring Boot 3.4', version: '3.4.1' },
    });

    // answerValue is byte-for-byte the existing envelope shape with the
    // {framework, version} value riding the `value` slot.
    expect(JSON.parse(env.answerValue)).toEqual({
      value: { framework: 'Spring Boot 3.4', version: '3.4.1' },
      sourceQuote: null,
      sourceFile: null,
    });
    // answerSummary is the ONE resolved chip label — never a cartesian product,
    // and never a doubled "Spring Boot 3.4 3.4.1": the baked stem version is
    // stripped before the dedicated version is appended (2026-06-27 fix).
    expect(env.answerSummary).toBe('Spring Boot 3.4.1');
  });

  it('threads Spec 3 manifest provenance (sourceQuote / sourceFile) into the same envelope', () => {
    const env = buildFrameworkVersionEnvelope({
      value: { framework: 'Quarkus 3', version: '3.15.1' },
      sourceQuote: '<quarkus.platform.version>3.15.1</quarkus.platform.version>',
      sourceFile: 'pom.xml',
    });
    const parsed = JSON.parse(env.answerValue);
    expect(parsed.value).toEqual({ framework: 'Quarkus 3', version: '3.15.1' });
    expect(parsed.sourceFile).toBe('pom.xml');
    expect(parsed.sourceQuote).toContain('3.15.1');
  });

  it('resolves the version-unknown sentinel to an honest chip and keeps it a valid value', () => {
    expect(isVersionSentinel(VERSION_UNKNOWN)).toBe(true);
    expect(VERSION_SENTINELS).toContain('version-unknown');
    // A concrete version is NOT a sentinel.
    expect(isVersionSentinel('3.4.1')).toBe(false);

    const chip = resolveFrameworkVersionChip({
      framework: 'Spring Boot 3.4',
      version: VERSION_UNKNOWN,
    });
    // The baked stem version is stripped; the honest sentinel chip remains.
    expect(chip).toBe('Spring Boot (version unknown)');

    // The sentinel value still validates (manifest auto-answer degrades, no guess).
    const env = buildFrameworkVersionEnvelope({
      value: { framework: 'Spring Boot 3.4', version: VERSION_UNKNOWN },
    });
    expect(JSON.parse(env.answerValue).value.version).toBe('version-unknown');
  });
});

describe('resolveFrameworkVersionChip — baked-version strip (no doubling)', () => {
  it('strips a trailing baked version so a version-laden stem never doubles', () => {
    // The reported "JUnit 5 5" bug: stem already carries the version.
    expect(resolveFrameworkVersionChip({ framework: 'JUnit 5', version: '5' })).toBe('JUnit 5');
    expect(resolveFrameworkVersionChip({ framework: 'Kubernetes 1.30', version: '1.30' })).toBe(
      'Kubernetes 1.30',
    );
    // The dedicated version field WINS over a baked stem version.
    expect(resolveFrameworkVersionChip({ framework: 'Spring Boot 3.4', version: '4.0' })).toBe(
      'Spring Boot 4.0',
    );
  });

  it('leaves a clean bare stem and non-digit trailing tokens unchanged', () => {
    expect(resolveFrameworkVersionChip({ framework: 'JUnit', version: '5' })).toBe('JUnit 5');
    // 'v3' does not start with a digit -> not treated as a baked version.
    expect(resolveFrameworkVersionChip({ framework: 'Chakra v3', version: '3.1' })).toBe(
      'Chakra v3 3.1',
    );
  });
});

describe('resolveCapturedAnswerSummary (persisted chip fallback)', () => {
  it('resolves the chip from the JSON capture envelope (the primary /answer path)', () => {
    const envelope = JSON.stringify({
      value: { framework: 'OpenTelemetry SDK', version: '1.27' },
      sourceQuote: null,
      sourceFile: null,
    });
    expect(resolveCapturedAnswerSummary(envelope)).toBe('OpenTelemetry SDK 1.27');
  });

  it('resolves the chip from a bare { framework, version } object', () => {
    expect(
      resolveCapturedAnswerSummary({ framework: 'Micrometer', version: '1.13' }),
    ).toBe('Micrometer 1.13');
  });

  it('renders the version-unknown sentinel honestly', () => {
    const envelope = JSON.stringify({
      value: { framework: 'Postgres', version: VERSION_UNKNOWN },
      sourceQuote: null,
      sourceFile: null,
    });
    expect(resolveCapturedAnswerSummary(envelope)).toBe('Postgres (version unknown)');
  });

  it('returns null for a plain single-choice string (keeps its readable answerValue)', () => {
    expect(resolveCapturedAnswerSummary('REST/JSON')).toBeNull();
    expect(resolveCapturedAnswerSummary('Reactive')).toBeNull();
  });

  it('returns null for a non-versioned JSON envelope (e.g. a plain string value)', () => {
    const envelope = JSON.stringify({ value: 'Postgres 18', sourceQuote: 'q', sourceFile: 'f' });
    expect(resolveCapturedAnswerSummary(envelope)).toBeNull();
  });
});

describe('structured answer parser — versioned codes (TG5)', () => {
  it('accepts a well-formed { framework, version } for a versioned code', () => {
    const result = parseStructuredAnswer(
      { framework: 'Spring Boot 3.4', version: '3.4.1' },
      VERSIONED_ENTRY,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        framework: 'Spring Boot 3.4',
        version: '3.4.1',
      });
    }
  });

  it('rejects a malformed payload missing version for a versioned code', () => {
    const result = parseStructuredAnswer(
      { framework: 'Spring Boot 3.4' },
      VERSIONED_ENTRY,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/version/i);
    }
  });

  it('rejects a malformed payload missing framework for a versioned code', () => {
    const result = parseStructuredAnswer({ version: '3.4.1' }, VERSIONED_ENTRY);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/framework/i);
    }
  });

  it('keeps generic plain-object acceptance for a NON-versioned structured code', () => {
    // A non-versioned structured payload is NOT forced into the framework/version
    // shape — it accepts any plain object (forward-compat path).
    const result = parseStructuredAnswer(
      { anything: 'goes', here: 1 },
      NON_VERSIONED_STRUCTURED_ENTRY,
    );
    expect(result.ok).toBe(true);
  });

  it('parseFrameworkVersion rejects non-object payloads', () => {
    expect(parseFrameworkVersion('Spring Boot 3.4.1').ok).toBe(false);
    expect(parseFrameworkVersion(['Spring Boot', '3.4.1']).ok).toBe(false);
    expect(parseFrameworkVersion(null).ok).toBe(false);
    expect(parseFrameworkVersion({ framework: 'x', version: '   ' }).ok).toBe(false);
  });
});
