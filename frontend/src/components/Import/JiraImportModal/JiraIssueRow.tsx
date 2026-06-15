// @generated-begin JiraIssueRow-scaffold
/**
 * JiraIssueRow Component
 *
 * Displays a single Jira issue in the search results list with
 * checkbox selection, issue key, issue type badge, and summary text.
 *
 * Contract: JiraImportModal.contract.json
 */

import React, { useCallback } from 'react';
import type { WorkItem } from '../../../types/workItems';
import styles from './JiraIssueRow.module.css';

export interface JiraIssueRowProps {
  /** The Jira issue mapped to WorkItem format */
  issue: WorkItem;
  /** Whether this row is currently selected */
  selected: boolean;
  /** Callback when selection checkbox is toggled */
  onToggle: (id: string) => void;
}

export function JiraIssueRow({ issue, selected, onToggle }: JiraIssueRowProps) {
  const handleToggle = useCallback(() => {
    onToggle(issue.id);
  }, [issue.id, onToggle]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === ' ') {
        event.preventDefault();
        onToggle(issue.id);
      }
    },
    [issue.id, onToggle]
  );

  return (
    <li
      className={`${styles.row} ${selected ? styles.rowSelected : ''}`}
      role="listitem"
      tabIndex={0}
      onClick={handleToggle}
      onKeyDown={handleKeyDown}
      data-testid={`jira-issue-row-${issue.externalKey ?? issue.id}`}
    >
      <input
        type="checkbox"
        className={styles.checkbox}
        checked={selected}
        onChange={handleToggle}
        tabIndex={-1}
        aria-label={`Select ${issue.externalKey ?? issue.title}`}
      />
      <span className={styles.issueKey}>{issue.externalKey}</span>
      <span className={styles.issueType}>{issue.type}</span>
      <span className={styles.summary} title={issue.title}>
        {issue.title}
      </span>
    </li>
  );
}

export default JiraIssueRow;
// @generated-end JiraIssueRow-scaffold
