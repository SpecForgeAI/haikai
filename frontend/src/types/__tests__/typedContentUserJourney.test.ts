/**
 * TypedContent USER_JOURNEY Registration Tests
 *
 * Spec 2026-04-03: User Journey Diagram Edit and Save Flow
 * Task Group 2, Task 2.1: 4 focused tests for USER_JOURNEY typed content registration
 *
 * Test 1: isDiagramTypedContentType('USER_JOURNEY') returns true
 * Test 2: createDefaultTypedContent('USER_JOURNEY') returns valid envelope
 * Test 3: createDefaultUserJourneyContent() returns well-formed default content
 * Test 4: createDefaultTypedContent('General') still returns undefined (regression guard)
 */

import { describe, it, expect } from 'vitest';
import {
  isDiagramTypedContentType,
  createDefaultTypedContent,
  createDefaultUserJourneyContent,
} from '../typedContent';
import type { UserJourneyContent } from '../typedContent';

describe('USER_JOURNEY TypedContent Registration', () => {
  it('isDiagramTypedContentType("USER_JOURNEY") returns true', () => {
    expect(isDiagramTypedContentType('USER_JOURNEY')).toBe(true);
  });

  it('createDefaultTypedContent("USER_JOURNEY") returns an envelope with type, version, and content', () => {
    const envelope = createDefaultTypedContent('USER_JOURNEY');
    expect(envelope).toBeDefined();
    expect(envelope!.type).toBe('USER_JOURNEY');
    // USER_JOURNEY defaults to schema version 2 (v2 added sync metadata).
    expect(envelope!.version).toBe(2);
    expect(envelope!.content).toBeDefined();

    // Verify the content has the expected USER_JOURNEY shape
    const content = envelope!.content as UserJourneyContent;
    expect(content.journey).toBeDefined();
    expect(Array.isArray(content.lanes)).toBe(true);
    expect(Array.isArray(content.steps)).toBe(true);
    expect(Array.isArray(content.edges)).toBe(true);
    expect(content.render_hints).toBeDefined();
    expect(content.diagram_type).toBe('USER_JOURNEY');
    expect(content.version).toBe('1');
  });

  it('createDefaultUserJourneyContent() returns a well-formed default UserJourneyContent object', () => {
    const content = createDefaultUserJourneyContent();

    // Journey metadata should have empty defaults
    expect(content.journey).toBeDefined();
    expect(content.journey.id).toBe('');
    expect(content.journey.name).toBe('');
    expect(content.journey.description).toBe('');
    expect(content.journey.user_role_id).toBe('');
    expect(content.journey.user_role_name).toBe('');
    expect(content.journey.parent_business_process_id).toBe('');
    expect(content.journey.parent_business_process_name).toBe('');

    // Arrays should be empty
    expect(content.lanes).toEqual([]);
    expect(content.steps).toEqual([]);
    expect(content.edges).toEqual([]);

    // Render hints should have sensible defaults
    expect(content.render_hints.lane_axis).toBe('HORIZONTAL');
    expect(content.render_hints.flow_direction).toBe('LEFT_TO_RIGHT');
    expect(content.render_hints.show_title).toBe(true);

    // Type metadata
    expect(content.diagram_type).toBe('USER_JOURNEY');
    expect(content.version).toBe('1');
  });

  it('createDefaultTypedContent("General") still returns undefined (regression guard)', () => {
    const result = createDefaultTypedContent('General');
    expect(result).toBeUndefined();
  });
});
