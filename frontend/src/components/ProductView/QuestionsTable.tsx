/**
 * QuestionsTable Component
 *
 * Spec 2026-01-23: Questions System v1
 * Task Group 5: QuestionsTable Component
 *
 * Spec 2026-01-23: SA Handoff Per Increment
 * Task Group 6: Filter Questions Table by Active Increment for SA Questions
 *
 * Spec 2026-01-24: Questions Status Only Becomes Answered After Submit Success
 * Task Group 2: Update Button Enable Logic
 * - Changed from every() to some() for button enable logic
 * - Button enabled when at least 1 Open question has non-empty answer
 * Task Group 3: Update Submit Flow
 * - Added isSubmitting prop for loading state (spinner + disabled inputs)
 * - Pass isSubmitting to QuestionsTableRow for input disabling
 *
 * Container component that renders:
 * - Header row with column labels (Source, Question, Answer, Status)
 * - List of QuestionsTableRow components for each question
 * - "Answer Open Questions" button that enables when at least one Open question has an answer
 * - Empty state message when no questions exist
 *
 * Button logic:
 * - Always visible when there are questions
 * - Enabled when at least one Open question has a non-empty answer
 * - Disabled when no Open questions have answers, or when isSubmitting=true
 * - Shows spinner when isSubmitting=true
 *
 * Filtering logic (Spec 2026-01-23: SA Handoff Per Increment):
 * - PO questions (source !== 'Software Developer') are always shown
 * - SA questions are shown only if incrementId matches activeIncrementId
 */

import React from 'react';
import type { Question } from '../../api/chatApi';
import { QuestionsTableRow } from './QuestionsTableRow';
import styles from './QuestionsTable.module.css';

/**
 * Props interface for QuestionsTable
 *
 * Spec 2026-01-23: SA Handoff Per Increment
 * Added activeIncrementId prop for filtering SA questions by increment.
 *
 * Spec 2026-01-24: Questions Status Only Becomes Answered After Submit Success
 * Added isSubmitting prop for loading state during submission.
 */
export interface QuestionsTableProps {
  /** Array of questions to display */
  questions: Question[];
  /** Callback when an answer changes */
  onAnswerChange: (id: string, answer: string) => void;
  /** Callback when the submit button is clicked */
  onSubmitAnswers: () => void;
  /**
   * Currently active/selected increment ID for filtering SA questions.
   * - When null/undefined: Only PO questions are shown (SA questions hidden)
   * - When set: SA questions with matching incrementId are shown
   *
   * Spec 2026-01-23: SA Handoff Per Increment - Task Group 6
   */
  activeIncrementId?: string | null;
  /**
   * Whether answers are currently being submitted.
   * When true:
   * - Submit button shows spinner and is disabled
   * - Answer inputs are disabled
   *
   * Spec 2026-01-24: Questions Status Only Becomes Answered After Submit Success - Task Group 3
   */
  isSubmitting?: boolean;
}

/**
 * Filters questions based on active increment ID.
 *
 * Spec 2026-01-23: SA Handoff Per Increment - Task Group 6
 *
 * Logic:
 * - PO questions (source !== 'Software Developer') are always shown
 * - SA questions are shown only if their incrementId matches activeIncrementId
 *
 * @param questions - Array of questions to filter
 * @param activeIncrementId - Currently active increment ID (null = no increment selected)
 * @returns Filtered array of questions
 */
function filterQuestionsByIncrement(
  questions: Question[],
  activeIncrementId: string | null | undefined
): Question[] {
  return questions.filter((q) => {
    // PO questions are always shown (no incrementId filtering)
    if (q.source !== 'Software Developer') {
      return true;
    }
    // SA questions are shown only if incrementId matches activeIncrementId
    return q.incrementId === activeIncrementId;
  });
}

/**
 * QuestionsTable Component
 *
 * Renders a table of questions with inline answer inputs and submit button.
 *
 * Spec 2026-01-23: SA Handoff Per Increment
 * Now filters questions based on activeIncrementId before rendering.
 *
 * Spec 2026-01-24: Questions Status Only Becomes Answered After Submit Success
 * - Button enabled when at least one Open question has non-empty answer (some instead of every)
 * - Shows spinner and disables inputs when isSubmitting=true
 */
export function QuestionsTable({
  questions,
  onAnswerChange,
  onSubmitAnswers,
  activeIncrementId,
  isSubmitting = false,
}: QuestionsTableProps) {
  // Filter questions based on active increment
  const filteredQuestions = filterQuestionsByIncrement(questions, activeIncrementId);

  // Empty state
  if (filteredQuestions.length === 0) {
    return (
      <div className={styles.emptyState}>
        No questions to display.
      </div>
    );
  }

  // Spec 2026-01-24: Task Group 2 - Check if at least one Open question has a non-empty answer
  // Changed from every() to some() to enable partial answer submission
  const openQuestions = filteredQuestions.filter(q => q.status === 'Open');
  const hasOpenQuestionWithAnswer = openQuestions.some(
    q => q.answer.trim().length > 0
  );

  // Button is disabled when:
  // 1. No Open question has an answer, OR
  // 2. Currently submitting (isSubmitting=true)
  const isButtonDisabled = !hasOpenQuestionWithAnswer || isSubmitting;

  return (
    <div className={styles.container}>
      {/* Header row */}
      <div className={styles.header}>
        <div className={styles.headerQuestion}>Question</div>
        <div className={styles.headerAnswer}>Answer</div>
        <div className={styles.headerStatus}>Status</div>
      </div>

      {/* Question rows */}
      <div className={styles.body}>
        {filteredQuestions.map(question => (
          <QuestionsTableRow
            key={question.id}
            question={question}
            onAnswerChange={onAnswerChange}
            isSubmitting={isSubmitting}
          />
        ))}
      </div>

      {/* Submit button */}
      <div className={styles.footer}>
        <button
          type="button"
          className={styles.submitButton}
          onClick={onSubmitAnswers}
          disabled={isButtonDisabled}
          data-testid="answer-open-questions-button"
        >
          {isSubmitting ? (
            <>
              <span className={styles.spinner} data-testid="submit-spinner" />
              Submitting...
            </>
          ) : (
            'Answer Open Questions'
          )}
        </button>
      </div>
    </div>
  );
}
