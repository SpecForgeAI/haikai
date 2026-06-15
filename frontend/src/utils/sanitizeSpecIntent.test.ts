/**
 * Tests for sanitizeSpecIntent utility
 *
 * Spec 2026-01-30: Normalize API Identifiers, Sanitize Newlines, Fix Streaming
 * Task 2.5: Implement spec intent newline sanitization
 */

import { describe, it, expect } from 'vitest';
import { sanitizeSpecIntent } from './sanitizeSpecIntent';

describe('sanitizeSpecIntent', () => {
  /**
   * Test 1: Basic newline replacement.
   * Verifies \n characters are replaced with space.
   */
  it('replaces newline characters with space', () => {
    const input = '/shape-spec ## Feature\nDescription';
    const result = sanitizeSpecIntent(input);
    expect(result).not.toContain('\n');
    expect(result).toBe('/shape-spec ## Feature Description');
  });

  /**
   * Test 2: Windows-style CRLF replacement.
   * Verifies \r\n characters are replaced with single space.
   */
  it('replaces CRLF sequences with single space', () => {
    const input = '/shape-spec ## Feature\r\nDescription\r\nNext line';
    const result = sanitizeSpecIntent(input);
    expect(result).not.toContain('\r');
    expect(result).not.toContain('\n');
    expect(result).toBe('/shape-spec ## Feature Description Next line');
  });

  /**
   * Test 3: Multiple consecutive newlines collapse to single space.
   * Verifies that blank lines (multiple newlines) become single space.
   */
  it('collapses multiple newlines into single space', () => {
    const input = '/shape-spec ## Feature\n\n\nDescription';
    const result = sanitizeSpecIntent(input);
    expect(result).toBe('/shape-spec ## Feature Description');
  });

  /**
   * Test 4: Consecutive spaces collapse to single space.
   * Verifies whitespace is normalized.
   */
  it('collapses consecutive spaces into single space', () => {
    const input = '/shape-spec ## Feature    Description';
    const result = sanitizeSpecIntent(input);
    expect(result).toBe('/shape-spec ## Feature Description');
  });

  /**
   * Test 5: Trims leading/trailing whitespace.
   */
  it('trims leading and trailing whitespace', () => {
    const input = '   /shape-spec ## Feature   ';
    const result = sanitizeSpecIntent(input);
    expect(result).toBe('/shape-spec ## Feature');
  });

  /**
   * Test 6: Combined markdown-formatted spec intent.
   * Tests a realistic multi-line spec intent with markdown formatting.
   */
  it('sanitizes full markdown-formatted spec intent', () => {
    const input = `/shape-spec ## Feature Description
A user authentication system that allows users to log in with email and password.

## In Scope
- Email/password login
- Password reset flow
- Session management

## Out of Scope
- Social login
- Multi-factor authentication

## Assumptions
- Users have valid email addresses
- Password requirements follow standard security practices

## Acceptance Criteria
- Users can log in with valid credentials
- Invalid credentials show appropriate error messages`;

    const result = sanitizeSpecIntent(input);

    // Should be single line
    expect(result).not.toContain('\n');
    expect(result).not.toContain('\r');

    // Should preserve content (no double spaces)
    expect(result).not.toContain('  ');

    // Should start with /shape-spec prefix
    expect(result.startsWith('/shape-spec ')).toBe(true);

    // Should contain key sections
    expect(result).toContain('## Feature Description');
    expect(result).toContain('## In Scope');
    expect(result).toContain('## Out of Scope');
    expect(result).toContain('## Assumptions');
    expect(result).toContain('## Acceptance Criteria');
  });

  /**
   * Test 7: Empty string returns empty string.
   */
  it('returns empty string for empty input', () => {
    const result = sanitizeSpecIntent('');
    expect(result).toBe('');
  });

  /**
   * Test 8: Null/undefined handling.
   */
  it('returns empty string for null or undefined input', () => {
    expect(sanitizeSpecIntent(null as unknown as string)).toBe('');
    expect(sanitizeSpecIntent(undefined as unknown as string)).toBe('');
  });

  /**
   * Test 9: String with only whitespace and newlines.
   */
  it('returns empty string for whitespace-only input', () => {
    const result = sanitizeSpecIntent('   \n\n   \r\n   ');
    expect(result).toBe('');
  });

  /**
   * Test 10: Mixed carriage returns and newlines.
   */
  it('handles mixed \\r and \\n sequences correctly', () => {
    const input = '/shape-spec A\rB\nC\r\nD';
    const result = sanitizeSpecIntent(input);
    expect(result).toBe('/shape-spec A B C D');
  });
});
