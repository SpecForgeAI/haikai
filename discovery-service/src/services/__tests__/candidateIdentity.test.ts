/**
 * Task Group 1 (Spec 0 — Unique, Aggregate Discovery Candidates):
 * focused tests for `canonicalEndpointPath()` + the per-type identity-key
 * builder `buildIdentityKey()`.
 *
 * These are the foundational, pure primitives the universal merge engine keys
 * on. The crux being verified here is root-cause-#1: two endpoint candidates
 * that differ ONLY by parent interface / name but share verb + canonical path
 * must produce the SAME identity key (the parent-in-key DROP is gone).
 *
 * Kept to a tight focused set (2-8 tests) per the spec's test-plan cap.
 */

import { canonicalEndpointPath } from '../runtimeEvidence/endpointPathNormalizer';
import { buildIdentityKey } from '../candidateIdentity';
import type { DiscoveryCandidate, CandidateType } from '../../types/candidate';

function makeCandidate(
  overrides: Partial<DiscoveryCandidate>,
): DiscoveryCandidate {
  return {
    id: overrides.id ?? `id-${Math.random().toString(36).slice(2, 8)}`,
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

describe('canonicalEndpointPath', () => {
  it('collapses any {placeholder} name to one positional token', () => {
    // `{theString}` and `{myString}` must canonicalize to the SAME string.
    expect(canonicalEndpointPath('/users/{theString}')).toBe(
      canonicalEndpointPath('/users/{myString}'),
    );
  });

  it('applies normalizePath literal-ID rewrite then collapses placeholders', () => {
    // `/users/123` (literal ID -> {id}) and `/users/{id}` collapse to one key.
    expect(canonicalEndpointPath('/users/123')).toBe(
      canonicalEndpointPath('/users/{id}'),
    );
    // Named placeholder collapses to the same positional token as {id}.
    expect(canonicalEndpointPath('/owners/{ownerId}/pets/{petId}')).toBe(
      canonicalEndpointPath('/owners/123/pets/456'),
    );
  });

  it('keeps static and templated segments distinct', () => {
    // `/users/me` is a static literal; `/users/{id}` is templated — different keys.
    expect(canonicalEndpointPath('/users/me')).not.toBe(
      canonicalEndpointPath('/users/{id}'),
    );
  });
});

describe('buildIdentityKey', () => {
  it('endpoints: same verb+canonical-path collapse despite differing name/parent (root-cause #1)', () => {
    // (a) WADL endpoint under a generic parent, compositeId name.
    const wadl = makeCandidate({
      candidateType: 'endpoints',
      name: 'getUserById_op',
      parentCandidateId: 'generic-wadl-iface',
      data: { operation_verb: 'GET', path_or_address: '/users/{id}' },
    });
    // (b) JAX-RS endpoint under the specific controller, `${verb} ${path}` name.
    const jaxrs = makeCandidate({
      candidateType: 'endpoints',
      name: 'GET /users/{userId}',
      parentCandidateId: 'specific-controller-iface',
      data: {
        httpMethod: 'GET',
        fullPath: '/users/{userId}',
        controllerClassName: 'UserController',
      },
    });
    expect(buildIdentityKey(wadl)).toBe(buildIdentityKey(jaxrs));
    // Method IS part of the key — a different verb must NOT collapse.
    const post = makeCandidate({
      candidateType: 'endpoints',
      data: { httpMethod: 'POST', fullPath: '/users/{userId}' },
    });
    expect(buildIdentityKey(post)).not.toBe(buildIdentityKey(jaxrs));
  });

  it('endpoints: a MALFORMED-brace path twin shares the identity key of its well-formed twin (duplicate-endpoint fix)', () => {
    // The HAIKAI duplicate: the WADL pack emits the well-formed
    // `POST /hierarchy/{businessDate}/{orgUnitId}` while a non-WADL pack emitted
    // the SAME logical endpoint with a MALFORMED path string
    // `POST /hierarchy/businessDate}/{orgUnitId}` (opening `{` lost upstream).
    // Before the canonicalizer hardening these produced different identity keys
    // and the Spec-0 merge kept BOTH rows. They must now share one key.
    const wadlTwin = makeCandidate({
      candidateType: 'endpoints',
      name: 'POST /hierarchy/{businessDate}/{orgUnitId}',
      parentCandidateId: 'samplesvc-service-version-iface',
      data: {
        operation_verb: 'POST',
        path_or_address: '/hierarchy/{businessDate}/{orgUnitId}',
      },
    });
    const malformedTwin = makeCandidate({
      candidateType: 'endpoints',
      name: 'POST /hierarchy/businessDate}/{orgUnitId}',
      parentCandidateId: 'hierarchy-lookup-service-iface',
      data: {
        httpMethod: 'POST',
        fullPath: '/hierarchy/businessDate}/{orgUnitId}',
      },
    });
    expect(buildIdentityKey(malformedTwin)).toBe(buildIdentityKey(wadlTwin));

    // The /hierarchynodes pair collapses the same way.
    const nodesWadl = makeCandidate({
      candidateType: 'endpoints',
      data: { operation_verb: 'POST', path_or_address: '/hierarchynodes/{businessDate}/{orgUnitId}' },
    });
    const nodesMalformed = makeCandidate({
      candidateType: 'endpoints',
      data: { httpMethod: 'POST', fullPath: '/hierarchynodes/businessDate}/{orgUnitId}' },
    });
    expect(buildIdentityKey(nodesMalformed)).toBe(buildIdentityKey(nodesWadl));

    // Guard: a genuinely different static route must still NOT collapse into it.
    const unrelated = makeCandidate({
      candidateType: 'endpoints',
      data: { httpMethod: 'POST', fullPath: '/hierarchy/lookup/active' },
    });
    expect(buildIdentityKey(unrelated)).not.toBe(buildIdentityKey(wadlTwin));
  });

  it('endpoints: media-type variants of the same method+path share an identity key', () => {
    const json = makeCandidate({
      candidateType: 'endpoints',
      name: 'GET /things [produces=application/json]',
      data: { httpMethod: 'GET', fullPath: '/things', produces: ['application/json'] },
    });
    const xml = makeCandidate({
      candidateType: 'endpoints',
      name: 'GET /things [produces=application/xml]',
      data: { httpMethod: 'GET', fullPath: '/things', produces: ['application/xml'] },
    });
    // Media types are NOT part of identity — these collapse.
    expect(buildIdentityKey(json)).toBe(buildIdentityKey(xml));
  });

  it('interfaces: controller FQN keys; generic WADL never key-matches a specific controller', () => {
    const controller = makeCandidate({
      candidateType: 'interfaces',
      name: 'UserController',
      data: { className: 'com.example.UserController', interfaceSubtype: 'jaxrs-resource' },
    });
    const sameController = makeCandidate({
      candidateType: 'interfaces',
      name: 'whatever-other-name',
      data: { controllerClassName: 'com.example.UserController' },
    });
    expect(buildIdentityKey(controller)).toBe(buildIdentityKey(sameController));

    const wadlIface = makeCandidate({
      candidateType: 'interfaces',
      name: 'PetStore',
      data: { interface_type: 'REST_API', spec_link: 'src/api/petstore.wadl' },
    });
    // A generic WADL interface must NEVER key-match a specific controller.
    expect(buildIdentityKey(wadlIface)).not.toBe(buildIdentityKey(controller));
  });

  it('LDE / physical_data_entities / services key as specified', () => {
    // logical_data_entities: normalized DTO type name (case-insensitive). Two
    // sources emitting the same DTO type with different casing collapse.
    const ldeSimple = makeCandidate({
      candidateType: 'logical_data_entities',
      name: 'UserDto',
    });
    const ldeOtherCase = makeCandidate({
      candidateType: 'logical_data_entities',
      name: 'userdto',
    });
    expect(buildIdentityKey(ldeSimple)).toBe(buildIdentityKey(ldeOtherCase));

    // physical_data_entities: database_name + physical_type + normalized table.
    const tableA = makeCandidate({
      candidateType: 'physical_data_entities',
      name: 'USERS',
      data: { database_name: 'app', physical_type: 'table' },
    });
    const tableASame = makeCandidate({
      candidateType: 'physical_data_entities',
      name: 'users',
      data: { database_name: 'app', physical_type: 'table' },
    });
    const tableDifferentDb = makeCandidate({
      candidateType: 'physical_data_entities',
      name: 'users',
      data: { database_name: 'reporting', physical_type: 'table' },
    });
    expect(buildIdentityKey(tableA)).toBe(buildIdentityKey(tableASame));
    expect(buildIdentityKey(tableA)).not.toBe(buildIdentityKey(tableDifferentDb));

    // services: normalized service name (separator-insensitive).
    const svcA = makeCandidate({ candidateType: 'service', name: 'Order Service' });
    const svcB = makeCandidate({ candidateType: 'service', name: 'order_service' });
    expect(buildIdentityKey(svcA)).toBe(buildIdentityKey(svcB));
  });
});
