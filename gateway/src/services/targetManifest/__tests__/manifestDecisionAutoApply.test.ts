/**
 * Decision→manifest AUTO-APPLY (2026-08-16). Pins:
 *   - a decision-required coordinate the pom lacks (the live gap:
 *     db.migrations=Liquibase but no liquibase-core) is applied AUTOMATICALLY
 *     as a new latest artifact version, resolved_dependencies extended;
 *   - already-satisfied requirements are a noop (no write);
 *   - conflicts stay LOUD + manual (never auto-changed, still reported);
 *   - fail-soft everywhere (a reconcile hiccup can never throw into the
 *     decision write / upload that triggered it);
 *   - the debounce coalesces a write burst into ONE apply.
 */

jest.mock('../../logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import {
  AUTO_APPLY_DEBOUNCE_MS,
  __resetDecisionManifestAutoApplyTimers,
  autoApplyDecisionAdditions,
  scheduleDecisionManifestAutoApply,
} from '../manifestDecisionAutoApply';
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

const POM_WITHOUT_LIQUIBASE = [
  '<project>',
  '    <dependencies>',
  '        <dependency>',
  '            <groupId>org.springframework.boot</groupId>',
  '            <artifactId>spring-boot-starter-web</artifactId>',
  '        </dependency>',
  '    </dependencies>',
  '</project>',
].join('\n');

function artifact(content: string): Record<string, unknown> {
  return {
    tag: 'svc-api',
    kind: 'pom.xml',
    ecosystem: 'MAVEN',
    manifest_path: 'pom.xml',
    content,
    package_lock_content: null,
    resolved_dependencies: [{ name: 'org.springframework.boot:spring-boot-starter-web' }],
    target_service_element_id: 'svc-api',
    tier2_facts: [],
  };
}

const DECISIONS = [decision('db.migrations', 'Liquibase 4')];

afterEach(() => {
  __resetDecisionManifestAutoApplyTimers();
  jest.useRealTimers();
});

describe('autoApplyDecisionAdditions', () => {
  it('applies a missing decision-required coordinate as a NEW latest artifact version', async () => {
    const persisted: unknown[] = [];
    const result = await autoApplyDecisionAdditions('p1', 'arch-1', {
      fetchArtifacts: jest.fn().mockResolvedValue([artifact(POM_WITHOUT_LIQUIBASE)]),
      fetchDecisions: jest.fn().mockResolvedValue(DECISIONS),
      persistArtifacts: jest.fn().mockImplementation(async (_p, _a, rows) => {
        persisted.push(...(rows as unknown[]));
        return undefined;
      }),
    } as never);

    expect(result.status).toBe('applied');
    expect(result.applied).toEqual(['org.liquibase:liquibase-core']);
    expect(persisted).toHaveLength(1);
    const row = persisted[0] as Record<string, unknown>;
    expect(String(row.content)).toContain('<artifactId>liquibase-core</artifactId>');
    // BOM-managed: version-less insert.
    expect(String(row.content)).not.toMatch(/liquibase-core<\/artifactId>\s*<version>/);
    // The resolved list stays consistent with the amended content.
    const resolved = row.resolved_dependencies as Array<Record<string, unknown>>;
    expect(resolved.some((r) => r.name === 'org.liquibase:liquibase-core')).toBe(true);
  });

  it('noop when the manifest already satisfies every fired rule (no write)', async () => {
    const withLiquibase = POM_WITHOUT_LIQUIBASE.replace(
      '    </dependencies>',
      [
        '        <dependency>',
        '            <groupId>org.liquibase</groupId>',
        '            <artifactId>liquibase-core</artifactId>',
        '        </dependency>',
        '    </dependencies>',
      ].join('\n')
    );
    const persist = jest.fn();
    const result = await autoApplyDecisionAdditions('p1', 'arch-1', {
      fetchArtifacts: jest.fn().mockResolvedValue([artifact(withLiquibase)]),
      fetchDecisions: jest.fn().mockResolvedValue(DECISIONS),
      persistArtifacts: persist,
    } as never);
    expect(result.status).toBe('noop');
    expect(persist).not.toHaveBeenCalled();
  });

  it('version conflicts are NEVER auto-changed — reported, additions still applied', async () => {
    const oldDriverPom = POM_WITHOUT_LIQUIBASE.replace(
      '    </dependencies>',
      [
        '        <dependency>',
        '            <groupId>org.postgresql</groupId>',
        '            <artifactId>postgresql</artifactId>',
        '            <version>9.4.1212</version>',
        '        </dependency>',
        '    </dependencies>',
      ].join('\n')
    );
    const persisted: unknown[] = [];
    const result = await autoApplyDecisionAdditions('p1', 'arch-1', {
      fetchArtifacts: jest.fn().mockResolvedValue([artifact(oldDriverPom)]),
      fetchDecisions: jest
        .fn()
        .mockResolvedValue([...DECISIONS, decision('db.driver', 'pgjdbc 42.7.4')]),
      persistArtifacts: jest.fn().mockImplementation(async (_p, _a, rows) => {
        persisted.push(...(rows as unknown[]));
        return undefined;
      }),
    } as never);
    expect(result.status).toBe('applied');
    expect(result.conflicts).toBe(1);
    const row = persisted[0] as Record<string, unknown>;
    // The conflicting pin SURVIVES untouched.
    expect(String(row.content)).toContain('<version>9.4.1212</version>');
  });

  it('no manifest / read failure are fail-soft statuses, never throws', async () => {
    const none = await autoApplyDecisionAdditions('p1', 'arch-1', {
      fetchArtifacts: jest.fn().mockResolvedValue([]),
      fetchDecisions: jest.fn(),
      persistArtifacts: jest.fn(),
    } as never);
    expect(none.status).toBe('no_manifest');

    const broken = await autoApplyDecisionAdditions('p1', 'arch-1', {
      fetchArtifacts: jest.fn().mockRejectedValue(new Error('AMS down')),
      fetchDecisions: jest.fn(),
      persistArtifacts: jest.fn(),
    } as never);
    expect(broken.status).toBe('error');
  });
});

describe('scheduleDecisionManifestAutoApply (debounce)', () => {
  it('coalesces a burst of writes into ONE apply after the window', async () => {
    jest.useFakeTimers();
    const fetchArtifacts = jest.fn().mockResolvedValue([]);
    const deps = {
      fetchArtifacts,
      fetchDecisions: jest.fn().mockResolvedValue([]),
      persistArtifacts: jest.fn(),
    } as never;

    scheduleDecisionManifestAutoApply('p1', 'arch-1', deps);
    scheduleDecisionManifestAutoApply('p1', 'arch-1', deps);
    scheduleDecisionManifestAutoApply('p1', 'arch-1', deps);
    expect(fetchArtifacts).not.toHaveBeenCalled();

    jest.advanceTimersByTime(AUTO_APPLY_DEBOUNCE_MS + 10);
    // Let the async apply body run.
    await Promise.resolve();
    await Promise.resolve();

    expect(fetchArtifacts).toHaveBeenCalledTimes(1);
  });
});
