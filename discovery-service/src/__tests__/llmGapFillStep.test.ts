/**
 * Tests for the V3 LLM gap-fill stage (`services/llmGapFillStep.ts`).
 *
 * Spec 2026-04-19: V3 Layered Prompt System — Task Group 4.
 *
 * Covers:
 *  1. Happy path: compose -> gateway call -> parse -> dedup -> emit.
 *  2. Skip heuristic: pack >=N AND zero signals -> LLM call skipped.
 *  3. Skip heuristic override: signal present (RestTemplate import) -> LLM
 *     call even when pack produced >=N candidates.
 *  4. Tier-based `_addedBy` tagging (A/B/C).
 *  5. Per-file failure: non-JSON response -> entry on `failures[]`, zero
 *     candidates for that file, run continues.
 *  6. Stage-failed threshold: failure rate > GAP_FILL_MAX_FAILURE_RATE
 *     marks stage failed.
 *  7. Unclassifiable Tier-C files get LLM calls (NOT skipped) because
 *     pack output is empty.
 */

// Mock the gateway client before importing the module under test so the
// mock is wired before `llmGapFillStep` resolves its import.
jest.mock('../services/gatewayClient', () => ({
  gatewayClient: {
    gapFill: jest.fn(),
  },
  GapFillGatewayError: class GapFillGatewayError extends Error {
    public readonly filePath: string;
    public readonly status: number | null;
    constructor(message: string, filePath: string, status: number | null) {
      super(message);
      this.name = 'GapFillGatewayError';
      this.filePath = filePath;
      this.status = status;
    }
  },
}));

import { gatewayClient } from '../services/gatewayClient';
import { runLlmGapFill, GapFillStepInput } from '../services/llmGapFillStep';

// Typed access to the jest mock for ergonomic assertions.
const gapFillMock = gatewayClient.gapFill as jest.Mock;

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function makeLlmResponse(items: unknown[]): { content: string } {
  return { content: JSON.stringify(items) };
}

function baseFile(overrides: Partial<GapFillStepInput['files'][number]> = {}): GapFillStepInput['files'][number] {
  return {
    filePath: 'src/main/java/Example.java',
    sourceCode: 'class Example {}',
    tier: 'A',
    language: 'java',
    frameworkPackId: 'spring-classic',
    packCandidates: [],
    ir: null,
    ...overrides,
  };
}

beforeEach(() => {
  gapFillMock.mockReset();
  // Clear env overrides between tests so defaults apply.
  delete process.env.GAP_FILL_SKIP_THRESHOLD;
  delete process.env.GAP_FILL_CONCURRENCY;
  delete process.env.GAP_FILL_MAX_FAILURE_RATE;
  delete process.env.GAP_FILL_SKIP_SIGNALS;
});

// ============================================================================
// Test 1: Happy path
// ============================================================================
describe('runLlmGapFill — happy path', () => {
  it('composes, calls gateway, parses response, dedups, and emits candidates', async () => {
    gapFillMock.mockResolvedValueOnce(
      makeLlmResponse([
        {
          type: 'class',
          name: 'PatientDao',
          filePath: 'src/main/java/PatientDao.java',
          confidence: 0.8,
          description: 'Data-access object',
        },
        // This one duplicates a pack candidate and must be dedup-dropped.
        {
          type: 'service',
          name: 'Patient Service',
          filePath: 'src/main/java/PatientService.java',
          confidence: 0.7,
        },
      ]),
    );

    const input: GapFillStepInput = {
      runId: 'run-1',
      files: [
        baseFile({
          filePath: 'src/main/java/PatientService.java',
          sourceCode: 'class PatientService {}',
          // One pack candidate — below skip threshold, so LLM is called.
          packCandidates: [
            {
              candidateType: 'service',
              name: 'patient-service',
              sourceClusterIds: ['src/main/java/PatientService.java'],
            } as any,
          ],
        }),
      ],
    };

    const result = await runLlmGapFill(input);

    expect(gapFillMock).toHaveBeenCalledTimes(1);
    // The composed prompt (arg 0) should have been passed through.
    expect(typeof gapFillMock.mock.calls[0][0]).toBe('string');
    // filePath (arg 1) and runId (arg 2) forwarded correctly.
    expect(gapFillMock.mock.calls[0][1]).toBe('src/main/java/PatientService.java');
    expect(gapFillMock.mock.calls[0][2]).toBe('run-1');

    // Dedup dropped the PatientService candidate (overlaps pack output).
    expect(result.dedupDroppedCount).toBe(1);
    // Remaining surviving candidate is the PatientDao one.
    expect(result.llmCandidates).toHaveLength(1);
    expect(result.llmCandidates[0].name).toBe('PatientDao');
    // Stage-injected fields land on every surviving candidate.
    expect((result.llmCandidates[0] as any)._addedBy).toBe('llm-gap-fill');
    expect(result.llmCandidates[0].sourceClusterIds).toEqual([]);
    expect((result.llmCandidates[0] as any).discoveryRunId).toBe('run-1');
    // Optional LLM field passes through.
    expect((result.llmCandidates[0] as any).description).toBe('Data-access object');

    expect(result.stageStatus).toBe('completed');
    expect(result.failures).toEqual([]);
    // promptVersion surfaces the composer output.
    expect(result.promptVersion.base).toHaveLength(8);
    expect(result.promptVersion.composed).toHaveLength(8);
  });
});

// ============================================================================
// Test 2: Skip heuristic — ≥N AND no signals skips the LLM call
// ============================================================================
describe('runLlmGapFill — skip heuristic', () => {
  it('skips the LLM call when pack produced >=N candidates and no signals trip', async () => {
    // Threshold default is 3 — provide 3 pack candidates, short clean source.
    const input: GapFillStepInput = {
      runId: 'run-skip',
      files: [
        baseFile({
          filePath: 'src/main/java/Clean.java',
          sourceCode: 'package foo;\nclass Clean {}\n',
          packCandidates: [
            { candidateType: 'service', name: 'A', sourceClusterIds: ['src/main/java/Clean.java'] } as any,
            { candidateType: 'service', name: 'B', sourceClusterIds: ['src/main/java/Clean.java'] } as any,
            { candidateType: 'service', name: 'C', sourceClusterIds: ['src/main/java/Clean.java'] } as any,
          ],
        }),
      ],
    };

    const result = await runLlmGapFill(input);

    expect(gapFillMock).not.toHaveBeenCalled();
    expect(result.llmCandidates).toEqual([]);
    expect(result.stageStatus).toBe('completed');
    expect(result.failures).toEqual([]);
  });

  // ==========================================================================
  // Test 3: Skip override — a signal (RestTemplate import) forces the LLM call
  // ==========================================================================
  it('calls the LLM even when >=N pack candidates if a signal trips (RestTemplate import)', async () => {
    gapFillMock.mockResolvedValueOnce(
      makeLlmResponse([
        {
          type: 'interfaces',
          name: 'InventoryClient',
          filePath: 'src/main/java/OrderService.java',
          confidence: 0.75,
        },
      ]),
    );

    const input: GapFillStepInput = {
      runId: 'run-signal',
      files: [
        baseFile({
          filePath: 'src/main/java/OrderService.java',
          sourceCode:
            'package foo;\nimport org.springframework.web.client.RestTemplate;\nclass OrderService {}\n',
          packCandidates: [
            { candidateType: 'service', name: 'A', sourceClusterIds: ['src/main/java/OrderService.java'] } as any,
            { candidateType: 'service', name: 'B', sourceClusterIds: ['src/main/java/OrderService.java'] } as any,
            { candidateType: 'service', name: 'C', sourceClusterIds: ['src/main/java/OrderService.java'] } as any,
          ],
        }),
      ],
    };

    const result = await runLlmGapFill(input);

    expect(gapFillMock).toHaveBeenCalledTimes(1);
    expect(result.llmCandidates).toHaveLength(1);
    expect(result.llmCandidates[0].name).toBe('InventoryClient');
    expect(result.stageStatus).toBe('completed');
  });
});

// ============================================================================
// Test 4: Tier-based `_addedBy` tagging
// ============================================================================
describe('runLlmGapFill — tier-based _addedBy tagging', () => {
  it('tags candidates per tier: A -> llm-gap-fill, B -> llm-ir-guided, C -> llm-solo', async () => {
    // Three files, three tiers. One LLM candidate per file.
    gapFillMock.mockImplementation(async (_prompt: string, filePath: string) => {
      return makeLlmResponse([
        {
          type: 'class',
          name: `Synth_${filePath}`,
          filePath,
          confidence: 0.6,
        },
      ]);
    });

    const input: GapFillStepInput = {
      runId: 'run-tiers',
      files: [
        baseFile({
          filePath: 'a.java',
          tier: 'A',
          language: 'java',
          frameworkPackId: 'spring-classic',
          packCandidates: [],
        }),
        baseFile({
          filePath: 'b.java',
          tier: 'B',
          language: 'java',
          frameworkPackId: null,
          ir: { classes: [], methods: [], imports: [] },
          packCandidates: [],
        }),
        baseFile({
          filePath: 'c.txt',
          tier: 'C',
          language: null,
          frameworkPackId: null,
          ir: null,
          packCandidates: [],
        }),
      ],
    };

    const result = await runLlmGapFill(input);

    expect(gapFillMock).toHaveBeenCalledTimes(3);
    const byPath = new Map(result.llmCandidates.map((c) => [c.sourceClusterIds.length === 0 ? (c as any).originalFilePath ?? c.name : c.name, c]));
    // The `_addedBy` tag varies by tier; find candidates by the synthesized name.
    const aCand = result.llmCandidates.find((c) => c.name === 'Synth_a.java');
    const bCand = result.llmCandidates.find((c) => c.name === 'Synth_b.java');
    const cCand = result.llmCandidates.find((c) => c.name === 'Synth_c.txt');

    expect(aCand).toBeDefined();
    expect(bCand).toBeDefined();
    expect(cCand).toBeDefined();

    expect((aCand as any)._addedBy).toBe('llm-gap-fill');
    expect((bCand as any)._addedBy).toBe('llm-ir-guided');
    expect((cCand as any)._addedBy).toBe('llm-solo');
  });
});

// ============================================================================
// Test 5: Per-file failure (non-JSON) recorded on failures[] and run continues
// ============================================================================
describe('runLlmGapFill — per-file failure handling', () => {
  it('records non-JSON responses on failures[] with zero candidates and continues remaining files', async () => {
    gapFillMock.mockImplementation(async (_prompt: string, filePath: string) => {
      if (filePath === 'bad.java') {
        return { content: 'this is not JSON' };
      }
      return makeLlmResponse([
        { type: 'class', name: 'Ok', filePath, confidence: 0.8 },
      ]);
    });

    const input: GapFillStepInput = {
      runId: 'run-fail',
      files: [
        baseFile({ filePath: 'bad.java', packCandidates: [] }),
        baseFile({ filePath: 'good.java', packCandidates: [] }),
      ],
    };

    const result = await runLlmGapFill(input);

    expect(gapFillMock).toHaveBeenCalledTimes(2);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].filePath).toBe('bad.java');
    expect(result.failures[0].error).toMatch(/JSON|parse/i);
    // Only the good.java candidate survives.
    expect(result.llmCandidates).toHaveLength(1);
    expect(result.llmCandidates[0].name).toBe('Ok');
    // 1/2 = 50% failure rate > default 20%, so stage fails.
    expect(result.stageStatus).toBe('failed');
  });

  // ==========================================================================
  // Test 6: Stage-failed threshold — >20% failure rate marks stage failed
  // ==========================================================================
  it('leaves stage completed when failure rate is at or below GAP_FILL_MAX_FAILURE_RATE', async () => {
    // 1 failure out of 10 = 10%, under the 20% default.
    gapFillMock.mockImplementation(async (_prompt: string, filePath: string) => {
      if (filePath === 'src/bad.java') return { content: '{not valid json' };
      return makeLlmResponse([
        { type: 'class', name: `ok-${filePath}`, filePath, confidence: 0.6 },
      ]);
    });

    const files: GapFillStepInput['files'] = [];
    for (let i = 0; i < 9; i += 1) {
      files.push(baseFile({ filePath: `src/ok-${i}.java`, packCandidates: [] }));
    }
    files.push(baseFile({ filePath: 'src/bad.java', packCandidates: [] }));

    const result = await runLlmGapFill({ runId: 'run-threshold', files });

    expect(result.failures).toHaveLength(1);
    expect(result.llmCandidates).toHaveLength(9);
    expect(result.stageStatus).toBe('completed');
  });
});

// ============================================================================
// Test 7: Unclassifiable files (Tier C) still get LLM calls (NOT skipped)
// ============================================================================
describe('runLlmGapFill — unclassifiable files route through Tier C', () => {
  it('calls the LLM for Tier C files with empty pack output (NOT skipped)', async () => {
    gapFillMock.mockResolvedValueOnce(
      makeLlmResponse([
        {
          type: 'business_logics',
          name: 'mysteryRule',
          filePath: 'scripts/legacy.pl',
          confidence: 0.4,
          // 2026-04-25: structured-metadata gate now requires `className`
          // on business_logics. Tier-C surface still must populate this
          // for a row to survive — Tier C is "we don't know the framework",
          // not "we don't know the class".
          className: 'LegacyScript',
        },
      ]),
    );

    const input: GapFillStepInput = {
      runId: 'run-tierc',
      files: [
        {
          filePath: 'scripts/legacy.pl',
          sourceCode: '#!/usr/bin/perl\nprint "hi";\n',
          tier: 'C',
          language: null,
          frameworkPackId: null,
          packCandidates: [],
          ir: null,
        },
      ],
    };

    const result = await runLlmGapFill(input);

    expect(gapFillMock).toHaveBeenCalledTimes(1);
    expect(result.llmCandidates).toHaveLength(1);
    expect((result.llmCandidates[0] as any)._addedBy).toBe('llm-solo');
    expect(result.stageStatus).toBe('completed');
  });
});

// ============================================================================
// Bug 4 fix (2026-04-20): cross-file coalesce pass
// ============================================================================
//
// Gap-fill processes each file independently; when the LLM sees the same
// shared architectural element referenced from multiple files, each file's
// response emits a duplicate candidate. The existing per-file dedup is
// keyed on `(type, name, filePath)` so those cross-file duplicates slip
// through unchanged, inflating the candidate set.
//
// The fix is a cross-file coalesce pass keyed on `(type, normalize(name))`
// only (filePath intentionally excluded) that:
//   - keeps the highest-confidence candidate (tiebreak: first seen)
//   - unions `sourceClusterIds` across the collapsed duplicates
//   - records the number collapsed on `crossFileDedupCount`
// ============================================================================
describe('runLlmGapFill — cross-file coalesce pass (Bug 4 fix)', () => {
  it('collapses two candidates with same (type, normalized name) from different files into 1, unioning sourceClusterIds', async () => {
    // Two files; each LLM call emits a candidate for the same shared entity
    // `specialties` (a table referenced from both a repository and a service).
    gapFillMock.mockImplementation(async (_prompt: string, filePath: string) => {
      if (filePath === 'src/main/java/VetRepository.java') {
        return makeLlmResponse([
          {
            type: 'physical_data_entities',
            name: 'specialties',
            filePath: 'src/main/java/VetRepository.java',
            confidence: 0.7,
          },
        ]);
      }
      return makeLlmResponse([
        {
          // Same logical element, slightly different surface form — must
          // still collapse via normalizeName (case + whitespace folding).
          type: 'physical_data_entities',
          name: 'Specialties',
          filePath: 'src/main/java/VetService.java',
          confidence: 0.6,
        },
      ]);
    });

    const input: GapFillStepInput = {
      runId: 'run-xfile-union',
      files: [
        baseFile({
          filePath: 'src/main/java/VetRepository.java',
          sourceCode: 'class VetRepository {}',
          packCandidates: [],
        }),
        baseFile({
          filePath: 'src/main/java/VetService.java',
          sourceCode: 'class VetService {}',
          packCandidates: [],
        }),
      ],
    };

    const result = await runLlmGapFill(input);

    // Both files processed; both LLM calls fired.
    expect(gapFillMock).toHaveBeenCalledTimes(2);
    // Coalesced down to 1 surviving candidate.
    expect(result.llmCandidates).toHaveLength(1);
    // One duplicate collapsed — recorded on the new field.
    expect(result.crossFileDedupCount).toBe(1);
    // Existing per-file dedup field is independent (zero drops against pack).
    expect(result.dedupDroppedCount).toBe(0);

    // Winner carries the higher confidence (0.7 > 0.6). Clamped by the
    // tag-family midpoint logic in `getConfidenceForTag('llm-gap-fill', 0.7)`
    // so just assert it's the llm-gap-fill-range value the winner had
    // rather than the loser's 0.6.
    const kept = result.llmCandidates[0];
    expect(kept.candidateType).toBe('physical_data_entities');
    // sourceClusterIds unions both files the element was flagged from.
    expect(kept.sourceClusterIds.length).toBe(2);
    expect(new Set(kept.sourceClusterIds)).toEqual(
      new Set([
        'src/main/java/VetRepository.java',
        'src/main/java/VetService.java',
      ]),
    );
  });

  it('keeps the higher-confidence candidate when duplicates have different confidence values', async () => {
    // Three files; each emits a candidate for the same element with different
    // confidences. The merged survivor must carry the top confidence value
    // (modulo the centralized clamp) and surface the same name.
    gapFillMock.mockImplementation(async (_prompt: string, filePath: string) => {
      const confidenceByFile: Record<string, number> = {
        'a.java': 0.55,
        'b.java': 0.92,
        'c.java': 0.7,
      };
      return makeLlmResponse([
        {
          type: 'class',
          name: 'SharedUtil',
          filePath,
          confidence: confidenceByFile[filePath] ?? 0.5,
          // Tag each emission so we can verify the winner's identity via
          // data pass-through.
          description: `from ${filePath}`,
        },
      ]);
    });

    const input: GapFillStepInput = {
      runId: 'run-xfile-winner',
      files: [
        baseFile({ filePath: 'a.java', packCandidates: [] }),
        baseFile({ filePath: 'b.java', packCandidates: [] }),
        baseFile({ filePath: 'c.java', packCandidates: [] }),
      ],
    };

    const result = await runLlmGapFill(input);

    expect(gapFillMock).toHaveBeenCalledTimes(3);
    // 3 -> 1 survivor.
    expect(result.llmCandidates).toHaveLength(1);
    // 2 duplicates collapsed.
    expect(result.crossFileDedupCount).toBe(2);

    const kept = result.llmCandidates[0];
    // Winner is the emission from `b.java` (highest raw 0.92). Verify via
    // the description the builder carried through on `data`.
    expect((kept.data as Record<string, unknown>).description).toBe('from b.java');
    // Union of sourceClusterIds covers all three files.
    expect(new Set(kept.sourceClusterIds)).toEqual(
      new Set(['a.java', 'b.java', 'c.java']),
    );
  });

  it('records zero cross-file duplicates when each candidate key is unique', async () => {
    // Two files, each emits a DIFFERENT element — no duplicates to collapse.
    // This also regression-checks that the coalesce pass is a no-op for the
    // single-candidate case (sourceClusterIds stays at its built-default
    // empty array, preserving the pre-Bug-4 contract for in-process callers).
    gapFillMock.mockImplementation(async (_prompt: string, filePath: string) => {
      return makeLlmResponse([
        {
          type: 'class',
          name: filePath === 'x.java' ? 'ClassX' : 'ClassY',
          filePath,
          confidence: 0.8,
        },
      ]);
    });

    const input: GapFillStepInput = {
      runId: 'run-xfile-none',
      files: [
        baseFile({ filePath: 'x.java', packCandidates: [] }),
        baseFile({ filePath: 'y.java', packCandidates: [] }),
      ],
    };

    const result = await runLlmGapFill(input);

    expect(result.llmCandidates).toHaveLength(2);
    expect(result.crossFileDedupCount).toBe(0);
    // Single-candidate (non-duplicate) path preserves the pre-Bug-4 contract
    // that `sourceClusterIds` stays whatever the build step set (`[]`).
    expect(result.llmCandidates[0].sourceClusterIds).toEqual([]);
    expect(result.llmCandidates[1].sourceClusterIds).toEqual([]);
  });
});

// ============================================================================
// Structured-metadata gate (2026-04-25)
// Regression cover for the OpenMRS run that landed an `endpoints: MESSAGE
// ADT_A28` hallucination plus 777 LLM `business_logics` rows with empty
// `className`. The gate drops rows that lack the type-specific structured
// fields they need to be useful downstream and to participate in dedup.
// ============================================================================
describe('runLlmGapFill — structured-metadata gate', () => {
  it('drops endpoints rows missing both httpMethod and a path-shaped field', async () => {
    gapFillMock.mockResolvedValueOnce(
      makeLlmResponse([
        // Hallucination shape from the OpenMRS scan — no method, no path.
        {
          type: 'endpoints',
          name: 'MESSAGE ADT_A28',
          filePath: 'api/src/main/java/org/openmrs/hl7/HL7Service.java',
          confidence: 0.7,
        },
        // Real-looking endpoint — must survive the gate.
        {
          type: 'endpoints',
          name: 'GET /patients',
          filePath: 'api/src/main/java/org/openmrs/web/PatientController.java',
          confidence: 0.85,
          httpMethod: 'GET',
          fullPath: '/patients',
        },
      ]),
    );

    const result = await runLlmGapFill({
      runId: 'run-gate-1',
      files: [baseFile({ filePath: 'api/src/main/java/org/openmrs/hl7/HL7Service.java' })],
    });

    const names = result.llmCandidates.map((c) => c.name);
    expect(names).toEqual(['GET /patients']);
  });

  it('auto-derives className from a Class.method-shaped business_logics name', async () => {
    gapFillMock.mockResolvedValueOnce(
      makeLlmResponse([
        // Shape observed in the OpenMRS scan: `Daemon.isDaemonUser` etc.
        // arrives without a `className` field. The gate should auto-derive
        // it from the dotted name and KEEP the row.
        {
          type: 'business_logics',
          name: 'Daemon.isDaemonUser',
          filePath: 'api/src/main/java/org/openmrs/util/Daemon.java',
          confidence: 0.78,
        },
      ]),
    );

    const result = await runLlmGapFill({
      runId: 'run-gate-2',
      files: [baseFile({ filePath: 'api/src/main/java/org/openmrs/util/Daemon.java' })],
    });

    expect(result.llmCandidates).toHaveLength(1);
    const c = result.llmCandidates[0] as any;
    expect(c.name).toBe('Daemon.isDaemonUser');
    expect(c.data.className).toBe('Daemon');
  });

  it('drops business_logics rows that have no className AND no Class.method-shaped name', async () => {
    gapFillMock.mockResolvedValueOnce(
      makeLlmResponse([
        // Bare-method-name LLM noise from the OpenMRS scan: `size`,
        // `union`, `intersect`, `gt`, `merge`. No structured className,
        // no dotted shape — drop.
        { type: 'business_logics', name: 'size', filePath: 'api/Foo.java', confidence: 0.7 },
        { type: 'business_logics', name: 'union', filePath: 'api/Foo.java', confidence: 0.7 },
        { type: 'business_logics', name: 'gt', filePath: 'api/Foo.java', confidence: 0.7 },
        // Sanity row: properly-structured business_logics survives.
        {
          type: 'business_logics',
          name: 'calculateRiskScore',
          filePath: 'api/Foo.java',
          confidence: 0.85,
          className: 'PatientService',
        },
      ]),
    );

    const result = await runLlmGapFill({
      runId: 'run-gate-3',
      files: [baseFile({ filePath: 'api/Foo.java' })],
    });

    expect(result.llmCandidates.map((c) => c.name)).toEqual(['calculateRiskScore']);
  });

  it('auto-derives entityClassName from a Class.field-shaped physical_data_attributes name', async () => {
    gapFillMock.mockResolvedValueOnce(
      makeLlmResponse([
        // Shape from the OpenMRS scan: `Alert.dateCreated`,
        // `Concept.conceptId` arrived without entityClassName.
        {
          type: 'physical_data_attributes',
          name: 'Concept.conceptId',
          filePath: 'api/src/main/java/org/openmrs/Concept.java',
          confidence: 0.78,
        },
      ]),
    );

    const result = await runLlmGapFill({
      runId: 'run-gate-4',
      files: [baseFile({ filePath: 'api/src/main/java/org/openmrs/Concept.java' })],
    });

    expect(result.llmCandidates).toHaveLength(1);
    const c = result.llmCandidates[0] as any;
    expect(c.data.entityClassName).toBe('Concept');
    expect(c.data.fieldName).toBe('conceptId');
  });

  it('drops logical_data_entity_relationships rows missing sourceEntity / targetEntity', async () => {
    gapFillMock.mockResolvedValueOnce(
      makeLlmResponse([
        // Missing both — drop.
        {
          type: 'logical_data_entity_relationships',
          name: 'something something',
          filePath: 'api/Foo.java',
          confidence: 0.7,
        },
        // Properly structured — keep.
        {
          type: 'logical_data_entity_relationships',
          name: 'Encounter → Patient',
          filePath: 'api/Foo.java',
          confidence: 0.85,
          sourceEntity: 'Encounter',
          targetEntity: 'Patient',
          cardinality: 'MANY_TO_ONE',
        },
      ]),
    );

    const result = await runLlmGapFill({
      runId: 'run-gate-5',
      files: [baseFile({ filePath: 'api/Foo.java' })],
    });

    expect(result.llmCandidates.map((c) => c.name)).toEqual(['Encounter → Patient']);
  });

  it('drops interfaces rows whose `name` is ALL_CAPS_WITH_UNDERSCORES (constants, not interfaces)', async () => {
    // Regression cover for the OpenMRS run-2 finding: `ATTR_VIEW_TYPE` was
    // emitted as `interfaces` by the LLM. Constants/static-fields are never
    // architectural interfaces. The base prompt forbids this; the gate enforces.
    gapFillMock.mockResolvedValueOnce(
      makeLlmResponse([
        {
          type: 'interfaces',
          name: 'ATTR_VIEW_TYPE',
          filePath: 'api/Foo.java',
          confidence: 0.7,
        },
        // Real-looking interface — survives.
        {
          type: 'interfaces',
          name: 'PatientService',
          filePath: 'api/PatientService.java',
          confidence: 0.85,
        },
      ]),
    );

    const result = await runLlmGapFill({
      runId: 'run-allcaps',
      files: [baseFile({ filePath: 'api/Foo.java' })],
    });

    expect(result.llmCandidates.map((c) => c.name)).toEqual(['PatientService']);
  });

  it('auto-derives sourceEntity/targetEntity from a "Source → Target" name on logical_data_entity_relationships', async () => {
    gapFillMock.mockResolvedValueOnce(
      makeLlmResponse([
        // Unicode arrow form (the canonical adapter-emitted shape)
        {
          type: 'logical_data_entity_relationships',
          name: 'Encounter → Patient',
          filePath: 'api/Foo.java',
          confidence: 0.78,
        },
        // ASCII arrow form
        {
          type: 'logical_data_entity_relationships',
          name: 'Order -> Customer',
          filePath: 'api/Foo.java',
          confidence: 0.78,
        },
      ]),
    );

    const result = await runLlmGapFill({
      runId: 'run-arrow',
      files: [baseFile({ filePath: 'api/Foo.java' })],
    });

    expect(result.llmCandidates).toHaveLength(2);
    const enc = result.llmCandidates.find((c) => c.name === 'Encounter → Patient')!;
    expect((enc.data as any).sourceEntity).toBe('Encounter');
    expect((enc.data as any).targetEntity).toBe('Patient');
    const ord = result.llmCandidates.find((c) => c.name === 'Order -> Customer')!;
    expect((ord.data as any).sourceEntity).toBe('Order');
    expect((ord.data as any).targetEntity).toBe('Customer');
  });

  it('auto-derives interfaceClassName/logicalEntityName from a "Source → Target" name on interface_logical_entities', async () => {
    gapFillMock.mockResolvedValueOnce(
      makeLlmResponse([
        {
          type: 'interface_logical_entities',
          name: 'PatientService → PatientDto',
          filePath: 'api/Foo.java',
          confidence: 0.78,
        },
      ]),
    );

    const result = await runLlmGapFill({
      runId: 'run-iface-arrow',
      files: [baseFile({ filePath: 'api/Foo.java' })],
    });

    expect(result.llmCandidates).toHaveLength(1);
    const c = result.llmCandidates[0];
    expect((c.data as any).interfaceClassName).toBe('PatientService');
    expect((c.data as any).logicalEntityName).toBe('PatientDto');
  });

  it('does NOT enforce structured fields on types where `name` carries the architectural identity (interfaces, logical_data_entities, ui_*)', async () => {
    // These types are useful with `name` alone — don't punish them.
    gapFillMock.mockResolvedValueOnce(
      makeLlmResponse([
        {
          type: 'interfaces',
          name: 'PatientService',
          filePath: 'api/PatientService.java',
          confidence: 0.78,
        },
        {
          type: 'logical_data_entities',
          name: 'PatientDto',
          filePath: 'api/PatientDto.java',
          confidence: 0.78,
        },
      ]),
    );

    const result = await runLlmGapFill({
      runId: 'run-gate-6',
      files: [baseFile({ filePath: 'api/PatientService.java' })],
    });

    expect(result.llmCandidates).toHaveLength(2);
  });
});
