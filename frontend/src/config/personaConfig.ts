/**
 * Persona Configuration
 *
 * Static frontend persona definitions mirroring the 6 backend persona JSON files
 * under `gateway/src/config/personas/`.
 *
 * Spec 2026-02-28: Unified Chat Panel v1 (Frontend)
 * - Pure data file with no React dependencies
 * - Provides display names, hex colors, and initials for persona avatars
 * - Export lookup helper `getPersonaConfig` with grey fallback for unknown personas
 */

// ============================================================================
// Persona Config Interface
// ============================================================================

/**
 * Frontend persona configuration for UI rendering.
 */
export interface PersonaConfig {
  /** Unique persona identifier matching backend persona ID */
  id: string;
  /** Human-readable display name */
  displayName: string;
  /** Hex color for avatar and UI accents */
  color: string;
  /** Two-character initials for avatar circle */
  initials: string;
}

// ============================================================================
// Static Persona Configs
// ============================================================================

/**
 * Static array of all 6 persona configurations.
 * Mirrors data from `gateway/src/config/personas/*.json`.
 */
export const PERSONA_CONFIGS: PersonaConfig[] = [
  { id: 'assistant', displayName: 'Assistant', color: '#5C6BC0', initials: 'AS' },
  { id: 'product-manager', displayName: 'Product Manager', color: '#C62828', initials: 'PM' },
  { id: 'architect', displayName: 'Architect', color: '#7B1FA2', initials: 'AR' },
  { id: 'ux-designer', displayName: 'UX Designer', color: '#F57C00', initials: 'UX' },
  { id: 'test-engineer', displayName: 'Test Engineer', color: '#2E7D32', initials: 'TE' },
  { id: 'software-developer', displayName: 'Software Developer', color: '#455A64', initials: 'SD' },
];

// ============================================================================
// Lookup Helper
// ============================================================================

/**
 * Returns the PersonaConfig for a given persona ID.
 * If the persona ID is not found, returns a grey fallback with '??' initials.
 *
 * @param personaId - The persona identifier to look up
 * @returns The matching PersonaConfig or a fallback default
 */
export function getPersonaConfig(personaId: string): PersonaConfig {
  const found = PERSONA_CONFIGS.find((p) => p.id === personaId);
  if (found) {
    return found;
  }
  return {
    id: personaId,
    displayName: personaId,
    color: '#9E9E9E',
    initials: '??',
  };
}
