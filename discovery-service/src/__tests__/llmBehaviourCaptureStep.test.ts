/**
 * Tests for the per-method LLM behaviour-capture stage
 * (`services/llmBehaviourCaptureStep.ts`).
 *
 * Spec: 2026-05-29 Business-logic behaviour capture for discovery
 * (Java / Spring Classic first) — Task Group 2.
 *
 * Focused per the discovery test conventions (real Java source through
 * `extractJavaIR`, `gatewayClient` mocked — NO real LLM call). Covers the
 * four critical behaviours:
 *   (a) the DETERMINISTIC selector INCLUDES an endpoint-reachable
 *       non-boilerplate business_logics method and EXCLUDES getters/equals/
 *       trivial one-liners / @Override callbacks, while ALWAYS including
 *       @Transactional methods + custom-exception throwers + on-path methods;
 *   (b) a `source_hash` cache HIT skips the LLM and carries the prior block
 *       forward verbatim on unchanged hash;
 *   (c) the stage parses a well-formed 7-part block into the candidate's
 *       `data.behavior` (keyed by method id) and records stage metrics;
 *   (d) failure-rate gating marks the stage `failed` past the env threshold.
 */

// Mock the gateway client BEFORE importing the module under test so the mock
// is wired before `llmBehaviourCaptureStep` resolves its import.
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

import { gatewayClient } from '../services/gatewayClient';
import { extractJavaIR } from '../services/extensionPacks/languageExtractors/java';
import {
  selectBehaviourCaptureMethods,
  runBehaviourCapture,
  computeSourceHash,
  sliceMethodBody,
  BEHAVIOUR_SCHEMA_VERSION,
  type BehaviourBlock,
} from '../services/llmBehaviourCaptureStep';
import type { SourceFileIR } from '../services/extensionPacks/languageIR';
import type { DiscoveryCandidate } from '../types/candidate';

const captureMock = gatewayClient.captureBehaviour as jest.Mock;

// ---------------------------------------------------------------------------
// Shared Java fixtures: a classic Spring Owner slice with a controller ->
// service -> repository happy path PLUS several boilerplate methods on the
// service so the selector's exclusion/inclusion rules are exercised.
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

  // RULE-BEARING + endpoint-reachable: should be SELECTED.
  @Transactional
  public Owner registerOwner(Owner owner) {
    if (owner.getLastName() == null || owner.getLastName().isEmpty()) {
      throw new InvalidOwnerException("last name required");
    }
    Owner normalized = normalize(owner);
    return ownerRepository.save(normalized);
  }

  // Helper invoked 1-hop from registerOwner.
  private Owner normalize(Owner owner) {
    owner.getLastName();
    return owner;
  }

  // Boilerplate getter-shaped: should be EXCLUDED (not always-include).
  public Owner getOwnerById(Long id) {
    return ownerRepository.findById(id).orElse(null);
  }

  // Trivial one-liner: should be EXCLUDED.
  public int countAll() { return 0; }

  // equals override: should be EXCLUDED.
  @Override
  public boolean equals(Object o) { return super.equals(o); }
}

class InvalidOwnerException extends RuntimeException {
  public InvalidOwnerException(String msg) { super(msg); }
}
`;

const OWNER_CONTROLLER = `
package com.foo.web;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.GetMapping;
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

  @GetMapping("/{id}")
  public Owner read(Long id) {
    return ownerService.getOwnerById(id);
  }
}
`;

function buildIr(): Map<string, SourceFileIR> {
  const files = new Map<string, SourceFileIR>();
  const add = (path: string, src: string) => {
    const parsed = extractJavaIR(path, src);
    if (!parsed) throw new Error(`parse fail for ${path}`);
    files.set(path, parsed);
  };
  add('src/main/java/com/foo/model/Owner.java', OWNER_ENTITY);
  add('src/main/java/com/foo/repo/OwnerRepository.java', OWNER_REPO);
  add('src/main/java/com/foo/service/OwnerService.java', OWNER_SERVICE);
  add('src/main/java/com/foo/web/OwnerController.java', OWNER_CONTROLLER);
  return files;
}

/**
 * Build `business_logics` candidates for EVERY method the spring-classic
 * adapter would emit on `OwnerService` (we model them directly here so the
 * test is independent of the adapter's emission rules — the selector only
 * needs `candidateType` + `data.methodId`).
 */
function buildServiceBusinessLogicCandidates(
  ir: Map<string, SourceFileIR>,
): DiscoveryCandidate[] {
  const file = ir.get('src/main/java/com/foo/service/OwnerService.java')!;
  const cls = file.classes.find((c) => c.name === 'OwnerService')!;
  return cls.methods
    .filter((m) => m.name !== 'OwnerService') // skip the constructor
    .map((m, i) => ({
      id: `cand-${i}-${m.name}`,
      runId: 'run-1',
      candidateType: 'business_logics' as const,
      name: m.name,
      confidence: 0.9,
      status: 'proposed' as const,
      sourceClusterIds: [file.filePath],
      data: {
        className: 'OwnerService',
        returnType: m.returnType,
        parameterCount: m.parameters.length,
        methodId: m.methodId,
        _addedBy: 'spring-classic-adapter',
      },
      synthesizedAt: new Date().toISOString(),
    }));
}

function methodIdByName(ir: Map<string, SourceFileIR>, cls: string, name: string): string {
  for (const f of ir.values()) {
    const c = f.classes.find((x) => x.name === cls);
    const m = c?.methods.find((x) => x.name === name);
    if (m?.methodId) return m.methodId;
  }
  throw new Error(`methodId not found for ${cls}#${name}`);
}

/**
 * The endpoint-reachable method-id set as Spec 1's resolver would produce it
 * for THIS fixture: the controller create() -> ownerService.registerOwner(...)
 * -> ownerRepository.save(...) path. `getOwnerById` is reached only by the
 * `read` GET endpoint whose chain bottoms out at `findById().orElse(null)`
 * (a chained receiver the resolver does not follow), so for the selector test
 * we model reachability as exactly the registerOwner + save hops.
 */
function reachableSet(ir: Map<string, SourceFileIR>): Set<string> {
  return new Set<string>([
    methodIdByName(ir, 'OwnerService', 'registerOwner'),
  ]);
}

function makeResponse(block: Record<string, unknown>): { content: string } {
  return { content: JSON.stringify(block) };
}

const WELL_FORMED_BLOCK = {
  io: { inputs: [{ name: 'owner', type: 'Owner', meaning: 'the owner to register' }], output: { type: 'Owner', meaning: 'persisted owner' } },
  validation: [{ check: 'lastName non-empty', on_failure: 'InvalidOwnerException -> 400' }],
  transformation: 'normalize then save',
  data_effects: 'writes Owner (insert-or-update)',
  side_effects: 'none',
  edge_cases: ['null lastName', 'empty lastName'],
  provenance: { notes: 'service registration method' },
  confidence: 0.66,
};

beforeEach(() => {
  captureMock.mockReset();
  delete process.env.BEHAVIOUR_CAPTURE_CALLEE_CAP;
  delete process.env.BEHAVIOUR_CAPTURE_CONCURRENCY;
  delete process.env.BEHAVIOUR_CAPTURE_MAX_METHODS;
  delete process.env.BEHAVIOUR_CAPTURE_TOKEN_CEILING;
  delete process.env.BEHAVIOUR_CAPTURE_MAX_FAILURE_RATE;
  delete process.env.CONFIDENCE_LLM_BEHAVIOUR_CAPTURE;
});

// ============================================================================
// (a) Deterministic selector
// ============================================================================

describe('selectBehaviourCaptureMethods — deterministic selector', () => {
  it('includes an endpoint-reachable non-boilerplate (@Transactional, custom-throw) method and excludes getters/equals/trivial/@Override', () => {
    const ir = buildIr();
    const candidates = buildServiceBusinessLogicCandidates(ir);
    const endpointReachableMethodIds = reachableSet(ir);

    const selected = selectBehaviourCaptureMethods({
      businessLogicCandidates: candidates,
      irFiles: ir,
      endpointReachableMethodIds,
    });

    const selectedNames = selected.map((s) => s.method.name).sort();
    // registerOwner is reachable + @Transactional + throws InvalidOwnerException.
    expect(selectedNames).toContain('registerOwner');
    // Boilerplate / non-reachable methods are excluded.
    expect(selectedNames).not.toContain('getOwnerById'); // getter-shaped + not reachable
    expect(selectedNames).not.toContain('countAll'); // trivial one-liner
    expect(selectedNames).not.toContain('equals'); // @Override + boilerplate name
    expect(selectedNames).not.toContain('normalize'); // not a business_logics candidate path hop here
  });

  it('drops candidates with no stable methodId and candidates not on an endpoint path', () => {
    const ir = buildIr();
    const candidates = buildServiceBusinessLogicCandidates(ir);
    // Strip methodId from one candidate -> must be dropped (rule i).
    const noId = candidates.find((c) => c.name === 'registerOwner')!;
    (noId.data as Record<string, unknown>).methodId = undefined;

    const selected = selectBehaviourCaptureMethods({
      businessLogicCandidates: candidates,
      irFiles: ir,
      endpointReachableMethodIds: reachableSet(ir),
    });
    expect(selected.find((s) => s.method.name === 'registerOwner')).toBeUndefined();

    // Empty reachable set -> nothing qualifies (rule ii).
    const none = selectBehaviourCaptureMethods({
      businessLogicCandidates: buildServiceBusinessLogicCandidates(ir),
      irFiles: ir,
      endpointReachableMethodIds: new Set<string>(),
    });
    expect(none).toHaveLength(0);
  });
});

// ============================================================================
// source_hash determinism (supports the cache test)
// ============================================================================

describe('computeSourceHash + sliceMethodBody', () => {
  it('produces a stable hash insensitive to comments/formatting but sensitive to token changes', () => {
    const a = computeSourceHash('public int f(){ return 1; }', []);
    const b = computeSourceHash('public int f(){\n   return 1;  // changed comment\n}', []);
    const c = computeSourceHash('public int f(){ return 2; }', []);
    expect(a).toBe(b); // whitespace + comment-only change does not bust the hash
    expect(a).not.toBe(c); // a real token change does
  });

  it('slices a method body by brace-matching and returns null for abstract declarations', () => {
    const src = [
      'class X {',
      '  int a() {',
      '    return 1;',
      '  }',
      '  void b();',
      '}',
    ].join('\n');
    const body = sliceMethodBody(src, 1);
    expect(body).toContain('int a()');
    expect(body).toContain('return 1;');
    // line 4 (0-based) is the abstract `void b();` -> no body.
    expect(sliceMethodBody(src, 4)).toBeNull();
  });
});

// ============================================================================
// (c) Stage parses the 7-part block + records metrics
// ============================================================================

describe('runBehaviourCapture — happy path', () => {
  it('parses a well-formed 7-part block into the candidate data.behavior keyed by method id and records metrics', async () => {
    const ir = buildIr();
    const candidates = buildServiceBusinessLogicCandidates(ir);
    captureMock.mockResolvedValue(makeResponse(WELL_FORMED_BLOCK));

    const out = await runBehaviourCapture({
      runId: 'run-1',
      tier: 'A',
      businessLogicCandidates: candidates,
      irFiles: ir,
      endpointReachableMethodIds: reachableSet(ir),
    });

    expect(out.stageStatus).toBe('completed');
    expect(out.selectedCount).toBe(1);
    expect(out.processed).toBe(1);
    expect(out.cacheHits).toBe(0);
    expect(captureMock).toHaveBeenCalledTimes(1);

    const registerCand = candidates.find((c) => c.name === 'registerOwner')!;
    const block = (registerCand.data as Record<string, unknown>).behavior as BehaviourBlock;
    expect(block).toBeDefined();
    expect(block.schema_version).toBe(BEHAVIOUR_SCHEMA_VERSION);
    expect(block.method_id).toBe(methodIdByName(ir, 'OwnerService', 'registerOwner'));
    expect(typeof block.source_hash).toBe('string');
    // 7-part content survived the parse.
    expect(block.io).toBeDefined();
    expect(block.validation).toBeDefined();
    expect(Array.isArray(block.edge_cases)).toBe(true);
    // Confidence clamped into the llm-behaviour-capture range [0.5, 0.7].
    expect(block.confidence).toBeGreaterThanOrEqual(0.5);
    expect(block.confidence).toBeLessThanOrEqual(0.7);
    expect(block.confidence).toBeCloseTo(0.66, 5);
  });
});

// ============================================================================
// (b) source_hash cache HIT skips the LLM
// ============================================================================

describe('runBehaviourCapture — source_hash caching', () => {
  it('skips the LLM and carries the prior block forward verbatim when the source_hash is unchanged', async () => {
    const ir = buildIr();
    const candidates = buildServiceBusinessLogicCandidates(ir);

    // First, compute the source_hash exactly as the stage would, so we can
    // seed a matching prior block.
    const selected = selectBehaviourCaptureMethods({
      businessLogicCandidates: candidates,
      irFiles: ir,
      endpointReachableMethodIds: reachableSet(ir),
    });
    expect(selected).toHaveLength(1);
    const sel = selected[0];
    const body = sliceMethodBody(sel.sourceCode, sel.method.line)!;
    // The stage feeds 1-hop callee bodies into the hash; for registerOwner the
    // single resolvable same-class callee is `normalize`. Recompute via the
    // same public helpers to stay in lock-step with the stage.
    const calleeBody = sliceMethodBody(sel.sourceCode,
      ir.get('src/main/java/com/foo/service/OwnerService.java')!
        .classes.find((c) => c.name === 'OwnerService')!
        .methods.find((m) => m.name === 'normalize')!.line)!;
    const expectedHash = computeSourceHash(body, [calleeBody]);

    const priorBlock: BehaviourBlock = {
      schema_version: BEHAVIOUR_SCHEMA_VERSION,
      method_id: sel.methodId,
      source_hash: expectedHash,
      confidence: 0.6,
      io: { cached: true },
      transformation: 'CARRIED FORWARD VERBATIM',
    };
    const priorBlocksByMethodId = new Map<string, BehaviourBlock>([[sel.methodId, priorBlock]]);

    const out = await runBehaviourCapture({
      runId: 'run-2',
      tier: 'A',
      businessLogicCandidates: candidates,
      irFiles: ir,
      endpointReachableMethodIds: reachableSet(ir),
      priorBlocksByMethodId,
    });

    // No LLM call on a clean cache hit.
    expect(captureMock).not.toHaveBeenCalled();
    expect(out.cacheHits).toBe(1);
    expect(out.processed).toBe(0);
    expect(out.stageStatus).toBe('completed');

    const registerCand = candidates.find((c) => c.name === 'registerOwner')!;
    const attached = (registerCand.data as Record<string, unknown>).behavior as BehaviourBlock;
    // Carried forward verbatim (same object content, including the marker).
    expect(attached.transformation).toBe('CARRIED FORWARD VERBATIM');
    expect(attached.source_hash).toBe(expectedHash);
  });

  it('does NOT hit the cache when the stored source_hash differs (re-captures)', async () => {
    const ir = buildIr();
    const candidates = buildServiceBusinessLogicCandidates(ir);
    const selected = selectBehaviourCaptureMethods({
      businessLogicCandidates: candidates,
      irFiles: ir,
      endpointReachableMethodIds: reachableSet(ir),
    });
    const sel = selected[0];

    const staleBlock: BehaviourBlock = {
      schema_version: BEHAVIOUR_SCHEMA_VERSION,
      method_id: sel.methodId,
      source_hash: 'STALE-HASH-DOES-NOT-MATCH',
      confidence: 0.6,
    };
    captureMock.mockResolvedValue(makeResponse(WELL_FORMED_BLOCK));

    const out = await runBehaviourCapture({
      runId: 'run-3',
      tier: 'A',
      businessLogicCandidates: candidates,
      irFiles: ir,
      endpointReachableMethodIds: reachableSet(ir),
      priorBlocksByMethodId: new Map([[sel.methodId, staleBlock]]),
    });

    expect(captureMock).toHaveBeenCalledTimes(1);
    expect(out.cacheHits).toBe(0);
    expect(out.processed).toBe(1);
  });
});

// ============================================================================
// (d) failure-rate gating
// ============================================================================

describe('runBehaviourCapture — failure-rate gating', () => {
  it('marks the stage failed when the failure rate exceeds the env threshold', async () => {
    const ir = buildIr();
    const candidates = buildServiceBusinessLogicCandidates(ir);
    // Force every attempted call to fail (non-JSON response -> parse failure).
    captureMock.mockResolvedValue({ content: 'not json at all' });
    process.env.BEHAVIOUR_CAPTURE_MAX_FAILURE_RATE = '0.2';

    const out = await runBehaviourCapture({
      runId: 'run-4',
      tier: 'A',
      businessLogicCandidates: candidates,
      irFiles: ir,
      endpointReachableMethodIds: reachableSet(ir),
    });

    expect(out.failures.length).toBeGreaterThan(0);
    expect(out.stageStatus).toBe('failed');
    // No block attached on a failed parse.
    const registerCand = candidates.find((c) => c.name === 'registerOwner')!;
    expect((registerCand.data as Record<string, unknown>).behavior).toBeUndefined();
  });
});
