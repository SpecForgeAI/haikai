/**
 * Tests for frontend Question type definitions
 *
 * Spec 2026-01-23: Questions System v1
 * Task Group 3: Frontend Question Type Definitions
 *
 * Tests that verify:
 * - Question interface has all required fields (id, question, status, answer, source)
 * - status field accepts 'Open' | 'Answered' values
 * - source field accepts 'Product Owner' | 'Software Architect' values
 * - Question type aligns with gateway OpenQuestion (id, question fields)
 */

import { describe, it, expect } from 'vitest';
import type { Question, OpenQuestion, PlannerResponse } from '../api/chatApi';

describe('Task Group 3: Frontend Question Type Tests', () => {
  describe('Test 3.1: Question interface has all required fields', () => {
    it('should accept Question with all required fields', () => {
      const question: Question = {
        id: 'q-123-abc',
        question: 'What authentication method should be used?',
        status: 'Open',
        answer: '',
        source: 'Product Owner',
      };

      expect(question.id).toBe('q-123-abc');
      expect(question.question).toBe('What authentication method should be used?');
      expect(question.status).toBe('Open');
      expect(question.answer).toBe('');
      expect(question.source).toBe('Product Owner');
    });

    it('should accept Question with answered status and non-empty answer', () => {
      const question: Question = {
        id: 'q-456-def',
        question: 'What is the max file size?',
        status: 'Answered',
        answer: '10MB',
        source: 'Product Owner',
      };

      expect(question.status).toBe('Answered');
      expect(question.answer).toBe('10MB');
    });
  });

  describe('Test 3.2: status field accepts Open | Answered values', () => {
    it('should accept Open status', () => {
      const question: Question = {
        id: 'q1',
        question: 'Test?',
        status: 'Open',
        answer: '',
        source: 'Product Owner',
      };

      expect(question.status).toBe('Open');
    });

    it('should accept Answered status', () => {
      const question: Question = {
        id: 'q2',
        question: 'Test?',
        status: 'Answered',
        answer: 'Yes',
        source: 'Product Owner',
      };

      expect(question.status).toBe('Answered');
    });
  });

  describe('Test 3.3: source field accepts Product Owner | Software Architect values', () => {
    it('should accept Product Owner source', () => {
      const question: Question = {
        id: 'q1',
        question: 'Test?',
        status: 'Open',
        answer: '',
        source: 'Product Owner',
      };

      expect(question.source).toBe('Product Owner');
    });

    it('should accept Software Architect source', () => {
      const question: Question = {
        id: 'q2',
        question: 'Technical question?',
        status: 'Open',
        answer: '',
        source: 'Software Architect',
      };

      expect(question.source).toBe('Software Architect');
    });
  });

  describe('Test 3.4: Question type aligns with gateway OpenQuestion', () => {
    it('should have id and question fields matching OpenQuestion', () => {
      const openQuestion: OpenQuestion = {
        id: 'uuid-123',
        question: 'What API endpoints are needed?',
      };

      // Question should have the same id and question fields
      const question: Question = {
        id: openQuestion.id,
        question: openQuestion.question,
        status: 'Open',
        answer: '',
        source: 'Product Owner',
      };

      expect(question.id).toBe(openQuestion.id);
      expect(question.question).toBe(openQuestion.question);
    });

    it('should allow deriving Question from OpenQuestion with added fields', () => {
      const openQuestions: OpenQuestion[] = [
        { id: 'q1', question: 'Question 1?' },
        { id: 'q2', question: 'Question 2?' },
      ];

      const answers = new Map<string, string>([['q1', 'Answer 1']]);

      // Derive Question[] from OpenQuestion[]
      const questions: Question[] = openQuestions.map(oq => ({
        id: oq.id,
        question: oq.question,
        status: (answers.get(oq.id)?.trim() ? 'Answered' : 'Open') as 'Open' | 'Answered',
        answer: answers.get(oq.id) ?? '',
        source: 'Product Owner' as const,
      }));

      expect(questions[0].status).toBe('Answered');
      expect(questions[0].answer).toBe('Answer 1');
      expect(questions[1].status).toBe('Open');
      expect(questions[1].answer).toBe('');
    });
  });

  describe('Test 3.5: PlannerResponse.openQuestions is OpenQuestion[]', () => {
    it('should accept PlannerResponse with OpenQuestion[] openQuestions', () => {
      const response: PlannerResponse = {
        schemaVersion: '1.1',
        message: 'Test message',
        featureUnderstanding: 'Test understanding',
        scope: { in: [], out: [] },
        assumptions: [],
        acceptanceCriteria: [],
        openQuestions: [
          { id: 'q1', question: 'Question 1?' },
          { id: 'q2', question: 'Question 2?' },
        ],
        plannerReadyForSpec: false,
        implementationPlan: null,
      };

      expect(response.openQuestions).toHaveLength(2);
      expect(response.openQuestions[0].id).toBe('q1');
      expect(response.openQuestions[0].question).toBe('Question 1?');
    });
  });
});
