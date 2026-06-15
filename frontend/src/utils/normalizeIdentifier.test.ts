/**
 * Tests for Identifier Normalization Utility
 *
 * Spec 2026-01-30: Normalize API Identifiers, Sanitize Newlines, Fix Streaming
 * Task Group 1: Identifier Normalization Utility
 */

import { describe, it, expect } from 'vitest';
import { normalizeIdentifier } from './normalizeIdentifier';

describe('normalizeIdentifier', () => {
  /**
   * Test 1: Basic normalization - trims, lowercases, and converts whitespace to hyphens.
   */
  it('normalizes "  Rivvy   Studios  " to "rivvy-studios"', () => {
    // Given
    const input = '  Rivvy   Studios  ';

    // When
    const result = normalizeIdentifier(input);

    // Then
    expect(result).toBe('rivvy-studios');
  });

  /**
   * Test 2: Lowercase conversion for mixed case input.
   */
  it('converts "MyCompany" to "mycompany"', () => {
    // Given
    const input = 'MyCompany';

    // When
    const result = normalizeIdentifier(input);

    // Then
    expect(result).toBe('mycompany');
  });

  /**
   * Test 3: Edge case - empty string returns empty string.
   */
  it('returns empty string for empty string input', () => {
    // Given
    const input = '';

    // When
    const result = normalizeIdentifier(input);

    // Then
    expect(result).toBe('');
  });

  /**
   * Test 4: Edge case - null/undefined returns empty string.
   */
  it('returns empty string for null or undefined input', () => {
    // When/Then
    expect(normalizeIdentifier(null as unknown as string)).toBe('');
    expect(normalizeIdentifier(undefined as unknown as string)).toBe('');
  });

  /**
   * Test 5: Single word with extra spaces.
   */
  it('normalizes "  Project  " to "project"', () => {
    // Given
    const input = '  Project  ';

    // When
    const result = normalizeIdentifier(input);

    // Then
    expect(result).toBe('project');
  });

  /**
   * Test 6: Already normalized input passes through unchanged.
   */
  it('returns "my-project" unchanged for already normalized input', () => {
    // Given
    const input = 'my-project';

    // When
    const result = normalizeIdentifier(input);

    // Then
    expect(result).toBe('my-project');
  });
});
