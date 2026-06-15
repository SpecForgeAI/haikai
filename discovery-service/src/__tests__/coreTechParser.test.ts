/**
 * Tests for parseCoretech() utility function.
 *
 * Spec: Service-Scoped Discovery (TG8)
 * Task 8.8: Focused tests for core utility functions
 *
 * Tests:
 * 1. "Java 25, Spring Boot 3.4" produces correct language/technology/version pairs
 * 2. "Spring Boot" (no version) produces technology without version
 * 3. "Java" (single entry, no version) produces language without version
 * 4. "" (empty string) produces empty result
 * 5. Trailing commas and extra spaces are handled gracefully
 * 6. Version-less multi-word technology is classified correctly
 */

import { parseCoretech } from '../utils/coreTechParser';

describe('parseCoretech', () => {
  it('parses "Java 25, Spring Boot 3.4" into correct language/technology/version pairs', () => {
    const result = parseCoretech('Java 25, Spring Boot 3.4');

    expect(result).toEqual({
      '0': { language: 'Java', version: '25' },
      '1': { technology: 'Spring Boot', version: '3.4' },
    });
  });

  it('parses "Spring Boot" (no version) into technology without version', () => {
    const result = parseCoretech('Spring Boot');

    expect(result).toEqual({
      '0': { technology: 'Spring Boot' },
    });
  });

  it('parses "Java" (single entry, no version) into language without version', () => {
    const result = parseCoretech('Java');

    expect(result).toEqual({
      '0': { language: 'Java' },
    });
  });

  it('returns empty result for empty string', () => {
    const result = parseCoretech('');
    expect(result).toEqual({});
  });

  it('returns empty result for whitespace-only string', () => {
    const result = parseCoretech('   ');
    expect(result).toEqual({});
  });

  it('handles trailing commas and extra spaces gracefully', () => {
    const result = parseCoretech('  Java 25 ,  Spring Boot 3.4 , ');

    expect(result).toEqual({
      '0': { language: 'Java', version: '25' },
      '1': { technology: 'Spring Boot', version: '3.4' },
    });
  });

  it('classifies known languages correctly (TypeScript, Python, Go)', () => {
    const result = parseCoretech('TypeScript 5.3, Python 3.12, Go 1.21');

    expect(result).toEqual({
      '0': { language: 'TypeScript', version: '5.3' },
      '1': { language: 'Python', version: '3.12' },
      '2': { language: 'Go', version: '1.21' },
    });
  });

  it('classifies unknown multi-word entries as technology', () => {
    const result = parseCoretech('React Native 0.73, PostgreSQL 16');

    expect(result).toEqual({
      '0': { technology: 'React Native', version: '0.73' },
      '1': { technology: 'PostgreSQL', version: '16' },
    });
  });
});
