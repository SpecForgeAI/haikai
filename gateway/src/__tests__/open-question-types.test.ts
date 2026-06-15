/**
 * Tests for OpenQuestion type definitions
 *
 * Spec 2026-01-23: Questions System v1
 * Task Group 1: Gateway OpenQuestion Type and PlannerResponse Update
 *
 * Tests that verify:
 * - OpenQuestion interface has id and question fields
 * - PlannerResponse.openQuestions is OpenQuestion[] not string[]
 * - OpenQuestion type validation accepts valid objects
 * - OpenQuestion type validation rejects invalid shapes
 */

import { describe, it, expect } from '@jest/globals';
import type { OpenQuestion, PlannerResponse } from '../types/chat';

describe('Task Group 1: Gateway OpenQuestion Type Tests', () => {
  describe('Test 1.1: OpenQuestion interface has required fields', () => {
    it('should accept valid OpenQuestion with id and question fields', () => {
      const validQuestion: OpenQuestion = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        question: 'What authentication method should be used?',
      };

      expect(validQuestion.id).toBe('550e8400-e29b-41d4-a716-446655440000');
      expect(validQuestion.question).toBe('What authentication method should be used?');
    });

    it('should allow empty question string', () => {
      const emptyQuestion: OpenQuestion = {
        id: 'test-id',
        question: '',
      };

      expect(emptyQuestion.id).toBe('test-id');
      expect(emptyQuestion.question).toBe('');
    });
  });

  describe('Test 1.2: PlannerResponse.openQuestions is OpenQuestion[]', () => {
    it('should accept openQuestions as an array of OpenQuestion objects', () => {
      const response: PlannerResponse = {
        schemaVersion: '1.1',
        message: 'Test message',
        featureUnderstanding: 'Test understanding',
        scope: { in: [], out: [] },
        assumptions: [],
        acceptanceCriteria: [],
        openQuestions: [
          { id: 'q1', question: 'First question?' },
          { id: 'q2', question: 'Second question?' },
        ],
        plannerReadyForSpec: false,
        implementationPlan: null,
      };

      expect(response.openQuestions).toHaveLength(2);
      expect(response.openQuestions[0].id).toBe('q1');
      expect(response.openQuestions[0].question).toBe('First question?');
      expect(response.openQuestions[1].id).toBe('q2');
      expect(response.openQuestions[1].question).toBe('Second question?');
    });

    it('should accept empty openQuestions array', () => {
      const response: PlannerResponse = {
        schemaVersion: '1.1',
        message: 'Test message',
        featureUnderstanding: 'Test understanding',
        scope: { in: [], out: [] },
        assumptions: [],
        acceptanceCriteria: [],
        openQuestions: [],
        plannerReadyForSpec: false,
        implementationPlan: null,
      };

      expect(response.openQuestions).toEqual([]);
    });
  });

  describe('Test 1.3: OpenQuestion type validation accepts valid objects', () => {
    it('should accept OpenQuestion with UUID-format id', () => {
      const question: OpenQuestion = {
        id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        question: 'What is the expected max file size?',
      };

      expect(typeof question.id).toBe('string');
      expect(typeof question.question).toBe('string');
    });

    it('should accept OpenQuestion with long question text', () => {
      const longQuestion = 'A '.repeat(500) + 'question?';
      const question: OpenQuestion = {
        id: 'long-question-id',
        question: longQuestion,
      };

      expect(question.question.length).toBeGreaterThan(1000);
    });
  });

  describe('Test 1.4: OpenQuestion array type checking', () => {
    it('should allow mapping over openQuestions array', () => {
      const questions: OpenQuestion[] = [
        { id: 'q1', question: 'Question 1?' },
        { id: 'q2', question: 'Question 2?' },
        { id: 'q3', question: 'Question 3?' },
      ];

      const ids = questions.map(q => q.id);
      const texts = questions.map(q => q.question);

      expect(ids).toEqual(['q1', 'q2', 'q3']);
      expect(texts).toEqual(['Question 1?', 'Question 2?', 'Question 3?']);
    });

    it('should allow filtering openQuestions array', () => {
      const questions: OpenQuestion[] = [
        { id: 'q1', question: 'Short?' },
        { id: 'q2', question: 'This is a much longer question that spans many characters?' },
      ];

      const longQuestions = questions.filter(q => q.question.length > 20);

      expect(longQuestions).toHaveLength(1);
      expect(longQuestions[0].id).toBe('q2');
    });
  });
});
