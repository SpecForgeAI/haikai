/**
 * WorkItemSearchResults Component
 *
 * Spec 2026-03-04: What's Next v1-C -- Work Item Picker
 * Task Group 7, Task 7.1: Create WorkItemSearchResults component
 *
 * Renders search results as a vertical list of clickable cards with
 * title, type badge, status badge, parent title, and scope indicator.
 * Includes a Cancel button at the bottom to exit picker mode.
 *
 * Used inline within MessageBubble when a structuredResponse has
 * type === 'work-item-search-results'.
 */

import styles from './WorkItemSearchResults.module.css';

// ============================================================================
// Types
// ============================================================================

export interface WorkItemSearchResult {
  id: string;
  title: string;
  type: 'FEATURE' | 'STORY';
  status: string;
  parentTitle: string | null;
  inScope: boolean;
}

interface WorkItemSearchResultsProps {
  results: WorkItemSearchResult[];
  query: string;
  onSelect: (workItemId: string, title: string) => void;
  onCancel: () => void;
}

// ============================================================================
// Component
// ============================================================================

export function WorkItemSearchResults({ results, query, onSelect, onCancel }: WorkItemSearchResultsProps) {
  return (
    <div data-testid="work-item-search-results">
      <p className={styles.header}>Results for &apos;{query}&apos;:</p>
      <div className={styles.container}>
        {results.map((result) => (
          <button
            key={result.id}
            type="button"
            className={styles.resultCard}
            onClick={() => onSelect(result.id, result.title)}
            data-testid={`work-item-result-${result.id}`}
          >
            <span className={styles.resultTitle}>{result.title}</span>
            <span className={styles.resultMeta}>
              <span className={styles.typeBadge}>{result.type}</span>
              <span className={styles.statusBadge}>{result.status}</span>
              {result.parentTitle && <span>{result.parentTitle}</span>}
            </span>
            {result.inScope && (
              <span className={styles.scopeTag}>In scope</span>
            )}
          </button>
        ))}
        <button
          type="button"
          className={styles.cancelButton}
          onClick={onCancel}
          data-testid="work-item-cancel"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
