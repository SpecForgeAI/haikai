// @generated-begin JiraImportModal-scaffold
/**
 * JiraImportModal Component
 *
 * Modal dialog for searching Jira issues and importing them into the
 * current product backlog as WorkItems. Controlled by parent (isOpen/onClose).
 * Fetches issues from the gateway Jira proxy based on user search input.
 *
 * Contract: JiraImportModal.contract.json
 *
 * Features:
 * - Search input with auto-focus on open
 * - Fetches from GET /api/v1/jira/issues with query parameters
 * - Multi-select via checkboxes
 * - Import button fires onImport with selected WorkItem[]
 * - Escape closes modal, Enter triggers search
 * - Overlay click closes modal
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Search } from 'lucide-react';
import type { WorkItem } from '../../../types/workItems';
import { JiraIssueRow } from './JiraIssueRow';
import styles from './JiraImportModal.module.css';

export interface JiraImportModalProps {
  /** Whether the modal is visible */
  isOpen: boolean;
  /** Callback when modal is closed */
  onClose: () => void;
  /** Callback with selected Jira issues mapped to WorkItem format */
  onImport: (items: WorkItem[]) => void;
  /** Current project ID, passed through to imported WorkItems */
  projectId: string;
  /** Optional Jira project key to pre-filter search results */
  jiraProjectKey?: string;
}

// TODO: Move to a shared API module (e.g. frontend/src/api/jiraApi.ts) when wiring up
async function searchJiraIssues(params: {
  jiraProjectKey?: string;
  jql?: string;
  maxResults?: number;
}): Promise<WorkItem[]> {
  const searchParams = new URLSearchParams();
  if (params.jiraProjectKey) searchParams.set('jiraProjectKey', params.jiraProjectKey);
  if (params.jql) searchParams.set('jql', params.jql);
  if (params.maxResults) searchParams.set('maxResults', String(params.maxResults));

  const response = await fetch(`/api/v1/jira/issues?${searchParams.toString()}`);
  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(errorBody || `Search failed (${response.status})`);
  }
  return response.json();
}

export function JiraImportModal({
  isOpen,
  onClose,
  onImport,
  projectId,
  jiraProjectKey,
}: JiraImportModalProps) {
  // Search state
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<WorkItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  // Selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Refs
  const searchInputRef = useRef<HTMLInputElement>(null);

  /** Reset state when modal opens */
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setResults([]);
      setIsLoading(false);
      setError(null);
      setHasSearched(false);
      setSelectedIds(new Set());

      const timeoutId = setTimeout(() => {
        searchInputRef.current?.focus();
      }, 100);
      return () => clearTimeout(timeoutId);
    }
  }, [isOpen]);

  /** Handle Escape key */
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isLoading) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isLoading, onClose]);

  /** Execute search */
  const handleSearch = useCallback(async () => {
    const trimmed = query.trim();
    if (trimmed.length === 0 && !jiraProjectKey) return;

    setIsLoading(true);
    setError(null);
    setHasSearched(true);
    setSelectedIds(new Set());

    try {
      const items = await searchJiraIssues({
        jiraProjectKey,
        jql: trimmed || undefined,
        maxResults: 50,
      });
      setResults(items);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to search Jira issues';
      setError(message);
      setResults([]);
    } finally {
      setIsLoading(false);
    }
  }, [query, jiraProjectKey]);

  /** Handle Enter in search input */
  const handleSearchKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        handleSearch();
      }
    },
    [handleSearch]
  );

  /** Toggle issue selection */
  const handleToggle = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  /** Handle Import button click */
  const handleImport = useCallback(() => {
    const selected = results.filter((item) => selectedIds.has(item.id));
    if (selected.length === 0) return;

    // Ensure projectId is set on each imported item
    const itemsWithProject = selected.map((item) => ({
      ...item,
      projectId,
    }));

    onImport(itemsWithProject);
    onClose();
  }, [results, selectedIds, projectId, onImport, onClose]);

  /** Whether import button should be enabled */
  const canImport = useMemo(
    () => selectedIds.size > 0 && !isLoading,
    [selectedIds.size, isLoading]
  );

  /** Overlay click handler */
  const handleOverlayClick = useCallback(() => {
    if (!isLoading) {
      onClose();
    }
  }, [isLoading, onClose]);

  /** Prevent modal content click from closing */
  const handleModalClick = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
  }, []);

  if (!isOpen) return null;

  return (
    <div
      className={styles.overlay}
      onClick={handleOverlayClick}
      data-testid="jira-import-overlay"
    >
      <div
        className={styles.modal}
        onClick={handleModalClick}
        role="dialog"
        aria-modal="true"
        aria-label="Import from Jira"
      >
        {/* Header */}
        <div className={styles.header}>
          <h2 className={styles.title}>Import from Jira</h2>
          <button
            className={styles.closeButton}
            onClick={onClose}
            disabled={isLoading}
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        {/* Search bar */}
        <div className={styles.searchBar}>
          <div className={styles.searchInputWrapper}>
            <Search size={16} className={styles.searchIcon} />
            <input
              ref={searchInputRef}
              type="text"
              role="searchbox"
              className={styles.searchInput}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Search by JQL or keywords..."
              disabled={isLoading}
              data-testid="jira-search-input"
            />
          </div>
          <button
            className={styles.searchButton}
            onClick={handleSearch}
            disabled={isLoading || (query.trim().length === 0 && !jiraProjectKey)}
            data-testid="jira-search-button"
          >
            Search
          </button>
        </div>

        {/* Results area */}
        <div className={styles.resultsArea} data-testid="jira-results-area">
          {isLoading && (
            <div className={styles.loadingState} data-testid="jira-loading">
              <div className={styles.spinner} />
              <span>Searching Jira...</span>
            </div>
          )}

          {error && !isLoading && (
            <div className={styles.errorState} data-testid="jira-error">
              {error}
            </div>
          )}

          {!isLoading && !error && hasSearched && results.length === 0 && (
            <div className={styles.emptyState} data-testid="jira-empty">
              No issues found. Try a different search.
            </div>
          )}

          {!isLoading && !error && results.length > 0 && (
            <>
              <div className={styles.resultsHeader}>
                <span className={styles.resultsCount}>
                  {results.length} issue{results.length !== 1 ? 's' : ''} found
                </span>
                {selectedIds.size > 0 && (
                  <span className={styles.selectedCount}>
                    {selectedIds.size} selected
                  </span>
                )}
              </div>
              <ul className={styles.resultsList} role="list" data-testid="jira-results-list">
                {results.map((issue) => (
                  <JiraIssueRow
                    key={issue.id}
                    issue={issue}
                    selected={selectedIds.has(issue.id)}
                    onToggle={handleToggle}
                  />
                ))}
              </ul>
            </>
          )}

          {!isLoading && !error && !hasSearched && (
            <div className={styles.emptyState} data-testid="jira-initial">
              Enter a search query to find Jira issues.
            </div>
          )}
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          <button
            className={styles.cancelButton}
            onClick={onClose}
            disabled={isLoading}
            data-testid="jira-cancel-button"
          >
            Cancel
          </button>
          <button
            className={styles.importButton}
            onClick={handleImport}
            disabled={!canImport}
            data-testid="jira-import-button"
          >
            Import{selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}

export default JiraImportModal;
// @generated-end JiraImportModal-scaffold
