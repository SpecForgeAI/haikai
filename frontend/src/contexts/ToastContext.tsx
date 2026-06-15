/**
 * ToastContext
 *
 * Spec 2026-05-02 Multi-Architecture Selector + URL Routing -- Task Group 6
 *
 * Lightweight global toast pub/sub. Renders <Toast /> outside the routes tree
 * so toasts survive route transitions (e.g. the silent redirect performed by
 * <ProjectLayout> when `:architectureId` is missing -- the layout unmounts
 * immediately after `<Navigate replace>`, so a toast owned by local state
 * inside <ProjectLayout> would never become visible).
 *
 * Public surface:
 *   - <ToastProvider>    -- wrap once at the app root, above <BrowserRouter>.
 *   - useToast()         -- returns a stable `showToast(message, type)` callable.
 *
 * Behaviour:
 *   - showToast() replaces any visible toast (single-toast model). This matches
 *     the existing inline Toast usage pattern in CreateOrganisationModal /
 *     DiagramsView (one toast slot, replaced on next event).
 *   - Auto-dismiss is delegated to the Toast component (success/info ~5s,
 *     error ~30s).
 *   - Manual dismiss via the Toast's close button works as usual.
 *
 * Why a context (rather than module-level event bus):
 *   - React-friendly: re-renders are scoped to the provider; consumers get a
 *     stable callback via useCallback.
 *   - Testable: tests can wrap the system-under-test in <ToastProvider> and
 *     assert on the rendered toast text via @testing-library/react.
 *
 * Group 5 (empty-view-on-switch toast) reuses this exact context.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  ReactNode,
} from 'react';
import { Toast, ToastType } from '../components/common/Toast';

interface ToastState {
  visible: boolean;
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  /**
   * Show a toast with the given message and type. Replaces any currently
   * visible toast (single-toast model).
   */
  showToast: (message: string, type: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/**
 * Provider that owns the global toast state and renders the Toast component
 * outside the children subtree (so the toast isn't unmounted when the consumer
 * unmounts -- e.g. on a route redirect).
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState>({
    visible: false,
    message: '',
    type: 'info',
  });

  const showToast = useCallback((message: string, type: ToastType) => {
    setToast({ visible: true, message, type });
  }, []);

  const dismissToast = useCallback(() => {
    setToast(prev => ({ ...prev, visible: false }));
  }, []);

  const value = useMemo<ToastContextValue>(
    () => ({ showToast }),
    [showToast]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <Toast
        message={toast.message}
        type={toast.type}
        visible={toast.visible}
        onDismiss={dismissToast}
        data-testid="global-toast"
      />
    </ToastContext.Provider>
  );
}

/**
 * Hook for consumers to fire toasts. Returns a stable `showToast` callable.
 *
 * Outside the provider this returns a no-op `showToast` so call sites that
 * may run in test contexts without the provider don't crash. (The redirect
 * path in <ProjectLayout> is one such site -- existing routing-skeleton tests
 * mount it without a ToastProvider.)
 */
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (ctx) return ctx;
  return { showToast: () => undefined };
}

export default ToastContext;
