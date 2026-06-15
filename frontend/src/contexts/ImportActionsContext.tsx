/**
 * Import Actions Context
 *
 * Spec 2026-01-22: No-Database Mode Empty-State UX
 * Task Group 6: ImportActionsContext Creation
 *
 * Provides import action triggers to the application.
 * Allows components (like empty-state views) to trigger import flows
 * that are implemented in TopBar.
 *
 * Usage:
 * - TopBar wraps its children (or App.tsx wraps content) with ImportActionsProvider
 * - TopBar passes its import handlers (handleImportJsonClick, handleImportXlsxClick)
 * - Views consume via useImportActions() hook
 */

import { createContext, useContext, ReactNode } from 'react';

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Context type providing import action triggers.
 */
export interface ImportActionsContextType {
  /** Trigger the Import JSON flow (opens file picker for .json files) */
  triggerImportJson: () => void;
  /** Trigger the Import XLSX flow (opens file picker for .xlsx files) */
  triggerImportXlsx: () => void;
}

// ============================================================================
// Context
// ============================================================================

const ImportActionsContext = createContext<ImportActionsContextType | undefined>(undefined);

// ============================================================================
// Provider
// ============================================================================

/**
 * Props for ImportActionsProvider component.
 */
interface ImportActionsProviderProps {
  children: ReactNode;
  /** Handler to trigger Import JSON flow */
  triggerImportJson: () => void;
  /** Handler to trigger Import XLSX flow */
  triggerImportXlsx: () => void;
}

/**
 * ImportActionsProvider component.
 *
 * Wraps children and provides import action triggers.
 * Typically used in App.tsx or TopBar to expose import functionality
 * to nested components like empty-state views.
 *
 * @param children - Child components
 * @param triggerImportJson - Handler to trigger Import JSON flow
 * @param triggerImportXlsx - Handler to trigger Import XLSX flow
 */
export function ImportActionsProvider({
  children,
  triggerImportJson,
  triggerImportXlsx,
}: ImportActionsProviderProps) {
  return (
    <ImportActionsContext.Provider value={{ triggerImportJson, triggerImportXlsx }}>
      {children}
    </ImportActionsContext.Provider>
  );
}

// ============================================================================
// Custom Hook
// ============================================================================

/**
 * Hook to get import action triggers from context.
 *
 * @returns Object with triggerImportJson and triggerImportXlsx functions
 * @throws Error if used outside ImportActionsProvider
 */
export function useImportActions(): ImportActionsContextType {
  const context = useContext(ImportActionsContext);
  if (context === undefined) {
    throw new Error('useImportActions must be used within an ImportActionsProvider');
  }
  return context;
}
