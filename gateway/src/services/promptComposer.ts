/**
 * Prompt Composition Pipeline
 *
 * Spec 2026-02-28: Unified Conversation Engine v1 (Backend)
 * Task Group 6: Prompt Composition Pipeline
 *
 * Composes system prompts from layers:
 *   1. Persona identity .md file content
 *   2. Optional architecture binding line (Spec 2026-05-01 Spec #4 Group 5;
 *      extended in Spec #5 Group 4 to also cover `derived-from-context` once a
 *      binding has been established for the thread)
 *   3. Task prompt .md file content (or phase-specific prompt if phaseId is provided)
 *   4. Resolved context sections delimited with === SECTION_NAME === markers
 *   5. Response format contract from the task definition's responseFormat field
 *
 * Uses getPersonaRegistry() and getTaskRegistry() to look up definitions.
 * Uses fs.readFile() to read .md file content (resolved relative to registryBasePath).
 * Skips empty context values. Skips response format when task has responseFormat: null.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { getPersonaRegistry, getTaskRegistry } from './registryLoader';
import { getConfig } from '../config';

/**
 * Architecture binding context for `bound-by-system-prompt` and (after a
 * binding has been established) `derived-from-context` tasks.
 *
 * Spec 2026-05-01 Multi-Architecture Discovery Integration (Spec #4) --
 * Task Group 5 introduced the binding for `bound-by-system-prompt`.
 *
 * Spec 2026-05-01 Multi-Architecture Save-Target Resolution (Spec #5) --
 * Task Group 4 extends the binding to `derived-from-context`. The binding
 * is established LATER in the conversation when the LLM identifies the
 * target entity (via `contextBinding` block intercepted by the chatV2
 * response handler in Group 6). The chatV2 caller is responsible for
 * synthesising the `architectureBinding` from
 * `Thread.metadata.boundArchitectureId` for already-bound
 * `derived-from-context` threads.
 *
 * The composer then injects the literal line
 * `Architecture: <name> (id: <id>)` into the system prompt immediately
 * after the persona identity block, so the LLM sees the binding
 * adjacent to existing project / persona declarations.
 */
export interface ArchitectureBindingContext {
  /** The architecture id bound to this conversation (UUID string). */
  id: string;
  /** Human-readable architecture display name (resolved from listArchitectures). */
  name: string;
}

/**
 * Composes a complete system prompt from persona identity, task instructions,
 * resolved context sections, and response format contract.
 *
 * @param personaId - The persona identifier (e.g., 'product-manager')
 * @param taskId - The task identifier (e.g., 'product-manager--define-product')
 * @param phaseId - Optional phase identifier for workflow-mode tasks (e.g., 'bootstrap')
 * @param resolvedContext - Key-value map of resolved context sections (e.g., { 'PRODUCT MISSION': '...' })
 * @param architectureBinding - Optional architecture binding -- when provided AND the active
 *   task/persona effective `saveTargetResolution` is `'bound-by-system-prompt'` OR
 *   `'derived-from-context'`, injects `Architecture: <name> (id: <id>)` between the
 *   persona identity and the task prompt.
 *
 *   For `'derived-from-context'`, the binding is omitted on the first conversation turn
 *   (the LLM operates in "I need to identify the entity first" mode). Subsequent turns
 *   receive the binding once the chatV2 response handler has resolved + persisted the
 *   `boundArchitectureId` on the thread metadata (Group 6 wiring).
 *
 *   For `'clarify-at-save'`, the binding is never injected at prompt-time even if
 *   supplied -- the architecture is chosen at save-time via the picker modal.
 * @returns The composed system prompt string
 * @throws Error if persona or task is not found in the registry
 */
export async function composeSystemPrompt(
  personaId: string,
  taskId: string,
  phaseId: string | null,
  resolvedContext: Record<string, string>,
  architectureBinding?: ArchitectureBindingContext | null
): Promise<string> {
  const basePath = getConfig().registryBasePath;

  // ----- Look up persona and task definitions -----
  const personaRegistry = getPersonaRegistry();
  const taskRegistry = getTaskRegistry();

  const persona = personaRegistry.get(personaId);
  if (!persona) {
    throw new Error(`Persona not found in registry: ${personaId}`);
  }

  const task = taskRegistry.get(taskId);
  if (!task) {
    throw new Error(`Task not found in registry: ${taskId}`);
  }

  // ----- Layer 1: Read persona identity .md file content -----
  const identityPath = path.resolve(basePath, persona.identityPromptRef);
  const identityContent = await fs.readFile(identityPath, 'utf-8');

  // ----- Layer 2: Read task prompt .md file content -----
  // If phaseId is provided, look up the phase's phasePromptRef instead of the task's taskPromptRef
  let taskPromptRef = task.taskPromptRef;
  let activeResponseFormat = task.responseFormat;

  if (phaseId && task.phases && Array.isArray(task.phases)) {
    const phase = task.phases.find(p => p.id === phaseId);
    if (phase) {
      taskPromptRef = phase.phasePromptRef;
      activeResponseFormat = phase.responseFormat;
    }
  }

  const taskPromptPath = path.resolve(basePath, taskPromptRef);
  const taskPromptContent = await fs.readFile(taskPromptPath, 'utf-8');

  // ----- Compose the prompt -----
  const parts: string[] = [];

  // Layer 1: Persona identity at the top
  parts.push(identityContent.trim());

  // ----- Architecture binding line -----
  // Spec 2026-05-01 Spec #4 Group 5: `bound-by-system-prompt`.
  // Spec 2026-05-01 Spec #5 Group 4: `derived-from-context` (symmetric inject
  // once a binding has been established for the thread). The chatV2 caller
  // synthesises the binding from `Thread.metadata.boundArchitectureId` for
  // already-bound `derived-from-context` threads. On the first turn (no
  // binding yet) the line is omitted so the LLM operates in
  // "identify the entity first" mode.
  //
  // The effective saveTargetResolution is the task-level value when set,
  // else the persona-level value. Per-task wins so the architect persona
  // can mix Discovery (bound) and non-Discovery (unbound) tasks.
  const effectiveResolution =
    task.saveTargetResolution ?? persona.saveTargetResolution;
  if (
    (effectiveResolution === 'bound-by-system-prompt' ||
      effectiveResolution === 'derived-from-context') &&
    architectureBinding &&
    architectureBinding.id &&
    architectureBinding.name
  ) {
    parts.push(
      `Architecture: ${architectureBinding.name} (id: ${architectureBinding.id})`
    );
  }

  // Layer 2: Task prompt content
  parts.push(taskPromptContent.trim());

  // Layer 3: Resolved context sections with === SECTION_NAME === delimiters
  for (const [sectionName, content] of Object.entries(resolvedContext)) {
    // Skip empty context values
    if (!content || content.trim().length === 0) {
      continue;
    }
    parts.push(`=== ${sectionName} ===\n${content}`);
  }

  // Layer 4: Response format contract (if task defines one)
  if (activeResponseFormat) {
    const responseFormatBlock = [
      '=== RESPONSE FORMAT CONTRACT ===',
      'You MUST structure your response as a JSON object conforming to the following schema:',
      '',
      JSON.stringify(activeResponseFormat, null, 2),
    ].join('\n');
    parts.push(responseFormatBlock);
  }

  return parts.join('\n\n');
}
