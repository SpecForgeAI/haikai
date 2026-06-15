/**
 * Tests for Save-Validation Improvement Series Step 3:
 * Frontend pre-save validators that mirror backend rules in
 * architecture-model-service ModelService.java.
 *
 * Validators under test:
 *   1. validateUIActionContractId - UIAction conditional contract_id
 *   2. validateLogicalDataEntityRelationshipEndpoints - relationship endpoints required
 *   3. validateUserJourneyLinkRelationshipType - relationship_type enum
 *   4. validateApplicationPointTargetPairwise - target_type/target_ref_id pairwise
 *
 * Plus integration tests at the validateModel level showing wiring.
 */

import { describe, it, expect } from 'vitest';
import {
  validateUIActionContractId,
  validateLogicalDataEntityRelationshipEndpoints,
  validateUserJourneyLinkRelationshipType,
  validateApplicationPointTargetPairwise,
  VALID_USER_JOURNEY_LINK_RELATIONSHIP_TYPES,
  validateModel,
} from '../validation';
import { emptyModel } from '../../config/defaults';
import type {
  UIAction,
  LogicalDataEntityRelationship,
  UserJourneyLink,
  ApplicationPoint,
  ArchitectureModel,
} from '../../types/model';

// ---------- Validator 1: validateUIActionContractId ----------

describe('validateUIActionContractId', () => {
  function makeAction(overrides: Partial<UIAction> & { contract_id?: string | null }): UIAction {
    return {
      id: 'ua_1',
      name: 'Test Action',
      trigger_type: 'Click',
      owner_type: 'Screen',
      owner_id: 'us_1',
      effect_type: 'Navigate',
      ...overrides,
    } as UIAction;
  }

  it('passes when effect_type is not CALL_API (no contract_id check)', () => {
    const action = makeAction({ effect_type: 'Navigate' });
    const errors = validateUIActionContractId([action]);
    expect(errors).toEqual([]);
  });

  it('fails when effect_type is CALL_API and contract_id is missing', () => {
    const action = makeAction({ effect_type: 'CALL_API' });
    const errors = validateUIActionContractId([action]);
    expect(errors.length).toBe(1);
    expect(errors[0].entityType).toBe('ui_actions');
    expect(errors[0].entityId).toBe('ua_1');
    expect(errors[0].field).toBe('contract_id');
    expect(errors[0].type).toBe('conditional_required');
    expect(errors[0].message).toContain("UIAction ['Test Action']");
    expect(errors[0].message).toContain('CALL_API');
    expect(errors[0].message).toContain('contract_id');
  });

  it('passes when effect_type is CALL_API and contract_id is set', () => {
    const action = makeAction({ effect_type: 'CALL_API', contract_id: 'contract_123' });
    const errors = validateUIActionContractId([action]);
    expect(errors).toEqual([]);
  });
});

// ---------- Validator 2: validateLogicalDataEntityRelationshipEndpoints ----------

describe('validateLogicalDataEntityRelationshipEndpoints', () => {
  function makeRel(overrides: Partial<LogicalDataEntityRelationship>): LogicalDataEntityRelationship {
    return {
      id: 'lder_1',
      description: '',
      tags: '',
      fromDataEntityPointId: 'dep_log_a',
      toDataEntityPointId: 'dep_log_b',
      ...overrides,
    } as LogicalDataEntityRelationship;
  }

  it('passes when both endpoints are set', () => {
    const rel = makeRel({});
    const errors = validateLogicalDataEntityRelationshipEndpoints([rel]);
    expect(errors).toEqual([]);
  });

  it('emits 1 error when fromDataEntityPointId is missing', () => {
    const rel = makeRel({ fromDataEntityPointId: '' });
    const errors = validateLogicalDataEntityRelationshipEndpoints([rel]);
    expect(errors.length).toBe(1);
    expect(errors[0].field).toBe('fromDataEntityPointId');
    expect(errors[0].type).toBe('missing_reference');
    expect(errors[0].entityType).toBe('logical_data_entity_relationships');
    expect(errors[0].message).toContain('LOGICAL_DATA_ENTITY_RELATIONSHIP');
    expect(errors[0].message).toContain('fromDataEntityPointId');
  });

  it('emits 1 error when toDataEntityPointId is missing', () => {
    const rel = makeRel({ toDataEntityPointId: '' });
    const errors = validateLogicalDataEntityRelationshipEndpoints([rel]);
    expect(errors.length).toBe(1);
    expect(errors[0].field).toBe('toDataEntityPointId');
    expect(errors[0].type).toBe('missing_reference');
    expect(errors[0].message).toContain('toDataEntityPointId');
  });

  it('emits 2 errors when both endpoints are missing', () => {
    const rel = makeRel({ fromDataEntityPointId: '', toDataEntityPointId: '' });
    const errors = validateLogicalDataEntityRelationshipEndpoints([rel]);
    expect(errors.length).toBe(2);
    const fields = errors.map((e) => e.field).sort();
    expect(fields).toEqual(['fromDataEntityPointId', 'toDataEntityPointId']);
  });
});

// ---------- Validator 3: validateUserJourneyLinkRelationshipType ----------

describe('validateUserJourneyLinkRelationshipType', () => {
  function makeLink(overrides: Record<string, unknown>): UserJourneyLink {
    return {
      id: 'ujl_1',
      source_user_journey_id: 'uj_1',
      target_user_journey_id: 'uj_2',
      relationship_type: 'RELATES_TO',
      ...overrides,
    } as UserJourneyLink;
  }

  it('exposes the allowed enum constant for re-use', () => {
    expect(VALID_USER_JOURNEY_LINK_RELATIONSHIP_TYPES).toEqual([
      'RELATES_TO',
      'PRECEDES',
      'DEPENDS_ON',
      'OPTIONALLY_LEADS_TO',
      'TRIGGERS',
    ]);
  });

  it('passes when relationship_type is one of the allowed values', () => {
    const link = makeLink({ relationship_type: 'TRIGGERS' });
    const errors = validateUserJourneyLinkRelationshipType([link]);
    expect(errors).toEqual([]);
  });

  it('fails when relationship_type is not in the allowed enum', () => {
    const link = makeLink({ relationship_type: 'NOT_A_REAL_TYPE' });
    const errors = validateUserJourneyLinkRelationshipType([link]);
    expect(errors.length).toBe(1);
    expect(errors[0].entityType).toBe('user_journey_links');
    expect(errors[0].field).toBe('relationship_type');
    expect(errors[0].type).toBe('invalid_enum');
    expect(errors[0].message).toContain('USER_JOURNEY_LINK');
    expect(errors[0].message).toContain("'NOT_A_REAL_TYPE'");
    expect(errors[0].message).toContain('RELATES_TO');
  });

  it('passes (skips check) when relationship_type is blank', () => {
    const link = makeLink({ relationship_type: '' });
    const errors = validateUserJourneyLinkRelationshipType([link]);
    expect(errors).toEqual([]);
  });
});

// ---------- Validator 4: validateApplicationPointTargetPairwise ----------

describe('validateApplicationPointTargetPairwise', () => {
  function makeAp(overrides: Partial<ApplicationPoint>): ApplicationPoint {
    return {
      id: 'ap_1',
      name: 'Test AP',
      description: '',
      kind: 'APPLICATION',
      application_id: 'app_1',
      point_type: '',
      tags: '',
      ...overrides,
    } as ApplicationPoint;
  }

  it('passes when both target_type and target_ref_id are set', () => {
    const ap = makeAp({ target_type: 'SERVICE', target_ref_id: 'svc_1' });
    const errors = validateApplicationPointTargetPairwise([ap]);
    expect(errors).toEqual([]);
  });

  it('passes when both target_type and target_ref_id are blank', () => {
    const ap = makeAp({ target_type: '', target_ref_id: '' });
    const errors = validateApplicationPointTargetPairwise([ap]);
    expect(errors).toEqual([]);
  });

  it('fails when only target_type is set (target_ref_id missing)', () => {
    const ap = makeAp({ target_type: 'SERVICE', target_ref_id: '' });
    const errors = validateApplicationPointTargetPairwise([ap]);
    expect(errors.length).toBe(1);
    expect(errors[0].entityType).toBe('application_points');
    expect(errors[0].entityId).toBe('ap_1');
    expect(errors[0].type).toBe('pairwise_constraint');
    expect(errors[0].field).toBe('target_type');
    expect(errors[0].message).toContain("APPLICATION_POINT ['Test AP']");
    expect(errors[0].message).toContain('target_type');
    expect(errors[0].message).toContain('target_ref_id');
  });

  it('fails when only target_ref_id is set (target_type missing)', () => {
    const ap = makeAp({ target_type: '', target_ref_id: 'svc_1' });
    const errors = validateApplicationPointTargetPairwise([ap]);
    expect(errors.length).toBe(1);
    expect(errors[0].field).toBe('target_ref_id');
    expect(errors[0].type).toBe('pairwise_constraint');
  });
});

// ---------- Integration: validateModel wiring ----------

describe('validateModel wires the new step-3 validators', () => {
  it('surfaces a UIAction.contract_id error from validateModel', () => {
    const model: ArchitectureModel = {
      ...emptyModel,
      metaModel: {
        ...emptyModel.metaModel,
        entities: {
          ...emptyModel.metaModel.entities,
          ui_actions: [
            {
              id: 'ua_1',
              name: 'Submit',
              trigger_type: 'Click',
              owner_type: 'Screen',
              owner_id: 'us_1',
              effect_type: 'CALL_API',
              // contract_id intentionally omitted
            } as UIAction,
          ],
        },
      },
    };

    const errors = validateModel(model);
    const match = errors.find(
      (e) => e.entityId === 'ua_1' && e.field === 'contract_id' && e.type === 'conditional_required'
    );
    expect(match).toBeDefined();
    expect(match!.message).toContain('CALL_API');
  });

  it('surfaces an ApplicationPoint pairwise error from validateModel', () => {
    const model: ArchitectureModel = {
      ...emptyModel,
      metaModel: {
        ...emptyModel.metaModel,
        entities: {
          ...emptyModel.metaModel.entities,
          application_points: [
            {
              id: 'ap_pair_1',
              name: 'Bad Pair',
              description: '',
              kind: 'APPLICATION',
              application_id: 'app_1',
              target_type: 'SERVICE',
              target_ref_id: '', // pairwise mismatch
              point_type: '',
              tags: '',
            } as ApplicationPoint,
          ],
        },
      },
    };

    const errors = validateModel(model);
    const match = errors.find(
      (e) => e.entityId === 'ap_pair_1' && e.type === 'pairwise_constraint'
    );
    expect(match).toBeDefined();
    expect(match!.message).toContain("APPLICATION_POINT ['Bad Pair']");
  });
});
