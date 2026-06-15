/**
 * Unit tests for parseAndValidate() user_journey_links validation.
 *
 * Tests cover: valid links, absent links defaulting to [], empty source/target,
 * self-links, invalid relationship types, normalization, and duplicate detection.
 */

// Mock dotenv before importing anything else
jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

// Mock axios
jest.mock('axios');

// Mock the archModelClient
jest.mock('../services/archModelClient');

// Mock generateId for deterministic IDs in tests
jest.mock('../utils/generateId');

import { parseAndValidate, CANONICAL_RELATIONSHIP_TYPES } from '../services/userJourneysService';

// ============================================================================
// Helper: create a minimal valid payload with user_journeys and optional links
// ============================================================================

function buildPayload(overrides?: {
  user_journeys?: any[];
  activity_steps?: any[];
  user_journey_links?: any[];
}): string {
  return JSON.stringify({
    user_journeys: overrides?.user_journeys ?? [
      { name: 'Customer Onboarding' },
      { name: 'Product Purchase' },
    ],
    activity_steps: overrides?.activity_steps ?? [],
    ...(overrides?.user_journey_links !== undefined
      ? { user_journey_links: overrides.user_journey_links }
      : {}),
  });
}

// ============================================================================
// Tests
// ============================================================================

describe('parseAndValidate - user_journey_links validation', () => {

  // Test 1: Payload with valid user_journey_links array parses without errors;
  // links are present in returned input
  it('Test 1: valid user_journey_links array parses without errors and links are present in input', () => {
    const json = buildPayload({
      user_journey_links: [
        {
          source_user_journey_name: 'Customer Onboarding',
          target_user_journey_name: 'Product Purchase',
          relationship_type: 'PRECEDES',
          relationship_label: 'Onboarding leads to purchase',
          relationship_description: 'After onboarding the user typically purchases',
        },
      ],
    });

    const { input, errors } = parseAndValidate(json);

    expect(errors).toHaveLength(0);
    expect(input.user_journey_links).toBeDefined();
    expect(input.user_journey_links).toHaveLength(1);
    expect(input.user_journey_links![0].source_user_journey_name).toBe('Customer Onboarding');
    expect(input.user_journey_links![0].target_user_journey_name).toBe('Product Purchase');
    expect(input.user_journey_links![0].relationship_type).toBe('PRECEDES');
    expect(input.user_journey_links![0].relationship_label).toBe('Onboarding leads to purchase');
    expect(input.user_journey_links![0].relationship_description).toBe('After onboarding the user typically purchases');
  });

  // Test 2: Payload without user_journey_links field parses successfully
  // with user_journey_links defaulting to []
  it('Test 2: absent user_journey_links defaults to empty array', () => {
    const json = JSON.stringify({
      user_journeys: [
        { name: 'Customer Onboarding' },
      ],
    });

    const { input, errors } = parseAndValidate(json);

    expect(errors).toHaveLength(0);
    expect(input.user_journey_links).toBeDefined();
    expect(input.user_journey_links).toHaveLength(0);
  });

  // Test 3: Link with empty source_user_journey_name produces a validation error
  it('Test 3: empty source_user_journey_name produces validation error', () => {
    const json = buildPayload({
      user_journey_links: [
        {
          source_user_journey_name: '',
          target_user_journey_name: 'Product Purchase',
          relationship_type: 'PRECEDES',
        },
      ],
    });

    const { errors } = parseAndValidate(json);

    const sourceError = errors.find(
      e => e.context === 'user_journey_links[0].source_user_journey_name'
    );
    expect(sourceError).toBeDefined();
    expect(sourceError!.message).toContain('source_user_journey_name');
    expect(sourceError!.message).toContain('non-empty');
  });

  // Test 4: Link with empty target_user_journey_name produces a validation error
  it('Test 4: empty target_user_journey_name produces validation error', () => {
    const json = buildPayload({
      user_journey_links: [
        {
          source_user_journey_name: 'Customer Onboarding',
          target_user_journey_name: '   ',
          relationship_type: 'PRECEDES',
        },
      ],
    });

    const { errors } = parseAndValidate(json);

    const targetError = errors.find(
      e => e.context === 'user_journey_links[0].target_user_journey_name'
    );
    expect(targetError).toBeDefined();
    expect(targetError!.message).toContain('target_user_journey_name');
    expect(targetError!.message).toContain('non-empty');
  });

  // Test 5: Self-link (source == target, case-insensitive after trim) produces a validation error
  it('Test 5: self-link (source == target, case-insensitive) produces validation error', () => {
    const json = buildPayload({
      user_journey_links: [
        {
          source_user_journey_name: 'Customer Onboarding',
          target_user_journey_name: '  customer onboarding  ',
          relationship_type: 'RELATES_TO',
        },
      ],
    });

    const { errors } = parseAndValidate(json);

    const selfLinkError = errors.find(
      e => e.context === 'user_journey_links[0]' && e.message.includes('same journey')
    );
    expect(selfLinkError).toBeDefined();
    expect(selfLinkError!.message).toContain('Customer Onboarding');
  });

  // Test 6: Link with invalid relationship_type (not one of the 5 canonical values) produces a validation error
  it('Test 6: invalid relationship_type produces validation error', () => {
    const json = buildPayload({
      user_journey_links: [
        {
          source_user_journey_name: 'Customer Onboarding',
          target_user_journey_name: 'Product Purchase',
          relationship_type: 'FOLLOWS',
        },
      ],
    });

    const { errors } = parseAndValidate(json);

    const typeError = errors.find(
      e => e.context === 'user_journey_links[0].relationship_type'
    );
    expect(typeError).toBeDefined();
    expect(typeError!.message).toContain('FOLLOWS');
    expect(typeError!.message).toContain('Must be one of');
    // Verify the error message lists all canonical types
    for (const canonical of CANONICAL_RELATIONSHIP_TYPES) {
      expect(typeError!.message).toContain(canonical);
    }
  });

  // Test 7: Link with valid relationship_type after trim + uppercase normalization passes
  // (e.g., " precedes " normalizes to "PRECEDES")
  it('Test 7: relationship_type normalizes via trim + uppercase (e.g., " precedes " passes)', () => {
    const json = buildPayload({
      user_journey_links: [
        {
          source_user_journey_name: 'Customer Onboarding',
          target_user_journey_name: 'Product Purchase',
          relationship_type: ' precedes ',
        },
      ],
    });

    const { input, errors } = parseAndValidate(json);

    // Should have no relationship_type errors
    const typeErrors = errors.filter(
      e => e.context.includes('relationship_type')
    );
    expect(typeErrors).toHaveLength(0);

    // The link should be present in input
    expect(input.user_journey_links).toHaveLength(1);
  });

  // Test 8: Exact duplicate links (same source, target, and relationship_type after normalization)
  // produce a validation error
  it('Test 8: exact duplicate links produce validation error', () => {
    const json = buildPayload({
      user_journey_links: [
        {
          source_user_journey_name: 'Customer Onboarding',
          target_user_journey_name: 'Product Purchase',
          relationship_type: 'PRECEDES',
        },
        {
          source_user_journey_name: '  Customer Onboarding  ',
          target_user_journey_name: ' product purchase ',
          relationship_type: ' precedes ',
        },
      ],
    });

    const { errors } = parseAndValidate(json);

    const duplicateError = errors.find(
      e => e.context === 'user_journey_links[1]' && e.message.includes('Duplicate link')
    );
    expect(duplicateError).toBeDefined();
    expect(duplicateError!.message).toContain('PRECEDES');
  });
});
