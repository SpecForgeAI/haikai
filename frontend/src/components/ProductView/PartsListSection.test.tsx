/**
 * Tests for PartsListSection Component
 *
 * Spec 2026-02-06: Implement-Part Sequencing Workflow
 * Task Group 5: Frontend API Functions and Parts List UI
 * Task 5.1: Write 4-6 focused tests for API functions and UI
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PartsListSection } from './PartsListSection';
import type { Part, PartStatus } from '../../types/part';

describe('PartsListSection', () => {
  const mockParts: Part[] = [
    {
      partIndex: 1,
      title: 'Database Schema Setup',
      intent: 'Create database tables for user authentication',
    },
    {
      partIndex: 2,
      title: 'API Endpoints',
      intent: 'Implement login and logout endpoints',
      dependencies: ['Part 1: Database Schema'],
    },
    {
      partIndex: 3,
      title: 'Frontend Components',
      intent: 'Create login form and authentication UI',
      dependencies: ['Part 2: API Endpoints'],
    },
  ];

  it('should render parts with correct status badges', () => {
    const partStatuses = new Map<number, PartStatus>([
      [1, 'COMPLETED'],
      [2, 'QA_IN_PROGRESS'],
      [3, 'PENDING'],
    ]);

    render(
      <PartsListSection
        parts={mockParts}
        partStatuses={partStatuses}
        activePartIndex={null}
        onPartClick={() => {}}
      />
    );

    // Check that parts are rendered
    expect(screen.getByText('Database Schema Setup')).toBeInTheDocument();
    expect(screen.getByText('API Endpoints')).toBeInTheDocument();
    expect(screen.getByText('Frontend Components')).toBeInTheDocument();

    // Check status badges
    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.getByText('Q&A In Progress')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
  });

  it('should highlight active part with distinct styling', () => {
    const partStatuses = new Map<number, PartStatus>([
      [1, 'PENDING'],
      [2, 'PENDING'],
    ]);

    render(
      <PartsListSection
        parts={mockParts.slice(0, 2)}
        partStatuses={partStatuses}
        activePartIndex={2}
        onPartClick={() => {}}
      />
    );

    // Check that the active card has the active class
    const activeCard = screen.getByTestId('part-card-2');
    expect(activeCard.className).toContain('partCardActive');

    // Check that the non-active card does not have the active class
    const inactiveCard = screen.getByTestId('part-card-1');
    expect(inactiveCard.className).not.toContain('partCardActive');
  });

  it('should call onPartClick when a part is clicked', () => {
    const mockOnPartClick = vi.fn();
    const partStatuses = new Map<number, PartStatus>([
      [1, 'PENDING'],
      [2, 'PENDING'],
    ]);

    render(
      <PartsListSection
        parts={mockParts.slice(0, 2)}
        partStatuses={partStatuses}
        activePartIndex={null}
        onPartClick={mockOnPartClick}
      />
    );

    // Click on the second part
    fireEvent.click(screen.getByTestId('part-card-2'));

    expect(mockOnPartClick).toHaveBeenCalledWith(2);
  });

  it('should show intervention buttons for FAILED parts', () => {
    const partStatuses = new Map<number, PartStatus>([
      [1, 'COMPLETED'],
      [2, 'FAILED'],
    ]);
    const mockOnRetryOrchestration = vi.fn();
    const mockOnResumeQA = vi.fn();

    render(
      <PartsListSection
        parts={mockParts.slice(0, 2)}
        partStatuses={partStatuses}
        activePartIndex={null}
        onPartClick={() => {}}
        onRetryOrchestration={mockOnRetryOrchestration}
        onResumeQA={mockOnResumeQA}
      />
    );

    // Check that intervention buttons are shown for the FAILED part
    expect(screen.getByTestId('retry-orchestration-2')).toBeInTheDocument();
    expect(screen.getByTestId('resume-qa-2')).toBeInTheDocument();

    // Check that buttons are not shown for the COMPLETED part
    expect(screen.queryByTestId('retry-orchestration-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('resume-qa-1')).not.toBeInTheDocument();
  });

  it('should call onRetryOrchestration when retry button is clicked', () => {
    const partStatuses = new Map<number, PartStatus>([[1, 'FAILED']]);
    const mockOnRetryOrchestration = vi.fn();

    render(
      <PartsListSection
        parts={mockParts.slice(0, 1)}
        partStatuses={partStatuses}
        activePartIndex={null}
        onPartClick={() => {}}
        onRetryOrchestration={mockOnRetryOrchestration}
      />
    );

    fireEvent.click(screen.getByTestId('retry-orchestration-1'));

    expect(mockOnRetryOrchestration).toHaveBeenCalledWith(1);
  });

  it('should return null when parts array is empty', () => {
    const { container } = render(
      <PartsListSection
        parts={[]}
        partStatuses={new Map()}
        activePartIndex={null}
        onPartClick={() => {}}
      />
    );

    expect(container.firstChild).toBeNull();
  });
});
