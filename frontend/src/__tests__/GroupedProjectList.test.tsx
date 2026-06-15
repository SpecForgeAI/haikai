/**
 * Unit tests for GroupedProjectList component.
 *
 * Spec 2026-01-10: Project Hierarchy Grouping
 * Task Group 3: UI Component Tests
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GroupedProjectList } from '../components/Project/GroupedProjectList';
import { ProjectDto } from '../api/projectsApi';

// Helper to create test projects
const createProject = (
  id: string,
  name: string,
  hierarchy: string | null
): ProjectDto => ({
  id,
  name,
  projectParentFolder: `/projects/${id}`,
  projectHierarchy: hierarchy,
  isActive: false,
  createdAt: '2026-01-10T00:00:00Z',
  updatedAt: '2026-01-10T00:00:00Z',
});

describe('GroupedProjectList', () => {
  describe('Grouping behavior', () => {
    it('groups projects by projectHierarchy value', () => {
      const projects: ProjectDto[] = [
        createProject('1', 'Project A', 'ClientA'),
        createProject('2', 'Project B', 'ClientA'),
        createProject('3', 'Project C', 'Internal'),
      ];

      render(
        <GroupedProjectList
          projects={projects}
          selectedProjectId={null}
          onProjectClick={() => {}}
        />
      );

      // Check both sections exist
      expect(screen.getByTestId('section-ClientA')).toBeInTheDocument();
      expect(screen.getByTestId('section-Internal')).toBeInTheDocument();
    });

    it('renders "(No hierarchy)" section for null hierarchy projects', () => {
      const projects: ProjectDto[] = [
        createProject('1', 'Project A', null),
        createProject('2', 'Project B', 'ClientA'),
      ];

      render(
        <GroupedProjectList
          projects={projects}
          selectedProjectId={null}
          onProjectClick={() => {}}
        />
      );

      expect(screen.getByTestId('section-(No hierarchy)')).toBeInTheDocument();
      expect(screen.getByText('(No hierarchy)')).toBeInTheDocument();
    });

    it('displays "(No hierarchy)" section first before alphabetical sections', () => {
      const projects: ProjectDto[] = [
        createProject('1', 'Project A', 'Zebra'),
        createProject('2', 'Project B', null),
        createProject('3', 'Project C', 'Alpha'),
      ];

      render(
        <GroupedProjectList
          projects={projects}
          selectedProjectId={null}
          onProjectClick={() => {}}
        />
      );

      const sections = screen.getAllByRole('button');
      // Section headers are buttons
      expect(sections[0]).toHaveTextContent('(No hierarchy)');
      expect(sections[1]).toHaveTextContent('Alpha');
      expect(sections[2]).toHaveTextContent('Zebra');
    });
  });

  describe('Sorting behavior', () => {
    it('orders sections alphabetically (after "(No hierarchy)")', () => {
      const projects: ProjectDto[] = [
        createProject('1', 'P1', 'Zebra'),
        createProject('2', 'P2', 'Alpha'),
        createProject('3', 'P3', 'Beta'),
      ];

      render(
        <GroupedProjectList
          projects={projects}
          selectedProjectId={null}
          onProjectClick={() => {}}
        />
      );

      const sections = screen.getAllByRole('button');
      expect(sections[0]).toHaveTextContent('Alpha');
      expect(sections[1]).toHaveTextContent('Beta');
      expect(sections[2]).toHaveTextContent('Zebra');
    });

    it('orders projects within sections alphabetically by name', () => {
      const projects: ProjectDto[] = [
        createProject('1', 'Zulu Project', 'ClientA'),
        createProject('2', 'Alpha Project', 'ClientA'),
        createProject('3', 'Mike Project', 'ClientA'),
      ];

      render(
        <GroupedProjectList
          projects={projects}
          selectedProjectId={null}
          onProjectClick={() => {}}
        />
      );

      const projectRows = screen.getAllByRole('option');
      expect(projectRows[0]).toHaveTextContent('Alpha Project');
      expect(projectRows[1]).toHaveTextContent('Mike Project');
      expect(projectRows[2]).toHaveTextContent('Zulu Project');
    });
  });

  describe('Collapsible sections', () => {
    it('sections are independently collapsible', () => {
      const projects: ProjectDto[] = [
        createProject('1', 'Project A', 'ClientA'),
        createProject('2', 'Project B', 'ClientB'),
      ];

      render(
        <GroupedProjectList
          projects={projects}
          selectedProjectId={null}
          onProjectClick={() => {}}
        />
      );

      // Both sections should start expanded
      expect(screen.getByTestId('project-row-1')).toBeInTheDocument();
      expect(screen.getByTestId('project-row-2')).toBeInTheDocument();

      // Collapse ClientA section
      const clientAHeader = screen.getByTestId('section-header-ClientA');
      fireEvent.click(clientAHeader);

      // ClientA project should be hidden, ClientB project should still show
      expect(screen.queryByTestId('project-row-1')).not.toBeInTheDocument();
      expect(screen.getByTestId('project-row-2')).toBeInTheDocument();
    });

    it('all sections default to expanded state', () => {
      const projects: ProjectDto[] = [
        createProject('1', 'Project A', 'ClientA'),
        createProject('2', 'Project B', null),
      ];

      render(
        <GroupedProjectList
          projects={projects}
          selectedProjectId={null}
          onProjectClick={() => {}}
        />
      );

      // All project rows should be visible (sections expanded)
      expect(screen.getByTestId('project-row-1')).toBeInTheDocument();
      expect(screen.getByTestId('project-row-2')).toBeInTheDocument();
    });
  });

  describe('Selection behavior', () => {
    it('calls onProjectClick with correct project ID when row clicked', () => {
      const onProjectClick = vi.fn();
      const projects: ProjectDto[] = [
        createProject('test-id-123', 'Test Project', 'ClientA'),
      ];

      render(
        <GroupedProjectList
          projects={projects}
          selectedProjectId={null}
          onProjectClick={onProjectClick}
        />
      );

      fireEvent.click(screen.getByTestId('project-row-test-id-123'));
      expect(onProjectClick).toHaveBeenCalledWith('test-id-123');
    });

    it('applies selected styling to selected project row', () => {
      const projects: ProjectDto[] = [
        createProject('1', 'Project A', 'ClientA'),
        createProject('2', 'Project B', 'ClientA'),
      ];

      render(
        <GroupedProjectList
          projects={projects}
          selectedProjectId="1"
          onProjectClick={() => {}}
        />
      );

      const selectedRow = screen.getByTestId('project-row-1');
      expect(selectedRow).toHaveAttribute('aria-selected', 'true');
    });
  });

  describe('Empty state', () => {
    it('renders empty message when no projects', () => {
      render(
        <GroupedProjectList
          projects={[]}
          selectedProjectId={null}
          onProjectClick={() => {}}
        />
      );

      expect(screen.getByText('No products available')).toBeInTheDocument();
    });
  });

  describe('Section counts', () => {
    it('shows correct project count in section header', () => {
      const projects: ProjectDto[] = [
        createProject('1', 'Project A', 'ClientA'),
        createProject('2', 'Project B', 'ClientA'),
        createProject('3', 'Project C', 'ClientA'),
      ];

      render(
        <GroupedProjectList
          projects={projects}
          selectedProjectId={null}
          onProjectClick={() => {}}
        />
      );

      expect(screen.getByText('(3)')).toBeInTheDocument();
    });
  });
});
