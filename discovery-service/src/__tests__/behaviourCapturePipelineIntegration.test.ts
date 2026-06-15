/**
 * End-to-end pipeline integration tests for the behaviour-capture stage
 * (Gap C, Spec 2026-05-29 Business-logic behaviour capture) -- Task Group 4.3.
 *
 * The per-group tests in Group 2 (`llmBehaviourCaptureStep.test.ts`) cover the
 * selector / cache / parse / failure-rate behaviour in ISOLATION, hand-building
 * the endpoint-reachable method-id set and calling `runBehaviourCapture`
 * directly. The per-group pipeline test (`discoveryV3Pipeline.test.ts`) mocks
 * `runLlmGapFill` only and never exercises the behaviour-capture wiring.
 *
 * These cross-cutting tests fill the critical pipeline-integration gaps that no
 * isolated test covers, by driving the REAL `runDiscoveryV3` orchestrator over a
 * REAL parsed Spring slice with the REAL `resolveEndpointDataEffects` resolver +
 * REAL deterministic selector + REAL capture stage. Only the LLM relay
 * (`gatewayClient.captureBehaviour`), the AMS HTTP client, and the unrelated
 * `runLlmGapFill` stage are mocked.
 *
 * Gaps closed here (Task Group 4.2 priorities):
 *  1. selector ∩ Spec-1-reachability INTEGRATION: the reachable-method set the
 *     selector consumes is produced by the real resolver from the real IR (not a
 *     hand-built Set), so a methodId-format drift between `methodIdOf` and the
 *     candidate's `data.methodId` would surface. The selected method's 7-part
 *     block lands on the candidate's `data.behavior` and rides into the Stage 4
 *     persist payload (-> `discovery_candidates.data`).
 *  2. tier-gating wiring: Tier A admits the stage; Tier C is gated OUT (no
 *     LLM call, no `business_logics` block) by `behaviourCaptureTierAdmits`.
 *  3. per-run METHOD cap honoured by the pipeline (BEHAVIOUR_CAPTURE_MAX_METHODS):
 *     two selectable methods + a cap of 1 -> exactly one reaches the LLM.
 *  4. pipeline-level cache-skip: `buildPriorBehaviourBlocks` reads the prior
 *     run's candidates via `archModelClient.getCandidatesByRun`, and an
 *     unchanged `source_hash` carries the prior block forward verbatim end-to-end
 *     with NO LLM call.
 *  5. stage metrics land on `steps_payload.v3.behaviourCapture` ALONGSIDE
 *     `v3.gapFill` via the load-merge-write persistence path.
 */

// Mock dotenv before importing anything so config side-effects don't hit disk.
jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

// Mock the AMS HTTP client -- only the methods the V3 orchestrator + the
// behaviour-capture seam actually call need to exist. `getCandidatesByRun`
// drives the pipeline-level prior-block cache (`buildPriorBehaviourBlocks`).
jest.mock('../services/archModelClient', () => ({
  archModelClient: {
    bulkSaveCandidates: jest.fn(),
    updateDiscoveryRun: jest.fn(),
    getDiscoveryRun: jest.fn(),
    getCandidatesByRun: jest.fn(),
    getProject: jest.fn(),
  },
}));

// Mock the UNRELATED gap-fill stage so the test exercises only the
// behaviour-capture wiring (gap-fill mechanics live in their own suites).
jest.mock('../services/llmGapFillStep', () => ({
  runLlmGapFill: jest.fn(),
}));

// Mock the gateway behaviour-capture relay -- NO real LLM call. The capture
// stage resolves its `gatewayClient` import to this mock.
jest.mock('../services/gatewayClient', () => ({
  gatewayClient: {
    captureBehaviour: jest.fn(),
  },
  BehaviourCaptureGatewayError: class BehaviourCaptureGatewayError extends Error {
    public readonly methodId: string;
    public readonly status: number | null;
    constructor(message: string, methodId: string, status: number | null) {
      super(message);
      this.name = 'BehaviourCaptureGatewayError';
      this.methodId = methodId;
      this.status = status;
    }
  },
}));

import type { DiscoveryCandidate } from '../types/candidate';
import type { SourceFileIR } from '../services/extensionPacks';
import type { LanguagePack, FrameworkPack } from '../services/extensionPacks';
import {
  clearRegistry,
  registerLanguagePack,
  registerFrameworkPack,
} from '../services/extensionPackRegistry';
import { archModelClient } from '../services/archModelClient';
import { runDiscoveryV3 } from '../services/discoveryV3Pipeline';
import { runLlmGapFill } from '../services/llmGapFillStep';
import { gatewayClient } from '../services/gatewayClient';
import { extractJavaIR } from '../services/extensionPacks/languageExtractors/java';
import { BEHAVIOUR_SCHEMA_VERSION } from '../services/llmBehaviourCaptureStep';

const runLlmGapFillMock = runLlmGapFill as jest.Mock;
const captureMock = gatewayClient.captureBehaviour as jest.Mock;

const TEST_RUN_ID = 'run-bc-pipeline-001';
const TEST_PROJECT_ID = 'proj-bc-pipeline-001';

// ---------------------------------------------------------------------------
// A real classic-Spring Owner slice: controller create() -> service
// registerOwner() (@Transactional + custom-exception throw) -> repository
// save(). The real resolver walks this to a non-empty endpoint->data path, so
// `OwnerService#registerOwner(Owner)` is endpoint-reachable and the selector
// admits it. Boilerplate methods on the service exercise the exclusion path.
// ---------------------------------------------------------------------------

const OWNER_ENTITY = `
package com.foo.model;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import jakarta.persistence.Id;

@Entity
@Table(name = "owners")
public class Owner {
  @Id
  private Long id;
  private String lastName;
  public Long getId() { return id; }
  public String getLastName() { return lastName; }
}
`;

const OWNER_REPO = `
package com.foo.repo;
import org.springframework.data.jpa.repository.JpaRepository;
import com.foo.model.Owner;

public interface OwnerRepository extends JpaRepository<Owner, Long> {
}
`;

const OWNER_SERVICE = `
package com.foo.service;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import com.foo.repo.OwnerRepository;
import com.foo.model.Owner;

@Service
public class OwnerService {
  private final OwnerRepository ownerRepository;
  public OwnerService(OwnerRepository ownerRepository) {
    this.ownerRepository = ownerRepository;
  }

  // Endpoint-reachable + @Transactional + throws a custom exception -> SELECTED.
  @Transactional
  public Owner registerOwner(Owner owner) {
    if (owner.getLastName() == null || owner.getLastName().isEmpty()) {
      throw new InvalidOwnerException("last name required");
    }
    Owner normalized = normalize(owner);
    return ownerRepository.save(normalized);
  }

  private Owner normalize(Owner owner) {
    owner.getLastName();
    return owner;
  }

  // Getter-shaped boilerplate, not reachable -> EXCLUDED.
  public Owner getOwnerById(Long id) {
    return ownerRepository.findById(id).orElse(null);
  }

  // Trivial one-liner -> EXCLUDED.
  public int countAll() { return 0; }
}

class InvalidOwnerException extends RuntimeException {
  public InvalidOwnerException(String msg) { super(msg); }
}
`;

const OWNER_CONTROLLER = `
package com.foo.web;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import com.foo.service.OwnerService;
import com.foo.model.Owner;

@RestController
@RequestMapping("/owners")
public class OwnerController {
  private final OwnerService ownerService;
  public OwnerController(OwnerService ownerService) {
    this.ownerService = ownerService;
  }

  @PostMapping
  public Owner create(Owner owner) {
    return ownerService.registerOwner(owner);
  }
}
`;

const SPRING_SOURCE_FILES = new Map<string, string>([
  ['src/main/java/com/foo/model/Owner.java', OWNER_ENTITY],
  ['src/main/java/com/foo/repo/OwnerRepository.java', OWNER_REPO],
  ['src/main/java/com/foo/service/OwnerService.java', OWNER_SERVICE],
  ['src/main/java/com/foo/web/OwnerController.java', OWNER_CONTROLLER],
]);

const REGISTER_METHOD_ID = 'com.foo.service.OwnerService#registerOwner(Owner)';

const WELL_FORMED_BLOCK = {
  io: {
    inputs: [{ name: 'owner', type: 'Owner', meaning: 'the owner to register' }],
    output: { type: 'Owner', meaning: 'persisted owner' },
  },
  validation: [{ check: 'lastName non-empty', on_failure: 'InvalidOwnerException -> 400' }],
  transformation: 'normalize then save',
  data_effects: 'writes Owner (insert-or-update)',
  side_effects: 'none',
  edge_cases: ['null lastName', 'empty lastName'],
  provenance: { method_id: REGISTER_METHOD_ID },
  confidence: 0.62,
};

// ---------------------------------------------------------------------------
// A TWO-endpoint variant for the per-run method-cap test: POST /owners ->
// registerOwner and PUT /owners -> updateOwner, both @Transactional +
// custom-exception throwers, so the REAL resolver makes BOTH service methods
// endpoint-reachable and the selector admits TWO methods. With the cap set to
// 1, exactly ONE must reach the LLM (the other is skipped) -- so the cap
// genuinely bounds LLM calls BELOW the selected count.
// ---------------------------------------------------------------------------

const OWNER_SERVICE_TWO = `
package com.foo.service;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import com.foo.repo.OwnerRepository;
import com.foo.model.Owner;

@Service
public class OwnerService {
  private final OwnerRepository ownerRepository;
  public OwnerService(OwnerRepository ownerRepository) {
    this.ownerRepository = ownerRepository;
  }

  @Transactional
  public Owner registerOwner(Owner owner) {
    if (owner.getLastName() == null) {
      throw new InvalidOwnerException("last name required");
    }
    return ownerRepository.save(owner);
  }

  @Transactional
  public Owner updateOwner(Owner owner) {
    if (owner.getLastName() == null) {
      throw new InvalidOwnerException("last name required");
    }
    return ownerRepository.save(owner);
  }
}

class InvalidOwnerException extends RuntimeException {
  public InvalidOwnerException(String msg) { super(msg); }
}
`;

const OWNER_CONTROLLER_TWO = `
package com.foo.web;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import com.foo.service.OwnerService;
import com.foo.model.Owner;

@RestController
@RequestMapping("/owners")
public class OwnerController {
  private final OwnerService ownerService;
  public OwnerController(OwnerService ownerService) {
    this.ownerService = ownerService;
  }

  @PostMapping
  public Owner create(Owner owner) {
    return ownerService.registerOwner(owner);
  }

  @PutMapping
  public Owner update(Owner owner) {
    return ownerService.updateOwner(owner);
  }
}
`;

const SPRING_SOURCE_FILES_TWO = new Map<string, string>([
  ['src/main/java/com/foo/model/Owner.java', OWNER_ENTITY],
  ['src/main/java/com/foo/repo/OwnerRepository.java', OWNER_REPO],
  ['src/main/java/com/foo/service/OwnerService.java', OWNER_SERVICE_TWO],
  ['src/main/java/com/foo/web/OwnerController.java', OWNER_CONTROLLER_TWO],
]);

const UPDATE_METHOD_ID = 'com.foo.service.OwnerService#updateOwner(Owner)';

/**
 * A LanguagePack that runs the REAL `extractJavaIR` so the resolver walks a
 * genuine call graph. Keeps the test independent of the production lang-pack's
 * `when`-matching internals while still feeding real IR through the pipeline.
 */
function realJavaLanguagePack(): LanguagePack {
  return {
    id: 'java-lang-real-extract',
    when: { language: 'Java' },
    extract: (sourceFiles): Map<string, SourceFileIR> => {
      const out = new Map<string, SourceFileIR>();
      for (const [filePath, src] of sourceFiles.entries()) {
        const ir = extractJavaIR(filePath, src);
        if (ir) out.set(filePath, ir);
      }
      return out;
    },
  };
}

/**
 * A FrameworkPack that emits the EXISTING `business_logics` candidate shape
 * (className / returnType / parameterCount / methodId / _addedBy) for each
 * concrete method on `OwnerService`, keyed by the REAL stable method id from
 * the parsed IR. No new candidate type -- exactly what the spring-classic
 * adapter stamps. This keeps emission deterministic while the resolver +
 * selector + capture stage all run for real.
 */
function businessLogicEmittingFrameworkPack(): FrameworkPack {
  return {
    id: 'spring-classic',
    when: { language: 'Java', technology: 'Spring' },
    adapt: (irFiles, runId): DiscoveryCandidate[] => {
      const svc = irFiles.get('src/main/java/com/foo/service/OwnerService.java');
      const cls = svc?.classes.find((c) => c.name === 'OwnerService');
      if (!cls) return [];
      return cls.methods
        .filter((m) => m.name !== 'OwnerService' && m.methodId)
        .map((m, i) => ({
          id: `bl-cand-${i}-${m.name}`,
          runId,
          candidateType: 'business_logics' as const,
          name: m.name,
          confidence: 0.9,
          status: 'proposed' as const,
          sourceClusterIds: ['src/main/java/com/foo/service/OwnerService.java'],
          data: {
            className: 'OwnerService',
            returnType: m.returnType,
            parameterCount: m.parameters.length,
            methodId: m.methodId,
            _addedBy: 'spring-classic-adapter',
          },
          synthesizedAt: new Date().toISOString(),
        }));
    },
  };
}

function emptyRunRow() {
  return {
    id: TEST_RUN_ID,
    project_id: TEST_PROJECT_ID,
    service_id: null,
    mode: null,
    status: 'RUNNING',
    current_step: '1c-llm-analysis',
    config_snapshot: {},
    steps_payload: {},
    error_message: null,
    architecture_id: null,
    created_at: '2026-05-29T10:00:00Z',
    updated_at: '2026-05-29T10:00:00Z',
  };
}

function lastUpdateWithBehaviourCapture(): Record<string, unknown> | undefined {
  const calls = (archModelClient.updateDiscoveryRun as jest.Mock).mock.calls;
  // Walk newest-first so the most recent persisted payload carrying the
  // behaviourCapture key wins.
  for (let i = calls.length - 1; i >= 0; i -= 1) {
    const payload = calls[i][2] as { steps_payload?: Record<string, unknown> };
    const v3 = payload?.steps_payload?.v3 as Record<string, unknown> | undefined;
    if (v3?.behaviourCapture !== undefined) {
      return v3.behaviourCapture as Record<string, unknown>;
    }
  }
  return undefined;
}

beforeEach(() => {
  clearRegistry();
  jest.clearAllMocks();
  delete process.env.BEHAVIOUR_CAPTURE_MAX_METHODS;
  delete process.env.BEHAVIOUR_CAPTURE_TIERS;
  delete process.env.BEHAVIOUR_CAPTURE_CONCURRENCY;
  delete process.env.CONFIDENCE_LLM_BEHAVIOUR_CAPTURE;

  (archModelClient.getDiscoveryRun as jest.Mock).mockResolvedValue(emptyRunRow());
  (archModelClient.updateDiscoveryRun as jest.Mock).mockResolvedValue({});
  (archModelClient.bulkSaveCandidates as jest.Mock).mockResolvedValue(undefined);
  (archModelClient.getCandidatesByRun as jest.Mock).mockResolvedValue([]);
  (archModelClient.getProject as jest.Mock).mockResolvedValue(null);

  runLlmGapFillMock.mockResolvedValue({
    llmCandidates: [],
    stageStatus: 'completed',
    failures: [],
    dedupDroppedCount: 0,
    crossFileDedupCount: 0,
    promptVersion: { base: 'a', language: 'b', framework: 'c', composed: 'd' },
  });
});

// ============================================================================
// Gap 1 + 5: selector ∩ real-resolver integration; block flows to persist;
// metrics land on steps_payload.v3.behaviourCapture alongside v3.gapFill.
// ============================================================================

describe('behaviour-capture pipeline integration (Tier A)', () => {
  it('selects the endpoint-reachable rule-bearing method via the REAL resolver, attaches the 7-part block to the candidate, and persists v3.behaviourCapture metrics', async () => {
    registerLanguagePack(realJavaLanguagePack());
    registerFrameworkPack(businessLogicEmittingFrameworkPack());
    captureMock.mockResolvedValue({ content: JSON.stringify(WELL_FORMED_BLOCK) });

    const result = await runDiscoveryV3({
      runId: TEST_RUN_ID,
      projectId: TEST_PROJECT_ID,
      sourceFiles: SPRING_SOURCE_FILES,
      techHints: { '0': { language: 'Java' }, '1': { technology: 'Spring' } },
    });

    expect(result.tier).toBe('A');

    // Exactly ONE method was sent to the LLM relay: the selector (fed by the
    // REAL resolver's reachable set) admitted only `registerOwner`. The
    // getter-shaped / trivial / unreachable service methods were excluded.
    expect(captureMock).toHaveBeenCalledTimes(1);
    const [, calledMethodId] = captureMock.mock.calls[0];
    expect(calledMethodId).toBe(REGISTER_METHOD_ID);

    // The 7-part block landed on the EXISTING business_logics candidate's
    // data.behavior (no new candidate type), keyed by the stable method id, and
    // rides the merged result into Stage 4 persist (-> discovery_candidates.data).
    const registerCand = result.candidates.find(
      (c) => c.candidateType === 'business_logics' && c.name === 'registerOwner',
    );
    expect(registerCand).toBeDefined();
    const block = (registerCand!.data as Record<string, unknown>).behavior as Record<string, unknown>;
    expect(block).toBeDefined();
    expect(block.schema_version).toBe(BEHAVIOUR_SCHEMA_VERSION);
    expect(block.method_id).toBe(REGISTER_METHOD_ID);
    expect(typeof block.source_hash).toBe('string');
    expect(block.io).toBeDefined();
    expect(Array.isArray(block.edge_cases)).toBe(true);

    // The persisted candidate batch carries the same in-place block (the stage
    // mutates the candidate that flows into bulkSaveCandidates).
    const saveCalls = (archModelClient.bulkSaveCandidates as jest.Mock).mock.calls;
    const persisted = saveCalls
      .flatMap((c) => c[2] as DiscoveryCandidate[])
      .find((c) => c.candidateType === 'business_logics' && c.name === 'registerOwner');
    expect(persisted).toBeDefined();
    expect((persisted!.data as Record<string, unknown>).behavior).toBeDefined();

    // Metrics land on steps_payload.v3.behaviourCapture ALONGSIDE v3.gapFill.
    const metrics = lastUpdateWithBehaviourCapture();
    expect(metrics).toBeDefined();
    expect(metrics!.stageStatus).toBe('completed');
    expect(metrics!.selectedCount).toBe(1);
    expect(metrics!.processed).toBe(1);
    expect(metrics!.cacheHits).toBe(0);
  });

  // ==========================================================================
  // Gap 3: per-run METHOD cap honoured by the pipeline wiring. Two reachable
  // rule-bearing methods are selected; the cap of 1 must bound the LLM calls
  // to exactly one (the other is skipped, not failed).
  // ==========================================================================
  it('honours the per-run BEHAVIOUR_CAPTURE_MAX_METHODS cap: 2 selected, cap 1 -> exactly one LLM call', async () => {
    process.env.BEHAVIOUR_CAPTURE_MAX_METHODS = '1';
    // Concurrency 1 makes the order of LLM dispatch deterministic, but the
    // assertion is on COUNTS so it holds regardless.
    process.env.BEHAVIOUR_CAPTURE_CONCURRENCY = '1';
    registerLanguagePack(realJavaLanguagePack());
    registerFrameworkPack(businessLogicEmittingFrameworkPack());
    captureMock.mockResolvedValue({ content: JSON.stringify(WELL_FORMED_BLOCK) });

    const result = await runDiscoveryV3({
      runId: TEST_RUN_ID,
      projectId: TEST_PROJECT_ID,
      sourceFiles: SPRING_SOURCE_FILES_TWO,
      techHints: { '0': { language: 'Java' }, '1': { technology: 'Spring' } },
    });

    expect(result.tier).toBe('A');

    // The selector admitted BOTH registerOwner + updateOwner (both reachable +
    // @Transactional + custom-throw), but the per-run cap of 1 bounded the LLM
    // calls to exactly ONE.
    expect(captureMock).toHaveBeenCalledTimes(1);
    const calledMethodIds = captureMock.mock.calls.map((c) => c[1] as string);
    expect([REGISTER_METHOD_ID, UPDATE_METHOD_ID]).toContain(calledMethodIds[0]);

    // Exactly one of the two business_logics candidates got a block; the other
    // was skipped by the cap (no block).
    const blsWithBlock = result.candidates.filter(
      (c) =>
        c.candidateType === 'business_logics' &&
        (c.data as Record<string, unknown>).behavior !== undefined,
    );
    expect(blsWithBlock).toHaveLength(1);

    // Metrics reflect the cap: 2 selected, 1 processed, 1 skipped.
    const metrics = lastUpdateWithBehaviourCapture();
    expect(metrics).toBeDefined();
    expect(metrics!.selectedCount).toBe(2);
    expect(metrics!.processed).toBe(1);
    expect(metrics!.skipped).toBe(1);
  });
});

// ============================================================================
// Gap 2: tier-gating wiring -- Tier C is gated OUT.
// ============================================================================

describe('behaviour-capture pipeline tier gating', () => {
  it('does NOT run behaviour capture on Tier C (no pack match): no LLM call, no behaviourCapture metrics', async () => {
    // No packs registered -> Tier C. Python-only source so nothing matches.
    captureMock.mockResolvedValue({ content: JSON.stringify(WELL_FORMED_BLOCK) });

    const result = await runDiscoveryV3({
      runId: TEST_RUN_ID,
      projectId: TEST_PROJECT_ID,
      sourceFiles: new Map([['src/app.py', 'print(1)']]),
      techHints: { '0': { language: 'Python' } },
    });

    expect(result.tier).toBe('C');
    // Tier C is gated out by behaviourCaptureTierAdmits -> no relay call.
    expect(captureMock).not.toHaveBeenCalled();
    // No behaviourCapture metrics were persisted (the stage never ran).
    expect(lastUpdateWithBehaviourCapture()).toBeUndefined();
  });
});

// ============================================================================
// Gap 4: pipeline-level cache-skip carries an unchanged block forward verbatim
// via the REAL getCandidatesByRun -> buildPriorBehaviourBlocks seam.
// ============================================================================

describe('behaviour-capture pipeline source_hash cache-skip', () => {
  it('carries the prior block forward verbatim (NO LLM call) when getCandidatesByRun returns an unchanged source_hash', async () => {
    registerLanguagePack(realJavaLanguagePack());
    registerFrameworkPack(businessLogicEmittingFrameworkPack());

    // FIRST PASS: cold cache (getCandidatesByRun -> []), the stage calls the LLM
    // and produces a block. We capture its real source_hash to seed the prior
    // block for the second pass (so the hashes match end-to-end).
    captureMock.mockResolvedValue({ content: JSON.stringify(WELL_FORMED_BLOCK) });
    const firstResult = await runDiscoveryV3({
      runId: TEST_RUN_ID,
      projectId: TEST_PROJECT_ID,
      sourceFiles: SPRING_SOURCE_FILES,
      techHints: { '0': { language: 'Java' }, '1': { technology: 'Spring' } },
    });
    const firstBlock = (firstResult.candidates.find((c) => c.name === 'registerOwner')!
      .data as Record<string, unknown>).behavior as Record<string, unknown>;
    const realSourceHash = firstBlock.source_hash as string;
    expect(typeof realSourceHash).toBe('string');
    expect(captureMock).toHaveBeenCalledTimes(1);

    // SECOND PASS: warm cache. getCandidatesByRun returns the prior business_logics
    // candidate carrying a behavior block whose source_hash equals the unchanged
    // method's real hash -> the stage MUST skip the LLM and carry it forward.
    jest.clearAllMocks();
    (archModelClient.getDiscoveryRun as jest.Mock).mockResolvedValue(emptyRunRow());
    (archModelClient.updateDiscoveryRun as jest.Mock).mockResolvedValue({});
    (archModelClient.bulkSaveCandidates as jest.Mock).mockResolvedValue(undefined);
    (archModelClient.getProject as jest.Mock).mockResolvedValue(null);
    runLlmGapFillMock.mockResolvedValue({
      llmCandidates: [],
      stageStatus: 'completed',
      failures: [],
      dedupDroppedCount: 0,
      crossFileDedupCount: 0,
      promptVersion: { base: 'a', language: 'b', framework: 'c', composed: 'd' },
    });

    const priorBlock = {
      ...WELL_FORMED_BLOCK,
      schema_version: BEHAVIOUR_SCHEMA_VERSION,
      method_id: REGISTER_METHOD_ID,
      source_hash: realSourceHash,
      transformation: 'CARRIED FORWARD VERBATIM',
      confidence: 0.6,
    };
    (archModelClient.getCandidatesByRun as jest.Mock).mockResolvedValue([
      {
        id: 'prior-bl-register',
        runId: TEST_RUN_ID,
        candidateType: 'business_logics',
        name: 'registerOwner',
        confidence: 0.9,
        status: 'proposed',
        sourceClusterIds: ['src/main/java/com/foo/service/OwnerService.java'],
        data: { methodId: REGISTER_METHOD_ID, behavior: priorBlock },
        synthesizedAt: '2026-05-29T09:00:00Z',
      },
    ]);

    const secondResult = await runDiscoveryV3({
      runId: TEST_RUN_ID,
      projectId: TEST_PROJECT_ID,
      sourceFiles: SPRING_SOURCE_FILES,
      techHints: { '0': { language: 'Java' }, '1': { technology: 'Spring' } },
    });

    // Cache HIT end-to-end: the LLM relay was NOT called this pass.
    expect(captureMock).not.toHaveBeenCalled();
    // The prior block was carried forward verbatim onto the fresh candidate.
    const carried = (secondResult.candidates.find((c) => c.name === 'registerOwner')!
      .data as Record<string, unknown>).behavior as Record<string, unknown>;
    expect(carried.transformation).toBe('CARRIED FORWARD VERBATIM');
    expect(carried.source_hash).toBe(realSourceHash);

    // The metrics record the cache hit (processed via the LLM = 0).
    const metrics = lastUpdateWithBehaviourCapture();
    expect(metrics).toBeDefined();
    expect(metrics!.cacheHits).toBe(1);
    expect(metrics!.processed).toBe(0);
  });
});
