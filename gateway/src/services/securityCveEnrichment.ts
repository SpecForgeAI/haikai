/**
 * Security CVE Enrichment (Security health dashboard, 2026-07-19, Spec 2 of 3)
 *
 * Fills the AMS `cves` world-fact records from OSV (api.osv.dev), driven by
 * the pending-stub queue that ingestion creates. STRICTLY NON-BLOCKING by
 * design: ingest never waits on this, every failure is per-CVE and recorded
 * (`not_found` / left `pending` for retry), and the whole runner is behind the
 * SECURITY_CVE_ENRICHMENT_ENABLED kill-switch. Every read surface works on
 * stubs alone.
 *
 * One-fact-one-home: enrichment writes ONLY the `cves` table via the AMS
 * enrichment endpoint; `security_findings` (the reported copy) is never
 * touched.
 */

import { getConfig } from '../config';
import { logger } from './logger';

export const OSV_FETCH_TIMEOUT_MS = 15_000;

/** The OSV record slice we consume (https://ossf.github.io/osv-schema/). */
interface OsvRecord {
  id?: string;
  summary?: string;
  details?: string;
  aliases?: string[];
  published?: string;
  modified?: string;
  severity?: { type?: string; score?: string }[];
  references?: { type?: string; url?: string }[];
  database_specific?: { severity?: string; cwe_ids?: string[] };
}

export interface CveEnrichmentRunResult {
  processed: number;
  enriched: number;
  notFound: number;
  failed: number;
  disabled?: boolean;
}

/** Map OSV/GHSA severity words onto the AMS info..critical ladder. */
function mapOfficialSeverity(word: string | undefined): string | null {
  if (!word) return null;
  const lower = word.trim().toLowerCase();
  if (lower === 'critical') return 'critical';
  if (lower === 'high') return 'high';
  if (lower === 'moderate' || lower === 'medium') return 'medium';
  if (lower === 'low') return 'low';
  return null;
}

/** Prefer the newest CVSS vector OSV offers (v4 over v3). */
function pickCvssVector(severity: OsvRecord['severity']): string | null {
  if (!Array.isArray(severity)) return null;
  const byType = (type: string) =>
    severity.find((s) => s?.type === type && typeof s.score === 'string')?.score ?? null;
  return byType('CVSS_V4') ?? byType('CVSS_V3') ?? null;
}

/** Build the AMS enrichment payload from one OSV record. */
export function osvRecordToEnrichmentPayload(record: OsvRecord): Record<string, unknown> {
  return {
    summary: record.summary ?? null,
    description: record.details ?? null,
    cvss_vector: pickCvssVector(record.severity),
    severity_official: mapOfficialSeverity(record.database_specific?.severity),
    cwe_ids: Array.isArray(record.database_specific?.cwe_ids)
      ? record.database_specific?.cwe_ids
      : null,
    aliases: Array.isArray(record.aliases) ? record.aliases : null,
    reference_urls: Array.isArray(record.references)
      ? record.references
          .map((r) => r?.url)
          .filter((u): u is string => typeof u === 'string' && u.length > 0)
      : null,
    published_at: record.published ?? null,
    modified_at: record.modified ?? null,
    source: 'osv',
    enrichment_status: 'enriched',
  };
}

/**
 * Fetch one OSV record by identifier. Outcomes: `ok` (record), `not_found`
 * (OSV 404 -- a real answer, recorded as such), `error` (transport/HTTP --
 * the stub stays pending for a later retry). Never throws.
 */
export async function fetchOsvRecord(
  cveId: string,
): Promise<{ outcome: 'ok'; record: OsvRecord } | { outcome: 'not_found' } | { outcome: 'error'; reason: string }> {
  const base = getConfig().osvApiBaseUrl.replace(/\/$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OSV_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(`${base}/v1/vulns/${encodeURIComponent(cveId)}`, {
      method: 'GET',
      signal: controller.signal,
    });
    if (response.status === 404) return { outcome: 'not_found' };
    if (!response.ok) return { outcome: 'error', reason: `http_${response.status}` };
    const record = (await response.json()) as OsvRecord;
    return { outcome: 'ok', record };
  } catch (err) {
    const reason = err instanceof Error && err.name === 'AbortError' ? 'timeout' : 'transport';
    return { outcome: 'error', reason };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One enrichment cycle: drain up to `limit` pending CVE stubs from AMS,
 * resolve each against OSV, and post the outcome back. Sequential on purpose
 * (politeness to OSV; the queue is small and fully async). Never throws.
 */
export async function runSecurityCveEnrichment(limit = 100): Promise<CveEnrichmentRunResult> {
  const config = getConfig();
  if (!config.securityCveEnrichmentEnabled) {
    return { processed: 0, enriched: 0, notFound: 0, failed: 0, disabled: true };
  }
  const amsBase = config.architectureModelServiceBaseUrl.replace(/\/$/, '');
  let pending: { cve_id: string }[];
  try {
    const response = await fetch(
      `${amsBase}/api/model/security/cves/pending?limit=${Math.max(1, limit)}`,
    );
    if (!response.ok) {
      logger.warn('Security CVE enrichment: pending-queue read failed', {
        status: response.status,
      });
      return { processed: 0, enriched: 0, notFound: 0, failed: 0 };
    }
    pending = (await response.json()) as { cve_id: string }[];
  } catch (err) {
    logger.warn('Security CVE enrichment: pending-queue read unreachable', {
      error: err instanceof Error ? err.message : String(err),
    });
    return { processed: 0, enriched: 0, notFound: 0, failed: 0 };
  }

  const result: CveEnrichmentRunResult = {
    processed: 0,
    enriched: 0,
    notFound: 0,
    failed: 0,
  };
  for (const stub of pending) {
    const cveId = stub?.cve_id;
    if (!cveId) continue;
    result.processed++;
    const fetched = await fetchOsvRecord(cveId);
    if (fetched.outcome === 'error') {
      // Left pending -- a later cycle retries. Counted, never silent.
      result.failed++;
      continue;
    }
    const payload =
      fetched.outcome === 'ok'
        ? osvRecordToEnrichmentPayload(fetched.record)
        : { source: 'osv', enrichment_status: 'not_found' };
    try {
      const response = await fetch(
        `${amsBase}/api/model/security/cves/${encodeURIComponent(cveId)}/enrichment`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      if (!response.ok) {
        result.failed++;
        continue;
      }
      if (fetched.outcome === 'ok') result.enriched++;
      else result.notFound++;
    } catch {
      result.failed++;
    }
  }
  logger.info('Security CVE enrichment cycle complete', { ...result });
  return result;
}

/** Fire-and-forget kick used after a successful ingest. */
export function kickSecurityCveEnrichment(limit = 100): void {
  void runSecurityCveEnrichment(limit).catch((err) => {
    logger.warn('Security CVE enrichment kick failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  });
}
