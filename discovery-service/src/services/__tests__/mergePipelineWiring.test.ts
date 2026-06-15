/**
 * Task Group 5 (Spec 0 — Unique, Aggregate Discovery Candidates):
 * focused tests for the two-phase pipeline-wiring SEMANTICS the
 * `discoveryV3Pipeline` orchestrator applies at the hook points.
 *
 * These exercise the exact transformation the pipeline performs — Phase 1
 * (merge+reconcile over the kept pack/contract candidates, assigned back to
 * `filteredPackCandidates`) and Phase 2 (fold LLM candidates into the SAME
 * identity index after Stage 3) — WITHOUT booting the full async pipeline (which
 * pulls parser modules in and would make this suite tree-sitter-fragile). The
 * reference-semantics check guards the Stage 2.5 contract (runtime evidence
 * mutates the merged survivor BY ID, so survivor ids must be stable).
 *
 * Kept to a tight focused set (2-8 tests).
 */

import { mergeCandidates, type MergeResult } from '../candidateMerge';
import { reconcileMergedCandidates } from '../candidateReconcile';
import { sortCandidatesParentsFirst } from '../llmFileAnalysisStep';
import { buildCandidateIdentityShim } from './helpers/identityShim';
import type { DiscoveryCandidate, CandidateType } from '../../types/candidate';

function makeCandidate(
  overrides: Partial<DiscoveryCandidate>,
): DiscoveryCandidate {
  return {
    id: overrides.id ?? `id-${Math.random().toString(36).slice(2, 10)}`,
    runId: overrides.runId ?? 'run-1',
    candidateType: (overrides.candidateType ?? 'endpoints') as CandidateType,
    name: overrides.name ?? 'X',
    confidence: overrides.confidence ?? 0.9,
    status: overrides.status ?? 'proposed',
    sourceClusterIds: overrides.sourceClusterIds ?? ['src/X.java'],
    parentCandidateId: overrides.parentCandidateId,
    data: overrides.data ?? {},
    synthesizedAt: overrides.synthesizedAt ?? new Date().toISOString(),
  };
}

/** Phase 1 as the pipeline wires it at the hook point (:985). */
function phase1(kept: DiscoveryCandidate[]): {
  filteredPackCandidates: DiscoveryCandidate[];
  mergeOutput: MergeResult;
} {
  const mergeOutput = mergeCandidates(kept);
  const filteredPackCandidates = reconcileMergedCandidates(mergeOutput.merged);
  return { filteredPackCandidates, mergeOutput };
}

/** Phase 2 as the pipeline wires it after Stage 3 (~1382-1411). */
function phase2(
  filteredPackCandidates: DiscoveryCandidate[],
  llmCandidates: DiscoveryCandidate[],
): { merged: DiscoveryCandidate[]; mergeOutput: MergeResult } {
  const mergeOutput = mergeCandidates([...filteredPackCandidates, ...llmCandidates]);
  const merged = reconcileMergedCandidates(mergeOutput.merged);
  return { merged, mergeOutput };
}

describe('Phase 1 — merge replaces dedup at the hook point', () => {
  it('collapses the 3x WADL+JAX-RS endpoint set into one survivor assigned to filteredPackCandidates', () => {
    const wadlIface = makeCandidate({
      id: 'iface-wadl',
      candidateType: 'interfaces',
      name: 'PetStore',
      data: { interface_type: 'REST_API', spec_link: 'src/api/petstore.wadl', _addedBy: 'rest-wadl-pack' },
    });
    // (a) WADL endpoint under generic parent + (b) WADL endpoint with NO parent.
    const wadlParented = makeCandidate({
      id: 'ep-wadl-parented',
      candidateType: 'endpoints',
      name: 'getPet_op',
      parentCandidateId: 'iface-wadl',
      data: { operation_verb: 'GET', path_or_address: '/pets/{id}', _addedBy: 'rest-wadl-pack' },
    });
    const wadlNoParent = makeCandidate({
      id: 'ep-wadl-noparent',
      candidateType: 'endpoints',
      name: 'getPet_op2',
      data: { operation_verb: 'GET', path_or_address: '/pets/{petId}', _addedBy: 'rest-wadl-pack' },
    });
    // (c) JAX-RS endpoint under the specific controller.
    const ctrlIface = makeCandidate({
      id: 'iface-ctrl',
      candidateType: 'interfaces',
      name: 'PetController',
      data: { className: 'com.example.PetController', _addedBy: 'spring-classic-jaxrs' },
    });
    const jaxrs = makeCandidate({
      id: 'ep-jaxrs',
      candidateType: 'endpoints',
      name: 'GET /pets/{x}',
      parentCandidateId: 'iface-ctrl',
      data: {
        httpMethod: 'GET',
        fullPath: '/pets/{x}',
        controllerClassName: 'com.example.PetController',
        produces: ['application/json'],
        _addedBy: 'spring-classic-jaxrs',
      },
    });

    const { filteredPackCandidates, mergeOutput } = phase1([
      wadlIface,
      wadlParented,
      wadlNoParent,
      ctrlIface,
      jaxrs,
    ]);

    const endpoints = filteredPackCandidates.filter((c) => c.candidateType === 'endpoints');
    expect(endpoints).toHaveLength(1);
    // The merged endpoint carries verb+path (WADL) + specific interface + media (JAX-RS).
    const d = endpoints[0].data as Record<string, unknown>;
    expect(d.operation_verb).toBe('GET');
    expect(d.path_or_address).toBeDefined();
    expect(d.produces).toEqual(['application/json']);
    expect(endpoints[0].parentCandidateId).toBe('iface-ctrl');
    // The emptied generic WADL interface was dropped.
    const interfaces = filteredPackCandidates.filter((c) => c.candidateType === 'interfaces');
    expect(interfaces.map((i) => i.id)).toEqual(['iface-ctrl']);
    // The merge produced a collapse summary the pipeline logs (>=1 group).
    expect(mergeOutput.mergeGroups.length).toBeGreaterThanOrEqual(1);
  });

  it('preserves survivor id reference semantics so Stage 2.5 still matches by id', () => {
    const jaxrs = makeCandidate({
      id: 'ep-jaxrs-keep',
      candidateType: 'endpoints',
      name: 'GET /a',
      data: { httpMethod: 'GET', fullPath: '/a', _addedBy: 'spring-classic-jaxrs' },
    });
    const wadl = makeCandidate({
      id: 'ep-wadl-drop',
      candidateType: 'endpoints',
      name: 'getA',
      data: { operation_verb: 'GET', path_or_address: '/a', _addedBy: 'rest-wadl-pack' },
    });
    const { filteredPackCandidates } = phase1([jaxrs, wadl]);
    const survivor = filteredPackCandidates.find((c) => c.candidateType === 'endpoints')!;
    // Survivor keeps the structural source's STABLE id (the JAX-RS object) — the
    // id Stage 2.5's applyRuntimeEvidenceToCandidates would look up.
    expect(survivor.id).toBe('ep-jaxrs-keep');
    // A runtime-evidence-style byId lookup over the post-merge array finds it.
    const byId = buildCandidateIdentityShim(filteredPackCandidates);
    expect(byId.get('ep-jaxrs-keep')).toBe(survivor);
  });
});

describe('Phase 2 — fold LLM into the same identity index', () => {
  it('folds an LLM endpoint dup into the merged pack survivor (no separate row) and keeps parents-first persist', () => {
    const { filteredPackCandidates } = phase1([
      makeCandidate({
        id: 'iface-ctrl',
        candidateType: 'interfaces',
        name: 'UserController',
        data: { className: 'com.example.UserController', _addedBy: 'spring-classic-jaxrs' },
      }),
      makeCandidate({
        id: 'ep-pack',
        candidateType: 'endpoints',
        name: 'GET /users/{id}',
        parentCandidateId: 'iface-ctrl',
        data: { httpMethod: 'GET', fullPath: '/users/{id}', controllerClassName: 'com.example.UserController', _addedBy: 'spring-classic-jaxrs' },
      }),
    ]);

    // The LLM re-proposes the SAME endpoint (different name) + adds a description.
    const llmDup = makeCandidate({
      id: 'ep-llm',
      candidateType: 'endpoints',
      name: 'Get user by id',
      data: { operation_verb: 'GET', path_or_address: '/users/123', description: 'Fetch a user', _addedBy: 'llm-gap-fill' },
    });

    const { merged, mergeOutput } = phase2(filteredPackCandidates, [llmDup]);
    const endpoints = merged.filter((c) => c.candidateType === 'endpoints');
    // The LLM dup folded into the pack survivor — ONE endpoint, not two.
    expect(endpoints).toHaveLength(1);
    const d = endpoints[0].data as Record<string, unknown>;
    // Gap-filled the description from the LLM source (absent on the pack survivor).
    expect(d.description).toBe('Fetch a user');
    // The fold recorded a merge group (its candidate_conflict-shaped Finding).
    expect(mergeOutput.mergeGroups.length).toBeGreaterThanOrEqual(1);

    // Parents-first persist contract still holds after the fold.
    const sorted = sortCandidatesParentsFirst(merged);
    const parentIdx = sorted.findIndex((c) => c.id === 'iface-ctrl');
    const childIdx = sorted.findIndex((c) => c.candidateType === 'endpoints');
    expect(parentIdx).toBeGreaterThanOrEqual(0);
    expect(childIdx).toBeGreaterThan(parentIdx);
  });
});
