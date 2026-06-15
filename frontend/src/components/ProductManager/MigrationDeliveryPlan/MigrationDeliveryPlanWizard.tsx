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
 * Stage 3 — delivery streams. Vocabulary maps 1:1 to the spec's user-facing
 * stream names (subset of the 14-value workstream enum minus the sentinel
 * values like `architecture_refinement`/`discovery_gap_resolution`/`other`/
 * `unknown` which the LLM may apply but are not user-driven choices).
 */
export const DELIVERY_STREAM_OPTIONS: ReadonlyArray<{ key: string; label: string }> = [
  {
    key: 'target_service_api_implementation',
    label: 'Target service / API implementation',
  },
  { key: 'target_frontend_implementation', label: 'Target frontend implementation' },
  {
    key: 'target_database_schema_implementation',
    label: 'Target DB / schema implementation',
  },
  {
    key: 'target_infrastructure_environment_implementation',
    label: 'Target infrastructure implementation',
  },
  { key: 'data_migration', label: 'Data migration' },
  {
    key: 'api_soap_integration_compatibility',
    label: 'API / SOAP integration compatibility',
  },
  { key: 'migration_test_pack', label: 'Migration Test Pack' },
  { key: 'reconciliation_reporting', label: 'Reconciliation / reporting' },
  {
    key: 'cutover_rollback_decommission',
    label: 'Cutover / rollback / decommissioning',
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
}

// ============================================================================
// Step enumeration
// ============================================================================

type WizardStage = 1 | 2 | 3 | 4 | 5 | 6 | 7;

const STAGE_TITLES: Record<WizardStage, string> = {
  1: 'Inputs & context',
  2: 'Migration intent',
  3: 'Delivery streams',
  4: 'Migration style',
  5: 'Data & cutover',
  6: 'Test Pack',
  7: 'Generate',
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
    out.add('target_service_api_implementation');
    out.add('api_soap_integration_compatibility');
  }
  if (readiness?.dataReadiness) {
    out.add('target_database_schema_implementation');
    out.add('data_migration');
  }
  if (readiness?.infrastructureReadiness) {
    out.add('target_infrastructure_environment_implementation');
  }
  const findingsTotal = ctx.findingsSummary?.totalFindings ?? 0;
  if (findingsTotal > 0) {
    out.add('migration_test_pack');
    out.add('reconciliation_reporting');
    out.add('cutover_rollback_decommission');
  }
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

  // ---- Stage 4: migration style (single-select, context-recommended) ----
  const [migrationStyle, setMigrationStyle] = useState<string>('unsure_recommend');

  // ---- Stage 5: data + cutover ----
  const [dataAndCutoverAssumptions, setDataAndCutoverAssumptions] =
    useState<MigrationDataAndCutoverAssumptions>({});

  // ---- Stage 6: Migration Test Pack expectations (multi-select, defaulted) ----
  const [testPackExpectations, setTestPackExpectations] = useState<Set<string>>(
    () => new Set()
  );

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
    setMigrationStyle('unsure_recommend');
    setDataAndCutoverAssumptions({});
    setTestPackExpectations(new Set());
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
        setMigrationStyle(recommendMigrationStyle(ctx));
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

  const toggleIntent = useMemo(
    () => toggleMember(setMigrationIntent),
    [toggleMember]
  );
  const toggleStream = useMemo(
    () => toggleMember(setDeliveryStreams),
    [toggleMember]
  );
  const toggleTestPack = useMemo(
    () => toggleMember(setTestPackExpectations),
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
    2: migrationIntent.size > 0,
    3: true, // streams may default; user may also reduce to zero deliberately
    4: Boolean(migrationStyle),
    5: true,
    6: true,
    7: !submitting,
  };

  const goNext = useCallback(() => {
    setStage((s) => (s < 7 ? ((s + 1) as WizardStage) : s));
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
      migrationIntent: Array.from(migrationIntent),
      deliveryStreams: Array.from(deliveryStreams),
      migrationStyle,
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
            Target architecture
            <select
              className={styles.select}
              value={targetArchitectureId}
              onChange={(e) => setTargetArchitectureId(e.target.value)}
              data-testid="mdp-wizard-target-arch"
            >
              <option value="">Select...</option>
              {architectures.map((a) => (
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
      </>
    );
  }

  function renderStage2() {
    return (
      <>
        <p className={styles.helperText}>
          What migration goals apply? Pick all that match.
        </p>
        <div className={styles.chipList} data-testid="mdp-wizard-intent-chips">
          {MIGRATION_INTENT_OPTIONS.map((opt) => {
            const selected = migrationIntent.has(opt.key);
            return (
              <button
                type="button"
                key={opt.key}
                className={`${styles.chip} ${selected ? styles.chipSelected : ''}`}
                onClick={() => toggleIntent(opt.key)}
                data-testid={`mdp-wizard-intent-${opt.key}`}
                aria-pressed={selected}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
        {migrationIntent.size === 0 && (
          <p className={styles.subtle}>Select at least one intent to continue.</p>
        )}
      </>
    );
  }

  function renderStage3() {
    return (
      <>
        <p className={styles.helperText}>
          Which delivery streams are in scope? Defaults are pre-selected from
          your Migration Discovery Context. Adjust as needed.
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

  function renderStage4() {
    return (
      <>
        <p className={styles.helperText}>
          Pick a migration style. The default is recommended from your
          Migration Discovery Context; pick a different option if you have a
          strong preference.
        </p>
        <div className={styles.radioGroup} data-testid="mdp-wizard-style-radios">
          {MIGRATION_STYLE_OPTIONS.map((opt) => (
            <label key={opt.key} className={styles.radioOption}>
              <input
                type="radio"
                name="mdp-wizard-migration-style"
                value={opt.key}
                checked={migrationStyle === opt.key}
                onChange={() => setMigrationStyle(opt.key)}
                data-testid={`mdp-wizard-style-${opt.key}`}
              />
              <span>{opt.label}</span>
            </label>
          ))}
        </div>
      </>
    );
  }

  function renderStage5() {
    return (
      <>
        <p className={styles.helperText}>
          Set your data and cutover assumptions. Pick "Unsure" for any axis
          you'd like the generator to recommend.
        </p>

        <div className={styles.fieldGroup}>
          <span className={styles.readinessKey}>Data approach</span>
          <div className={styles.radioGroup}>
            {DATA_APPROACH_OPTIONS.map((opt) => (
              <label key={opt.key} className={styles.radioOption}>
                <input
                  type="radio"
                  name="mdp-wizard-data-approach"
                  value={opt.key}
                  checked={dataAndCutoverAssumptions.dataApproach === opt.key}
                  onChange={() =>
                    setDataAndCutoverAssumptions((prev) => ({
                      ...prev,
                      dataApproach: opt.key,
                    }))
                  }
                  data-testid={`mdp-wizard-data-approach-${opt.key}`}
                />
                <span>{opt.label}</span>
              </label>
            ))}
          </div>
        </div>

        <div className={styles.fieldGroup}>
          <span className={styles.readinessKey}>Cutover approach</span>
          <div className={styles.radioGroup}>
            {CUTOVER_APPROACH_OPTIONS.map((opt) => (
              <label key={opt.key} className={styles.radioOption}>
                <input
                  type="radio"
                  name="mdp-wizard-cutover-approach"
                  value={opt.key}
                  checked={
                    dataAndCutoverAssumptions.cutoverApproach === opt.key
                  }
                  onChange={() =>
                    setDataAndCutoverAssumptions((prev) => ({
                      ...prev,
                      cutoverApproach: opt.key,
                    }))
                  }
                  data-testid={`mdp-wizard-cutover-approach-${opt.key}`}
                />
                <span>{opt.label}</span>
              </label>
            ))}
          </div>
        </div>

        <div className={styles.fieldGroup}>
          <span className={styles.readinessKey}>Rollback required</span>
          <div className={styles.radioGroup}>
            {ROLLBACK_OPTIONS.map((opt) => (
              <label key={opt.key} className={styles.radioOption}>
                <input
                  type="radio"
                  name="mdp-wizard-rollback"
                  value={opt.key}
                  checked={dataAndCutoverAssumptions.rollbackRequired === opt.key}
                  onChange={() =>
                    setDataAndCutoverAssumptions((prev) => ({
                      ...prev,
                      rollbackRequired: opt.key,
                    }))
                  }
                  data-testid={`mdp-wizard-rollback-${opt.key}`}
                />
                <span>{opt.label}</span>
              </label>
            ))}
          </div>
        </div>
      </>
    );
  }

  function renderStage6() {
    return (
      <>
        <p className={styles.helperText}>
          What does the Migration Test Pack need to cover? Defaults are
          pre-selected from your Migration Discovery Context.
        </p>
        <div
          className={styles.chipList}
          data-testid="mdp-wizard-test-pack-chips"
        >
          {TEST_PACK_OPTIONS.map((opt) => {
            const selected = testPackExpectations.has(opt.key);
            return (
              <button
                type="button"
                key={opt.key}
                className={`${styles.chip} ${selected ? styles.chipSelected : ''}`}
                onClick={() => toggleTestPack(opt.key)}
                data-testid={`mdp-wizard-test-pack-${opt.key}`}
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

  function renderStage7() {
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
          {([1, 2, 3, 4, 5, 6, 7] as WizardStage[]).map((n, idx) => (
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
          {stage === 2 && renderStage2()}
          {stage === 3 && renderStage3()}
          {stage === 4 && renderStage4()}
          {stage === 5 && renderStage5()}
          {stage === 6 && renderStage6()}
          {stage === 7 && renderStage7()}
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
          {stage < 7 && (
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
          {stage === 7 && (
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
