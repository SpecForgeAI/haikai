/**
 * OrganisationGroupedProjectList Component
 *
 * Spec 2026-01-18: Organisations Iteration 3 - Update Project Open Modal
 *
 * Reusable component for rendering projects in a 2-level collapsible tree structure:
 * - Level 1: Organisation sections (sorted A-Z by name)
 * - Level 2: Project Hierarchy sections within each organisation (sorted A-Z, "(No hierarchy)" first)
 * - Leaf: Projects (sorted A-Z by name, selectable for opening)
 *
 * Features:
 * - 2-level grouping: Organisation -> Hierarchy -> Projects
 * - Collapsible sections at both levels with independent expand/collapse
 * - All organisation sections default to collapsed
 * - Expanding organisation does NOT auto-expand child hierarchies
 * - Projects with null organisationId are excluded from rendering
 * - Visual indentation to indicate nesting level
 */

import React, { useState, useMemo, useCallback } from 'react';
import { ProjectDto } from '../../api/projectsApi';
import styles from './OrganisationGroupedProjectList.module.css';

/**
 * Display name for projects without a hierarchy
 */
const NO_HIERARCHY_LABEL = '(No hierarchy)';

/**
 * Props for OrganisationGroupedProjectList component
 */
export interface OrganisationGroupedProjectListProps {
  /** List of projects to display */
  projects: ProjectDto[];
  /** Map of organisation ID to organisation name */
  organisationMap: Map<string, string>;
  /** Currently selected project ID, or null if none selected */
  selectedProjectId: string | null;
  /** Callback when a project row is clicked */
  onProjectClick: (projectId: string) => void;
  /** Optional function to format dates for display */
  formatDate?: (dateString?: string) => string;
}

/**
 * Internal type representing a hierarchy section within an organisation
 */
interface HierarchySection {
  /** Display name for the section header */
  name: string;
  /** Raw hierarchy key (null for no hierarchy) */
  hierarchyKey: string | null;
  /** Projects in this section, sorted alphabetically by name */
  projects: ProjectDto[];
}

/**
 * Internal type representing an organisation section
 */
interface OrganisationSection {
  /** Organisation ID */
  orgId: string;
  /** Organisation display name */
  name: string;
  /** Total project count across all hierarchies */
  projectCount: number;
  /** Hierarchy sections within this organisation */
  hierarchies: HierarchySection[];
}

/**
 * Default date formatter
 */
const defaultFormatDate = (dateString?: string): string => {
  if (!dateString) return '';
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString();
  } catch {
    return '';
  }
};

/**
 * OrganisationGroupedProjectList Component
 *
 * Renders projects in a 2-level collapsible tree: Organisation -> Hierarchy -> Projects
 */
export function OrganisationGroupedProjectList({
  projects,
  organisationMap,
  selectedProjectId,
  onProjectClick,
  formatDate = defaultFormatDate,
}: OrganisationGroupedProjectListProps) {
  // State for tracking which organisations are expanded (empty = all collapsed)
  const [expandedOrgs, setExpandedOrgs] = useState<Set<string>>(new Set());

  // State for tracking which hierarchies are expanded within each organisation
  // Map<orgId, Set<hierarchyKey>>
  const [expandedHierarchies, setExpandedHierarchies] = useState<Map<string, Set<string>>>(
    new Map()
  );

  /**
   * Build 2-level grouped structure from projects
   * Level 1: Group by organisation
   * Level 2: Within each org, group by hierarchy
   */
  const organisationSections = useMemo((): OrganisationSection[] => {
    // Filter out projects without an organisation
    const projectsWithOrg = projects.filter((p) => p.organisationId !== null);

    // Group projects by organisation
    const orgGroups = new Map<string, ProjectDto[]>();

    projectsWithOrg.forEach((project) => {
      const orgId = project.organisationId!;
      if (!orgGroups.has(orgId)) {
        orgGroups.set(orgId, []);
      }
      orgGroups.get(orgId)!.push(project);
    });

    // Build organisation sections
    const sections: OrganisationSection[] = [];

    orgGroups.forEach((orgProjects, orgId) => {
      const orgName = organisationMap.get(orgId) || orgId;

      // Group projects by hierarchy within this org
      const hierarchyGroups = new Map<string | null, ProjectDto[]>();

      orgProjects.forEach((project) => {
        const key = project.projectHierarchy;
        if (!hierarchyGroups.has(key)) {
          hierarchyGroups.set(key, []);
        }
        hierarchyGroups.get(key)!.push(project);
      });

      // Sort projects within each hierarchy group alphabetically by name
      hierarchyGroups.forEach((projectList) => {
        projectList.sort((a, b) =>
          a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
        );
      });

      // Build hierarchy sections
      const hierarchies: HierarchySection[] = [];

      // Add "(No hierarchy)" section first if it exists
      if (hierarchyGroups.has(null)) {
        hierarchies.push({
          name: NO_HIERARCHY_LABEL,
          hierarchyKey: null,
          projects: hierarchyGroups.get(null)!,
        });
      }

      // Add other hierarchies sorted alphabetically
      const otherKeys = Array.from(hierarchyGroups.keys())
        .filter((key) => key !== null)
        .sort((a, b) =>
          (a as string).localeCompare(b as string, undefined, { sensitivity: 'base' })
        );

      otherKeys.forEach((key) => {
        hierarchies.push({
          name: key as string,
          hierarchyKey: key,
          projects: hierarchyGroups.get(key)!,
        });
      });

      sections.push({
        orgId,
        name: orgName,
        projectCount: orgProjects.length,
        hierarchies,
      });
    });

    // Sort organisation sections alphabetically by name (case-insensitive)
    sections.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

    return sections;
  }, [projects, organisationMap]);

  /**
   * Toggle organisation expand/collapse state
   */
  const toggleOrganisation = useCallback((orgId: string) => {
    setExpandedOrgs((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(orgId)) {
        newSet.delete(orgId);
      } else {
        newSet.add(orgId);
      }
      return newSet;
    });
  }, []);

  /**
   * Toggle hierarchy expand/collapse state within an organisation
   */
  const toggleHierarchy = useCallback((orgId: string, hierarchyKey: string | null) => {
    const sectionKey = hierarchyKey ?? NO_HIERARCHY_LABEL;

    setExpandedHierarchies((prev) => {
      const newMap = new Map(prev);
      const orgHierarchies = newMap.get(orgId) ?? new Set();
      const newOrgHierarchies = new Set(orgHierarchies);

      if (newOrgHierarchies.has(sectionKey)) {
        newOrgHierarchies.delete(sectionKey);
      } else {
        newOrgHierarchies.add(sectionKey);
      }

      newMap.set(orgId, newOrgHierarchies);
      return newMap;
    });
  }, []);

  /**
   * Check if an organisation section is expanded
   */
  const isOrgExpanded = useCallback(
    (orgId: string): boolean => {
      return expandedOrgs.has(orgId);
    },
    [expandedOrgs]
  );

  /**
   * Check if a hierarchy section is expanded within an organisation
   */
  const isHierarchyExpanded = useCallback(
    (orgId: string, hierarchyKey: string | null): boolean => {
      const sectionKey = hierarchyKey ?? NO_HIERARCHY_LABEL;
      const orgHierarchies = expandedHierarchies.get(orgId);
      return orgHierarchies?.has(sectionKey) ?? false;
    },
    [expandedHierarchies]
  );

  /**
   * Handle organisation header click
   */
  const handleOrgClick = useCallback(
    (orgId: string) => {
      toggleOrganisation(orgId);
    },
    [toggleOrganisation]
  );

  /**
   * Handle hierarchy header click
   */
  const handleHierarchyClick = useCallback(
    (orgId: string, hierarchyKey: string | null) => {
      toggleHierarchy(orgId, hierarchyKey);
    },
    [toggleHierarchy]
  );

  /**
   * Handle project row click
   */
  const handleProjectClick = useCallback(
    (projectId: string) => {
      onProjectClick(projectId);
    },
    [onProjectClick]
  );

  /**
   * Handle keyboard interaction for organisation header
   */
  const handleOrgKeyDown = useCallback(
    (event: React.KeyboardEvent, orgId: string) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggleOrganisation(orgId);
      }
    },
    [toggleOrganisation]
  );

  /**
   * Handle keyboard interaction for hierarchy header
   */
  const handleHierarchyKeyDown = useCallback(
    (event: React.KeyboardEvent, orgId: string, hierarchyKey: string | null) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggleHierarchy(orgId, hierarchyKey);
      }
    },
    [toggleHierarchy]
  );

  // Empty state
  if (organisationSections.length === 0) {
    return <div className={styles.emptyMessage}>No products available</div>;
  }

  return (
    <div className={styles.groupedList} data-testid="organisation-grouped-project-list">
      {organisationSections.map((orgSection) => {
        const orgExpanded = isOrgExpanded(orgSection.orgId);

        return (
          <div
            key={orgSection.orgId}
            className={styles.organisationSection}
            data-testid={`org-section-${orgSection.orgId}`}
          >
            {/* Organisation Header */}
            <div
              className={styles.organisationHeader}
              onClick={() => handleOrgClick(orgSection.orgId)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => handleOrgKeyDown(e, orgSection.orgId)}
              aria-expanded={orgExpanded}
              data-testid={`org-header-${orgSection.orgId}`}
            >
              <span
                className={`${styles.chevron} ${orgExpanded ? styles.expanded : ''}`}
                aria-hidden="true"
              >
                {orgExpanded ? '\u25BC' : '\u25B6'}
              </span>
              <span className={styles.organisationName}>{orgSection.name}</span>
              <span className={styles.sectionCount}>({orgSection.projectCount})</span>
            </div>

            {/* Organisation Content (hierarchy sections) */}
            {orgExpanded && (
              <div className={styles.organisationContent}>
                {orgSection.hierarchies.map((hierarchySection) => {
                  const hierarchySectionKey =
                    hierarchySection.hierarchyKey ?? NO_HIERARCHY_LABEL;
                  const hierarchyExpanded = isHierarchyExpanded(
                    orgSection.orgId,
                    hierarchySection.hierarchyKey
                  );

                  return (
                    <div
                      key={hierarchySectionKey}
                      className={styles.hierarchySection}
                      data-testid={`hierarchy-section-${orgSection.orgId}-${hierarchySectionKey}`}
                    >
                      {/* Hierarchy Header */}
                      <div
                        className={styles.hierarchyHeader}
                        onClick={() =>
                          handleHierarchyClick(orgSection.orgId, hierarchySection.hierarchyKey)
                        }
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) =>
                          handleHierarchyKeyDown(e, orgSection.orgId, hierarchySection.hierarchyKey)
                        }
                        aria-expanded={hierarchyExpanded}
                        data-testid={`hierarchy-header-${orgSection.orgId}-${hierarchySectionKey}`}
                      >
                        <span
                          className={`${styles.chevron} ${hierarchyExpanded ? styles.expanded : ''}`}
                          aria-hidden="true"
                        >
                          {hierarchyExpanded ? '\u25BC' : '\u25B6'}
                        </span>
                        <span className={styles.hierarchyName}>{hierarchySection.name}</span>
                        <span className={styles.sectionCount}>
                          ({hierarchySection.projects.length})
                        </span>
                      </div>

                      {/* Hierarchy Content (project rows) */}
                      {hierarchyExpanded && (
                        <div className={styles.hierarchyContent}>
                          {hierarchySection.projects.map((project) => (
                            <div
                              key={project.id}
                              className={`${styles.projectRow} ${
                                selectedProjectId === project.id ? styles.selected : ''
                              }`}
                              onClick={() => handleProjectClick(project.id)}
                              data-testid={`project-row-${project.id}`}
                              role="option"
                              aria-selected={selectedProjectId === project.id}
                            >
                              <span className={styles.projectName}>{project.name}</span>
                              <span className={styles.projectDate}>
                                {formatDate(project.updatedAt)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default OrganisationGroupedProjectList;
