/**
 * Prompt composer for the V3 layered prompt system.
 *
 * Assembles the per-file gap-fill prompt from the layered markdown files
 * under `discovery-service/src/services/prompts/`:
 *
 *   base.md
 *   generic-language.md
 *   languages/<language>.md
 *   frameworks/<frameworkPackId>.md
 *   frameworks/_no-framework-with-ir.md
 *   frameworks/_no-ir.md
 *
 * Three tiers determine which layers combine:
 *   Tier A (framework pack active):  base + language + framework(pack) + packOutput + IR + source
 *   Tier B (language-only):          base + language + _no-framework-with-ir + IR + source
 *   Tier C (nothing usable):         base + language-or-generic + _no-ir + source
 *
 * Each run also produces a `promptVersion` object of 8-char SHA-256 hashes:
 *   - `base`     hash of base.md raw content
 *   - `language` hash of the selected language layer raw content
 *   - `framework` hash of the selected framework layer raw content
 *   - `composed` hash of the full assembled template MINUS per-file data
 *                (pack output, IR, and source file content are stripped
 *                before hashing so the hash is stable across files).
 *
 * Spec: V3 Layered Prompt System — Task Group 2 (composer).
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
  renderIrInjection,
  renderPackOutputInjection,
  renderExistingEntityInjection,
  IrInjectionPayload,
  PackOutputInjectionItem,
  ExistingEntityInjectionItem,
} from './injection';
import type { RuntimeEvidenceLlmContext } from '../runtimeEvidence/httpRuntimeObservation';

/**
 * Tier selector for prompt composition.
 *
 * - 'A' — framework pack produced output; compose with pack-output + IR injection.
 * - 'B' — language-only (no framework pack); compose with IR injection.
 * - 'C' — no structural info at all; compose from raw source only.
 */
export type PromptTier = 'A' | 'B' | 'C';

/**
 * Input shape accepted by `composePrompt`.
 */
export interface ComposePromptInput {
  tier: PromptTier;
  /** Language id — e.g. 'java', 'typescript'. Used to select the language layer. */
  language?: string;
  /** Framework pack id — e.g. 'spring-classic'. Required for Tier A. */
  frameworkPackId?: string;
  /** Adapter-produced pack output for this file; only rendered for Tier A. */
  packOutput?: PackOutputInjectionItem[];
  /** Structural IR summary for this file; rendered for Tier A and Tier B. */
  ir?: IrInjectionPayload;
  /** Source file content + path to analyze. */
  sourceFile: {
    filePath: string;
    content: string;
  };
  /**
   * Optional run-level runtime evidence context produced by Spec 5's
   * runtime-evidence sub-stage. When present, the composer renders a
   * `Runtime Evidence Summary` section into the prompt alongside the
   * pack output and IR sections so the LLM can reason about endpoint
   * usage patterns. NO raw log content ever passes through here -- only
   * the pre-built compact summary. When absent, the composer renders a
   * one-line stub stating no runtime evidence is available, preserving
   * existing non-runtime prompt behaviour.
   */
  runtimeEvidenceContext?: RuntimeEvidenceLlmContext;
  /**
   * Optional LEAN existing-entity index (Model-Aware Discovery, 2026-05-30).
   *
   * When present and non-empty, the composer renders an "Existing Entities"
   * section listing entities that ALREADY exist in the (project, architecture)
   * model so the LLM does NOT restate them and instead proposes `enrich` /
   * `link` candidates that reference them BY NAME. Each entry is lean
   * (`type` / `name` / `parentOrTableHint`) -- no attributes, no descriptions.
   *
   * This is a NUDGE only: the load-bearing dedup / match against existing
   * entities runs deterministically in CODE at save-back, NEVER in the prompt.
   * The LLM must NEVER emit `*_points` wrappers. When absent / empty the
   * composer renders a one-line stub so the prompt shape stays stable across
   * first-run (empty model) and subsequent runs.
   */
  existingEntities?: ExistingEntityInjectionItem[];
}

/**
 * Per-layer 8-char SHA-256 version record persisted per run.
 */
export interface PromptVersion {
  base: string;
  language: string;
  framework: string;
  composed: string;
}

/**
 * Composer output shape.
 */
export interface ComposePromptResult {
  prompt: string;
  promptVersion: PromptVersion;
}

/**
 * Root directory where layer markdown files live.
 *
 * Resolved via `__dirname` so the composer works under both ts-jest
 * (running from `src/`) and the compiled output (`dist/`). This assumes the
 * markdown files ship alongside the compiled JS at build time; if that
 * becomes a problem we can add a build step to copy `*.md` into `dist/`.
 */
const PROMPTS_ROOT = __dirname;

/**
 * Sentinel placeholders used in the assembled template so we can compute the
 * `composed` hash over the skeleton + static layer content WITHOUT hashing
 * per-file dynamic substitutions (pack output, IR, source code).
 *
 * The real prompt string replaces these sentinels with the rendered content
 * before being returned; the hash is computed BEFORE replacement.
 */
const PACK_OUTPUT_PLACEHOLDER = '<<<PACK_OUTPUT_INJECTION>>>';
const IR_PLACEHOLDER = '<<<IR_INJECTION>>>';
const RUNTIME_EVIDENCE_PLACEHOLDER = '<<<RUNTIME_EVIDENCE_INJECTION>>>';
const EXISTING_ENTITIES_PLACEHOLDER = '<<<EXISTING_ENTITIES_INJECTION>>>';
const SOURCE_FILE_PLACEHOLDER = '<<<SOURCE_FILE>>>';
const SOURCE_FILE_PATH_PLACEHOLDER = '<<<SOURCE_FILE_PATH>>>';

/**
 * Compute the 8-char truncated SHA-256 hex digest of the input string.
 *
 * Empty string still produces a stable hash (SHA-256 of ""), so "missing"
 * layers are fingerprinted too and show up distinctly in the `promptVersion`
 * record rather than silently collapsing with layers that were read from disk.
 */
export function hash8(input: string): string {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex').slice(0, 8);
}

/**
 * Read a markdown layer from disk.
 *
 * Returns empty string if the file is missing — the composer tolerates
 * missing layers so tests can run without the Group 1 markdown files landing
 * first, and so a misconfigured language/framework id produces a hashable
 * empty-layer record rather than a hard crash.
 */
function readLayer(relativePath: string): string {
  const absolute = path.join(PROMPTS_ROOT, relativePath);
  try {
    return fs.readFileSync(absolute, 'utf8');
  } catch {
    return '';
  }
}

/**
 * Known language layer ids the composer will look up by name.
 *
 * Anything not in this list falls back to `generic-language.md` on Tier C
 * (per Task Group 2 spec bullet 3: "language layer if recognized, else
 * generic-language.md").
 */
const KNOWN_LANGUAGE_LAYERS = new Set<string>(['java', 'typescript']);

/**
 * Resolve the language layer path + content, applying the generic fallback
 * when appropriate.
 */
function resolveLanguageLayer(
  language: string | undefined,
  allowGenericFallback: boolean,
): { relativePath: string; content: string } {
  const normalized = (language || '').toLowerCase();
  if (normalized && KNOWN_LANGUAGE_LAYERS.has(normalized)) {
    const rel = `languages/${normalized}.md`;
    return { relativePath: rel, content: readLayer(rel) };
  }
  if (allowGenericFallback) {
    return { relativePath: 'generic-language.md', content: readLayer('generic-language.md') };
  }
  // Tier A/B with unknown language: still prefer the named file path, even if empty.
  const rel = normalized ? `languages/${normalized}.md` : 'generic-language.md';
  return { relativePath: rel, content: readLayer(rel) };
}

/**
 * Resolve the framework layer path + content based on tier.
 */
function resolveFrameworkLayer(
  tier: PromptTier,
  frameworkPackId: string | undefined,
): { relativePath: string; content: string } {
  if (tier === 'A') {
    const id = frameworkPackId || '';
    const rel = `frameworks/${id}.md`;
    return { relativePath: rel, content: readLayer(rel) };
  }
  if (tier === 'B') {
    const rel = 'frameworks/_no-framework-with-ir.md';
    return { relativePath: rel, content: readLayer(rel) };
  }
  const rel = 'frameworks/_no-ir.md';
  return { relativePath: rel, content: readLayer(rel) };
}

/**
 * Assemble the prompt skeleton with sentinel placeholders in place of the
 * dynamic per-file content.
 *
 * Returns both the placeholder-skeleton (for the composed hash) and the
 * fully-substituted prompt (for the return value).
 */
function assembleSkeleton(
  tier: PromptTier,
  baseContent: string,
  languageContent: string,
  frameworkContent: string,
): string {
  const parts: string[] = [];
  parts.push('# V3 Gap-Fill Prompt');
  parts.push('');
  parts.push(`## Tier: ${tier}`);
  parts.push('');
  parts.push('## Base');
  parts.push(baseContent);
  parts.push('');
  parts.push('## Language Layer');
  parts.push(languageContent);
  parts.push('');
  parts.push('## Framework Layer');
  parts.push(frameworkContent);
  parts.push('');

  if (tier === 'A') {
    parts.push('## Pack Output (already discovered — do NOT restate)');
    parts.push(PACK_OUTPUT_PLACEHOLDER);
    parts.push('');
    parts.push('## Intermediate Representation');
    parts.push(IR_PLACEHOLDER);
    parts.push('');
  } else if (tier === 'B') {
    parts.push('## Intermediate Representation');
    parts.push(IR_PLACEHOLDER);
    parts.push('');
  }

  parts.push('## Runtime Evidence Summary');
  parts.push(RUNTIME_EVIDENCE_PLACEHOLDER);
  parts.push('');

  // Model-Aware Discovery (2026-05-30): "these already exist" nudge. The
  // entities listed here are ALREADY in the (project, architecture) model.
  // Do NOT restate them. Instead, propose `enrich` / `link` candidates that
  // reference them BY NAME. The match itself is deterministic in CODE at
  // save-back -- this section is ONLY a nudge.
  parts.push('## Existing Entities (already in the model — do NOT restate)');
  parts.push(
    'These entities ALREADY exist in the architecture model. Do NOT emit ' +
      '`create` candidates that merely restate them. If your analysis adds an ' +
      'attribute or a relationship to one of them, emit an `enrich` candidate ' +
      'with `operation: "enrich"` whose `targetEntityName` is the existing ' +
      "entity's `name`. If you find a database table that corresponds to one of " +
      'these logical entities (or vice versa), emit a `link` candidate with ' +
      '`operation: "link"`, `logicalEntityName`, and `physicalEntityName` set to ' +
      'the two existing entity names. ALWAYS reference existing entities BY NAME ' +
      '(never by id). NEVER emit any `*_points` wrapper ' +
      '(application_points / data_entity_points / business_points / ' +
      'app_business_points) — those are backend auto-managed.',
  );
  parts.push(EXISTING_ENTITIES_PLACEHOLDER);
  parts.push('');

  parts.push(`## Source File: ${SOURCE_FILE_PATH_PLACEHOLDER}`);
  parts.push('```');
  parts.push(SOURCE_FILE_PLACEHOLDER);
  parts.push('```');
  parts.push('');

  return parts.join('\n');
}

/**
 * Render the optional runtime evidence context as a compact JSON block
 * for prompt injection. When the context is absent the composer emits a
 * single-line stub so the prompt template keeps a stable shape across
 * runs with and without uploaded log files.
 *
 * Privacy: the composer ONLY serialises the pre-built summary -- it
 * does NOT touch raw log content, IPs, user agents, or referrers.
 */
function renderRuntimeEvidenceInjection(
  ctx: RuntimeEvidenceLlmContext | undefined,
): string {
  if (!ctx) {
    return 'No runtime evidence available for this run.';
  }
  const summary = ctx.runtimeEvidenceSummary;
  if (
    summary.logFilesProcessed === 0 &&
    summary.matchedEndpoints.length === 0 &&
    summary.codeEndpointsWithNoObservedUsage.length === 0 &&
    summary.unmatchedRuntimeRouteHints.length === 0
  ) {
    return 'No runtime evidence available for this run.';
  }
  return JSON.stringify(ctx, null, 2);
}

/**
 * Compose a per-file gap-fill prompt.
 *
 * See module-level doc comment for tier routing and `promptVersion` semantics.
 */
export function composePrompt(input: ComposePromptInput): ComposePromptResult {
  const {
    tier,
    language,
    frameworkPackId,
    packOutput,
    ir,
    sourceFile,
    runtimeEvidenceContext,
    existingEntities,
  } = input;

  const baseContent = readLayer('base.md');
  const languageLayer = resolveLanguageLayer(language, tier === 'C');
  const frameworkLayer = resolveFrameworkLayer(tier, frameworkPackId);

  // Skeleton with placeholders — used for the composed hash.
  const skeleton = assembleSkeleton(tier, baseContent, languageLayer.content, frameworkLayer.content);

  // Full prompt with the dynamic substitutions applied.
  const packOutputRendered = tier === 'A' ? renderPackOutputInjection(packOutput) : '';
  const irRendered = tier === 'A' || tier === 'B' ? renderIrInjection(ir) : '';
  const runtimeEvidenceRendered = renderRuntimeEvidenceInjection(runtimeEvidenceContext);
  const existingEntitiesRendered =
    Array.isArray(existingEntities) && existingEntities.length > 0
      ? renderExistingEntityInjection(existingEntities)
      : 'No existing entities for this run (first run / empty model).';

  let prompt = skeleton;
  prompt = prompt.replace(PACK_OUTPUT_PLACEHOLDER, packOutputRendered);
  prompt = prompt.replace(IR_PLACEHOLDER, irRendered);
  prompt = prompt.replace(RUNTIME_EVIDENCE_PLACEHOLDER, runtimeEvidenceRendered);
  prompt = prompt.replace(EXISTING_ENTITIES_PLACEHOLDER, existingEntitiesRendered);
  prompt = prompt.replace(SOURCE_FILE_PATH_PLACEHOLDER, sourceFile?.filePath ?? '');
  prompt = prompt.replace(SOURCE_FILE_PLACEHOLDER, sourceFile?.content ?? '');

  const promptVersion: PromptVersion = {
    base: hash8(baseContent),
    language: hash8(languageLayer.content),
    framework: hash8(frameworkLayer.content),
    composed: hash8(skeleton),
  };

  return { prompt, promptVersion };
}
