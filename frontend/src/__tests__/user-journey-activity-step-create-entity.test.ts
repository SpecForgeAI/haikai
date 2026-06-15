/**
 * Task Group 2 Tests: createEmptyEntity Switch Cases
 * for User Journeys and Activity Steps entity types.
 *
 * Spec: 2026-04-01-user-journey-business-architecture-table-ui
 * FR4: Empty Entity Creation
 */

import { createEmptyEntity } from '../components/Grid/Grid';

describe('Task Group 2: createEmptyEntity for User Journeys and Activity Steps', () => {

  // Test 1: createEmptyEntity('user_journeys') returns correct structure
  it('createEmptyEntity("user_journeys") returns correct default entity with all 6 fields', () => {
    const entity = createEmptyEntity('user_journeys');

    expect(entity.id).toBeDefined();
    expect(typeof entity.id).toBe('string');
    expect(entity.id.length).toBeGreaterThan(0);

    expect(entity.name).toBe('');
    expect(entity.description).toBe('');
    expect(entity.tags).toBe('');
    expect((entity as any).primary_business_user_id).toBe('');
    expect((entity as any).parent_business_process_id).toBe('');
  });

  // Test 2: createEmptyEntity('activity_steps') returns correct structure
  it('createEmptyEntity("activity_steps") returns correct default entity with all 9 fields', () => {
    const entity = createEmptyEntity('activity_steps');

    expect(entity.id).toBeDefined();
    expect(typeof entity.id).toBe('string');
    expect(entity.id.length).toBeGreaterThan(0);

    expect((entity as any).user_journey_id).toBe('');
    expect(entity.name).toBe('');
    expect(entity.description).toBe('');
    expect(entity.tags).toBe('');
    expect((entity as any).sequence_order).toBeUndefined();
    expect((entity as any).process_activity_id).toBe('');
    expect((entity as any).business_user_id).toBe('');
    expect((entity as any).application_id).toBe('');
  });

  // Test 3: createEmptyEntity('user_journeys') does NOT include unexpected extra fields
  it('createEmptyEntity("user_journeys") does NOT include unexpected extra fields', () => {
    const entity = createEmptyEntity('user_journeys');
    const keys = Object.keys(entity);

    // Should NOT have activity_steps-specific fields
    expect(keys).not.toContain('sequence_order');
    expect(keys).not.toContain('application_id');
    expect(keys).not.toContain('user_journey_id');
    expect(keys).not.toContain('process_activity_id');
    expect(keys).not.toContain('business_user_id');
  });

  // Test 4: createEmptyEntity('activity_steps') has exactly 9 keys
  it('createEmptyEntity("activity_steps") has exactly 9 keys', () => {
    const entity = createEmptyEntity('activity_steps');
    const keys = Object.keys(entity);

    expect(keys).toHaveLength(9);
    expect(keys).toEqual(expect.arrayContaining([
      'id',
      'user_journey_id',
      'name',
      'description',
      'tags',
      'sequence_order',
      'process_activity_id',
      'business_user_id',
      'application_id',
    ]));
  });
});
