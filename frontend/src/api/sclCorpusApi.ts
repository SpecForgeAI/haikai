/**
 * SCL corpus API client (2026-08-18 SCL pipeline design, "UI placement"
 * ruling — the Structural Model tab: corpus browser + reachability report +
 * "explain this").
 *
 * Read/triage seam over the AMS SCL persistence endpoints, called DIRECTLY
 * (the vite catch-all proxies /api/model/... to AMS) with snake_case wire
 * types mirrored VERBATIM (no camelCase re-mapping — the tab is the only
 * consumer). NOTE the nested JSON payloads (`stats_json`, `body_json`,
 * `gloss_json`, `signals_json`) are OPAQUE to AMS and arrive exactly as the
 * discovery-service miner wrote them — i.e. mostly camelCase INSIDE the
 * snake_case envelope (see discovery-service/src/scl/sclTypes.ts).
 *
 *   GET   /api/model/projects/{p}/architectures/{a}/scl/scans/latest
 *   GET   .../scl/scans/{scanId}/contracts?kind=&min_fan_in=&q=&include_body=
 *   GET   .../scl/scans/{scanId}/contracts/{contractKey}
 *   GET   .../scl/scans/{scanId}/reachability
 *   PATCH .../scl/reachability/{itemId}            { disposition }
 *
 * The ONE gateway call ("explain this" needs the LLM):
 *
 *   POST /api/v1/projects/{p}/architectures/{a}/scl/explain
 *        { scan_id, contract_key } → { explanation }
 *
 * Error idiom mirrors `sclModernizationApi.ts`: non-2xx rejects with a
 * structured `SclCorpusApiError` carrying `status`; the MEANINGFUL 404 on
 * the latest-scan read resolves to `null` instead (never scanned).
 *
 * Reachability `signals_json` wire tolerance: the miner
 * (discovery-service/src/scl/sclScanRunner.ts) PUTs the item's signals as a
 * RAW string array (`signals_json: item.signals`), while the AMS DTO types
 * the field as a JSON object — so readers must tolerate BOTH a raw
 * `string[]` and an object `{signals: [...]}`. `normalizeSignals` below is
 * the single dual-tolerant reader (exported + unit-tested).
 */

const GATEWAY_BASE = import.meta.env.VITE_GATEWAY_BASE_URL ?? '';

// ============================================================================
// Wire types (snake_case envelope, verbatim)
// ============================================================================

/** Slice/assembly finding embedded in `stats_json.findings` (camelCase — the
 * miner's own shape, see discovery-service SclFinding). */
export interface SclStatsFinding {
  kind: string;
  symbol: string;
  detail: string;
  candidates?: string[];
}

/** Annotation-pass finding embedded in `stats_json.scl_annotation` (the
 * gateway pass writes snake_case keys here). */
export interface SclAnnotationFinding {
  kind: string;
  detail: string;
  contract_key?: string;
  symbol?: string | null;
}

/** `stats_json.scl_annotation` — present only after the annotation pass. */
export interface SclAnnotationSummary {
  annotated?: number;
  skipped_already_glossed?: number;
  rejected?: number;
  guard_rejections?: number;
  baseline_available?: boolean;
  contradictions?: SclAnnotationFinding[];
  findings?: SclAnnotationFinding[];
  completed_at?: string;
}

/** The scan's opaque stats payload: the miner's camelCase corpus stats plus
 * the annotation pass's snake_case `scl_annotation` block. */
export interface SclScanStats {
  rootCount?: number;
  externalRootCount?: number;
  internalRootCount?: number;
  contractCount?: number;
  reachableContractCount?: number;
  unreachableClassCount?: number;
  unresolvedCallCount?: number;
  findingCounts?: Record<string, number>;
  findings?: SclStatsFinding[];
  parseErrors?: unknown[];
  inlined?: number;
  scl_annotation?: SclAnnotationSummary | null;
}

export interface SclScan {
  id: string;
  project_id?: string;
  architecture_id?: string;
  status: string | null;
  stats_json: SclScanStats | null;
  created_at: string | null;
  updated_at?: string | null;
}

export type SclContractKind = 'behaviour_table' | 'shape' | 'boundary';

// --- body_json shapes (camelCase — discovery-service/src/scl/sclTypes.ts) ---

export interface SclSourceRef {
  path: string;
  line: number;
}

export type SclRowOutcome =
  | { type: 'terminal'; verbatim: string; ref: SclSourceRef; outcomeLabel: string }
  | { type: 'call'; targetKey: string | null; targetSymbol: string }
  | { type: 'absorb'; exceptionType: string; thenVerbatim: string; ref: SclSourceRef; outcomeLabel: string };

export interface SclBehaviourRow {
  index: number;
  kind: string;
  conditionVerbatim: string | null;
  conditionRef: SclSourceRef | null;
  outcome: SclRowOutcome;
  gloss?: string | null;
}

export interface SclBehaviourTableBody {
  symbol: string;
  sourcePath: string;
  startLine: number;
  signatureInputs: Array<{ name: string; typeRef: string }>;
  outcomeSignature: Array<{ label: string; kind: string; detail?: string | null }>;
  rows: SclBehaviourRow[];
  annotations: string[];
  references: string[];
}

export interface SclShapeField {
  name: string;
  kind: string;
  nullable: boolean | null;
  wireName: string | null;
  sourceCarrier: string | null;
  notes: string[];
}

export interface SclShapeBody {
  symbol: string;
  representation: string;
  fields: SclShapeField[];
  wireFacts: { xmlRootName: string | null; discriminator: string | null };
  flags: string[];
  references: string[];
}

export interface SclBoundaryOperation {
  name: string;
  sqlVerbatim: string | null;
  ref: SclSourceRef | null;
  resultShape: string | null;
}

export interface SclBoundaryBody {
  symbol: string;
  operations: SclBoundaryOperation[];
}

export type SclContractBody = SclBehaviourTableBody | SclShapeBody | SclBoundaryBody;

/** The annotation pass's gloss payload (snake_case keys — it writes the wire). */
export interface SclGloss {
  intent?: string;
  fragment_name?: string;
  row_glosses?: Record<string, string>;
  annotated_at?: string;
}

export interface SclContract {
  id?: string;
  contract_key: string;
  kind: SclContractKind;
  source_path: string | null;
  source_symbol: string | null;
  content_hash?: string | null;
  fan_in: number | null;
  roots_json: { roots?: string[]; total?: number; reachable?: boolean } | null;
  /** Null unless fetched with include_body=true / via getContract. */
  body_json: SclContractBody | null;
  gloss_json: SclGloss | null;
  created_at?: string | null;
}

export type SclReachabilityDisposition =
  | 'dead_code'
  | 'missed_entrypoint'
  | 'framework_invoked';

export interface SclReachabilityItem {
  id: string;
  scan_id?: string;
  source_path: string | null;
  symbol: string | null;
  /** Dual-shape (see header) — read via {@link normalizeSignals}. */
  signals_json: string[] | { signals?: string[] } | null;
  disposition: SclReachabilityDisposition | null;
  created_at?: string | null;
  updated_at?: string | null;
}

/**
 * Dual-tolerant `signals_json` reader: the miner PUTs a raw `string[]`; the
 * AMS DTO nominally carries an object, so a `{signals: [...]}` wrapper is
 * tolerated too. Anything else yields an empty list (never throws).
 */
export function normalizeSignals(
  signalsJson: SclReachabilityItem['signals_json'],
): string[] {
  if (Array.isArray(signalsJson)) {
    return signalsJson.filter((s): s is string => typeof s === 'string');
  }
  if (signalsJson && typeof signalsJson === 'object' && Array.isArray(signalsJson.signals)) {
    return signalsJson.signals.filter((s): s is string => typeof s === 'string');
  }
  return [];
}

// ============================================================================
// Errors
// ============================================================================

/** Structured API error carrying the HTTP status. */
export class SclCorpusApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'SclCorpusApiError';
    this.status = status;
  }
}

async function parseErrorMessage(res: Response, fallback: string): Promise<string> {
  let serverMessage = '';
  try {
    const errorBody = (await res.json()) as {
      message?: string;
      error?: string | { message?: string };
    };
    const nested =
      typeof errorBody.error === 'object' && errorBody.error
        ? errorBody.error.message
        : typeof errorBody.error === 'string'
          ? errorBody.error
          : '';
    serverMessage = errorBody.message || nested || '';
  } catch {
    // ignore JSON parse failure
  }
  return serverMessage || fallback;
}

async function rejectWith(res: Response, fallback: string): Promise<never> {
  const msg = await parseErrorMessage(res, `${fallback}: ${res.status} ${res.statusText}`);
  throw new SclCorpusApiError(msg, res.status);
}

// ============================================================================
// URL builders
// ============================================================================

/** AMS-direct base (vite catch-all → AMS:8080). */
function amsSclBase(projectId: string, architectureId: string): string {
  return (
    `/api/model/projects/${encodeURIComponent(projectId)}` +
    `/architectures/${encodeURIComponent(architectureId)}/scl`
  );
}

/** Gateway base (the explain route needs the LLM). */
function gatewaySclBase(projectId: string, architectureId: string): string {
  return (
    `${GATEWAY_BASE}/api/v1/projects/${encodeURIComponent(projectId)}` +
    `/architectures/${encodeURIComponent(architectureId)}/scl`
  );
}

// ============================================================================
// API functions
// ============================================================================

/**
 * The latest SCL scan for the architecture, or `null` when the pair has never
 * been scanned (the AMS 404 is a MEANINGFUL "no structural scan yet" state).
 */
export async function getLatestScan(
  projectId: string,
  architectureId: string,
): Promise<SclScan | null> {
  const res = await fetch(`${amsSclBase(projectId, architectureId)}/scans/latest`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (res.status === 404) return null;
  if (!res.ok) return rejectWith(res, 'Failed to load the latest SCL scan');
  return (await res.json()) as SclScan;
}

export interface ListContractsOptions {
  kind?: SclContractKind;
  q?: string;
  minFanIn?: number;
  includeBody?: boolean;
}

/** Filtered contract listing — bodies stripped unless `includeBody`. */
export async function listContracts(
  projectId: string,
  architectureId: string,
  scanId: string,
  options: ListContractsOptions = {},
): Promise<SclContract[]> {
  const params = new URLSearchParams();
  if (options.kind) params.set('kind', options.kind);
  if (options.q) params.set('q', options.q);
  if (options.minFanIn !== undefined) params.set('min_fan_in', String(options.minFanIn));
  if (options.includeBody !== undefined) params.set('include_body', String(options.includeBody));
  const query = params.toString();
  const url =
    `${amsSclBase(projectId, architectureId)}/scans/${encodeURIComponent(scanId)}/contracts` +
    (query ? `?${query}` : '');
  const res = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
  if (!res.ok) return rejectWith(res, 'Failed to list SCL contracts');
  const rows = (await res.json()) as SclContract[];
  return Array.isArray(rows) ? rows : [];
}

/** One contract with its FULL body. */
export async function getContract(
  projectId: string,
  architectureId: string,
  scanId: string,
  contractKey: string,
): Promise<SclContract> {
  const url =
    `${amsSclBase(projectId, architectureId)}/scans/${encodeURIComponent(scanId)}` +
    `/contracts/${encodeURIComponent(contractKey)}`;
  const res = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
  if (!res.ok) return rejectWith(res, `Failed to load SCL contract ${contractKey}`);
  return (await res.json()) as SclContract;
}

/** The scan's reachability worklist (diagnostic-only, v1). */
export async function listReachability(
  projectId: string,
  architectureId: string,
  scanId: string,
): Promise<SclReachabilityItem[]> {
  const url =
    `${amsSclBase(projectId, architectureId)}/scans/${encodeURIComponent(scanId)}/reachability`;
  const res = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
  if (!res.ok) return rejectWith(res, 'Failed to load the SCL reachability report');
  const rows = (await res.json()) as SclReachabilityItem[];
  return Array.isArray(rows) ? rows : [];
}

/** Set (or clear, via null) the triage verdict on one reachability item. */
export async function patchReachabilityDisposition(
  projectId: string,
  architectureId: string,
  itemId: string,
  disposition: SclReachabilityDisposition | null,
): Promise<SclReachabilityItem> {
  const url = `${amsSclBase(projectId, architectureId)}/reachability/${encodeURIComponent(itemId)}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ disposition }),
  });
  if (!res.ok) return rejectWith(res, 'Failed to update the reachability disposition');
  return (await res.json()) as SclReachabilityItem;
}

/** Plain-English LLM explanation of one contract (gateway route — the LLM
 * lives behind the gateway). Never persisted. */
export async function explainContract(
  projectId: string,
  architectureId: string,
  scanId: string,
  contractKey: string,
): Promise<string> {
  const res = await fetch(`${gatewaySclBase(projectId, architectureId)}/explain`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ scan_id: scanId, contract_key: contractKey }),
  });
  if (!res.ok) return rejectWith(res, 'Failed to explain the contract');
  const raw = (await res.json()) as { explanation?: string };
  return typeof raw.explanation === 'string' ? raw.explanation : '';
}
