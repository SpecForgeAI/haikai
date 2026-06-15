/**
 * TestStrategyPreviewBubble Component
 *
 * Spec 2026-03-01: Hub Bootstrap 4 -- SA Tech Stack + TE Test Strategy End-to-End
 * Task Group 5, Task 5.4: Create TestStrategyPreviewBubble component
 *
 * Renders a bordered container with a header label "Generated Test Strategy"
 * and subtitle showing test level and quality gate counts.
 * Parses JSON content into test strategy shape with testLevels, qualityGates,
 * and testingPrinciples.
 *
 * Features:
 * - Readable summary view: expandable/collapsible sections for test levels,
 *   quality gates, and testing principles
 * - "Show JSON" toggle to switch between readable and raw JSON view
 * - Confirm/Reject action buttons (same pattern as ArchitecturePreviewBubble)
 * - Graceful error handling for malformed JSON
 */

import React, { useState, useMemo } from 'react';
import styles from './TestStrategyPreviewBubble.module.css';

// ============================================================================
// Types
// ============================================================================

interface TestLevel {
  name: string;
  scope: string;
  coverageTarget: string;
  tools: string[];
  rationale: string;
}

interface QualityGate {
  name: string;
  criteria: string[];
  enforcement: string;
}

interface TestingPrinciple {
  title: string;
  description: string;
}

interface TestStrategy {
  testLevels: TestLevel[];
  qualityGates: QualityGate[];
  testingPrinciples: TestingPrinciple[];
}

// ============================================================================
// Props Interface
// ============================================================================

export interface TestStrategyPreviewBubbleProps {
  /** The JSON string content to parse and preview */
  content: string;
  /** Callback when user confirms the test strategy */
  onConfirm: () => void;
  /** Callback when user rejects the test strategy */
  onReject: () => void;
  /** Whether a confirmation save is in progress */
  isConfirming?: boolean;
  /** Whether the component is disabled (e.g., in a sealed segment) */
  disabled?: boolean;
}

// ============================================================================
// Section Configuration
// ============================================================================

const SECTION_KEYS: Array<{ key: keyof TestStrategy; label: string }> = [
  { key: 'testLevels', label: 'Test Levels' },
  { key: 'qualityGates', label: 'Quality Gates' },
  { key: 'testingPrinciples', label: 'Testing Principles' },
];

// ============================================================================
// Parse Helper
// ============================================================================

/**
 * Attempts to parse JSON content into TestStrategy.
 * Returns the parsed data or an error string.
 */
function parseTestStrategyContent(content: string): { data: TestStrategy | null; error: string | null } {
  try {
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== 'object') {
      return { data: null, error: 'Invalid test strategy structure: expected a JSON object.' };
    }
    // Normalize: ensure each array field exists and is an array
    const testStrategy: TestStrategy = {
      testLevels: Array.isArray(parsed.testLevels) ? parsed.testLevels : [],
      qualityGates: Array.isArray(parsed.qualityGates) ? parsed.qualityGates : [],
      testingPrinciples: Array.isArray(parsed.testingPrinciples) ? parsed.testingPrinciples : [],
    };
    return { data: testStrategy, error: null };
  } catch {
    return { data: null, error: 'Failed to parse test strategy JSON. The content may be malformed.' };
  }
}

// ============================================================================
// Component
// ============================================================================

export function TestStrategyPreviewBubble({
  content,
  onConfirm,
  onReject,
  isConfirming = false,
  disabled = false,
}: TestStrategyPreviewBubbleProps) {
  const [showJson, setShowJson] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const buttonsDisabled = disabled || isConfirming;

  // Parse the JSON content
  const { data, error } = useMemo(() => parseTestStrategyContent(content), [content]);

  // Count test levels and quality gates
  const testLevelCount = data ? data.testLevels.length : 0;
  const qualityGateCount = data ? data.qualityGates.length : 0;

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

  // Render items for each section type
  const renderSectionContent = (key: keyof TestStrategy) => {
    if (!data) return null;
    const items = data[key];

    if (!Array.isArray(items) || items.length === 0) {
      return <div className={styles.entityItem}>No items</div>;
    }

    if (key === 'testLevels') {
      return (items as TestLevel[]).map((level, idx) => (
        <div key={`level-${idx}`} className={styles.entityItem}>
          <span className={styles.entityName}>{level.name || '(unnamed)'}</span>
          {level.scope && (
            <span className={styles.entityDescription}> -- Scope: {level.scope}</span>
          )}
          {level.coverageTarget && (
            <span className={styles.entityDescription}> | Coverage: {level.coverageTarget}</span>
          )}
          {Array.isArray(level.tools) && level.tools.length > 0 && (
            <span className={styles.entityDescription}> | Tools: {level.tools.join(', ')}</span>
          )}
          {level.rationale && (
            <div className={styles.entityDescription}>Rationale: {level.rationale}</div>
          )}
        </div>
      ));
    }

    if (key === 'qualityGates') {
      return (items as QualityGate[]).map((gate, idx) => (
        <div key={`gate-${idx}`} className={styles.entityItem}>
          <span className={styles.entityName}>{gate.name || '(unnamed)'}</span>
          {gate.enforcement && (
            <span className={styles.entityDescription}> -- {gate.enforcement}</span>
          )}
          {Array.isArray(gate.criteria) && gate.criteria.length > 0 && (
            <ul className={styles.criteriaList}>
              {gate.criteria.map((criterion, cIdx) => (
                <li key={`criterion-${idx}-${cIdx}`}>{criterion}</li>
              ))}
            </ul>
          )}
        </div>
      ));
    }

    if (key === 'testingPrinciples') {
      return (items as TestingPrinciple[]).map((principle, idx) => (
        <div key={`principle-${idx}`} className={styles.entityItem}>
          <span className={styles.entityName}>{principle.title || '(untitled)'}</span>
          {principle.description && (
            <span className={styles.entityDescription}> -- {principle.description}</span>
          )}
        </div>
      ));
    }

    return null;
  };

  return (
    <div className={styles.container} data-testid="test-strategy-preview-bubble">
      {/* Header label with counts */}
      <div className={styles.header}>
        Generated Test Strategy
        {data && (
          <span className={styles.headerCounts} data-testid="test-strategy-counts">
            {testLevelCount} test level{testLevelCount !== 1 ? 's' : ''}, {qualityGateCount} quality gate{qualityGateCount !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Error state */}
      {error && (
        <div className={styles.errorMessage} data-testid="test-strategy-error">
          {error}
        </div>
      )}

      {/* Toggle button (only shown when data is valid) */}
      {data && (
        <button
          type="button"
          className={styles.toggleButton}
          onClick={() => setShowJson(!showJson)}
          data-testid="test-strategy-toggle-json"
        >
          {showJson ? 'Show Summary' : 'Show JSON'}
        </button>
      )}

      {/* Summary view: expandable sections */}
      {data && !showJson && (
        <div data-testid="test-strategy-summary">
          {SECTION_KEYS.map(({ key, label }) => {
            const items = data[key];
            const isExpanded = expandedSections.has(key);
            return (
              <div key={key} data-testid={`test-strategy-section-${key}`}>
                <div
                  className={styles.sectionHeader}
                  onClick={() => toggleSection(key)}
                  data-testid={`test-strategy-section-header-${key}`}
                >
                  <span className={`${styles.sectionChevron} ${isExpanded ? styles.sectionChevronOpen : ''}`}>
                    &#9654;
                  </span>
                  {label}
                  <span className={styles.sectionCount}>({Array.isArray(items) ? items.length : 0})</span>
                </div>
                {isExpanded && (
                  <div className={styles.sectionContent} data-testid={`test-strategy-section-content-${key}`}>
                    {renderSectionContent(key)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Raw JSON view */}
      {data && showJson && (
        <div className={styles.rawJson} data-testid="test-strategy-raw-json">
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
