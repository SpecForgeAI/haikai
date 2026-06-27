/**
 * conversationalTargetDeps — pure sourcing/merge tests (Spec C, Task Group 5).
 *
 * Spec: 2026-06-27-live-vuln-reduction-recompute-osv-bridge-logging.
 *
 * Covers the load-bearing pure behaviour:
 *   (1) a captured versioned answer resolves through the inverse-map mirror to a
 *       concrete `{ coordinate, version, ecosystem }` and feeds the target set;
 *   (2) the manifest concrete version WINS over a captured one on coordinate
 *       overlap;
 *   (5) an unmapped captured code is silently skipped (count-only), and a
 *       `version-unknown` sentinel rides through unchanged.
 */

import { describe, it, expect } from 'vitest';
import type { CapturedDecisionRow } from '../../../../api/architectConversationApi';
import { buildFrameworkVersionCaptureValue } from '../versionControlConfig';
import {
  deriveConversationalTargetDeps,
  mergeTargetDeps,
} from '../conversationalTargetDeps';
import type { TargetResolvedDependency } from '../useVulnerabilityReduction';

function row(
  decisionCode: string,
  answerValue: string,
  over: Partial<CapturedDecisionRow> = {},
): CapturedDecisionRow {
  return {
    decisionId: `d-${decisionCode}`,
    decisionCode,
    scopeKind: 'architecture',
    scopeRefType: null,
    scopeRefId: null,
    answerValue,
    answerSummary: null,
    standardsLookupRef: null,
    supersededById: null,
    ...over,
  };
}

function versioned(decisionCode: string, framework: string, version: string) {
  return row(decisionCode, buildFrameworkVersionCaptureValue({ framework, version }));
}

describe('deriveConversationalTargetDeps (Spec C)', () => {
  it('(1) maps a captured versioned answer to a concrete coordinate + ecosystem', () => {
    const { deps, skippedUnmappedCount } = deriveConversationalTargetDeps([
      versioned('service.framework', 'Spring Boot', '4.0'),
      versioned('ui.framework', 'React', '18.3.1'),
    ]);
    expect(skippedUnmappedCount).toBe(0);
    const byName = new Map(deps.map((d) => [d.name, d]));
    expect(byName.get('org.springframework.boot:spring-boot')).toEqual({
      name: 'org.springframework.boot:spring-boot',
      resolvedVersion: '4.0',
      versionUnknown: false,
      ecosystem: 'MAVEN',
    });
    expect(byName.get('react')).toEqual({
      name: 'react',
      resolvedVersion: '18.3.1',
      versionUnknown: false,
      ecosystem: 'NPM',
    });
  });

  it('(5) silently skips an unmapped captured code (count-only) and non-versioned rows', () => {
    const { deps, skippedUnmappedCount } = deriveConversationalTargetDeps([
      // build.tool IS versioned but has NO useful single OSV coordinate -> unmapped.
      versioned('build.tool', 'Maven', '3.9'),
      // service.framework with an unknown framework label -> unmapped.
      versioned('service.framework', 'TotallyMadeUp', '1.0'),
      // a plain (non-versioned) single-choice row -> ignored, not counted.
      row('api.surfaceMode', 'like_for_like'),
    ]);
    expect(deps).toEqual([]);
    expect(skippedUnmappedCount).toBe(2);
  });

  it('(5b) a version-unknown sentinel rides through unchanged (never guessed)', () => {
    const { deps } = deriveConversationalTargetDeps([
      versioned('db.driver', 'pgjdbc', 'version-unknown'),
    ]);
    expect(deps).toEqual([
      {
        name: 'org.postgresql:postgresql',
        resolvedVersion: 'version-unknown',
        versionUnknown: true,
        ecosystem: 'MAVEN',
      },
    ]);
  });
});

describe('mergeTargetDeps (Spec C — manifest wins on overlap)', () => {
  it('(2) the manifest concrete version WINS over a captured one on coordinate overlap', () => {
    const conversational: TargetResolvedDependency[] = [
      {
        name: 'org.springframework.boot:spring-boot',
        resolvedVersion: '4.0',
        versionUnknown: false,
        ecosystem: 'MAVEN',
      },
      { name: 'react', resolvedVersion: '18.3.1', ecosystem: 'NPM' },
    ];
    const manifest: TargetResolvedDependency[] = [
      // Overlaps the captured Spring Boot — the manifest's concrete 3.5.1 wins.
      {
        name: 'org.springframework.boot:spring-boot',
        resolvedVersion: '3.5.1',
        ecosystem: 'MAVEN',
      },
    ];
    const merged = mergeTargetDeps(conversational, manifest);
    const byName = new Map(merged.map((d) => [d.name, d]));
    expect(byName.get('org.springframework.boot:spring-boot')?.resolvedVersion).toBe('3.5.1');
    // The captured-only coordinate (no manifest overlap) survives.
    expect(byName.get('react')?.resolvedVersion).toBe('18.3.1');
    expect(merged).toHaveLength(2);
  });
});
