/**
 * Deterministic Target-Tech-Stack.md Writer — Tech-Stack.md Pre-fill +
 * Target-Tech-Stack.md Write (Spec 2026-05-25, Task Group 4).
 *
 * Invoked from the architect-conversation `close` turn handler. Always
 * writes (per settled decision #6 — no delta short-circuit) the file at:
 *
 *   {project_parent_folder}/{sanitised project.name}/agent-os/product/target-tech-stack-<uuid-lowercased>.md
 *
 * - The AMS DTO field `project_parent_folder` IS the organisation root
 *   (audit finding 1).
 * - `project.name` is sanitised before path concatenation (Follow-up A).
 * - `targetArchitectureId.toLowerCase()` is applied at write time per Q14.
 *
 * The renderer walks the latest non-superseded captured-decision rows for
 * the target architecture, groups them by section via the deterministic
 * `decision_code → section heading` mapping
 * (`targetTechStackSectionMapping.ts`), and emits free-form structured
 * markdown that mirrors the source `tech-stack.md` shape (Q2 + Q15
 * reconciliation: output STYLE mirrors source, section ASSIGNMENT is
 * deterministic in code; no LLM call on close).
 *
 * Per-element exceptions emit their own rows under the right section,
 * including the element id and the exception value (Spec 3's exception
 * sub-dialog model). Each row optionally cites its source decision code as
 * a markdown comment so a reader can trace back.
 *
 * Atomic write: writes to `<filename>.tmp` then renames to the final path,
 * matching `threadStore.ts`'s pattern. The close-turn handler catches any
 * filesystem error and degrades the close-turn payload — the rest of the
 * close turn proceeds.
 */

import { promises as fs } from 'fs';
import * as path from 'path';

import {
  fetchProductName,
  fetchProjectFolder,
} from '../architectureModelClient';
import { fetchLatestCapturedDecisions } from '../targetStateCapturedDecisionsClient';
import type { TargetStateCapturedDecision } from '../targetStateCapturedDecisionsClient';
import { logger } from '../logger';
import { sanitiseProjectName } from './projectNameSanitiser';
import {
  TARGET_TECH_STACK_SECTION_ORDER,
  sectionFor,
} from './targetTechStackSectionMapping';

const TEMP_FILE_SUFFIX = '.tmp';
const TARGET_FILE_RELATIVE_DIR = path.join('agent-os', 'product');

// ---------------------------------------------------------------------------
// Injectable dependencies (test seam)
// ---------------------------------------------------------------------------

export interface WriteTargetTechStackDeps {
  fetchProjectFolder: typeof fetchProjectFolder;
  fetchProductName: typeof fetchProductName;
  fetchLatestCapturedDecisions: typeof fetchLatestCapturedDecisions;
  writeFile: typeof fs.writeFile;
  rename: typeof fs.rename;
  mkdir: typeof fs.mkdir;
}

export const defaultWriteTargetTechStackDeps: WriteTargetTechStackDeps = {
  fetchProjectFolder,
  fetchProductName,
  fetchLatestCapturedDecisions,
  writeFile: fs.writeFile,
  rename: fs.rename,
  mkdir: fs.mkdir,
};

// ---------------------------------------------------------------------------
// Inputs / Outputs
// ---------------------------------------------------------------------------

export interface WriteTargetTechStackArgs {
  projectId: string;
  targetArchitectureId: string;
}

export type WriteTargetTechStackOutcome =
  | {
      kind: 'written';
      path: string;
      sizeBytes: number;
      decisionCount: number;
    }
  | {
      kind: 'failed';
      reason: string;
      path: string | null;
    };

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Render + write the deterministic `target-tech-stack-<id>.md` file. Always
 * returns a typed outcome — the caller surfaces the result on the close-turn
 * payload so the user sees either "file written" with path + size, or a
 * clean failure reason with no abort of the close turn itself.
 */
export async function writeTargetTechStackMarkdown(
  args: WriteTargetTechStackArgs,
  deps: WriteTargetTechStackDeps = defaultWriteTargetTechStackDeps,
): Promise<WriteTargetTechStackOutcome> {
  // -----------------------------------------------------------------------
  // Resolve the project folder + name. The AMS DTO field
  // `project_parent_folder` IS the organisation root (audit finding 1).
  // -----------------------------------------------------------------------
  const orgRoot = await deps.fetchProjectFolder(args.projectId);
  if (!orgRoot) {
    return {
      kind: 'failed',
      reason:
        'Could not resolve organisation root folder from the architecture model service.',
      path: null,
    };
  }

  const rawProjectName = await deps.fetchProductName(args.projectId);
  if (!rawProjectName) {
    return {
      kind: 'failed',
      reason:
        'Could not resolve project name from the architecture model service; cannot write target tech-stack file.',
      path: null,
    };
  }

  let safeProjectName: string;
  try {
    safeProjectName = sanitiseProjectName(rawProjectName);
  } catch (err) {
    return {
      kind: 'failed',
      reason: err instanceof Error ? err.message : String(err),
      path: null,
    };
  }

  // -----------------------------------------------------------------------
  // Fetch the latest captured-decision rows for the target architecture.
  // -----------------------------------------------------------------------
  let decisions: TargetStateCapturedDecision[];
  try {
    decisions = await deps.fetchLatestCapturedDecisions(
      args.projectId,
      args.targetArchitectureId,
    );
  } catch (err) {
    return {
      kind: 'failed',
      reason: `Failed to fetch captured-decision rows from the architecture model service: ${
        err instanceof Error ? err.message : String(err)
      }`,
      path: null,
    };
  }

  // -----------------------------------------------------------------------
  // Render the file content + resolve the absolute write path.
  // -----------------------------------------------------------------------
  const filename = `target-tech-stack-${args.targetArchitectureId.toLowerCase()}.md`;
  const dirPath = path.join(
    orgRoot,
    safeProjectName,
    TARGET_FILE_RELATIVE_DIR,
  );
  const filePath = path.join(dirPath, filename);
  const content = renderTargetTechStackMarkdown(
    decisions,
    args.targetArchitectureId,
  );

  // -----------------------------------------------------------------------
  // Atomic write (matches threadStore.ts pattern).
  // -----------------------------------------------------------------------
  try {
    await deps.mkdir(dirPath, { recursive: true });
    const tempPath = filePath + TEMP_FILE_SUFFIX;
    await deps.writeFile(tempPath, content, 'utf8');
    await deps.rename(tempPath, filePath);
  } catch (err) {
    return {
      kind: 'failed',
      reason: `Filesystem write failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
      path: filePath,
    };
  }

  logger.debug('target-tech-stack: wrote file', {
    projectId: args.projectId,
    targetArchitectureId: args.targetArchitectureId,
    path: filePath,
    decisionCount: decisions.length,
  });

  return {
    kind: 'written',
    path: filePath,
    sizeBytes: Buffer.byteLength(content, 'utf8'),
    decisionCount: decisions.length,
  };
}

// ---------------------------------------------------------------------------
// Renderer — pure function exported for unit testing
// ---------------------------------------------------------------------------

/**
 * Render the latest captured-decision rows as a free-form, source-mirroring
 * markdown document. Rows are grouped by section using the deterministic
 * mapping; per-element exceptions appear as their own rows with element id
 * + exception value.
 */
export function renderTargetTechStackMarkdown(
  decisions: readonly TargetStateCapturedDecision[],
  targetArchitectureId: string,
): string {
  const sectionBuckets = new Map<string, TargetStateCapturedDecision[]>();
  for (const section of TARGET_TECH_STACK_SECTION_ORDER) {
    sectionBuckets.set(section, []);
  }
  for (const d of decisions) {
    const section = sectionFor(d.decisionCode);
    const bucket = sectionBuckets.get(section);
    if (bucket) {
      bucket.push(d);
    } else {
      // Defensive — shouldn't happen because TARGET_TECH_STACK_SECTION_ORDER
      // includes 'Other' as a catch-all. Pushed into a new section bucket
      // appended at render time.
      sectionBuckets.set(section, [d]);
    }
  }

  const lines: string[] = [];
  lines.push(`# Target Tech Stack`);
  lines.push('');
  lines.push(`Target architecture: \`${targetArchitectureId}\``);
  lines.push('');
  lines.push(
    'Generated deterministically from captured architect-conversation decisions. ' +
      'Edits to this file are NOT round-tripped back to the architect conversation — they are advisory ' +
      'for downstream Product Manager tasks (Book of Work + Shape-Spec generation).',
  );
  lines.push('');

  let anyEmitted = false;
  for (const section of TARGET_TECH_STACK_SECTION_ORDER) {
    const rows = sectionBuckets.get(section) ?? [];
    if (rows.length === 0) continue;
    anyEmitted = true;
    lines.push(`## ${section}`);
    lines.push('');
    for (const row of rows) {
      lines.push(renderDecisionRow(row));
    }
    lines.push('');
  }

  // Any unexpected section keys appended to the map after the standard ones.
  for (const [section, rows] of sectionBuckets.entries()) {
    if (TARGET_TECH_STACK_SECTION_ORDER.includes(section)) continue;
    if (rows.length === 0) continue;
    anyEmitted = true;
    lines.push(`## ${section}`);
    lines.push('');
    for (const row of rows) {
      lines.push(renderDecisionRow(row));
    }
    lines.push('');
  }

  if (!anyEmitted) {
    lines.push('_No captured decisions yet — the architect conversation will pre-fill this file on close._');
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Render a single captured-decision row as a markdown list item.
 * Per-element exceptions add an "(element: <type>:<id>)" qualifier.
 * The decision code is cited as an inline comment so a reader can trace
 * back to the captured-decision row.
 */
function renderDecisionRow(d: TargetStateCapturedDecision): string {
  const summary = renderRowValue(d);
  const qualifier = renderScopeQualifier(d);
  const trace = ` <!-- code: ${d.decisionCode} -->`;
  if (qualifier) {
    return `- ${qualifier} ${summary}${trace}`;
  }
  return `- ${summary}${trace}`;
}

/**
 * Resolve the value the row carries. For pre-fill rows the `answer_value`
 * column is a JSON-encoded `{ value, sourceQuote, sourceFile }` envelope —
 * we unwrap it so the file is human-readable. Non-JSON values surface
 * verbatim.
 */
function renderRowValue(d: TargetStateCapturedDecision): string {
  // Prefer answerSummary when present — it is the human-readable form.
  if (d.answerSummary && d.answerSummary.length > 0) {
    return `**${d.decisionCode}**: ${d.answerSummary}`;
  }
  // Try to parse answerValue as JSON for pre-fill envelopes.
  if (d.answerValue && d.answerValue.startsWith('{')) {
    try {
      const parsed = JSON.parse(d.answerValue) as Record<string, unknown>;
      if (typeof parsed.value === 'string' && parsed.value.length > 0) {
        return `**${d.decisionCode}**: ${parsed.value}`;
      }
    } catch {
      // Fall through to verbatim rendering.
    }
  }
  return `**${d.decisionCode}**: ${d.answerValue ?? ''}`;
}

/**
 * Per-element exception rows get a qualifier showing the element type +
 * id; architecture-wide rows return null (no qualifier prefix).
 */
function renderScopeQualifier(d: TargetStateCapturedDecision): string | null {
  if (d.scopeKind === 'element') {
    const refType = d.scopeRefType ?? '(unknown)';
    const refId = d.scopeRefId ?? '(unknown)';
    return `(element ${refType}:${refId})`;
  }
  if (d.scopeKind === 'service' && d.scopeRefId) {
    return `(service:${d.scopeRefId})`;
  }
  if (d.scopeKind === 'interface' && d.scopeRefId) {
    return `(interface:${d.scopeRefId})`;
  }
  return null;
}
