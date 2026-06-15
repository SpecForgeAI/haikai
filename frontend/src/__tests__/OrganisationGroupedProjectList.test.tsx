/**
 * Unit tests for OrganisationGroupedProjectList component.
 *
 * Spec 2026-01-18: Organisations Iteration 3 - Update Project Open Modal
 * Task Group 2: Create OrganisationGroupedProjectList Component
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OrganisationGroupedProjectList } from '../components/Project/OrganisationGroupedProjectList';
import { ProjectDto } from '../api/projectsApi';

// Helper to create test projects with organisationId
const createProject = (
  id: string,
  name: string,
  hierarchy: string | null,
  organisationId: string | null
): ProjectDto => ({
  id,
  name,
  projectParentFolder: `/projects/${id}`,
  projectHierarchy: hierarchy,
  organisationId,
  isActive: false,
  createdAt: '2026-01-18T00:00:00Z',
  updatedAt: '2026-01-18T00:00:00Z',
});

// Helper to create organisation map
const createOrgMap = (entries: [string, string][]): Map<string, string> => {
  return new Map(entries);
};

describe('OrganisationGroupedProjectList', () => {
  describe('2-level grouping', () => {
    it('groups projects by organisation, then by hierarchy within each org', () => {
      const projects: ProjectDto[] = [
        createProject('1', 'Project A', 'HierarchyX', 'org-1'),
        createProject('2', 'Project B', 'HierarchyY', 'org-1'),
        createProject('3', 'Project C', 'HierarchyZ', 'org-2'),
      ];
      const orgMap = createOrgMap([
        ['org-1', 'Acme Corp'],
        ['org-2', 'Beta Inc'],
      ]);

      render(
        <OrganisationGroupedProjectList
          projects={projects}
          organisationMap={orgMap}
          selectedProjectId={null}
          onProjectClick={() => {}}
        />
      );

      // Check both organisation sections exist
      expect(screen.getByTestId('org-section-org-1')).toBeInTheDocument();
      expect(screen.getByTestId('org-section-org-2')).toBeInTheDocument();
      expect(screen.getByText('Acme Corp')).toBeInTheDocument();
      expect(screen.getByText('Beta Inc')).toBeInTheDocument();
    });

    it('sorts organisation sections A-Z by name (case-insensitive)', () => {
      const projects: ProjectDto[] = [
        createProject('1', 'Project A', null, 'org-z'),
        createProject('2', 'Project B', null, 'org-a'),
        createProject('3', 'Project C', null, 'org-m'),
      ];
      const orgMap = createOrgMap([
        ['org-z', 'Zebra Corp'],
        ['org-a', 'Alpha Inc'],
        ['org-m', 'Mike LLC'],
      ]);

      render(
        <OrganisationGroupedProjectList
          projects={projects}
          organisationMap={orgMap}
          selectedProjectId={null}
          onProjectClick={() => {}}
        />
      );

      const orgHeaders = screen.getAllByTestId(/^org-header-/);
      expect(orgHeaders[0]).toHaveTextContent('Alpha Inc');
      expect(orgHeaders[1]).toHaveTextContent('Mike LLC');
      expect(orgHeaders[2]).toHaveTextContent('Zebra Corp');
    });

    it('renders "(No hierarchy)" section first within each organisation', () => {
      const projects: ProjectDto[] = [
        createProject('1', 'Project A', 'Zebra', 'org-1'),
        createProject('2', 'Project B', null, 'org-1'),
        createProject('3', 'Project C', 'Alpha', 'org-1'),
      ];
      const orgMap = createOrgMap([['org-1', 'Test Org']]);

      render(
        <OrganisationGroupedProjectList
          projects={projects}
          organisationMap={orgMap}
          selectedProjectId={null}
          onProjectClick={() => {}}
        />
      );

      // Expand the organisation to see hierarchies
      const orgHeader = screen.getByTestId('org-header-org-1');
      fireEvent.click(orgHeader);

      const hierarchyHeaders = screen.getAllByTestId(/^hierarchy-header-/);
      expect(hierarchyHeaders[0]).toHaveTextContent('(No hierarchy)');
      expect(hierarchyHeaders[1]).toHaveTextContent('Alpha');
      expect(hierarchyHeaders[2]).toHaveTextContent('Zebra');
    });

    it('sorts projects within hierarchy sections A-Z by name', () => {
      const projects: ProjectDto[] = [
        createProject('1', 'Zulu Project', 'ClientA', 'org-1'),
        createProject('2', 'Alpha Project', 'ClientA', 'org-1'),
        createProject('3', 'Mike Project', 'ClientA', 'org-1'),
      ];
      const orgMap = createOrgMap([['org-1', 'Test Org']]);

      render(
        <OrganisationGroupedProjectList
          projects={projects}
          organisationMap={orgMap}
          selectedProjectId={null}
          onProjectClick={() => {}}
        />
      );

      // Expand org and hierarchy
      fireEvent.click(screen.getByTestId('org-header-org-1'));
      fireEvent.click(screen.getByTestId('hierarchy-header-org-1-ClientA'));

      const projectRows = screen.getAllByRole('option');
      expect(projectRows[0]).toHaveTextContent('Alpha Project');
      expect(projectRows[1]).toHaveTextContent('Mike Project');
      expect(projectRows[2]).toHaveTextContent('Zulu Project');
    });
  });

  describe('expand/collapse state', () => {
    it('all organisation sections are collapsed by default', () => {
      const projects: ProjectDto[] = [
        createProject('1', 'Project A', 'Hierarchy1', 'org-1'),
        createProject('2', 'Project B', 'Hierarchy2', 'org-2'),
      ];
      const orgMap = createOrgMap([
        ['org-1', 'Org One'],
        ['org-2', 'Org Two'],
      ]);

      render(
        <OrganisationGroupedProjectList
          projects={projects}
          organisationMap={orgMap}
          selectedProjectId={null}
          onProjectClick={() => {}}
        />
      );

      // Hierarchy sections should not be visible (orgs are collapsed)
      expect(screen.queryByTestId('hierarchy-header-org-1-Hierarchy1')).not.toBeInTheDocument();
      expect(screen.queryByTestId('hierarchy-header-org-2-Hierarchy2')).not.toBeInTheDocument();
    });

    it('expanding organisation does NOT auto-expand its child hierarchies', () => {
      const projects: ProjectDto[] = [
        createProject('1', 'Project A', 'Hierarchy1', 'org-1'),
      ];
      const orgMap = createOrgMap([['org-1', 'Org One']]);

      render(
        <OrganisationGroupedProjectList
          projects={projects}
          organisationMap={orgMap}
          selectedProjectId={null}
          onProjectClick={() => {}}
        />
      );

      // Expand the organisation
      fireEvent.click(screen.getByTestId('org-header-org-1'));

      // Hierarchy header should be visible
      expect(screen.getByTestId('hierarchy-header-org-1-Hierarchy1')).toBeInTheDocument();

      // But project row should not be visible (hierarchy is collapsed)
      expect(screen.queryByTestId('project-row-1')).not.toBeInTheDocument();
    });
  });

  describe('filtering', () => {
    it('excludes projects with null organisationId from rendering', () => {
      const projects: ProjectDto[] = [
        createProject('1', 'Project With Org', 'Hierarchy1', 'org-1'),
        createProject('2', 'Orphan Project', 'Hierarchy2', null), // null org
      ];
      const orgMap = createOrgMap([['org-1', 'Org One']]);

      render(
        <OrganisationGroupedProjectList
          projects={projects}
          organisationMap={orgMap}
          selectedProjectId={null}
          onProjectClick={() => {}}
        />
      );

      // Only org-1 should be rendered
      expect(screen.getByTestId('org-section-org-1')).toBeInTheDocument();

      // Expand org and hierarchy to check projects
      fireEvent.click(screen.getByTestId('org-header-org-1'));
      fireEvent.click(screen.getByTestId('hierarchy-header-org-1-Hierarchy1'));

      // Only Project With Org should be rendered
      expect(screen.getByTestId('project-row-1')).toBeInTheDocument();
      expect(screen.queryByTestId('project-row-2')).not.toBeInTheDocument();
    });
  });

  describe('selection and click handling', () => {
    it('calls onProjectClick with correct project ID when row clicked', () => {
      const onProjectClick = vi.fn();
      const projects: ProjectDto[] = [
        createProject('test-id-123', 'Test Project', 'ClientA', 'org-1'),
      ];
      const orgMap = createOrgMap([['org-1', 'Test Org']]);

      render(
        <OrganisationGroupedProjectList
          projects={projects}
          organisationMap={orgMap}
          selectedProjectId={null}
          onProjectClick={onProjectClick}
        />
      );

      // Expand org and hierarchy
      fireEvent.click(screen.getByTestId('org-header-org-1'));
      fireEvent.click(screen.getByTestId('hierarchy-header-org-1-ClientA'));

      // Click on project row
      fireEvent.click(screen.getByTestId('project-row-test-id-123'));
      expect(onProjectClick).toHaveBeenCalledWith('test-id-123');
    });

    it('applies selected styling to selected project row', () => {
      const projects: ProjectDto[] = [
        createProject('1', 'Project A', 'ClientA', 'org-1'),
        createProject('2', 'Project B', 'ClientA', 'org-1'),
      ];
      const orgMap = createOrgMap([['org-1', 'Test Org']]);

      render(
        <OrganisationGroupedProjectList
          projects={projects}
          organisationMap={orgMap}
          selectedProjectId="1"
          onProjectClick={() => {}}
        />
      );

      // Expand org and hierarchy
      fireEvent.click(screen.getByTestId('org-header-org-1'));
      fireEvent.click(screen.getByTestId('hierarchy-header-org-1-ClientA'));

      const selectedRow = screen.getByTestId('project-row-1');
      expect(selectedRow).toHaveAttribute('aria-selected', 'true');
    });
  });

  describe('empty state', () => {
    it('renders empty message when no projects', () => {
      render(
        <OrganisationGroupedProjectList
          projects={[]}
          organisationMap={new Map()}
          selectedProjectId={null}
          onProjectClick={() => {}}
        />
      );

      expect(screen.getByText('No products available')).toBeInTheDocument();
    });

    it('renders empty message when all projects have null organisationId', () => {
      const projects: ProjectDto[] = [
        createProject('1', 'Orphan 1', null, null),
        createProject('2', 'Orphan 2', null, null),
      ];

      render(
        <OrganisationGroupedProjectList
          projects={projects}
          organisationMap={new Map()}
          selectedProjectId={null}
          onProjectClick={() => {}}
        />
      );

      expect(screen.getByText('No products available')).toBeInTheDocument();
    });
  });

  describe('section counts', () => {
    it('shows correct project count in organisation header', () => {
      const projects: ProjectDto[] = [
        createProject('1', 'Project A', 'H1', 'org-1'),
        createProject('2', 'Project B', 'H2', 'org-1'),
        createProject('3', 'Project C', 'H1', 'org-1'),
      ];
      const orgMap = createOrgMap([['org-1', 'Test Org']]);

      render(
        <OrganisationGroupedProjectList
          projects={projects}
          organisationMap={orgMap}
          selectedProjectId={null}
          onProjectClick={() => {}}
        />
      );

      expect(screen.getByTestId('org-header-org-1')).toHaveTextContent('(3)');
    });

    it('shows correct project count in hierarchy header', () => {
      const projects: ProjectDto[] = [
        createProject('1', 'Project A', 'H1', 'org-1'),
        createProject('2', 'Project B', 'H1', 'org-1'),
        createProject('3', 'Project C', 'H2', 'org-1'),
      ];
      const orgMap = createOrgMap([['org-1', 'Test Org']]);

      render(
        <OrganisationGroupedProjectList
          projects={projects}
          organisationMap={orgMap}
          selectedProjectId={null}
          onProjectClick={() => {}}
        />
      );

      // Expand org
      fireEvent.click(screen.getByTestId('org-header-org-1'));

      expect(screen.getByTestId('hierarchy-header-org-1-H1')).toHaveTextContent('(2)');
      expect(screen.getByTestId('hierarchy-header-org-1-H2')).toHaveTextContent('(1)');
    });
  });
});
