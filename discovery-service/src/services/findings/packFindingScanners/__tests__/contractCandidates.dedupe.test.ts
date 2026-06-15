/**
 * Tests for `dedupeContractAttributeCandidates` (2026-06-05).
 *
 * Collapses `logical_data_attributes` duplicated when the same XSD type is
 * parsed by more than one contract sub-pass (a standalone IR `.xsd` file AND a
 * WADL `<grammars><include>`, and/or the SOAP message reconciliation). Identity
 * is `(parent-entity-name, field-name)`:
 *  - same field of the same parent emitted twice -> ONE survivor (the dup that
 *    was inflating the 4325-item review agenda);
 *  - the same field name under DIFFERENT parents -> kept distinct (no
 *    over-merge: `EntityA.shortName` != `EntityB.shortName`);
 *  - non-attribute candidates pass through untouched and in order.
 */

import { dedupeContractAttributeCandidates } from '../contractCandidates';
import type {
  DiscoveryCandidate,
  CandidateType,
} from '../../../../types/candidate';

let seq = 0;

function attr(
  parentEntityName: string,
  fieldName: string,
  overrides: Partial<DiscoveryCandidate> = {},
): DiscoveryCandidate {
  seq += 1;
  return {
    id: `attr-${seq}`,
    runId: 'run-1',
    candidateType: 'logical_data_attributes' as CandidateType,
    name: fieldName,
    confidence: 0.9,
    status: 'proposed',
    sourceClusterIds: [],
    // Each pass mints its OWN parent entity, so the duplicate attributes carry
    // DIFFERENT parentCandidateIds -- proving the dedupe keys off the stable
    // entity NAME (data.logicalEntityName), not the id.
    parentCandidateId: `parent-${parentEntityName}-${seq}`,
    data: {
      fieldName,
      dataType: 'string',
      logicalEntityName: parentEntityName,
    },
    synthesizedAt: '2026-06-05T00:00:00.000Z',
    ...overrides,
  } as DiscoveryCandidate;
}

function entity(name: string): DiscoveryCandidate {
  seq += 1;
  return {
    id: `ent-${seq}`,
    runId: 'run-1',
    candidateType: 'logical_data_entities' as CandidateType,
    name,
    confidence: 0.9,
    status: 'proposed',
    sourceClusterIds: [],
    data: {},
    synthesizedAt: '2026-06-05T00:00:00.000Z',
  } as DiscoveryCandidate;
}

describe('dedupeContractAttributeCandidates', () => {
  it('collapses the same field of the same parent (emitted by two passes) into one, keeping the first', () => {
    const input = [
      attr('FilterRequest', 'shortName'), // WADL-grammar pass
      attr('FilterRequest', 'shortName'), // standalone-XSD pass (same field)
    ];
    const out = dedupeContractAttributeCandidates(input);

    const shortNames = out.filter(
      (c) =>
        c.candidateType === 'logical_data_attributes' && c.name === 'shortName',
    );
    expect(shortNames).toHaveLength(1);
    expect(out[0].id).toBe(input[0].id); // first occurrence survives
  });

  it('keeps the SAME field name distinct under DIFFERENT parent entities (no over-merge)', () => {
    const input = [
      attr('EntityA', 'shortName'),
      attr('EntityB', 'shortName'),
      attr('EntityC', 'shortName'),
    ];
    const out = dedupeContractAttributeCandidates(input);
    expect(out).toHaveLength(3);
  });

  it('normalizes case/underscores so cross-pass spelling variants of the same field still collapse', () => {
    const input = [
      attr('FilterRequest', 'shortName'),
      attr('filter_request', 'short_name'),
    ];
    const out = dedupeContractAttributeCandidates(input);
    expect(out).toHaveLength(1);
  });

  it('passes non-attribute candidates through untouched and in original order', () => {
    const e1 = entity('FilterRequest');
    const a1 = attr('FilterRequest', 'shortName');
    const a2 = attr('FilterRequest', 'shortName'); // duplicate of a1
    const e2 = entity('FilterResponse');

    const out = dedupeContractAttributeCandidates([e1, a1, a2, e2]);
    expect(out.map((c) => c.id)).toEqual([e1.id, a1.id, e2.id]);
  });

  it('falls back to parentCandidateId when logicalEntityName is absent (does NOT collapse different parents)', () => {
    const a1 = attr('x', 'shortName', {
      parentCandidateId: 'p1',
      data: { fieldName: 'shortName' }, // no logicalEntityName
    });
    const a2 = attr('x', 'shortName', {
      parentCandidateId: 'p2',
      data: { fieldName: 'shortName' }, // no logicalEntityName
    });
    const out = dedupeContractAttributeCandidates([a1, a2]);
    expect(out).toHaveLength(2);
  });
});
