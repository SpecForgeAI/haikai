/**
 * SCL scan runner — drives one full scan against the AMS SCL persistence
 * endpoints (Spec 1: `/api/model/projects/{p}/architectures/{a}/scl`):
 *
 *   POST /scans                          → create the scan row (201)
 *   POST /scans/{id}/contracts/bulk      → contract batches (default 200)
 *   PUT  /scans/{id}/reachability        → replace the reachability report
 *   PATCH /scans/{id}                    → completed (stats) / failed (error)
 *
 * Lifecycle: create → sliceProject → assembleCorpus → bulk contracts →
 * reachability → completed PATCH. On ANY failure a best-effort failed PATCH
 * is sent and the error rethrown — the scan row is never left silently
 * `in_progress` by a crash we observed.
 *
 * All HTTP goes through an injectable `deps.http`; the default is a global
 * `fetch` wrapper mimicking `services/archModelClient`'s error style (status
 * + 500-char body snippet logged, error rethrown with the same message).
 *
 * Design doc: agent-os/planning/2026-08-18-scl-pipeline-design.md ("Corpus").
 */

import { sliceProject, type SclSliceResult } from './slicer';
import { assembleCorpus, type SclCorpus } from './corpusAssembler';

/** Contracts per bulk-upsert batch (AMS POST .../contracts/bulk). */
export const DEFAULT_CONTRACT_BATCH_SIZE = 200;

export interface SclHttpRequest {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH';
  url: string;
  body?: unknown;
}

/** Injectable HTTP seam — tests record calls; the default wraps global fetch. */
export type SclHttp = (request: SclHttpRequest) => Promise<unknown>;

export interface RunSclScanArgs {
  projectId: string;
  architectureId: string;
  sourceDir: string;
  amsBaseUrl: string;
  /** Reuse an already-created scan row (the route creates one up-front so it
   *  can answer 202 with the scan id before the slice starts). */
  scanId?: string;
}

export interface RunSclScanDeps {
  http?: SclHttp;
  /** Contracts per bulk batch; default {@link DEFAULT_CONTRACT_BATCH_SIZE}. */
  batchSize?: number;
  /** Slice seam (tests inject a precomputed slice); default `sliceProject`. */
  slice?: (sourceDir: string) => Promise<SclSliceResult>;
}

export interface RunSclScanResult {
  scanId: string;
  corpus: SclCorpus;
}

/**
 * Default HTTP implementation over global fetch, mimicking the
 * archModelClient error idiom: non-2xx logs `METHOD url returned STATUS:
 * <500-char body snippet>` and throws with the same message.
 */
export const defaultSclHttp: SclHttp = async ({ method, url, body }) => {
  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  if (!response.ok) {
    const snippet = text.substring(0, 500);
    const message = `[sclScanRunner] ${method} ${url} returned ${response.status}: ${snippet}`;
    console.error(message);
    throw new Error(message);
  }
  return text ? JSON.parse(text) : null;
};

function sclBase(args: { amsBaseUrl: string; projectId: string; architectureId: string }): string {
  return (
    `${args.amsBaseUrl}/api/model/projects/${encodeURIComponent(args.projectId)}` +
    `/architectures/${encodeURIComponent(args.architectureId)}/scl`
  );
}

/**
 * Creates the AMS scan row (POST /scans, 201 → snake_case SclScanDto) and
 * returns its id. Exported for the route, which answers 202 with the scan id
 * before firing the rest of the pipeline.
 */
export async function createSclScan(
  args: { projectId: string; architectureId: string; amsBaseUrl: string },
  http: SclHttp = defaultSclHttp
): Promise<string> {
  const created = (await http({ method: 'POST', url: `${sclBase(args)}/scans` })) as {
    id?: string;
  } | null;
  if (!created || typeof created.id !== 'string' || created.id.length === 0) {
    throw new Error('[sclScanRunner] AMS scan create returned no id');
  }
  return created.id;
}

/**
 * Runs one full SCL scan. Creates the scan row unless `args.scanId` is
 * given, slices + assembles, persists contracts in batches, replaces the
 * reachability report, and PATCHes the scan `completed` with the corpus
 * stats. On ANY failure: best-effort `failed` PATCH, then rethrow.
 */
export async function runSclScan(args: RunSclScanArgs, deps?: RunSclScanDeps): Promise<RunSclScanResult> {
  const http = deps?.http ?? defaultSclHttp;
  const batchSize = deps?.batchSize ?? DEFAULT_CONTRACT_BATCH_SIZE;
  const slice = deps?.slice ?? sliceProject;
  const base = sclBase(args);

  const scanId = args.scanId ?? (await createSclScan(args, http));
  console.log(
    `[scl-scan] scan ${scanId} started (project ${args.projectId}, architecture ${args.architectureId}, source ${args.sourceDir})`
  );

  try {
    const sliced = await slice(args.sourceDir);
    console.log(
      `[scl-scan] scan ${scanId} sliced: ${sliced.stats.tableCount} tables, ` +
        `${sliced.stats.shapeCount} shapes, ${sliced.stats.boundaryCount} boundaries, ` +
        `${sliced.parseErrors.length} parse errors`
    );

    const corpus = assembleCorpus(sliced);
    console.log(
      `[scl-scan] scan ${scanId} assembled: ${corpus.stats.rootCount} roots ` +
        `(${corpus.stats.externalRootCount} external / ${corpus.stats.internalRootCount} internal), ` +
        `${corpus.stats.contractCount} contracts (${corpus.stats.reachableContractCount} reachable), ` +
        `${corpus.reachability.length} classes outside the closure`
    );

    // Bulk-upsert contracts in batches.
    for (let offset = 0; offset < corpus.contracts.length; offset += batchSize) {
      const batch = corpus.contracts.slice(offset, offset + batchSize);
      const payload = {
        contracts: batch.map((c) => ({
          contract_key: c.contractKey,
          kind: c.kind,
          source_path: c.sourcePath,
          source_symbol: c.sourceSymbol,
          content_hash: c.contentHash,
          fan_in: c.rootFanIn,
          roots_json: { roots: c.roots, total: c.rootFanIn, reachable: c.reachable },
          body_json: c.contract,
        })),
      };
      const result = (await http({
        method: 'POST',
        url: `${base}/scans/${encodeURIComponent(scanId)}/contracts/bulk`,
        body: payload,
      })) as { upserted?: number } | null;
      console.log(
        `[scl-scan] scan ${scanId} contracts batch ${Math.floor(offset / batchSize) + 1}: ` +
          `${batch.length} sent, ${result?.upserted ?? '?'} upserted`
      );
    }

    // Replace the reachability report.
    const reachabilityResult = (await http({
      method: 'PUT',
      url: `${base}/scans/${encodeURIComponent(scanId)}/reachability`,
      body: {
        items: corpus.reachability.map((item) => ({
          source_path: item.sourcePath,
          symbol: item.symbol,
          signals_json: item.signals,
        })),
      },
    })) as { replaced?: number } | null;
    console.log(
      `[scl-scan] scan ${scanId} reachability: ${corpus.reachability.length} sent, ` +
        `${reachabilityResult?.replaced ?? '?'} replaced`
    );

    await http({
      method: 'PATCH',
      url: `${base}/scans/${encodeURIComponent(scanId)}`,
      body: {
        status: 'completed',
        stats_json: {
          ...corpus.stats,
          findings: JSON.parse(JSON.stringify(corpus.findings)),
          parseErrors: sliced.parseErrors,
          inlined: sliced.inlined.length,
        },
      },
    });
    console.log(`[scl-scan] scan ${scanId} completed`);
    return { scanId, corpus };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[scl-scan] scan ${scanId} FAILED: ${message}`);
    try {
      await http({
        method: 'PATCH',
        url: `${base}/scans/${encodeURIComponent(scanId)}`,
        body: { status: 'failed', stats_json: { error: message } },
      });
    } catch (patchError) {
      // Best-effort only — never mask the original failure.
      console.error(
        `[scl-scan] scan ${scanId} failed-status PATCH also failed: ` +
          (patchError instanceof Error ? patchError.message : String(patchError))
      );
    }
    throw error;
  }
}
