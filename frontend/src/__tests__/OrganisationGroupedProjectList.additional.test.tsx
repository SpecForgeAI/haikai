/**
 * Additional strategic tests for OrganisationGroupedProjectList component.
 *
 * Spec 2026-01-18: Organisations Iteration 3 - Update Project Open Modal
 * Task Group 4: Test Review and Gap Analysis
 *
 * These tests fill critical gaps identified during test review:
 * 1. Organisation with multiple hierarchies renders correctly
 * 2. Expanding one org does not affect other orgs' expand state
 * 3. Organisation name fallback if org not found in map
 * 4. Case-insensitive sorting verification
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
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

describe('OrganisationGroupedProjectList - Additional Strategic Tests', () => {
  describe('multiple hierarchies within organisation', () => {
    it('renders organisation with multiple hierarchies correctly', () => {
      const projects: ProjectDto[] = [
        createProject('1', 'Project A', 'Hierarchy1', 'org-1'),
        createProject('2', 'Project B', 'Hierarchy2', 'org-1'),
        createProject('3', 'Project C', 'Hierarchy3', 'org-1'),
        createProject('4', 'Project D', null, 'org-1'),
      ];
      const orgMap = createOrgMap([['org-1', 'Test Organisation']]);

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

      // All 4 hierarchy sections should be visible
      expect(screen.getByTestId('hierarchy-header-org-1-(No hierarchy)')).toBeInTheDocument();
      expect(screen.getByTestId('hierarchy-header-org-1-Hierarchy1')).toBeInTheDocument();
      expect(screen.getByTestId('hierarchy-header-org-1-Hierarchy2')).toBeInTheDocument();
      expect(screen.getByTestId('hierarchy-header-org-1-Hierarchy3')).toBeInTheDocument();
    });
  });

  describe('independent org expand/collapse state', () => {
    it('expanding one org does not affect other orgs expand state', () => {
      const projects: ProjectDto[] = [
        createProject('1', 'Project A', 'H1', 'org-1'),
        createProject('2', 'Project B', 'H2', 'org-2'),
        createProject('3', 'Project C', 'H3', 'org-3'),
      ];
      const orgMap = createOrgMap([
        ['org-1', 'Org One'],
        ['org-2', 'Org Two'],
        ['org-3', 'Org Three'],
      ]);

      render(
        <OrganisationGroupedProjectList
          projects={projects}
          organisationMap={orgMap}
          selectedProjectId={null}
          onProjectClick={() => {}}
        />
      );

      // Initially all orgs are collapsed - no hierarchy headers visible
      expect(screen.queryByTestId('hierarchy-header-org-1-H1')).not.toBeInTheDocument();
      expect(screen.queryByTestId('hierarchy-header-org-2-H2')).not.toBeInTheDocument();
      expect(screen.queryByTestId('hierarchy-header-org-3-H3')).not.toBeInTheDocument();

      // Expand org-1
      fireEvent.click(screen.getByTestId('org-header-org-1'));

      // Only org-1's hierarchy should be visible
      expect(screen.getByTestId('hierarchy-header-org-1-H1')).toBeInTheDocument();
      expect(screen.queryByTestId('hierarchy-header-org-2-H2')).not.toBeInTheDocument();
      expect(screen.queryByTestId('hierarchy-header-org-3-H3')).not.toBeInTheDocument();

      // Expand org-2
      fireEvent.click(screen.getByTestId('org-header-org-2'));

      // Both org-1 and org-2 hierarchies should be visible
      expect(screen.getByTestId('hierarchy-header-org-1-H1')).toBeInTheDocument();
      expect(screen.getByTestId('hierarchy-header-org-2-H2')).toBeInTheDocument();
      expect(screen.queryByTestId('hierarchy-header-org-3-H3')).not.toBeInTheDocument();

      // Collapse org-1
      fireEvent.click(screen.getByTestId('org-header-org-1'));

      // Only org-2 hierarchy should be visible now
      expect(screen.queryByTestId('hierarchy-header-org-1-H1')).not.toBeInTheDocument();
      expect(screen.getByTestId('hierarchy-header-org-2-H2')).toBeInTheDocument();
    });
  });

  describe('organisation name fallback', () => {
    it('displays organisation ID when org name not found in map', () => {
      const projects: ProjectDto[] = [
        createProject('1', 'Project A', 'H1', 'unknown-org-id'),
      ];
      // Empty map - no org name mapping
      const orgMap = createOrgMap([]);

      render(
        <OrganisationGroupedProjectList
          projects={projects}
          organisationMap={orgMap}
          selectedProjectId={null}
          onProjectClick={() => {}}
        />
      );

      // Should display the org ID as fallback
      expect(screen.getByText('unknown-org-id')).toBeInTheDocument();
    });
  });

  describe('case-insensitive sorting', () => {
    it('sorts organisations case-insensitively (A-Z)', () => {
      const projects: ProjectDto[] = [
        createProject('1', 'P1', null, 'org-z'),
        createProject('2', 'P2', null, 'org-a'),
        createProject('3', 'P3', null, 'org-m'),
      ];
      const orgMap = createOrgMap([
        ['org-z', 'zebra Corp'],  // lowercase z
        ['org-a', 'Alpha Inc'],   // uppercase A
        ['org-m', 'MIKE LLC'],    // uppercase M
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
      // Should be sorted A-Z case-insensitive: Alpha, MIKE, zebra
      expect(orgHeaders[0]).toHaveTextContent('Alpha Inc');
      expect(orgHeaders[1]).toHaveTextContent('MIKE LLC');
      expect(orgHeaders[2]).toHaveTextContent('zebra Corp');
    });

    it('sorts projects within hierarchy case-insensitively', () => {
      const projects: ProjectDto[] = [
        createProject('1', 'zulu Project', 'H1', 'org-1'),
        createProject('2', 'Alpha Project', 'H1', 'org-1'),
        createProject('3', 'MIKE Project', 'H1', 'org-1'),
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
      fireEvent.click(screen.getByTestId('hierarchy-header-org-1-H1'));

      const projectRows = screen.getAllByRole('option');
      // Should be sorted A-Z case-insensitive: Alpha, MIKE, zulu
      expect(projectRows[0]).toHaveTextContent('Alpha Project');
      expect(projectRows[1]).toHaveTextContent('MIKE Project');
      expect(projectRows[2]).toHaveTextContent('zulu Project');
    });
  });

  describe('keyboard accessibility', () => {
    it('org header can be toggled with Enter key', () => {
      const projects: ProjectDto[] = [
        createProject('1', 'Project A', 'H1', 'org-1'),
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

      const orgHeader = screen.getByTestId('org-header-org-1');

      // Initially collapsed
      expect(screen.queryByTestId('hierarchy-header-org-1-H1')).not.toBeInTheDocument();

      // Press Enter to expand
      fireEvent.keyDown(orgHeader, { key: 'Enter' });
      expect(screen.getByTestId('hierarchy-header-org-1-H1')).toBeInTheDocument();

      // Press Space to collapse
      fireEvent.keyDown(orgHeader, { key: ' ' });
      expect(screen.queryByTestId('hierarchy-header-org-1-H1')).not.toBeInTheDocument();
    });
  });
});
