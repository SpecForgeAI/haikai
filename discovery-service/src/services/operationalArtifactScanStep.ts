/**
 * Operational-Artifact Scan Step (D1).
 *
 * Spec: 2026-06-14 Generic Operational-Artifact Discovery (D1), Task Group 3.
 *
 * The always-on, pack-agnostic pass: a standalone step modeled on
 * `llmGapFillStep.ts` (`runLlmGapFill`) that does a DEDICATED re-walk of
 * `context.repoRoot`, applies the broad relevance gating (`operationalArtifact
 * Relevance.ts`), calls the new gateway summariser relay
 * (`gatewayClient.summariseOperationalArtifact`) with `promisePool` concurrency
 * + per-file soft-fail + a content-addressed cache, and emits EXACTLY ONE
 * `operational_artifact` `FindingEmitInput` per selected file (plus one
 * run-level skip Finding on cap overflow) onto the existing emission boundary.
 *
 * It COMPLEMENTS, does NOT consume, the pruned scan plan / `sourceFiles` map --
 * files the scan plan already dropped (symbol-less shell, `.jil`, proprietary
 * config) are still seen here.
 *
 * NO tree-sitter (D1 summarises, it does not parse). NO candidate / entity
 * resolution -- referenced names stay PLAIN STRINGS in `detailJson.invokes`
 * (Decision 6). NO AMS schema change (`findingType` / `category` free-text,
 * `detailJson` open JSONB).
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import {
  gatewayClient,
  OperationalArtifactGatewayError,
} from './gatewayClient';
import {
  SKIP_DIRECTORIES,
  isExcludedByPaths,
  isUnderIncludePaths,
} from './scanPlanBuilder';
import {
  evaluateOperationalArtifactRelevance,
  applyFileCountCap,
  type RelevanceSignal,
  type SelectedOperationalArtifact,
} from './operationalArtifactRelevance';
import {
  OperationalArtifactResponseCache,
  readOperationalArtifactCacheModel,
  OPERATIONAL_ARTIFACT_RELAY_TEMPERATURE,
} from './operationalArtifactResponseCache';
import {
  buildOperationalArtifactFinding,
  buildOperationalArtifactCapSkipFinding,
  OPERATIONAL_ARTIFACT_KINDS,
  type OperationalArtifactKind,
  type OperationalArtifactDetail,
} from './findings/emissionSources';
import type { FindingEmitInput } from './findings/FindingEmitter';
import {
  DISCOVERY_FILE_LINE_LIMIT,
  OPERATIONAL_ARTIFACT_FILE_CAP,
  OPERATIONAL_ARTIFACT_CONCURRENCY,
  OPERATIONAL_ARTIFACT_MAX_FAILURE_RATE,
} from '../config';
import { OPERATIONAL_ARTIFACT_MAX_BYTES } from './operationalArtifactRelevance';

// ============================================================================
// Input / output types
// ============================================================================

/**
 * Step input. `repoRoot` is the absolute cloned-repo root. The scope filter
 * (`subfolder` / `includePaths` / `excludePaths`) mirrors
 * `scanPlanBuilder.buildScanPlanFromFilesystem` so service-scoped runs re-walk
 * ONLY their in-scope files. `claimedPaths` are the repo-relative paths the
 * deterministic packs already consumed (a config XML a pack parsed is not
 * re-summarised). `atomReferencedPaths` are paths referenced/invoked by a known
 * atom (the fourth relevance signal).
 */
export interface OperationalArtifactScanStepInput {
  runId: string;
  repoRoot: string;
  subfolder?: string;
  includePaths?: string[];
  excludePaths?: string[];
  claimedPaths?: ReadonlySet<string>;
  atomReferencedPaths?: ReadonlySet<string>;
  /** Override the file-count cap (defaults to config). */
  fileCap?: number;
}

export interface OperationalArtifactFailure {
  filePath: string;
  error: string;
}

/**
 * Step output. `findingInputs` are pushed onto the pipeline's
 * `collectedFindingInputs` and flow through
 * `runManager.emitPipelineFindingsForRun` -> `findingEmitter` (NO parallel
 * emitter). `stageStatus` is `failed` only when the per-file failure rate
 * exceeds `OPERATIONAL_ARTIFACT_MAX_FAILURE_RATE` (the run still COMPLETES).
 */
export interface OperationalArtifactScanStepOutput {
  findingInputs: FindingEmitInput[];
  stageStatus: 'completed' | 'failed';
  failures: OperationalArtifactFailure[];
  filesSelected: number;
  filesSummarised: number;
  filesFailed: number;
  overflowCount: number;
  cacheHits: number;
}

// ============================================================================
// Per-file carrier (absolute + relative path + selecting signal)
// ============================================================================

interface OperationalArtifactCarrier {
  absPath: string;
  relPath: string;
}

// ============================================================================
// Concurrency pool (hand-rolled, identical to llmGapFillStep -- no new dep)
// ============================================================================

async function promisePool<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers: Promise<void>[] = [];
  const effectiveLimit = Math.max(1, Math.min(limit, items.length || 1));
  for (let w = 0; w < effectiveLimit; w += 1) {
    workers.push(
      (async () => {
        while (true) {
          const i = cursor;
          cursor += 1;
          if (i >= items.length) return;
          results[i] = await worker(items[i], i);
        }
      })(),
    );
  }
  await Promise.all(workers);
  return results;
}

// ============================================================================
// Scoped re-walk (complements the pruned scan plan)
// ============================================================================

/**
 * Recursively collect every relative file path under `scanRoot`, pruning the
 * standard skip directories MINUS the never-skip set (so the always-on pass
 * still descends `bin/` / `scripts/` where operational artifacts live). The
 * relevance predicate makes the final per-file include/exclude decision; this
 * walk only gathers candidates + honours the cheap directory prune and the
 * include/exclude path scope filter (mirrors
 * `scanPlanBuilder.buildScanPlanFromFilesystem`).
 */
async function walkRepo(
  repoRoot: string,
  scanRoot: string,
  includePaths: string[],
  excludePaths: string[],
  neverSkip: ReadonlySet<string>,
): Promise<string[]> {
  const out: string[] = [];

  async function walk(dir: string): Promise<void> {
    let dirEntries;
    try {
      dirEntries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[OperationalArtifactScan] readdir failed at "${dir}": ${msg}`);
      return;
    }
    for (const dirent of dirEntries) {
      const fullPath = path.join(dir, dirent.name);
      if (dirent.isDirectory()) {
        // Skip standard skip-dirs EXCEPT the operational never-skip set.
        if (SKIP_DIRECTORIES.has(dirent.name) && !neverSkip.has(dirent.name.toLowerCase())) {
          continue;
        }
        await walk(fullPath);
      } else if (dirent.isFile()) {
        const relativePath = path.relative(repoRoot, fullPath).replace(/\\/g, '/');
        if (includePaths.length > 0 && !isUnderIncludePaths(relativePath, includePaths)) continue;
        if (isExcludedByPaths(relativePath, excludePaths)) continue;
        out.push(relativePath);
      }
    }
  }

  await walk(scanRoot);
  return out;
}

// ============================================================================
// Summariser prompt (composed in discovery-service, NOT gateway-side)
// ============================================================================

/**
 * Compose the per-file summariser prompt. The gateway relay is stateless; the
 * full prompt (role + strict-JSON contract + file body) is built HERE so the
 * cache key + model + prompt content live entirely in discovery-service
 * (Decision 7). Requests the strict `detailJson` object (Decision 5/6).
 */
export function composeOperationalArtifactPrompt(args: {
  filePath: string;
  language: string;
  relevanceSignal: string;
  content: string;
}): string {
  const kindList = OPERATIONAL_ARTIFACT_KINDS.join(' | ');
  return [
    'You are a migration-discovery assistant summarising a single OPERATIONAL',
    'ARTIFACT file (a shell/Perl script, Autosys JIL, monitoring/connection XML,',
    'CI/deployment config, or proprietary operational config) that no dedicated',
    'parser handled. Summarise ONLY what is evident in the file. Do NOT guess at',
    'wider system topology. Reference other files / commands / classes by their',
    'PLAIN STRING name exactly as they appear -- do NOT resolve them to entities.',
    '',
    'Return a SINGLE STRICT JSON object (no markdown fences, no prose around it)',
    'with EXACTLY these fields:',
    '{',
    '  "purpose": string,            // one or two sentences: what this file does',
    `  "artifactKind": string,       // one of: ${kindList}`,
    '  "behaviourBearing": boolean,  // true if it DOES operational work that must',
    '                                // carry over like-for-like (vs pure config/noise)',
    '  "invokes": string[],          // files / Java FQCNs / external commands it runs',
    '  "inputs": string[],           // files / DB / env vars / network it reads',
    '  "outputs": string[],          // files / DB / env vars / network it writes',
    '  "sideEffects": string[],      // notable side effects (truncates, deletes, mails, ...)',
    '  "externalSystems": string[],  // external systems it touches (DB, FTP, MQ, ...)',
    '  "evidence": string[],         // short verbatim snippets supporting the summary',
    '  "language": string            // best-effort language/format label (bash, jil, xml, ...)',
    '}',
    'Use empty arrays where nothing applies. If unsure of the kind, use "other".',
    '',
    `File path: ${args.filePath}`,
    `Detected language/format: ${args.language}`,
    `Selected because: ${args.relevanceSignal}`,
    '',
    '----- FILE CONTENTS BEGIN -----',
    args.content,
    '----- FILE CONTENTS END -----',
  ].join('\n');
}

// ============================================================================
// Strict-JSON parse + validate + normalise
// ============================================================================

function toStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is string => typeof x === 'string')
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

function normaliseArtifactKind(raw: unknown): OperationalArtifactKind {
  if (typeof raw === 'string') {
    const lower = raw.trim().toLowerCase();
    if ((OPERATIONAL_ARTIFACT_KINDS as readonly string[]).includes(lower)) {
      return lower as OperationalArtifactKind;
    }
  }
  return 'other';
}

/**
 * Confidence band (Decision 5): clamp the LLM value into `[0.3, 0.95]`; a
 * missing / non-numeric confidence defaults to a neutral `0.6` (these are
 * presence signals, not high-stakes extractions).
 */
function clampConfidence(raw: unknown): number {
  const n = typeof raw === 'number' && Number.isFinite(raw) ? raw : 0.6;
  return Math.max(0.3, Math.min(0.95, n));
}

/**
 * Parse the raw relay content into a validated {@link OperationalArtifactDetail}.
 * Throws on malformed JSON / missing `purpose` (caller counts as a per-file
 * soft-fail and drops that file's output).
 */
export function parseOperationalArtifactResponse(
  content: string,
  filePath: string,
  relevanceSignal: string,
): { detail: OperationalArtifactDetail; rawConfidence: unknown } {
  let parsed: unknown;
  // Tolerate an accidental ```json fence by stripping it before parse.
  const stripped = content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '');
  try {
    parsed = JSON.parse(stripped);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`summariser response was not valid JSON: ${msg}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('summariser response JSON was not an object');
  }
  const obj = parsed as Record<string, unknown>;
  const purpose = typeof obj.purpose === 'string' ? obj.purpose.trim() : '';
  if (purpose.length === 0) {
    throw new Error('summariser response missing required `purpose`');
  }
  const language =
    typeof obj.language === 'string' && obj.language.trim().length > 0
      ? obj.language.trim()
      : 'unknown';
  const detail: OperationalArtifactDetail = {
    filePath,
    purpose,
    artifactKind: normaliseArtifactKind(obj.artifactKind),
    behaviourBearing: obj.behaviourBearing === true,
    invokes: toStringArray(obj.invokes),
    inputs: toStringArray(obj.inputs),
    outputs: toStringArray(obj.outputs),
    sideEffects: toStringArray(obj.sideEffects),
    externalSystems: toStringArray(obj.externalSystems),
    evidence: toStringArray(obj.evidence),
    language,
    relevanceSignal,
  };
  return { detail, rawConfidence: obj.confidence };
}

// ============================================================================
// File read + truncation (reuse DISCOVERY_FILE_LINE_LIMIT, like gap-fill)
// ============================================================================

/**
 * Read a file's head bytes (for the relevance predicate) and its full size.
 * Returns null on read failure.
 */
async function readHeadAndSize(
  absPath: string,
): Promise<{ headBytes: Buffer; sizeBytes: number } | null> {
  try {
    const stat = await fs.stat(absPath);
    // Read up to a small head (8KB or the 1MB ceiling, whichever is smaller).
    const handle = await fs.open(absPath, 'r');
    try {
      const headLen = Math.min(8192, Math.max(0, stat.size));
      const buf = Buffer.alloc(headLen);
      if (headLen > 0) {
        await handle.read(buf, 0, headLen, 0);
      }
      return { headBytes: buf, sizeBytes: stat.size };
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}

/** Read the full file content, truncated at the line limit (like gap-fill). */
async function readTruncatedContent(absPath: string): Promise<string | null> {
  try {
    const content = await fs.readFile(absPath, 'utf-8');
    const lines = content.split('\n');
    if (lines.length > DISCOVERY_FILE_LINE_LIMIT) {
      const truncated = lines.slice(0, DISCOVERY_FILE_LINE_LIMIT).join('\n');
      return truncated + `\n\n[FILE TRUNCATED at ${DISCOVERY_FILE_LINE_LIMIT} lines]`;
    }
    return content;
  } catch {
    return null;
  }
}

// ============================================================================
// Public entry point
// ============================================================================

/**
 * Run the operational-artifact scan over `repoRoot` (scoped per the filter).
 * Returns `findingInputs` for the caller to emit post-persist + stage metrics.
 *
 * The caller MUST gate the invocation on `OPERATIONAL_ARTIFACT_SCAN_ENABLED`
 * (the env kill-switch); this function always runs when invoked.
 */
export async function runOperationalArtifactScan(
  input: OperationalArtifactScanStepInput,
): Promise<OperationalArtifactScanStepOutput> {
  const start = Date.now();
  const { runId, repoRoot } = input;
  const includePaths = input.includePaths ?? [];
  const excludePaths = input.excludePaths ?? [];
  const fileCap = input.fileCap ?? OPERATIONAL_ARTIFACT_FILE_CAP;
  const scanRoot = input.subfolder ? path.join(repoRoot, input.subfolder) : repoRoot;

  // Priority dirs are never-skip for the walk (so `bin/`/`scripts/` are entered).
  const { OPERATIONAL_ARTIFACT_PRIORITY_DIRS } = await import('../config');
  const neverSkip = new Set(OPERATIONAL_ARTIFACT_PRIORITY_DIRS.map((d) => d.toLowerCase()));

  console.log(
    `[OperationalArtifactScan] start: runId=${runId}, scanRoot=${scanRoot}, ` +
      `includePaths=${JSON.stringify(includePaths)}, excludePaths=${JSON.stringify(excludePaths)}, cap=${fileCap}`,
  );

  // 1. Walk + relevance-gate each file.
  const relPaths = await walkRepo(repoRoot, scanRoot, includePaths, excludePaths, neverSkip);
  const selected: SelectedOperationalArtifact<OperationalArtifactCarrier>[] = [];
  for (const relPath of relPaths) {
    const absPath = path.join(repoRoot, relPath);
    const hs = await readHeadAndSize(absPath);
    if (!hs) continue;
    // Cheap pre-reject on size before content inspection.
    if (hs.sizeBytes >= OPERATIONAL_ARTIFACT_MAX_BYTES) continue;
    const verdict = evaluateOperationalArtifactRelevance({
      filePath: relPath,
      headBytes: hs.headBytes,
      sizeBytes: hs.sizeBytes,
      claimedPaths: input.claimedPaths,
      atomPaths: input.atomReferencedPaths,
    });
    if (verdict.included) {
      selected.push({
        filePath: relPath,
        relevanceSignal: verdict.outcome as RelevanceSignal,
        carrier: { absPath, relPath },
      });
    }
  }

  // 2. Apply the file-count cap (overflow -> ONE run-level skip Finding).
  const cap = applyFileCountCap(selected, fileCap);
  const findingInputs: FindingEmitInput[] = [];
  if (cap.overflowCount > 0) {
    findingInputs.push(
      buildOperationalArtifactCapSkipFinding({
        cap: cap.cap,
        overflowCount: cap.overflowCount,
        overflowSample: cap.overflowSample,
      }),
    );
  }

  // 3. Per-file summariser relay (concurrency + cache + soft-fail).
  const cache = new OperationalArtifactResponseCache();
  const cacheModel = readOperationalArtifactCacheModel();
  const concurrency = OPERATIONAL_ARTIFACT_CONCURRENCY > 0 ? OPERATIONAL_ARTIFACT_CONCURRENCY : 2;
  const failures: OperationalArtifactFailure[] = [];

  interface PerFile {
    finding: FindingEmitInput | null;
    failure: OperationalArtifactFailure | null;
  }

  const perFile = await promisePool<
    SelectedOperationalArtifact<OperationalArtifactCarrier>,
    PerFile
  >(cap.selected, concurrency, async (sel) => {
    const { absPath, relPath } = sel.carrier;
    const content = await readTruncatedContent(absPath);
    if (content === null) {
      return { finding: null, failure: { filePath: relPath, error: 'could not read file' } };
    }
    // Use a best-effort language label from the head/extension for the prompt.
    const ext = path.extname(relPath).replace(/^\./, '').toLowerCase();
    const prompt = composeOperationalArtifactPrompt({
      filePath: relPath,
      language: ext || 'unknown',
      relevanceSignal: sel.relevanceSignal,
      content,
    });

    // Content-addressed cache: a byte-identical prompt reuses the prior response
    // with NO relay/LLM call (reproducibility + cost). Key includes temperature 0.
    const cacheKey = cache.keyFor(prompt, cacheModel, OPERATIONAL_ARTIFACT_RELAY_TEMPERATURE);
    let rawContent: string;
    const cached = cache.get(cacheKey);
    if (cached) {
      rawContent = cached.content;
    } else {
      try {
        const response = await gatewayClient.summariseOperationalArtifact(prompt, relPath, runId);
        rawContent = response?.content ?? '';
        cache.set(cacheKey, { content: rawContent });
      } catch (err) {
        const message =
          err instanceof OperationalArtifactGatewayError
            ? err.message
            : err instanceof Error
              ? err.message
              : String(err);
        return { finding: null, failure: { filePath: relPath, error: message } };
      }
    }

    // Parse + validate; a malformed response is this file's soft-fail.
    let detail: OperationalArtifactDetail;
    let rawConfidence: unknown;
    try {
      const parsed = parseOperationalArtifactResponse(rawContent, relPath, sel.relevanceSignal);
      detail = parsed.detail;
      rawConfidence = parsed.rawConfidence;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { finding: null, failure: { filePath: relPath, error: message } };
    }

    const finding = buildOperationalArtifactFinding({
      detail,
      confidence: clampConfidence(rawConfidence),
    });
    return { finding, failure: null };
  });

  let filesSummarised = 0;
  for (const r of perFile) {
    if (r.failure) {
      failures.push(r.failure);
      continue;
    }
    if (r.finding) {
      findingInputs.push(r.finding);
      filesSummarised += 1;
    }
  }

  // Stage status: failed only when the failure RATE exceeds the guard (the run
  // still COMPLETES -- this governs stage status only). Denominator is the
  // number of files we actually attempted to summarise (the capped selection).
  const denominator = cap.selected.length;
  const failureRate = denominator > 0 ? failures.length / denominator : 0;
  const stageStatus: 'completed' | 'failed' =
    failureRate > OPERATIONAL_ARTIFACT_MAX_FAILURE_RATE ? 'failed' : 'completed';

  console.log(
    `[OperationalArtifactScan] done: runId=${runId}, selected=${cap.selected.length}, ` +
      `summarised=${filesSummarised}, failures=${failures.length}, failureRate=${failureRate.toFixed(3)}, ` +
      `overflow=${cap.overflowCount}, cacheHits=${cache.hitCount}, stageStatus=${stageStatus}, ` +
      `totalMs=${Date.now() - start}`,
  );

  return {
    findingInputs,
    stageStatus,
    failures,
    filesSelected: cap.selected.length,
    filesSummarised,
    filesFailed: failures.length,
    overflowCount: cap.overflowCount,
    cacheHits: cache.hitCount,
  };
}
