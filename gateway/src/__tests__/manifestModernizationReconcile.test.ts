/**
 * Modernization-decision ↔ pom reconciliation (2026-08-30).
 *
 * The modernize.* namespace previously never reached the manifest reconciler
 * — confirmed modernization decisions could demand a library the
 * authoritative seed pom lacked while the pom declared a COMPETING library
 * the decisions had rejected, and nothing said a word. Pins:
 *
 *   1. capability conflict: substitute present + required absent -> LOUD
 *      conflict, NEVER "add the required jar alongside";
 *   2. attribution: every demanding decision code is cited;
 *   3. additions propose the coordinate when truly absent, de-duped across
 *      rules (specific cache rule + general rule -> one addition);
 *   4. a decision migrating AWAY from a library never resurrects it (the
 *      source side of `->` and the JSON envelope's `from` are ignored);
 *   5. drop/replace clauses inside the target text do not demand their
 *      tokens;
 *   6. both namespaces feed ONE pipeline (reconcileManifestWithAllDecisions);
 *   7. autoApplyDecisionAdditions surfaces capabilityConflicts distinctly and
 *      never persists when nothing is addable.
 */

import {
  MODERNIZE_COORDINATE_RULES,
  modernizationTargetText,
  reconcileManifestWithAllDecisions,
  reconcileManifestWithModernizationDecisions,
} from '../services/targetManifest/manifestDecisionReconcile';
import { autoApplyDecisionAdditions } from '../services/targetManifest/manifestDecisionAutoApply';
import { TargetStateCapturedDecision } from '../services/targetStateCapturedDecisionsClient';

jest.mock('../services/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function pom(deps: Array<{ g: string; a: string; v?: string }>): string {
  const blocks = deps
    .map(
      (d) =>
        `    <dependency>\n      <groupId>${d.g}</groupId>\n      <artifactId>${d.a}</artifactId>\n` +
        (d.v ? `      <version>${d.v}</version>\n` : '') +
        '    </dependency>',
    )
    .join('\n');
  return `<project>\n  <dependencies>\n${blocks}\n  </dependencies>\n</project>\n`;
}

/** The confirm-write JSON envelope shape modernize.* answer_value carries. */
function envelope(from: string, to: string): string {
  return JSON.stringify({
    from,
    to,
    family: 'types',
    provenance: 'ruleset_default',
    usage_count: 3,
    example_cites: [],
  });
}

function decision(
  code: string,
  answerValue: string,
  overrides: Partial<TargetStateCapturedDecision> = {},
): TargetStateCapturedDecision {
  return {
    decisionId: `d-${code}`,
    projectId: 'p1',
    targetArchitectureId: 'target-1',
    decisionCode: code,
    scopeKind: 'architecture',
    answerValue,
    createdAt: '2026-08-30T00:00:00Z',
    createdByTask: 'scl-modernization-review',
    ...overrides,
  };
}

const KEEP_CACHE = {
  code: 'modernize.caching.loadingcache',
  value: envelope(
    'com.example.legacy.CacheShim',
    'keep dependency (com.google.common.cache.LoadingCache)',
  ),
};

// ---------------------------------------------------------------------------
// modernizationTargetText
// ---------------------------------------------------------------------------

describe('modernizationTargetText', () => {
  it('unwraps the JSON envelope to the `to` member alone', () => {
    expect(
      modernizationTargetText(envelope('org.joda.time.LocalDate', 'java.time.LocalDate')),
    ).toBe('java.time.LocalDate');
  });

  it('takes the RHS of the LAST -> (everything left is the SOURCE type)', () => {
    expect(
      modernizationTargetText(
        'LegacyMap -> com.google.common.collect.Multimap (drop legacy-collections 3.x)',
      ),
    ).toBe('com.google.common.collect.Multimap (drop legacy-collections 3.x)');
  });

  it('returns a plain target string verbatim', () => {
    expect(modernizationTargetText('java.time.LocalDate')).toBe('java.time.LocalDate');
  });
});

// ---------------------------------------------------------------------------
// reconcileManifestWithModernizationDecisions
// ---------------------------------------------------------------------------

describe('reconcileManifestWithModernizationDecisions', () => {
  it('substitute present + required absent -> ONE capability conflict, ZERO additions', () => {
    const content = pom([
      { g: 'com.github.ben-manes.caffeine', a: 'caffeine', v: '3.1.8' },
    ]);
    const { additions, conflicts } = reconcileManifestWithModernizationDecisions(content, [
      KEEP_CACHE,
    ]);

    // Never "add the required library alongside" the competing one.
    expect(additions).toEqual([]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      kind: 'capability',
      coordinate: 'com.google.guava:guava',
      substituteCoordinate: 'com.github.ben-manes.caffeine:caffeine',
      pomVersion: '3.1.8',
      decisionCode: 'modernize.caching.loadingcache',
    });
    expect(conflicts[0].message).toContain('the same capability from a DIFFERENT library');
    expect(conflicts[0].message).toContain('NEVER changed automatically');
    expect(conflicts[0].message).toContain('ships BOTH libraries');
  });

  it('cites EVERY demanding decision on the conflict', () => {
    const content = pom([{ g: 'com.github.ben-manes.caffeine', a: 'caffeine', v: '3.1.8' }]);
    const demands = ['a', 'b', 'c', 'd'].map((s) => ({
      code: `modernize.caching.${s}`,
      value: envelope(`com.example.legacy.Shim${s}`, `keep (com.google.common.cache.Cache${s})`),
    }));
    const { conflicts } = reconcileManifestWithModernizationDecisions(content, demands);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].decisionValue).toBe(
      'modernize.caching.a, modernize.caching.b, modernize.caching.c, modernize.caching.d',
    );
    expect(conflicts[0].message).toContain('4 decisions (e.g. [decision:modernize.caching.a])');
  });

  it('proposes the coordinate when truly absent, de-duped across specific + general rules', () => {
    const content = pom([]);
    const { additions, conflicts } = reconcileManifestWithModernizationDecisions(content, [
      KEEP_CACHE, // cache rule (specific)
      {
        code: 'modernize.types.multimap',
        value: 'LegacyMap -> com.google.common.collect.Multimap (drop legacy-collections 3.x)',
      }, // general rule — same coordinate
    ]);

    expect(conflicts).toEqual([]);
    expect(additions).toHaveLength(1);
    expect(additions[0]).toMatchObject({
      groupId: 'com.google.guava',
      artifactId: 'guava',
      version: null,
    });
    expect(additions[0].note).toContain('[decision:modernize.caching.loadingcache]');
  });

  it('a decision migrating AWAY from a library never resurrects it', () => {
    const content = pom([]);
    const { additions } = reconcileManifestWithModernizationDecisions(content, [
      {
        code: 'modernize.dates.localdate',
        value: envelope('org.joda.time.LocalDate', 'java.time.LocalDate'),
      },
      {
        code: 'modernize.dates.datetime',
        value: 'org.joda.time.DateTime -> java.time.OffsetDateTime',
      },
    ]);
    expect(additions).toEqual([]);
  });

  it('a KEPT target type proposes its library; satisfied poms propose nothing', () => {
    const keepJoda = {
      code: 'modernize.dates.keep',
      value: envelope('com.example.legacy.Dates', 'keep dependency (org.joda.time.LocalDate)'),
    };
    const absent = reconcileManifestWithModernizationDecisions(pom([]), [keepJoda]);
    expect(absent.additions).toHaveLength(1);
    expect(absent.additions[0]).toMatchObject({ groupId: 'joda-time', artifactId: 'joda-time' });

    const present = reconcileManifestWithModernizationDecisions(
      pom([{ g: 'joda-time', a: 'joda-time', v: '2.12.7' }]),
      [keepJoda],
    );
    expect(present.additions).toEqual([]);
    expect(present.conflicts).toEqual([]);
  });

  it('tokens inside a drop/replace clause demand nothing', () => {
    const { additions } = reconcileManifestWithModernizationDecisions(pom([]), [
      {
        code: 'modernize.dates.keep',
        value:
          'keep org.joda.time.LocalDate (drop the com.google.common.cache.LoadingCache shim)',
      },
    ]);
    expect(additions).toHaveLength(1);
    expect(additions[0].artifactId).toBe('joda-time');
    // The cache token only appeared in the drop clause — no guava demand.
    expect(additions.some((a) => a.artifactId === 'guava')).toBe(false);
  });

  it('rules are ordered specific -> general (cache prefix before the umbrella prefix)', () => {
    const cacheIdx = MODERNIZE_COORDINATE_RULES.findIndex(
      (r) => r.packagePrefix === 'com.google.common.cache.',
    );
    const generalIdx = MODERNIZE_COORDINATE_RULES.findIndex(
      (r) => r.packagePrefix === 'com.google.common.',
    );
    expect(cacheIdx).toBeGreaterThanOrEqual(0);
    expect(generalIdx).toBeGreaterThan(cacheIdx);
  });
});

// ---------------------------------------------------------------------------
// One pipeline for both namespaces
// ---------------------------------------------------------------------------

describe('reconcileManifestWithAllDecisions', () => {
  it('merges target-state and modernize.* additions/conflicts into one result', () => {
    const content = pom([{ g: 'com.github.ben-manes.caffeine', a: 'caffeine', v: '3.1.8' }]);
    const decisions = [
      // Target-state namespace (unscoped): db.migrations Liquibase -> addition.
      decision('db.migrations', 'Liquibase 4', { createdByTask: 'conversation' }),
      // Modernize namespace: cache keep -> capability conflict.
      decision(KEEP_CACHE.code, KEEP_CACHE.value, { scopeRefId: 'el-1', scopeKind: 'element' }),
    ];
    const { additions, conflicts } = reconcileManifestWithAllDecisions(content, decisions);

    expect(additions.some((a) => a.artifactId === 'liquibase-core')).toBe(true);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].kind).toBe('capability');
  });
});

// ---------------------------------------------------------------------------
// Auto-apply integration
// ---------------------------------------------------------------------------

describe('autoApplyDecisionAdditions — modernization pass', () => {
  const artifact = (content: string) => ({
    tag: 'service-a',
    kind: 'maven',
    ecosystem: 'MAVEN',
    manifest_path: 'pom.xml',
    content,
    package_lock_content: null,
    resolved_dependencies: [],
    target_service_element_id: null,
    tier2_facts: [],
  });

  it('capability conflict -> noop with capabilityConflicts surfaced, nothing persisted', async () => {
    const persist = jest.fn();
    const result = await autoApplyDecisionAdditions('p1', 'target-1', {
      fetchArtifacts: jest
        .fn()
        .mockResolvedValue([
          artifact(pom([{ g: 'com.github.ben-manes.caffeine', a: 'caffeine', v: '3.1.8' }])),
        ]) as never,
      fetchDecisions: jest
        .fn()
        .mockResolvedValue([
          decision(KEEP_CACHE.code, KEEP_CACHE.value, { scopeRefId: 'el-1' }),
        ]) as never,
      persistArtifacts: persist as never,
    });

    expect(result.status).toBe('noop');
    expect(result.conflicts).toBe(1);
    expect(result.capabilityConflicts).toBe(1);
    expect(persist).not.toHaveBeenCalled();
  });

  it('a KEPT modernize.* target with no substitute installed is APPLIED as an addition', async () => {
    const persist = jest.fn().mockResolvedValue(undefined);
    const result = await autoApplyDecisionAdditions('p1', 'target-1', {
      fetchArtifacts: jest.fn().mockResolvedValue([artifact(pom([]))]) as never,
      fetchDecisions: jest
        .fn()
        .mockResolvedValue([
          decision(
            'modernize.dates.keep',
            envelope('com.example.legacy.Dates', 'keep dependency (org.joda.time.LocalDate)'),
            { scopeRefId: 'el-1' },
          ),
        ]) as never,
      persistArtifacts: persist as never,
    });

    expect(result.status).toBe('applied');
    expect(result.applied).toEqual(['joda-time:joda-time']);
    expect(result.capabilityConflicts).toBe(0);
    expect(persist).toHaveBeenCalledTimes(1);
    const persisted = persist.mock.calls[0][2][0];
    expect(persisted.content).toContain('<artifactId>joda-time</artifactId>');
  });
});
