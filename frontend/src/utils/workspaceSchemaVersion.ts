/**
 * Workspace Schema Version and Migration
 *
 * Defines the current schema version and provides migration framework
 * for persisted workspace state.
 *
 * Spec 2026-01-23: Persist + Rehydrate Implement Workspace
 * Task Group 8: Schema Versioning and Migration
 */

import type { PersistedWorkspaceState } from '../api/implementWorkspaceApi';

// ============================================================================
// Constants
// ============================================================================

/**
 * Current schema version.
 * Increment this when making breaking changes to the workspace state structure.
 */
export const CURRENT_SCHEMA_VERSION = 1;

// ============================================================================
// Types
// ============================================================================

/**
 * Versioned workspace state with explicit schemaVersion field.
 */
export interface VersionedWorkspaceState extends PersistedWorkspaceState {
  schemaVersion: number;
}

/**
 * Migration function type.
 * Takes the previous schema version's state and returns the next version's state.
 */
export type MigrationFn = (state: Record<string, unknown>) => VersionedWorkspaceState;

/**
 * Result of schema validation.
 */
export interface ValidationResult {
  /** Whether the state is valid */
  valid: boolean;
  /** List of validation errors */
  errors: string[];
  /** The migrated/validated state */
  migrated: VersionedWorkspaceState;
}

// ============================================================================
// Migration Registry
// ============================================================================

/**
 * Map of migrations keyed by target version.
 * Each migration upgrades from version N-1 to version N.
 *
 * Example:
 * - migrations[2] upgrades from v1 to v2
 * - migrations[3] upgrades from v2 to v3
 */
const migrations: Record<number, MigrationFn> = {
  // Currently no migrations needed as we're at v1
  // Future migrations would be added here:
  // 2: migrateV1ToV2,
  // 3: migrateV2ToV3,
};

// ============================================================================
// Migration Functions
// ============================================================================

/**
 * Applies migrations sequentially from the source version to the current version.
 *
 * @param state - The workspace state to migrate
 * @param fromVersion - The source schema version
 * @returns The migrated state at CURRENT_SCHEMA_VERSION
 */
export function migrateWorkspace(
  state: Record<string, unknown>,
  fromVersion: number
): VersionedWorkspaceState {
  let currentState = { ...state };
  let version = fromVersion;

  // Apply migrations sequentially
  while (version < CURRENT_SCHEMA_VERSION) {
    const nextVersion = version + 1;
    const migration = migrations[nextVersion];

    if (migration) {
      currentState = migration(currentState) as Record<string, unknown>;
      console.log(`Migrated workspace state from v${version} to v${nextVersion}`);
    } else {
      // No migration defined, just bump the version
      console.warn(`No migration defined for v${version} to v${nextVersion}, applying defaults`);
    }

    version = nextVersion;
  }

  // Ensure the result has the current schema version
  return {
    ...applyDefaults(currentState),
    schemaVersion: CURRENT_SCHEMA_VERSION,
  };
}

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validates and migrates workspace state.
 *
 * @param state - The raw state to validate (could be any version)
 * @returns ValidationResult with valid flag, errors, and migrated state
 */
export function validateAndMigrateWorkspace(
  state: Record<string, unknown> | null | undefined
): ValidationResult {
  const errors: string[] = [];

  // Handle null/undefined
  if (!state) {
    return {
      valid: true,
      errors: [],
      migrated: createEmptyWorkspaceState(),
    };
  }

  // Determine schema version (default to 1 if missing)
  let schemaVersion = 1;
  if (typeof state.schemaVersion === 'number') {
    schemaVersion = state.schemaVersion;
  } else if (state.schemaVersion !== undefined) {
    errors.push(`Invalid schemaVersion type: expected number, got ${typeof state.schemaVersion}`);
  }

  // Handle future versions
  if (schemaVersion > CURRENT_SCHEMA_VERSION) {
    console.warn(
      `Workspace state has future schema version ${schemaVersion} (current is ${CURRENT_SCHEMA_VERSION}). ` +
      'Attempting to load with defaults for unknown fields.'
    );
    errors.push(`Future schema version ${schemaVersion} detected, applying defaults`);
  }

  // Apply migrations and defaults
  const migrated = migrateWorkspace(state, schemaVersion);

  return {
    valid: errors.length === 0,
    errors,
    migrated,
  };
}

// ============================================================================
// Default Value Functions
// ============================================================================

/**
 * Creates an empty workspace state with all default values.
 */
export function createEmptyWorkspaceState(): VersionedWorkspaceState {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    implementationMode: false,
    plannerPayload: null,
    activeIncrementId: null,
    questions: [],
    executionArtifactsByIncrement: {},
    teamChatTranscript: [],
  };
}

/**
 * Applies default values for missing fields in the workspace state.
 * This implements fail-soft loading by providing safe defaults.
 *
 * @param state - The state to apply defaults to
 * @returns The state with defaults applied
 */
export function applyDefaults(state: Record<string, unknown>): VersionedWorkspaceState {
  const defaults = createEmptyWorkspaceState();

  // Extract and validate each field with type checking
  const result: VersionedWorkspaceState = {
    schemaVersion: typeof state.schemaVersion === 'number' ? state.schemaVersion : defaults.schemaVersion,
    implementationMode: typeof state.implementationMode === 'boolean' ? state.implementationMode : defaults.implementationMode,
    plannerPayload: isPlainObject(state.plannerPayload) ? state.plannerPayload as Record<string, unknown> : defaults.plannerPayload,
    activeIncrementId: typeof state.activeIncrementId === 'string' ? state.activeIncrementId : defaults.activeIncrementId,
    questions: Array.isArray(state.questions) ? state.questions : defaults.questions,
    executionArtifactsByIncrement: isPlainObject(state.executionArtifactsByIncrement)
      ? state.executionArtifactsByIncrement as Record<string, unknown>
      : defaults.executionArtifactsByIncrement,
    teamChatTranscript: Array.isArray(state.teamChatTranscript) ? state.teamChatTranscript : defaults.teamChatTranscript,
  };

  // Log warnings for unknown fields (but don't fail)
  const knownFields = new Set([
    'schemaVersion',
    'implementationMode',
    'plannerPayload',
    'activeIncrementId',
    'questions',
    'executionArtifactsByIncrement',
    'teamChatTranscript',
  ]);

  for (const key of Object.keys(state)) {
    if (!knownFields.has(key)) {
      console.warn(`Unknown field "${key}" in workspace state, ignoring`);
    }
  }

  return result;
}

/**
 * Type guard to check if a value is a plain object.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
