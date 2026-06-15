/**
 * Tests for Phase 1b linker defaults and rule registry.
 *
 * Spec: Phase 1b Linker and DecisionTask Engine (Increment 8)
 * Task Group 2: Confidence Thresholds and Linker Rule Registry
 *
 * 3 focused tests:
 * 1. AUTO_ACCEPT_THRESHOLD and AMBIGUOUS_THRESHOLD are exported with correct defaults
 * 2. initializeLinkerRuleRegistry() populates the registry with the expected number of rules (4)
 * 3. registerLinkerRule() adds a new rule and getLinkerRuleRegistry() returns it
 */

import { AUTO_ACCEPT_THRESHOLD, AMBIGUOUS_THRESHOLD } from '../constants/linkerDefaults';
import {
  initializeLinkerRuleRegistry,
  getLinkerRuleRegistry,
  registerLinkerRule,
} from '../services/linkerRuleRegistry';
import { LinkerRule, CandidateRelationship } from '../types';

describe('Linker Defaults and Rule Registry', () => {

  // ==========================================================================
  // Test 1: Threshold constants have correct default values
  // ==========================================================================
  test('AUTO_ACCEPT_THRESHOLD and AMBIGUOUS_THRESHOLD are exported with correct defaults (0.8 and 0.4)', () => {
    expect(AUTO_ACCEPT_THRESHOLD).toBe(0.8);
    expect(AMBIGUOUS_THRESHOLD).toBe(0.4);

    // Verify thresholds are numbers
    expect(typeof AUTO_ACCEPT_THRESHOLD).toBe('number');
    expect(typeof AMBIGUOUS_THRESHOLD).toBe('number');

    // Verify ordering: AMBIGUOUS < AUTO_ACCEPT
    expect(AMBIGUOUS_THRESHOLD).toBeLessThan(AUTO_ACCEPT_THRESHOLD);

    // Verify both are within valid confidence range
    expect(AUTO_ACCEPT_THRESHOLD).toBeGreaterThan(0.0);
    expect(AUTO_ACCEPT_THRESHOLD).toBeLessThanOrEqual(1.0);
    expect(AMBIGUOUS_THRESHOLD).toBeGreaterThan(0.0);
    expect(AMBIGUOUS_THRESHOLD).toBeLessThanOrEqual(1.0);
  });

  // ==========================================================================
  // Test 2: initializeLinkerRuleRegistry populates with 4 rules
  // ==========================================================================
  test('initializeLinkerRuleRegistry() populates the registry with the expected number of rules (4)', () => {
    initializeLinkerRuleRegistry();

    const registry = getLinkerRuleRegistry();
    expect(registry.size).toBe(4);

    // Verify all expected rule IDs are present
    expect(registry.has('contains-by-path')).toBe(true);
    expect(registry.has('imports-by-pattern')).toBe(true);
    expect(registry.has('extends-by-pattern')).toBe(true);
    expect(registry.has('references-by-symbol')).toBe(true);

    // Verify each entry is a valid LinkerRule
    for (const [id, rule] of registry) {
      expect(rule.id).toBe(id);
      expect(typeof rule.name).toBe('string');
      expect(typeof rule.description).toBe('string');
      expect(typeof rule.targetRelationshipType).toBe('string');
      expect(typeof rule.match).toBe('function');
    }
  });

  // ==========================================================================
  // Test 3: registerLinkerRule adds a new rule to the registry
  // ==========================================================================
  test('registerLinkerRule() adds a new rule to the registry and getLinkerRuleRegistry() returns it', () => {
    initializeLinkerRuleRegistry();

    const registry = getLinkerRuleRegistry();
    const initialSize = registry.size;

    // Create a custom test rule
    const testRule: LinkerRule = {
      id: 'test-custom-rule',
      name: 'Test Custom Rule',
      description: 'A test rule for validating registration.',
      targetRelationshipType: 'references',
      match: (): CandidateRelationship[] => [],
    };

    registerLinkerRule(testRule);

    // Registry should now have one more rule
    expect(registry.size).toBe(initialSize + 1);
    expect(registry.has('test-custom-rule')).toBe(true);

    const retrieved = registry.get('test-custom-rule');
    expect(retrieved).toBeDefined();
    expect(retrieved!.id).toBe('test-custom-rule');
    expect(retrieved!.name).toBe('Test Custom Rule');
    expect(retrieved!.targetRelationshipType).toBe('references');
  });
});
