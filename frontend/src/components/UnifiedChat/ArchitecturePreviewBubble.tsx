/**
 * ArchitecturePreviewBubble Component
 *
 * Spec 2026-03-01: Hub Bootstrap 3 -- Solution Architect Baseline Architecture End-to-End
 * Task Group 4, Task 4.4: Create ArchitecturePreviewBubble component
 *
 * Spec 2026-03-14: Detailed Data Model Task -- End-to-End Fix
 * Task Group 4, Task 4.2: Extended with logicalDataAttributes and physicalDataAttributes sections
 *
 * Renders a bordered container with a header label "Generated Architecture Baseline"
 * and subtitle showing entity counts (services, interfaces, data entities).
 * Parses JSON content into architecture baseline shape with 9 entity arrays:
 * services, interfaces, interfaceEndpoints, logicalDataEntities, physicalDataEntities,
 * logicalDataAttributes, physicalDataAttributes, businessLogic, dataMovements.
 *
 * Features:
 * - Readable summary view: expandable/collapsible sections for each entity array
 * - "Show JSON" toggle to switch between readable and raw JSON view
 * - Confirm/Reject action buttons (same pattern as RoadmapPreviewBubble)
 * - Graceful error handling for malformed JSON
 */

import React, { useState, useMemo } from 'react';
import styles from './ArchitecturePreviewBubble.module.css';

// ============================================================================
// Types
// ============================================================================

interface ArchitectureEntity {
  name: string;
  description?: string;
  [key: string]: unknown;
}

interface ArchitectureBaseline {
  services: ArchitectureEntity[];
  interfaces: ArchitectureEntity[];
  interfaceEndpoints: ArchitectureEntity[];
  logicalDataEntities: ArchitectureEntity[];
  physicalDataEntities: ArchitectureEntity[];
  logicalDataAttributes: ArchitectureEntity[];
  physicalDataAttributes: ArchitectureEntity[];
  businessLogic: ArchitectureEntity[];
  dataMovements: ArchitectureEntity[];
}

// ============================================================================
// Props Interface
// ============================================================================

export interface ArchitecturePreviewBubbleProps {
  /** The JSON string content to parse and preview */
  content: string;
  /** Callback when user confirms the architecture baseline */
  onConfirm: () => void;
  /** Callback when user rejects the architecture baseline */
  onReject: () => void;
  /** Whether a confirmation save is in progress */
  isConfirming?: boolean;
  /** Whether the component is disabled (e.g., in a sealed segment) */
  disabled?: boolean;
}

// ============================================================================
// Constants
// ============================================================================

const ENTITY_ARRAY_KEYS: Array<{ key: keyof ArchitectureBaseline; label: string }> = [
  { key: 'services', label: 'Services' },
  { key: 'interfaces', label: 'Interfaces' },
  { key: 'interfaceEndpoints', label: 'Interface Endpoints' },
  { key: 'logicalDataEntities', label: 'Logical Data Entities' },
  { key: 'physicalDataEntities', label: 'Physical Data Entities' },
  { key: 'logicalDataAttributes', label: 'Logical Data Attributes' },
  { key: 'physicalDataAttributes', label: 'Physical Data Attributes' },
  { key: 'businessLogic', label: 'Business Logic' },
  { key: 'dataMovements', label: 'Data Movements' },
];

// ============================================================================
// Parse Helper
// ============================================================================

/**
 * Attempts to parse JSON content into ArchitectureBaseline.
 * Returns the parsed data or an error string.
 */
function parseArchitectureContent(content: string): { data: ArchitectureBaseline | null; error: string | null } {
  try {
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== 'object') {
      return { data: null, error: 'Invalid architecture baseline structure: expected a JSON object.' };
    }
    // Normalize: ensure each array field exists and is an array
    const baseline: ArchitectureBaseline = {
      services: Array.isArray(parsed.services) ? parsed.services : [],
      interfaces: Array.isArray(parsed.interfaces) ? parsed.interfaces : [],
      interfaceEndpoints: Array.isArray(parsed.interfaceEndpoints) ? parsed.interfaceEndpoints : [],
      logicalDataEntities: Array.isArray(parsed.logicalDataEntities) ? parsed.logicalDataEntities : [],
      physicalDataEntities: Array.isArray(parsed.physicalDataEntities) ? parsed.physicalDataEntities : [],
      logicalDataAttributes: Array.isArray(parsed.logicalDataAttributes) ? parsed.logicalDataAttributes : [],
      physicalDataAttributes: Array.isArray(parsed.physicalDataAttributes) ? parsed.physicalDataAttributes : [],
      businessLogic: Array.isArray(parsed.businessLogic) ? parsed.businessLogic : [],
      dataMovements: Array.isArray(parsed.dataMovements) ? parsed.dataMovements : [],
    };
    return { data: baseline, error: null };
  } catch {
    return { data: null, error: 'Failed to parse architecture baseline JSON. The content may be malformed.' };
  }
}

// ============================================================================
// Component
// ============================================================================

export function ArchitecturePreviewBubble({
  content,
  onConfirm,
  onReject,
  isConfirming = false,
  disabled = false,
}: ArchitecturePreviewBubbleProps) {
  const [showJson, setShowJson] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const buttonsDisabled = disabled || isConfirming;

  // Parse the JSON content
  const { data, error } = useMemo(() => parseArchitectureContent(content), [content]);

  // Count key entities for header
  const serviceCount = data ? data.services.length : 0;
  const interfaceCount = data ? data.interfaces.length : 0;
  const dataEntityCount = data
    ? data.logicalDataEntities.length + data.physicalDataEntities.length
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
    <div className={styles.container} data-testid="architecture-preview-bubble">
      {/* Header label with counts */}
      <div className={styles.header}>
        Generated Architecture Baseline
        {data && (
          <span className={styles.headerCounts} data-testid="architecture-counts">
            {serviceCount} service{serviceCount !== 1 ? 's' : ''}, {interfaceCount} interface{interfaceCount !== 1 ? 's' : ''}, {dataEntityCount} data entit{dataEntityCount !== 1 ? 'ies' : 'y'}
          </span>
        )}
      </div>

      {/* Error state */}
      {error && (
        <div className={styles.errorMessage} data-testid="architecture-error">
          {error}
        </div>
      )}

      {/* Toggle button (only shown when data is valid) */}
      {data && (
        <button
          type="button"
          className={styles.toggleButton}
          onClick={() => setShowJson(!showJson)}
          data-testid="architecture-toggle-json"
        >
          {showJson ? 'Show Summary' : 'Show JSON'}
        </button>
      )}

      {/* Summary view: expandable sections for each entity array */}
      {data && !showJson && (
        <div data-testid="architecture-summary">
          {ENTITY_ARRAY_KEYS.map(({ key, label }) => {
            const entities = data[key];
            const isExpanded = expandedSections.has(key);
            return (
              <div key={key} data-testid={`architecture-section-${key}`}>
                <div
                  className={styles.sectionHeader}
                  onClick={() => toggleSection(key)}
                  data-testid={`architecture-section-header-${key}`}
                >
                  <span className={`${styles.sectionChevron} ${isExpanded ? styles.sectionChevronOpen : ''}`}>
                    &#9654;
                  </span>
                  {label}
                  <span className={styles.sectionCount}>({entities.length})</span>
                </div>
                {isExpanded && (
                  <div className={styles.sectionContent} data-testid={`architecture-section-content-${key}`}>
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

      {/* Raw JSON view */}
      {data && showJson && (
        <div className={styles.rawJson} data-testid="architecture-raw-json">
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
