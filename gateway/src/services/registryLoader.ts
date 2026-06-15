/**
 * Registry Loader Service
 *
 * Spec 2026-02-28: Unified Conversation Engine v1 (Backend)
 * Task Group 4: Registry Loader and Context Resolver Interfaces
 *
 * Loads all persona and task JSON config files at startup, validates
 * cross-references (identity prompt refs, persona IDs, task prompt refs,
 * phase prompt refs), and holds the composed registries in memory.
 *
 * On validation failure: logs a warning and skips the invalid entry.
 * The gateway still starts and serves valid personas/tasks.
 *
 * Registry data is loaded once at startup and held in memory -- no hot-reloading.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { PersonaDefinition, TaskDefinition } from '../types/chatV2';
import { getConfig } from '../config';
import { logger } from './logger';
import { initializeContextResolverRegistry } from './contextResolvers';

/**
 * In-memory persona registry: Map<personaId, PersonaDefinition>
 */
let personaRegistry: Map<string, PersonaDefinition> = new Map();

/**
 * In-memory task registry: Map<taskId, TaskDefinition>
 */
let taskRegistry: Map<string, TaskDefinition> = new Map();

/**
 * Returns the persona registry map.
 *
 * @returns Map keyed by persona ID to PersonaDefinition
 */
export function getPersonaRegistry(): Map<string, PersonaDefinition> {
  return personaRegistry;
}

/**
 * Returns the task registry map.
 *
 * @returns Map keyed by task ID to TaskDefinition
 */
export function getTaskRegistry(): Map<string, TaskDefinition> {
  return taskRegistry;
}

/**
 * Checks whether a file exists on disk.
 *
 * @param filePath - Absolute path to check
 * @returns true if the file exists, false otherwise
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Loads and validates all persona and task JSON config files from disk,
 * populates in-memory registries, and initializes the context resolver
 * registry.
 *
 * Validation checks:
 * (a) Every persona JSON identityPromptRef points to an existing .md file
 * (b) Every task JSON personaId exists in the persona registry
 * (c) Every task JSON taskPromptRef points to an existing .md file
 * (d) Phase definitions within workflow tasks reference valid phase prompt files
 *
 * On validation failure: logs logger.warn() with the invalid persona/task ID
 * and the nature of the error, skips the invalid entry, continues loading
 * valid ones.
 */
export async function initializeRegistries(): Promise<void> {
  const basePath = getConfig().registryBasePath;

  // Reset registries
  personaRegistry = new Map();
  taskRegistry = new Map();

  // ----- Load Persona Definitions -----
  const personasDir = path.resolve(basePath, 'personas');
  let personaFiles: string[] = [];
  try {
    const allFiles = await fs.readdir(personasDir);
    personaFiles = allFiles.filter(f => f.endsWith('.json'));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn('Failed to read personas directory', { path: personasDir, error: message });
  }

  for (const file of personaFiles) {
    const filePath = path.resolve(personasDir, file);
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      const persona: PersonaDefinition = JSON.parse(raw);

      // Validate (a): identityPromptRef points to an existing .md file
      const identityPath = path.resolve(basePath, persona.identityPromptRef);
      const identityExists = await fileExists(identityPath);
      if (!identityExists) {
        logger.warn('Persona skipped: identityPromptRef not found on disk', {
          personaId: persona.id,
          identityPromptRef: persona.identityPromptRef,
          resolvedPath: identityPath,
        });
        continue;
      }

      personaRegistry.set(persona.id, persona);
      logger.info('Persona loaded', { personaId: persona.id });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn('Failed to load persona file', { file, error: message });
    }
  }

  // ----- Load Task Definitions -----
  const tasksDir = path.resolve(basePath, 'tasks');
  let taskFiles: string[] = [];
  try {
    const allFiles = await fs.readdir(tasksDir);
    taskFiles = allFiles.filter(f => f.endsWith('.json'));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn('Failed to read tasks directory', { path: tasksDir, error: message });
  }

  for (const file of taskFiles) {
    const filePath = path.resolve(tasksDir, file);
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      const task: TaskDefinition = JSON.parse(raw);

      // Validate (b): personaId exists in the persona registry
      if (!personaRegistry.has(task.personaId)) {
        logger.warn('Task skipped: personaId not found in persona registry', {
          taskId: task.id,
          personaId: task.personaId,
        });
        continue;
      }

      // Validate (c): taskPromptRef points to an existing .md file
      const taskPromptPath = path.resolve(basePath, task.taskPromptRef);
      const taskPromptExists = await fileExists(taskPromptPath);
      if (!taskPromptExists) {
        logger.warn('Task skipped: taskPromptRef not found on disk', {
          taskId: task.id,
          taskPromptRef: task.taskPromptRef,
          resolvedPath: taskPromptPath,
        });
        continue;
      }

      // Validate (d): phase prompt refs within workflow tasks reference valid files
      let phasesValid = true;
      if (task.phases && Array.isArray(task.phases)) {
        for (const phase of task.phases) {
          const phasePromptPath = path.resolve(basePath, phase.phasePromptRef);
          const phasePromptExists = await fileExists(phasePromptPath);
          if (!phasePromptExists) {
            logger.warn('Task skipped: phase phasePromptRef not found on disk', {
              taskId: task.id,
              phaseId: phase.id,
              phasePromptRef: phase.phasePromptRef,
              resolvedPath: phasePromptPath,
            });
            phasesValid = false;
            break;
          }
        }
      }
      if (!phasesValid) {
        continue;
      }

      taskRegistry.set(task.id, task);
      logger.info('Task loaded', { taskId: task.id, personaId: task.personaId });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn('Failed to load task file', { file, error: message });
    }
  }

  // ----- Initialize Context Resolver Registry -----
  initializeContextResolverRegistry();

  logger.info('Registries initialized', {
    personaCount: personaRegistry.size,
    taskCount: taskRegistry.size,
  });
}
