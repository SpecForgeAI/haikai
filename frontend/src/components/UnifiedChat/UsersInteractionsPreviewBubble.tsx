/**
 * UsersInteractionsPreviewBubble Component
 *
 * Renders a bordered container with a header label "Generated Users & Interactions"
 * and subtitle showing entity counts (users, processes, activities, screens).
 * Parses JSON content into users & interactions shape with 4 entity arrays.
 *
 * Features:
 * - Readable summary view: expandable/collapsible sections for each entity array
 * - "Show JSON" toggle to switch between readable and raw JSON view
 * - Confirm/Reject action buttons (same pattern as ArchitecturePreviewBubble)
 * - Graceful error handling for malformed JSON
 */

import { useState, useMemo } from 'react';
import styles from './ArchitecturePreviewBubble.module.css';

// ============================================================================
// Types
// ============================================================================

interface UsersInteractionsEntity {
  name: string;
  description?: string;
  [key: string]: unknown;
}

interface UsersInteractionsData {
  business_users: UsersInteractionsEntity[];
  business_processes: UsersInteractionsEntity[];
  process_activities: UsersInteractionsEntity[];
  ui_screens: UsersInteractionsEntity[];
}

// ============================================================================
// Props Interface
// ============================================================================

export interface UsersInteractionsPreviewBubbleProps {
  content: string;
  onConfirm: () => void;
  onReject: () => void;
  isConfirming?: boolean;
  disabled?: boolean;
}

// ============================================================================
// Constants
// ============================================================================

const ENTITY_ARRAY_KEYS: Array<{ key: keyof UsersInteractionsData; label: string }> = [
  { key: 'business_users', label: 'Business Users' },
  { key: 'business_processes', label: 'Business Processes' },
  { key: 'process_activities', label: 'Process Activities' },
  { key: 'ui_screens', label: 'UI Screens' },
];

// ============================================================================
// Parse Helper
// ============================================================================

function parseContent(content: string): { data: UsersInteractionsData | null; error: string | null } {
  try {
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== 'object') {
      return { data: null, error: 'Invalid users & interactions structure: expected a JSON object.' };
    }
    const data: UsersInteractionsData = {
      business_users: Array.isArray(parsed.business_users) ? parsed.business_users : [],
      business_processes: Array.isArray(parsed.business_processes) ? parsed.business_processes : [],
      process_activities: Array.isArray(parsed.process_activities) ? parsed.process_activities : [],
      ui_screens: Array.isArray(parsed.ui_screens) ? parsed.ui_screens : [],
    };
    return { data, error: null };
  } catch {
    return { data: null, error: 'Failed to parse users & interactions JSON. The content may be malformed.' };
  }
}

// ============================================================================
// Component
// ============================================================================

export function UsersInteractionsPreviewBubble({
  content,
  onConfirm,
  onReject,
  isConfirming = false,
  disabled = false,
}: UsersInteractionsPreviewBubbleProps) {
  const [showJson, setShowJson] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const buttonsDisabled = disabled || isConfirming;

  const { data, error } = useMemo(() => parseContent(content), [content]);

  const userCount = data ? data.business_users.length : 0;
  const processCount = data ? data.business_processes.length : 0;
  const activityCount = data ? data.process_activities.length : 0;
  const screenCount = data ? data.ui_screens.length : 0;

  const toggleSection = (key: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  return (
    <div className={styles.container} data-testid="users-interactions-preview-bubble">
      <div className={styles.header}>
        Generated Users & Interactions
        {data && (
          <span className={styles.headerCounts} data-testid="users-interactions-counts">
            {userCount} user{userCount !== 1 ? 's' : ''}, {processCount} process{processCount !== 1 ? 'es' : ''}, {activityCount} activit{activityCount !== 1 ? 'ies' : 'y'}, {screenCount} screen{screenCount !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {error && (
        <div className={styles.errorMessage} data-testid="users-interactions-error">
          {error}
        </div>
      )}

      {data && (
        <button
          type="button"
          className={styles.toggleButton}
          onClick={() => setShowJson(!showJson)}
          data-testid="users-interactions-toggle-json"
        >
          {showJson ? 'Show Summary' : 'Show JSON'}
        </button>
      )}

      {data && !showJson && (
        <div data-testid="users-interactions-summary">
          {ENTITY_ARRAY_KEYS.map(({ key, label }) => {
            const entities = data[key];
            const isExpanded = expandedSections.has(key);
            return (
              <div key={key} data-testid={`users-interactions-section-${key}`}>
                <div
                  className={styles.sectionHeader}
                  onClick={() => toggleSection(key)}
                  data-testid={`users-interactions-section-header-${key}`}
                >
                  <span className={`${styles.sectionChevron} ${isExpanded ? styles.sectionChevronOpen : ''}`}>
                    &#9654;
                  </span>
                  {label}
                  <span className={styles.sectionCount}>({entities.length})</span>
                </div>
                {isExpanded && (
                  <div className={styles.sectionContent} data-testid={`users-interactions-section-content-${key}`}>
                    {entities.length === 0 ? (
                      <div className={styles.entityItem}>No items</div>
                    ) : (
                      entities.map((entity, idx) => (
                        <div key={`${key}-${idx}`} className={styles.entityItem}>
                          <span className={styles.entityName}>{entity.name || '(unnamed)'}</span>
                          {entity.description && (
                            <span className={styles.entityDescription}>-- {entity.description}</span>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {data && showJson && (
        <div className={styles.rawJson} data-testid="users-interactions-raw-json">
          {JSON.stringify(data, null, 2)}
        </div>
      )}

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.rejectButton}
          onClick={onReject}
          disabled={buttonsDisabled}
        >
          Reject
        </button>
        <button
          type="button"
          className={styles.confirmButton}
          onClick={onConfirm}
          disabled={buttonsDisabled}
        >
          {isConfirming ? 'Saving...' : 'Confirm'}
        </button>
      </div>
    </div>
  );
}
