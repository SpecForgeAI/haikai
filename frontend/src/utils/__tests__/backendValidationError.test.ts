/**
 * Tests for `mapBackendErrorToValidationErrors`.
 *
 * Spec: Step 4 of the save-validation improvement series (2026-05-08).
 *
 * Verifies that:
 *   1. Structured backend errors (entity_type + code present) produce a
 *      one-element ValidationError[] with the right shape.
 *   2. Bare backend errors (only `message`) produce [].
 *   3. Backend errors with `code` but no `entityType` produce [].
 *   4. Each known `code` token maps to the expected
 *      {@link ValidationError.type} variant.
 */

import { describe, it, expect } from 'vitest';
import {
  mapBackendErrorToValidationErrors,
  CODE_TO_TYPE_MAPPING,
  BackendValidationErrorInput,
} from '../backendValidationError';
import type { ValidationError } from '../../types/config';

describe('mapBackendErrorToValidationErrors', () => {
  it('returns one ValidationError when the envelope has entity_type AND code AND field', () => {
    const input: BackendValidationErrorInput = {
      status: 400,
      code: 'application_id_required',
      field: 'application_id',
      message: "ApplicationPoint validation failed for id 'ap-1' (name: 'Login'): application_id is required.",
      entityType: 'application_points',
      entityId: 'ap-1',
      entityName: 'Login',
    };

    const result = mapBackendErrorToValidationErrors(input);

    expect(result).toHaveLength(1);
    const err = result[0];
    expect(err.entityType).toBe('application_points');
    expect(err.entityId).toBe('ap-1');
    expect(err.entityName).toBe('Login');
    expect(err.field).toBe('application_id');
    expect(err.message).toBe(input.message);
    expect(err.type).toBe('required');
  });

  it('returns [] for a bare backend error carrying only `message`', () => {
    const input: BackendValidationErrorInput = {
      status: 500,
      message: 'Internal server error',
    };

    const result = mapBackendErrorToValidationErrors(input);

    expect(result).toEqual([]);
  });

  it('returns [] when `code` is present but `entityType` is missing', () => {
    const input: BackendValidationErrorInput = {
      status: 400,
      code: 'duplicate_name',
      field: 'name',
      message: 'Duplicate name',
      // entityType deliberately omitted
    };

    const result = mapBackendErrorToValidationErrors(input);

    expect(result).toEqual([]);
  });

  it('returns [] when `entityType` is present but `code` is missing', () => {
    const input: BackendValidationErrorInput = {
      status: 400,
      entityType: 'application_points',
      entityId: 'ap-1',
      message: 'something failed',
      // code deliberately omitted
    };

    const result = mapBackendErrorToValidationErrors(input);

    expect(result).toEqual([]);
  });

  it('returns [] when called with undefined', () => {
    const result = mapBackendErrorToValidationErrors(undefined);
    expect(result).toEqual([]);
  });

  it('omits entityName from the output when the backend did not supply one', () => {
    const input: BackendValidationErrorInput = {
      status: 400,
      code: 'endpoint_required',
      field: 'from_data_entity_point_id',
      message: 'fromDataEntityPointId is required',
      entityType: 'logical_data_entity_relationships',
      entityId: 'rel-1',
      // entityName omitted -- relationships have no name
    };

    const result = mapBackendErrorToValidationErrors(input);

    expect(result).toHaveLength(1);
    expect(result[0].entityName).toBeUndefined();
  });

  it('falls back to "missing_reference" type for unknown codes (forward-compatible)', () => {
    const input: BackendValidationErrorInput = {
      status: 400,
      code: 'some_brand_new_code_we_have_not_mapped_yet',
      field: 'whatever',
      message: 'A new validation rule failed',
      entityType: 'application_points',
      entityId: 'ap-1',
    };

    const result = mapBackendErrorToValidationErrors(input);

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('missing_reference');
  });

  it('defaults entityId and field to "" when the backend omits them', () => {
    const input: BackendValidationErrorInput = {
      status: 400,
      code: 'application_id_required',
      message: 'something failed',
      entityType: 'application_points',
    };

    const result = mapBackendErrorToValidationErrors(input);

    expect(result).toHaveLength(1);
    expect(result[0].entityId).toBe('');
    expect(result[0].field).toBe('');
  });

  // -------------------------------------------------------------------
  // Per-code type-mapping coverage. One assertion per documented code.
  // -------------------------------------------------------------------

  describe('CODE_TO_TYPE_MAPPING coverage', () => {
    const expected: Array<[string, ValidationError['type']]> = [
      ['application_id_required', 'required'],
      ['target_pairwise', 'pairwise_constraint'],
      ['invalid_target_type', 'invalid_enum'],
      ['invalid_target_ref', 'missing_reference'],
      ['endpoint_required', 'missing_reference'],
      ['xor_constraint', 'xor_constraint'],
      ['conditional_required', 'conditional_required'],
      ['invalid_relationship_type', 'invalid_enum'],
      ['name_required', 'required'],
    ];

    it.each(expected)('code "%s" maps to type "%s"', (code, type) => {
      // Confirm the static map and the function both agree.
      expect(CODE_TO_TYPE_MAPPING[code]).toBe(type);

      const result = mapBackendErrorToValidationErrors({
        status: 400,
        code,
        field: 'f',
        message: 'm',
        entityType: 'some_entity_type',
        entityId: 'e-1',
      });
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe(type);
    });
  });
});
