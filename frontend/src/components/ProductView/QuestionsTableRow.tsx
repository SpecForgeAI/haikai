/**
 * QuestionsTableRow Component
 *
 * Spec 2026-01-23: Questions System v1
 * Task Group 4: QuestionsTableRow Component
 *
 * Spec 2026-01-24: Questions Status Only Becomes Answered After Submit Success
 * Task Group 3: Update Submit Flow
 * - Added isSubmitting prop to disable input during submission
 *
 * Renders a single row in the questions table with:
 * - Source label (question.source)
 * - Question text (question.question)
 * - Answer input field (single line text input)
 * - Status badge (derived from answer presence)
 *
 * Features:
 * - Answer input placeholder: "Enter your answer..."
 * - Answer input disabled when status is "Answered" OR when isSubmitting is true
 * - Answered rows have grayed-out styling (opacity: 0.6)
 */

import React from 'react';
import type { Question } from '../../api/chatApi';
import styles from './QuestionsTableRow.module.css';

/**
 * Props interface for QuestionsTableRow
 *
 * Spec 2026-01-24: Questions Status Only Becomes Answered After Submit Success
 * Added isSubmitting prop for disabling input during submission.
 */
export interface QuestionsTableRowProps {
  /** The question to render */
  question: Question;
  /** Callback when the answer changes */
  onAnswerChange: (id: string, answer: string) => void;
  /**
   * Whether answers are currently being submitted.
   * When true, the answer input is disabled.
   *
   * Spec 2026-01-24: Questions Status Only Becomes Answered After Submit Success - Task Group 3
   */
  isSubmitting?: boolean;
}

/**
 * QuestionsTableRow Component
 *
 * Renders a single question row with source, question text, answer input, and status badge.
 *
 * Spec 2026-01-24: Questions Status Only Becomes Answered After Submit Success
 * Input is now disabled when isSubmitting=true (in addition to when status is "Answered")
 */
export function QuestionsTableRow({
  question,
  onAnswerChange,
  isSubmitting = false,
}: QuestionsTableRowProps) {
  const isAnswered = question.status === 'Answered';

  // Input is disabled when:
  // 1. Question is already Answered, OR
  // 2. Submission is in progress (isSubmitting=true)
  const isInputDisabled = isAnswered || isSubmitting;

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onAnswerChange(question.id, e.target.value);
  };

  return (
    <div className={`${styles.row} ${isAnswered ? styles.answered : ''}`}>
      {/* Question column */}
      <div className={styles.questionCell}>
        <span className={styles.questionText}>{question.question}</span>
      </div>

      {/* Answer column */}
      <div className={styles.answerCell}>
        <input
          type="text"
          className={styles.answerInput}
          value={question.answer}
          onChange={handleInputChange}
          placeholder="Enter your answer..."
          disabled={isInputDisabled}
          aria-label={`Answer for: ${question.question}`}
          data-testid={`answer-input-${question.id}`}
        />
      </div>

      {/* Status column */}
      <div className={styles.statusCell}>
        <span
          className={`${styles.statusBadge} ${
            isAnswered ? styles.statusAnswered : styles.statusOpen
          }`}
          data-testid={`status-badge-${question.id}`}
        >
          {question.status}
        </span>
      </div>
    </div>
  );
}
