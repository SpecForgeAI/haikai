/**
 * StructuredQuestionsRenderer Component
 *
 * Spec 2026-02-28: Unified Chat Panel v1 (Frontend)
 * Task Group 6, Task 6.4: Create StructuredQuestionsRenderer component
 *
 * New self-contained component inspired by QuestionsTable.tsx and
 * QuestionsTableRow.tsx layout patterns. Renders structured questions
 * from chat responses with per-question answer inputs.
 *
 * Features:
 * - Header row ("Question" / "Answer") and one row per question
 * - Each row has question text and a single-line text input
 * - Local state tracks answers per question id
 * - "Submit Answers" button enabled when at least one answer is non-empty
 * - Disabled when `disabled` prop is true or during submission
 * - On submit: calls `onSubmitAnswers` with answered questions
 *
 * Does NOT import or reuse existing QuestionsTable or QuestionsTableRow.
 */

import { useState, useRef, useCallback } from 'react';
import { Paperclip } from 'lucide-react';
import { FileAttachmentBar } from './FileAttachmentBar';
import { validateFiles, readFilesAsBase64, ACCEPTED_MIME_TYPES } from '../../utils/fileUploadUtils';
import type { FileAttachment } from '../../api/chatV2Api';
import styles from './StructuredQuestionsRenderer.module.css';

// ============================================================================
// Props Interface
// ============================================================================

export interface StructuredQuestion {
  /** Unique question identifier */
  id: string;
  /** Question text */
  question: string;
}

export interface StructuredAnswer {
  /** Question identifier */
  id: string;
  /** Question text */
  question: string;
  /** User-provided answer */
  answer: string;
}

export interface StructuredQuestionsRendererProps {
  /** Array of questions to render */
  questions: StructuredQuestion[];
  /** Callback when user submits answers (with optional file attachments) */
  onSubmitAnswers: (answers: StructuredAnswer[], files?: FileAttachment[]) => void;
  /** Whether the component is disabled (e.g., already submitted) */
  disabled?: boolean;
}

// ============================================================================
// Component
// ============================================================================

export function StructuredQuestionsRenderer({
  questions,
  onSubmitAnswers,
  disabled = false,
}: StructuredQuestionsRendererProps) {
  // Local state: answers per question id
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /**
   * Handle answer change for a specific question.
   */
  const handleAnswerChange = useCallback(
    (questionId: string, answer: string) => {
      setAnswers((prev) => ({
        ...prev,
        [questionId]: answer,
      }));
    },
    []
  );

  /**
   * Check if at least one answer is non-empty.
   * Replicates the "some" enable logic from QuestionsTable.tsx lines 134-138.
   */
  const hasAtLeastOneAnswer = questions.some(
    (q) => (answers[q.id] ?? '').trim().length > 0
  );

  /**
   * Submit button is disabled when:
   * 1. No answer has been provided, OR
   * 2. The `disabled` prop is true, OR
   * 3. Currently submitting
   */
  const isButtonDisabled = !hasAtLeastOneAnswer || disabled || isSubmitting;

  /**
   * Handle file selection from the hidden file input.
   */
  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selectedFiles = e.target.files;
      if (!selectedFiles || selectedFiles.length === 0) return;

      const newFiles = Array.from(selectedFiles);
      const validation = validateFiles(files, newFiles);
      if (!validation.valid) {
        alert(validation.error);
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }

      setFiles((prev) => [...prev, ...newFiles]);
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    [files]
  );

  const handleRemoveFile = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleAttachClick = useCallback(() => {
    if (fileInputRef.current) fileInputRef.current.click();
  }, []);

  /**
   * Handle submit: collects all answered questions and calls onSubmitAnswers.
   */
  const handleSubmit = useCallback(async () => {
    if (isButtonDisabled) return;

    setIsSubmitting(true);

    // Build the answers array with all questions that have non-empty answers
    const answeredQuestions: StructuredAnswer[] = questions
      .filter((q) => (answers[q.id] ?? '').trim().length > 0)
      .map((q) => ({
        id: q.id,
        question: q.question,
        answer: (answers[q.id] ?? '').trim(),
      }));

    // Process file attachments if any
    let processedFiles: FileAttachment[] | undefined;
    if (files.length > 0) {
      try {
        processedFiles = await readFilesAsBase64(files);
      } catch (err) {
        console.error('Failed to read files:', err);
        setIsSubmitting(false);
        return;
      }
    }

    onSubmitAnswers(answeredQuestions, processedFiles);

    // Note: parent is responsible for any further state management.
    // We set isSubmitting but do not reset it -- the parent typically
    // replaces or disables this component after submission.
  }, [isButtonDisabled, questions, answers, files, onSubmitAnswers]);

  return (
    <div className={styles.container} data-testid="structured-questions">
      {/* Header row */}
      <div className={styles.header}>
        <div className={styles.headerQuestion}>Question</div>
        <div className={styles.headerAnswer}>Answer</div>
      </div>

      {/* Question rows */}
      <div className={styles.body}>
        {questions.map((q) => (
          <div key={q.id} className={styles.row} data-testid={`question-row-${q.id}`}>
            <div className={styles.questionCell}>
              <span className={styles.questionText}>{q.question}</span>
            </div>
            <div className={styles.answerCell}>
              <input
                type="text"
                className={styles.answerInput}
                value={answers[q.id] ?? ''}
                onChange={(e) => handleAnswerChange(q.id, e.target.value)}
                placeholder="Enter your answer..."
                disabled={disabled || isSubmitting}
                aria-label={`Answer for: ${q.question}`}
                data-testid={`answer-input-${q.id}`}
              />
            </div>
          </div>
        ))}
      </div>

      {/* File attachment chips */}
      <FileAttachmentBar files={files} onRemove={handleRemoveFile} />

      {/* Footer with attach button + submit button */}
      <div className={styles.footer}>
        <button
          type="button"
          className={styles.attachButton}
          onClick={handleAttachClick}
          disabled={disabled || isSubmitting}
          aria-label="Attach files"
          data-testid="answers-attach-button"
        >
          <Paperclip size={16} />
        </button>
        <button
          type="button"
          className={styles.submitButton}
          onClick={handleSubmit}
          disabled={isButtonDisabled}
          data-testid="submit-answers-button"
        >
          Submit Answers
        </button>
      </div>

      {/* Hidden file input for file selection */}
      <input
        ref={fileInputRef}
        type="file"
        className={styles.hiddenFileInput}
        onChange={handleFileChange}
        accept={ACCEPTED_MIME_TYPES}
        multiple
        data-testid="answers-file-input"
      />
    </div>
  );
}
