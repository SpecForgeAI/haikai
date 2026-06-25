/**
 * StartCaptureSessionWizard
 *
 * Spec: 2026-05-15 API Behaviour Baseline Capture Service -- Task Group 7
 *
 * Five-step launcher wizard for the capture-session lifecycle. Reuses the
 * stepper / per-step validation / Cancel-Back-Next-Start strip patterns from
 * `StartDiscoveryRunModal.tsx` and `SelectiveCopyWizardModal.tsx` so the
 * surface feels native alongside the rest of the dashboard.
 *
 * Steps:
 *   1. Pick OAS source (multi-select existing `Interface` rows OR ad-hoc
 *      OAS file upload).
 *   2. API environment configuration (env name, base URL, auth, default
 *      headers, mutating-call confirmation toggle, + an in-wizard
 *      "Test API connection" probe).
 *   3. Optional DB sampling — DB type dropdown (Postgres + Sybase ASE both
 *      enabled; the current-state DB is Sybase and the backend routes the
 *      Sybase adapter through the sybase-discovery-sidecar), connection
 *      details, allowlist.
 *   4. Endpoint inclusion — table of operations parsed by `/parse-oas`;
 *      mutating ops auto-`included=FALSE` and marked when the confirmation
 *      toggle is off.
 *   5. Start summary — redacted config + scenario plan + the actual `/start`
 *      call.
 *
 * Wire sequence on Start:
 *   POST createCaptureSession (status=draft)
 *     -> wizard captures returned id
 *     -> POST submitSecrets (in-memory only, AMS never sees plaintext)
 *     -> POST parseOas (interfaceIds OR file)
 *     -> PATCH session: write env config, headers, db config, status=configured
 *     -> POST start  (transitions session to running, server-side guarded)
 *
 * The mutating-call confirmation toggle is editable while the session is
 * `draft` and locked once it transitions to `configured`. In this wizard
 * the toggle is therefore always editable until the final Start press
 * (which is the moment the wizard moves the session out of draft).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccountEndpointsRequestItem,
  ApiBehaviourCaptureSessionDto,
  ApiBehaviourOperationDto,
  InventoryReconciliationResponse,
  InventoryUnaccountedEndpointRef,
  StartCaptureSessionRequest,
  TestApiConnectionStatelessRequest,
  TestApiConnectionStatelessResponse,
  accountEndpoints,
  createCaptureSession,
  parseInventoryUnaccountedError,
  parseOas,
  reconcileInventory,
  startCaptureSession,
  submitSecrets,
  testApiConnectionStateless,
  updateCaptureSession,
  updateOperation,
  dataTypeDefaultsPreview,
  DataTypeDefaultsPreviewRow,
  ApiBehaviourApiError,
} from '../../api/apiBehaviourClient';
import { DataTypeFormatsStep } from './DataTypeFormatsStep';
import { BehaviourSemanticsConfigStep } from './BehaviourSemanticsConfigStep';
import type { ResponseSemanticsConfig } from './behaviourSemanticsConfig';
import {
  MigrationDiscoveryContext,
  fetchMigrationDiscoveryContext,
} from '../../api/migrationDiscoveryContextApi';
import { useArchitecture } from '../../contexts/ArchitectureContext';
import type { Interface as InterfaceModel } from '../../types/model';
import styles from './StartCaptureSessionWizard.module.css';
import { PostmanImportWizardStep } from './PostmanImportWizardStep';
import { usePostmanImportRun } from './usePostmanImportRun';
import type { ImportedRequest } from '../../utils/postmanImport';
import {
  type PostmanRunMode,
  modeUsesPostman,
} from './postmanImportRunSupport';

// ============================================================================
// Props
// ============================================================================

export interface StartCaptureSessionWizardProps {
  open: boolean;
  /** Project the session belongs to. Pre-bound from the launcher row. */
  projectId: string;
  /** Architecture the session is bound to. Pre-bound from the launcher row. */
  architectureId: string;
  /** Display name for the architecture (header chip only). */
  architectureName?: string;
  onClose: () => void;
  /** Called once `/start` succeeds. Parent typically navigates to detail. */
  onStarted?: (session: ApiBehaviourCaptureSessionDto) => void;
}

// ============================================================================
// Internal types
// ============================================================================

type WizardStep = 1 | 2 | 3 | 4 | 5 | 6 | 7;

type AuthType = 'none' | 'bearer' | 'basic' | 'sso_token' | 'header';
type DbType = 'none' | 'postgres' | 'sybase';

interface Step2Config {
  envName: string;
  baseUrl: string;
  authType: AuthType;
  bearerToken: string;
  basicUsername: string;
  basicPassword: string;
  /** Convenience "ssoToken (in header)" option: the token value only (header name is fixed to `ssoToken`). */
  ssoToken: string;
  headerName: string;
  headerValue: string;
  defaultHeadersText: string; // one "Name: Value" per line
  mutatingCallsConfirmed: boolean;
}

interface Step3Config {
  dbType: DbType;
  host: string;
  port: string;
  database: string;
  schema: string;
  username: string;
  password: string;
  allowlistText: string; // comma-separated table names
}

const DEFAULT_STEP2: Step2Config = {
  envName: '',
  baseUrl: '',
  authType: 'none',
  bearerToken: '',
  basicUsername: '',
  basicPassword: '',
  ssoToken: '',
  headerName: '',
  headerValue: '',
  defaultHeadersText: '',
  mutatingCallsConfirmed: false,
};

const DEFAULT_STEP3: Step3Config = {
  dbType: 'none',
  host: '',
  port: '5432',
  database: '',
  schema: '',
  username: '',
  password: '',
  allowlistText: '',
};

// ============================================================================
// Helpers
// ============================================================================

function parseHeadersText(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const name = line.substring(0, idx).trim();
    const value = line.substring(idx + 1).trim();
    if (name) out[name] = value;
  }
  return out;
}

/**
 * Parse the "Name: Value" textarea into the `{ name, value }[]` list shape
 * the stateless test-connection endpoint expects. Mirrors `parseHeadersText`
 * but preserves the array form (the gateway/probe wants an ordered list, not
 * the redacted map AMS persists).
 */
function parseHeadersList(text: string): { name: string; value: string }[] {
  const out: { name: string; value: string }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const name = line.substring(0, idx).trim();
    const value = line.substring(idx + 1).trim();
    if (name) out.push({ name, value });
  }
  return out;
}

function parseAllowlist(text: string): string[] {
  return text
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const NON_MUTATING = new Set(['GET', 'HEAD', 'OPTIONS']);

function isMutatingMethod(method: string | null): boolean {
  if (!method) return false;
  return !NON_MUTATING.has(method.toUpperCase());
}

function describeError(err: unknown): string {
  if (err instanceof ApiBehaviourApiError) {
    return err.body.message || `Request failed (${err.status})`;
  }
  if (err instanceof Error) return err.message;
  return 'Unexpected error';
}

// ============================================================================
// Component
// ============================================================================

export function StartCaptureSessionWizard({
  open,
  projectId,
  architectureId,
  architectureName,
  onClose,
  onStarted,
}: StartCaptureSessionWizardProps) {
  const { model } = useArchitecture();

  // ---- Step state ------------------------------------------------------
  const [step, setStep] = useState<WizardStep>(1);

  // ---- Step 1: OAS source ---------------------------------------------
  const [selectedInterfaceIds, setSelectedInterfaceIds] = useState<Set<string>>(
    new Set(),
  );
  // OAS upload OR a WADL + one-or-more sibling `.xsd` grammar files
  // (spec 2026-06-03 OAS-YAML + WADL/XSD Contract Support).
  const [oasFiles, setOasFiles] = useState<File[]>([]);

  // ---- Step 2/3 ---------------------------------------------------------
  const [step2, setStep2] = useState<Step2Config>(DEFAULT_STEP2);
  const [step3, setStep3] = useState<Step3Config>(DEFAULT_STEP3);

  // ---- Step 2: in-wizard "Test API connection" probe (Fix C 2026-06-02) -
  // The wizard collects baseUrl + auth + default headers in Step 2 but had no
  // way to validate the environment before the final Start press. This state
  // drives a stateless probe (`testApiConnectionStateless`) against a NEW
  // gateway endpoint that fires one call with the current Step-2 config and
  // returns `{ success, status, durationMs, error? }`. No session row is
  // needed -- secrets ride the request body for the duration of the probe and
  // are never persisted.
  const [testingConn, setTestingConn] = useState(false);
  const [connResult, setConnResult] = useState<
    | { ok: true; data: TestApiConnectionStatelessResponse }
    | { ok: false; message: string }
    | null
  >(null);

  // ---- Step 4: parsed operations after parse-oas -----------------------
  const [parsedOperations, setParsedOperations] = useState<ApiBehaviourOperationDto[]>([]);
  // Per-operation included override (id -> included flag).
  const [operationIncluded, setOperationIncluded] = useState<Record<string, boolean>>({});

  // ---- Step 4 inventory reconciliation (Model-Seeded Capture Inventory
  // spec, 2026-06-11, Task Group 4). Populated right after parse-oas on the
  // Step 3 -> 4 advance and refreshed after every account-endpoints write.
  // The payload is the AMS calculator's verbatim wire shape -- the wizard
  // never reshapes it or re-derives coverage client-side (the reconciliation
  // key + comparison live ONLY in the Java calculator).
  const [reconciliation, setReconciliation] =
    useState<InventoryReconciliationResponse | null>(null);
  const [reconciliationError, setReconciliationError] = useState<string | null>(null);
  const [accountingInFlight, setAccountingInFlight] = useState(false);
  // endpoint_id -> draft exclusion reason. Key PRESENCE means the exclude
  // form is open for that row; the confirm button stays disabled until the
  // reason is non-empty (the server 400s on an empty reason).
  const [excludeDrafts, setExcludeDrafts] = useState<Record<string, string>>({});
  const [excludedByScopeExpanded, setExcludedByScopeExpanded] = useState(false);
  // 409 INVENTORY_UNACCOUNTED_ENDPOINTS override flow on the final Start
  // press: the remaining unaccounted refs (embedded list capped at 50 +
  // the full count) plus the justification draft. "Start anyway (override)"
  // stays disabled while the justification is empty.
  const [overrideBlock, setOverrideBlock] = useState<{
    unaccounted: InventoryUnaccountedEndpointRef[];
    totalCount: number;
  } | null>(null);
  const [overrideJustification, setOverrideJustification] = useState('');

  // ---- Step 4 LLM endpoint extraction (Spec 2026-05-17 Task Group 6) ----
  // The button is rendered only when (a) the wizard is on Step 4, (b) the
  // candidate list is empty, AND (c) the parent interface is a SOAP_API. A
  // click invokes the gateway proxy at
  //   POST /api/v1/projects/:p/architectures/:a/api-behaviour/
  //        capture-sessions/:s/extract-endpoints
  // synchronously with a 60s client-side AbortController timeout. The toast
  // surfaces three failure paths:
  //   - timeout: "Still working - refresh in a minute"
  //   - clone evicted (HTTP 410 OR status='clone_evicted'): button disables
  //     with secondary text; toast says "Source no longer cached - re-run
  //     discovery"
  //   - malformed-twice (status='malformed' OR gapType='llm_endpoint_extract_
  //     malformed'): toast says "LLM extraction failed - review manually"
  const [extracting, setExtracting] = useState(false);
  const [cloneEvicted, setCloneEvicted] = useState(false);
  const [extractToast, setExtractToast] = useState<{
    message: string;
    type: 'info' | 'error';
  } | null>(null);

  // ---- In-flight + error -----------------------------------------------
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track the draft session id created on Step 4 advance (parse-oas requires
  // a session row to exist before it can write operations).
  const draftSessionRef = useRef<ApiBehaviourCaptureSessionDto | null>(null);

  // ---- Postman import (Spec 2026-06-23, Task Group 8) -------------------
  // The 3-way run-mode selector + Postman upload + staging + arch-match live
  // in the Step 4 (Endpoints) sub-section. postmanRunMode defaults to LLM-only
  // so the existing behaviour is unchanged unless the user opts in. The parsed
  // items are fired as concrete manual-capture sends AFTER /start (Mode 1b/c)
  // by handleStart; the usePostmanImportRun hook owns the arch-match
  // resolution state + the send loop.
  const [postmanRunMode, setPostmanRunMode] = useState<PostmanRunMode>('llm');
  const [importedRequests, setImportedRequests] = useState<ImportedRequest[]>([]);
  const [draftSessionId, setDraftSessionId] = useState<string | null>(null);

  // The shared send-orchestration hook (arch-match resolution state + the
  // post-/start manual-capture send loop). Reads the live parsed operation
  // rows + reconciliation so the staging table maps + classifies items and a
  // "Keep & run" add-operation extends the rows before the send.
  const postmanRun = usePostmanImportRun({
    projectId,
    architectureId,
    sessionId: draftSessionId ?? '',
    importedRequests,
    operations: parsedOperations,
    reconciliation,
    mutatingCallsConfirmed: step2.mutatingCallsConfirmed,
  });

  // ---- Step 5: Data-type formats (Spec 2026-06-20) --------------------
  // Classified preview rows (one per DISCOVERED category) fetched on the
  // Step 4 -> 5 advance from the amvs `data-type-defaults-preview` endpoint;
  // the code-format inputs live in `request_contract.param_formats`, reachable
  // only amvs-side. An EMPTY rows result is the auto-skip signal (Q8) -- the
  // wizard jumps straight from Endpoints (4) to Start (6) and never shows the
  // step. `dataTypeDefaults` is the operator's editable Col-4 value map
  // (category -> string | null): a non-null string = the default, `null` =
  // an explicit "no default" (no nudge), seeded from each row's `default_format`.
  const [dataTypeRows, setDataTypeRows] = useState<DataTypeDefaultsPreviewRow[]>([]);
  const [dataTypeDefaults, setDataTypeDefaults] = useState<
    Record<string, string | null>
  >({});
  const [dataTypePreviewLoading, setDataTypePreviewLoading] = useState(false);

  // ---- Step 6: Response semantics (Spec 2026-06-23) -------------------
  // The operator's per-API response-semantics config (how this API's statuses +
  // body markers map to outcome buckets). `null` === untouched === built-in
  // default vocabulary (the valid empty state -- NO backfill). Persisted onto the
  // draft session as `behaviour_semantics_config_json` on the Step 6 -> 7 advance,
  // mirroring exactly how Step 5 persists `data_type_defaults_json`. The config
  // shape + default marker vocabulary come from the local hand-mirror
  // `behaviourSemanticsConfig.ts` (the frontend must NOT import from amvs).
  const [behaviourSemanticsConfig, setBehaviourSemanticsConfig] =
    useState<ResponseSemanticsConfig | null>(null);

  // ---- Discovery Context (Step 1 collapsed section, Task Group 4) ------
  // The wizard fires a single read-only POST to the gateway proxy on open
  // to fetch the latest-relevant discovery context for the active
  // architecture (no discoveryRunIds -> AMS resolves latest completed runs).
  // The response drives the Discovery Context section UI:
  //   - default open when findings exist; collapsed otherwise (per D5)
  //   - run selector pre-populated from `discoveryRunsSummary.runs`
  //   - per-selection summary numbers read from `findingsSummary` +
  //     `runtimeUsageSummary` + `databaseDiscoverySummary`
  // On submit (Start press) we pass the user's selections (run IDs +
  // include toggle + count limits) into `startCaptureSession`, where they
  // round-trip through the gateway proxy verbatim into AMS.
  const [discoveryCtx, setDiscoveryCtx] = useState<MigrationDiscoveryContext | null>(null);
  const [discoveryLoading, setDiscoveryLoading] = useState(false);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const [discoverySectionExpanded, setDiscoverySectionExpanded] = useState(false);
  const [includeDiscoveryContext, setIncludeDiscoveryContext] = useState(true);
  const [selectedDiscoveryRunIds, setSelectedDiscoveryRunIds] = useState<Set<string>>(
    () => new Set(),
  );

  // ---- Reset state on open --------------------------------------------
  useEffect(() => {
    if (!open) return;
    setStep(1);
    setSelectedInterfaceIds(new Set());
    setOasFiles([]);
    setStep2(DEFAULT_STEP2);
    setStep3(DEFAULT_STEP3);
    setTestingConn(false);
    setConnResult(null);
    setParsedOperations([]);
    setOperationIncluded({});
    setReconciliation(null);
    setReconciliationError(null);
    setAccountingInFlight(false);
    setExcludeDrafts({});
    setExcludedByScopeExpanded(false);
    setOverrideBlock(null);
    setOverrideJustification('');
    setSubmitting(false);
    setError(null);
    draftSessionRef.current = null;
    setDraftSessionId(null);
    setPostmanRunMode('llm');
    setImportedRequests([]);
    setDataTypeRows([]);
    setDataTypeDefaults({});
    setDataTypePreviewLoading(false);
    setBehaviourSemanticsConfig(null);
    // Reset discovery section state too -- a fresh open recomputes from
    // the latest AMS aggregation.
    setDiscoveryCtx(null);
    setDiscoveryError(null);
    setDiscoverySectionExpanded(false);
    setIncludeDiscoveryContext(true);
    setSelectedDiscoveryRunIds(new Set());
    setExtracting(false);
    setCloneEvicted(false);
    setExtractToast(null);
  }, [open]);

  // ---- Discovery context fetch on open --------------------------------
  // Fail-soft: any error (HTTP, network, parse) leaves the context UI in a
  // degenerate state -- the section stays collapsed with an inline warning
  // and the rest of the wizard works unchanged.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setDiscoveryLoading(true);
    setDiscoveryError(null);
    (async () => {
      try {
        const ctx = await fetchMigrationDiscoveryContext(projectId, {
          currentArchitectureId: architectureId,
          includeFindings: true,
        });
        if (cancelled) return;
        setDiscoveryCtx(ctx);
        // Auto-expand when findings exist; otherwise stay collapsed per D5.
        const totalFindings = ctx.findingsSummary?.totalFindings ?? 0;
        const hasFindings = totalFindings > 0;
        setDiscoverySectionExpanded(hasFindings);
        // Default-include when findings exist; opt-out by default if none.
        setIncludeDiscoveryContext(hasFindings);
        // Pre-select the latest completed run if any. The AMS response
        // already lists runs latest-first via `DiscoverySummaryService`,
        // so the first entry is the right default.
        const runs = ctx.discoveryRunsSummary?.runs ?? [];
        const latest = runs.find((r) => r.status === 'completed') ?? runs[0];
        if (latest) {
          setSelectedDiscoveryRunIds(new Set([latest.runId]));
        }
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'Discovery context unavailable';
        setDiscoveryError(message);
        // Section stays collapsed; include toggle stays false; no run
        // selections. Wizard remains fully usable without discovery
        // context (fail-soft contract).
        setIncludeDiscoveryContext(false);
        setDiscoverySectionExpanded(false);
      } finally {
        if (!cancelled) setDiscoveryLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, projectId, architectureId]);

  // ---- Esc-to-close ---------------------------------------------------
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose, submitting]);

  // ---- Interface inventory (read fresh from the active model — no source
  //      cache layer per spec). The wizard launcher is opened from the active
  //      architecture context, so the in-memory model already holds the
  //      Interface rows for the bound architecture.
  const interfaces: InterfaceModel[] = useMemo(
    () => (model?.metaModel?.entities?.interfaces ?? []) as InterfaceModel[],
    [model],
  );

  // ---- Step transitions ----------------------------------------------
  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget && !submitting) onClose();
    },
    [onClose, submitting],
  );

  const canAdvanceStep1 = selectedInterfaceIds.size > 0 || oasFiles.length > 0;
  const canAdvanceStep2 = step2.envName.trim().length > 0 && step2.baseUrl.trim().length > 0;
  // Fix B (2026-06-02): Sybase is now a first-class current-state DB type.
  // The backend `test-db-connection` endpoint + the DB sampler accept
  // `sybase` (SybaseAdapter -> sybase-discovery-sidecar), so the wizard must
  // let the user advance past Step 3 when Sybase is selected. Previously this
  // only allowed `none` | `postgres`, which silently blocked the Sybase path.
  const canAdvanceStep3 =
    step3.dbType === 'none' ||
    step3.dbType === 'postgres' ||
    step3.dbType === 'sybase';

  // DB connection-detail fields share the same form for Postgres + Sybase
  // (host/port/database/schema/username/password/allowlist). The only
  // difference is the conventional default port, which the user can edit.
  const showDbDetailFields = step3.dbType === 'postgres' || step3.dbType === 'sybase';

  const buildAuthConfigRedacted = useCallback((): Record<string, unknown> => {
    switch (step2.authType) {
      case 'bearer':
        return { type: 'bearer', token: '[REDACTED]' };
      case 'basic':
        return { type: 'basic', username: step2.basicUsername, password: '[REDACTED]' };
      case 'sso_token':
        // Stored/displayed as a fixed-name custom header (the value is redacted).
        return { type: 'header', headerName: 'ssoToken', headerValue: '[REDACTED]' };
      case 'header':
        return { type: 'header', headerName: step2.headerName, headerValue: '[REDACTED]' };
      case 'none':
      default:
        return { type: 'none' };
    }
  }, [step2]);

  const buildDbConfigRedacted = useCallback((): Record<string, unknown> | null => {
    if (step3.dbType === 'none') return null;
    return {
      // Field MUST be `dbType` (not `type`): the orchestrator
      // (`captureSessionOrchestrator.ts`), the three DB tools, and the
      // `/test-db-connection` handler all read `db_config_redacted_json.dbType`.
      // Persisting `type` left `cfg.dbType` undefined, so `createDbAdapter`
      // threw `Unsupported dbType: undefined` and crashed the capture run.
      dbType: step3.dbType,
      host: step3.host,
      port: Number(step3.port) || null,
      database: step3.database,
      schema: step3.schema || null,
      username: step3.username,
      password: '[REDACTED]',
      allowlist: parseAllowlist(step3.allowlistText),
    };
  }, [step3]);

  /**
   * Build the auth object for the stateless test-connection probe from the
   * current Step-2 state. Mirrors the `buildSecretsBundle()` shape so the
   * probe authenticates exactly the way the eventual capture run will.
   */
  const buildTestAuth = useCallback((): TestApiConnectionStatelessRequest['auth'] => {
    switch (step2.authType) {
      case 'bearer':
        return { type: 'bearer', token: step2.bearerToken };
      case 'basic':
        return {
          type: 'basic',
          username: step2.basicUsername,
          password: step2.basicPassword,
        };
      case 'sso_token':
        // Convenience: fixed header name `ssoToken`; the value is trimmed so a
        // stray copied space/newline cannot corrupt the token. Sent as an
        // ordinary custom header (type 'header' -> 'custom_header' server-side),
        // so Test Connection and the capture run deliver the identical value.
        return {
          type: 'header',
          headerName: 'ssoToken',
          headerValue: step2.ssoToken.trim(),
        };
      case 'header':
        return {
          type: 'header',
          headerName: step2.headerName,
          headerValue: step2.headerValue,
        };
      case 'none':
      default:
        return { type: 'none' };
    }
  }, [step2]);

  const buildSecretsBundle = useCallback(() => {
    const apiAuth: Record<string, unknown> = { type: step2.authType };
    if (step2.authType === 'bearer') apiAuth.token = step2.bearerToken;
    if (step2.authType === 'basic') {
      apiAuth.username = step2.basicUsername;
      apiAuth.password = step2.basicPassword;
    }
    if (step2.authType === 'sso_token') {
      // Fixed name + trimmed value (the convenience SSO-token option). Trimmed
      // here too so the persisted secret matches what Test Connection probed.
      apiAuth.headerName = 'ssoToken';
      apiAuth.headerValue = step2.ssoToken.trim();
    }
    if (step2.authType === 'header') {
      apiAuth.headerName = step2.headerName;
      apiAuth.headerValue = step2.headerValue;
    }
    return {
      apiAuth: apiAuth as { type: string },
      dbPassword: step3.dbType !== 'none' ? step3.password : null,
    };
  }, [step2, step3]);

  /**
   * Step 2 "Test API connection" handler (Fix C). Fires one stateless probe
   * with the current Step-2 config and renders the result inline. Fail-soft:
   * a thrown client error (HTTP non-2xx etc.) is captured into `connResult`
   * as an error message rather than surfacing through the wizard's `error`
   * banner -- the probe is advisory and never blocks the Next button.
   */
  const handleTestConnection = useCallback(async () => {
    if (testingConn) return;
    setConnResult(null);
    setTestingConn(true);
    try {
      const body: TestApiConnectionStatelessRequest = {
        baseUrl: step2.baseUrl,
        auth: buildTestAuth(),
        defaultHeaders: parseHeadersList(step2.defaultHeadersText),
      };
      const data = await testApiConnectionStateless(projectId, architectureId, body);
      setConnResult({ ok: true, data });
    } catch (err) {
      setConnResult({ ok: false, message: describeError(err) });
    } finally {
      setTestingConn(false);
    }
  }, [
    testingConn,
    projectId,
    architectureId,
    step2.baseUrl,
    step2.defaultHeadersText,
    buildTestAuth,
  ]);

  /**
   * Step 3 -> Step 4 advance. Creates the draft session, submits secrets,
   * then triggers parse-oas. Operations come back to populate step 4.
   */
  const handleAdvanceToStep4 = useCallback(async () => {
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const created = await createCaptureSession(projectId, architectureId, {
        project_id: projectId,
        architecture_id: architectureId,
        name: step2.envName,
        environment_name: step2.envName,
        api_base_url: step2.baseUrl,
        auth_type: step2.authType === 'sso_token' ? 'header' : step2.authType,
        auth_config_redacted_json: buildAuthConfigRedacted(),
        default_headers_redacted_json: parseHeadersText(step2.defaultHeadersText),
        db_config_redacted_json: buildDbConfigRedacted(),
        mutating_calls_confirmed: step2.mutatingCallsConfirmed,
      });
      draftSessionRef.current = created;
      setDraftSessionId(created.id);

      await submitSecrets(projectId, architectureId, created.id, buildSecretsBundle());

      const parseBody: Parameters<typeof parseOas>[3] = oasFiles.length > 0
        ? { files: oasFiles }
        : { interfaceIds: Array.from(selectedInterfaceIds) };
      await parseOas(projectId, architectureId, created.id, parseBody);

      // The action endpoint writes operation rows into AMS but does NOT
      // return them; we re-fetch via the operations CRUD list filtered by
      // session id. Mapping/list lookups fetched fresh per spec.
      const { listOperations } = await import('../../api/apiBehaviourClient');
      const ops = await listOperations(projectId, architectureId, created.id);
      setParsedOperations(ops);
      const initial: Record<string, boolean> = {};
      for (const op of ops) initial[op.id] = op.included !== false;
      setOperationIncluded(initial);

      // Inventory reconciliation against the committed endpoint set
      // (Model-Seeded Capture Inventory, 2026-06-11). The selected interface
      // ids define the scope and are persisted onto the session row
      // (persist_scope: true) so the Start-time gate re-reconciles against
      // the same scope. Ad-hoc file uploads have no interface selection --
      // null scope means the WHOLE architecture is in scope. Fail-SOFT here:
      // configure-time reconciliation is advisory UX (a visible warning
      // renders instead); the fail-CLOSED gate runs server-side at /start.
      try {
        const scopeIds =
          oasFiles.length > 0 || selectedInterfaceIds.size === 0
            ? null
            : Array.from(selectedInterfaceIds);
        const rec = await reconcileInventory(projectId, architectureId, created.id, {
          scope_interface_ids: scopeIds,
          persist_scope: true,
        });
        setReconciliation(rec);
        setReconciliationError(null);
      } catch (recErr) {
        setReconciliation(null);
        setReconciliationError(describeError(recErr));
      }

      setStep(4);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSubmitting(false);
    }
  }, [
    submitting,
    projectId,
    architectureId,
    step2,
    step3,
    oasFiles,
    selectedInterfaceIds,
    buildAuthConfigRedacted,
    buildDbConfigRedacted,
    buildSecretsBundle,
  ]);

  /**
   * Bulk include / exclude-with-reason accounting (Model-Seeded Capture
   * Inventory, 2026-06-11). One round trip per user gesture -- "Include all"
   * sends every unmatched endpoint in a single call. On success the created
   * operation rows from the action response are appended to the Step 4
   * table (no separate list call), then the reconciliation state is
   * refreshed from AMS -- the single source of truth for the key/comparison.
   */
  const handleAccountEndpoints = useCallback(
    async (items: AccountEndpointsRequestItem[]) => {
      const session = draftSessionRef.current;
      if (!session || accountingInFlight || items.length === 0) return;
      setError(null);
      setAccountingInFlight(true);
      try {
        const res = await accountEndpoints(projectId, architectureId, session.id, items);
        // Refresh the operations table straight from the action response.
        setParsedOperations((prev) => [...prev, ...res.operations]);
        setOperationIncluded((prev) => {
          const next = { ...prev };
          for (const op of res.operations) next[op.id] = op.included !== false;
          return next;
        });
        // Close any exclude forms for the rows we just accounted.
        setExcludeDrafts((prev) => {
          const next = { ...prev };
          for (const item of items) delete next[item.endpoint_id];
          return next;
        });
        // Refresh reconciliation state from AMS (scope falls back to the
        // session row's persisted scope_interface_ids_json).
        try {
          const rec = await reconcileInventory(projectId, architectureId, session.id, {});
          setReconciliation(rec);
          setReconciliationError(null);
        } catch {
          // Refresh failed: drop the now-accounted rows locally so the UI
          // does not offer stale actions. This is endpoint_id bookkeeping
          // from the action response -- NOT a re-computation of the
          // reconciliation key/comparison. Coverage figures keep their last
          // known values; the /start gate re-runs reconciliation anyway.
          const accountedIds = new Set(items.map((i) => i.endpoint_id));
          setReconciliation((prev) =>
            prev
              ? {
                  ...prev,
                  in_scope_unaccounted_endpoints:
                    prev.in_scope_unaccounted_endpoints.filter(
                      (e) => !accountedIds.has(e.endpoint_id),
                    ),
                }
              : prev,
          );
        }
      } catch (err) {
        setError(describeError(err));
      } finally {
        setAccountingInFlight(false);
      }
    },
    [projectId, architectureId, accountingInFlight],
  );

  /** Step 4 -> 5: persist operation include overrides, then transition. */
  const handleAdvanceToStep5 = useCallback(async () => {
    const session = draftSessionRef.current;
    if (!session || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      // Persist any per-operation include flag changes the user made vs the
      // server-side defaults.
      const writes: Promise<unknown>[] = [];
      for (const op of parsedOperations) {
        const desired = operationIncluded[op.id];
        if (typeof desired === 'boolean' && desired !== op.included) {
          writes.push(
            updateOperation(projectId, architectureId, op.id, { included: desired }),
          );
        }
      }
      await Promise.all(writes);
      // Fetch the data-type-format preview. The draft session exists by now, so
      // the endpoint can read its OAS operations + the architecture's
      // request-contract code evidence. An EMPTY rows result means no
      // classifiable data types were discovered -> AUTO-SKIP step 5 (Q8) and
      // advance straight to Start (step 6) with no "nothing to configure" screen.
      setDataTypePreviewLoading(true);
      let previewRows: DataTypeDefaultsPreviewRow[] = [];
      try {
        const preview = await dataTypeDefaultsPreview(
          projectId,
          architectureId,
          session.id,
        );
        previewRows = Array.isArray(preview?.rows) ? preview.rows : [];
      } catch {
        // Fail-soft: a preview failure must not strand the wizard. Treat it as
        // "no data types discovered" and skip the step rather than block Start.
        previewRows = [];
      } finally {
        setDataTypePreviewLoading(false);
      }
      if (previewRows.length === 0) {
        setDataTypeRows([]);
        setDataTypeDefaults({});
        setStep(6);
        return;
      }
      // Seed Col-4 from each row's `default_format` (chain (a):
      // code > contract > standard guess, computed amvs-side). A `null` seed
      // (no sensible standard, e.g. enum) starts as an empty editable string --
      // NOT the explicit "(no default)" choice, which the operator records by
      // ticking the per-row no-default box.
      const seeded: Record<string, string | null> = {};
      for (const row of previewRows) {
        seeded[row.category] =
          typeof row.default_format === 'string' ? row.default_format : '';
      }
      setDataTypeRows(previewRows);
      setDataTypeDefaults(seeded);
      setStep(5);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSubmitting(false);
    }
  }, [
    projectId,
    architectureId,
    submitting,
    parsedOperations,
    operationIncluded,
  ]);

  /**
   * Step 5 -> 6 advance. Persists the operator's confirmed Col-4 defaults onto
   * the draft session as `data_type_defaults_json` via the existing
   * `updateCaptureSession` PATCH path, then shows the Response-semantics step
   * (Step 6). The map is
   * `category -> string | null`: a non-null string is the default, `null` is
   * the explicit "no default" decision (the run gets no nudge for that type and
   * the AMS round-trip preserves the `null` value). Empty-string entries are an
   * untouched seed-with-no-standard -- persisted as-is; the prompt block
   * treats a non-null value as a default.
   */
  const handleAdvanceToStep6 = useCallback(async () => {
    const session = draftSessionRef.current;
    if (!session || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const map: Record<string, string | null> = {};
      for (const row of dataTypeRows) {
        const v = dataTypeDefaults[row.category];
        map[row.category] = v === null ? null : (v ?? '');
      }
      await updateCaptureSession(projectId, architectureId, session.id, {
        data_type_defaults_json: map,
      });
      setStep(6);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSubmitting(false);
    }
  }, [
    projectId,
    architectureId,
    submitting,
    dataTypeRows,
    dataTypeDefaults,
  ]);

  /**
   * Step 6 -> 7 advance. Persists the operator's per-API response-semantics
   * config onto the draft session as `behaviour_semantics_config_json` via the
   * SAME `updateCaptureSession` PATCH path Step 5 uses for the data-type
   * defaults, then shows the Start step. A `null` config (untouched === built-in
   * defaults, the valid empty state) is persisted as `null`; the AMS write path
   * is null-guarded and the absent/empty config resolves to the built-in
   * vocabulary -- NO backfill.
   */
  const handleAdvanceToStep7 = useCallback(async () => {
    const session = draftSessionRef.current;
    if (!session || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      await updateCaptureSession(projectId, architectureId, session.id, {
        behaviour_semantics_config_json:
          (behaviourSemanticsConfig as Record<string, unknown> | null) ?? null,
      });
      setStep(7);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSubmitting(false);
    }
  }, [
    projectId,
    architectureId,
    submitting,
    behaviourSemanticsConfig,
  ]);

  /**
   * Step 4 "Extract endpoints with LLM" button handler. Synchronous (W-15)
   * invocation of the AMVS extract-endpoints route via the gateway proxy.
   * The 60-second client-side AbortController timeout matches the server
   * deadline; on either side timing out the wizard reverts the button and
   * shows the "Still working" toast so the user can refresh manually once
   * the late landing arrives via the candidate pipeline (Group 7).
   *
   * The wizard's Step 4 candidate list only carries the OAS-parsed shape; the
   * extract route may emit candidates that flow through the discovery save-
   * back path (Group 7's wiring). When success returns, we re-fetch the
   * session's operation list so the new rows appear without a full reload.
   *
   * Failure paths:
   *   - HTTP 410 (clone evicted): disable the button with secondary text +
   *     show the "Source no longer cached" toast.
   *   - status='clone_evicted' (in 200 body): same as HTTP 410.
   *   - status='malformed' OR gapType='llm_endpoint_extract_malformed' in
   *     response warnings: toast "LLM extraction failed -- review manually".
   *   - AbortError after 60s: toast "Still working -- refresh in a minute".
   */
  const handleExtractEndpointsWithLlm = useCallback(async () => {
    const session = draftSessionRef.current;
    if (!session || extracting) return;
    // Resolve the SOAP interface id from the user's Step-1 selection. The
    // empty-state button is only rendered when exactly one SOAP_API
    // interface is in scope -- the first match here is authoritative.
    const soapInterfaceId = Array.from(selectedInterfaceIds).find((id) => {
      const iface = interfaces.find((i) => i.id === id);
      return iface?.interface_type === 'SOAP_API';
    });
    if (!soapInterfaceId) return;
    // The discovery run id comes from the Discovery Context section's
    // selection. The extract tool needs it to fetch source files from the
    // cached clone; without one the route 400s.
    const discoveryRunId = Array.from(selectedDiscoveryRunIds)[0];
    if (!discoveryRunId) {
      setExtractToast({
        type: 'error',
        message: 'Select a discovery run in Step 1 to enable LLM extraction.',
      });
      return;
    }

    setExtractToast(null);
    setExtracting(true);
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 60_000);
    try {
      const gatewayBase =
        (import.meta as ImportMeta & { env?: Record<string, string> }).env
          ?.VITE_GATEWAY_BASE_URL ?? '';
      const url =
        `${gatewayBase}/api/v1/projects/${encodeURIComponent(projectId)}` +
        `/architectures/${encodeURIComponent(architectureId)}` +
        `/api-behaviour/capture-sessions/${encodeURIComponent(session.id)}/extract-endpoints`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          interfaceId: soapInterfaceId,
          discoveryRunId,
        }),
        signal: controller.signal,
      });
      if (res.status === 410) {
        setCloneEvicted(true);
        setExtractToast({
          type: 'error',
          message: 'Source no longer cached - re-run discovery',
        });
        return;
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        setExtractToast({
          type: 'error',
          message: `LLM extraction failed (${res.status}): ${body.slice(0, 200)}`,
        });
        return;
      }
      const payload = (await res.json()) as {
        status?: string;
        operations?: unknown[];
        warnings?: string[];
      };
      if (payload.status === 'clone_evicted') {
        setCloneEvicted(true);
        setExtractToast({
          type: 'error',
          message: 'Source no longer cached - re-run discovery',
        });
        return;
      }
      const hasMalformedSentinel =
        payload.status === 'malformed' ||
        (Array.isArray(payload.warnings) &&
          payload.warnings.some((w) =>
            typeof w === 'string' && w.includes('llm_endpoint_extract_malformed'),
          ));
      if (hasMalformedSentinel) {
        setExtractToast({
          type: 'error',
          message: 'LLM extraction failed - review manually',
        });
        return;
      }
      if (payload.status === 'still_working') {
        setExtractToast({
          type: 'info',
          message: 'Still working - refresh in a minute',
        });
        return;
      }
      // Success path: refresh the candidate list so the newly-extracted
      // rows appear inline. Mirrors the parse-oas -> listOperations flow on
      // Step 3 -> Step 4 advance.
      const { listOperations } = await import('../../api/apiBehaviourClient');
      const ops = await listOperations(projectId, architectureId, session.id);
      setParsedOperations(ops);
      const updated: Record<string, boolean> = {};
      for (const op of ops) updated[op.id] = op.included !== false;
      setOperationIncluded(updated);
    } catch (err) {
      // AbortError fires when the 60s deadline trips. Treat any DOMException-
      // shaped AbortError + raw timeout failures the same way: revert the
      // button and surface the "Still working" toast (W-15).
      const isAbort =
        (err as { name?: string })?.name === 'AbortError' ||
        controller.signal.aborted;
      if (isAbort) {
        setExtractToast({
          type: 'info',
          message: 'Still working - refresh in a minute',
        });
      } else {
        setExtractToast({
          type: 'error',
          message: describeError(err),
        });
      }
    } finally {
      window.clearTimeout(timeoutId);
      setExtracting(false);
    }
  }, [
    projectId,
    architectureId,
    extracting,
    selectedInterfaceIds,
    selectedDiscoveryRunIds,
    interfaces,
  ]);

  /**
   * Step 5: PATCH session to `configured`, then `/start`.
   *
   * Model-Seeded Capture Inventory (2026-06-11): /start runs the fail-closed
   * inventory-coverage gate server-side. A 409 with
   * `code: 'INVENTORY_UNACCOUNTED_ENDPOINTS'` (detected via
   * `parseInventoryUnaccountedError` -- by code, never message matching)
   * opens the override dialog instead of the generic error banner. The
   * "Start anyway (override)" re-submit calls this handler again with the
   * justification, which rides the body as `coverageOverrideJustification`.
   */
  const handleStart = useCallback(async (justification?: string) => {
    const session = draftSessionRef.current;
    if (!session || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      await updateCaptureSession(projectId, architectureId, session.id, {
        status: 'configured',
      });

      // Mode 1 send orchestration (Spec 2026-06-23, R4). For a Postman mode we
      // fire the imported items as concrete manual-capture sends BEFORE /start
      // so (b) the per-op delta can subtract the captured set and (c) the
      // Postman-only run has its captures in place. The session is `configured`
      // + secrets were submitted on the Step 4 advance, so manual-capture clears
      // its secrets / included-operation guards. Items that did not cleanly
      // match are gated by the arch-match step (canSend) before any send.
      let postmanCapturedByOp:
        | Record<string, { method: string; path: string; expectedStatus: string | null }[]>
        | undefined;
      const usePostman = modeUsesPostman(postmanRunMode);
      if (usePostman && importedRequests.length > 0) {
        if (!postmanRun.canSend) {
          setError(
            'Resolve every flagged imported request (add to architecture, keep & run, or delete) before starting.',
          );
          setSubmitting(false);
          return;
        }
        const result = await postmanRun.runSends();
        postmanCapturedByOp = result.capturedByOp;
        if (result.secretsRequired) {
          // Secrets were purged / never loaded: surface the wizard error so the
          // user can go back and re-enter them rather than starting half-sent.
          setError(
            'Secrets are not loaded for this session. Re-enter the API/DB secrets, then start again.',
          );
          setSubmitting(false);
          return;
        }
      }

      // Build the start request body. The wizard sends the discovery
      // selections only when the user has opted in via the section's
      // checkbox; the downstream service treats absent fields as defaults
      // (includeDiscoveryContext=true + latest-relevant runs). When the
      // user explicitly unchecks the toggle we send `false` so the
      // backend skips the discovery context fetch entirely.
      const startBody: StartCaptureSessionRequest = {
        includeDiscoveryContext,
      };
      if (includeDiscoveryContext && selectedDiscoveryRunIds.size > 0) {
        startBody.discoveryRunIds = Array.from(selectedDiscoveryRunIds);
      }
      if (includeDiscoveryContext) {
        startBody.maxFindings = 100;
        startBody.maxEvidenceItems = 100;
      }
      // Mode 1c (Postman only): skip the planner + LLM loop and carry the
      // coverage-override so the gate does not fail closed on the intentionally
      // partial coverage. The selector's run mode drives postmanOnly.
      if (postmanRunMode === 'postman-only') {
        startBody.postmanOnly = true;
      }
      // Mode 1b (Postman + LLM delta): forward the per-op captured map so the
      // orchestrator subtracts the Postman-covered candidates before topping up.
      if (postmanRunMode === 'postman-delta' && postmanCapturedByOp) {
        startBody.postmanCapturedByOp = postmanCapturedByOp;
      }
      // The coverage-override justification rides any explicit override re-submit
      // (the 409 dialog) AND is REQUIRED for Mode 1c. For Mode 1c with no manual
      // justification supplied yet, default a Postman-only justification so the
      // coverage gate accepts the deliberately-partial run.
      if (typeof justification === 'string' && justification.trim().length > 0) {
        startBody.coverageOverrideJustification = justification.trim();
      } else if (postmanRunMode === 'postman-only') {
        startBody.coverageOverrideJustification =
          'Postman-only run: coverage is intentionally limited to the imported requests.';
      }
      const running = await startCaptureSession(
        projectId,
        architectureId,
        session.id,
        startBody,
      );
      setOverrideBlock(null);
      onStarted?.(running);
      onClose();
    } catch (err) {
      const blocked = parseInventoryUnaccountedError(err);
      if (blocked) {
        setOverrideBlock({
          unaccounted: blocked.unaccounted,
          totalCount: blocked.unaccountedTotalCount,
        });
        setOverrideJustification('');
      } else {
        setError(describeError(err));
      }
    } finally {
      setSubmitting(false);
    }
  }, [
    projectId,
    architectureId,
    submitting,
    includeDiscoveryContext,
    selectedDiscoveryRunIds,
    postmanRunMode,
    importedRequests,
    postmanRun,
    onStarted,
    onClose,
  ]);

  // ---- Render guard ---------------------------------------------------
  if (!open) return null;

  // ---- Render ----------------------------------------------------------
  return (
    <div
      className={styles.overlay}
      onClick={handleOverlayClick}
      data-testid="start-capture-session-wizard"
    >
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="start-capture-session-wizard-title"
      >
        {/* Header */}
        <div className={styles.header}>
          <h2 className={styles.title} id="start-capture-session-wizard-title">
            Capture API Behaviour Baseline
            {architectureName ? ` — ${architectureName}` : ''}
          </h2>
          <button
            type="button"
            className={styles.closeButton}
            onClick={onClose}
            disabled={submitting}
            data-testid="start-capture-session-wizard-close"
            title="Close"
          >
            &times;
          </button>
        </div>

        {/* Stepper */}
        <div className={styles.stepper} data-testid="start-capture-session-wizard-stepper">
          {([1, 2, 3, 4, 5, 6, 7] as WizardStep[]).map((n, idx) => (
            <React.Fragment key={n}>
              {idx > 0 && (
                <span className={styles.stepSeparator} aria-hidden="true">
                  &rsaquo;
                </span>
              )}
              <span
                className={`${styles.step} ${
                  n === step ? styles.stepActive : n < step ? styles.stepDone : ''
                }`}
                data-testid={`start-capture-session-wizard-step-${n}`}
              >
                {n}.{' '}
                {n === 1
                  ? 'OAS source'
                  : n === 2
                  ? 'API config'
                  : n === 3
                  ? 'DB sampling'
                  : n === 4
                  ? 'Endpoints'
                  : n === 5
                  ? 'Data-type formats'
                  : n === 6
                  ? 'Response semantics'
                  : 'Start'}
              </span>
            </React.Fragment>
          ))}
        </div>

        {/* Content */}
        <div className={styles.content}>
          {step === 1 && (
            <>
              <p className={styles.helperText}>
                Choose which OpenAPI specification(s) to capture against. Pick
                one or more existing <strong>Interface</strong> rows from this
                architecture, or upload an OAS file directly (raw bytes are
                NOT persisted).
              </p>

              {/* Discovery Context section (Spec 2026-05-16 Task Group 4).
                  Collapsed by default; expands automatically when AMS
                  reports findings exist for the active architecture. */}
              <div
                className={styles.discoverySection}
                data-testid="start-capture-session-wizard-discovery-section"
              >
                <div
                  className={styles.discoverySectionHeader}
                  onClick={() => setDiscoverySectionExpanded((v) => !v)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setDiscoverySectionExpanded((v) => !v);
                    }
                  }}
                  data-testid="start-capture-session-wizard-discovery-toggle"
                  aria-expanded={discoverySectionExpanded}
                >
                  <span>
                    <span className={styles.discoverySectionTitle}>
                      Discovery Context (optional)
                    </span>
                    {!discoverySectionExpanded && (
                      <span className={styles.discoverySectionSubtitle}>
                        {discoveryLoading
                          ? 'Loading discovery findings...'
                          : discoveryError
                          ? 'Discovery context unavailable'
                          : (discoveryCtx?.findingsSummary?.totalFindings ?? 0) > 0
                          ? `${discoveryCtx?.findingsSummary?.totalFindings ?? 0} findings available`
                          : 'No discovery findings available for this architecture'}
                      </span>
                    )}
                  </span>
                  <span aria-hidden="true">{discoverySectionExpanded ? 'v' : '>'}</span>
                </div>
                {discoverySectionExpanded && (
                  <div
                    className={styles.discoverySectionBody}
                    data-testid="start-capture-session-wizard-discovery-body"
                  >
                    {discoveryLoading && (
                      <span className={styles.helperText}>Loading...</span>
                    )}
                    {!discoveryLoading && discoveryError && (
                      <div
                        className={styles.discoveryWarningBanner}
                        data-testid="start-capture-session-wizard-discovery-error"
                      >
                        Discovery context unavailable: {discoveryError}. The
                        capture session can still start without discovery
                        context.
                      </div>
                    )}
                    {!discoveryLoading && !discoveryError && discoveryCtx && (
                      <>
                        <label className={styles.label}>
                          <input
                            type="checkbox"
                            checked={includeDiscoveryContext}
                            onChange={(e) => setIncludeDiscoveryContext(e.target.checked)}
                            data-testid="start-capture-session-wizard-include-discovery"
                          />{' '}
                          Include discovery context in capture session
                        </label>
                        {(discoveryCtx.findingsSummary?.totalFindings ?? 0) === 0 ? (
                          <div
                            className={styles.discoveryWarningBanner}
                            data-testid="start-capture-session-wizard-discovery-no-findings"
                          >
                            No discovery findings available for this architecture.
                            The capture session can still start; LLM prompts will
                            be generated from OAS evidence only.
                          </div>
                        ) : (
                          <>
                            <div>
                              <label className={styles.label}>Discovery runs</label>
                              <div
                                className={styles.discoveryRunList}
                                data-testid="start-capture-session-wizard-discovery-run-list"
                              >
                                {(discoveryCtx.discoveryRunsSummary?.runs ?? []).map((run) => (
                                  <label
                                    key={run.runId}
                                    className={styles.discoveryRunItem}
                                    data-testid={`start-capture-session-wizard-discovery-run-${run.runId}`}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={selectedDiscoveryRunIds.has(run.runId)}
                                      disabled={!includeDiscoveryContext}
                                      onChange={(e) => {
                                        setSelectedDiscoveryRunIds((prev) => {
                                          const next = new Set(prev);
                                          if (e.target.checked) next.add(run.runId);
                                          else next.delete(run.runId);
                                          return next;
                                        });
                                      }}
                                    />
                                    <span>
                                      <strong>{run.discoveryKind}</strong>
                                      {' - '}
                                      <span className={styles.helperText}>{run.status}</span>
                                      {' - '}
                                      <span className={styles.helperText}>{run.createdAt}</span>
                                    </span>
                                  </label>
                                ))}
                                {(discoveryCtx.discoveryRunsSummary?.runs ?? []).length === 0 && (
                                  <span className={styles.helperText}>
                                    <em>No discovery runs listed.</em>
                                  </span>
                                )}
                              </div>
                            </div>
                            <div
                              className={styles.discoverySummaryBox}
                              data-testid="start-capture-session-wizard-discovery-summary"
                            >
                              <div>
                                Critical / high severity:{' '}
                                {(discoveryCtx.findingsSummary?.countsBySeverity?.critical ?? 0) +
                                  (discoveryCtx.findingsSummary?.countsBySeverity?.high ?? 0)}
                              </div>
                              <div>
                                Needs review:{' '}
                                {discoveryCtx.findingsSummary?.countsByStatus?.needs_review ?? 0}
                              </div>
                              <div>
                                Sample data hints:{' '}
                                {discoveryCtx.findingsSummary?.sampleDataHintCount ?? 0}
                              </div>
                              <div>
                                Runtime usage findings:{' '}
                                {discoveryCtx.runtimeUsageSummary?.runtimeFindingCount ?? 0}
                              </div>
                              <div>
                                Database discovery findings:{' '}
                                {discoveryCtx.databaseDiscoverySummary?.databaseFindingCount ?? 0}
                              </div>
                              <div>
                                Unresolved decision tasks:{' '}
                                {(discoveryCtx.unresolvedDecisionTasks ?? []).length}
                              </div>
                            </div>
                          </>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>

              <div className={styles.fieldGroup}>
                <label className={styles.label}>Interfaces in this architecture</label>
                <div
                  className={styles.interfaceList}
                  data-testid="start-capture-session-wizard-interface-list"
                >
                  {interfaces.length === 0 && (
                    <div className={styles.interfaceItem}>
                      <em>No interfaces in this architecture.</em>
                    </div>
                  )}
                  {interfaces.map((iface) => (
                    <label key={iface.id} className={styles.interfaceItem}>
                      <input
                        type="checkbox"
                        checked={selectedInterfaceIds.has(iface.id)}
                        onChange={(e) => {
                          setSelectedInterfaceIds((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(iface.id);
                            else next.delete(iface.id);
                            return next;
                          });
                        }}
                        data-testid={`start-capture-session-wizard-interface-${iface.id}`}
                      />
                      <span>{iface.name}</span>
                      {iface.spec_link ? (
                        <span className={styles.helperText}> — {iface.spec_link}</span>
                      ) : (
                        <span className={styles.helperText}> — (no spec_link)</span>
                      )}
                    </label>
                  ))}
                </div>
              </div>
              <div className={styles.fieldGroup}>
                <label className={styles.label}>
                  Or upload an OAS (.json/.yaml) or a WADL + its XSD grammar
                  file(s)
                </label>
                <input
                  type="file"
                  multiple
                  accept=".json,.yaml,.yml,.wadl,.xsd,application/json"
                  onChange={(e) =>
                    setOasFiles(e.target.files ? Array.from(e.target.files) : [])
                  }
                  data-testid="start-capture-session-wizard-oas-file"
                />
                {oasFiles.length > 0 && (
                  <span className={styles.helperText}>
                    {oasFiles.map((f) => f.name).join(', ')}
                  </span>
                )}
                <span className={styles.helperText}>
                  For a WADL, upload it together with every XSD grammar file it
                  references. If a grammar is missing, the parse step names the
                  exact .xsd to add.
                </span>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <div className={styles.fieldGroup}>
                <label className={styles.label} htmlFor="csw-env-name">
                  Environment name
                </label>
                <input
                  id="csw-env-name"
                  className={styles.input}
                  value={step2.envName}
                  onChange={(e) => setStep2((s) => ({ ...s, envName: e.target.value }))}
                  data-testid="start-capture-session-wizard-env-name"
                />
              </div>
              <div className={styles.fieldGroup}>
                <label className={styles.label} htmlFor="csw-base-url">
                  API base URL
                </label>
                <input
                  id="csw-base-url"
                  className={styles.input}
                  value={step2.baseUrl}
                  onChange={(e) => setStep2((s) => ({ ...s, baseUrl: e.target.value }))}
                  placeholder="https://api.nonprod.example.com"
                  data-testid="start-capture-session-wizard-base-url"
                />
              </div>
              <div className={styles.fieldGroup}>
                <label className={styles.label} htmlFor="csw-auth-type">
                  Auth type
                </label>
                <select
                  id="csw-auth-type"
                  className={styles.select}
                  value={step2.authType}
                  onChange={(e) =>
                    setStep2((s) => ({ ...s, authType: e.target.value as AuthType }))
                  }
                  data-testid="start-capture-session-wizard-auth-type"
                >
                  <option value="none">None</option>
                  <option value="bearer">Bearer token</option>
                  <option value="basic">Basic</option>
                  <option value="sso_token">ssoToken (in header)</option>
                  <option value="header">Custom header</option>
                </select>
              </div>
              {step2.authType === 'bearer' && (
                <div className={styles.fieldGroup}>
                  <label className={styles.label}>Bearer token</label>
                  <input
                    type="password"
                    className={styles.input}
                    value={step2.bearerToken}
                    onChange={(e) => setStep2((s) => ({ ...s, bearerToken: e.target.value }))}
                    data-testid="start-capture-session-wizard-bearer-token"
                  />
                </div>
              )}
              {step2.authType === 'basic' && (
                <>
                  <div className={styles.fieldGroup}>
                    <label className={styles.label}>Username</label>
                    <input
                      className={styles.input}
                      value={step2.basicUsername}
                      onChange={(e) => setStep2((s) => ({ ...s, basicUsername: e.target.value }))}
                    />
                  </div>
                  <div className={styles.fieldGroup}>
                    <label className={styles.label}>Password</label>
                    <input
                      type="password"
                      className={styles.input}
                      value={step2.basicPassword}
                      onChange={(e) => setStep2((s) => ({ ...s, basicPassword: e.target.value }))}
                    />
                  </div>
                </>
              )}
              {step2.authType === 'sso_token' && (
                <div className={styles.fieldGroup}>
                  <label className={styles.label}>SSO token value</label>
                  <input
                    type="password"
                    className={styles.input}
                    value={step2.ssoToken}
                    onChange={(e) => setStep2((s) => ({ ...s, ssoToken: e.target.value }))}
                    data-testid="start-capture-session-wizard-sso-token"
                    placeholder="Paste the ssoToken value — sent as the 'ssoToken' header (spaces trimmed)"
                  />
                </div>
              )}
              {step2.authType === 'header' && (
                <>
                  <div className={styles.fieldGroup}>
                    <label className={styles.label}>Header name</label>
                    <input
                      className={styles.input}
                      value={step2.headerName}
                      onChange={(e) => setStep2((s) => ({ ...s, headerName: e.target.value }))}
                    />
                  </div>
                  <div className={styles.fieldGroup}>
                    <label className={styles.label}>Header value</label>
                    <input
                      type="password"
                      className={styles.input}
                      value={step2.headerValue}
                      onChange={(e) => setStep2((s) => ({ ...s, headerValue: e.target.value }))}
                    />
                  </div>
                </>
              )}
              <div className={styles.fieldGroup}>
                <label className={styles.label} htmlFor="csw-default-headers">
                  Default headers (one "Name: Value" per line)
                </label>
                <textarea
                  id="csw-default-headers"
                  className={styles.textarea}
                  value={step2.defaultHeadersText}
                  onChange={(e) =>
                    setStep2((s) => ({ ...s, defaultHeadersText: e.target.value }))
                  }
                  data-testid="start-capture-session-wizard-default-headers"
                />
              </div>
              <div className={styles.fieldGroup}>
                <label className={styles.label}>
                  <input
                    type="checkbox"
                    checked={step2.mutatingCallsConfirmed}
                    onChange={(e) =>
                      setStep2((s) => ({ ...s, mutatingCallsConfirmed: e.target.checked }))
                    }
                    data-testid="start-capture-session-wizard-mutating-confirm"
                  />{' '}
                  I confirm this is a non-prod migration-test environment and
                  mutating API calls are allowed.
                </label>
              </div>

              {/* In-wizard "Test API connection" probe (Fix C 2026-06-02).
                  Fires one stateless call with the current Step-2 config and
                  renders the HTTP status + duration (or the error) inline.
                  Advisory only -- never gates the Next button. */}
              <div className={styles.testConnectionRow}>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={handleTestConnection}
                  disabled={testingConn || step2.baseUrl.trim().length === 0}
                  data-testid="start-capture-session-wizard-test-connection"
                >
                  {testingConn ? 'Testing connection…' : 'Test API connection'}
                </button>
                {connResult && (
                  <div
                    className={
                      connResult.ok && connResult.data.authRejected
                        ? styles.testConnectionResultWarn
                        : connResult.ok && connResult.data.success
                          ? styles.testConnectionResultOk
                          : styles.testConnectionResultError
                    }
                    role="status"
                    data-testid="start-capture-session-wizard-test-connection-result"
                  >
                    {connResult.ok ? (
                      // Check auth-rejection FIRST: a 401/403 also satisfies the
                      // `success` (<500) flag, but it means the token was refused
                      // -- it must NOT render as a green "Success".
                      connResult.data.authRejected ? (
                        <span>
                          Reachable, but auth was rejected — HTTP{' '}
                          {connResult.data.status} ({connResult.data.durationMs} ms).
                          Check the token is valid and not expired.
                        </span>
                      ) : connResult.data.success ? (
                        <span>
                          Success — HTTP {connResult.data.status} in{' '}
                          {connResult.data.durationMs} ms
                        </span>
                      ) : (
                        <span>
                          Failed
                          {typeof connResult.data.status === 'number' &&
                          connResult.data.status > 0
                            ? ` — HTTP ${connResult.data.status}`
                            : ''}{' '}
                          ({connResult.data.durationMs} ms)
                          {connResult.data.error ? `: ${connResult.data.error}` : ''}
                        </span>
                      )
                    ) : (
                      <span>Failed: {connResult.message}</span>
                    )}
                  </div>
                )}
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <p className={styles.helperText}>
                Optional — connect a non-prod database so the LLM can read
                sample data when generating realistic scenarios.
              </p>
              <div className={styles.fieldGroup}>
                <label className={styles.label} htmlFor="csw-db-type">
                  DB type
                </label>
                <select
                  id="csw-db-type"
                  className={styles.select}
                  value={step3.dbType}
                  onChange={(e) =>
                    setStep3((s) => ({ ...s, dbType: e.target.value as DbType }))
                  }
                  data-testid="start-capture-session-wizard-db-type"
                >
                  <option value="none">None (skip DB sampling)</option>
                  <option value="postgres">PostgreSQL</option>
                  <option
                    value="sybase"
                    data-testid="start-capture-session-wizard-db-type-sybase"
                  >
                    Sybase ASE
                  </option>
                </select>
              </div>
              {showDbDetailFields && (
                <>
                  <div className={styles.fieldGroup}>
                    <label className={styles.label}>Host</label>
                    <input
                      className={styles.input}
                      value={step3.host}
                      onChange={(e) => setStep3((s) => ({ ...s, host: e.target.value }))}
                    />
                  </div>
                  <div className={styles.fieldGroup}>
                    <label className={styles.label}>Port</label>
                    <input
                      className={styles.input}
                      value={step3.port}
                      onChange={(e) => setStep3((s) => ({ ...s, port: e.target.value }))}
                    />
                  </div>
                  <div className={styles.fieldGroup}>
                    <label className={styles.label}>Database</label>
                    <input
                      className={styles.input}
                      value={step3.database}
                      onChange={(e) => setStep3((s) => ({ ...s, database: e.target.value }))}
                    />
                  </div>
                  <div className={styles.fieldGroup}>
                    <label className={styles.label}>Schema (optional)</label>
                    <input
                      className={styles.input}
                      value={step3.schema}
                      onChange={(e) => setStep3((s) => ({ ...s, schema: e.target.value }))}
                    />
                  </div>
                  <div className={styles.fieldGroup}>
                    <label className={styles.label}>Username</label>
                    <input
                      className={styles.input}
                      value={step3.username}
                      onChange={(e) => setStep3((s) => ({ ...s, username: e.target.value }))}
                    />
                  </div>
                  <div className={styles.fieldGroup}>
                    <label className={styles.label}>Password</label>
                    <input
                      type="password"
                      className={styles.input}
                      value={step3.password}
                      onChange={(e) => setStep3((s) => ({ ...s, password: e.target.value }))}
                    />
                  </div>
                  <div className={styles.fieldGroup}>
                    <label className={styles.label}>
                      Allowlist (comma-separated table names)
                    </label>
                    <input
                      className={styles.input}
                      value={step3.allowlistText}
                      onChange={(e) =>
                        setStep3((s) => ({ ...s, allowlistText: e.target.value }))
                      }
                    />
                  </div>
                </>
              )}
            </>
          )}

          {step === 4 && (
            <>
              <p className={styles.helperText}>
                Review the operations parsed from your OAS spec. Untick any
                you do not want included in the capture run.
              </p>
              <div
                className={styles.operationList}
                data-testid="start-capture-session-wizard-operation-list"
              >
                {parsedOperations.length === 0 && (() => {
                  // Step 4 empty-state -- LLM endpoint extraction branch.
                  // Show the SOAP-specific "Extract endpoints with LLM"
                  // banner only when (a) zero rows came back from
                  // parse-oas / candidate prepopulation AND (b) at least
                  // one selected interface is a SOAP_API. Falls back to
                  // the original "No operations parsed." message for
                  // every other zero-row case (REST with no ops, etc.).
                  const soapInterfaceSelected = Array.from(selectedInterfaceIds).some((id) => {
                    const iface = interfaces.find((i) => i.id === id);
                    return iface?.interface_type === 'SOAP_API';
                  });
                  if (soapInterfaceSelected) {
                    return (
                      <div
                        className={styles.operationItem}
                        style={{ flexDirection: 'column', alignItems: 'center', padding: '24px 16px' }}
                        data-testid="start-capture-session-wizard-extract-empty-state"
                      >
                        <span style={{ textAlign: 'center', marginBottom: '12px' }}>
                          No endpoints detected. Try LLM extraction?
                        </span>
                        <button
                          type="button"
                          className={styles.primaryButton}
                          onClick={handleExtractEndpointsWithLlm}
                          disabled={extracting || cloneEvicted}
                          data-testid="start-capture-session-wizard-extract-endpoints-llm"
                        >
                          {extracting ? 'Analysing source files...' : 'Extract endpoints with LLM'}
                        </button>
                        {cloneEvicted && (
                          <span
                            className={styles.helperText}
                            style={{ marginTop: '8px' }}
                            data-testid="start-capture-session-wizard-extract-clone-evicted"
                          >
                            Source no longer cached - re-run discovery
                          </span>
                        )}
                      </div>
                    );
                  }
                  return (
                    <div className={styles.operationItem}>
                      <em>No operations parsed.</em>
                    </div>
                  );
                })()}
                {parsedOperations.map((op) => {
                  const isMutating = isMutatingMethod(op.method);
                  const mutatingExcluded =
                    isMutating && !step2.mutatingCallsConfirmed;
                  const checked = operationIncluded[op.id] ?? op.included !== false;
                  return (
                    <label
                      key={op.id}
                      className={styles.operationItem}
                      data-testid={`start-capture-session-wizard-operation-${op.id}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked && !mutatingExcluded}
                        disabled={mutatingExcluded}
                        onChange={(e) =>
                          setOperationIncluded((m) => ({ ...m, [op.id]: e.target.checked }))
                        }
                      />
                      <span>
                        <strong>{op.method}</strong> {op.path}
                        {op.summary ? ` — ${op.summary}` : ''}
                      </span>
                      {mutatingExcluded && (
                        <span className={styles.operationMutatingExcluded}>
                          excluded — mutating not confirmed
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>

              {/* Postman import (Spec 2026-06-23, Task Group 8). The 3-way
                  run-mode selector + collection upload + the shared staging
                  table + the arch-match warning step. Mode 1b/c fire the
                  imported items as concrete manual-capture sends AFTER /start. */}
              <PostmanImportWizardStep
                projectId={projectId}
                architectureId={architectureId}
                sessionId={draftSessionId}
                mode={postmanRunMode}
                onModeChange={setPostmanRunMode}
                importedRequests={importedRequests}
                onImportedRequestsChange={setImportedRequests}
                operations={parsedOperations}
                reconciliation={reconciliation}
                flagged={postmanRun.flagged}
                resolutions={postmanRun.resolutions}
                onResolutionChange={postmanRun.setResolution}
                onOperationAdded={postmanRun.addOperationRow}
                onDeleteItem={postmanRun.deleteItem}
              />

              {/* ------------------------------------------------------------
                  Inventory reconciliation sections (Model-Seeded Capture
                  Inventory spec, 2026-06-11). Rendered straight from the AMS
                  reconciliation payload -- never reshaped client-side.
                  ------------------------------------------------------------ */}
              {reconciliationError && (
                <div
                  className={styles.discoveryWarningBanner}
                  data-testid="start-capture-session-wizard-reconciliation-error"
                >
                  Inventory reconciliation unavailable: {reconciliationError}.
                  The coverage gate still runs (and fails closed) at Start.
                </div>
              )}
              {reconciliation && (
                <>
                  {/* Both coverage figures, prominently (D7). */}
                  <div
                    className={styles.coverageFigures}
                    data-testid="start-capture-session-wizard-coverage"
                  >
                    <span
                      className={styles.coverageFigure}
                      data-testid="start-capture-session-wizard-coverage-in-scope"
                    >
                      Selected scope coverage:{' '}
                      {reconciliation.in_scope_coverage_pct ?? '—'}% (
                      {reconciliation.in_scope_accounted_count ?? 0} of{' '}
                      {reconciliation.in_scope_total_count ?? 0} endpoints accounted)
                    </span>
                    <span
                      className={styles.coverageFigure}
                      data-testid="start-capture-session-wizard-coverage-architecture"
                    >
                      Whole architecture:{' '}
                      {reconciliation.architecture_coverage_pct ?? '—'}% (
                      {reconciliation.architecture_accounted_count ?? 0} of{' '}
                      {reconciliation.architecture_total_count ?? 0})
                    </span>
                  </div>

                  {/* Unmatched committed endpoints: include / exclude-with-
                      reason / include-all. Start is hard-blocked server-side
                      while any remain unaccounted. */}
                  <div
                    className={styles.fieldGroup}
                    data-testid="start-capture-session-wizard-unmatched-section"
                  >
                    <div className={styles.reconciliationSectionHeader}>
                      <label className={styles.label}>
                        Unmatched committed endpoints (
                        {reconciliation.in_scope_unaccounted_endpoints.length})
                      </label>
                      {reconciliation.in_scope_unaccounted_endpoints.length > 0 && (
                        <button
                          type="button"
                          className={styles.secondaryButton}
                          onClick={() =>
                            void handleAccountEndpoints(
                              reconciliation.in_scope_unaccounted_endpoints.map(
                                (e) => ({
                                  endpoint_id: e.endpoint_id,
                                  action: 'include' as const,
                                }),
                              ),
                            )
                          }
                          disabled={accountingInFlight || submitting}
                          data-testid="start-capture-session-wizard-include-all"
                        >
                          {accountingInFlight ? 'Saving…' : 'Include all'}
                        </button>
                      )}
                    </div>
                    {reconciliation.in_scope_unaccounted_endpoints.length === 0 ? (
                      <span
                        className={styles.helperText}
                        data-testid="start-capture-session-wizard-unmatched-empty"
                      >
                        Every in-scope committed endpoint is accounted for.
                      </span>
                    ) : (
                      <>
                        <span className={styles.helperText}>
                          These endpoints are committed to the architecture
                          model but have no operation row in this session (the
                          spec file may be stale or partial). Include each one
                          (a schema-less operation row is auto-created from the
                          endpoint metadata) or exclude it with a reason —
                          Start is blocked while any remain unaccounted.
                        </span>
                        <div className={styles.operationList}>
                          {reconciliation.in_scope_unaccounted_endpoints.map((ep) => {
                            const draft = excludeDrafts[ep.endpoint_id];
                            const excludeOpen = draft !== undefined;
                            return (
                              <div
                                key={ep.endpoint_id}
                                className={styles.operationItem}
                                data-testid={`start-capture-session-wizard-unmatched-${ep.endpoint_id}`}
                              >
                                <span>
                                  {ep.method && ep.path ? (
                                    <>
                                      <strong>{ep.method}</strong> {ep.path}
                                    </>
                                  ) : (
                                    <strong>
                                      {ep.soap_action
                                        ? `SOAP: ${ep.soap_action}`
                                        : ep.key}
                                    </strong>
                                  )}
                                  {ep.name ? ` — ${ep.name}` : ''}
                                </span>
                                <span className={styles.endpointActions}>
                                  {!excludeOpen && (
                                    <>
                                      <button
                                        type="button"
                                        className={styles.secondaryButton}
                                        onClick={() =>
                                          void handleAccountEndpoints([
                                            {
                                              endpoint_id: ep.endpoint_id,
                                              action: 'include',
                                            },
                                          ])
                                        }
                                        disabled={accountingInFlight || submitting}
                                        data-testid={`start-capture-session-wizard-include-${ep.endpoint_id}`}
                                      >
                                        Include
                                      </button>
                                      <button
                                        type="button"
                                        className={styles.secondaryButton}
                                        onClick={() =>
                                          setExcludeDrafts((p) => ({
                                            ...p,
                                            [ep.endpoint_id]: '',
                                          }))
                                        }
                                        disabled={accountingInFlight || submitting}
                                        data-testid={`start-capture-session-wizard-exclude-${ep.endpoint_id}`}
                                      >
                                        Exclude…
                                      </button>
                                    </>
                                  )}
                                  {excludeOpen && (
                                    <>
                                      <input
                                        className={styles.input}
                                        placeholder="Exclusion reason (required)"
                                        value={draft}
                                        onChange={(e) =>
                                          setExcludeDrafts((p) => ({
                                            ...p,
                                            [ep.endpoint_id]: e.target.value,
                                          }))
                                        }
                                        data-testid={`start-capture-session-wizard-exclude-reason-${ep.endpoint_id}`}
                                      />
                                      <button
                                        type="button"
                                        className={styles.primaryButton}
                                        onClick={() =>
                                          void handleAccountEndpoints([
                                            {
                                              endpoint_id: ep.endpoint_id,
                                              action: 'exclude',
                                              reason: draft.trim(),
                                            },
                                          ])
                                        }
                                        disabled={
                                          accountingInFlight ||
                                          submitting ||
                                          draft.trim().length === 0
                                        }
                                        data-testid={`start-capture-session-wizard-exclude-confirm-${ep.endpoint_id}`}
                                      >
                                        Confirm exclude
                                      </button>
                                      <button
                                        type="button"
                                        className={styles.secondaryButton}
                                        onClick={() =>
                                          setExcludeDrafts((p) => {
                                            const next = { ...p };
                                            delete next[ep.endpoint_id];
                                            return next;
                                          })
                                        }
                                        disabled={accountingInFlight}
                                        data-testid={`start-capture-session-wizard-exclude-cancel-${ep.endpoint_id}`}
                                      >
                                        Cancel
                                      </button>
                                    </>
                                  )}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </div>

                  {/* Discovery gaps: operations the committed model does not
                      know (informational; a reconciliation finding was
                      emitted server-side -- rendered straight from the
                      reconciliation response, no separate findings fetch). */}
                  {reconciliation.operations_without_model_endpoint.length > 0 && (
                    <div
                      className={styles.fieldGroup}
                      data-testid="start-capture-session-wizard-discovery-gaps"
                    >
                      <label className={styles.label}>
                        Discovery gaps (
                        {reconciliation.operations_without_model_endpoint.length})
                      </label>
                      <span className={styles.helperText}>
                        These session operations have no matching endpoint in
                        the committed architecture model — the harness knows
                        something discovery does not. A reconciliation finding
                        has been recorded for each so the gap becomes a visible
                        work item.
                      </span>
                      <div className={styles.operationList}>
                        {reconciliation.operations_without_model_endpoint.map((op) => (
                          <div
                            key={op.operation_row_id}
                            className={styles.operationItem}
                            data-testid={`start-capture-session-wizard-discovery-gap-${op.operation_row_id}`}
                          >
                            <span>
                              {op.method && op.path ? (
                                <>
                                  <strong>{op.method}</strong> {op.path}
                                </>
                              ) : (
                                <strong>{op.key}</strong>
                              )}
                              {op.operation_id ? ` — ${op.operation_id}` : ''}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Excluded by scope: bulk visibility under one reason --
                      never silently absent (D7). Collapsed by default. */}
                  {reconciliation.excluded_by_scope_endpoints.length > 0 && (
                    <div
                      className={styles.discoverySection}
                      data-testid="start-capture-session-wizard-excluded-by-scope"
                    >
                      <div
                        className={styles.discoverySectionHeader}
                        onClick={() => setExcludedByScopeExpanded((v) => !v)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setExcludedByScopeExpanded((v) => !v);
                          }
                        }}
                        aria-expanded={excludedByScopeExpanded}
                        data-testid="start-capture-session-wizard-excluded-by-scope-toggle"
                      >
                        <span>
                          <span className={styles.discoverySectionTitle}>
                            Excluded by scope (
                            {reconciliation.excluded_by_scope_endpoints.length})
                          </span>
                          <span className={styles.discoverySectionSubtitle}>
                            excluded by scope (interface not selected)
                          </span>
                        </span>
                        <span aria-hidden="true">
                          {excludedByScopeExpanded ? 'v' : '>'}
                        </span>
                      </div>
                      {excludedByScopeExpanded && (
                        <div
                          className={styles.discoverySectionBody}
                          data-testid="start-capture-session-wizard-excluded-by-scope-body"
                        >
                          {reconciliation.excluded_by_scope_endpoints.map((ep) => (
                            <span
                              key={ep.endpoint_id}
                              className={styles.helperText}
                              data-testid={`start-capture-session-wizard-excluded-by-scope-${ep.endpoint_id}`}
                            >
                              {ep.name ?? ep.key} — {ep.key}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {step === 5 && (
            <DataTypeFormatsStep
              rows={dataTypeRows}
              values={dataTypeDefaults}
              loading={dataTypePreviewLoading}
              styles={styles}
              onChange={(category, value) =>
                setDataTypeDefaults((prev) => ({ ...prev, [category]: value }))
              }
            />
          )}

          {step === 6 && (
            <BehaviourSemanticsConfigStep
              value={behaviourSemanticsConfig}
              styles={styles}
              onChange={(next) => setBehaviourSemanticsConfig(next)}
            />
          )}

          {step === 7 && (
            <>
              <p className={styles.helperText}>
                Review the redacted configuration below, then start the
                capture loop. Secrets stay in process memory only — they are
                never persisted.
              </p>
              <div className={styles.summarySection}>
                <div>
                  <span className={styles.summaryKey}>Environment:</span>
                  {step2.envName}
                </div>
                <div>
                  <span className={styles.summaryKey}>API base URL:</span>
                  {step2.baseUrl}
                </div>
                <div>
                  <span className={styles.summaryKey}>Auth type:</span>
                  {step2.authType === 'sso_token' ? 'ssoToken (in header)' : step2.authType}
                </div>
                <div>
                  <span className={styles.summaryKey}>Mutating calls confirmed:</span>
                  {step2.mutatingCallsConfirmed ? 'Yes' : 'No'}
                </div>
                <div>
                  <span className={styles.summaryKey}>DB sampling:</span>
                  {step3.dbType === 'none' ? 'disabled' : step3.dbType}
                </div>
                <div>
                  <span className={styles.summaryKey}>Operations included:</span>
                  {
                    parsedOperations.filter(
                      (op) =>
                        (operationIncluded[op.id] ?? op.included !== false) &&
                        (!isMutatingMethod(op.method) || step2.mutatingCallsConfirmed),
                    ).length
                  }{' '}
                  / {parsedOperations.length}
                </div>
              </div>

              {/* 409 INVENTORY_UNACCOUNTED_ENDPOINTS override flow (Model-
                  Seeded Capture Inventory, 2026-06-11). Rendered from the 409
                  body's embedded refs (capped at 50 + total count); the
                  re-submit passes coverageOverrideJustification, which the
                  validation service persists as the audit trio. */}
              {overrideBlock && (
                <div
                  className={styles.overrideDialog}
                  role="alertdialog"
                  aria-label="Unaccounted endpoints override"
                  data-testid="start-capture-session-wizard-override-dialog"
                >
                  <strong>
                    Start blocked: {overrideBlock.totalCount} in-scope committed
                    endpoint(s) have no operation row and no exclusion.
                  </strong>
                  <span className={styles.helperText}>
                    Go back to the Endpoints step to include or exclude each
                    one, or provide a justification to start anyway. The
                    override (justification, count, timestamp) is persisted on
                    the session for audit.
                  </span>
                  <div className={styles.operationList}>
                    {overrideBlock.unaccounted.map((ep) => (
                      <div
                        key={ep.endpoint_id}
                        className={styles.operationItem}
                        data-testid={`start-capture-session-wizard-override-endpoint-${ep.endpoint_id}`}
                      >
                        <span>
                          {ep.method && ep.path ? (
                            <>
                              <strong>{ep.method}</strong> {ep.path}
                            </>
                          ) : (
                            <strong>
                              {ep.soap_action ? `SOAP: ${ep.soap_action}` : ep.key}
                            </strong>
                          )}
                          {ep.name ? ` — ${ep.name}` : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                  {overrideBlock.totalCount > overrideBlock.unaccounted.length && (
                    <span className={styles.helperText}>
                      …and{' '}
                      {overrideBlock.totalCount - overrideBlock.unaccounted.length}{' '}
                      more not shown.
                    </span>
                  )}
                  <label className={styles.label} htmlFor="csw-override-justification">
                    Override justification (required)
                  </label>
                  <textarea
                    id="csw-override-justification"
                    className={styles.textarea}
                    value={overrideJustification}
                    onChange={(e) => setOverrideJustification(e.target.value)}
                    data-testid="start-capture-session-wizard-override-justification"
                  />
                  <div className={styles.overrideActions}>
                    <button
                      type="button"
                      className={styles.primaryButton}
                      onClick={() => void handleStart(overrideJustification)}
                      disabled={
                        submitting || overrideJustification.trim().length === 0
                      }
                      data-testid="start-capture-session-wizard-override-start"
                    >
                      {submitting ? 'Starting…' : 'Start anyway (override)'}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {error && (
            <div className={styles.errorBanner} role="alert" data-testid="start-capture-session-wizard-error">
              {error}
            </div>
          )}
        </div>

        {/* Extract-endpoints toast (Spec 2026-05-17 Task Group 6) */}
        {extractToast && (
          <div
            role="alert"
            data-testid="start-capture-session-wizard-extract-toast"
            style={{
              position: 'absolute',
              bottom: '80px',
              left: '50%',
              transform: 'translateX(-50%)',
              padding: '12px 16px',
              borderRadius: '4px',
              color: '#fff',
              background: extractToast.type === 'error' ? '#c62828' : '#1976d2',
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
              zIndex: 10,
            }}
          >
            <span>{extractToast.message}</span>
            <button
              type="button"
              onClick={() => setExtractToast(null)}
              style={{ marginLeft: '12px', background: 'transparent', color: '#fff', border: 0, cursor: 'pointer' }}
              aria-label="Dismiss notification"
            >
              &times;
            </button>
          </div>
        )}

        {/* Footer */}
        <div className={styles.footer}>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={onClose}
            disabled={submitting}
            data-testid="start-capture-session-wizard-cancel"
          >
            Cancel
          </button>
          {step > 1 && (
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => setStep((s) => Math.max(1, (s - 1) as WizardStep) as WizardStep)}
              disabled={submitting}
              data-testid="start-capture-session-wizard-back"
            >
              Back
            </button>
          )}
          {step === 1 && (
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => setStep(2)}
              disabled={!canAdvanceStep1 || submitting}
              data-testid="start-capture-session-wizard-next"
            >
              Next
            </button>
          )}
          {step === 2 && (
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => setStep(3)}
              disabled={!canAdvanceStep2 || submitting}
              data-testid="start-capture-session-wizard-next"
            >
              Next
            </button>
          )}
          {step === 3 && (
            <button
              type="button"
              className={styles.primaryButton}
              onClick={handleAdvanceToStep4}
              disabled={!canAdvanceStep3 || submitting}
              data-testid="start-capture-session-wizard-next"
            >
              {submitting ? 'Parsing OAS…' : 'Next'}
            </button>
          )}
          {step === 4 && (
            <button
              type="button"
              className={styles.primaryButton}
              onClick={handleAdvanceToStep5}
              disabled={submitting}
              data-testid="start-capture-session-wizard-next"
            >
              {submitting ? 'Saving…' : 'Next'}
            </button>
          )}
          {step === 5 && (
            <button
              type="button"
              className={styles.primaryButton}
              onClick={handleAdvanceToStep6}
              disabled={submitting}
              data-testid="start-capture-session-wizard-next"
            >
              {submitting ? 'Saving…' : 'Next'}
            </button>
          )}
          {step === 6 && (
            <button
              type="button"
              className={styles.primaryButton}
              onClick={handleAdvanceToStep7}
              disabled={submitting}
              data-testid="start-capture-session-wizard-next"
            >
              {submitting ? 'Saving…' : 'Next'}
            </button>
          )}
          {step === 7 && (
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => void handleStart()}
              disabled={submitting}
              data-testid="start-capture-session-wizard-start"
            >
              {submitting ? 'Starting…' : 'Start'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default StartCaptureSessionWizard;
