/**
 * App Configuration Context
 *
 * Spec 2026-01-19: Startup Configuration for Feature Toggles
 * Spec 2026-01-19: Bootstrap Endpoint for Feature Toggles
 * Spec 2026-01-20: UI Characteristics Entity - Key Suggestions
 *
 * Provides runtime configuration state to the application.
 * Loads configuration from /api/bootstrap endpoint at startup.
 * Backend is the single source of truth for feature toggles.
 *
 * Feature toggles:
 * - includeDelivery: Enable/disable delivery features (roadmap, backlog, work items)
 * - includeDatabase: Enable/disable database-dependent features
 *
 * UI Characteristics key suggestions:
 * - uiCharacteristicsUiCapabilityKeys: Suggestions for ui_capability type
 * - uiCharacteristicsInteractionComplexityKeys: Suggestions for interaction_complexity type
 * - uiCharacteristicsTechnicalShapeKeys: Suggestions for technical_shape type
 *
 * Note: Backend uses Jackson SNAKE_CASE naming strategy, so JSON keys are snake_case
 * (include_delivery, include_database). This context reads snake_case as primary
 * with camelCase as fallback for backward compatibility.
 */

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

// ============================================================================
// Constants
// ============================================================================

/**
 * API base URL from environment variable.
 * Defaults to empty string (same origin) for Vite proxy in development.
 *
 * Spec 2026-01-19: Bootstrap Endpoint for Feature Toggles
 */
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Application configuration interface.
 *
 * Spec 2026-01-19: Startup Configuration for Feature Toggles
 * Spec 2026-01-20: UI Characteristics Entity - Key Suggestions
 */
export interface AppConfig {
  /** Whether to include delivery features (roadmap, backlog, work items). Default: true */
  includeDelivery: boolean;
  /** Whether to include database connectivity features. Default: true */
  includeDatabase: boolean;

  // ============================================================================
  // UI Characteristics Key Suggestions
  // Spec 2026-01-20: UI Characteristics Entity
  // ============================================================================

  /** Key suggestions for ui_capability type. Default: [] */
  uiCharacteristicsUiCapabilityKeys: string[];
  /** Key suggestions for interaction_complexity type. Default: [] */
  uiCharacteristicsInteractionComplexityKeys: string[];
  /** Key suggestions for technical_shape type. Default: [] */
  uiCharacteristicsTechnicalShapeKeys: string[];
}

/**
 * Context type providing app configuration state.
 */
interface AppConfigContextType {
  /** The current application configuration */
  config: AppConfig;
  /** Whether the configuration is still loading */
  loading: boolean;
}

// ============================================================================
// Default Configuration
// ============================================================================

/**
 * Default configuration values.
 * Used when /api/bootstrap is unavailable, malformed, or has missing properties.
 */
const DEFAULT_CONFIG: AppConfig = {
  includeDelivery: true,
  includeDatabase: true,
  // Spec 2026-01-20: UI Characteristics key suggestions default to empty arrays
  uiCharacteristicsUiCapabilityKeys: [],
  uiCharacteristicsInteractionComplexityKeys: [],
  uiCharacteristicsTechnicalShapeKeys: [],
};

// ============================================================================
// Runtime Config Loader
// ============================================================================

/**
 * Flag to track whether a warning has been logged.
 * Ensures we only log once per application lifecycle.
 */
let hasLoggedWarning = false;

/**
 * Logs a warning message once.
 * Subsequent calls are no-ops.
 */
function logWarningOnce(message: string): void {
  if (!hasLoggedWarning) {
    console.warn(message);
    hasLoggedWarning = true;
  }
}

/**
 * Validates and normalizes a configuration value.
 * Returns the value if it's a valid boolean, otherwise returns undefined.
 */
function validateBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') {
    return value;
  }
  return undefined;
}

/**
 * Parses a pipe-delimited or comma-delimited string into an array of trimmed strings.
 * Returns empty array for empty/undefined/null input.
 *
 * Spec 2026-01-20: UI Characteristics Entity - Key Suggestions
 *
 * @param value - The string to parse (pipe or comma delimited)
 * @returns Array of trimmed, non-empty strings
 */
function parseDelimitedString(value: unknown): string[] {
  if (typeof value !== 'string' || !value.trim()) {
    return [];
  }

  // Determine delimiter: prefer pipe, fall back to comma
  const delimiter = value.includes('|') ? '|' : ',';

  return value
    .split(delimiter)
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

/**
 * Loads runtime configuration from /api/bootstrap endpoint.
 *
 * On fetch error (404, network): logs warning once, returns defaults.
 * On invalid JSON: logs warning once, returns defaults.
 * On missing/invalid properties: uses default for that specific property.
 *
 * Spec 2026-01-19: Bootstrap Endpoint for Feature Toggles
 * Spec 2026-01-20: UI Characteristics Entity - Key Suggestions
 *
 * Note: Reads snake_case keys (include_delivery, include_database) as the
 * canonical form from backend, with camelCase fallback for backward compatibility.
 *
 * @returns Promise resolving to the application configuration
 */
export async function loadRuntimeConfig(): Promise<AppConfig> {
  try {
    const response = await fetch(`${API_BASE}/api/bootstrap`);

    if (!response.ok) {
      logWarningOnce(
        `[AppConfig] Failed to load /api/bootstrap (status: ${response.status}). Using default configuration.`
      );
      return { ...DEFAULT_CONFIG };
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      logWarningOnce(
        '[AppConfig] Invalid JSON in /api/bootstrap response. Using default configuration.'
      );
      return { ...DEFAULT_CONFIG };
    }

    // Validate the parsed data
    if (typeof data !== 'object' || data === null) {
      logWarningOnce(
        '[AppConfig] Invalid format in /api/bootstrap response. Expected an object. Using default configuration.'
      );
      return { ...DEFAULT_CONFIG };
    }

    const configObj = data as Record<string, unknown>;

    // Build config with validated values, falling back to defaults for missing/invalid properties
    // Read snake_case keys as primary (backend uses Jackson SNAKE_CASE), with camelCase fallback
    const includeDeliveryValue = typeof configObj.include_delivery === 'boolean'
      ? configObj.include_delivery
      : (typeof configObj.includeDelivery === 'boolean' ? configObj.includeDelivery : undefined);

    const includeDatabaseValue = typeof configObj.include_database === 'boolean'
      ? configObj.include_database
      : (typeof configObj.includeDatabase === 'boolean' ? configObj.includeDatabase : undefined);

    // Spec 2026-01-20: UI Characteristics key suggestions
    // Read snake_case keys as primary, with camelCase fallback
    const uiCharacteristicsUiCapabilityKeysValue = parseDelimitedString(
      configObj.ui_characteristics_ui_capability_keys ?? configObj.uiCharacteristicsUiCapabilityKeys
    );

    const uiCharacteristicsInteractionComplexityKeysValue = parseDelimitedString(
      configObj.ui_characteristics_interaction_complexity_keys ?? configObj.uiCharacteristicsInteractionComplexityKeys
    );

    const uiCharacteristicsTechnicalShapeKeysValue = parseDelimitedString(
      configObj.ui_characteristics_technical_shape_keys ?? configObj.uiCharacteristicsTechnicalShapeKeys
    );

    const config: AppConfig = {
      includeDelivery: includeDeliveryValue ?? DEFAULT_CONFIG.includeDelivery,
      includeDatabase: includeDatabaseValue ?? DEFAULT_CONFIG.includeDatabase,
      // Spec 2026-01-20: UI Characteristics key suggestions (already arrays, no ?? needed)
      uiCharacteristicsUiCapabilityKeys: uiCharacteristicsUiCapabilityKeysValue,
      uiCharacteristicsInteractionComplexityKeys: uiCharacteristicsInteractionComplexityKeysValue,
      uiCharacteristicsTechnicalShapeKeys: uiCharacteristicsTechnicalShapeKeysValue,
    };

    return config;
  } catch {
    logWarningOnce(
      '[AppConfig] Network error loading /api/bootstrap. Using default configuration.'
    );
    return { ...DEFAULT_CONFIG };
  }
}

// ============================================================================
// Context and Provider
// ============================================================================

const AppConfigContext = createContext<AppConfigContextType | undefined>(undefined);

/**
 * Props for AppConfigProvider component.
 */
interface AppConfigProviderProps {
  children: ReactNode;
}

/**
 * AppConfigProvider component.
 *
 * Wraps the application and provides runtime configuration state.
 * Loads configuration from /api/bootstrap on mount before rendering children.
 *
 * Spec 2026-01-19: Startup Configuration for Feature Toggles
 * Spec 2026-01-19: Bootstrap Endpoint for Feature Toggles
 */
export function AppConfigProvider({ children }: AppConfigProviderProps) {
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState<boolean>(true);

  /**
   * Load configuration on mount.
   */
  useEffect(() => {
    const initialize = async () => {
      setLoading(true);
      try {
        const loadedConfig = await loadRuntimeConfig();
        setConfig(loadedConfig);
      } catch {
        // Should not reach here as loadRuntimeConfig handles all errors,
        // but set defaults as a safety net
        setConfig(DEFAULT_CONFIG);
      } finally {
        setLoading(false);
      }
    };

    initialize();
  }, []);

  // Block render until config is loaded
  if (loading) {
    return null;
  }

  return (
    <AppConfigContext.Provider value={{ config, loading }}>
      {children}
    </AppConfigContext.Provider>
  );
}

// ============================================================================
// Custom Hooks
// ============================================================================

/**
 * Hook to get the full application configuration.
 *
 * @returns The complete AppConfig object
 * @throws Error if used outside AppConfigProvider
 */
export function useAppConfig(): AppConfig {
  const context = useContext(AppConfigContext);
  if (context === undefined) {
    throw new Error('useAppConfig must be used within an AppConfigProvider');
  }
  return context.config;
}

/**
 * Hook to get the includeDelivery configuration value.
 *
 * @returns Whether delivery features are enabled
 * @throws Error if used outside AppConfigProvider
 */
export function useIncludeDelivery(): boolean {
  const context = useContext(AppConfigContext);
  if (context === undefined) {
    throw new Error('useIncludeDelivery must be used within an AppConfigProvider');
  }
  return context.config.includeDelivery;
}

/**
 * Hook to get the includeDatabase configuration value.
 *
 * @returns Whether database features are enabled
 * @throws Error if used outside AppConfigProvider
 */
export function useIncludeDatabase(): boolean {
  const context = useContext(AppConfigContext);
  if (context === undefined) {
    throw new Error('useIncludeDatabase must be used within an AppConfigProvider');
  }
  return context.config.includeDatabase;
}

/**
 * Hook to get the app config loading state.
 *
 * @returns True if the configuration is still loading
 * @throws Error if used outside AppConfigProvider
 */
export function useAppConfigLoading(): boolean {
  const context = useContext(AppConfigContext);
  if (context === undefined) {
    throw new Error('useAppConfigLoading must be used within an AppConfigProvider');
  }
  return context.loading;
}

// Reset warning flag for testing purposes
export function _resetWarningFlag(): void {
  hasLoggedWarning = false;
}
