/**
 * QuestionsTable Component Tests
 *
 * Spec 2026-01-23: Questions System v1
 * Task Group 5: QuestionsTable Component
 *
 * Tests that verify:
 * - Component renders header row with column labels (Question, Answer, Status)
 * - Component renders a QuestionsTableRow for each question
 * - "Answer Open Questions" button shown only when all open questions have answers
 * - Button disabled if any open question's answer is empty/whitespace
 * - Empty state renders "No questions to display" message
 *
 * Note: Source column was removed from the table layout. Tests updated accordingly.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { QuestionsTable } from '../components/ProductView/QuestionsTable';
import type { Question } from '../api/chatApi';

describe('Task Group 5: QuestionsTable Component', () => {
  const questionsWithOpen: Question[] = [
    {
      id: 'q1',
      question: 'What authentication method?',
      status: 'Open',
      answer: '',
      source: 'Product Owner',
    },
    {
      id: 'q2',
      question: 'What max file size?',
      status: 'Open',
      answer: '',
      source: 'Product Owner',
    },
  ];

  const questionsWithAnswers: Question[] = [
    {
      id: 'q1',
      question: 'What authentication method?',
      status: 'Open',
      answer: 'OAuth 2.0',
      source: 'Product Owner',
    },
    {
      id: 'q2',
      question: 'What max file size?',
      status: 'Open',
      answer: '10MB',
      source: 'Product Owner',
    },
  ];

  const mixedQuestions: Question[] = [
    {
      id: 'q1',
      question: 'What authentication method?',
      status: 'Answered',
      answer: 'OAuth 2.0',
      source: 'Product Owner',
    },
    {
      id: 'q2',
      question: 'What max file size?',
      status: 'Open',
      answer: '',
      source: 'Product Owner',
    },
  ];

  describe('Test 5.1: Component renders header row with column labels', () => {
    it('should render Question column header', () => {
      render(
        <QuestionsTable
          questions={questionsWithOpen}
          onAnswerChange={() => {}}
          onSubmitAnswers={() => {}}
        />
      );

      expect(screen.getByText('Question')).toBeInTheDocument();
    });

    it('should render Answer column header', () => {
      render(
        <QuestionsTable
          questions={questionsWithOpen}
          onAnswerChange={() => {}}
          onSubmitAnswers={() => {}}
        />
      );

      expect(screen.getByText('Answer')).toBeInTheDocument();
    });

    it('should render Status column header', () => {
      render(
        <QuestionsTable
          questions={questionsWithOpen}
          onAnswerChange={() => {}}
          onSubmitAnswers={() => {}}
        />
      );

      expect(screen.getByText('Status')).toBeInTheDocument();
    });
  });

  describe('Test 5.2: Component renders a row for each question', () => {
    it('should render all question texts', () => {
      render(
        <QuestionsTable
          questions={questionsWithOpen}
          onAnswerChange={() => {}}
          onSubmitAnswers={() => {}}
        />
      );

      expect(screen.getByText('What authentication method?')).toBeInTheDocument();
      expect(screen.getByText('What max file size?')).toBeInTheDocument();
    });

    it('should pass onAnswerChange to each row', async () => {
      const handleChange = vi.fn();
      const user = userEvent.setup();

      render(
        <QuestionsTable
          questions={questionsWithOpen}
          onAnswerChange={handleChange}
          onSubmitAnswers={() => {}}
        />
      );

      // Find first input and type
      const inputs = screen.getAllByPlaceholderText('Enter your answer...');
      await user.type(inputs[0], 'test');

      expect(handleChange).toHaveBeenCalledWith('q1', expect.any(String));
    });
  });

  describe('Test 5.3: Answer Open Questions button visibility', () => {
    it('should show button when all open questions have non-empty answers', () => {
      render(
        <QuestionsTable
          questions={questionsWithAnswers}
          onAnswerChange={() => {}}
          onSubmitAnswers={() => {}}
        />
      );

      expect(screen.getByRole('button', { name: /answer open questions/i })).toBeInTheDocument();
    });

    it('should disable button when any open question has empty answer', () => {
      render(
        <QuestionsTable
          questions={questionsWithOpen}
          onAnswerChange={() => {}}
          onSubmitAnswers={() => {}}
        />
      );

      const button = screen.getByRole('button', { name: /answer open questions/i });
      expect(button).toBeDisabled();
    });

    it('should disable button when any open question has whitespace-only answer', () => {
      const questionsWithWhitespace: Question[] = [
        {
          id: 'q1',
          question: 'Test?',
          status: 'Open',
          answer: '   ',
          source: 'Product Owner',
        },
      ];

      render(
        <QuestionsTable
          questions={questionsWithWhitespace}
          onAnswerChange={() => {}}
          onSubmitAnswers={() => {}}
        />
      );

      const button = screen.getByRole('button', { name: /answer open questions/i });
      expect(button).toBeDisabled();
    });

    it('should enable button when open questions have answers regardless of answered questions', () => {
      const mixedWithAnswers: Question[] = [
        {
          id: 'q1',
          question: 'Already answered?',
          status: 'Answered',
          answer: 'Yes',
          source: 'Product Owner',
        },
        {
          id: 'q2',
          question: 'New question?',
          status: 'Open',
          answer: 'New answer',
          source: 'Product Owner',
        },
      ];

      render(
        <QuestionsTable
          questions={mixedWithAnswers}
          onAnswerChange={() => {}}
          onSubmitAnswers={() => {}}
        />
      );

      const button = screen.getByRole('button', { name: /answer open questions/i });
      expect(button).not.toBeDisabled();
    });
  });

  describe('Test 5.4: Button calls onSubmitAnswers when clicked', () => {
    it('should call onSubmitAnswers when button is clicked', async () => {
      const handleSubmit = vi.fn();
      const user = userEvent.setup();

      render(
        <QuestionsTable
          questions={questionsWithAnswers}
          onAnswerChange={() => {}}
          onSubmitAnswers={handleSubmit}
        />
      );

      const button = screen.getByRole('button', { name: /answer open questions/i });
      await user.click(button);

      expect(handleSubmit).toHaveBeenCalledTimes(1);
    });
  });

  describe('Test 5.5: Empty state when no questions', () => {
    it('should render empty state message when questions array is empty', () => {
      render(
        <QuestionsTable
          questions={[]}
          onAnswerChange={() => {}}
          onSubmitAnswers={() => {}}
        />
      );

      expect(screen.getByText('No questions to display.')).toBeInTheDocument();
    });

    it('should not render header when questions array is empty', () => {
      render(
        <QuestionsTable
          questions={[]}
          onAnswerChange={() => {}}
          onSubmitAnswers={() => {}}
        />
      );

      expect(screen.queryByText('Question')).not.toBeInTheDocument();
    });

    it('should not render button when questions array is empty', () => {
      render(
        <QuestionsTable
          questions={[]}
          onAnswerChange={() => {}}
          onSubmitAnswers={() => {}}
        />
      );

      expect(screen.queryByRole('button', { name: /answer open questions/i })).not.toBeInTheDocument();
    });
  });
});
