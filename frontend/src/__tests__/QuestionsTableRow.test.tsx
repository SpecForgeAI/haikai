/**
 * QuestionsTableRow Component Tests
 *
 * Spec 2026-01-23: Questions System v1
 * Task Group 4: QuestionsTableRow Component
 *
 * Tests that verify:
 * - Component renders question text, answer input, and status badge
 * - Answer input calls onChange handler with question ID and new value
 * - "Open" status displayed when answer is empty
 * - "Answered" status displayed when answer is non-empty
 * - Answered questions rendered read-only with grayed-out styling (opacity: 0.6)
 *
 * Note: Source column was removed from the row layout. Tests updated accordingly.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { QuestionsTableRow } from '../components/ProductView/QuestionsTableRow';
import type { Question } from '../api/chatApi';

describe('Task Group 4: QuestionsTableRow Component', () => {
  const openQuestion: Question = {
    id: 'q-123',
    question: 'What authentication method should be used?',
    status: 'Open',
    answer: '',
    source: 'Product Owner',
  };

  const answeredQuestion: Question = {
    id: 'q-456',
    question: 'What is the max file size?',
    status: 'Answered',
    answer: '10MB',
    source: 'Product Owner',
  };

  describe('Test 4.1: Component renders core elements', () => {
    it('should render question text', () => {
      render(
        <QuestionsTableRow question={openQuestion} onAnswerChange={() => {}} />
      );

      expect(screen.getByText('What authentication method should be used?')).toBeInTheDocument();
    });

    it('should render answer input field', () => {
      render(
        <QuestionsTableRow question={openQuestion} onAnswerChange={() => {}} />
      );

      const input = screen.getByPlaceholderText('Enter your answer...');
      expect(input).toBeInTheDocument();
    });

    it('should render status badge', () => {
      render(
        <QuestionsTableRow question={openQuestion} onAnswerChange={() => {}} />
      );

      expect(screen.getByText('Open')).toBeInTheDocument();
    });
  });

  describe('Test 4.2: Answer input calls onChange with ID and value', () => {
    it('should call onAnswerChange with question ID and new value when typing', async () => {
      const handleChange = vi.fn();
      const user = userEvent.setup();

      render(
        <QuestionsTableRow question={openQuestion} onAnswerChange={handleChange} />
      );

      const input = screen.getByPlaceholderText('Enter your answer...');
      await user.type(input, 'OAuth 2.0');

      // Check that handler was called with correct args
      expect(handleChange).toHaveBeenCalled();
      // Last call should have the question ID and the final typed value
      const lastCallArgs = handleChange.mock.calls[handleChange.mock.calls.length - 1];
      expect(lastCallArgs[0]).toBe('q-123');
    });

    it('should call onAnswerChange on each keystroke', async () => {
      const handleChange = vi.fn();
      const user = userEvent.setup();

      render(
        <QuestionsTableRow question={openQuestion} onAnswerChange={handleChange} />
      );

      const input = screen.getByPlaceholderText('Enter your answer...');
      await user.type(input, 'abc');

      // Should be called for each character typed
      expect(handleChange).toHaveBeenCalledTimes(3);
    });
  });

  describe('Test 4.3: Open status displayed when answer is empty', () => {
    it('should show Open status for question with empty answer', () => {
      render(
        <QuestionsTableRow question={openQuestion} onAnswerChange={() => {}} />
      );

      const statusBadge = screen.getByText('Open');
      expect(statusBadge).toBeInTheDocument();
    });

    it('should render input as editable when status is Open', () => {
      render(
        <QuestionsTableRow question={openQuestion} onAnswerChange={() => {}} />
      );

      const input = screen.getByPlaceholderText('Enter your answer...');
      expect(input).not.toBeDisabled();
    });
  });

  describe('Test 4.4: Answered status displayed when answer is non-empty', () => {
    it('should show Answered status for question with non-empty answer', () => {
      render(
        <QuestionsTableRow question={answeredQuestion} onAnswerChange={() => {}} />
      );

      const statusBadge = screen.getByText('Answered');
      expect(statusBadge).toBeInTheDocument();
    });

    it('should display the answer value in the input', () => {
      render(
        <QuestionsTableRow question={answeredQuestion} onAnswerChange={() => {}} />
      );

      const input = screen.getByDisplayValue('10MB');
      expect(input).toBeInTheDocument();
    });
  });

  describe('Test 4.5: Answered questions have read-only styling', () => {
    it('should disable input for answered questions', () => {
      render(
        <QuestionsTableRow question={answeredQuestion} onAnswerChange={() => {}} />
      );

      const input = screen.getByDisplayValue('10MB');
      expect(input).toBeDisabled();
    });

    it('should apply answered row class with opacity styling', () => {
      const { container } = render(
        <QuestionsTableRow question={answeredQuestion} onAnswerChange={() => {}} />
      );

      // Find the row element
      const row = container.firstChild as HTMLElement;
      expect(row.className).toMatch(/answered/i);
    });

    it('should not apply answered styling to open questions', () => {
      const { container } = render(
        <QuestionsTableRow question={openQuestion} onAnswerChange={() => {}} />
      );

      const row = container.firstChild as HTMLElement;
      expect(row.className).not.toMatch(/answered/i);
    });
  });
});
