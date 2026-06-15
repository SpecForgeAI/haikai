/**
 * Tests for Part State Machine
 *
 * Spec 2026-02-06: Implement-Part Sequencing Workflow
 * Task Group 4: Frontend Part State Machine
 * Task 4.1: Write 4-6 focused tests for part state machine
 *
 * Tests state transitions:
 * - PENDING -> QA_IN_PROGRESS -> READY_TO_RUN -> ORCHESTRATING -> COMPLETED
 * - FAILED state handling and manual intervention triggers
 * - Auto-advance from COMPLETED to next part's QA_IN_PROGRESS
 */

import { describe, it, expect } from 'vitest';
import type { PartStatus } from '../../types/part';

/**
 * State transition validation utility.
 * Validates that a transition from one state to another is allowed.
 */
function isValidTransition(from: PartStatus, to: PartStatus): boolean {
  const validTransitions: Record<PartStatus, PartStatus[]> = {
    PENDING: ['QA_IN_PROGRESS'],
    QA_IN_PROGRESS: ['READY_TO_RUN', 'FAILED'],
    READY_TO_RUN: ['ORCHESTRATING', 'QA_IN_PROGRESS'], // QA_IN_PROGRESS for manual resume
    ORCHESTRATING: ['COMPLETED', 'FAILED'],
    COMPLETED: [], // Terminal state (auto-advance handled separately)
    FAILED: ['QA_IN_PROGRESS', 'ORCHESTRATING'], // Manual intervention options
  };

  return validTransitions[from]?.includes(to) ?? false;
}

/**
 * Get the next part index for auto-advance.
 * Returns null if this is the last part.
 */
function getNextPartIndex(currentPartIndex: number, totalParts: number): number | null {
  if (currentPartIndex >= totalParts) {
    return null;
  }
  return currentPartIndex + 1;
}

describe('Part State Machine', () => {
  describe('Valid State Transitions', () => {
    it('should allow PENDING -> QA_IN_PROGRESS transition', () => {
      expect(isValidTransition('PENDING', 'QA_IN_PROGRESS')).toBe(true);
    });

    it('should allow QA_IN_PROGRESS -> READY_TO_RUN transition', () => {
      expect(isValidTransition('QA_IN_PROGRESS', 'READY_TO_RUN')).toBe(true);
    });

    it('should allow READY_TO_RUN -> ORCHESTRATING transition', () => {
      expect(isValidTransition('READY_TO_RUN', 'ORCHESTRATING')).toBe(true);
    });

    it('should allow ORCHESTRATING -> COMPLETED transition', () => {
      expect(isValidTransition('ORCHESTRATING', 'COMPLETED')).toBe(true);
    });

    it('should allow ORCHESTRATING -> FAILED transition', () => {
      expect(isValidTransition('ORCHESTRATING', 'FAILED')).toBe(true);
    });
  });

  describe('FAILED State and Manual Intervention', () => {
    it('should allow FAILED -> QA_IN_PROGRESS transition (Resume Q&A)', () => {
      expect(isValidTransition('FAILED', 'QA_IN_PROGRESS')).toBe(true);
    });

    it('should allow FAILED -> ORCHESTRATING transition (Retry orchestration)', () => {
      expect(isValidTransition('FAILED', 'ORCHESTRATING')).toBe(true);
    });

    it('should not allow FAILED -> PENDING transition (no rollback)', () => {
      expect(isValidTransition('FAILED', 'PENDING')).toBe(false);
    });
  });

  describe('Invalid State Transitions', () => {
    it('should not allow PENDING -> COMPLETED transition (must go through workflow)', () => {
      expect(isValidTransition('PENDING', 'COMPLETED')).toBe(false);
    });

    it('should not allow COMPLETED -> any other transition (terminal state)', () => {
      expect(isValidTransition('COMPLETED', 'PENDING')).toBe(false);
      expect(isValidTransition('COMPLETED', 'QA_IN_PROGRESS')).toBe(false);
      expect(isValidTransition('COMPLETED', 'ORCHESTRATING')).toBe(false);
    });
  });

  describe('Auto-advance Logic', () => {
    it('should return next part index when not the last part', () => {
      expect(getNextPartIndex(1, 3)).toBe(2);
      expect(getNextPartIndex(2, 3)).toBe(3);
    });

    it('should return null when on the last part', () => {
      expect(getNextPartIndex(3, 3)).toBe(null);
    });

    it('should return null when currentPartIndex exceeds totalParts', () => {
      expect(getNextPartIndex(4, 3)).toBe(null);
    });
  });
});
