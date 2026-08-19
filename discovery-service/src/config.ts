import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

/**
 * Server port
 * Default: 8091
 */
export const PORT: number =
  parseInt(process.env.PORT || '8091', 10);

/**
 * Base URL for the architecture-model-service backend
 * Default: http://localhost:8080
 * Placeholder -- not called at runtime in this skeleton increment.
 */
export const ARCHITECTURE_MODEL_SERVICE_BASE_URL: string =
  process.env.ARCHITECTURE_MODEL_SERVICE_BASE_URL || 'http://localhost:8080';

/**
 * Base URL for the gateway service
 * Default: http://localhost:8081
 * Used by the discovery-service to call the gateway's DecisionTask
 * resolution endpoint for LLM-assisted ambiguity resolution.
 */
export const GATEWAY_BASE_URL: string =
  process.env.GATEWAY_BASE_URL || 'http://localhost:8081';

/**
 * Maximum number of lines to send per source file during LLM file analysis.
 * Files exceeding this limit are truncated with a note appended to the prompt
 * telling the LLM the file was truncated.
 * Default: 10000
 */
export const DISCOVERY_FILE_LINE_LIMIT: number =
  parseInt(process.env.DISCOVERY_FILE_LINE_LIMIT || '10000', 10);

/**
 * Maximum number of files to send for LLM analysis in step 1c.
 * When set to a positive number, only the top N files (by priority score)
 * from the scan plan are analyzed. Use this for quick subset testing.
 * Default: 0 (no limit — all files in the scan plan are analyzed)
 */
export const DISCOVERY_FILE_ANALYSIS_LIMIT: number =
  parseInt(process.env.DISCOVERY_FILE_ANALYSIS_LIMIT || '0', 10);

/**
 * Whether to auto-trigger the post-run performance scoring after every
 * discovery run completes. Per-run override available via the
 * `doPerformanceRun` query parameter on `POST /api/v1/discovery/runs`.
 *
 * Spec: Discovery Performance Scoring (2026-04-25), Phase 2.
 * Default: true.
 */
export const DISCOVERY_PERFORMANCE_AUTO_SCORE: boolean =
  (process.env.DISCOVERY_PERFORMANCE_AUTO_SCORE ?? 'true').toLowerCase() !== 'false';

/**
 * Maximum nested/derived complex-type depth the SOAP/WSDL XSD field walker
 * (`wsdlParser.ts`) descends before STOPPING and emitting a
 * `soap_message_depth_cap` evidence-gap Finding (no silent truncation).
 *
 * Mirrors the env-tunable-cap pattern used elsewhere in discovery (Spec 2).
 * The pure walker takes the cap as an explicit option so it stays
 * deterministic in tests; this export is what the SOAP pass call site reads
 * and threads in.
 *
 * Spec: SOAP/WSDL Message-Field Depth (2026-05-30), Task Group 2.
 * Default: 6.
 */
export const DISCOVERY_SOAP_XSD_MAX_DEPTH: number =
  parseInt(process.env.DISCOVERY_SOAP_XSD_MAX_DEPTH || '6', 10);

/**
 * Generic Operational-Artifact Discovery (D1, Spec 2026-06-14).
 *
 * The always-on operational-artifact scan pass LLM-summarises every
 * unclaimed-but-relevant text file (shell / Autosys JIL / Perl / monitoring XML
 * / CI YAML / proprietary config) into one rich `operational_artifact` Finding.
 * These knobs mirror the `GAP_FILL_*` / `DISCOVERY_*` convention above.
 */

/**
 * Whether the always-on operational-artifact scan pass runs. ON by default;
 * env kill-switch (set `OPERATIONAL_ARTIFACT_SCAN_ENABLED=false` to disable).
 * Parsed like `DISCOVERY_PERFORMANCE_AUTO_SCORE` -- anything other than the
 * literal string "false" (case-insensitive) leaves it ON.
 * Default: true.
 */
export const OPERATIONAL_ARTIFACT_SCAN_ENABLED: boolean =
  (process.env.OPERATIONAL_ARTIFACT_SCAN_ENABLED ?? 'true').toLowerCase() !== 'false';

/**
 * Whether the capability-synthesis step runs (D2, Spec 2026-06-14). ON by
 * default; env kill-switch (set `CAPABILITY_SYNTHESIS_ENABLED=false` to disable).
 * Parsed like {@link OPERATIONAL_ARTIFACT_SCAN_ENABLED} -- anything other than
 * the literal string "false" (case-insensitive) leaves it ON. The step degrades
 * gracefully (no signals -> no-op), so it is safe ON for every run.
 * Default: true.
 */
export const CAPABILITY_SYNTHESIS_ENABLED: boolean =
  (process.env.CAPABILITY_SYNTHESIS_ENABLED ?? 'true').toLowerCase() !== 'false';

/**
 * FILE-COUNT cap for the operational-artifact pass (Decision 3). There is NO
 * cost / bytes / token budget -- the file count is the only volume control.
 * Files beyond the cap are recorded in ONE run-level skip Finding, never
 * silently dropped.
 * Default: 2000.
 */
export const OPERATIONAL_ARTIFACT_FILE_CAP: number =
  parseInt(process.env.OPERATIONAL_ARTIFACT_FILE_CAP || '2000', 10);

/**
 * Concurrency for the per-file summariser relay calls (the hand-rolled
 * `promisePool` limiter). Mirrors `GAP_FILL_CONCURRENCY`'s low default so a
 * large operational tree does not trip provider rate limits.
 * Default: 2.
 */
export const OPERATIONAL_ARTIFACT_CONCURRENCY: number =
  parseInt(process.env.OPERATIONAL_ARTIFACT_CONCURRENCY || '2', 10);

/**
 * Max per-file soft-fail rate before the pass marks its stage `failed`
 * (mirrors `GAP_FILL_MAX_FAILURE_RATE`). The run still COMPLETES; this governs
 * the stage status only.
 * Default: 0.2.
 */
export const OPERATIONAL_ARTIFACT_MAX_FAILURE_RATE: number = (() => {
  const raw = process.env.OPERATIONAL_ARTIFACT_MAX_FAILURE_RATE;
  if (!raw) return 0.2;
  const parsed = parseFloat(raw);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 0.2;
})();

/**
 * Operational file extensions that, on their own, make a file RELEVANT to the
 * operational-artifact pass (Decision 2). Deliberately NOT a strict allow-list:
 * this is one of several relevance signals (shebang / priority-dir /
 * referenced-by-atom are the others). Comma-separated, env-tunable; each entry
 * is normalised to a leading-dot lowercase extension.
 */
export const OPERATIONAL_ARTIFACT_EXTENSIONS: string[] = (() => {
  const DEFAULTS = [
    '.sh', '.bash', '.ksh', '.zsh', '.csh', '.fish',
    '.pl', '.pm', '.py', '.rb', '.tcl', '.awk', '.sed',
    '.jil', '.cfg', '.conf', '.config', '.properties', '.ini', '.env',
    '.cmd', '.bat', '.ps1', '.psm1',
    '.service', '.timer', '.cron', '.crontab',
    '.tf', '.tfvars', '.toml',
  ];
  const raw = process.env.OPERATIONAL_ARTIFACT_EXTENSIONS;
  const list = raw && raw.trim().length > 0
    ? raw.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
    : DEFAULTS;
  return list.map((e) => {
    const lower = e.toLowerCase();
    return lower.startsWith('.') ? lower : '.' + lower;
  });
})();

/**
 * Priority directory NAMES that, when a file resides under them at any depth,
 * make the file RELEVANT (Decision 2). Comma-separated, env-tunable. Matched
 * case-insensitively against each path segment.
 */
export const OPERATIONAL_ARTIFACT_PRIORITY_DIRS: string[] = (() => {
  const DEFAULTS = [
    'bin', 'scripts', 'script', 'ops', 'batch', 'etc', 'cron', 'crontab',
    'jobs', 'job', 'deploy', 'deployment', 'autosys', 'jil', 'schedules',
    'scheduler', 'monitoring', 'geneos', 'systemd', 'init.d',
  ];
  const raw = process.env.OPERATIONAL_ARTIFACT_PRIORITY_DIRS;
  const list = raw && raw.trim().length > 0
    ? raw.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
    : DEFAULTS;
  return list.map((d) => d.toLowerCase());
})();

// ---------------------------------------------------------------------------
// Automated Vulnerability Enrichment (OSV / advisory feed)
// Spec: 2026-06-24 Automated Vulnerability Enrichment (Spec 2 of 6), Task Group 1.
//
// The OSV source is reached through the CORPORATE PROXY and likely a custom CA,
// and is architected SWAPPABLE for an offline OSV mirror later. ALL of these are
// env-driven (no hard-coded endpoints) and feed the proxy/CA-aware OSV client
// (`vulnerabilityEnrichment/osvDevVulnerabilitySource.ts`). Egress here is
// strictly NON-BLOCKING: if OSV / the proxy is unreachable the client degrades
// to the "automated enrichment unavailable" path and the workflow continues.
// ---------------------------------------------------------------------------

/**
 * Base URL of the OSV source. Default is OSV.dev online; point this at an
 * offline OSV MIRROR later WITHOUT changing any caller (the endpoint selection
 * is part of the swap seam). NO endpoint is ever hard-coded in the client.
 * Mirrors the {@link ARCHITECTURE_MODEL_SERVICE_BASE_URL} env idiom above.
 * Default: https://api.osv.dev
 */
export const OSV_API_BASE_URL: string =
  process.env.OSV_API_BASE_URL || 'https://api.osv.dev';

/**
 * Per-request timeout (ms) for OSV calls. Kept modest so a hung proxy degrades
 * to "unavailable" quickly rather than stalling enrichment; a timeout is one of
 * the non-blocking degradation paths (never an error into the workflow).
 * Default: 15000.
 */
export const OSV_REQUEST_TIMEOUT_MS: number =
  parseInt(process.env.OSV_REQUEST_TIMEOUT_MS || '15000', 10);

/**
 * Standard outbound HTTPS proxy URL (`https://user:pass@host:port`) for OSV
 * egress through the corporate proxy. Read from `HTTPS_PROXY` (preferred, the
 * OSV base URL is https) then `HTTP_PROXY`, case-insensitively, matching the
 * de-facto Unix env convention. Empty when unset (direct connection).
 *
 * NB: axios honours these same env vars natively, but resolving them here keeps
 * proxy/CA selection explicit + testable on the injected client config (the
 * Task Group 1 tests assert the agent/proxy is wired from env without hitting
 * the network).
 */
export const OSV_HTTPS_PROXY: string =
  process.env.HTTPS_PROXY || process.env.https_proxy ||
  process.env.HTTP_PROXY || process.env.http_proxy || '';

/**
 * Standard `NO_PROXY` exclusion list (comma-separated hosts/domains/CIDRs).
 * When the OSV host matches an entry, the client connects directly (proxy
 * bypassed). Empty when unset. Read case-insensitively like {@link OSV_HTTPS_PROXY}.
 */
export const OSV_NO_PROXY: string =
  process.env.NO_PROXY || process.env.no_proxy || '';

/**
 * Path to a custom CA certificate bundle (PEM) for corporate TLS interception.
 * Read from `OSV_CA_CERT_FILE` then the standard Node `NODE_EXTRA_CA_CERTS`.
 * When set + readable, the bytes are loaded onto the OSV client's HTTPS agent
 * `ca` so the intercepting proxy's certificate is trusted. A missing/unreadable
 * file is non-fatal -- it degrades to the default trust store, and any
 * resulting TLS failure flows down the NON-BLOCKING "unavailable" path (never
 * an error into the workflow). Empty when unset.
 */
export const OSV_CA_CERT_FILE: string =
  process.env.OSV_CA_CERT_FILE || process.env.NODE_EXTRA_CA_CERTS || '';

/**
 * Whether to AUTO-trigger automated vulnerability enrichment off the
 * run-complete path after every discovery run (Spec 2, Task Group 3, task 3.4).
 *
 * Mirrors {@link DISCOVERY_PERFORMANCE_AUTO_SCORE} exactly: ON by default; env
 * kill-switch (`DISCOVERY_VULN_ENRICH_AUTO=false` to disable). Parsed with the
 * identical `?? 'true' ... !== 'false'` idiom -- anything other than the literal
 * string "false" (case-insensitive) leaves it ON.
 *
 * STRICTLY NON-BLOCKING: even when ON, the auto-trigger is fire-and-forget off
 * `run_complete` (the `maybeTriggerVulnerabilityEnrichment` pattern in
 * `runManager.ts`) so an OSV outage NEVER blocks or fails a run. The on-demand
 * "Scan for vulnerabilities" route is unaffected by this flag.
 * Default: true.
 */
export const DISCOVERY_VULN_ENRICH_AUTO: boolean =
  (process.env.DISCOVERY_VULN_ENRICH_AUTO ?? 'true').toLowerCase() !== 'false';

/**
 * Base URL of the api-migration-validation-service (CSD auto-S0,
 * 2026-08-19). The DB-scan completion hook posts the automatic S0 snapshot
 * request here with the scan's own harvested table metadata + credentials —
 * the DB scan and the S0 pin are ONE user action.
 * Default: `http://localhost:8092` (the service's own default port).
 */
export const API_MIGRATION_VALIDATION_BASE_URL: string =
  process.env.API_MIGRATION_VALIDATION_BASE_URL || 'http://localhost:8092';
