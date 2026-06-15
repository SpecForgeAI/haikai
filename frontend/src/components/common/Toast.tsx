/**
 * Toast Notification Component
 *
 * Spec 2026-01-31: Trigger Global Standards Generation
 * Task Group 5: Toast Notification Component
 *
 * Provides a reusable toast notification component with:
 * - Success styling (green #4caf50)
 * - Error styling (red #c62828)
 * - Info styling (blue #1976D2)
 * - Auto-dismiss for success (~5s)
 * - Extended timeout for errors (~30s) with manual dismiss
 * - Fixed position bottom center
 * - Slide-up animation (consistent with TopBar notification)
 */

import React, { useEffect, useCallback } from 'react';
import styles from './Toast.module.css';

/**
 * Toast type determines styling and auto-dismiss behavior.
 */
export type ToastType = 'success' | 'error' | 'info';

/**
 * Props for the Toast component.
 */
export interface ToastProps {
  /** The message to display in the toast */
  message: string;
  /** The type of toast (success, error, or info) - determines styling and timing */
  type: ToastType;
  /** Whether the toast is visible */
  visible: boolean;
  /** Callback when the toast should be dismissed */
  onDismiss: () => void;
  /** Optional custom duration in ms (overrides default based on type) */
  duration?: number;
  /** Optional test ID for testing */
  'data-testid'?: string;
}

/**
 * Default auto-dismiss durations in milliseconds.
 * Success: ~5 seconds
 * Error: ~30 seconds (longer so user can read and act)
 * Info: ~5 seconds (informational, same as success)
 */
const DEFAULT_DURATIONS: Record<ToastType, number> = {
  success: 5000,
  error: 30000,
  info: 5000,
};

/**
 * Toast component displays a notification message at the bottom of the screen.
 *
 * Usage:
 * ```tsx
 * <Toast
 *   message="Organisation created successfully"
 *   type="success"
 *   visible={showToast}
 *   onDismiss={() => setShowToast(false)}
 * />
 * ```
 */
export function Toast({
  message,
  type,
  visible,
  onDismiss,
  duration,
  'data-testid': testId,
}: ToastProps) {
  // Handle auto-dismiss
  useEffect(() => {
    if (!visible) return;

    const dismissTime = duration ?? DEFAULT_DURATIONS[type];
    const timer = setTimeout(() => {
      onDismiss();
    }, dismissTime);

    return () => clearTimeout(timer);
  }, [visible, type, duration, onDismiss]);

  // Handle close button click
  const handleClose = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      onDismiss();
    },
    [onDismiss]
  );

  // Don't render if not visible
  if (!visible) {
    return null;
  }

  // Determine CSS class based on type
  const typeClass = type === 'success' ? styles.success : type === 'info' ? styles.info : styles.error;

  return (
    <div
      className={`${styles.toast} ${typeClass}`}
      role="alert"
      aria-live={type === 'error' ? 'assertive' : 'polite'}
      data-testid={testId || `toast-${type}`}
    >
      <span className={styles.message}>{message}</span>
      <button
        className={styles.closeButton}
        onClick={handleClose}
        aria-label="Dismiss notification"
        data-testid="toast-close-button"
      >
        &times;
      </button>
    </div>
  );
}

export default Toast;
