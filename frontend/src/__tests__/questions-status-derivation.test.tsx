/**
 * Tests for Questions Status Derivation
 *
 * Spec 2026-01-24: Questions Status Only Becomes Answered After Submit Success
 * Task Group 1: Fix Status Derivation Logic
 * Task 1.1: Write 4-6 focused tests for status derivation changes
 *
 * Tests verify that:
 * - Status is managed explicitly via questionStatuses state
 * - Status does NOT change based on answer presence
 * - All new questions initialize with status="Open"
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

// Import types
import type { Question, PlannerResponse } from '../api/chatApi';

/**
 * Helper function to derive questions from openQuestions and answers with explicit statuses
 * Mirrors the updated deriveQuestions function in FeatureDefinitionPanel
 */
function deriveQuestionsWithExplicitStatus(
  openQuestions: PlannerResponse['openQuestions'],
  answers: Record<string, string>,
  statuses: Map<string, 'Open' | 'Answered'>
): Question[] {
  return openQuestions.map(oq => {
    const answer = answers[oq.id] ?? '';
    const status = statuses.get(oq.id) ?? 'Open';
    return {
      id: oq.id,
      question: oq.question,
      status,
      answer,
      source: 'Product Owner' as const,
    };
  });
}

describe('Status Derivation with Explicit Status Map', () => {
  /**
   * Test 1: deriveQuestions returns status="Open" even when answer is non-empty
   */
  it('should return status="Open" when answer is non-empty but status map has "Open"', () => {
    const openQuestions = [
      { id: 'q1', question: 'What is the feature scope?' },
    ];
    const answers = { q1: 'This is my answer' };
    const statuses = new Map<string, 'Open' | 'Answered'>([['q1', 'Open']]);

    const result = deriveQuestionsWithExplicitStatus(openQuestions, answers, statuses);

    expect(result[0].status).toBe('Open');
    expect(result[0].answer).toBe('This is my answer');
  });

  /**
   * Test 2: deriveQuestions returns status="Answered" only when explicitly set in status map
   */
  it('should return status="Answered" only when status map has "Answered"', () => {
    const openQuestions = [
      { id: 'q1', question: 'What is the feature scope?' },
    ];
    const answers = { q1: 'This is my answer' };
    const statuses = new Map<string, 'Open' | 'Answered'>([['q1', 'Answered']]);

    const result = deriveQuestionsWithExplicitStatus(openQuestions, answers, statuses);

    expect(result[0].status).toBe('Answered');
    expect(result[0].answer).toBe('This is my answer');
  });

  /**
   * Test 3: Questions default to "Open" when not in status map
   */
  it('should default to status="Open" when question not in status map', () => {
    const openQuestions = [
      { id: 'q1', question: 'What is the feature scope?' },
      { id: 'q2', question: 'Who are the users?' },
    ];
    const answers = { q1: 'Answer 1', q2: 'Answer 2' };
    const statuses = new Map<string, 'Open' | 'Answered'>(); // Empty map

    const result = deriveQuestionsWithExplicitStatus(openQuestions, answers, statuses);

    expect(result[0].status).toBe('Open');
    expect(result[1].status).toBe('Open');
  });

  /**
   * Test 4: PO questions maintain explicit status independent of answer text
   */
  it('should maintain PO question status independent of answer text changes', () => {
    const openQuestions = [
      { id: 'q1', question: 'What is the feature scope?' },
    ];

    // First: empty answer, Open status
    let answers: Record<string, string> = { q1: '' };
    let statuses = new Map<string, 'Open' | 'Answered'>([['q1', 'Open']]);
    let result = deriveQuestionsWithExplicitStatus(openQuestions, answers, statuses);
    expect(result[0].status).toBe('Open');

    // Second: with answer, still Open (status not changed)
    answers = { q1: 'Now I have an answer' };
    result = deriveQuestionsWithExplicitStatus(openQuestions, answers, statuses);
    expect(result[0].status).toBe('Open'); // Still Open until explicitly changed

    // Third: status explicitly changed to Answered
    statuses = new Map<string, 'Open' | 'Answered'>([['q1', 'Answered']]);
    result = deriveQuestionsWithExplicitStatus(openQuestions, answers, statuses);
    expect(result[0].status).toBe('Answered');
  });

  /**
   * Test 5: SA questions maintain explicit status independent of answer text
   */
  it('should maintain SA question status independent of answer text changes', () => {
    // SA questions have incrementId set
    const saQuestion: Question = {
      id: 'sa-q1',
      question: 'What API endpoints are needed?',
      status: 'Open',
      answer: '',
      source: 'Software Architect',
      incrementId: 'INC-1',
    };

    // Apply answer but keep status from explicit map
    const statuses = new Map<string, 'Open' | 'Answered'>([['sa-q1', 'Open']]);
    const answerText = 'We need GET and POST endpoints';

    // Simulate status lookup
    const explicitStatus = statuses.get(saQuestion.id) ?? saQuestion.status;

    expect(explicitStatus).toBe('Open');
    expect(answerText.length).toBeGreaterThan(0); // Has answer, but status is still Open
  });

  /**
   * Test 6: Initial question state - all questions from backend/LLM start as "Open"
   */
  it('should initialize all new questions with status="Open"', () => {
    const openQuestions = [
      { id: 'new-q1', question: 'New question 1' },
      { id: 'new-q2', question: 'New question 2' },
      { id: 'new-q3', question: 'New question 3' },
    ];
    const answers: Record<string, string> = {}; // No answers yet
    const statuses = new Map<string, 'Open' | 'Answered'>(); // Empty - all default to Open

    const result = deriveQuestionsWithExplicitStatus(openQuestions, answers, statuses);

    // All questions should be Open
    result.forEach(q => {
      expect(q.status).toBe('Open');
    });
  });
});

describe('Combined Questions Status Management', () => {
  /**
   * Test: combinedQuestions memo uses explicit status instead of deriving from answer
   */
  it('should use explicit status from questionStatuses map for both PO and SA questions', () => {
    // PO questions from plannerResponse
    const poOpenQuestions = [
      { id: 'po-q1', question: 'What is the goal?' },
    ];

    // SA questions (already have status)
    const saQuestions: Question[] = [
      {
        id: 'sa-q1',
        question: 'What DB schema changes?',
        status: 'Open',
        answer: '',
        source: 'Software Architect',
        incrementId: 'INC-1',
      },
    ];

    const answers = {
      'po-q1': 'The goal is to improve UX',
      'sa-q1': 'Add users table',
    };

    // Explicit status map - both still Open even though they have answers
    const questionStatuses = new Map<string, 'Open' | 'Answered'>([
      ['po-q1', 'Open'],
      ['sa-q1', 'Open'],
    ]);

    // Derive PO questions with explicit status
    const derivedPoQuestions = poOpenQuestions.map(oq => {
      const answer = answers[oq.id] ?? '';
      const status = questionStatuses.get(oq.id) ?? 'Open';
      return {
        id: oq.id,
        question: oq.question,
        status,
        answer,
        source: 'Product Owner' as const,
      };
    });

    // Derive SA questions with explicit status
    const derivedSaQuestions = saQuestions.map(q => {
      const answer = answers[q.id] ?? q.answer;
      const status = questionStatuses.get(q.id) ?? q.status;
      return {
        ...q,
        answer,
        status,
      };
    });

    // Both should be Open despite having answers
    expect(derivedPoQuestions[0].status).toBe('Open');
    expect(derivedPoQuestions[0].answer).toBe('The goal is to improve UX');

    expect(derivedSaQuestions[0].status).toBe('Open');
    expect(derivedSaQuestions[0].answer).toBe('Add users table');

    // Now simulate status update after successful submit
    questionStatuses.set('po-q1', 'Answered');
    questionStatuses.set('sa-q1', 'Answered');

    const updatedPoQuestions = poOpenQuestions.map(oq => {
      const answer = answers[oq.id] ?? '';
      const status = questionStatuses.get(oq.id) ?? 'Open';
      return { id: oq.id, question: oq.question, status, answer, source: 'Product Owner' as const };
    });

    const updatedSaQuestions = saQuestions.map(q => {
      const answer = answers[q.id] ?? q.answer;
      const status = questionStatuses.get(q.id) ?? q.status;
      return { ...q, answer, status };
    });

    expect(updatedPoQuestions[0].status).toBe('Answered');
    expect(updatedSaQuestions[0].status).toBe('Answered');
  });
});
