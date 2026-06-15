/**
 * Two-file Tech-Stack.md Loader — Tech-Stack.md Pre-fill + Target-Tech-Stack.md Write
 * (Spec 2026-05-25, Task Group 1).
 *
 * Loads BOTH organisation-level and project-level `tech-stack.md` files for a
 * given project. The orchestrator (Task Group 3) feeds the returned markdown
 * blobs into the pre-fill LLM call (Task Group 2). The loader itself performs
 * no parsing, no schema interpretation, and no LLM calls.
 *
 * Path resolution (per audit finding 1 and follow-ups A, D, E, F):
 *   - The AMS Project DTO field `project_parent_folder` IS the organisation
 *     root despite the misleading name — it predates the org / project
 *     hierarchy. The org file lives at:
 *         {project_parent_folder}/agent-os/product/tech-stack.md
 *   - The project's own folder is named after `project.name` (no separate
 *     `project_folder` column on the AMS Project entity; per audit finding 3
 *     we use `project.name` verbatim with defensive sanitisation). The
 *     project file lives at:
 *         {project_parent_folder}/{sanitised project.name}/agent-os/product/tech-stack.md
 *
 * Case-tolerant filename lookup mirrors the precedent set by
 * `MissionContextResolver` / `TechStackContextResolver` in
 * `services/contextResolvers.ts` — uppercase first, lowercase fallback.
 *
 * 50K-char hard cap per file: any file exceeding the cap is truncated and the
 * corresponding `*Truncated` flag is set so the orchestrator can route the
 * banner to the failure variant.
 */

import { promises as fs } from 'fs';
import * as path from 'path';

import {
  fetchProductName,
  fetchProjectFolder,
} from '../architectureModelClient';
import { logger } from '../logger';
import {
  InvalidProjectFolderNameError,
  sanitiseProjectName,
} from './projectNameSanitiser';

/**
 * Hard per-file character cap (Q5 of the requirements). Files larger than
 * this are truncated to the cap and the corresponding `*Truncated` flag is
 * set so the orchestrator can surface the failure-variant banner.
 */
export const TECH_STACK_MARKDOWN_MAX_CHARS = 50_000;

/**
 * The relative directory under the resolved base path where both org-level
 * and project-level tech-stack files live. Centralised so the case-tolerant
 * lookup loop stays terse.
 */
const TECH_STACK_RELATIVE_DIR = path.join('agent-os', 'product');

/**
 * Filename variants tried in order. Mirrors the precedent in
 * `TechStackContextResolver.resolve` (uppercase first, lowercase fallback).
 */
const TECH_STACK_FILENAME_VARIANTS = ['TECH-STACK.MD', 'tech-stack.md'] as const;

/**
 * Return envelope from {@link loadTechStackMarkdown}.
 *
 * - `orgMarkdown` / `projectMarkdown` carry the raw file content when found,
 *   or `null` when the file is absent / unreadable.
 * - `orgTruncated` / `projectTruncated` indicate whether the corresponding
 *   file exceeded {@link TECH_STACK_MARKDOWN_MAX_CHARS} and was truncated.
 * - `orgPath` / `projectPath` carry the resolved absolute path that was read
 *   (or attempted), useful for diagnostic logging and banner copy. Null when
 *   the loader could not even compute a candidate path (e.g. AMS lookup
 *   failed).
 */
export interface TechStackLoadResult {
  orgMarkdown: string | null;
  projectMarkdown: string | null;
  orgTruncated: boolean;
  projectTruncated: boolean;
  orgPath: string | null;
  projectPath: string | null;
}

/**
 * Internal helper: try every filename variant in order, return content of the
 * first one that exists. Returns null when no variant resolves.
 */
async function readFirstMatchingFile(
  dirPath: string,
): Promise<{ content: string; absolutePath: string } | null> {
  for (const filename of TECH_STACK_FILENAME_VARIANTS) {
    const candidate = path.join(dirPath, filename);
    try {
      const content = await fs.readFile(candidate, 'utf-8');
      return { content, absolutePath: candidate };
    } catch {
      // Continue to the next variant (file does not exist / not readable).
    }
  }
  return null;
}

/**
 * Apply the {@link TECH_STACK_MARKDOWN_MAX_CHARS} cap.
 *
 * Returns the unchanged content + `truncated: false` when within the cap, or
 * a clipped content + `truncated: true` when over the cap. The truncation
 * point is the raw character index — no attempt is made to preserve markdown
 * structure since the orchestrator routes truncated reads to the failure
 * banner and writes zero captured-decision rows.
 */
function applyCharCap(content: string): { content: string; truncated: boolean } {
  if (content.length <= TECH_STACK_MARKDOWN_MAX_CHARS) {
    return { content, truncated: false };
  }
  return {
    content: content.slice(0, TECH_STACK_MARKDOWN_MAX_CHARS),
    truncated: true,
  };
}

/**
 * Loads both organisation-level and project-level `tech-stack.md` files for
 * the given project.
 *
 * Steps:
 *   1. Resolve the organisation root via `fetchProjectFolder(projectId)`. The
 *      AMS DTO field `project_parent_folder` IS the organisation root per
 *      audit finding 1.
 *   2. Resolve the project sub-folder name via `fetchProductName(projectId)`
 *      (AMS Project DTO `product_name`). Sanitise the name to reject
 *      path-traversal escapes.
 *   3. Read the org file (case-tolerant: uppercase first, lowercase
 *      fallback).
 *   4. Read the project file the same way.
 *   5. Apply the per-file 50K-char cap; surface truncation via the result
 *      flag.
 *
 * Both files are independently nullable — the loader degrades gracefully if
 * either is missing. The orchestrator (Task Group 3) decides how to route
 * each combination (both / one / neither / truncated) onto the banner
 * variant.
 *
 * @throws InvalidProjectFolderNameError when the resolved `project.name`
 *         contains a path-traversal token. Callers route this to the
 *         failure-variant banner.
 */
export async function loadTechStackMarkdown(
  projectId: string,
): Promise<TechStackLoadResult> {
  const orgRoot = await fetchProjectFolder(projectId);
  if (!orgRoot) {
    logger.warn('tech-stack loader: organisation root not resolvable from architecture model service', {
      projectId,
    });
    return {
      orgMarkdown: null,
      projectMarkdown: null,
      orgTruncated: false,
      projectTruncated: false,
      orgPath: null,
      projectPath: null,
    };
  }

  // ---------------------------------------------------------------------
  // Org-level tech-stack.md
  // {project_parent_folder}/agent-os/product/tech-stack.md
  // ---------------------------------------------------------------------
  const orgDir = path.join(orgRoot, TECH_STACK_RELATIVE_DIR);
  const orgRead = await readFirstMatchingFile(orgDir);
  let orgMarkdown: string | null = null;
  let orgTruncated = false;
  let orgPath: string | null = null;
  if (orgRead) {
    const capped = applyCharCap(orgRead.content);
    orgMarkdown = capped.content;
    orgTruncated = capped.truncated;
    orgPath = orgRead.absolutePath;
  }

  // ---------------------------------------------------------------------
  // Project-level tech-stack.md
  // {project_parent_folder}/{sanitised project.name}/agent-os/product/tech-stack.md
  //
  // Note: the project name lookup is best-effort. When fetchProductName
  // returns null we treat the project-level file as absent (the org-level
  // file still feeds the pre-fill).
  // ---------------------------------------------------------------------
  let projectMarkdown: string | null = null;
  let projectTruncated = false;
  let projectPath: string | null = null;
  const projectName = await fetchProductName(projectId);
  if (projectName) {
    // sanitiseProjectName throws InvalidProjectFolderNameError on path-traversal
    // tokens. We deliberately do NOT catch it here — the orchestrator (Task
    // Group 3) catches and routes to the failure banner.
    const safeName = sanitiseProjectName(projectName);
    const projectDir = path.join(orgRoot, safeName, TECH_STACK_RELATIVE_DIR);
    const projectRead = await readFirstMatchingFile(projectDir);
    if (projectRead) {
      const capped = applyCharCap(projectRead.content);
      projectMarkdown = capped.content;
      projectTruncated = capped.truncated;
      projectPath = projectRead.absolutePath;
    }
  } else {
    logger.debug('tech-stack loader: project name not resolvable; skipping project-level file', {
      projectId,
    });
  }

  return {
    orgMarkdown,
    projectMarkdown,
    orgTruncated,
    projectTruncated,
    orgPath,
    projectPath,
  };
}

// Re-export the sanitiser error so callers that wrap the loader can catch
// the typed error without depending on the sister module directly.
export { InvalidProjectFolderNameError };
