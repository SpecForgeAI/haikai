/**
 * SCL annotation pass (SCL pipeline spec 4 of 10, 2026-08-18 design:
 * agent-os/planning/2026-08-18-scl-pipeline-design.md, "Extraction pipeline"
 * stage 2 — LLM interpretation, grounded + guarded).
 *
 * The LLM PROPOSES AND ANNOTATES, NEVER CONCLUDES: for each un-glossed SCL
 * contract (behaviour table / shape) the pass asks the LLM for a business-
 * intent paragraph, per-row glosses (tables only), and a human fragment name —
 * then DETERMINISTIC guards run after the parse:
 *
 *   (a) strict-JSON parse + shape validation (one retry, then an
 *       `annotation_failed` finding — never a silent skip);
 *   (b) VERBATIM-SUBSTRING guard: every backtick-quoted fragment in the
 *       intent / glosses must be an exact substring of the contract body JSON
 *       string. A violating GLOSS is dropped (recorded
 *       `gloss_rejected_hallucination`); a violating INTENT rejects the whole
 *       annotation;
 *   (c) row-gloss indexes must exist in the table's rows.
 *
 * Then a CONTRADICTION PASS (deterministic, no LLM) cross-checks each
 * http-rooted behaviour table against the captured API-behaviour baseline —
 * capture's post-doctrine role (2026-08-18): reconcile oracle + wire-form
 * facts + THIS cross-check. Mismatches become `capture_contradiction`
 * findings, merged into the scan's stats_json.
 *
 * LLM calls go through the house client (`getLlmClient().sendChatRequest`,
 * jsonMode) exactly like the DB gap-proposal flow — its shared rate-limit
 * cool-down (services/llmRateLimit.ts) does the pacing; this pass only bounds
 * concurrency (2) and stays sequential within a worker.
 */

import { getConfig } from '../config';
import { logger } from './logger';
import {
  ApiBehaviourBaseline,
  ApiBehaviourBaselineItemWire,
  fetchActiveCurrentBaseline,
  fetchBaselineItems,
} from './migrationDriverAmsReads';

// ============================================================================
// Wire types (subset of the AMS SCL DTOs this pass reads — snake_case wire)
// ============================================================================

/** AMS `scl_scans` row (subset). */
export interface SclScanWire {
  id?: string;
  status?: string | null;
  stats_json?: Record<string, unknown> | null;
}

/** The contract body the slicer persisted (tolerantly typed — the pass only
 * reads `annotations` and `rows` structurally; everything else rides opaque). */
export interface SclContractBody {
  annotations?: unknown[] | null;
  rows?: unknown[] | null;
  [key: string]: unknown;
}

/** AMS `scl_contracts` row (subset, include_body=true). */
export interface SclContractWire {
  contract_key?: string;
  kind?: string | null;
  source_path?: string | null;
  source_symbol?: string | null;
  fan_in?: number | null;
  roots_json?: { roots?: unknown[] } | null;
  body_json?: SclContractBody | null;
  gloss_json?: Record<string, unknown> | null;
}

// ============================================================================
// Findings + summary
// ============================================================================

export type SclAnnotationFindingKind =
  | 'annotation_failed'
  | 'gloss_rejected_hallucination'
  | 'gloss_rejected_invalid_index'
  | 'capture_contradiction';

export interface SclAnnotationFinding {
  kind: SclAnnotationFindingKind;
  detail: string;
  contract_key?: string;
  /** The mined source symbol (contradiction findings name the method). */
  symbol?: string | null;
}

export interface SclAnnotationSummary {
  scan_id: string;
  annotated: number;
  skipped_already_glossed: number;
  /** Whole annotations rejected (parse/LLM failure or hallucinated intent). */
  rejected: number;
  /** Individual glosses dropped by the verbatim / index guards. */
  guard_rejections: number;
  baseline_available: boolean;
  contradictions: SclAnnotationFinding[];
  /** Run-level non-contradiction findings (annotation_failed, rejected intents). */
  findings: SclAnnotationFinding[];
  completed_at: string;
}

// ============================================================================
// Deterministic helpers
// ============================================================================

/** Deterministic JSON: sorted object keys, no whitespace. This exact string is
 * both the prompt body AND the verbatim-substring guard reference. */
export function stableStringify(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`).join(',')}}`;
}

/** All backtick-quoted fragments in an LLM-written text. */
function backtickFragments(text: string): string[] {
  return [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ============================================================================
// Prompts
// ============================================================================

const SYSTEM_PROMPT =
  'You annotate STRUCTURAL CONTRACT LANGUAGE (SCL) contracts mined from legacy ' +
  'source code. You may ONLY describe what the contract body shows — never ' +
  'invent behaviour, fields, callers, or code that is not in the body. Every ' +
  'quoted code fragment MUST be copied verbatim from the body (quote code in ' +
  'backticks). Respond in strict JSON.';

function buildUserPrompt(contract: SclContractWire, bodyString: string, isTable: boolean): string {
  const rowGlossPart = isTable
    ? '"rowGlosses": [{"index": <row index number>, "gloss": "<=25 words plain-language gloss of that row"}], '
    : '';
  return (
    `Contract ${contract.contract_key ?? '?'} (kind=${contract.kind ?? '?'}) mined from ` +
    `${contract.source_path ?? '?'} :: ${contract.source_symbol ?? '?'}.\n\n` +
    `Body (deterministic JSON):\n${bodyString}\n\n` +
    'Respond with JSON exactly of the form: {"intent": "<=60 words business-intent ' +
    `paragraph", ${rowGlossPart}"fragmentName": "<=5 words human name"}. ` +
    'Any code you quote MUST appear verbatim in the body above, wrapped in backticks.'
  );
}

// ============================================================================
// LLM response parsing + shape validation
// ============================================================================

interface ParsedAnnotation {
  intent: string;
  fragmentName: string;
  rowGlosses: Array<{ index: number; gloss: string }>;
}

function extractJsonObject(content: string): Record<string, unknown> {
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('LLM response contained no JSON object');
  return JSON.parse(content.slice(start, end + 1)) as Record<string, unknown>;
}

/** Parse + shape-validate one annotation response (guard (a)). Throws on any
 * violation so the caller's single-retry loop can engage. */
function parseAnnotation(content: string): ParsedAnnotation {
  const raw = extractJsonObject(content);
  if (typeof raw.intent !== 'string' || raw.intent.trim().length === 0) {
    throw new Error('annotation missing "intent" string');
  }
  if (typeof raw.fragmentName !== 'string' || raw.fragmentName.trim().length === 0) {
    throw new Error('annotation missing "fragmentName" string');
  }
  const rowGlosses: Array<{ index: number; gloss: string }> = [];
  if (raw.rowGlosses !== undefined && raw.rowGlosses !== null) {
    if (!Array.isArray(raw.rowGlosses)) throw new Error('"rowGlosses" is not an array');
    for (const item of raw.rowGlosses) {
      const g = item as Record<string, unknown>;
      if (typeof g?.index !== 'number' || typeof g?.gloss !== 'string') {
        throw new Error('rowGloss entries must be {index: number, gloss: string}');
      }
      rowGlosses.push({ index: g.index, gloss: g.gloss });
    }
  }
  return { intent: raw.intent, fragmentName: raw.fragmentName, rowGlosses };
}

// ============================================================================
// Contradiction pass helpers (deterministic — no LLM)
// ============================================================================

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] as const;

function annotationText(body: SclContractBody | null | undefined): string {
  const anns = Array.isArray(body?.annotations) ? body.annotations : [];
  return anns.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join('\n');
}

/** The HTTP method an http-rooted table's own annotations declare, or null
 * (null ⇒ not http-rooted for this pass). Covers JAX-RS (@GET), Spring
 * @RequestMapping(method=RequestMethod.GET) and @GetMapping idioms. */
export function deriveHttpMethod(body: SclContractBody | null | undefined): string | null {
  const text = annotationText(body);
  const jaxRs = text.match(/@(GET|POST|PUT|DELETE|PATCH)\b/);
  if (jaxRs) return jaxRs[1];
  const requestMethod = text.match(/RequestMethod\.(GET|POST|PUT|DELETE|PATCH)\b/);
  if (requestMethod) return requestMethod[1];
  const mapping = text.match(/@(Get|Post|Put|Delete|Patch)Mapping\b/);
  if (mapping) return mapping[1].toUpperCase();
  return null;
}

/** Best-effort path fragment from the METHOD-LEVEL annotations (@Path /
 * @RequestMapping-family value). When the body cannot resolve a full path the
 * method-level fragment alone is used — per design, best-effort. */
export function derivePathFragment(body: SclContractBody | null | undefined): string | null {
  const text = annotationText(body);
  const m = text.match(
    /@(?:Path|RequestMapping|GetMapping|PostMapping|PutMapping|DeleteMapping|PatchMapping)\s*\(\s*(?:value\s*=\s*)?"([^"]+)"/
  );
  return m ? m[1] : null;
}

/** "Captured path CONTAINS the fragment", template-aware: `{param}` segments in
 * the mined fragment match any concrete path segment. Unanchored. */
export function pathContainsFragment(fragment: string, capturedPath: string): boolean {
  const pattern = fragment
    .split(/\{[^}]*\}/)
    .map(escapeRegExp)
    .join('[^/]+');
  return new RegExp(pattern).test(capturedPath);
}

/** Does any row of the table declare a failure outcome (`throws:` / absorb)? */
export function hasFailureOutcome(body: SclContractBody | null | undefined): boolean {
  const rows = Array.isArray(body?.rows) ? body.rows : [];
  return rows.some((row) => {
    const text = typeof row === 'string' ? row : JSON.stringify(row);
    return /throws:|absorb/.test(text);
  });
}

// ============================================================================
// Dependency seam (production defaults below; tests inject full mocks)
// ============================================================================

export interface SclAnnotationDeps {
  /** GET the scan: by id when given, else /scans/latest. Null when none. */
  fetchScan: (
    projectId: string,
    architectureId: string,
    scanId?: string
  ) => Promise<SclScanWire | null>;
  /** GET /scans/{scanId}/contracts?kind=...&include_body=true */
  fetchContracts: (
    projectId: string,
    architectureId: string,
    scanId: string,
    kind: string
  ) => Promise<SclContractWire[]>;
  /** PATCH /scans/{scanId}/contracts/{contractKey}/gloss {gloss_json} */
  patchGloss: (
    projectId: string,
    architectureId: string,
    scanId: string,
    contractKey: string,
    glossJson: Record<string, unknown>
  ) => Promise<void>;
  /** PATCH /scans/{scanId} {stats_json} (caller merges — spread the read). */
  patchScan: (
    projectId: string,
    architectureId: string,
    scanId: string,
    statsJson: Record<string, unknown>
  ) => Promise<void>;
  /** The LLM chat seam (house client; jsonMode + shared rate-limit pacing). */
  llm: (args: {
    systemPrompt: string;
    userPrompt: string;
    requestTag: string;
  }) => Promise<{ content: string }>;
  fetchBaseline: (
    projectId: string,
    architectureId: string
  ) => Promise<ApiBehaviourBaseline | null>;
  fetchBaselineItems: (
    projectId: string,
    baselineId: string
  ) => Promise<ApiBehaviourBaselineItemWire[]>;
}

function sclBase(projectId: string, architectureId: string): string {
  return (
    `${getConfig().architectureModelServiceBaseUrl}/api/model/projects/` +
    `${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/scl`
  );
}

async function amsGetJsonOrNull<T>(url: string, label: string): Promise<T | null> {
  const response = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`AMS ${label} failed: HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

async function amsPatchJson(url: string, body: unknown, label: string): Promise<void> {
  const response = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`AMS ${label} failed: HTTP ${response.status}`);
  }
}

/** Default LLM caller — modelled EXACTLY on the DB gap-proposal flow's
 * `defaultCallLlm` (routes/dbGapProposals.ts): lazy require keeps tests
 * cleanly mockable, jsonMode forces strict-JSON responses, and the client's
 * own 429 machinery (llmRateLimit.ts shared cool-down) does the pacing. */
const defaultLlm: SclAnnotationDeps['llm'] = async ({ systemPrompt, userPrompt, requestTag }) => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getLlmClient } = require('./llmClient');
  const client = getLlmClient();
  const response = await client.sendChatRequest(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    `scl-annotation-${Date.now()}`,
    requestTag,
    { jsonMode: true }
  );
  return { content: response.content ?? '' };
};

const defaultDeps: SclAnnotationDeps = {
  fetchScan: (projectId, architectureId, scanId) =>
    amsGetJsonOrNull<SclScanWire>(
      scanId
        ? `${sclBase(projectId, architectureId)}/scans/${encodeURIComponent(scanId)}`
        : `${sclBase(projectId, architectureId)}/scans/latest`,
      'fetch_scl_scan'
    ),
  fetchContracts: async (projectId, architectureId, scanId, kind) => {
    const url =
      `${sclBase(projectId, architectureId)}/scans/${encodeURIComponent(scanId)}/contracts` +
      `?kind=${encodeURIComponent(kind)}&include_body=true`;
    const rows = await amsGetJsonOrNull<SclContractWire[]>(url, 'fetch_scl_contracts');
    return Array.isArray(rows) ? rows : [];
  },
  patchGloss: (projectId, architectureId, scanId, contractKey, glossJson) =>
    amsPatchJson(
      `${sclBase(projectId, architectureId)}/scans/${encodeURIComponent(scanId)}` +
        `/contracts/${encodeURIComponent(contractKey)}/gloss`,
      { gloss_json: glossJson },
      'patch_scl_gloss'
    ),
  patchScan: (projectId, architectureId, scanId, statsJson) =>
    amsPatchJson(
      `${sclBase(projectId, architectureId)}/scans/${encodeURIComponent(scanId)}`,
      { stats_json: statsJson },
      'patch_scl_scan'
    ),
  llm: defaultLlm,
  fetchBaseline: fetchActiveCurrentBaseline,
  fetchBaselineItems,
};

// ============================================================================
// Per-contract annotation (LLM + guards)
// ============================================================================

interface ContractAnnotationOutcome {
  /** null ⇒ rejected (no gloss patch); findings explain why. */
  glossJson: Record<string, unknown> | null;
  /** Run-level findings (annotation_failed / rejected-intent). */
  runFindings: SclAnnotationFinding[];
  /** Individual glosses dropped by guards (counted, also embedded in gloss). */
  guardRejections: number;
}

async function annotateContract(
  contract: SclContractWire,
  llm: SclAnnotationDeps['llm'],
  requestTag: string
): Promise<ContractAnnotationOutcome> {
  const contractKey = contract.contract_key ?? '?';
  const isTable = contract.kind === 'behaviour_table';
  const bodyString = stableStringify(contract.body_json ?? {});
  const userPrompt = buildUserPrompt(contract, bodyString, isTable);

  // Guard (a): parse + shape-validate; ONE retry; then annotation_failed.
  let parsed: ParsedAnnotation | null = null;
  let lastError = '';
  for (let attempt = 1; attempt <= 2 && !parsed; attempt++) {
    try {
      const { content } = await llm({ systemPrompt: SYSTEM_PROMPT, userPrompt, requestTag });
      parsed = parseAnnotation(content);
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'Unknown error';
      logger.warn('[diag-gateway] scl_annotation contract attempt failed', {
        contractKey,
        attempt,
        error: lastError,
      });
    }
  }
  if (!parsed) {
    return {
      glossJson: null,
      runFindings: [
        { kind: 'annotation_failed', detail: lastError, contract_key: contractKey },
      ],
      guardRejections: 0,
    };
  }

  const guardFindings: SclAnnotationFinding[] = [];
  let guardRejections = 0;

  // Guard (b) on the INTENT: a hallucinated quote rejects the whole annotation.
  for (const fragment of backtickFragments(parsed.intent)) {
    if (!bodyString.includes(fragment)) {
      return {
        glossJson: null,
        runFindings: [
          {
            kind: 'gloss_rejected_hallucination',
            detail: fragment,
            contract_key: contractKey,
          },
        ],
        guardRejections: 0,
      };
    }
  }

  // Guards (b) + (c) on the row glosses: violating GLOSSES are dropped.
  const rows = Array.isArray(contract.body_json?.rows) ? contract.body_json.rows : [];
  const rowGlosses: Record<string, string> = {};
  for (const rowGloss of isTable ? parsed.rowGlosses : []) {
    if (!Number.isInteger(rowGloss.index) || rowGloss.index < 0 || rowGloss.index >= rows.length) {
      guardFindings.push({
        kind: 'gloss_rejected_invalid_index',
        detail: `row index ${rowGloss.index} does not exist`,
        contract_key: contractKey,
      });
      guardRejections++;
      continue;
    }
    const hallucinated = backtickFragments(rowGloss.gloss).find((f) => !bodyString.includes(f));
    if (hallucinated !== undefined) {
      guardFindings.push({
        kind: 'gloss_rejected_hallucination',
        detail: hallucinated,
        contract_key: contractKey,
      });
      guardRejections++;
      continue;
    }
    rowGlosses[String(rowGloss.index)] = rowGloss.gloss;
  }

  return {
    glossJson: {
      intent: parsed.intent,
      fragment_name: parsed.fragmentName,
      row_glosses: rowGlosses,
      annotated_at: new Date().toISOString(),
      guard_findings: guardFindings,
    },
    runFindings: guardFindings,
    guardRejections,
  };
}

// ============================================================================
// Contradiction pass (deterministic)
// ============================================================================

export function contradictionsForTables(
  tables: SclContractWire[],
  items: ApiBehaviourBaselineItemWire[]
): SclAnnotationFinding[] {
  const findings: SclAnnotationFinding[] = [];
  for (const table of tables) {
    const method = deriveHttpMethod(table.body_json);
    if (!method) continue; // not http-rooted — this pass only judges externals
    const fragment = derivePathFragment(table.body_json);
    if (!fragment) continue; // no path evidence to match on — best-effort skip
    const matching = items.filter(
      (item) =>
        (item.method ?? '').toUpperCase() === method &&
        typeof item.path === 'string' &&
        pathContainsFragment(fragment, item.path)
    );
    const statuses = matching
      .map((item) => item.response_status)
      .filter((s): s is number => typeof s === 'number');
    if (statuses.length === 0) continue;
    const failureMined = hasFailureOutcome(table.body_json);
    if (!failureMined && statuses.some((s) => s >= 500)) {
      findings.push({
        kind: 'capture_contradiction',
        detail: 'capture shows 5xx but mined behaviour has no failure outcome',
        contract_key: table.contract_key,
        symbol: table.source_symbol ?? null,
      });
    } else if (failureMined && matching.length >= 3 && statuses.every((s) => s < 300)) {
      findings.push({
        kind: 'capture_contradiction',
        detail: 'mined failure outcomes never observed in capture',
        contract_key: table.contract_key,
        symbol: table.source_symbol ?? null,
      });
    }
  }
  return findings;
}

// ============================================================================
// The pass
// ============================================================================

export interface SclAnnotationArgs {
  projectId: string;
  architectureId: string;
  scanId?: string;
  /** true ⇒ re-annotate already-glossed contracts (default: skip them). */
  regenerate?: boolean;
}

/** Small worker-pool: `limit` workers pull sequentially from the list. The
 * reused LLM client's shared rate-limit cool-down does the real pacing. */
async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await worker(item);
    }
  });
  await Promise.all(lanes);
}

export async function runSclAnnotationPass(
  args: SclAnnotationArgs,
  deps?: Partial<SclAnnotationDeps>
): Promise<SclAnnotationSummary> {
  const d: SclAnnotationDeps = { ...defaultDeps, ...deps };
  const { projectId, architectureId } = args;
  const requestTag = `scl-annotation-${projectId}`;

  try {
    // 1. Resolve the scan (explicit id or latest). Annotate whatever exists.
    const scan = await d.fetchScan(projectId, architectureId, args.scanId);
    if (!scan?.id) {
      throw new Error('no SCL scan exists to annotate — run the slicer first');
    }
    const scanId = scan.id;
    logger.info('[diag-gateway] scl_annotation start', {
      projectId,
      architectureId,
      scanId,
      regenerate: args.regenerate === true,
    });

    // 2. Behaviour tables + shapes, with bodies; skip already-glossed unless
    //    regenerate — idempotent re-runs.
    const [tables, shapes] = [
      await d.fetchContracts(projectId, architectureId, scanId, 'behaviour_table'),
      await d.fetchContracts(projectId, architectureId, scanId, 'shape'),
    ];
    const contracts = [...tables, ...shapes];
    const pending = contracts.filter(
      (c) => args.regenerate === true || c.gloss_json === null || c.gloss_json === undefined
    );
    const skippedAlreadyGlossed = contracts.length - pending.length;

    // 3. LLM annotation — one contract per call, concurrency 2.
    let annotated = 0;
    let rejected = 0;
    let guardRejections = 0;
    const runFindings: SclAnnotationFinding[] = [];
    await runWithConcurrency(pending, 2, async (contract) => {
      const contractKey = contract.contract_key ?? '?';
      try {
        const outcome = await annotateContract(contract, d.llm, requestTag);
        guardRejections += outcome.guardRejections;
        runFindings.push(...outcome.runFindings);
        if (outcome.glossJson === null) {
          rejected++;
          return;
        }
        await d.patchGloss(projectId, architectureId, scanId, contractKey, outcome.glossJson);
        annotated++;
      } catch (error) {
        // Failure isolation: one contract's terminal failure never stops the run.
        rejected++;
        runFindings.push({
          kind: 'annotation_failed',
          detail: error instanceof Error ? error.message : 'Unknown error',
          contract_key: contractKey,
        });
        logger.warn('[diag-gateway] scl_annotation contract failed terminally', {
          contractKey,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    });

    // 4. Contradiction pass vs the captured baseline (deterministic, no LLM).
    let baselineAvailable = false;
    let contradictions: SclAnnotationFinding[] = [];
    const baseline = await d.fetchBaseline(projectId, architectureId);
    if (baseline?.id) {
      baselineAvailable = true;
      const items = await d.fetchBaselineItems(projectId, baseline.id);
      contradictions = contradictionsForTables(tables, items);
    }

    // 5. Merge the annotation summary INTO the scan's existing stats_json.
    const completedAt = new Date().toISOString();
    const summary: SclAnnotationSummary = {
      scan_id: scanId,
      annotated,
      skipped_already_glossed: skippedAlreadyGlossed,
      rejected,
      guard_rejections: guardRejections,
      baseline_available: baselineAvailable,
      contradictions,
      findings: runFindings,
      completed_at: completedAt,
    };
    const mergedStats: Record<string, unknown> = {
      ...(scan.stats_json ?? {}),
      scl_annotation: {
        annotated,
        skipped_already_glossed: skippedAlreadyGlossed,
        rejected,
        guard_rejections: guardRejections,
        baseline_available: baselineAvailable,
        contradictions,
        findings: runFindings,
        completed_at: completedAt,
      },
    };
    await d.patchScan(projectId, architectureId, scanId, mergedStats);

    logger.info('[diag-gateway] scl_annotation complete', {
      projectId,
      architectureId,
      scanId,
      annotated,
      skippedAlreadyGlossed,
      rejected,
      guardRejections,
      contradictions: contradictions.length,
      baselineAvailable,
    });
    return summary;
  } catch (error) {
    logger.error('[diag-gateway] scl_annotation failed', {
      projectId,
      architectureId,
      scanId: args.scanId ?? null,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
  }
}
