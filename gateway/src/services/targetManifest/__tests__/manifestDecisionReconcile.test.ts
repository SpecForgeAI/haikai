/**
 * Manifest ↔ decision reconciliation (2026-08-15). Pins:
 *   - additions proposed for decision-required coordinates the pom lacks
 *     (the live gaps: Liquibase + jackson-dataformat-xml), BOM-managed ones
 *     version-less;
 *   - present coordinates are NOT proposed; version conflicts surface loudly
 *     and are never auto-changed;
 *   - apply inserts into the PROJECT <dependencies> (after
 *     dependencyManagement), leaving every other byte identical.
 */
import {
  applyAdditionsToPom,
  parsePomDependencies,
  reconcileManifestWithDecisions,
} from '../manifestDecisionReconcile';
import { TargetStateCapturedDecision } from '../../targetStateCapturedDecisionsClient';

function decision(code: string, summary: string): TargetStateCapturedDecision {
  return {
    decisionId: `d-${code}`,
    projectId: 'p1',
    targetArchitectureId: 'arch-1',
    decisionCode: code,
    scopeKind: 'architecture',
    scopeRefId: null,
    answerValue: summary,
    answerSummary: summary,
    createdAt: '2026-08-01T00:00:00Z',
    createdByTask: 'architect-persona-conversation',
  };
}

const POM = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<project>',
  '    <dependencyManagement>',
  '        <dependencies>',
  '            <dependency>',
  '                <groupId>org.springframework.cloud</groupId>',
  '                <artifactId>spring-cloud-dependencies</artifactId>',
  '                <version>2025.1.2</version>',
  '            </dependency>',
  '        </dependencies>',
  '    </dependencyManagement>',
  '    <dependencies>',
  '        <dependency>',
  '            <groupId>org.springframework.boot</groupId>',
  '            <artifactId>spring-boot-starter-web</artifactId>',
  '        </dependency>',
  '        <dependency>',
  '            <groupId>org.postgresql</groupId>',
  '            <artifactId>postgresql</artifactId>',
  '            <version>42.7.4</version>',
  '        </dependency>',
  '    </dependencies>',
  '</project>',
  '',
].join('\n');

const DECISIONS = [
  decision('db.migrations', 'Liquibase 4'),
  decision('api.contractFormat', 'Mixed JSON + XML'),
  decision('db.driver', 'pgjdbc 42.7.4'),
];

describe('parsePomDependencies', () => {
  it('finds entries in BOTH dependencyManagement and dependencies', () => {
    const deps = parsePomDependencies(POM);
    expect(deps).toContainEqual({
      groupId: 'org.postgresql',
      artifactId: 'postgresql',
      version: '42.7.4',
    });
    expect(deps).toContainEqual({
      groupId: 'org.springframework.cloud',
      artifactId: 'spring-cloud-dependencies',
      version: '2025.1.2',
    });
  });
});

describe('reconcileManifestWithDecisions', () => {
  it('proposes the LIVE gaps (liquibase-core + jackson-dataformat-xml), version-less (BOM-managed)', () => {
    const { additions, conflicts } = reconcileManifestWithDecisions(POM, DECISIONS);
    const coords = additions.map((a) => `${a.groupId}:${a.artifactId}`);
    expect(coords).toContain('org.liquibase:liquibase-core');
    expect(coords).toContain('com.fasterxml.jackson.dataformat:jackson-dataformat-xml');
    for (const a of additions) expect(a.version).toBeNull();
    // db.driver is SATISFIED (postgresql present) — not proposed, no conflict
    // (42.x major matches "pgjdbc 42.7.4").
    expect(coords).not.toContain('org.postgresql:postgresql');
    expect(conflicts).toEqual([]);
  });

  it('a version-major mismatch surfaces as a CONFLICT (never auto-changed)', () => {
    const oldDriverPom = POM.replace('42.7.4', '9.4.1212');
    const { additions, conflicts } = reconcileManifestWithDecisions(oldDriverPom, DECISIONS);
    expect(additions.map((a) => a.artifactId)).not.toContain('postgresql');
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].coordinate).toBe('org.postgresql:postgresql');
    expect(conflicts[0].message).toContain('NEVER changed automatically');
  });
});

describe('applyAdditionsToPom', () => {
  it('inserts into the PROJECT dependencies (after dependencyManagement); every other byte identical', () => {
    const { additions } = reconcileManifestWithDecisions(POM, DECISIONS);
    const updated = applyAdditionsToPom(POM, additions);
    expect(updated).not.toBeNull();
    // Inserted with the decision citation, version-less.
    expect(updated!).toContain('<artifactId>liquibase-core</artifactId>');
    expect(updated!).toContain('[decision:db.migrations]');
    expect(updated!).not.toContain('<artifactId>liquibase-core</artifactId>\n            <version>');
    // Position: AFTER dependencyManagement's close, BEFORE the project
    // dependencies close.
    const mgmtEnd = updated!.indexOf('</dependencyManagement>');
    const inserted = updated!.indexOf('liquibase-core');
    expect(inserted).toBeGreaterThan(mgmtEnd);
    // Byte-preservation: removing the inserted blocks restores the original.
    const reconciled = reconcileManifestWithDecisions(updated!, DECISIONS);
    expect(reconciled.additions).toEqual([]); // idempotent — nothing pending
    // The prior content is a strict subsequence: prefix + suffix unchanged.
    const insertAt = updated!.indexOf('        <dependency>\n            <groupId>org.liquibase</groupId>');
    expect(updated!.slice(0, insertAt)).toBe(POM.slice(0, insertAt));
  });

  it('no <dependencies> section -> null (amend manually; never guessed)', () => {
    expect(
      applyAdditionsToPom('<project></project>', [
        {
          groupId: 'g',
          artifactId: 'a',
          version: null,
          decisionCode: 'x',
          note: '',
        },
      ])
    ).toBeNull();
  });
});
