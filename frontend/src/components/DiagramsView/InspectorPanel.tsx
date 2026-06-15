/**
 * InspectorPanel Component (Repurposed as Decorations Panel)
 * Task Group 3: Left Panel Reorganisation
 * Task Group 4: Expand Decoration Palette UI
 *
 * Contains Decorations tools:
 * - "Shapes" section with all shape buttons (BOX, OVAL, DIAMOND, etc.)
 * - "Lines & Arrows" section with line buttons (LINE, ARROW_SINGLE, ARROW_DOUBLE)
 * - "Decoration Text" section for editing selected decoration's text
 */

import React, { useCallback, useMemo } from 'react';
import { Decoration, DecorationType, ShapeDecoration, SHAPE_DECORATION_TYPES, ShapeDecorationType } from '../../types/model';
import { DECORATION_DEFAULTS } from '../../config/defaults';
import styles from './InspectorPanel.module.css';

// Decoration add mode type - now supports all decoration types
export type DecorationAddMode = null | DecorationType;

// Props interface for InspectorPanel (now serving as Decorations panel)
export interface InspectorPanelProps {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  // Selection state for decoration text editor
  selectedDecorationIds: Set<string>;
  decorations: Decoration[];
  // Decoration add mode state
  addMode: DecorationAddMode;
  onAddModeChange: (mode: DecorationAddMode) => void;
  // Callback for updating decoration text
  onUpdateDecorationText: (decorationId: string, text: string) => void;
  // Callback for updating decoration properties (e.g., opacity)
  onUpdateDecoration?: (decorationId: string, updates: Partial<ShapeDecoration>) => void;
}

// Shape button configuration
interface ShapeButtonConfig {
  type: DecorationType;
  label: string;
  title: string;
  icon: React.ReactNode;
}

// SVG icon components for each shape type
const ShapeIcons: Record<DecorationType, React.ReactNode> = {
  // Shapes
  TEXT: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2" y="3" width="12" height="10" rx="1" strokeDasharray="2 2" opacity="0.4" />
      <text x="8" y="10.5" textAnchor="middle" fontSize="8" fontWeight="bold" fill="currentColor" stroke="none">T</text>
    </svg>
  ),
  BOX: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2" y="3" width="12" height="10" rx="1" />
    </svg>
  ),
  OVAL: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <ellipse cx="8" cy="8" rx="6" ry="4" />
    </svg>
  ),
  DIAMOND: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M8 2 L14 8 L8 14 L2 8 Z" />
    </svg>
  ),
  PARALLELOGRAM: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M4 3 L14 3 L12 13 L2 13 Z" />
    </svg>
  ),
  CIRCLE: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="8" cy="8" r="5" />
    </svg>
  ),
  CYLINDER: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <ellipse cx="8" cy="4" rx="5" ry="2" />
      <path d="M3 4 L3 12 Q3 14 8 14 Q13 14 13 12 L13 4" />
    </svg>
  ),
  TRAPEZOID: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M4 3 L12 3 L14 13 L2 13 Z" />
    </svg>
  ),
  HEXAGON: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M4 3 L12 3 L15 8 L12 13 L4 13 L1 8 Z" />
    </svg>
  ),
  NOTE: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2 5 L5 2 L14 2 L14 14 L2 14 Z M2 5 L5 5 L5 2" />
    </svg>
  ),
  // Lines & Arrows
  LINE: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <line x1="2" y1="14" x2="14" y2="2" />
    </svg>
  ),
  ARROW_SINGLE: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <line x1="2" y1="14" x2="14" y2="2" />
      <polyline points="9,2 14,2 14,7" />
    </svg>
  ),
  ARROW_DOUBLE: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <line x1="3" y1="13" x2="13" y2="3" />
      <polyline points="8,3 13,3 13,8" />
      <polyline points="8,13 3,13 3,8" />
    </svg>
  ),
};

// Button configurations for shapes
const shapeButtons: ShapeButtonConfig[] = [
  { type: 'TEXT', label: 'Text', title: 'Add a text decoration (transparent box)', icon: ShapeIcons.TEXT },
  { type: 'BOX', label: 'Box', title: 'Add a box decoration', icon: ShapeIcons.BOX },
  { type: 'OVAL', label: 'Oval', title: 'Add an oval/ellipse decoration', icon: ShapeIcons.OVAL },
  { type: 'DIAMOND', label: 'Diamond', title: 'Add a diamond (decision) decoration', icon: ShapeIcons.DIAMOND },
  { type: 'PARALLELOGRAM', label: 'Parallelogram', title: 'Add a parallelogram decoration', icon: ShapeIcons.PARALLELOGRAM },
  { type: 'CIRCLE', label: 'Circle', title: 'Add a circle decoration', icon: ShapeIcons.CIRCLE },
  { type: 'CYLINDER', label: 'Cylinder', title: 'Add a cylinder (database) decoration', icon: ShapeIcons.CYLINDER },
  { type: 'TRAPEZOID', label: 'Trapezoid', title: 'Add a trapezoid decoration', icon: ShapeIcons.TRAPEZOID },
  { type: 'HEXAGON', label: 'Hexagon', title: 'Add a hexagon decoration', icon: ShapeIcons.HEXAGON },
  { type: 'NOTE', label: 'Note', title: 'Add a note decoration', icon: ShapeIcons.NOTE },
];

// Button configurations for lines
const lineButtons: ShapeButtonConfig[] = [
  { type: 'LINE', label: 'Line', title: 'Add a line (no arrows)', icon: ShapeIcons.LINE },
  { type: 'ARROW_SINGLE', label: 'Arrow', title: 'Add a single-headed arrow', icon: ShapeIcons.ARROW_SINGLE },
  { type: 'ARROW_DOUBLE', label: 'Double Arrow', title: 'Add a double-headed arrow', icon: ShapeIcons.ARROW_DOUBLE },
];

/**
 * InspectorPanel - Left panel for diagram decorations
 * Task Group 4: Extended palette with all decoration types
 *
 * Layout:
 * - Shapes section with 8 shape buttons in grid
 * - Lines & Arrows section with 3 line buttons
 * - Decoration Text section (visible when single decoration selected)
 */
export function InspectorPanel({
  isCollapsed,
  onToggleCollapse,
  selectedDecorationIds,
  decorations,
  addMode,
  onAddModeChange,
  onUpdateDecorationText,
  onUpdateDecoration,
}: InspectorPanelProps) {
  // Determine if exactly one decoration is selected (for text editor)
  const selectedDecoration = useMemo(() => {
    if (selectedDecorationIds.size !== 1) {
      return null;
    }
    const selectedId = Array.from(selectedDecorationIds)[0];
    return decorations.find(d => d.id === selectedId) || null;
  }, [selectedDecorationIds, decorations]);

  // Handle button click - toggle mode on/off
  const handleButtonClick = useCallback((type: DecorationType) => {
    if (addMode === type) {
      // Toggle off if already active
      onAddModeChange(null);
    } else {
      onAddModeChange(type);
    }
  }, [addMode, onAddModeChange]);

  // Handle text input change
  const handleTextChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      if (selectedDecoration) {
        onUpdateDecorationText(selectedDecoration.id, e.target.value);
      }
    },
    [selectedDecoration, onUpdateDecorationText]
  );

  // Check if the selected decoration is a shape (for opacity controls)
  const selectedShapeDecoration = useMemo(() => {
    if (!selectedDecoration) return null;
    if (SHAPE_DECORATION_TYPES.includes(selectedDecoration.type as ShapeDecorationType)) {
      return selectedDecoration as ShapeDecoration;
    }
    return null;
  }, [selectedDecoration]);

  // Handle opacity change
  const handleOpacityChange = useCallback(
    (field: 'background_opacity' | 'border_opacity', value: number) => {
      if (selectedShapeDecoration && onUpdateDecoration) {
        onUpdateDecoration(selectedShapeDecoration.id, { [field]: value });
      }
    },
    [selectedShapeDecoration, onUpdateDecoration]
  );

  // =========================================
  // Render - Collapsed State
  // =========================================

  if (isCollapsed) {
    return (
      <div className={styles.panelCollapsed}>
        <button
          className={styles.toggleButton}
          onClick={onToggleCollapse}
          title="Expand decorations panel"
        >
          &gt;&gt;
        </button>
      </div>
    );
  }

  // =========================================
  // Render - Expanded State
  // =========================================

  return (
    <div className={styles.panel}>
      {/* Header */}
      <div className={styles.header}>
        <button
          className={styles.toggleButton}
          onClick={onToggleCollapse}
          title="Collapse decorations panel"
        >
          &lt;&lt;
        </button>
        <h3 className={styles.headerTitle}>Decorations</h3>
      </div>

      {/* Content */}
      <div className={styles.sectionsContainer}>
        {/* Shapes Section */}
        <div className={styles.decorationsSection}>
          <div className={styles.sectionHeader}>Shapes</div>
          <div className={styles.shapeButtonsGrid}>
            {shapeButtons.map(btn => (
              <button
                key={btn.type}
                className={`${styles.shapeButton} ${addMode === btn.type ? styles.shapeButtonActive : ''}`}
                onClick={() => handleButtonClick(btn.type)}
                title={btn.title}
                data-testid={`add-${btn.type.toLowerCase()}-button`}
              >
                <span className={styles.shapeButtonIcon}>{btn.icon}</span>
                <span className={styles.shapeButtonLabel}>{btn.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Lines & Arrows Section */}
        <div className={styles.decorationsSection}>
          <div className={styles.sectionHeader}>Lines & Arrows</div>
          <div className={styles.addButtons}>
            {lineButtons.map(btn => (
              <button
                key={btn.type}
                className={`${styles.addButton} ${addMode === btn.type ? styles.addButtonActive : ''}`}
                onClick={() => handleButtonClick(btn.type)}
                title={btn.title}
                data-testid={`add-${btn.type.toLowerCase()}-button`}
              >
                <span className={styles.addButtonIcon}>{btn.icon}</span>
                <span className={styles.addButtonText}>{btn.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Decoration Text Section - only shown when single decoration selected */}
        {selectedDecoration && (
          <div className={styles.decorationsSection}>
            <div className={styles.sectionHeader}>Decoration Text</div>
            <textarea
              className={styles.textEditor}
              value={selectedDecoration.text || ''}
              onChange={handleTextChange}
              placeholder="Enter decoration text..."
              rows={3}
            />
          </div>
        )}

        {/* Opacity Controls - only shown when a single shape decoration is selected */}
        {selectedShapeDecoration && onUpdateDecoration && (
          <div className={styles.decorationsSection}>
            <div className={styles.sectionHeader}>Opacity</div>
            <div className={styles.opacityControls}>
              <label className={styles.opacityLabel}>
                <span>Background</span>
                <div className={styles.opacitySliderRow}>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={selectedShapeDecoration.background_opacity ??
                      (DECORATION_DEFAULTS[selectedShapeDecoration.type as ShapeDecorationType]?.background_opacity ?? 100)}
                    onChange={(e) => handleOpacityChange('background_opacity', parseInt(e.target.value, 10))}
                    className={styles.opacitySlider}
                    data-testid="opacity-background-slider"
                  />
                  <span className={styles.opacityValue}>
                    {selectedShapeDecoration.background_opacity ??
                      (DECORATION_DEFAULTS[selectedShapeDecoration.type as ShapeDecorationType]?.background_opacity ?? 100)}%
                  </span>
                </div>
              </label>
              <label className={styles.opacityLabel}>
                <span>Border</span>
                <div className={styles.opacitySliderRow}>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={selectedShapeDecoration.border_opacity ??
                      (DECORATION_DEFAULTS[selectedShapeDecoration.type as ShapeDecorationType]?.border_opacity ?? 100)}
                    onChange={(e) => handleOpacityChange('border_opacity', parseInt(e.target.value, 10))}
                    className={styles.opacitySlider}
                    data-testid="opacity-border-slider"
                  />
                  <span className={styles.opacityValue}>
                    {selectedShapeDecoration.border_opacity ??
                      (DECORATION_DEFAULTS[selectedShapeDecoration.type as ShapeDecorationType]?.border_opacity ?? 100)}%
                  </span>
                </div>
              </label>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
