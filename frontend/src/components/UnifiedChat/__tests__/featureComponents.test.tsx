/**
 * Feature Components Tests
 *
 * Spec 2026-02-28: Unified Chat Panel v1 (Frontend)
 * Task Group 6, Task 6.1: Write 8 focused tests for feature components
 *
 * Spec 2026-03-03: UnifiedChatPanel UX Polish
 * Task Group 1, Task 1.3: FR3 -- Updated MentionInput selection test to expect
 * input clear behavior instead of @DisplayName insertion
 *
 * Tests verify:
 * - MentionInput shows dropdown when `@` is typed
 * - MentionInput filters dropdown by text after `@` character
 * - MentionInput calls onPersonaSelected and clears input on selection (FR3)
 * - MentionInput supports keyboard navigation (ArrowUp/ArrowDown/Enter/Escape)
 * - TaskMenu renders task cards with menuLabel and description
 * - TaskMenu calls onSelectTask with correct taskId on click
 * - StructuredQuestionsRenderer renders question rows with text inputs and a Submit button
 * - StructuredQuestionsRenderer disables Submit when all answers are empty, enables when at least one is non-empty
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import { MentionInput } from '../MentionInput';
import { TaskMenu } from '../TaskMenu';
import { StructuredQuestionsRenderer } from '../StructuredQuestionsRenderer';

// ============================================================================
// Stateful Wrapper for MentionInput (controlled component)
// ============================================================================

/**
 * A stateful wrapper that manages the value state for MentionInput,
 * mimicking how a real parent component would use it.
 * This avoids issues with controlled component behavior in tests.
 */
function MentionInputWrapper(props: {
  initialValue?: string;
  onPersonaSelected: (personaId: string) => void;
  onSubmit: () => void;
  allowedPersonaIds?: string[];
}) {
  const [value, setValue] = useState(props.initialValue ?? '');
  return (
    <MentionInput
      value={value}
      onChange={setValue}
      onPersonaSelected={props.onPersonaSelected}
      onSubmit={props.onSubmit}
      allowedPersonaIds={props.allowedPersonaIds}
    />
  );
}

// ============================================================================
// MentionInput Tests
// ============================================================================

describe('MentionInput', () => {
  it('shows dropdown when @ is typed', () => {
    const onPersonaSelected = vi.fn();
    const onSubmit = vi.fn();

    render(
      <MentionInputWrapper
        onPersonaSelected={onPersonaSelected}
        onSubmit={onSubmit}
      />
    );

    // Initially no dropdown
    expect(screen.queryByTestId('mention-dropdown')).not.toBeInTheDocument();

    // Simulate typing '@'
    const textarea = screen.getByTestId('mention-input-textarea') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '@' } });

    // Dropdown should be visible with all 6 personas
    expect(screen.getByTestId('mention-dropdown')).toBeInTheDocument();
    expect(screen.getByTestId('mention-option-assistant')).toBeInTheDocument();
    expect(screen.getByTestId('mention-option-product-manager')).toBeInTheDocument();
    expect(screen.getByTestId('mention-option-architect')).toBeInTheDocument();
    expect(screen.getByTestId('mention-option-ux-designer')).toBeInTheDocument();
    expect(screen.getByTestId('mention-option-test-engineer')).toBeInTheDocument();
    expect(screen.getByTestId('mention-option-software-developer')).toBeInTheDocument();
  });

  it('filters dropdown by text after @ character', () => {
    const onPersonaSelected = vi.fn();
    const onSubmit = vi.fn();

    render(
      <MentionInputWrapper
        onPersonaSelected={onPersonaSelected}
        onSubmit={onSubmit}
      />
    );

    const textarea = screen.getByTestId('mention-input-textarea') as HTMLTextAreaElement;

    // Simulate typing '@prod'
    fireEvent.change(textarea, { target: { value: '@prod' } });

    // Dropdown should be visible
    expect(screen.getByTestId('mention-dropdown')).toBeInTheDocument();

    // Only "Product Manager" should match the filter "prod"
    expect(screen.getByTestId('mention-option-product-manager')).toBeInTheDocument();

    // Others should not be visible
    expect(screen.queryByTestId('mention-option-assistant')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mention-option-architect')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mention-option-ux-designer')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mention-option-test-engineer')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mention-option-software-developer')).not.toBeInTheDocument();
  });

  it('calls onPersonaSelected and clears input on selection', () => {
    const onPersonaSelected = vi.fn();
    const onSubmit = vi.fn();

    render(
      <MentionInputWrapper
        onPersonaSelected={onPersonaSelected}
        onSubmit={onSubmit}
      />
    );

    const textarea = screen.getByTestId('mention-input-textarea') as HTMLTextAreaElement;

    // Trigger the dropdown by typing '@'
    fireEvent.change(textarea, { target: { value: '@' } });

    // Dropdown should appear
    expect(screen.getByTestId('mention-dropdown')).toBeInTheDocument();

    // Click on "Product Manager" option (mouseDown to prevent blur)
    const pmOption = screen.getByTestId('mention-option-product-manager');
    fireEvent.mouseDown(pmOption);

    // onPersonaSelected should have been called with the persona id
    expect(onPersonaSelected).toHaveBeenCalledWith('product-manager');

    // FR3: The textarea should now be cleared (not contain '@Product Manager ')
    expect(textarea.value).toBe('');

    // Dropdown should be dismissed
    expect(screen.queryByTestId('mention-dropdown')).not.toBeInTheDocument();
  });

  it('supports keyboard navigation (ArrowUp/ArrowDown/Enter/Escape)', () => {
    const onPersonaSelected = vi.fn();
    const onSubmit = vi.fn();

    render(
      <MentionInputWrapper
        onPersonaSelected={onPersonaSelected}
        onSubmit={onSubmit}
      />
    );

    const textarea = screen.getByTestId('mention-input-textarea') as HTMLTextAreaElement;

    // Trigger the dropdown
    fireEvent.change(textarea, { target: { value: '@' } });
    expect(screen.getByTestId('mention-dropdown')).toBeInTheDocument();

    // Initially first item (assistant) should be selected
    expect(screen.getByTestId('mention-option-assistant').getAttribute('aria-selected')).toBe('true');

    // Press ArrowDown to move to second item (product-manager)
    fireEvent.keyDown(textarea, { key: 'ArrowDown' });
    expect(screen.getByTestId('mention-option-product-manager').getAttribute('aria-selected')).toBe('true');

    // Press ArrowUp to go back to first item
    fireEvent.keyDown(textarea, { key: 'ArrowUp' });
    expect(screen.getByTestId('mention-option-assistant').getAttribute('aria-selected')).toBe('true');

    // Test Escape: dismiss dropdown without selecting
    fireEvent.keyDown(textarea, { key: 'Escape' });
    expect(screen.queryByTestId('mention-dropdown')).not.toBeInTheDocument();
    // onPersonaSelected should NOT have been called
    expect(onPersonaSelected).not.toHaveBeenCalled();

    // Re-open the dropdown by clearing text and typing '@' again
    // (need to change value for React controlled component to fire onChange)
    fireEvent.change(textarea, { target: { value: '' } });
    fireEvent.change(textarea, { target: { value: '@' } });
    expect(screen.getByTestId('mention-dropdown')).toBeInTheDocument();

    // Navigate down to product-manager and press Enter to select
    fireEvent.keyDown(textarea, { key: 'ArrowDown' });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    // Should have selected product-manager
    expect(onPersonaSelected).toHaveBeenCalledWith('product-manager');

    // Dropdown should be dismissed after selection
    expect(screen.queryByTestId('mention-dropdown')).not.toBeInTheDocument();
  });
});

// ============================================================================
// TaskMenu Tests
// ============================================================================

describe('TaskMenu', () => {
  const sampleTasks = [
    {
      taskId: 'define-product',
      menuLabel: 'Define Product',
      description: 'Define the product mission and vision',
    },
    {
      taskId: 'build-roadmap',
      menuLabel: 'Build Roadmap',
      description: 'Create a product roadmap with milestones',
    },
    {
      taskId: 'review-architecture',
      menuLabel: 'Review Architecture',
      description: 'Review and validate the solution architecture',
    },
  ];

  it('renders task cards with menuLabel and description', () => {
    const onSelectTask = vi.fn();
    render(<TaskMenu tasks={sampleTasks} onSelectTask={onSelectTask} />);

    // All 3 task cards should be rendered
    expect(screen.getByTestId('task-card-define-product')).toBeInTheDocument();
    expect(screen.getByTestId('task-card-build-roadmap')).toBeInTheDocument();
    expect(screen.getByTestId('task-card-review-architecture')).toBeInTheDocument();

    // Verify content of the first card
    const firstCard = screen.getByTestId('task-card-define-product');
    expect(firstCard).toHaveTextContent('Define Product');
    expect(firstCard).toHaveTextContent('Define the product mission and vision');

    // Verify content of the second card
    const secondCard = screen.getByTestId('task-card-build-roadmap');
    expect(secondCard).toHaveTextContent('Build Roadmap');
    expect(secondCard).toHaveTextContent('Create a product roadmap with milestones');
  });

  it('calls onSelectTask with correct taskId on click', () => {
    const onSelectTask = vi.fn();
    render(<TaskMenu tasks={sampleTasks} onSelectTask={onSelectTask} />);

    // Click the second task card
    fireEvent.click(screen.getByTestId('task-card-build-roadmap'));
    expect(onSelectTask).toHaveBeenCalledTimes(1);
    expect(onSelectTask).toHaveBeenCalledWith('build-roadmap');

    // Click the third task card
    fireEvent.click(screen.getByTestId('task-card-review-architecture'));
    expect(onSelectTask).toHaveBeenCalledTimes(2);
    expect(onSelectTask).toHaveBeenCalledWith('review-architecture');
  });
});

// ============================================================================
// StructuredQuestionsRenderer Tests
// ============================================================================

describe('StructuredQuestionsRenderer', () => {
  const sampleQuestions = [
    { id: 'q1', question: 'What is the primary user problem?' },
    { id: 'q2', question: 'Who is the target audience?' },
    { id: 'q3', question: 'What are the success criteria?' },
  ];

  it('renders question rows with text inputs and a Submit button', () => {
    const onSubmitAnswers = vi.fn();
    render(
      <StructuredQuestionsRenderer
        questions={sampleQuestions}
        onSubmitAnswers={onSubmitAnswers}
      />
    );

    // Should render the container
    expect(screen.getByTestId('structured-questions')).toBeInTheDocument();

    // Should render all 3 question rows
    expect(screen.getByTestId('question-row-q1')).toBeInTheDocument();
    expect(screen.getByTestId('question-row-q2')).toBeInTheDocument();
    expect(screen.getByTestId('question-row-q3')).toBeInTheDocument();

    // Each row should have a text input
    expect(screen.getByTestId('answer-input-q1')).toBeInTheDocument();
    expect(screen.getByTestId('answer-input-q2')).toBeInTheDocument();
    expect(screen.getByTestId('answer-input-q3')).toBeInTheDocument();

    // Question text should be visible
    expect(screen.getByText('What is the primary user problem?')).toBeInTheDocument();
    expect(screen.getByText('Who is the target audience?')).toBeInTheDocument();
    expect(screen.getByText('What are the success criteria?')).toBeInTheDocument();

    // Submit button should be present
    expect(screen.getByTestId('submit-answers-button')).toBeInTheDocument();
    expect(screen.getByTestId('submit-answers-button')).toHaveTextContent('Submit Answers');
  });

  it('disables Submit when all answers are empty, enables when at least one is non-empty', () => {
    const onSubmitAnswers = vi.fn();
    render(
      <StructuredQuestionsRenderer
        questions={sampleQuestions}
        onSubmitAnswers={onSubmitAnswers}
      />
    );

    const submitButton = screen.getByTestId('submit-answers-button');

    // Initially all answers are empty -- button should be disabled
    expect(submitButton).toBeDisabled();

    // Type an answer for the first question
    const input1 = screen.getByTestId('answer-input-q1');
    fireEvent.change(input1, { target: { value: 'Reduce manual data entry' } });

    // Button should now be enabled
    expect(submitButton).not.toBeDisabled();

    // Clear the answer
    fireEvent.change(input1, { target: { value: '' } });

    // Button should be disabled again
    expect(submitButton).toBeDisabled();

    // Type whitespace only -- should remain disabled
    fireEvent.change(input1, { target: { value: '   ' } });
    expect(submitButton).toBeDisabled();

    // Type a real answer in the second input
    const input2 = screen.getByTestId('answer-input-q2');
    fireEvent.change(input2, { target: { value: 'Small business owners' } });

    // Button should be enabled
    expect(submitButton).not.toBeDisabled();

    // Click submit
    fireEvent.click(submitButton);

    // onSubmitAnswers should have been called with the answered question(s)
    expect(onSubmitAnswers).toHaveBeenCalledTimes(1);
    expect(onSubmitAnswers).toHaveBeenCalledWith(
      [
        {
          id: 'q2',
          question: 'Who is the target audience?',
          answer: 'Small business owners',
        },
      ],
      undefined
    );
  });
});
