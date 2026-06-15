/**
 * FeatureSectionCard Component
 *
 * Spec 2026-01-22: Feature Shaping UI Consumes Planner JSON
 * Task Group 2: Create FeatureSectionCard Component
 *
 * Spec 2026-01-25: Feature LHS Collapse and Provenance Icons
 * Task Group 1: FeatureSectionCard Enhancement
 * - Added optional `icon` prop for rendering icons before title
 * - Added optional `headerRightContent` prop for right-aligned header content
 * Task Group 2: Combined "Initial Description & Context" Section
 * - Added optional `className` prop for custom styling (e.g., topSectionCard)
 * Task Group 4: Section Reordering and Icon Application
 * - Changed title prop type from string to React.ReactNode to support custom headers
 * - Supports dual-icon headers like Open Questions (Bot & SquareUserRound)
 *
 * A reusable card wrapper for feature definition sections.
 * Renders a titled card with content or an empty state placeholder.
 *
 * Features:
 * - Consistent card styling with title header
 * - Empty state support with customizable message
 * - Handles missing/undefined children gracefully
 * - Optional icon displayed before title with flex layout
 * - Optional right-aligned content in header (e.g., buttons)
 * - Optional className for additional styling (e.g., distinct top section styling)
 * - Supports custom React elements as title (e.g., dual-icon headers)
 */

import React from 'react';
import styles from './FeatureSectionCard.module.css';

/**
 * Props interface for FeatureSectionCard
 */
export interface FeatureSectionCardProps {
  /**
   * Section title displayed in the card header.
   * Can be a string or a custom React element for complex headers.
   * When using a custom element (e.g., dual-icon header), the icon prop is ignored.
   */
  title: React.ReactNode;
  /** Content to render inside the card */
  children: React.ReactNode;
  /** Whether to show empty state instead of children */
  isEmpty?: boolean;
  /** Custom message to show in empty state (defaults to "No content available") */
  emptyMessage?: string;
  /**
   * Optional icon to display before the title.
   * Typically a lucide-react icon component with size={16}.
   * Icon will be rendered in a flex container with the title.
   * Only used when title is a string - ignored when title is a custom element.
   */
  icon?: React.ReactNode;
  /**
   * Optional content to render on the right side of the header.
   * Useful for action buttons like "+ Add context".
   * Header will use flex layout with space-between when provided.
   */
  headerRightContent?: React.ReactNode;
  /**
   * Optional additional CSS class name(s) to apply to the card container.
   * Useful for distinct styling like the topSectionCard class.
   */
  className?: string;
}

/**
 * FeatureSectionCard Component
 *
 * Renders a card container with a title header and content area.
 * Shows an empty state placeholder when isEmpty=true.
 * Supports optional icon before title and right-aligned header content.
 * Title can be a string or a custom React element for complex headers.
 */
export function FeatureSectionCard({
  title,
  children,
  isEmpty = false,
  emptyMessage = 'No content available',
  icon,
  headerRightContent,
  className,
}: FeatureSectionCardProps) {
  /**
   * Renders the title element, optionally with an icon.
   * When icon is provided and title is a string, wraps both in a flex container.
   * When title is a custom React element, renders it directly (icon is ignored).
   */
  const renderTitleContent = () => {
    // If title is already a complex React element, render it directly
    // (icon prop is ignored in this case since the element handles its own icons)
    if (typeof title !== 'string') {
      return title;
    }

    // If icon is provided with string title, wrap in flex container
    if (icon) {
      return (
        <div className={styles.sectionHeaderWithIcon}>
          <span className={styles.sectionIcon}>{icon}</span>
          <span>{title}</span>
        </div>
      );
    }

    // Simple string title without icon
    return title;
  };

  /**
   * Renders the complete header.
   * When headerRightContent is provided, wraps in a flex row with space-between.
   */
  const renderHeader = () => {
    const titleContent = renderTitleContent();

    if (headerRightContent) {
      return (
        <div className={styles.sectionHeaderRow}>
          <h3 className={styles.sectionHeader}>{titleContent}</h3>
          <div className={styles.headerRightContent}>{headerRightContent}</div>
        </div>
      );
    }

    return <h3 className={styles.sectionHeader}>{titleContent}</h3>;
  };

  // Combine base card class with optional className
  const cardClassName = className
    ? `${styles.card} ${className}`
    : styles.card;

  return (
    <div className={cardClassName}>
      {renderHeader()}
      {isEmpty ? (
        <div className={styles.emptyState}>{emptyMessage}</div>
      ) : (
        <div className={styles.content}>{children}</div>
      )}
    </div>
  );
}
