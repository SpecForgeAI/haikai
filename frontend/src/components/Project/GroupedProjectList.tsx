/**
 * GroupedProjectList Component
 *
 * Spec 2026-01-10: Project Hierarchy Grouping
 *
 * Reusable component for rendering projects grouped by hierarchy with collapsible sections.
 * Features:
 * - Groups projects by projectHierarchy value
 * - "(No hierarchy)" section for null hierarchy values, displayed first
 * - Alphabetical ordering: sections by name, projects within sections by name
 * - Collapsible sections with expand/collapse chevron icons
 * - All sections default to expanded state
 * - Preserves selection behavior (highlight selected row)
 */

import React, { useState, useMemo, useCallback } from 'react';
import { ProjectDto } from '../../api/projectsApi';
import styles from './GroupedProjectList.module.css';

/**
 * Display name for projects without a hierarchy
 */
const NO_HIERARCHY_LABEL = '(No hierarchy)';

/**
 * Props for GroupedProjectList component
 */
export interface GroupedProjectListProps {
  /** List of projects to display */
  projects: ProjectDto[];
  /** Currently selected project ID, or null if none selected */
  selectedProjectId: string | null;
  /** Callback when a project row is clicked */
  onProjectClick: (projectId: string) => void;
  /** Optional function to format dates for display */
  formatDate?: (dateString?: string) => string;
}

/**
 * Internal type representing a grouped section
 */
interface GroupedSection {
  /** Display name for the section header */
  name: string;
  /** Raw hierarchy key (null for no hierarchy) */
  hierarchyKey: string | null;
  /** Projects in this section, sorted alphabetically by name */
  projects: ProjectDto[];
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
 * GroupedProjectList Component
 *
 * Renders projects in collapsible hierarchy sections.
 */
export function GroupedProjectList({
  projects,
  selectedProjectId,
  onProjectClick,
  formatDate = defaultFormatDate,
}: GroupedProjectListProps) {
  // State for tracking which sections are expanded
  // Initialize with all sections expanded (computed from projects)
  const [expandedSections, setExpandedSections] = useState<Set<string>>(() => {
    const allKeys = new Set<string>();
    projects.forEach((p) => {
      allKeys.add(p.projectHierarchy ?? NO_HIERARCHY_LABEL);
    });
    return allKeys;
  });

  /**
   * Group and sort projects by hierarchy
   */
  const groupedSections = useMemo((): GroupedSection[] => {
    // Group projects by hierarchy
    const groups = new Map<string | null, ProjectDto[]>();

    projects.forEach((project) => {
      const key = project.projectHierarchy;
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(project);
    });

    // Sort projects within each group alphabetically by name (case-insensitive)
    groups.forEach((projectList) => {
      projectList.sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
      );
    });

    // Convert to sections array
    const sections: GroupedSection[] = [];

    // Add "(No hierarchy)" section first if it exists
    if (groups.has(null)) {
      sections.push({
        name: NO_HIERARCHY_LABEL,
        hierarchyKey: null,
        projects: groups.get(null)!,
      });
    }

    // Add other sections alphabetically
    const otherKeys = Array.from(groups.keys())
      .filter((key) => key !== null)
      .sort((a, b) =>
        (a as string).localeCompare(b as string, undefined, { sensitivity: 'base' })
      );

    otherKeys.forEach((key) => {
      sections.push({
        name: key as string,
        hierarchyKey: key,
        projects: groups.get(key)!,
      });
    });

    return sections;
  }, [projects]);

  // Update expanded sections when projects change (ensure all sections are expanded)
  React.useEffect(() => {
    setExpandedSections((prev) => {
      const newSet = new Set(prev);
      groupedSections.forEach((section) => {
        const sectionKey = section.hierarchyKey ?? NO_HIERARCHY_LABEL;
        // Add any new sections to expanded set
        if (!newSet.has(sectionKey)) {
          newSet.add(sectionKey);
        }
      });
      return newSet;
    });
  }, [groupedSections]);

  /**
   * Toggle section expanded/collapsed state
   */
  const toggleSection = useCallback((sectionKey: string) => {
    setExpandedSections((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(sectionKey)) {
        newSet.delete(sectionKey);
      } else {
        newSet.add(sectionKey);
      }
      return newSet;
    });
  }, []);

  /**
   * Check if a section is expanded
   */
  const isSectionExpanded = useCallback(
    (hierarchyKey: string | null): boolean => {
      const sectionKey = hierarchyKey ?? NO_HIERARCHY_LABEL;
      return expandedSections.has(sectionKey);
    },
    [expandedSections]
  );

  /**
   * Handle section header click
   */
  const handleSectionClick = useCallback(
    (hierarchyKey: string | null) => {
      const sectionKey = hierarchyKey ?? NO_HIERARCHY_LABEL;
      toggleSection(sectionKey);
    },
    [toggleSection]
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

  // Empty state
  if (projects.length === 0) {
    return (
      <div className={styles.emptyMessage}>No products available</div>
    );
  }

  return (
    <div className={styles.groupedList} data-testid="grouped-project-list">
      {groupedSections.map((section) => {
        const sectionKey = section.hierarchyKey ?? NO_HIERARCHY_LABEL;
        const isExpanded = isSectionExpanded(section.hierarchyKey);

        return (
          <div
            key={sectionKey}
            className={styles.section}
            data-testid={`section-${sectionKey}`}
          >
            {/* Section Header */}
            <div
              className={styles.sectionHeader}
              onClick={() => handleSectionClick(section.hierarchyKey)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleSectionClick(section.hierarchyKey);
                }
              }}
              aria-expanded={isExpanded}
              data-testid={`section-header-${sectionKey}`}
            >
              <span
                className={`${styles.chevron} ${isExpanded ? styles.expanded : ''}`}
                aria-hidden="true"
              >
                {isExpanded ? '\u25BC' : '\u25B6'}
              </span>
              <span className={styles.sectionName}>{section.name}</span>
              <span className={styles.sectionCount}>({section.projects.length})</span>
            </div>

            {/* Section Content (projects list) */}
            {isExpanded && (
              <div className={styles.sectionContent}>
                {section.projects.map((project) => (
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
  );
}

export default GroupedProjectList;
