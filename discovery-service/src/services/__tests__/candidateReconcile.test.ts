/**
 * Task Group 3 (Spec 0 — Unique, Aggregate Discovery Candidates):
 * focused tests for interface + logical-data-entity RECONCILIATION on the
 * merged candidate set — re-parent merged endpoints to the SPECIFIC controller
 * interface, drop generic WADL interfaces emptied to zero endpoints, consolidate
 * DTOs by identity, and REBUILD the `interface_logical_entities` /
 * `endpoint_data_effects` relationship rows (dropping orphans). Parents-first
 * ordering must still hold.
 *
 * Pure / no-I/O. Kept to a tight focused set (2-8 tests).
 */

import { mergeCandidates } from '../candidateMerge';
import { reconcileMergedCandidates } from '../candidateReconcile';
import { sortCandidatesParentsFirst } from '../llmFileAnalysisStep';
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

/** Build the canonical 3x->1x fixture: generic WADL iface + WADL endpoint +
 *  specific controller iface + JAX-RS endpoint for ONE real endpoint. */
function buildFixture() {
  const wadlIface = makeCandidate({
    id: 'iface-wadl',
    candidateType: 'interfaces',
    name: 'PetStore',
    data: { interface_type: 'REST_API', spec_link: 'src/api/petstore.wadl', _addedBy: 'rest-wadl-pack' },
  });
  const wadlEndpoint = makeCandidate({
    id: 'ep-wadl',
    candidateType: 'endpoints',
    name: 'getPet_op',
    parentCandidateId: 'iface-wadl',
    data: { operation_verb: 'GET', path_or_address: '/pets/{id}', doc: 'Get a pet', _addedBy: 'rest-wadl-pack' },
  });
  const controllerIface = makeCandidate({
    id: 'iface-ctrl',
    candidateType: 'interfaces',
    name: 'PetController',
    data: { className: 'com.example.PetController', interfaceSubtype: 'jaxrs-resource', _addedBy: 'spring-classic-jaxrs' },
  });
  const jaxrsEndpoint = makeCandidate({
    id: 'ep-jaxrs',
    candidateType: 'endpoints',
    name: 'GET /pets/{petId}',
    parentCandidateId: 'iface-ctrl',
    data: {
      httpMethod: 'GET',
      fullPath: '/pets/{petId}',
      controllerClassName: 'com.example.PetController',
      produces: ['application/json'],
      _addedBy: 'spring-classic-jaxrs',
    },
  });
  return { wadlIface, wadlEndpoint, controllerIface, jaxrsEndpoint };
}

describe('reconcileMergedCandidates — re-parent + drop emptied interface', () => {
  it('re-parents the merged endpoint to the specific controller and drops the emptied WADL interface', () => {
    const { wadlIface, wadlEndpoint, controllerIface, jaxrsEndpoint } = buildFixture();
    const { merged } = mergeCandidates([wadlIface, wadlEndpoint, controllerIface, jaxrsEndpoint]);
    // After merge: 1 endpoint survivor + 2 interfaces (they don't collapse).
    const reconciled = reconcileMergedCandidates(merged);

    const endpoints = reconciled.filter((c) => c.candidateType === 'endpoints');
    const interfaces = reconciled.filter((c) => c.candidateType === 'interfaces');
    expect(endpoints).toHaveLength(1);
    // The merged endpoint re-parents to the SPECIFIC controller interface.
    expect(endpoints[0].parentCandidateId).toBe('iface-ctrl');
    // The generic WADL interface, now empty, is dropped — only the controller remains.
    expect(interfaces).toHaveLength(1);
    expect(interfaces[0].id).toBe('iface-ctrl');
  });

  it('keeps a single-source endpoint`s own interface untouched', () => {
    const soloIface = makeCandidate({
      id: 'iface-solo',
      candidateType: 'interfaces',
      name: 'SoloController',
      data: { className: 'com.example.SoloController', _addedBy: 'spring-classic-jaxrs' },
    });
    const soloEndpoint = makeCandidate({
      id: 'ep-solo',
      candidateType: 'endpoints',
      name: 'GET /solo',
      parentCandidateId: 'iface-solo',
      data: { httpMethod: 'GET', fullPath: '/solo', controllerClassName: 'com.example.SoloController', _addedBy: 'spring-classic-jaxrs' },
    });
    const { merged } = mergeCandidates([soloIface, soloEndpoint]);
    const reconciled = reconcileMergedCandidates(merged);
    expect(reconciled.filter((c) => c.candidateType === 'interfaces')).toHaveLength(1);
    const ep = reconciled.find((c) => c.candidateType === 'endpoints')!;
    expect(ep.parentCandidateId).toBe('iface-solo');
  });
});

describe('reconcileMergedCandidates — DTO consolidation + relationship rebuild', () => {
  it('consolidates DTOs by identity and re-points relationship rows; orphans dropped', () => {
    // Two sources emit the same DTO (different casing -> same identity).
    const dtoA = makeCandidate({
      id: 'dto-a',
      candidateType: 'logical_data_entities',
      name: 'PetDto',
      data: { _addedBy: 'spring-classic-jaxrs' },
    });
    const dtoB = makeCandidate({
      id: 'dto-b',
      candidateType: 'logical_data_entities',
      name: 'petdto',
      data: { _addedBy: 'rest-wadl-pack' },
    });
    // An interface_logical_entities row that references the DUPLICATE name `petdto`.
    const ileRow = makeCandidate({
      id: 'ile-1',
      candidateType: 'interface_logical_entities',
      name: 'PetController ↔ petdto',
      data: { interfaceClassName: 'PetController', logicalEntityName: 'petdto', _addedBy: 'spring-classic-jaxrs' },
    });
    // An endpoint_data_effects row referencing a DTO that does NOT survive (orphan).
    const orphanEffect = makeCandidate({
      id: 'eff-orphan',
      candidateType: 'endpoint_data_effects',
      name: 'GET /pets/{id} → GhostDto (read)',
      data: { endpointName: 'GET /pets/{id}', dataEntityName: 'GhostDto', accessMode: 'read', _addedBy: 'spring-classic-jaxrs' },
    });

    const { merged } = mergeCandidates([dtoA, dtoB, ileRow, orphanEffect]);
    const reconciled = reconcileMergedCandidates(merged);

    // DTOs consolidated to one survivor.
    const dtos = reconciled.filter((c) => c.candidateType === 'logical_data_entities');
    expect(dtos).toHaveLength(1);
    const survivorName = dtos[0].name;

    // The ILE row re-points to the surviving DTO's canonical name.
    const ile = reconciled.find((c) => c.candidateType === 'interface_logical_entities');
    expect(ile).toBeDefined();
    expect((ile!.data as Record<string, unknown>).logicalEntityName).toBe(survivorName);

    // The orphaned data-effect row (references a DTO that does not survive) is dropped.
    expect(reconciled.find((c) => c.id === 'eff-orphan')).toBeUndefined();
  });

  it('preserves sortCandidatesParentsFirst (parent before child) after re-parenting/drops', () => {
    const { wadlIface, wadlEndpoint, controllerIface, jaxrsEndpoint } = buildFixture();
    const { merged } = mergeCandidates([wadlIface, wadlEndpoint, controllerIface, jaxrsEndpoint]);
    const reconciled = reconcileMergedCandidates(merged);
    const sorted = sortCandidatesParentsFirst(reconciled);

    const parentIdx = sorted.findIndex((c) => c.id === 'iface-ctrl');
    const childIdx = sorted.findIndex((c) => c.candidateType === 'endpoints');
    expect(parentIdx).toBeGreaterThanOrEqual(0);
    expect(childIdx).toBeGreaterThan(parentIdx);
    // The endpoint's parent still exists in the set, so its parentCandidateId is NOT cleared.
    expect(sorted[childIdx].parentCandidateId).toBe('iface-ctrl');
  });
});

describe('reconcile — re-parent logical_data_attributes to their surviving entity (Pass 4)', () => {
  function entity(id: string, name: string, addedBy = 'spring-classic-jaxrs'): DiscoveryCandidate {
    return makeCandidate({ id, candidateType: 'logical_data_entities', name, data: { _addedBy: addedBy } });
  }
  function attr(
    id: string,
    name: string,
    logicalEntityName: string,
    parentCandidateId?: string,
    addedBy = 'spring-classic-adapter',
  ): DiscoveryCandidate {
    return makeCandidate({
      id,
      candidateType: 'logical_data_attributes',
      name,
      parentCandidateId,
      data: { logicalEntityName, _addedBy: addedBy },
    });
  }

  it('sets parentCandidateId on an LLM attribute that has the parent NAME but no structural id', () => {
    const ent = entity('ent-1', 'OrderDto');
    const a = attr('attr-llm', 'status', 'OrderDto', undefined, 'llm-gap-fill');
    const { merged } = mergeCandidates([ent, a]);
    const reconciled = reconcileMergedCandidates(merged);

    const got = reconciled.find((c) => c.id === 'attr-llm')!;
    expect(got.parentCandidateId).toBe('ent-1');

    // And the link SURVIVES the orphan-clearing safety net (parent is in the set).
    const sorted = sortCandidatesParentsFirst(reconciled);
    expect(sorted.find((c) => c.id === 'attr-llm')!.parentCandidateId).toBe('ent-1');
  });

  it('re-points a pack attribute whose parent entity merged to a DIFFERENT survivor id', () => {
    // Two OrderDto entities merge; the higher-precedence pack entity (ent-a) wins
    // the survivor id, ent-b is folded away. The attribute pointed at the folded
    // ent-b → dangling → must be re-pointed to ent-a by its recorded name.
    const entA = entity('ent-a', 'OrderDto', 'spring-classic-jaxrs');
    const entB = entity('ent-b', 'OrderDto', 'llm-gap-fill');
    const a = attr('attr-1', 'total', 'OrderDto', 'ent-b');
    const { merged } = mergeCandidates([entA, entB, a]);
    // Sanity: the two entities merged to one survivor (ent-a).
    expect(merged.filter((c) => c.candidateType === 'logical_data_entities')).toHaveLength(1);
    expect(merged.find((c) => c.candidateType === 'logical_data_entities')!.id).toBe('ent-a');

    const reconciled = reconcileMergedCandidates(merged);
    expect(reconciled.find((c) => c.id === 'attr-1')!.parentCandidateId).toBe('ent-a');
  });

  it('leaves an attribute UNTOUCHED when it already points at a surviving entity', () => {
    const ent = entity('ent-2', 'PetDto');
    const a = attr('attr-linked', 'name', 'PetDto', 'ent-2');
    const { merged } = mergeCandidates([ent, a]);
    const reconciled = reconcileMergedCandidates(merged);
    expect(reconciled.find((c) => c.id === 'attr-linked')!.parentCandidateId).toBe('ent-2');
  });

  it('leaves a GENUINE orphan parentless when its recorded entity has no survivor', () => {
    const a = attr('attr-orphan', 'ghost', 'NonExistentEntity', undefined, 'llm-gap-fill');
    const { merged } = mergeCandidates([a]);
    const reconciled = reconcileMergedCandidates(merged);
    expect(reconciled.find((c) => c.id === 'attr-orphan')!.parentCandidateId).toBeUndefined();
  });
});
