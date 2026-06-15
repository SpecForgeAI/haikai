/**
 * Task Configuration (Frontend)
 *
 * Static frontend task metadata mirroring the subset of `gateway/src/config/tasks/*.json`
 * fields the frontend needs to make routing/wiring decisions before sending a
 * chatV2 request.
 *
 * Spec 2026-05-01 Multi-Architecture Save-Target Resolution (Spec #5) -- Task Group 7
 * - Mirrors the backend `saveTargetResolution` declaration so the frontend can
 *   decide whether to populate `request.architectureId` on a chatV2 send:
 *     `bound-by-system-prompt` and `derived-from-context` -> include the URL-active
 *     architecture id so the gateway can either inject the `Architecture: <name>`
 *     line on every turn (bound mode) or look up an entity binding (derived mode).
 *     `clarify-at-save` -> omit; the picker modal handles save-time selection.
 *     undefined / unmapped task -> omit (project-level tasks; no architecture binding).
 *
 * Source of truth: the backend JSON files under `gateway/src/config/tasks/`. This
 * frontend mirror exists because `useChatThread` runs before any backend task
 * registry is queried, so the routing decision must be available client-side.
 *
 * If a task's `saveTargetResolution` ever changes in the backend JSON, update
 * the corresponding entry here. The contract is intentionally narrow (subset of
 * task metadata) so the mirror burden stays low.
 */

// ============================================================================
// Save-Target Resolution Mode
// ============================================================================

/**
 * Mirrors the backend `SaveTargetResolutionMode` union in
 * `gateway/src/types/chatV2.ts`.
 */
export type SaveTargetResolutionMode =
  | 'bound-by-system-prompt'
  | 'derived-from-context'
  | 'clarify-at-save';

// ============================================================================
// Task -> SaveTargetResolutionMode Map
// ============================================================================

/**
 * Maps task IDs to their declared `saveTargetResolution` mode.
 *
 * Tasks NOT in this map are treated as having no architecture-scoped binding
 * (the chatV2 request omits `architectureId`). This covers project-level tasks
 * (PM/TE/Assistant) and any other task whose backend JSON does not declare
 * `saveTargetResolution`.
 */
export const TASK_SAVE_TARGET_RESOLUTION: Record<string, SaveTargetResolutionMode> = {
  // bound-by-system-prompt: architectureId resolved at thread open from URL active.
  'architect--define-architecture': 'bound-by-system-prompt',
  'architect--detailed-data-model': 'bound-by-system-prompt',
  'architect--generate-architecture-diagram': 'bound-by-system-prompt',
  // Spec #4 Discovery tasks (already shipped): keep aligned.
  'architect--discovery-framing': 'bound-by-system-prompt',
  'architect--discovery-qa': 'bound-by-system-prompt',

  // derived-from-context: architectureId derived from an entity the LLM identifies.
  'architect--oas-spec': 'derived-from-context',

  // clarify-at-save: picker modal at save time.
  'ux-designer--users-interactions': 'clarify-at-save',
  'ux-designer--ui-domain': 'clarify-at-save',
};

// ============================================================================
// Lookup Helper
// ============================================================================

/**
 * Returns the declared `saveTargetResolution` for a given task id, or undefined
 * if the task has no declaration (project-level / advisory task).
 *
 * @param taskId - The task identifier to look up.
 * @returns The declared mode or undefined.
 */
export function getTaskSaveTargetResolution(
  taskId: string
): SaveTargetResolutionMode | undefined {
  return TASK_SAVE_TARGET_RESOLUTION[taskId];
}

/**
 * Decides whether a chatV2 request for the given task should carry the URL
 * active `architectureId` field.
 *
 * Both `bound-by-system-prompt` and `derived-from-context` need the
 * architectureId on the wire:
 *   - `bound-by-system-prompt`: the gateway resolves the architecture name
 *     once and injects `Architecture: <name>` into every turn's system prompt.
 *   - `derived-from-context`: V1's resolver does not strictly need the URL
 *     active id (it derives from an entity), but threading it through keeps
 *     the request shape symmetric and lets future server-side validation
 *     flag URL/entity mismatches without a frontend change. Group 2's
 *     resolver receives it as a separate arg internally.
 *
 * `clarify-at-save` and unmapped tasks omit the field (the picker handles
 * save-time selection; project-level tasks have no architecture binding).
 *
 * @param taskId - The active task identifier.
 * @returns true if the chatV2 request should include `architectureId`.
 */
export function shouldSendArchitectureIdForTask(taskId: string): boolean {
  const mode = getTaskSaveTargetResolution(taskId);
  return mode === 'bound-by-system-prompt' || mode === 'derived-from-context';
}
