/**
 * ResizableSplitPane Component
 *
 * Spec 2026-01-10: Product & Delivery - Resizable LHS Panels
 * Task Group 1: Core resizable split pane component
 *
 * A reusable component that renders two panes with a draggable divider between them.
 * The left pane width is user-adjustable and persisted to localStorage.
 * The right pane flexes to fill remaining space.
 *
 * Features:
 * - Draggable divider for resizing left pane
 * - localStorage persistence of left pane width
 * - Width constraints (min/max)
 * - Keyboard accessibility (arrow keys)
 * - Text selection prevention during drag
 * - Window resize handling
 */

import { useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import styles from './ResizableSplitPane.module.css';

/**
 * Props for ResizableSplitPane component
 */
export interface ResizableSplitPaneProps {
  /** Content for the left pane */
  left: ReactNode;
  /** Content for the right pane */
  right: ReactNode;
  /** localStorage key for persisting left pane width */
  storageKey: string;
  /** Default left pane width in pixels when no stored value exists */
  defaultLeftWidthPx: number;
  /** Minimum allowed left pane width in pixels */
  minLeftWidthPx: number;
  /** Maximum allowed left pane width in pixels */
  maxLeftWidthPx: number;
}

/**
 * Clamp a value between min and max bounds
 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Read width from localStorage, returning null if invalid or absent
 */
function readStoredWidth(storageKey: string): number | null {
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored === null) {
      return null;
    }
    const parsed = parseInt(stored, 10);
    if (isNaN(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    // localStorage may be unavailable (e.g., private browsing)
    return null;
  }
}

/**
 * Write width to localStorage
 */
function writeStoredWidth(storageKey: string, width: number): void {
  try {
    localStorage.setItem(storageKey, String(width));
  } catch {
    // Ignore localStorage errors (quota exceeded, private browsing, etc.)
  }
}

/**
 * ResizableSplitPane Component
 *
 * Renders a flex container with left pane, drag handle, and right pane.
 * Left pane width is controlled in pixels; right pane uses flex: 1.
 */
export function ResizableSplitPane({
  left,
  right,
  storageKey,
  defaultLeftWidthPx,
  minLeftWidthPx,
  maxLeftWidthPx,
}: ResizableSplitPaneProps) {
  // Ref for left pane to get its position during drag
  const leftPaneRef = useRef<HTMLDivElement>(null);

  // Track if currently dragging
  const [isDragging, setIsDragging] = useState(false);

  // Left pane width state - initialized from localStorage or default
  const [leftWidth, setLeftWidth] = useState<number>(() => {
    const stored = readStoredWidth(storageKey);
    if (stored !== null) {
      return clamp(stored, minLeftWidthPx, maxLeftWidthPx);
    }
    return defaultLeftWidthPx;
  });

  /**
   * Handle mouse down on drag handle - start drag mode
   */
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  /**
   * Handle mouse move during drag
   */
  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!leftPaneRef.current) return;

      const leftPaneRect = leftPaneRef.current.getBoundingClientRect();
      const newWidth = e.clientX - leftPaneRect.left;
      const clampedWidth = clamp(newWidth, minLeftWidthPx, maxLeftWidthPx);
      setLeftWidth(clampedWidth);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      // Persist width to localStorage after drag ends
      writeStoredWidth(storageKey, leftWidth);
    };

    // Attach global listeners
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, minLeftWidthPx, maxLeftWidthPx, storageKey, leftWidth]);

  /**
   * Persist width after drag ends (when isDragging changes to false)
   */
  useEffect(() => {
    if (!isDragging) {
      // Only persist if we were previously dragging
      // The initial render should not trigger a write
    }
  }, [isDragging]);

  /**
   * Task Group 2: Keyboard accessibility
   * Handle keyboard events for width adjustment
   */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const step = e.shiftKey ? 50 : 10;
      let newWidth = leftWidth;

      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          newWidth = clamp(leftWidth - step, minLeftWidthPx, maxLeftWidthPx);
          break;
        case 'ArrowRight':
          e.preventDefault();
          newWidth = clamp(leftWidth + step, minLeftWidthPx, maxLeftWidthPx);
          break;
        default:
          return;
      }

      setLeftWidth(newWidth);
      writeStoredWidth(storageKey, newWidth);
    },
    [leftWidth, minLeftWidthPx, maxLeftWidthPx, storageKey]
  );

  /**
   * Task Group 3: Window resize handling
   * Re-clamp width when window resizes
   */
  useEffect(() => {
    const handleWindowResize = () => {
      setLeftWidth((currentWidth) => {
        const clampedWidth = clamp(currentWidth, minLeftWidthPx, maxLeftWidthPx);
        if (clampedWidth !== currentWidth) {
          writeStoredWidth(storageKey, clampedWidth);
        }
        return clampedWidth;
      });
    };

    window.addEventListener('resize', handleWindowResize);
    return () => {
      window.removeEventListener('resize', handleWindowResize);
    };
  }, [minLeftWidthPx, maxLeftWidthPx, storageKey]);

  // Compute container class with dragging state
  const containerClassName = isDragging
    ? `${styles.container} ${styles.dragging} dragging`
    : styles.container;

  return (
    <div
      className={containerClassName}
      data-testid="resizable-split-pane"
    >
      {/* Left Pane */}
      <div
        ref={leftPaneRef}
        className={styles.leftPane}
        style={{ width: `${leftWidth}px` }}
        data-testid="resizable-left-pane"
      >
        {left}
      </div>

      {/* Drag Handle */}
      <div
        className={styles.dragHandle}
        role="separator"
        tabIndex={0}
        aria-valuenow={leftWidth}
        aria-valuemin={minLeftWidthPx}
        aria-valuemax={maxLeftWidthPx}
        aria-orientation="vertical"
        aria-label="Resize panels"
        onMouseDown={handleMouseDown}
        onKeyDown={handleKeyDown}
        data-testid="resizable-drag-handle"
      />

      {/* Right Pane */}
      <div className={styles.rightPane} data-testid="resizable-right-pane">
        {right}
      </div>
    </div>
  );
}
