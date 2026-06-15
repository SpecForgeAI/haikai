/**
 * TechStackPreviewBubble Component
 *
 * Spec 2026-03-01: Hub Bootstrap 4 -- SA Tech Stack + TE Test Strategy End-to-End
 * Task Group 5, Task 5.2: Create TechStackPreviewBubble component
 *
 * Renders a bordered container with a header label "Generated Tech Stack"
 * and subtitle showing category and technology counts.
 * Parses JSON content into tech stack shape with categories (containing technologies),
 * designDecisions, and constraints.
 *
 * Features:
 * - Readable summary view: expandable/collapsible sections for categories,
 *   design decisions, and constraints
 * - "Show JSON" toggle to switch between readable and raw JSON view
 * - Confirm/Reject action buttons (same pattern as ArchitecturePreviewBubble)
 * - Graceful error handling for malformed JSON
 */

import React, { useState, useMemo } from 'react';
import styles from './TechStackPreviewBubble.module.css';

// ============================================================================
// Types
// ============================================================================

interface Technology {
  name: string;
  version: string;
  purpose: string;
  rationale: string;
}

interface TechStackCategory {
  name: string;
  technologies: Technology[];
}

interface DesignDecision {
  title: string;
  description: string;
  rationale: string;
}

interface Constraint {
  name: string;
  description: string;
  type: string;
}

interface TechStack {
  categories: TechStackCategory[];
  designDecisions: DesignDecision[];
  constraints: Constraint[];
}

// ============================================================================
// Props Interface
// ============================================================================

export interface TechStackPreviewBubbleProps {
  /** The JSON string content to parse and preview */
  content: string;
  /** Callback when user confirms the tech stack */
  onConfirm: () => void;
  /** Callback when user rejects the tech stack */
  onReject: () => void;
  /** Whether a confirmation save is in progress */
  isConfirming?: boolean;
  /** Whether the component is disabled (e.g., in a sealed segment) */
  disabled?: boolean;
}

// ============================================================================
// Parse Helper
// ============================================================================

/**
 * Attempts to parse JSON content into TechStack.
 * Returns the parsed data or an error string.
 */
function parseTechStackContent(content: string): { data: TechStack | null; error: string | null } {
  try {
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== 'object') {
      return { data: null, error: 'Invalid tech stack structure: expected a JSON object.' };
    }
    // Normalize: ensure each array field exists and is an array
    const techStack: TechStack = {
      categories: Array.isArray(parsed.categories) ? parsed.categories : [],
      designDecisions: Array.isArray(parsed.designDecisions) ? parsed.designDecisions : [],
      constraints: Array.isArray(parsed.constraints) ? parsed.constraints : [],
    };
    return { data: techStack, error: null };
  } catch {
    return { data: null, error: 'Failed to parse tech stack JSON. The content may be malformed.' };
  }
}

// ============================================================================
// Component
// ============================================================================

export function TechStackPreviewBubble({
  content,
  onConfirm,
  onReject,
  isConfirming = false,
  disabled = false,
}: TechStackPreviewBubbleProps) {
  const [showJson, setShowJson] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const buttonsDisabled = disabled || isConfirming;

  // Parse the JSON content
  const { data, error } = useMemo(() => parseTechStackContent(content), [content]);

  // Count categories and total technologies
  const categoryCount = data ? data.categories.length : 0;
  const technologyCount = data
    ? data.categories.reduce((sum, cat) => sum + (Array.isArray(cat.technologies) ? cat.technologies.length : 0), 0)
    : 0;

  // Toggle section expansion
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
    <div className={styles.container} data-testid="tech-stack-preview-bubble">
      {/* Header label with counts */}
      <div className={styles.header}>
        Generated Tech Stack
        {data && (
          <span className={styles.headerCounts} data-testid="tech-stack-counts">
            {categoryCount} categor{categoryCount !== 1 ? 'ies' : 'y'}, {technologyCount} technolog{technologyCount !== 1 ? 'ies' : 'y'}
          </span>
        )}
      </div>

      {/* Error state */}
      {error && (
        <div className={styles.errorMessage} data-testid="tech-stack-error">
          {error}
        </div>
      )}

      {/* Toggle button (only shown when data is valid) */}
      {data && (
        <button
          type="button"
          className={styles.toggleButton}
          onClick={() => setShowJson(!showJson)}
          data-testid="tech-stack-toggle-json"
        >
          {showJson ? 'Show Summary' : 'Show JSON'}
        </button>
      )}

      {/* Summary view: expandable sections */}
      {data && !showJson && (
        <div data-testid="tech-stack-summary">
          {/* Category sections */}
          {data.categories.map((category, catIdx) => {
            const sectionKey = `category-${catIdx}`;
            const isExpanded = expandedSections.has(sectionKey);
            return (
              <div key={sectionKey} data-testid={`tech-stack-section-${sectionKey}`}>
                <div
                  className={styles.sectionHeader}
                  onClick={() => toggleSection(sectionKey)}
                  data-testid={`tech-stack-section-header-${sectionKey}`}
                >
                  <span className={`${styles.sectionChevron} ${isExpanded ? styles.sectionChevronOpen : ''}`}>
                    &#9654;
                  </span>
                  {category.name}
                  <span className={styles.sectionCount}>({Array.isArray(category.technologies) ? category.technologies.length : 0})</span>
                </div>
                {isExpanded && (
                  <div className={styles.sectionContent} data-testid={`tech-stack-section-content-${sectionKey}`}>
                    {(!Array.isArray(category.technologies) || category.technologies.length === 0) ? (
                      <div className={styles.entityItem}>No technologies</div>
                    ) : (
                      category.technologies.map((tech, techIdx) => (
                        <div key={`tech-${catIdx}-${techIdx}`} className={styles.entityItem}>
                          <span className={styles.entityName}>{tech.name || '(unnamed)'}</span>
                          {tech.version && (
                            <span className={styles.entityDescription}> v{tech.version}</span>
                          )}
                          {tech.purpose && (
                            <span className={styles.entityDescription}> -- {tech.purpose}</span>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {/* Design Decisions section */}
          {data.designDecisions.length > 0 && (() => {
            const sectionKey = 'designDecisions';
            const isExpanded = expandedSections.has(sectionKey);
            return (
              <div key={sectionKey} data-testid={`tech-stack-section-${sectionKey}`}>
                <div
                  className={styles.sectionHeader}
                  onClick={() => toggleSection(sectionKey)}
                  data-testid={`tech-stack-section-header-${sectionKey}`}
                >
                  <span className={`${styles.sectionChevron} ${isExpanded ? styles.sectionChevronOpen : ''}`}>
                    &#9654;
                  </span>
                  Design Decisions
                  <span className={styles.sectionCount}>({data.designDecisions.length})</span>
                </div>
                {isExpanded && (
                  <div className={styles.sectionContent} data-testid={`tech-stack-section-content-${sectionKey}`}>
                    {data.designDecisions.map((decision, idx) => (
                      <div key={`decision-${idx}`} className={styles.entityItem}>
                        <span className={styles.entityName}>{decision.title || '(untitled)'}</span>
                        {decision.description && (
                          <span className={styles.entityDescription}> -- {decision.description}</span>
                        )}
                        {decision.rationale && (
                          <div className={styles.entityDescription}>Rationale: {decision.rationale}</div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

          {/* Constraints section */}
          {data.constraints.length > 0 && (() => {
            const sectionKey = 'constraints';
            const isExpanded = expandedSections.has(sectionKey);
            return (
              <div key={sectionKey} data-testid={`tech-stack-section-${sectionKey}`}>
                <div
                  className={styles.sectionHeader}
                  onClick={() => toggleSection(sectionKey)}
                  data-testid={`tech-stack-section-header-${sectionKey}`}
                >
                  <span className={`${styles.sectionChevron} ${isExpanded ? styles.sectionChevronOpen : ''}`}>
                    &#9654;
                  </span>
                  Constraints
                  <span className={styles.sectionCount}>({data.constraints.length})</span>
                </div>
                {isExpanded && (
                  <div className={styles.sectionContent} data-testid={`tech-stack-section-content-${sectionKey}`}>
                    {data.constraints.map((constraint, idx) => (
                      <div key={`constraint-${idx}`} className={styles.entityItem}>
                        <span className={styles.entityName}>{constraint.name || '(unnamed)'}</span>
                        {constraint.type && (
                          <span className={styles.entityDescription}> [{constraint.type}]</span>
                        )}
                        {constraint.description && (
                          <span className={styles.entityDescription}> -- {constraint.description}</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {/* Raw JSON view */}
      {data && showJson && (
        <div className={styles.rawJson} data-testid="tech-stack-raw-json">
          {JSON.stringify(data, null, 2)}
        </div>
      )}

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
          {isConfirming ? 'Saving...' : 'Confirm'}
        </button>
      </div>
    </div>
  );
}
