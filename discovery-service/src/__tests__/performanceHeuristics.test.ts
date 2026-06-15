/**
 * Tests for performanceHeuristics — the deterministic obvious-gap checks
 * that pre-empt the LLM scorer.
 */

import { runDeterministicChecks } from '../services/performanceHeuristics';
import type { DiscoveryCandidate } from '../types/candidate';

function cand(
  type: DiscoveryCandidate['candidateType'],
  name: string,
  data: Record<string, unknown> = {},
): DiscoveryCandidate {
  return {
    id: `id-${name}`,
    runId: 'run-test',
    candidateType: type,
    name,
    confidence: 0.9,
    status: 'proposed',
    sourceClusterIds: ['x.java'],
    data: { _addedBy: 'spring-classic-adapter', ...data },
    synthesizedAt: '2026-04-25T00:00:00Z',
  };
}

function llmCand(
  type: DiscoveryCandidate['candidateType'],
  name: string,
  data: Record<string, unknown> = {},
): DiscoveryCandidate {
  return cand(type, name, { _addedBy: 'llm-gap-fill', ...data });
}

describe('runDeterministicChecks — Spring/Java rules', () => {
  it('flags spring-no-controllers as suspicious when there are 0 controllers and the run has web scope', () => {
    const flags = runDeterministicChecks({
      candidates: [cand('interfaces', 'PatientService', { springConfigKind: 'service-api' })],
      packCombo: { language: 'Java', frameworks: ['Spring'] },
      hasWebScope: true,
    });
    const codes = flags.map((f) => f.code);
    expect(codes).toContain('spring-no-controllers');
    const ctrl = flags.find((f) => f.code === 'spring-no-controllers')!;
    expect(ctrl.severity).toBe('suspicious');
  });

  it('downgrades spring-no-controllers to info when hasWebScope is explicitly false', () => {
    const flags = runDeterministicChecks({
      candidates: [cand('interfaces', 'PatientService', { springConfigKind: 'service-api' })],
      packCombo: { language: 'Java', frameworks: ['Spring'] },
      hasWebScope: false,
    });
    const ctrl = flags.find((f) => f.code === 'spring-no-controllers');
    expect(ctrl?.severity).toBe('info');
  });

  it('does NOT flag spring-no-controllers when controllers ARE present', () => {
    const flags = runDeterministicChecks({
      candidates: [
        cand('interfaces', 'PatientController', { controllerType: 'Controller' }),
        cand('interfaces', 'OrderController', { controllerType: 'RestController' }),
      ],
      packCombo: { language: 'Java', frameworks: ['Spring'] },
      hasWebScope: true,
    });
    const codes = flags.map((f) => f.code);
    expect(codes).not.toContain('spring-no-controllers');
  });

  it('flags jpa-pack-no-adapter-entities when LLM emitted entities but adapter did not', () => {
    const flags = runDeterministicChecks({
      candidates: [
        llmCand('physical_data_entities', 'Patient'),
        llmCand('physical_data_entities', 'Encounter'),
      ],
      packCombo: { language: 'Java', frameworks: ['Spring', 'Hibernate'] },
    });
    const f = flags.find((x) => x.code === 'jpa-pack-no-adapter-entities');
    // Severity downgraded from 'suspicious' to 'warn' on 2026-04-28 — the
    // flag is now a hint for the LLM scorer to interrogate, not a verdict.
    expect(f?.severity).toBe('warn');
  });

  it('flags jpa-pack-no-entities when no entities exist BUT DB-layer evidence is present (Repository class)', () => {
    // Repository-suffix className signals a JPA layer is in use even though
    // the entity extractor missed everything.
    const flags = runDeterministicChecks({
      candidates: [
        cand('interfaces', 'X'),
        cand('business_logics', 'findById', { className: 'OwnerRepository' }),
      ],
      packCombo: { language: 'Java', frameworks: ['Hibernate'] },
    });
    const codes = flags.map((f) => f.code);
    expect(codes).toContain('jpa-pack-no-entities');
  });

  it('does NOT flag jpa-pack-no-entities for stateless Spring services (no DB-layer evidence)', () => {
    // ETL workers, gateways, schedulers — Spring without a DB layer. Used
    // to be falsely flagged as "missing JPA entities"; 2026-04-28 fix
    // gates the flag behind positive DB-layer evidence.
    const flags = runDeterministicChecks({
      candidates: [
        cand('interfaces', 'GatewayController'),
        cand('endpoints', 'GET /health'),
        cand('business_logics', 'forwardRequest', { className: 'GatewayService' }),
      ],
      packCombo: { language: 'Java', frameworks: ['Spring'] },
    });
    const codes = flags.map((f) => f.code);
    expect(codes).not.toContain('jpa-pack-no-entities');
    expect(codes).not.toContain('jpa-pack-no-adapter-entities');
  });

  it('flags jpa-pack-no-entities when @Transactional metadata is present but entities are missing', () => {
    // @Transactional on service methods is captured as `data.transactional`
    // by the spring-boot adapter Tier-1 enrichment — strong signal that DB
    // work is happening.
    const flags = runDeterministicChecks({
      candidates: [
        cand('interfaces', 'X'),
        cand('business_logics', 'createOwner', {
          className: 'OwnerService',
          transactional: { propagation: 'REQUIRED', readOnly: 'false' },
        }),
      ],
      packCombo: { language: 'Java', frameworks: ['Spring'] },
    });
    const codes = flags.map((f) => f.code);
    expect(codes).toContain('jpa-pack-no-entities');
  });

  it('does NOT flag for service whose only DB-shaped clue is @Transactional alone — wait, IT DOES (Transactional is strong evidence)', () => {
    // Sanity: @Transactional alone is enough. This test documents that
    // and prevents accidental regression where someone might require
    // multiple signals.
    const flags = runDeterministicChecks({
      candidates: [
        cand('business_logics', 'doThing', {
          className: 'X',
          transactional: { declared: 'true' },
        }),
      ],
      packCombo: { language: 'Java', frameworks: ['Hibernate'] },
    });
    expect(flags.map((f) => f.code)).toContain('jpa-pack-no-entities');
  });
});

describe('runDeterministicChecks — over-relying-on-llm rule', () => {
  it('warns when adapter share is low (<30%) on a >=50-candidate run', () => {
    // 3 adapter + 50 LLM = 6% adapter
    const cands: DiscoveryCandidate[] = [];
    for (let i = 0; i < 3; i++) cands.push(cand('interfaces', `A${i}`));
    for (let i = 0; i < 50; i++) cands.push(llmCand('business_logics', `L${i}`, { className: 'Foo' }));
    const flags = runDeterministicChecks({
      candidates: cands,
      packCombo: { language: 'Java', frameworks: ['Spring'] },
    });
    expect(flags.find((f) => f.code === 'over-relying-on-llm')?.severity).toBe('warn');
  });

  it('does NOT flag over-relying-on-llm when adapter share is healthy', () => {
    const cands: DiscoveryCandidate[] = [];
    for (let i = 0; i < 50; i++) cands.push(cand('interfaces', `A${i}`));
    for (let i = 0; i < 20; i++) cands.push(llmCand('business_logics', `L${i}`, { className: 'Foo' }));
    const flags = runDeterministicChecks({
      candidates: cands,
      packCombo: { language: 'Java', frameworks: ['Spring'] },
    });
    expect(flags.map((f) => f.code)).not.toContain('over-relying-on-llm');
  });

  it('skips the rule when run has fewer than 50 candidates total (insufficient data)', () => {
    const cands = [llmCand('business_logics', 'X', { className: 'Foo' })];
    const flags = runDeterministicChecks({
      candidates: cands,
      packCombo: { language: 'Java', frameworks: ['Spring'] },
    });
    expect(flags.map((f) => f.code)).not.toContain('over-relying-on-llm');
  });
});

describe('runDeterministicChecks — frontend rules', () => {
  it('flags angularjs-no-screens when AngularJS pack with 0 ui_screens', () => {
    const flags = runDeterministicChecks({
      candidates: [cand('ui_components', 'someDirective', { _addedBy: 'angularjs-classic-adapter' })],
      packCombo: { language: 'JavaScript', frameworks: ['AngularJS'] },
    });
    expect(flags.find((f) => f.code === 'angularjs-no-screens')?.severity).toBe('suspicious');
  });

  it('flags ui-pack-no-components when UI pack but 0 ui_components', () => {
    const flags = runDeterministicChecks({
      candidates: [cand('ui_screens', '/home')],
      packCombo: { language: 'TypeScript', frameworks: ['Angular'] },
    });
    expect(flags.find((f) => f.code === 'ui-pack-no-components')?.severity).toBe('suspicious');
  });
});

describe('runDeterministicChecks — endpoint-shape rule', () => {
  it('flags endpoints-missing-structure when an endpoint has no httpMethod or path', () => {
    const flags = runDeterministicChecks({
      candidates: [llmCand('endpoints', 'MESSAGE ADT_A28', {})],
      packCombo: { language: 'Java', frameworks: ['Spring'] },
    });
    expect(flags.find((f) => f.code === 'endpoints-missing-structure')?.severity).toBe('warn');
  });

  it('does NOT flag well-formed endpoints', () => {
    const flags = runDeterministicChecks({
      candidates: [
        cand('endpoints', 'GET /patients', {
          httpMethod: 'GET',
          fullPath: '/patients',
        }),
        // Need at least one controller so the spring-no-controllers rule
        // doesn't fire instead.
        cand('interfaces', 'PatientController', { controllerType: 'RestController' }),
      ],
      packCombo: { language: 'Java', frameworks: ['Spring'] },
      hasWebScope: true,
    });
    expect(flags.map((f) => f.code)).not.toContain('endpoints-missing-structure');
  });
});

describe('runDeterministicChecks — pure-llm rule', () => {
  it('warns when adapter share is exactly 0%', () => {
    const flags = runDeterministicChecks({
      candidates: [
        llmCand('business_logics', 'foo', { className: 'X' }),
        llmCand('business_logics', 'bar', { className: 'X' }),
      ],
      packCombo: { language: 'Python', frameworks: [] },
    });
    expect(flags.find((f) => f.code === 'pure-llm-run')?.severity).toBe('warn');
  });
});

describe('runDeterministicChecks — candidate-blowup rule', () => {
  it('warns when candidate-to-file ratio exceeds 50x', () => {
    const cands: DiscoveryCandidate[] = [];
    for (let i = 0; i < 200; i++) cands.push(cand('business_logics', `m${i}`, { className: 'Foo' }));
    const flags = runDeterministicChecks({
      candidates: cands,
      packCombo: { language: 'Java', frameworks: ['Spring'] },
      filesAnalyzed: 2,
      hasWebScope: false,
    });
    expect(flags.map((f) => f.code)).toContain('candidate-blowup');
  });

  it('does NOT flag candidate-blowup at sane ratios', () => {
    const cands: DiscoveryCandidate[] = [];
    for (let i = 0; i < 50; i++) cands.push(cand('business_logics', `m${i}`, { className: 'Foo' }));
    const flags = runDeterministicChecks({
      candidates: cands,
      packCombo: { language: 'Java', frameworks: ['Spring'] },
      filesAnalyzed: 30,
      hasWebScope: false,
    });
    expect(flags.map((f) => f.code)).not.toContain('candidate-blowup');
  });
});
