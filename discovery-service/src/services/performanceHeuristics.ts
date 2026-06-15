/**
 * Performance heuristics — deterministic obvious-gap checks.
 *
 * Spec: Discovery Performance Scoring (2026-04-25), Phase 3.
 *
 * Runs BEFORE the LLM scoring call. Produces a list of `DeterministicFlag`
 * items that the LLM scorer is given as pre-computed signals — so flags
 * like "Spring + 0 controllers" reach the LLM as facts, not heuristic
 * guesses. The flags also feed directly into the run-level
 * `coverageOfObviousGaps` axis.
 *
 * Flags are codebase-aware where possible: e.g. for the OpenMRS pattern,
 * `low-endpoint-count-on-spring` is `info`-level (correct for that repo
 * because REST is in a separate module). The same flag on a generic
 * Spring web app would be `suspicious`.
 */

import type { DiscoveryCandidate } from '../types/candidate';

export interface DeterministicFlag {
  /** Stable code for grep/audit. */
  code: string;
  /** Severity influences the cross-cutting `coverageOfObviousGaps` axis. */
  severity: 'info' | 'warn' | 'suspicious';
  /** Human-readable note for the per-run MD. */
  message: string;
}

export interface HeuristicInput {
  candidates: DiscoveryCandidate[];
  /** Tech-hint summary — { language, frameworks } */
  packCombo: {
    language: string;
    frameworks: string[];
  };
  /** Optional: total source files walked (from scan plan). */
  filesAnalyzed?: number;
  /** Optional: whether the project has a 'web/' or controller-bearing scope. */
  hasWebScope?: boolean;
}

const NORMALISE = (s: string): string =>
  s.toLowerCase().replace(/[\s\-_]+/g, '');

function hasFramework(combo: HeuristicInput['packCombo'], target: string): boolean {
  const t = NORMALISE(target);
  return combo.frameworks.some((f) => NORMALISE(f).includes(t));
}

function isLanguage(combo: HeuristicInput['packCombo'], target: string): boolean {
  return NORMALISE(combo.language) === NORMALISE(target);
}

function countByType(
  cands: DiscoveryCandidate[],
  type: DiscoveryCandidate['candidateType'],
): number {
  return cands.filter((c) => c.candidateType === type).length;
}

function adapterShare(cands: DiscoveryCandidate[]): number {
  if (cands.length === 0) return 0;
  const adapter = cands.filter(
    (c) => ((c.data as Record<string, unknown> | undefined) ?? {})._addedBy &&
      String(((c.data as Record<string, unknown>) ?? {})._addedBy).endsWith('-adapter'),
  ).length;
  return adapter / cands.length;
}

/**
 * Returns true when the candidate set carries any positive evidence that
 * the service has a relational-DB / persistence layer.
 *
 * **Heuristic only** — the flag this gates is now a hint for the LLM
 * scorer to interrogate against the actual samples, not an assertion the
 * scorer has to honour. False positives still happen here (e.g. a class
 * named `XyzRepository` may be a proprietary cache/data-grid pattern,
 * not a Spring Data repository); the rubric tells the LLM to look at
 * sample shape and override the flag when warranted.
 *
 * Signals checked (any one fires, but they're all interrogation-worthy
 * not conclusive):
 *   - `business_logics` className matching JPA-flavoured Repository /
 *     Dao patterns (deliberately includes proprietary Repository names
 *     too — the LLM filters those out by examining samples).
 *   - Any candidate carrying `transactional` metadata (set by the
 *     spring-boot adapter when `@Transactional` is captured) — strongest
 *     signal we have.
 *   - `interfaces` of `interfaceSubtype: 'spring-bean-definition'` whose
 *     `beanReturnType` looks like a JDBC / JPA infra type.
 *   - Any `physical_data_entities` / `physical_data_attributes` candidate
 *     already emitted (would only matter if we're flagging anyway because
 *     adapter share is 0).
 *
 * Deliberately NOT counted as DB evidence:
 *   - `logical_data_entity_relationships` — these are LOGICAL
 *     relationships and frequently exist between DTOs / views without
 *     any persistence layer. (2026-04-28 false-positive removal.)
 */
function hasDbLayerEvidence(cands: DiscoveryCandidate[]): boolean {
  for (const c of cands) {
    const d = (c.data as Record<string, unknown> | undefined) ?? {};
    const className = String(d.className ?? '');
    if (/Repository(Impl)?$|^.*Dao(Impl)?$|JpaRepository|CrudRepository/.test(className)) return true;
    if (d.transactional) return true;
    const beanReturn = String(d.beanReturnType ?? '');
    if (/DataSource|EntityManagerFactory|SessionFactory|JdbcTemplate|TransactionManager/.test(beanReturn)) return true;
    if (c.candidateType === 'physical_data_entities') return true;
    if (c.candidateType === 'physical_data_attributes') return true;
  }
  return false;
}

/**
 * Per-pack obvious-gap checks. Each rule is a small, focused function that
 * returns 0 or 1 flags. Keeping them as discrete functions makes auditing
 * easier than one monolithic switch.
 */

function checkSpringNoControllers(input: HeuristicInput): DeterministicFlag[] {
  if (!isLanguage(input.packCombo, 'Java')) return [];
  if (!hasFramework(input.packCombo, 'Spring')) return [];
  const ifaces = input.candidates.filter((c) => c.candidateType === 'interfaces');
  const controllers = ifaces.filter((c) => {
    const d = (c.data as Record<string, unknown> | undefined) ?? {};
    const t = String(d.controllerType ?? '');
    return t === 'Controller' || t === 'RestController';
  });
  if (controllers.length > 0) return [];

  // No controllers found. Severity depends on whether there's likely a
  // controller-bearing scope. If the run was service-scoped on a path
  // that excludes web/, this is correct (info). Otherwise suspicious.
  const sev: DeterministicFlag['severity'] = input.hasWebScope === false ? 'info' : 'suspicious';
  return [
    {
      code: 'spring-no-controllers',
      severity: sev,
      message:
        'Java/Spring run found 0 @Controller / @RestController interfaces. ' +
        (sev === 'info'
          ? 'Service scope likely excludes a web/ tier — flag as info.'
          : 'Expected on a Spring web codebase; suggests pack didn\'t pick up controllers or repo genuinely has none (e.g. REST in a separate module).'),
    },
  ];
}

function checkJpaPackNoEntities(input: HeuristicInput): DeterministicFlag[] {
  if (!hasFramework(input.packCombo, 'Hibernate') && !hasFramework(input.packCombo, 'Spring')) {
    return [];
  }
  const pde = countByType(input.candidates, 'physical_data_entities');
  const adapterPde = input.candidates.filter(
    (c) =>
      c.candidateType === 'physical_data_entities' &&
      String(((c.data as Record<string, unknown> | undefined) ?? {})._addedBy ?? '').includes('adapter'),
  ).length;
  if (adapterPde > 0) return [];

  // Critical gate (2026-04-28): only flag when the candidate set carries
  // positive evidence that this service has a DB layer. Spring is used
  // for plenty of stateless services (ETL workers, API gateways,
  // schedulers) where 0 entities is correct — those should NOT be
  // flagged. The flag is gating evidence for the LLM scorer, so a false
  // positive here drags both `physical_data_entities` AND
  // `coverageOfObviousGaps` down for a service with no fault.
  if (!hasDbLayerEvidence(input.candidates)) {
    return [];
  }

  if (pde > 0) {
    return [
      {
        code: 'jpa-pack-no-adapter-entities',
        severity: 'warn',
        message:
          'HEURISTIC HINT — please interrogate against samples: JPA/Hibernate-relevant pack with possible DB-layer evidence in the candidate set, but ZERO adapter-emitted physical_data_entities. ' +
          `${pde} entities were emitted by the LLM only — suggests HBM merge or @Entity scanning may have failed. Verify by inspecting the candidates: do samples show genuine JPA @Entity / @Table classes, ORM mapping files, or RDBMS DataSource beans? If the "evidence" is proprietary cache/data-grid patterns or admin-only JDBC, this flag is a false positive — say so in the reasoning and score Coverage accordingly.`,
      },
    ];
  }
  return [
    {
      code: 'jpa-pack-no-entities',
      severity: 'warn',
      message:
        'HEURISTIC HINT — please interrogate against samples: JPA/Hibernate-relevant pack with possible DB-layer evidence (Repository/Dao class names, @Transactional, JDBC bean factories) but ZERO physical_data_entities. The entity extractor MAY have failed — but verify first. If the samples show only proprietary repositories (Coherence, DataFabric, custom caches), admin-only JdbcTemplate use, or a UI/aggregator service that genuinely has no persistence layer, this flag is a false positive. Override it in your reasoning and score Coverage as 5 (nothing was missed).',
    },
  ];
}

function checkOverRelyingOnLlm(input: HeuristicInput): DeterministicFlag[] {
  const share = adapterShare(input.candidates);
  if (input.candidates.length < 50) return []; // too few to assess
  if (share < 0.3) {
    return [
      {
        code: 'over-relying-on-llm',
        severity: 'warn',
        message:
          `Adapter share is ${(share * 100).toFixed(0)}% (target 50-70% for annotation-rich packs). ` +
          'Either the language pack is failing to extract IR (parser issue) or the framework pack predicate is not matching (techHints mismatch).',
      },
    ];
  }
  return [];
}

function checkAngularJsClassicNoScreens(input: HeuristicInput): DeterministicFlag[] {
  if (!hasFramework(input.packCombo, 'AngularJS')) return [];
  const screens = countByType(input.candidates, 'ui_screens');
  if (screens === 0) {
    return [
      {
        code: 'angularjs-no-screens',
        severity: 'suspicious',
        message:
          'AngularJS classic pack but ZERO ui_screens. Expected at least one $routeProvider.when() or $stateProvider.state() binding in any AngularJS app — pack may have missed routing.',
      },
    ];
  }
  return [];
}

function checkUiPackNoComponents(input: HeuristicInput): DeterministicFlag[] {
  const isUiFramework =
    hasFramework(input.packCombo, 'AngularJS') ||
    hasFramework(input.packCombo, 'React') ||
    hasFramework(input.packCombo, 'Angular') ||
    hasFramework(input.packCombo, 'Vue');
  if (!isUiFramework) return [];
  const comps = countByType(input.candidates, 'ui_components');
  if (comps === 0) {
    return [
      {
        code: 'ui-pack-no-components',
        severity: 'suspicious',
        message:
          'UI-framework pack but ZERO ui_components. Pack likely failed to detect components/directives.',
      },
    ];
  }
  return [];
}

function checkPureLlm(input: HeuristicInput): DeterministicFlag[] {
  const share = adapterShare(input.candidates);
  if (input.candidates.length === 0) return [];
  if (share === 0 && input.candidates.length > 0) {
    return [
      {
        code: 'pure-llm-run',
        severity: 'warn',
        message:
          '100% LLM-emitted candidates, 0% adapter. Either the language pack didn\'t fire (Tier C) or the framework pack predicate didn\'t match.',
      },
    ];
  }
  return [];
}

function checkCandidateBlowup(input: HeuristicInput): DeterministicFlag[] {
  if (!input.filesAnalyzed || input.filesAnalyzed === 0) return [];
  const ratio = input.candidates.length / input.filesAnalyzed;
  if (ratio > 50) {
    return [
      {
        code: 'candidate-blowup',
        severity: 'warn',
        message:
          `Candidate-to-file ratio is ${ratio.toFixed(1)}× (>50× threshold). ` +
          'Likely over-emission: check for runaway business_logics or duplicate emissions.',
      },
    ];
  }
  return [];
}

function checkEndpointHallucinationShape(input: HeuristicInput): DeterministicFlag[] {
  // Cross-check: any endpoint with no httpMethod AND no fullPath/path/url is suspicious.
  // (Should already be dropped by the LLM gap-fill structured-metadata gate, but
  // adapter rows are excluded from that gate; this is belt-and-braces.)
  const eps = input.candidates.filter((c) => c.candidateType === 'endpoints');
  const broken = eps.filter((c) => {
    const d = (c.data as Record<string, unknown> | undefined) ?? {};
    const hasMethod = typeof d.httpMethod === 'string' && (d.httpMethod as string).length > 0;
    const hasPath =
      (typeof d.fullPath === 'string' && (d.fullPath as string).length > 0) ||
      (typeof d.path === 'string' && (d.path as string).length > 0) ||
      (typeof d.url === 'string' && (d.url as string).length > 0);
    return !hasMethod || !hasPath;
  });
  if (broken.length > 0) {
    return [
      {
        code: 'endpoints-missing-structure',
        severity: 'warn',
        message: `${broken.length} endpoint candidate(s) missing httpMethod or path/url — likely hallucinations or under-extracted.`,
      },
    ];
  }
  return [];
}

/**
 * Run all heuristics and return the aggregated flag list. The order is
 * insertion order of the rules above.
 */
export function runDeterministicChecks(input: HeuristicInput): DeterministicFlag[] {
  return [
    ...checkSpringNoControllers(input),
    ...checkJpaPackNoEntities(input),
    ...checkOverRelyingOnLlm(input),
    ...checkAngularJsClassicNoScreens(input),
    ...checkUiPackNoComponents(input),
    ...checkPureLlm(input),
    ...checkCandidateBlowup(input),
    ...checkEndpointHallucinationShape(input),
  ];
}
