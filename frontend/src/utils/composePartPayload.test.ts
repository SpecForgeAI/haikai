/**
 * Tests for composePartPayload Utility
 *
 * Spec 2026-02-06: Implement-Part Sequencing Workflow
 * Task Group 4: Frontend Part State Machine
 * Task 4.1: Write 4-6 focused tests for part state machine
 */

import { describe, it, expect } from 'vitest';
import { composePartPayload, type FeatureContext } from './composePartPayload';
import type { Part } from '../types/part';

describe('composePartPayload', () => {
  const mockFeatureContext: FeatureContext = {
    featureUnderstanding: 'Add user authentication to the application',
    scope: {
      in: ['Login page', 'JWT tokens', 'Password hashing'],
      out: ['Social login', 'MFA'],
    },
    acceptanceCriteria: [
      'Users can log in with email and password',
      'Sessions persist across page refreshes',
    ],
    assumptions: ['Backend API is ready', 'Database schema exists'],
  };

  it('should compose payload with correct PART header format', () => {
    const part: Part = {
      partIndex: 1,
      title: 'Database Schema Setup',
      intent: 'Create the database schema for user authentication',
    };

    const payload = composePartPayload(part, mockFeatureContext, 3);

    expect(payload).toContain('PART 1/3: Database Schema Setup');
  });

  it('should include PART_INTENT section with intent text', () => {
    const part: Part = {
      partIndex: 2,
      title: 'API Endpoints',
      intent: 'Implement login and logout API endpoints',
    };

    const payload = composePartPayload(part, mockFeatureContext, 3);

    expect(payload).toContain('PART_INTENT:');
    expect(payload).toContain('Implement login and logout API endpoints');
  });

  it('should include dependencies when provided', () => {
    const part: Part = {
      partIndex: 2,
      title: 'API Endpoints',
      intent: 'Implement login and logout API endpoints',
      dependencies: ['Part 1: Database Schema', 'Part 0: Initial setup'],
    };

    const payload = composePartPayload(part, mockFeatureContext, 3);

    expect(payload).toContain('Dependencies:');
    expect(payload).toContain('- Part 1: Database Schema');
    expect(payload).toContain('- Part 0: Initial setup');
  });

  it('should show "None" for dependencies when not provided', () => {
    const part: Part = {
      partIndex: 1,
      title: 'First Part',
      intent: 'This is the first part',
    };

    const payload = composePartPayload(part, mockFeatureContext, 2);

    expect(payload).toContain('Dependencies:');
    expect(payload).toContain('- None');
  });

  it('should include FEATURE_CONTEXT_JSON section with JSON block', () => {
    const part: Part = {
      partIndex: 1,
      title: 'Test Part',
      intent: 'Test intent',
    };

    const payload = composePartPayload(part, mockFeatureContext, 1);

    expect(payload).toContain('FEATURE_CONTEXT_JSON:');
    expect(payload).toContain('```json');
    expect(payload).toContain('```');
    expect(payload).toContain('"featureUnderstanding"');
    expect(payload).toContain('Add user authentication to the application');
  });

  it('should use correct delimiters between sections', () => {
    const part: Part = {
      partIndex: 1,
      title: 'Test Part',
      intent: 'Test intent',
    };

    const payload = composePartPayload(part, mockFeatureContext, 1);

    // Check that --- delimiter appears between sections
    const sections = payload.split('---');
    expect(sections.length).toBe(3); // Header, Intent, Context
  });
});
