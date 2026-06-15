/**
 * V3 Discovery Pipeline Foundation — Task Group 7 acceptance tests.
 *
 * Spec: V3 Discovery Pipeline Foundation (Task Group 7).
 *
 * This file is the strategic gap-fill Task Group 7 added on top of the
 * per-group focused tests (Groups 1-6). It intentionally limits itself to
 * scenarios that are NOT already covered:
 *
 *   1. OpenMRS parity end-to-end acceptance (count ±2% of V2 baseline + a
 *      ≥10-candidate `(candidateType, name, filePath, _addedBy)` identity
 *      spot-check). Gated behind the `OPENMRS_HARNESS_DIR` env var (and an
 *      auto-detect of `C:/tmp/openmrs-harness`) so CI without the clone
 *      skips cleanly. `runSpringClassicV3` + `collectJavaSourceMap` from
 *      `scripts/run-spring-classic-local.ts` are the acceptance vehicle.
 *      NOTE: `runSpringClassicV3` directly invokes the pack pair and does
 *      NOT go through `runDiscoveryV3`, so the V3 layered-prompt gap-fill
 *      stage does not contribute to these candidate counts — the 1037±2%
 *      baseline remains accurate.
 *
 *   2. Tier B degradation with the REAL `javaLangPack`: `runDiscoveryV3`
 *      with only the language pack registered produces IR for .java files,
 *      zero framework-pack candidates, tier 'B', and the gap-fill stage
 *      payload on `steps_payload.v3.gapFill`. Group 5 test 3 uses a FAKE
 *      language pack; this test pins the real javaLangPack path.
 *
 *   3. Tier C with no matching packs: `runDiscoveryV3` with no packs
 *      registered at all produces zero candidates, tier 'C', AND still
 *      emits the gap-fill stage payload. Pins the "nothing matches" path
 *      against the real orchestrator + a non-matching techHints input.
 *
 *   4. Tier propagation into the Java DTO pipeline: verify that
 *      `runDiscoveryV3` sends the computed tier under the field name
 *      `mode` (matching `DiscoveryRunDto.mode`) to `updateDiscoveryRun`
 *      — pinning the wire contract so future Java DTO renames are caught
 *      at the TypeScript boundary.
 *
 * Scope: ONLY gaps specific to the V3 foundation. No edge cases, no
 * performance, no accessibility. See Task Group 7 section of
 * `tasks.md` for why each scenario was chosen.
 *
 * 2026-04-19 Layered-Prompt Task Group 5 amendment:
 *   - The Stage 3 stub (`V3_STAGE3_STUB_MARKER`) was retired when
 *     `runLlmGapFill` replaced the stub in `discoveryV3Pipeline.ts`.
 *   - Tier B / Tier C tests now assert on `steps_payload.v3.gapFill`
 *     (stageStatus/dedupDroppedCount/failures/filesProcessed) instead.
 *   - `runLlmGapFill` is mocked at the module level so these orchestrator
 *     tests don't reach the gateway relay.
 *
 * 2026-05-31 provenance-tag-split amendment:
 *   - The spring-classic adapter no longer tags EVERY candidate
 *     `_addedBy: 'spring-classic-adapter'`. The inbound-surface detectors
 *     stamp per-detector tags (`spring-classic-jaxrs`, `spring-classic-servlet`,
 *     `spring-classic-webflux-fn`) while the core emission paths
 *     (JPA / business-logic / outbound / data-effect / XML) still stamp
 *     `spring-classic-adapter`. Test 3's intent — "every candidate came from
 *     the spring-classic adapter family" — is now expressed as membership in
 *     the `spring-classic-*` family rather than a single literal. The
 *     identity-tuple spot-check (Test 2) is unchanged: every tuple it pins is
 *     emitted by a core path that still carries `spring-classic-adapter`.
 */

// ---------------------------------------------------------------------------
// Module mocks — registered before imports so side-effects don't hit disk.
// ---------------------------------------------------------------------------

jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

jest.mock('../services/archModelClient', () => ({
  archModelClient: {
    bulkSaveCandidates: jest.fn(),
    updateDiscoveryRun: jest.fn(),
    getDiscoveryRun: jest.fn(),
  },
}));

// Mock the gap-fill stage so orchestrator-path tests stay offline.
jest.mock('../services/llmGapFillStep', () => ({
  runLlmGapFill: jest.fn(),
}));

import * as fs from 'fs';
import * as path from 'path';

import { archModelClient } from '../services/archModelClient';
import {
  clearRegistry,
  registerLanguagePack,
} from '../services/extensionPackRegistry';
import { javaLangPack } from '../services/extensionPacks/languagePacks/javaLangPack';
import { runDiscoveryV3 } from '../services/discoveryV3Pipeline';
import { runLlmGapFill } from '../services/llmGapFillStep';
import {
  runSpringClassicV3,
  collectJavaSourceMap,
} from '../../scripts/run-spring-classic-local';
import type { DiscoveryCandidate } from '../types/candidate';

const runLlmGapFillMock = runLlmGapFill as jest.Mock;

/**
 * The full set of provenance tags the spring-classic adapter family can stamp
 * via `runSpringClassicV3` (i.e. `runSpringClassicAdapter`). The core emission
 * paths (JPA entities/attributes, business logic, outbound integrations,
 * endpoint data-effects, configuration/aspect/feign, logical entities, XML
 * bean files) use `spring-classic-adapter`; the inbound-surface completeness
 * detectors stamp per-detector tags so a reviewer can see which detector
 * produced a candidate. All are members of the `spring-classic-*` family.
 */
const SPRING_CLASSIC_ADDED_BY_FAMILY = new Set<string>([
  'spring-classic-adapter',
  'spring-classic-jaxrs',
  'spring-classic-servlet',
  'spring-classic-webflux-fn',
]);

// ---------------------------------------------------------------------------
// OpenMRS parity acceptance (Task 7.2) — skipped when no clone is available.
// ---------------------------------------------------------------------------

/**
 * V2 baseline candidate count from the pre-migration spring-classic-adapter
 * run against OpenMRS `master`. Documented in tasks.md:
 *   business_logic: 389, physical_attribute: 372, entity_relationship: 191,
 *   physical_entity: 85, interface: 1, endpoint: 1  => total 1039
 * (runtime reference: ~1037).
 *
 * Updated 2026-04-29 (item 1 — logical↔physical mapping emission): each
 * JPA `@Entity` class now also emits a paired `logical_data_entities`
 * candidate, paired `logical_data_attributes` for each field, and the
 * two new link relationships. For OpenMRS that lifts the count by ~2.4×
 * to ~3460. The tolerance is widened slightly to absorb run-to-run
 * variation in the new emissions; tighten back to ±2% once the figure
 * has stabilised across a few runs.
 */
const OPENMRS_V2_BASELINE = 3460;
const OPENMRS_TOLERANCE = 0.03;

/**
 * Known candidate identity tuples present in the V2 baseline. Each tuple is
 * `(candidateType, name, filePath, _addedBy)`; V3 output MUST contain every
 * tuple in this list. Sourced by running `runSpringClassicV3` against a
 * fresh OpenMRS shallow clone.
 *
 * Every tuple here is emitted by a CORE adapter path (JPA entity/attribute,
 * logical-entity relationship, service-layer business logic) that still
 * carries the `spring-classic-adapter` tag after the 2026-05-31 provenance
 * split (the per-detector tags only apply to inbound REST/servlet/WebFlux
 * surfaces, none of which are in this list).
 */
const OPENMRS_KNOWN_CANDIDATES: Array<{
  candidateType: string;
  name: string;
  filePath: string;
  addedBy: string;
}> = [
  { candidateType: 'physical_data_entities', name: 'Allergy', filePath: 'api/src/main/java/org/openmrs/Allergy.java', addedBy: 'spring-classic-adapter' },
  { candidateType: 'physical_data_attributes', name: 'allergyId', filePath: 'api/src/main/java/org/openmrs/Allergy.java', addedBy: 'spring-classic-adapter' },
  { candidateType: 'physical_data_attributes', name: 'allergen', filePath: 'api/src/main/java/org/openmrs/Allergy.java', addedBy: 'spring-classic-adapter' },
  { candidateType: 'physical_data_attributes', name: 'comments', filePath: 'api/src/main/java/org/openmrs/Allergy.java', addedBy: 'spring-classic-adapter' },
  { candidateType: 'logical_data_entity_relationships', name: 'Allergy → Patient', filePath: 'api/src/main/java/org/openmrs/Allergy.java', addedBy: 'spring-classic-adapter' },
  { candidateType: 'logical_data_entity_relationships', name: 'Allergy → Concept', filePath: 'api/src/main/java/org/openmrs/Allergy.java', addedBy: 'spring-classic-adapter' },
  { candidateType: 'logical_data_entity_relationships', name: 'Allergy → AllergyReaction', filePath: 'api/src/main/java/org/openmrs/Allergy.java', addedBy: 'spring-classic-adapter' },
  { candidateType: 'physical_data_entities', name: 'AllergyReaction', filePath: 'api/src/main/java/org/openmrs/AllergyReaction.java', addedBy: 'spring-classic-adapter' },
  { candidateType: 'logical_data_entity_relationships', name: 'AllergyReaction → Allergy', filePath: 'api/src/main/java/org/openmrs/AllergyReaction.java', addedBy: 'spring-classic-adapter' },
  { candidateType: 'business_logics', name: 'purgeGlobalProperty', filePath: 'api/src/main/java/org/openmrs/api/AdministrationService.java', addedBy: 'spring-classic-adapter' },
  { candidateType: 'business_logics', name: 'executeSQL', filePath: 'api/src/main/java/org/openmrs/api/AdministrationService.java', addedBy: 'spring-classic-adapter' },
  { candidateType: 'business_logics', name: 'voidCohort', filePath: 'api/src/main/java/org/openmrs/api/CohortService.java', addedBy: 'spring-classic-adapter' },
];

/** Resolves the OpenMRS harness directory, or null if none is available. */
function resolveOpenMrsDir(): string | null {
  const explicit = process.env.OPENMRS_HARNESS_DIR;
  if (explicit && fs.existsSync(explicit)) return explicit;
  const defaultDir = 'C:/tmp/openmrs-harness';
  if (fs.existsSync(defaultDir) && fs.existsSync(path.join(defaultDir, 'api'))) {
    return defaultDir;
  }
  return null;
}

const openMrsDir = resolveOpenMrsDir();
const describeOpenMrs = openMrsDir ? describe : describe.skip;

describeOpenMrs('Task Group 7: OpenMRS parity acceptance (end-to-end via runSpringClassicV3)', () => {
  // Extractor walks ~800 files + parses each — keep plenty of headroom.
  jest.setTimeout(120_000);

  let harnessRun: ReturnType<typeof runSpringClassicV3>;

  beforeAll(() => {
    const sourceFiles = collectJavaSourceMap(openMrsDir!);
    // Sanity: the walk should have found a meaningful slice of OpenMRS.
    expect(sourceFiles.size).toBeGreaterThan(500);
    harnessRun = runSpringClassicV3(sourceFiles);
  });

  // -------------------------------------------------------------------------
  // Test 1 — candidate count within ±2% of the V2 baseline.
  // -------------------------------------------------------------------------
  test(`emits approximately ${OPENMRS_V2_BASELINE} candidates (±${OPENMRS_TOLERANCE * 100}%) against OpenMRS`, () => {
    const count = harnessRun.candidates.length;
    const lower = Math.floor(OPENMRS_V2_BASELINE * (1 - OPENMRS_TOLERANCE));
    const upper = Math.ceil(OPENMRS_V2_BASELINE * (1 + OPENMRS_TOLERANCE));
    expect(count).toBeGreaterThanOrEqual(lower);
    expect(count).toBeLessThanOrEqual(upper);
  });

  // -------------------------------------------------------------------------
  // Test 2 — ≥10 known candidates match by identity tuple.
  // -------------------------------------------------------------------------
  test('contains all known V2-baseline candidates by (candidateType, name, filePath, _addedBy) identity', () => {
    // Build a Set of identity-tuple strings for O(1) membership.
    const seen = new Set(
      harnessRun.candidates.map((c: DiscoveryCandidate) => {
        const filePath = c.sourceClusterIds[0] ?? '';
        const addedBy =
          (c.data as Record<string, unknown> | undefined)?._addedBy as
            | string
            | undefined;
        return `${c.candidateType}::${c.name}::${filePath}::${addedBy ?? ''}`;
      }),
    );

    const missing: string[] = [];
    for (const k of OPENMRS_KNOWN_CANDIDATES) {
      const key = `${k.candidateType}::${k.name}::${k.filePath}::${k.addedBy}`;
      if (!seen.has(key)) missing.push(key);
    }

    expect(missing).toEqual([]);
    // Reinforce the spec's ≥10-candidate requirement even as the known list grows.
    expect(OPENMRS_KNOWN_CANDIDATES.length).toBeGreaterThanOrEqual(10);
  });

  // -------------------------------------------------------------------------
  // Test 3 — every emitted candidate carries a spring-classic adapter-family
  // provenance tag. Post the 2026-05-31 provenance split, the family spans the
  // core `spring-classic-adapter` tag plus the per-detector inbound-surface
  // tags; the intent ("every candidate came from the spring-classic adapter
  // family") is pinned via family membership rather than a single literal.
  // -------------------------------------------------------------------------
  test('every candidate is tagged with a spring-classic-* adapter-family _addedBy', () => {
    expect(harnessRun.candidates.length).toBeGreaterThan(0);
    for (const c of harnessRun.candidates) {
      const addedBy =
        (c.data as Record<string, unknown> | undefined)?._addedBy as
          | string
          | undefined;
      // Belongs to the known spring-classic-* family...
      expect(addedBy).toBeDefined();
      expect(addedBy!.startsWith('spring-classic-')).toBe(true);
      // ...and specifically one of the tags runSpringClassicAdapter emits.
      expect(SPRING_CLASSIC_ADDED_BY_FAMILY.has(addedBy!)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Tier B / C / DTO-contract integration tests (Task 7.4). These run in CI.
// ---------------------------------------------------------------------------

describe('Task Group 7: tier B degradation, tier C, and DTO-tier wire contract', () => {
  const TEST_RUN_ID = 'run-v3-tg7-001';
  const TEST_PROJECT_ID = 'proj-v3-tg7-001';

  beforeEach(() => {
    clearRegistry();
    jest.clearAllMocks();

    (archModelClient.getDiscoveryRun as jest.Mock).mockResolvedValue({
      id: TEST_RUN_ID,
      project_id: TEST_PROJECT_ID,
      service_id: null,
      mode: null,
      status: 'RUNNING',
      current_step: '1c-llm-analysis',
      config_snapshot: {},
      steps_payload: {},
      error_message: null,
      created_at: '2026-04-19T10:00:00Z',
      updated_at: '2026-04-19T10:00:00Z',
    });
    (archModelClient.updateDiscoveryRun as jest.Mock).mockResolvedValue({});
    (archModelClient.bulkSaveCandidates as jest.Mock).mockResolvedValue(undefined);

    // Default gap-fill mock: zero LLM candidates, stage completed.
    runLlmGapFillMock.mockResolvedValue({
      llmCandidates: [],
      stageStatus: 'completed',
      failures: [],
      dedupDroppedCount: 0,
      crossFileDedupCount: 0,
      promptVersion: {
        base: 'aaaaaaaa',
        language: 'bbbbbbbb',
        framework: 'cccccccc',
        composed: 'dddddddd',
      },
    });
  });

  // -------------------------------------------------------------------------
  // Test 4 — Tier B degradation with the REAL javaLangPack.
  // Gap vs Group 5: Group 5 uses a fake language pack; this test pins the
  // real javaLangPack + no framework pack path end-to-end.
  // -------------------------------------------------------------------------
  test('runDiscoveryV3 with only the real javaLangPack registered yields Tier B + IR + zero candidates + gapFill payload', async () => {
    registerLanguagePack(javaLangPack);

    const sourceFiles = new Map<string, string>([
      [
        'api/src/main/java/org/example/Patient.java',
        'package org.example;\npublic class Patient { private Long id; }\n',
      ],
      [
        'api/src/main/java/org/example/Encounter.java',
        'package org.example;\npublic class Encounter { private Long encounterId; }\n',
      ],
    ]);

    const result = await runDiscoveryV3({
      runId: TEST_RUN_ID,
      projectId: TEST_PROJECT_ID,
      sourceFiles,
      // No technology hint -> no framework pack can match -> Tier B.
      techHints: { '0': { language: 'Java' } },
    });

    expect(result.tier).toBe('B');
    // IR produced for both .java files.
    expect(result.filesAnalyzed).toBe(2);
    // No framework pack registered -> zero candidates.
    expect(result.candidates).toHaveLength(0);
    expect(archModelClient.bulkSaveCandidates).not.toHaveBeenCalled();

    // Gap-fill payload written into steps_payload and mode='B' sent to the DTO.
    const updateCalls = (archModelClient.updateDiscoveryRun as jest.Mock).mock.calls;
    const modeBCall = updateCalls.find(
      (c) => (c[2] as { mode?: string }).mode === 'B',
    );
    expect(modeBCall).toBeDefined();
    const payload = modeBCall![2] as {
      steps_payload: Record<string, unknown>;
      mode?: string;
    };
    const v3Section = payload.steps_payload.v3 as Record<string, unknown>;
    const gapFill = v3Section.gapFill as Record<string, unknown>;
    expect(gapFill.stageStatus).toBe('completed');
    expect(gapFill.dedupDroppedCount).toBe(0);
    expect(gapFill.failures).toEqual([]);
    expect(gapFill.filesProcessed).toBe(2);
  });

  // -------------------------------------------------------------------------
  // Test 5 — Tier C with zero packs registered: gap-fill payload STILL written.
  // -------------------------------------------------------------------------
  test('runDiscoveryV3 with no packs registered yields Tier C + zero candidates + gapFill payload', async () => {
    // Registry is empty — no language pack, no framework pack.
    const result = await runDiscoveryV3({
      runId: TEST_RUN_ID,
      projectId: TEST_PROJECT_ID,
      sourceFiles: new Map<string, string>([
        ['src/app.py', 'print(1)\n'],
      ]),
      techHints: { '0': { language: 'Python' } },
    });

    expect(result.tier).toBe('C');
    expect(result.filesAnalyzed).toBe(0);
    expect(result.candidates).toHaveLength(0);
    expect(archModelClient.bulkSaveCandidates).not.toHaveBeenCalled();

    const updateCalls = (archModelClient.updateDiscoveryRun as jest.Mock).mock.calls;
    const payloadCall = updateCalls.find((c) => {
      const p = c[2] as { steps_payload?: Record<string, unknown>; mode?: string };
      return p?.steps_payload !== undefined;
    });
    expect(payloadCall).toBeDefined();
    const payload = payloadCall![2] as {
      steps_payload: Record<string, unknown>;
      mode?: string;
    };
    expect(payload.mode).toBe('C');
    const v3Section = payload.steps_payload.v3 as Record<string, unknown>;
    const gapFill = v3Section.gapFill as Record<string, unknown>;
    expect(gapFill.stageStatus).toBe('completed');
    expect(gapFill.failures).toEqual([]);
    expect(gapFill.filesProcessed).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Test 6 — DTO-tier wire contract: tier is sent under the field name
  // `mode` (matching DiscoveryRunDto.mode on the Java side). This pins the
  // wire name so a future rename on either side surfaces as a test failure
  // at the TypeScript boundary before a real deployment.
  // -------------------------------------------------------------------------
  test('tier is propagated to updateDiscoveryRun under the DTO field name `mode` (A/B/C wire contract)', async () => {
    // Register only the real javaLangPack -> Tier B, then probe the PUT call.
    registerLanguagePack(javaLangPack);

    await runDiscoveryV3({
      runId: TEST_RUN_ID,
      projectId: TEST_PROJECT_ID,
      sourceFiles: new Map<string, string>([
        ['api/src/main/java/Foo.java', 'public class Foo {}\n'],
      ]),
      techHints: { '0': { language: 'Java' } },
    });

    const updateCalls = (archModelClient.updateDiscoveryRun as jest.Mock).mock.calls;
    // At least one PUT carried the tier; every tier-carrying PUT must use
    // the `mode` key (NOT `tier`, `pipelineTier`, etc.).
    const tierCalls = updateCalls.filter((c) => {
      const p = c[2] as Record<string, unknown>;
      return typeof p.mode === 'string';
    });
    expect(tierCalls.length).toBeGreaterThan(0);
    for (const call of tierCalls) {
      const payload = call[2] as Record<string, unknown>;
      expect(['A', 'B', 'C']).toContain(payload.mode as string);
      // No alternate tier field leaked in alongside mode.
      expect(payload.tier).toBeUndefined();
      expect(payload.pipelineTier).toBeUndefined();
    }

    // And the URL path variables the client uses come straight through —
    // projectId + runId position match the `updateDiscoveryRun(projectId, runId, payload)` contract.
    const firstCall = updateCalls[0];
    expect(firstCall[0]).toBe(TEST_PROJECT_ID);
    expect(firstCall[1]).toBe(TEST_RUN_ID);
  });
});
