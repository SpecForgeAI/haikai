/**
 * Tests for specs validation in generate_specs intent
 *
 * Spec 2026-01-09: Implement Generate Specs - Iteration 4
 * Task Group 1: Type Extensions and Validation
 */

import { validateGeneratedSpecs } from '../services/specsValidator';

describe('validateGeneratedSpecs', () => {
  describe('valid inputs', () => {
    it('should return valid: true with specs array for valid JSON array with proper /agent-os:write-spec prefixes', () => {
      const content = JSON.stringify([
        '/agent-os:write-spec name: test-spec\nversion: 1.0.0',
        '/agent-os:write-spec name: another-spec\nversion: 2.0.0',
      ]);

      const result = validateGeneratedSpecs(content);

      expect(result.valid).toBe(true);
      expect(result.specs).toEqual([
        '/agent-os:write-spec name: test-spec\nversion: 1.0.0',
        '/agent-os:write-spec name: another-spec\nversion: 2.0.0',
      ]);
      expect(result.error).toBeUndefined();
    });

    it('should return valid: true for single-element array with valid spec', () => {
      const content = JSON.stringify([
        '/agent-os:write-spec feature: login\nsteps:\n  - step1\n  - step2',
      ]);

      const result = validateGeneratedSpecs(content);

      expect(result.valid).toBe(true);
      expect(result.specs).toHaveLength(1);
    });
  });

  describe('invalid JSON', () => {
    it('should return valid: false with error message for invalid JSON', () => {
      const content = 'not valid json at all';

      const result = validateGeneratedSpecs(content);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Response is not valid JSON');
      expect(result.specs).toBeUndefined();
    });

    it('should return valid: false for malformed JSON', () => {
      const content = '["spec1", "spec2"'; // Missing closing bracket

      const result = validateGeneratedSpecs(content);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Response is not valid JSON');
    });
  });

  describe('non-array JSON', () => {
    it('should return valid: false with error message for JSON object', () => {
      const content = JSON.stringify({ spec: '/agent-os:write-spec test' });

      const result = validateGeneratedSpecs(content);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Response is not a JSON array');
      expect(result.specs).toBeUndefined();
    });

    it('should return valid: false for JSON string', () => {
      const content = JSON.stringify('/agent-os:write-spec test');

      const result = validateGeneratedSpecs(content);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Response is not a JSON array');
    });

    it('should return valid: false for JSON number', () => {
      const content = '42';

      const result = validateGeneratedSpecs(content);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Response is not a JSON array');
    });
  });

  describe('array with invalid elements', () => {
    it('should return valid: false with error message for array containing non-string elements', () => {
      const content = JSON.stringify([
        '/agent-os:write-spec test',
        42,
        '/agent-os:write-spec another',
      ]);

      const result = validateGeneratedSpecs(content);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Array contains non-string elements');
      expect(result.specs).toBeUndefined();
    });

    it('should return valid: false for array with null element', () => {
      const content = JSON.stringify(['/agent-os:write-spec test', null]);

      const result = validateGeneratedSpecs(content);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Array contains non-string elements');
    });

    it('should return valid: false for array with empty string', () => {
      const content = JSON.stringify(['/agent-os:write-spec test', '']);

      const result = validateGeneratedSpecs(content);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Array contains non-string elements');
    });
  });

  describe('invalid spec format', () => {
    it('should return valid: false with error message for strings not starting with /agent-os:write-spec', () => {
      const content = JSON.stringify([
        '/agent-os:write-spec valid spec',
        'invalid spec without prefix',
      ]);

      const result = validateGeneratedSpecs(content);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid spec format');
      expect(result.specs).toBeUndefined();
    });

    it('should return valid: false for spec starting with wrong prefix', () => {
      const content = JSON.stringify(['/agent-os:read-spec something']);

      const result = validateGeneratedSpecs(content);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid spec format');
    });
  });

  describe('edge cases', () => {
    it('should return valid: false for empty array', () => {
      const content = JSON.stringify([]);

      const result = validateGeneratedSpecs(content);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Response is an empty array');
    });

    it('should handle spec with complex YAML content', () => {
      const yamlSpec = `/agent-os:write-spec
name: complex-feature
version: 1.0.0
tasks:
  - id: task-1
    name: Setup authentication
    steps:
      - Configure OAuth2
      - Create login page
  - id: task-2
    name: Implement API
    dependencies:
      - task-1`;

      const content = JSON.stringify([yamlSpec]);

      const result = validateGeneratedSpecs(content);

      expect(result.valid).toBe(true);
      expect(result.specs?.[0]).toBe(yamlSpec);
    });
  });
});
