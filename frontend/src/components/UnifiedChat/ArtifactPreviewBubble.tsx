/**
 * ArtifactPreviewBubble Component
 *
 * Spec 2026-02-28: Hub Bootstrap 1 -- Product Definition (PM) End-to-End
 * Task Group 5, Task 5.2: Full implementation of ArtifactPreviewBubble
 *
 * Spec 2026-03-01: Hub Bootstrap 2 -- Roadmap (PM) End-to-End
 * Task Group 5, Task 5.3: Added optional headerLabel prop for generalization
 *
 * Renders a bordered container with a configurable header label (defaults to
 * "Generated MISSION.MD") and subtle green background tint. Displays markdown
 * content as rendered HTML using a lightweight line-by-line approach. Shows
 * Confirm/Reject action buttons below the preview.
 *
 * Markdown rendering rules (kept under 50 lines):
 * - Lines starting with `# ` -> <h1>
 * - Lines starting with `## ` -> <h2>
 * - Lines starting with `### ` -> <h3>
 * - Lines starting with `- ` or `* ` -> <li> items inside <ul>
 * - Lines starting with `**` -> bold text
 * - Lines starting with `> ` -> <blockquote>
 * - All other non-empty lines -> <p> elements
 */

import React from 'react';
import styles from './ArtifactPreviewBubble.module.css';

// ============================================================================
// Props Interface
// ============================================================================

export interface ArtifactPreviewBubbleProps {
  /** The markdown content to preview */
  markdownContent: string;
  /** Callback when user confirms the artifact */
  onConfirm: () => void;
  /** Callback when user rejects the artifact */
  onReject: () => void;
  /** Whether a confirmation save is in progress */
  isConfirming: boolean;
  /** Whether the component is disabled (e.g., in a sealed segment) */
  disabled: boolean;
  /** Optional header label (defaults to 'Generated MISSION.MD' for backward compat) */
  headerLabel?: string;
  /** Optional confirm button label (defaults to 'Confirm') */
  confirmLabel?: string;
}

// ============================================================================
// Lightweight Markdown Renderer
// ============================================================================

/**
 * Converts a markdown string to an array of React elements using a
 * lightweight line-by-line approach. No heavy markdown library.
 */
function renderMarkdownLines(markdown: string): React.ReactNode[] {
  const lines = markdown.split('\n');
  const elements: React.ReactNode[] = [];
  let listItems: React.ReactNode[] = [];
  let inList = false;

  const flushList = () => {
    if (inList && listItems.length > 0) {
      elements.push(<ul key={`ul-${elements.length}`}>{listItems}</ul>);
      listItems = [];
      inList = false;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimEnd();

    // Skip empty lines (flush any pending list)
    if (trimmed === '') {
      flushList();
      continue;
    }

    // Headings
    if (trimmed.startsWith('### ')) {
      flushList();
      elements.push(<h3 key={`h3-${i}`}>{trimmed.slice(4)}</h3>);
    } else if (trimmed.startsWith('## ')) {
      flushList();
      elements.push(<h2 key={`h2-${i}`}>{trimmed.slice(3)}</h2>);
    } else if (trimmed.startsWith('# ')) {
      flushList();
      elements.push(<h1 key={`h1-${i}`}>{trimmed.slice(2)}</h1>);
    }
    // List items
    else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      inList = true;
      listItems.push(<li key={`li-${i}`}>{trimmed.slice(2)}</li>);
    }
    // Blockquotes
    else if (trimmed.startsWith('> ')) {
      flushList();
      elements.push(<blockquote key={`bq-${i}`}>{trimmed.slice(2)}</blockquote>);
    }
    // Bold lines (starting with **)
    else if (trimmed.startsWith('**')) {
      flushList();
      const boldText = trimmed.replace(/^\*\*/, '').replace(/\*\*$/, '');
      elements.push(<p key={`bold-${i}`}><strong>{boldText}</strong></p>);
    }
    // Regular paragraphs
    else {
      flushList();
      elements.push(<p key={`p-${i}`}>{trimmed}</p>);
    }
  }

  // Flush any remaining list items
  flushList();

  return elements;
}

// ============================================================================
// Component
// ============================================================================

export function ArtifactPreviewBubble({
  markdownContent,
  onConfirm,
  onReject,
  isConfirming,
  disabled,
  headerLabel = 'Generated MISSION.MD',
  confirmLabel = 'Confirm',
}: ArtifactPreviewBubbleProps) {
  const buttonsDisabled = disabled || isConfirming;

  return (
    <div className={styles.container} data-testid="artifact-preview-bubble">
      {/* Header label */}
      <div className={styles.header}>{headerLabel}</div>

      {/* Rendered markdown content */}
      <div className={styles.content}>
        {renderMarkdownLines(markdownContent)}
      </div>

      {/* Action buttons */}
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
          {isConfirming ? 'Saving...' : confirmLabel}
        </button>
      </div>
    </div>
  );
}
