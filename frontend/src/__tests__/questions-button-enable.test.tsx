/**
 * Tests for Questions Table Button Enable Logic
 *
 * Spec 2026-01-24: Questions Status Only Becomes Answered After Submit Success
 * Task Group 2: Update Button Enable Logic
 * Task 2.1: Write 4 focused tests for button enable logic
 *
 * Tests verify that:
 * - Button enabled when at least 1 Open question has non-empty answer
 * - Button disabled when no Open questions have answers
 * - Button enabled when 2 of 3 Open questions have answers (partial)
 * - Button state ignores Answered questions (only considers Open)
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { QuestionsTable } from '../components/ProductView/QuestionsTable';
import type { Question } from '../api/chatApi';

describe('QuestionsTable Button Enable Logic', () => {
  const mockOnAnswerChange = vi.fn();
  const mockOnSubmitAnswers = vi.fn();

  /**
   * Test 1: Button enabled when at least 1 Open question has non-empty answer
   */
  it('should enable button when at least 1 Open question has non-empty answer', () => {
    const questions: Question[] = [
      {
        id: 'q1',
        question: 'Question 1',
        status: 'Open',
        answer: 'My answer',
        source: 'Product Owner',
      },
      {
        id: 'q2',
        question: 'Question 2',
        status: 'Open',
        answer: '',
        source: 'Product Owner',
      },
    ];

    render(
      <QuestionsTable
        questions={questions}
        onAnswerChange={mockOnAnswerChange}
        onSubmitAnswers={mockOnSubmitAnswers}
      />
    );

    const button = screen.getByTestId('answer-open-questions-button');
    expect(button).not.toBeDisabled();
  });

  /**
   * Test 2: Button disabled when no Open questions have answers
   */
  it('should disable button when no Open questions have answers', () => {
    const questions: Question[] = [
      {
        id: 'q1',
        question: 'Question 1',
        status: 'Open',
        answer: '',
        source: 'Product Owner',
      },
      {
        id: 'q2',
        question: 'Question 2',
        status: 'Open',
        answer: '   ', // Whitespace only - should be treated as empty
        source: 'Product Owner',
      },
    ];

    render(
      <QuestionsTable
        questions={questions}
        onAnswerChange={mockOnAnswerChange}
        onSubmitAnswers={mockOnSubmitAnswers}
      />
    );

    const button = screen.getByTestId('answer-open-questions-button');
    expect(button).toBeDisabled();
  });

  /**
   * Test 3: Button enabled when 2 of 3 Open questions have answers (partial)
   */
  it('should enable button when 2 of 3 Open questions have answers (partial)', () => {
    const questions: Question[] = [
      {
        id: 'q1',
        question: 'Question 1',
        status: 'Open',
        answer: 'Answer 1',
        source: 'Product Owner',
      },
      {
        id: 'q2',
        question: 'Question 2',
        status: 'Open',
        answer: 'Answer 2',
        source: 'Product Owner',
      },
      {
        id: 'q3',
        question: 'Question 3',
        status: 'Open',
        answer: '', // No answer yet
        source: 'Product Owner',
      },
    ];

    render(
      <QuestionsTable
        questions={questions}
        onAnswerChange={mockOnAnswerChange}
        onSubmitAnswers={mockOnSubmitAnswers}
      />
    );

    const button = screen.getByTestId('answer-open-questions-button');
    expect(button).not.toBeDisabled();
  });

  /**
   * Test 4: Button state ignores Answered questions (only considers Open)
   */
  it('should ignore Answered questions when determining button state', () => {
    const questions: Question[] = [
      {
        id: 'q1',
        question: 'Question 1',
        status: 'Answered', // Already answered - should be ignored
        answer: 'Previous answer',
        source: 'Product Owner',
      },
      {
        id: 'q2',
        question: 'Question 2',
        status: 'Open',
        answer: '', // Open with no answer
        source: 'Product Owner',
      },
    ];

    render(
      <QuestionsTable
        questions={questions}
        onAnswerChange={mockOnAnswerChange}
        onSubmitAnswers={mockOnSubmitAnswers}
      />
    );

    // Button should be disabled because only Open questions are considered,
    // and q2 has no answer
    const button = screen.getByTestId('answer-open-questions-button');
    expect(button).toBeDisabled();
  });

  /**
   * Test 5: Button enabled when only Open question has answer (ignore Answered)
   */
  it('should enable button when the only Open question has an answer', () => {
    const questions: Question[] = [
      {
        id: 'q1',
        question: 'Question 1',
        status: 'Answered',
        answer: 'Previous answer',
        source: 'Product Owner',
      },
      {
        id: 'q2',
        question: 'Question 2',
        status: 'Open',
        answer: 'New answer', // Open with answer
        source: 'Product Owner',
      },
    ];

    render(
      <QuestionsTable
        questions={questions}
        onAnswerChange={mockOnAnswerChange}
        onSubmitAnswers={mockOnSubmitAnswers}
      />
    );

    const button = screen.getByTestId('answer-open-questions-button');
    expect(button).not.toBeDisabled();
  });
});
