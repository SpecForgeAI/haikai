/**
 * MigrationDeliveryPlanWizard
 *
 * Spec: 2026-05-17 PM Migration Delivery Plan + Draft Book-of-Work Generation
 *   agent-os/specs/2026-05-17-pm-migration-delivery-plan-book-of-work-draft/spec.md
 * Task Group 9 — Generation Wizard (7-Stage Conversation Flow).
 *
 * Guides a Product Manager through the seven-stage conversation per spec.md:
 *   1. Input selection + context check.
 *   2. Migration intent (multi-select).
 *   3. Delivery streams (multi-select; defaults from Migration Discovery
 *      Context where context provides hints).
 *   4. Migration style (single-select; pre-selected from context recommendation
 *      where available).
 *   5. Data + cutover assumptions (concise single-selects).
 *   6. Migration Test Pack expectations (multi-select; defaults from context).
 *   7. Generate draft — final review of answers + Generate button which
 *      invokes the gateway-orchestrated handler.
 *
 * Notes on hard constraints lifted from spec.md / shaping notes:
 *   - Functional equivalence is mandatory and is NEVER asked of the user (this
 *     is a spec.md hard constraint -- not a Q-x design point).
 *   - `unknown` is a sentinel workstream value used by the LLM (Q-7's 14-value
 *     enum) — not surfaced in wizard chips; never offered to the user as a
 *     "guess" option.
 *   - The wizard collects answers only; the LLM, schema validation, AMS
 *     persistence, and the progress overlay all live downstream.
 *
 * Design-point references (so future readers can trace back to shaping-notes):
 *   - Q-15: single synchronous LLM call; the wizard does NOT stream tokens.
 *     Progress markers shown after the user clicks "Generate" are CLIENT-SIDE
 *     SCRIPTED milestones (see `MigrationDeliveryPlanProgressSummary`),
 *     correlated to gateway diagnostic log lines.
 *   - Q-17: auth gating matches the existing `product-manager--backlog` task
 *     verbatim — no new role, permission flag, or gating layer. The wizard
 *     surfaces only to users who already see PM tasks.
 *   - Q-18: the wizard is launched from the existing PM task menu alongside
 *     the other product-manager tasks (e.g. backlog, define-product); the
 *     entry point is `product-manager--migration-delivery-plan`.
 *
 * Stage-7 closeout (Spec 5 Phase 2 follow-up, 2026-06-25): the final review
 * screen ALSO surfaces a "Manifest Uploaded" line listing the confirmed
 * dependency manifests persisted for the chosen target architecture. It is read
 * via the gateway manifest-artifacts READ proxy (`fetchLatestTargetManifests`)
 * and is FAIL-SOFT — a degraded read renders "None" and never blocks Generate.
 *
 * The wizard is intentionally self-contained: it imports a small API client
 * (`migrationDeliveryPlanApi`) and the existing
 * `fetchMigrationDiscoveryContext` resolver, and signals completion by
 * invoking the parent's `onGenerationComplete` callback with the returned
 * draft envelope. The parent surface (typically
 * `MigrationDeliveryPlanProgressSummary`) is responsible for showing the
 * scripted progress overlay and routing to the review workspace.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  fetchMigrationDiscoveryContext,
  MigrationDiscoveryContext,
} from '../../../api/migrationDiscoveryContextApi';
import {
  getGapWayfindingEntry,
  type GapWayfindingContext,
} from '../../../config/gapWayfindingRegistry';
import {
  generateMigrationDeliveryPlan,
  GenerateMigrationDeliveryPlanResponse,
  MigrationDataAndCutoverAssumptions,
  MigrationDeliveryPlanWizardAnswers,
} from '../../../api/migrationDeliveryPlanApi';
import {
  fetchLatestTargetManifests,
  formatLatestTargetManifestLabel,
  type LatestTargetManifest,
} from '../../../api/targetManifestApi';
import {
  listTargetArchitectures,
  type TargetArchitectureDto,
} from '../../../api/targetArchitecturesApi';
import {
  listCapturedDecisions,
  resolveCapturedAnswerLabel,
  type CapturedDecisionDto,
} from '../../../api/architectConversationApi';
import styles from './MigrationDeliveryPlanWizard.module.css';

// ============================================================================
// Vocabularies (verbatim from spec.md / user instructions)
// ============================================================================

/**
 * Stage 2 — migration intent chips. Functional equivalence is intentionally
 * absent (mandatory per spec; never asked). `unsure, infer from architecture
 * and discovery context` is the explicit catch-all chip per spec.md.
 */
export const MIGRATION_INTENT_OPTIONS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'like_for_like_replacement', label: 'Like-for-like replacement' },
  {
    key: 'technical_modernisation_replatforming',
    label: 'Technical modernisation / replatforming',
  },
  {
    key: 'monolith_to_service_decomposition',
    label: 'Monolith-to-service decomposition',
  },
  { key: 'database_schema_migration', label: 'Database / schema migration' },
  { key: 'cloud_infrastructure_migration', label: 'Cloud / infrastructure migration' },
  {
    key: 'api_soap_integration_migration',
    label: 'API / SOAP / integration migration',
  },
  { key: 'data_migration', label: 'Data migration' },
  {
    key: 'cutover_decommissioning',
    label: 'Cutover / decommissioning',
  },
  {
    key: 'unsure_infer_from_context',
    label: 'Unsure - infer from architecture and discovery context',
  },
] as const;

/**
 * Scope stage — plane-grouped BUILD streams (Spec V/Z, 2026-07-17). REST + SOAP
 * are one generic `api_migration` stream; reconciles are AUTO (per-plane,
 * implied by an in-scope build plane) and tests are peppered into build stories,
 * so neither is a user-picked stream any more. `data_migration` is shown but is
 * implied whenever Persistence is in scope; infra + cutover are optional.
 */
export const DELIVERY_STREAM_OPTIONS: ReadonlyArray<{ key: string; label: string }> = [
  // Persistence plane
  {
    key: 'target_database_schema_implementation',
    label: 'DB / schema (Persistence)',
  },
  { key: 'data_migration', label: 'Data migration (Persistence)' },
  // Service plane (REST + SOAP merged into one api_migration stream — Spec V)
  { key: 'api_migration', label: 'API — REST + SOAP (Service)' },
  {
    key: 'internal_processing_implementation',
    label: 'Internal processing — jobs / listeners / batch (Service)',
  },
  // UI plane
  { key: 'target_frontend_implementation', label: 'Frontend (UI)' },
  // Optional / cross-cutting
  {
    key: 'target_infrastructure_environment_implementation',
    label: 'Infrastructure (optional)',
  },
  {
    key: 'cutover_rollback_decommission',
    label: 'Cutover / rollback / decommission (optional)',
  },
] as const;

/**
 * Stage 4 — migration style options. Single-select.
 */
export const MIGRATION_STYLE_OPTIONS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'phased', label: 'Phased' },
  { key: 'strangler', label: 'Strangler' },
  { key: 'parallel_run', label: 'Parallel run' },
  { key: 'big_bang', label: 'Big bang' },
  { key: 'blue_green_canary', label: 'Blue-green / canary' },
  { key: 'unsure_recommend', label: 'Unsure - recommend from context' },
] as const;

/**
 * Stage 5 axes — concise single-select vocabularies per spec.md.
 */
export const DATA_APPROACH_OPTIONS: ReadonlyArray<{
  key: MigrationDataAndCutoverAssumptions['dataApproach'];
  label: string;
}> = [
  { key: 'one_time_bulk', label: 'One-time bulk' },
  { key: 'incremental', label: 'Incremental' },
  { key: 'dual_write', label: 'Dual write' },
  { key: 'change_data_capture', label: 'Change data capture (CDC)' },
  { key: 'rebuild_from_events', label: 'Rebuild from events' },
  { key: 'unsure', label: 'Unsure' },
] as const;

export const CUTOVER_APPROACH_OPTIONS: ReadonlyArray<{
  key: MigrationDataAndCutoverAssumptions['cutoverApproach'];
  label: string;
}> = [
  { key: 'phased', label: 'Phased' },
  { key: 'big_bang', label: 'Big bang' },
  { key: 'blue_green', label: 'Blue-green' },
  { key: 'canary', label: 'Canary' },
  { key: 'manual_window', label: 'Manual window' },
  { key: 'unsure', label: 'Unsure' },
] as const;

export const ROLLBACK_OPTIONS: ReadonlyArray<{
  key: MigrationDataAndCutoverAssumptions['rollbackRequired'];
  label: string;
}> = [
  { key: 'yes', label: 'Yes' },
  { key: 'no', label: 'No' },
  { key: 'unsure', label: 'Unsure' },
] as const;

/**
 * Stage 6 — Migration Test Pack coverage axes. Multi-select.
 */
export const TEST_PACK_OPTIONS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'api_contract_compatibility', label: 'API contract compatibility' },
  { key: 'soap_operation_compatibility', label: 'SOAP operation compatibility' },
  { key: 'baseline_replay', label: 'Baseline replay' },
  {
    key: 'data_migration_reconciliation',
    label: 'Data migration reconciliation',
  },
  { key: 'db_schema_validation', label: 'DB / schema validation' },
  { key: 'integration_contract_tests', label: 'Integration / contract tests' },
  { key: 'cutover_smoke', label: 'Cutover smoke' },
  { key: 'rollback_tests', label: 'Rollback tests' },
  {
    key: 'performance_baseline_comparison',
    label: 'Performance baseline comparison',
  },
  { key: 'security_auth', label: 'Security / auth' },
  { key: 'observability', label: 'Observability' },
  {
    key: 'use_recommended_coverage',
    label: 'Use recommended coverage (default)',
  },
] as const;

// ============================================================================
// Architecture option (used by Stage 1 pickers; minimal shape so callers can
// pass either an `Architecture` from architecturesApi or a synthesized list)
// ============================================================================

export interface ArchitectureOption {
  id: string;
  name: string;
}

// ============================================================================
// Props
// ============================================================================

export interface MigrationDeliveryPlanWizardProps {
  /** Visibility flag. Wizard renders nothing when false. */
  open: boolean;
  /** Project the draft will belong to. */
  projectId: string;
  /** Architectures available for the current/target pickers in Stage 1. */
  architectures: ArchitectureOption[];
  /** Optional pre-selection for current architecture (e.g. from active context). */
  initialCurrentArchitectureId?: string;
  /** Optional pre-selection for target architecture. */
  initialTargetArchitectureId?: string;
  /** Close handler invoked when the user cancels. */
  onClose: () => void;
  /**
   * Invoked once the gateway returns `{ draftId, summary, warnings? }`. The
   * parent surface (`MigrationDeliveryPlanProgressSummary`) routes to the
   * review workspace based on the draft id.
   */
  onGenerationComplete: (result: GenerateMigrationDeliveryPlanResponse) => void;
  /**
   * Optional callback fired the moment the user clicks Generate (before the
   * gateway request completes). Used by the parent surface to show the
   * scripted progress overlay defined in Group 10.
   */
  onGenerationStart?: () => void;
  /**
   * Optional callback fired if the gateway request fails. Surfaced so the
   * parent can replace the progress overlay with a typed error toast.
   */
  onGenerationError?: (error: Error) => void;
  /**
   * Test seam: override the context fetcher so tests can return a synthetic
   * MigrationDiscoveryContext without hitting fetch.
   */
  fetchContext?: typeof fetchMigrationDiscoveryContext;
  /** Test seam: override the gateway generate call. */
  generate?: typeof generateMigrationDeliveryPlan;
  /**
   * Test seam: override the confirmed-manifest read (Stage-7 closeout summary)
   * so tests can return a synthetic list without hitting fetch. Defaults to the
   * gateway manifest-artifacts READ proxy client.
   */
  fetchManifests?: typeof fetchLatestTargetManifests;
  /**
   * Test seam: list the project's target architectures so the wizard can
   * filter to SAVED conversations (`conversationSavedAt != null`) and default
   * to the most-recent-saved. Defaults to the target-architectures list client;
   * a degraded read is fail-soft (empty list) and the selector falls back to
   * the plain `architectures` list. Spec 2026-06-26 FR5.
   */
  fetchSavedTargets?: (projectId: string) => Promise<TargetArchitectureDto[]>;
  /**
   * Test seam: fetch the chosen saved conversation's captured-decision rows
   * (the SAME rows the architect conversation reads) for the pre-flight
   * readiness panel. Defaults to the captured-decisions list client; fail-soft
   * to an empty list. Spec 2026-06-26 FR7.
   */
  fetchCapturedDecisions?: typeof listCapturedDecisions;
}

// ============================================================================
// Step enumeration
// ============================================================================

// Spec Z (2026-07-17): the 7-stage flow collapses to 3. The target-state
// conversation already confirmed tiers / tech / decisions, so the intent, style
// and test-pack stages are gone (intent is inferred; phased is the only in-tool
// model — Spec W; tests are peppered into build stories); data/cutover fold into
// Scope.
type WizardStage = 1 | 2 | 3;

const STAGE_TITLES: Record<WizardStage, string> = {
  1: 'Context & inputs',
  2: 'Scope',
  3: 'Generate',
};

// ============================================================================
// Default-from-context helpers
// ============================================================================

/**
 * Heuristic: derive default delivery-stream selections from the readiness
 * assessment shipped in `MigrationDiscoveryContext`. Streams default to ON
 * when the corresponding readiness axis reports a non-empty value, and
 * `migration_test_pack` + `reconciliation_reporting` default to ON whenever
 * any findings exist (because findings imply gaps that need testing /
 * reconciliation coverage).
 */
export function deriveDefaultDeliveryStreams(
  ctx: MigrationDiscoveryContext | null
): string[] {
  if (!ctx) return [];
  const out = new Set<string>();
  const readiness = ctx.readinessAssessment ?? null;
  if (readiness?.apiReadiness) {
    // REST + SOAP are one generic api_migration stream (Spec V); internal
    // (non-HTTP) processing rides the same committed-code-surface signal.
    out.add('api_migration');
    out.add('internal_processing_implementation');
  }
  if (readiness?.dataReadiness) {
    out.add('target_database_schema_implementation');
    out.add('data_migration');
  }
  if (readiness?.infrastructureReadiness) {
    out.add('target_infrastructure_environment_implementation');
  }
  // Reconciles are AUTO (per-plane) and tests are peppered into build stories
  // (Spec V), so neither is a user-picked stream. Cutover stays an explicit
  // optional toggle rather than a findings-driven default.
  return Array.from(out);
}

/**
 * Heuristic: derive default Test Pack expectations from context. If runtime
 * usage / API baselines / DB findings exist, the corresponding test axis is
 * pre-selected. `use_recommended_coverage` is always pre-selected so the LLM
 * fills in any gaps the user did not explicitly pick.
 */
export function deriveDefaultTestPackExpectations(
  ctx: MigrationDiscoveryContext | null
): string[] {
  const out = new Set<string>();
  out.add('use_recommended_coverage');
  if (!ctx) return Array.from(out);
  if ((ctx.apiBehaviourBaselineSummary?.totalBaselines ?? 0) > 0) {
    out.add('api_contract_compatibility');
    out.add('baseline_replay');
  }
  if ((ctx.databaseDiscoverySummary?.databaseFindingCount ?? 0) > 0) {
    out.add('db_schema_validation');
    out.add('data_migration_reconciliation');
  }
  if (ctx.runtimeUsageSummary?.hasRuntimeEvidence) {
    out.add('observability');
  }
  return Array.from(out);
}

/**
 * Recommend a migration style from context. If the readiness assessment hints
 * at infrastructure readiness with a non-empty gap list we lean phased; if
 * the API surface looks ready we lean strangler; otherwise we default to
 * `unsure_recommend` so the LLM picks based on full evidence.
 */
export function recommendMigrationStyle(
  ctx: MigrationDiscoveryContext | null
): string {
  if (!ctx) return 'unsure_recommend';
  const readiness = ctx.readinessAssessment ?? null;
  if (readiness?.apiReadiness === 'ready') return 'strangler';
  if (readiness?.infrastructureReadiness === 'partial') return 'phased';
  if (readiness?.overallStatus === 'ready') return 'phased';
  return 'unsure_recommend';
}

// ============================================================================
// Pre-flight readiness (Spec 2026-06-26-target-conversation-save-resume-plan-
// sourcing, FR7). Computed entirely from the chosen saved conversation's
// captured-decision rows (the SAME rows the architect conversation reads) plus
// its `conversationSavedAt` marker. Non-blocking: the panel names the inputs
// the plan LLM would otherwise surface post-generation as "missing inputs".
// ============================================================================

/**
 * Skip sentinels that are AUTO-SKIPPED, not gaps. Excluded from BOTH the
 * answered numerator and the total denominator (FR7).
 */
export const PREFLIGHT_SKIP_SENTINELS = ['not_applicable', 'deferred'] as const;

/** Foundational DB decisions the plan depends on (called out explicitly). */
export const FOUNDATIONAL_DB_CODES = ['db.engine', 'db.migrations'] as const;

/**
 * The foundational decision codes whose absence is named as a gap up-front
 * (exactly the inputs the plan LLM otherwise complains are missing).
 */
export const PREFLIGHT_FOUNDATIONAL_CODES = [
  'service.language',
  'api.protocol',
  'db.engine',
  'db.migrations',
] as const;

/**
 * Tech-stack decision codes. If ANY carries a concrete answer, the
 * `target-tech-stack-<id>.md` render has content (tech-stack written = yes).
 */
export const PREFLIGHT_TECH_STACK_CODES = [
  'service.language',
  'service.framework',
  'service.runtime',
  'db.engine',
  'db.driver',
  'ui.framework',
  'build.tool',
] as const;

/** Minimal captured-decision row shape the readiness computation needs. */
export interface PreflightDecisionRow {
  decisionCode: string;
  answerValue: string;
  answerSummary: string | null;
}

/** Derived, non-blocking readiness snapshot for a chosen saved conversation. */
export interface PreflightReadiness {
  savedAt: string | null;
  answeredCount: number;
  totalCount: number;
  dbEnginePresent: boolean;
  dbMigrationsPresent: boolean;
  techStackWritten: boolean;
  namedGaps: string[];
}

type PreflightDecisionClass = 'answered' | 'skip' | 'unanswered';

function isPreflightSkipLabel(label: string): boolean {
  const normalised = label.trim().toLowerCase().replace(/\s+/g, '_');
  return (PREFLIGHT_SKIP_SENTINELS as readonly string[]).includes(normalised);
}

function classifyPreflightDecision(
  row: PreflightDecisionRow,
): PreflightDecisionClass {
  // Skip detection reads the underlying captured value (via the tolerant reader)
  // AND the summary, so a friendly summary cannot mask a not_applicable/deferred
  // sentinel. We deliberately do NOT write a new envelope parser (FR7).
  const raw = resolveCapturedAnswerLabel(row.answerValue);
  if (isPreflightSkipLabel(raw)) return 'skip';
  if (row.answerSummary && isPreflightSkipLabel(row.answerSummary)) return 'skip';
  const label = (row.answerSummary && row.answerSummary.trim()) || raw.trim();
  if (!label) return 'unanswered';
  return 'answered';
}

/**
 * Compute the pre-flight readiness for a chosen saved conversation from its
 * captured-decision rows. `not_applicable`/`deferred` rows are excluded from
 * BOTH the answered numerator and the total denominator (auto-skipped, not
 * gaps). Never throws.
 */
export function computePreflightReadiness(
  savedAt: string | null,
  decisions: PreflightDecisionRow[],
): PreflightReadiness {
  const byCode = new Map<string, PreflightDecisionClass>();
  let answeredCount = 0;
  let totalCount = 0;
  for (const row of decisions) {
    const cls = classifyPreflightDecision(row);
    byCode.set(row.decisionCode, cls); // latest non-superseded row wins
    if (cls === 'skip') continue; // excluded from BOTH numerator + denominator
    totalCount += 1;
    if (cls === 'answered') answeredCount += 1;
  }
  const isAnswered = (code: string): boolean => byCode.get(code) === 'answered';
  const namedGaps = PREFLIGHT_FOUNDATIONAL_CODES.filter((code) => {
    const cls = byCode.get(code);
    // A skipped foundational code is auto-skipped (not a gap); answered is fine.
    return cls !== 'answered' && cls !== 'skip';
  });
  return {
    savedAt,
    answeredCount,
    totalCount,
    dbEnginePresent: isAnswered('db.engine'),
    dbMigrationsPresent: isAnswered('db.migrations'),
    techStackWritten: PREFLIGHT_TECH_STACK_CODES.some((code) => isAnswered(code)),
    namedGaps: [...namedGaps],
  };
}

/** Format an ISO instant to a stable, locale-independent `YYYY-MM-DD` date. */
export function formatSavedDate(iso: string | null | undefined): string {
  if (!iso || typeof iso !== 'string') return 'unknown';
  return iso.slice(0, 10);
}

// ============================================================================
// Component
// ============================================================================

export function MigrationDeliveryPlanWizard({
  open,
  projectId,
  architectures,
  initialCurrentArchitectureId,
  initialTargetArchitectureId,
  onClose,
  onGenerationComplete,
  onGenerationStart,
  onGenerationError,
  fetchContext = fetchMigrationDiscoveryContext,
  generate = generateMigrationDeliveryPlan,
  fetchManifests = fetchLatestTargetManifests,
  fetchSavedTargets = listTargetArchitectures,
  fetchCapturedDecisions = listCapturedDecisions,
}: MigrationDeliveryPlanWizardProps) {
  // ---- Stage state ----
  const [stage, setStage] = useState<WizardStage>(1);

  // ---- Stage 1: architecture pickers + context check ----
  const [currentArchitectureId, setCurrentArchitectureId] = useState<string>(
    initialCurrentArchitectureId ?? ''
  );
  const [targetArchitectureId, setTargetArchitectureId] = useState<string>(
    initialTargetArchitectureId ?? ''
  );
  const [contextLoading, setContextLoading] = useState(false);
  const [contextError, setContextError] = useState<string | null>(null);
  const [context, setContext] = useState<MigrationDiscoveryContext | null>(null);
  const [selectedDiscoveryRunIds, setSelectedDiscoveryRunIds] = useState<Set<string>>(
    () => new Set()
  );
  const [selectedBaselineIds, setSelectedBaselineIds] = useState<Set<string>>(
    () => new Set()
  );

  // ---- Stage 2: intent (multi-select) ----
  const [migrationIntent, setMigrationIntent] = useState<Set<string>>(() => new Set());

  // ---- Stage 3: delivery streams (multi-select, context-defaulted) ----
  const [deliveryStreams, setDeliveryStreams] = useState<Set<string>>(() => new Set());

  // ---- Migration style: phased is the only in-tool model (Spec W); no stage ----
  const [migrationStyle] = useState<string>('phased');

  // ---- Stage 5: data + cutover ----
  const [dataAndCutoverAssumptions, setDataAndCutoverAssumptions] =
    useState<MigrationDataAndCutoverAssumptions>({});

  // ---- Stage 6: Migration Test Pack expectations (multi-select, defaulted) ----
  const [testPackExpectations, setTestPackExpectations] = useState<Set<string>>(
    () => new Set()
  );

  // ---- Stage 7: confirmed-manifest closeout summary (read-only, fail-soft) ----
  const [manifestRows, setManifestRows] = useState<LatestTargetManifest[]>([]);

  // ---- Saved-conversation binding (Spec 2026-06-26 FR5/FR7) ----
  // Saved target-state conversations (conversationSavedAt != null), newest
  // first; the target selector picks among these and the readiness panel
  // reads the chosen one's captured decisions.
  const [savedTargets, setSavedTargets] = useState<TargetArchitectureDto[]>([]);
  const [capturedDecisions, setCapturedDecisions] = useState<
    CapturedDecisionDto[]
  >([]);

  // ---- Submit state (Stage 7) ----
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // ---- Reset on open ----
  useEffect(() => {
    if (!open) return;
    setStage(1);
    setCurrentArchitectureId(initialCurrentArchitectureId ?? '');
    setTargetArchitectureId(initialTargetArchitectureId ?? '');
    setContext(null);
    setContextError(null);
    setSelectedDiscoveryRunIds(new Set());
    setSelectedBaselineIds(new Set());
    setMigrationIntent(new Set());
    setDeliveryStreams(new Set());
    setDataAndCutoverAssumptions({});
    setTestPackExpectations(new Set());
    setManifestRows([]);
    setSavedTargets([]);
    setCapturedDecisions([]);
    setSubmitting(false);
    setSubmitError(null);
  }, [open, initialCurrentArchitectureId, initialTargetArchitectureId]);

  // ---- Context fetch (fires once both architectures are picked) ----
  useEffect(() => {
    if (!open) return;
    if (!currentArchitectureId) {
      setContext(null);
      return;
    }
    let cancelled = false;
    setContextLoading(true);
    setContextError(null);
    (async () => {
      try {
        const ctx = await fetchContext(projectId, {
          currentArchitectureId,
          targetArchitectureId: targetArchitectureId || null,
          includeFindings: true,
        });
        if (cancelled) return;
        setContext(ctx);
        // Pre-select latest completed discovery run if any.
        const runs = ctx.discoveryRunsSummary?.runs ?? [];
        const latest = runs.find((r) => r.status === 'completed') ?? runs[0];
        if (latest) setSelectedDiscoveryRunIds(new Set([latest.runId]));
        // Pre-select latest baseline if any.
        const baselines = ctx.apiBehaviourBaselineSummary?.baselines ?? [];
        if (baselines.length > 0) {
          setSelectedBaselineIds(new Set([baselines[0].baselineId]));
        }
        // Apply context-derived defaults for Stage 3, 4, 6.
        setDeliveryStreams(new Set(deriveDefaultDeliveryStreams(ctx)));
        setTestPackExpectations(new Set(deriveDefaultTestPackExpectations(ctx)));
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'Context unavailable';
        setContextError(message);
      } finally {
        if (!cancelled) setContextLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, projectId, currentArchitectureId, targetArchitectureId, fetchContext]);

  // ---- Confirmed-manifest closeout fetch (Stage 7 review only) ----
  // Mirrors the context-fetch effect: fires when the final review screen is
  // shown and a target architecture is chosen, refetches if the target changes,
  // and is FAIL-SOFT (the client resolves to [] on error — the line renders
  // "None"; it never throws into the wizard). Gated on `stage === 7` so the
  // read only runs when the closeout line is actually visible.
  useEffect(() => {
    if (!open) return;
    if (stage !== 3 || !targetArchitectureId) {
      setManifestRows([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const rows = await fetchManifests(projectId, targetArchitectureId);
      if (cancelled) return;
      setManifestRows(rows);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, stage, projectId, targetArchitectureId, fetchManifests]);

  // ---- Saved-conversation fetch + default-target binding (FR5) ----
  // Lists the project's target architectures, filters to SAVED conversations
  // (conversationSavedAt != null), sorts most-recent-saved first, and defaults
  // the target selection to the most-recent-saved. Fail-soft: a degraded read
  // leaves the saved list empty and the selector falls back to `architectures`.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const rows = await fetchSavedTargets(projectId);
        if (cancelled) return;
        const saved = (rows ?? [])
          .filter((r) => Boolean(r.conversationSavedAt))
          .sort((a, b) =>
            String(b.conversationSavedAt).localeCompare(
              String(a.conversationSavedAt),
            ),
          );
        setSavedTargets(saved);
        if (saved.length > 0) {
          const mostRecent = saved[0];
          // Default to the most-recent-saved unless the current selection is
          // already a saved target (lets the user pick another saved one).
          setTargetArchitectureId((prev) =>
            prev && saved.some((t) => t.id === prev) ? prev : mostRecent.id,
          );
        }
      } catch {
        if (!cancelled) setSavedTargets([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, projectId, fetchSavedTargets]);

  // ---- Captured-decisions fetch for the pre-flight readiness panel (FR7) ----
  // Fires when a SAVED target is selected; reads the same captured-decision
  // rows the architect conversation reads. Fail-soft to an empty list so the
  // panel degrades gracefully (and so a non-saved selection never fetches).
  useEffect(() => {
    if (!open) return;
    const isSaved = savedTargets.some((t) => t.id === targetArchitectureId);
    if (!targetArchitectureId || !isSaved) {
      setCapturedDecisions([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const rows = await fetchCapturedDecisions(projectId, targetArchitectureId);
        if (cancelled) return;
        setCapturedDecisions(rows ?? []);
      } catch {
        if (!cancelled) setCapturedDecisions([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, projectId, targetArchitectureId, savedTargets, fetchCapturedDecisions]);

  // ---- Toggle helpers ----
  const toggleMember = useCallback(
    (
      setter: React.Dispatch<React.SetStateAction<Set<string>>>
    ): ((key: string) => void) =>
      (key: string) => {
        setter((prev) => {
          const next = new Set(prev);
          if (next.has(key)) next.delete(key);
          else next.add(key);
          return next;
        });
      },
    []
  );

  const toggleStream = useMemo(
    () => toggleMember(setDeliveryStreams),
    [toggleMember]
  );
  const toggleDiscoveryRun = useMemo(
    () => toggleMember(setSelectedDiscoveryRunIds),
    [toggleMember]
  );
  const toggleBaseline = useMemo(
    () => toggleMember(setSelectedBaselineIds),
    [toggleMember]
  );

  // ---- Stage gating ----
  const canAdvance: Record<WizardStage, boolean> = {
    1: Boolean(currentArchitectureId && targetArchitectureId),
    2: true, // scope defaults from the target-state tiers; the user may adjust
    3: !submitting,
  };

  const goNext = useCallback(() => {
    setStage((s) => (s < 3 ? ((s + 1) as WizardStage) : s));
  }, []);
  const goBack = useCallback(() => {
    setStage((s) => (s > 1 ? ((s - 1) as WizardStage) : s));
  }, []);

  // ---- Generate (Stage 7 Generate button) ----
  const handleGenerate = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    onGenerationStart?.();
    const wizardAnswers: MigrationDeliveryPlanWizardAnswers = {
      // Intent is inferred from the completed target-state conversation now (no
      // stage) — default to the catch-all so the generator infers from context.
      migrationIntent:
        migrationIntent.size > 0
          ? Array.from(migrationIntent)
          : ['unsure_infer_from_context'],
      deliveryStreams: Array.from(deliveryStreams),
      migrationStyle, // 'phased' — the only in-tool model (Spec W)
      dataAndCutoverAssumptions,
      migrationTestPackExpectations: Array.from(testPackExpectations),
    };
    try {
      const result = await generate({
        projectId,
        currentArchitectureId,
        targetArchitectureId,
        wizardAnswers,
        discoveryRunIds:
          selectedDiscoveryRunIds.size > 0
            ? Array.from(selectedDiscoveryRunIds)
            : undefined,
        apiBehaviourBaselineIds:
          selectedBaselineIds.size > 0
            ? Array.from(selectedBaselineIds)
            : undefined,
      });
      onGenerationComplete(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Generation failed';
      setSubmitError(message);
      onGenerationError?.(err instanceof Error ? err : new Error(message));
    } finally {
      setSubmitting(false);
    }
  }, [
    submitting,
    migrationIntent,
    deliveryStreams,
    migrationStyle,
    dataAndCutoverAssumptions,
    testPackExpectations,
    selectedDiscoveryRunIds,
    selectedBaselineIds,
    projectId,
    currentArchitectureId,
    targetArchitectureId,
    generate,
    onGenerationStart,
    onGenerationComplete,
    onGenerationError,
  ]);

  if (!open) return null;

  // ============================================================================
  // Stage renderers (per-stage; kept inline for legibility)
  // ============================================================================

  /**
   * Gap wayfinding (Spec 2026-06-11 Findings Coverage + Gap Wayfinding,
   * Task Group 4.2): deep-link context for the readiness explanation
   * cards. Derived entirely client-side per D4 — projectId from props,
   * architectureId = the CURRENT architecture (discovery surfaces are
   * current-architecture-scoped), run ids from the wizard's run selection,
   * `flaggedRunId` from the first high-priority finding highlight when the
   * context carries one (the registry falls back to the first selected
   * run, then degrades to the /discovery listing route).
   */
  const gapWayfindingCtx: GapWayfindingContext = {
    projectId,
    architectureId: currentArchitectureId,
    runIds: Array.from(selectedDiscoveryRunIds),
    flaggedRunId:
      (context?.highPriorityFindings ?? []).find((f) => Boolean(f.runId))
        ?.runId ?? null,
    baselineIds: Array.from(selectedBaselineIds),
  };

  /**
   * One explanation card per gap / context-warning code: registry title,
   * plain-English explanation, and a "Go to ..." link when the registry
   * resolves a destination (plain action text when it returns null —
   * unknown codes never throw). Cards are advisory only; they never gate
   * Generate.
   */
  function renderGapWayfindingCard(code: string) {
    const entry = getGapWayfindingEntry(code);
    const destination = entry.buildDestination(gapWayfindingCtx);
    return (
      <div
        key={code}
        className={styles.gapCard}
        data-testid={`mdp-wizard-gap-card-${code}`}
      >
        <strong className={styles.gapCardTitle}>{entry.title}</strong>
        <p className={styles.gapCardExplanation}>{entry.explanation}</p>
        {destination ? (
          <Link
            to={destination}
            className={styles.gapCardAction}
            data-testid={`mdp-wizard-gap-link-${code}`}
            // Dismiss the wizard as we navigate: otherwise the modal stays
            // mounted over the destination (a same-route section deep-link
            // like ?section=schema-migration would look like nothing
            // happened), and the close now stays on the page rather than
            // ejecting to the backlog.
            onClick={onClose}
          >
            {entry.actionLabel}
          </Link>
        ) : (
          <span
            className={styles.gapCardActionText}
            data-testid={`mdp-wizard-gap-action-${code}`}
          >
            {entry.actionLabel}
          </span>
        )}
      </div>
    );
  }

  function renderStage1() {
    const findingsCount = context?.findingsSummary?.totalFindings ?? 0;
    const baselineCount = context?.apiBehaviourBaselineSummary?.totalBaselines ?? 0;
    const mappingsCount = context?.architectureMappingsSummary?.totalMappings ?? 0;
    // Pre-flight readiness binds to the chosen SAVED conversation (FR7). When
    // the selection is not a saved target (e.g. the fail-soft fallback to the
    // plain architectures list), no panel is shown.
    const selectedSavedTarget =
      savedTargets.find((t) => t.id === targetArchitectureId) ?? null;
    const preflightReadiness = selectedSavedTarget
      ? computePreflightReadiness(
          selectedSavedTarget.conversationSavedAt ?? null,
          capturedDecisions,
        )
      : null;
    return (
      <>
        <p className={styles.helperText}>
          Pick the current and target architectures for this migration. The
          wizard loads the Migration Discovery Context for the pair and uses
          it to seed downstream stages.
        </p>

        <div className={styles.fieldGroup}>
          <label className={styles.label}>
            Current architecture
            <select
              className={styles.select}
              value={currentArchitectureId}
              onChange={(e) => setCurrentArchitectureId(e.target.value)}
              data-testid="mdp-wizard-current-arch"
            >
              <option value="">Select...</option>
              {architectures.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.label}>
            Target architecture (saved conversation)
            <select
              className={styles.select}
              value={targetArchitectureId}
              onChange={(e) => setTargetArchitectureId(e.target.value)}
              data-testid="mdp-wizard-target-arch"
            >
              <option value="">Select...</option>
              {/* FR5: pick a SAVED conversation (most-recent-saved is the
                  default). The one choice flows into the context fetch +
                  downstream stages, unifying decisions + tech-stack + mappings
                  on a single target. Fail-soft: when no saved conversation
                  exists, fall back to the plain architectures list so the
                  wizard is never blocked. */}
              {savedTargets.length > 0
                ? savedTargets.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} (saved {formatSavedDate(t.conversationSavedAt)})
                    </option>
                  ))
                : architectures.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
            </select>
          </label>
        </div>

        <div
          className={styles.readinessCard}
          data-testid="mdp-wizard-readiness-card"
        >
          <h4 className={styles.sectionTitle}>Migration Discovery Context</h4>
          {contextLoading && (
            <span className={styles.subtle}>Loading context...</span>
          )}
          {contextError && (
            <div
              className={styles.warningBanner}
              data-testid="mdp-wizard-context-error"
            >
              Context unavailable: {contextError}. The wizard can still proceed;
              the generator will treat missing inputs as gaps and produce
              prerequisite stories.
            </div>
          )}
          {!contextLoading && !contextError && context && (
            <>
              <div className={styles.readinessRow}>
                <span className={styles.readinessKey}>Findings:</span>
                <span>{findingsCount}</span>
                <span className={styles.readinessKey}>Baselines:</span>
                <span>{baselineCount}</span>
                <span className={styles.readinessKey}>Mappings:</span>
                <span>{mappingsCount}</span>
              </div>
              {context.readinessAssessment && (
                <div className={styles.readinessRow}>
                  <span className={styles.readinessKey}>Overall:</span>
                  <span>{context.readinessAssessment.overallStatus}</span>
                </div>
              )}
              {(context.readinessAssessment?.gaps ?? []).length > 0 && (
                <div
                  className={styles.fieldGroup}
                  data-testid="mdp-wizard-readiness-gaps"
                >
                  <span className={styles.readinessKey}>Gaps</span>
                  {(context.readinessAssessment?.gaps ?? []).map((code) =>
                    renderGapWayfindingCard(code)
                  )}
                </div>
              )}

              {(context.contextWarnings ?? []).length > 0 && (
                <div
                  className={styles.fieldGroup}
                  data-testid="mdp-wizard-context-warnings"
                >
                  <span className={styles.readinessKey}>Context warnings</span>
                  {(context.contextWarnings ?? []).map((code) =>
                    renderGapWayfindingCard(code)
                  )}
                </div>
              )}

              {(context.discoveryRunsSummary?.runs ?? []).length > 0 && (
                <div className={styles.fieldGroup}>
                  <span className={styles.readinessKey}>Discovery runs</span>
                  <div className={styles.chipList}>
                    {(context.discoveryRunsSummary?.runs ?? []).map((run) => {
                      const selected = selectedDiscoveryRunIds.has(run.runId);
                      return (
                        <button
                          type="button"
                          key={run.runId}
                          className={`${styles.chip} ${selected ? styles.chipSelected : ''}`}
                          onClick={() => toggleDiscoveryRun(run.runId)}
                          data-testid={`mdp-wizard-discovery-run-${run.runId}`}
                        >
                          {run.discoveryKind} ({run.status})
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {(context.apiBehaviourBaselineSummary?.baselines ?? []).length > 0 && (
                <div className={styles.fieldGroup}>
                  <span className={styles.readinessKey}>API Behaviour Baselines</span>
                  <div className={styles.chipList}>
                    {(context.apiBehaviourBaselineSummary?.baselines ?? []).map(
                      (b) => {
                        const selected = selectedBaselineIds.has(b.baselineId);
                        return (
                          <button
                            type="button"
                            key={b.baselineId}
                            className={`${styles.chip} ${
                              selected ? styles.chipSelected : ''
                            }`}
                            onClick={() => toggleBaseline(b.baselineId)}
                            data-testid={`mdp-wizard-baseline-${b.baselineId}`}
                          >
                            {b.name} ({b.status})
                          </button>
                        );
                      }
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {preflightReadiness && (
          <div
            className={styles.readinessCard}
            data-testid="mdp-wizard-preflight-readiness"
          >
            <h4 className={styles.sectionTitle}>Saved conversation readiness</h4>
            <p className={styles.subtle}>
              Non-blocking pre-flight check for the chosen saved conversation.
              You can still generate; these are the inputs the plan would
              otherwise flag as missing.
            </p>
            <div className={styles.readinessRow}>
              <span className={styles.readinessKey}>Saved:</span>
              <span data-testid="mdp-wizard-preflight-saved-date">
                {formatSavedDate(preflightReadiness.savedAt)}
              </span>
            </div>
            <div className={styles.readinessRow}>
              <span className={styles.readinessKey}>Decisions answered:</span>
              <span data-testid="mdp-wizard-preflight-answered">
                {preflightReadiness.answeredCount}/{preflightReadiness.totalCount}
              </span>
            </div>
            <div className={styles.readinessRow}>
              <span className={styles.readinessKey}>db.engine:</span>
              <span data-testid="mdp-wizard-preflight-db-engine">
                {preflightReadiness.dbEnginePresent ? 'present' : 'missing'}
              </span>
              <span className={styles.readinessKey}>db.migrations:</span>
              <span data-testid="mdp-wizard-preflight-db-migrations">
                {preflightReadiness.dbMigrationsPresent ? 'present' : 'missing'}
              </span>
            </div>
            <div className={styles.readinessRow}>
              <span className={styles.readinessKey}>Tech-stack written:</span>
              <span data-testid="mdp-wizard-preflight-tech-stack">
                {preflightReadiness.techStackWritten ? 'Yes' : 'No'}
              </span>
            </div>
            <div className={styles.readinessRow}>
              <span className={styles.readinessKey}>Named gaps:</span>
              <span data-testid="mdp-wizard-preflight-gaps">
                {preflightReadiness.namedGaps.length > 0
                  ? preflightReadiness.namedGaps.join(', ')
                  : 'none'}
              </span>
            </div>
          </div>
        )}
      </>
    );
  }

  // [Spec Z] Migration-intent stage removed — intent is inferred from the
  // completed target-state conversation, not asked.

  function renderScope() {
    return (
      <>
        <p className={styles.helperText}>
          Scope for this migration. Planes (Persistence &rarr; Service &rarr; UI)
          are derived from your target-state conversation; adjust the build
          streams below plus the optional infrastructure / cutover work. Data
          migration is implied whenever Persistence is in scope, and
          reconciliation runs automatically per plane &mdash; neither is a
          separate pick. Execution is phased, with a human review pause between
          planes.
        </p>
        <div className={styles.chipList} data-testid="mdp-wizard-stream-chips">
          {DELIVERY_STREAM_OPTIONS.map((opt) => {
            const selected = deliveryStreams.has(opt.key);
            return (
              <button
                type="button"
                key={opt.key}
                className={`${styles.chip} ${selected ? styles.chipSelected : ''}`}
                onClick={() => toggleStream(opt.key)}
                data-testid={`mdp-wizard-stream-${opt.key}`}
                aria-pressed={selected}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </>
    );
  }

  // [Spec Z] Migration-style stage removed — phased is the only in-tool model (Spec W).

  // [Spec Z] Data/cutover stage removed — folded into Scope; data migration is
  // implied with Persistence and cutover is an optional scope toggle.

  // [Spec Z] Test Pack stage removed — tests are peppered into build stories.

  function renderGenerate() {
    // Confirmed-manifest closeout line (Spec 5 Phase 2 follow-up): list each
    // persisted manifest as "filename (tag)", comma-separated, or the literal
    // "None" when the read returned nothing (the FAIL-SOFT path also lands here,
    // since `fetchLatestTargetManifests` resolves to [] on error). The label
    // formatter is pure (`formatLatestTargetManifestLabel`); empty labels are
    // dropped so a degenerate row never injects a bare comma.
    const manifestSummary =
      manifestRows
        .map((row) => formatLatestTargetManifestLabel(row))
        .filter((label) => label.length > 0)
        .join(', ') || 'None';
    return (
      <>
        <p className={styles.helperText}>
          Final review. Generation produces the plan skeleton (initiatives,
          epics, and features) and persists the draft. Sparse context produces
          prerequisite / refinement items rather than invented detail.
        </p>
        <p className={styles.helperText} data-testid="mdp-wizard-skeleton-note">
          Detailed stories are expanded later, per epic, in the review
          workspace.
        </p>
        <div className={styles.summaryBox} data-testid="mdp-wizard-review-summary">
          <div className={styles.readinessRow}>
            <span className={styles.readinessKey}>Current architecture:</span>
            <span>
              {architectures.find((a) => a.id === currentArchitectureId)?.name ??
                currentArchitectureId}
            </span>
          </div>
          <div className={styles.readinessRow}>
            <span className={styles.readinessKey}>Target architecture:</span>
            <span>
              {architectures.find((a) => a.id === targetArchitectureId)?.name ??
                targetArchitectureId}
            </span>
          </div>
          <div className={styles.readinessRow}>
            <span className={styles.readinessKey}>Manifest Uploaded:</span>
            <span data-testid="mdp-wizard-review-manifests">{manifestSummary}</span>
          </div>
          <div className={styles.readinessRow}>
            <span className={styles.readinessKey}>Intent:</span>
            <span>{Array.from(migrationIntent).join(', ') || '(none)'}</span>
          </div>
          <div className={styles.readinessRow}>
            <span className={styles.readinessKey}>Streams:</span>
            <span>{Array.from(deliveryStreams).join(', ') || '(none)'}</span>
          </div>
          <div className={styles.readinessRow}>
            <span className={styles.readinessKey}>Style:</span>
            <span>{migrationStyle}</span>
          </div>
          <div className={styles.readinessRow}>
            <span className={styles.readinessKey}>Data approach:</span>
            <span>{dataAndCutoverAssumptions.dataApproach ?? '(unset)'}</span>
          </div>
          <div className={styles.readinessRow}>
            <span className={styles.readinessKey}>Cutover approach:</span>
            <span>{dataAndCutoverAssumptions.cutoverApproach ?? '(unset)'}</span>
          </div>
          <div className={styles.readinessRow}>
            <span className={styles.readinessKey}>Rollback:</span>
            <span>{dataAndCutoverAssumptions.rollbackRequired ?? '(unset)'}</span>
          </div>
          <div className={styles.readinessRow}>
            <span className={styles.readinessKey}>Test Pack:</span>
            <span>
              {Array.from(testPackExpectations).join(', ') || '(none)'}
            </span>
          </div>
        </div>
        {submitError && (
          <div className={styles.errorBanner} data-testid="mdp-wizard-submit-error">
            {submitError}
          </div>
        )}
      </>
    );
  }

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <div
      className={styles.overlay}
      role="presentation"
      data-testid="mdp-wizard"
    >
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mdp-wizard-title"
      >
        <div className={styles.header}>
          <h2 className={styles.title} id="mdp-wizard-title">
            Create Migration Delivery Plan
          </h2>
          <button
            type="button"
            className={styles.closeButton}
            onClick={onClose}
            disabled={submitting}
            data-testid="mdp-wizard-close"
            title="Close"
          >
            &times;
          </button>
        </div>

        <div className={styles.stepper} data-testid="mdp-wizard-stepper">
          {([1, 2, 3] as WizardStage[]).map((n, idx) => (
            <React.Fragment key={n}>
              {idx > 0 && (
                <span className={styles.stepSeparator} aria-hidden="true">
                  &rsaquo;
                </span>
              )}
              <span
                className={`${styles.step} ${
                  n === stage ? styles.stepActive : n < stage ? styles.stepDone : ''
                }`}
                data-testid={`mdp-wizard-step-${n}`}
              >
                {n}. {STAGE_TITLES[n]}
              </span>
            </React.Fragment>
          ))}
        </div>

        <div className={styles.content} data-testid="mdp-wizard-content">
          {stage === 1 && renderStage1()}
          {stage === 2 && renderScope()}
          {stage === 3 && renderGenerate()}
        </div>

        <div className={styles.footer}>
          <button
            type="button"
            className={styles.button}
            onClick={onClose}
            disabled={submitting}
            data-testid="mdp-wizard-cancel"
          >
            Cancel
          </button>
          {stage > 1 && (
            <button
              type="button"
              className={styles.button}
              onClick={goBack}
              disabled={submitting}
              data-testid="mdp-wizard-back"
            >
              Back
            </button>
          )}
          {stage < 3 && (
            <button
              type="button"
              className={`${styles.button} ${styles.buttonPrimary}`}
              onClick={goNext}
              disabled={!canAdvance[stage]}
              data-testid="mdp-wizard-next"
            >
              Next
            </button>
          )}
          {stage === 3 && (
            <button
              type="button"
              className={`${styles.button} ${styles.buttonPrimary}`}
              onClick={handleGenerate}
              disabled={submitting}
              data-testid="mdp-wizard-generate"
            >
              {submitting ? 'Generating...' : 'Generate'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
