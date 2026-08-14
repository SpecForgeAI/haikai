/**
 * Target-stack spec section (2026-08-14). Pins:
 *   - deterministic grouped render (same section mapping as
 *     target-tech-stack.md), artefact-type framing ("SOURCE CODE inside the
 *     application created by the scaffold story"), scoped-override qualifiers;
 *   - null on zero decisions (nothing fabricated);
 *   - idempotent append (a re-run never doubles the block);
 *   - DB-plane stream detection (those specs carry pack files instead).
 */
import {
  TARGET_STACK_SECTION_HEADING,
  appendTargetStackSection,
  buildTargetStackSpecSection,
  isDbPlaneStream,
} from '../migrationTargetStackSpecSection';
import { TargetStateCapturedDecision } from '../targetStateCapturedDecisionsClient';

function decision(
  code: string,
  summary: string,
  overrides: Partial<TargetStateCapturedDecision> = {},
): TargetStateCapturedDecision {
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
    ...overrides,
  };
}

describe('buildTargetStackSpecSection', () => {
  it('renders grouped decisions with the artefact-type framing', () => {
    const text = buildTargetStackSpecSection([
      decision('service.framework', 'Spring Boot 4.0.0'),
      decision('db.engine', 'Postgres 18.0'),
      decision('ci.pipeline', 'GitLab CI'),
    ]);
    expect(text).toContain(TARGET_STACK_SECTION_HEADING);
    expect(text).toContain('SOURCE CODE');
    expect(text).toContain('scaffold story (sequenced FIRST');
    expect(text).toContain('- `service.framework` — Spring Boot 4.0.0');
    expect(text).toContain('- `db.engine` — Postgres 18.0');
    // Grouped under the SAME headings as target-tech-stack.md.
    expect(text).toContain('### Backend');
    expect(text).toContain('### Database');
    // Anti-invention instruction present.
    expect(text).toContain('surface the gap instead');
  });

  it('carries scoped per-element overrides with their qualifier', () => {
    const text = buildTargetStackSpecSection([
      decision('db.engine', 'Postgres 18.0'),
      decision('db.engine', 'Read-replica exception', {
        scopeKind: 'element',
        scopeRefType: 'physical_data_entity',
        scopeRefId: 'el-42',
      }),
    ]);
    expect(text).toContain('(scope: element physical_data_entity el-42)');
  });

  it('returns null on zero decisions (nothing fabricated)', () => {
    expect(buildTargetStackSpecSection([])).toBeNull();
  });
});

describe('appendTargetStackSection', () => {
  it('appends once and is idempotent', () => {
    const section = buildTargetStackSpecSection([decision('db.engine', 'Postgres 18.0')])!;
    const once = appendTargetStackSection('SPEC BODY', section);
    expect(once).toContain('SPEC BODY');
    expect(once).toContain(TARGET_STACK_SECTION_HEADING);
    const twice = appendTargetStackSection(once, section);
    expect(twice).toBe(once);
  });

  it('null section -> passthrough', () => {
    expect(appendTargetStackSection('SPEC BODY', null)).toBe('SPEC BODY');
  });
});

describe('isDbPlaneStream', () => {
  it('detects DB-plane stream tags; everything else (incl. no stream tag) is service-plane', () => {
    expect(isDbPlaneStream(['stream:target_database_schema_implementation'])).toBe(true);
    expect(isDbPlaneStream(['stream:data_migration', 'provenance:plan-deterministic'])).toBe(true);
    expect(isDbPlaneStream(['stream:api_migration'])).toBe(false);
    expect(isDbPlaneStream(['stream:internal_processing_implementation'])).toBe(false);
    expect(isDbPlaneStream([])).toBe(false);
    expect(isDbPlaneStream(null)).toBe(false);
  });
});
