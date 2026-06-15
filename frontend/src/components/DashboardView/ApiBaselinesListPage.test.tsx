/**
 * ApiBaselinesListPage tests
 *
 * Spec 2026-05-15 API Behaviour Baseline Capture Service -- Task Group 8
 * Task 8.1 sub-test #1: the page renders BOTH `CaptureSessionsList` AND
 * `BaselinesList` for the active project + architecture.
 *
 * The sub-list children are mocked to keep this test focused on
 * orchestration / data wiring; per-row rendering and load logic of the
 * sub-lists are covered transitively by their own tests where needed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../contexts/ProjectContext', () => ({
  useProject: vi.fn(),
}));

vi.mock('../../contexts/ArchitectureContext', () => ({
  useActiveArchitectureId: vi.fn(),
}));

vi.mock('./CaptureSessionsList', () => ({
  CaptureSessionsList: (props: { projectId: string; architectureId: string | null }) => (
    <div
      data-testid="mock-capture-sessions-list"
      data-project-id={props.projectId}
      data-architecture-id={props.architectureId ?? ''}
    />
  ),
}));

vi.mock('./BaselinesList', () => ({
  BaselinesList: (props: { projectId: string; architectureId: string | null }) => (
    <div
      data-testid="mock-baselines-list"
      data-project-id={props.projectId}
      data-architecture-id={props.architectureId ?? ''}
    />
  ),
}));

import { useProject } from '../../contexts/ProjectContext';
import { useActiveArchitectureId } from '../../contexts/ArchitectureContext';
import { ApiBaselinesListPage } from './ApiBaselinesListPage';

const PROJECT_ID = 'proj-list-1';
const ARCH_ID = 'arch-list-1';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useProject).mockReturnValue({
    id: PROJECT_ID,
    name: 'Test project',
  } as unknown as ReturnType<typeof useProject>);
  vi.mocked(useActiveArchitectureId).mockReturnValue(ARCH_ID);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ApiBaselinesListPage (Task 8.1 #1)', () => {
  it('renders both CaptureSessionsList and BaselinesList for the active project + architecture', () => {
    render(
      <MemoryRouter>
        <ApiBaselinesListPage />
      </MemoryRouter>,
    );

    const sessions = screen.getByTestId('mock-capture-sessions-list');
    const baselines = screen.getByTestId('mock-baselines-list');
    expect(sessions).toBeInTheDocument();
    expect(baselines).toBeInTheDocument();
    expect(sessions.getAttribute('data-project-id')).toBe(PROJECT_ID);
    expect(sessions.getAttribute('data-architecture-id')).toBe(ARCH_ID);
    expect(baselines.getAttribute('data-project-id')).toBe(PROJECT_ID);
    expect(baselines.getAttribute('data-architecture-id')).toBe(ARCH_ID);
  });
});
