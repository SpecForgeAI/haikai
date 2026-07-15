/**
 * Gap wayfinding registry.
 *
 * Spec 2026-06-11 Deterministic Findings-Coverage Verification + Gap
 * Wayfinding — Task Group 2 (Decision D1: frontend-only module).
 *
 * THE single code→{explanation, destination} map for migration-readiness
 * gap codes. Covers all 11 `MigrationGapCodes`, the 2 context warnings, and
 * the synthetic per-finding `unaddressed_finding` entry (14 total). Follows
 * the `SECTION_LABELS` / `humanizeCandidateType` code→human-label idiom from
 * `DiscoveryReviewRoom.tsx`; lives alongside `personaConfig.ts` /
 * `taskConfig.ts`. Surfaces import; they never re-derive copy or links.
 *
 * Contract notes:
 *   - `buildDestination(ctx)` returns an app route string or `null` (action
 *     label renders as plain text on `null`). All routes are RELATIVE to the
 *     architecture base `/projects/{projectId}/architectures/{architectureId}`.
 *   - Run-scoped destinations use `flaggedRunId ?? runIds[0]` (D4 —
 *     client-side derivation, first-selected-run fallback) and DEGRADE to
 *     the `/discovery` listing route when no run id is available.
 *   - The registry NEVER throws on an unknown code — `getGapWayfindingEntry`
 *     generates a fallback entry (humanized snake_case title, generic
 *     explanation, no link) so a new server code can never crash a surface.
 *   - Per-finding deep links are built by `buildUnaddressedFindingEntry` so
 *     the review workspace and the registry share ONE link construction
 *     (`.../discovery/runs/{runId}?tab=findings&findingId={id}` — consumed
 *     by the Task Group 3 route params on the run detail page).
 */

import type { FindingsCoverageSnapshotFinding } from '../utils/findingsCoverage';

// ============================================================================
// Types
// ============================================================================

/** Context for destination building — ids the calling surface already holds. */
export interface GapWayfindingContext {
  projectId: string;
  architectureId: string;
  /** Selected discovery run ids (wizard run selection / draft inputs). */
  runIds?: string[];
  /** The run a specific gap was flagged against, when derivable (D4). */
  flaggedRunId?: string | null;
  /** API Behaviour Baseline ids, when the surface holds them. */
  baselineIds?: string[];
}

export interface GapWayfindingEntry {
  title: string;
  explanation: string;
  actionLabel: string;
  /** Returns an app route or `null` when no sensible route exists. */
  buildDestination: (ctx: GapWayfindingContext) => string | null;
}

// ============================================================================
// Route helpers
// ============================================================================

function architectureBase(ctx: GapWayfindingContext): string {
  return `/projects/${ctx.projectId}/architectures/${ctx.architectureId}`;
}

function resolveRunId(ctx: GapWayfindingContext): string | null {
  const flagged = ctx.flaggedRunId;
  if (typeof flagged === 'string' && flagged.length > 0) return flagged;
  const first = ctx.runIds?.find((id) => typeof id === 'string' && id.length > 0);
  return first ?? null;
}

/**
 * Run-scoped destination builder: `/discovery/runs/{runId}{suffix}` using
 * `flaggedRunId ?? runIds[0]`, degrading to the `/discovery` listing route
 * when no run id is available.
 */
function runScopedDestination(
  ctx: GapWayfindingContext,
  suffix: string,
): string {
  const base = architectureBase(ctx);
  const runId = resolveRunId(ctx);
  if (!runId) return `${base}/discovery`;
  return `${base}/discovery/runs/${runId}${suffix}`;
}

// ============================================================================
// The complete entry table (user-facing copy from the spec — verbatim)
// ============================================================================

export const GAP_WAYFINDING: Record<string, GapWayfindingEntry> = {
  no_api_behaviour_baseline: {
    title: 'No API behaviour baseline',
    explanation:
      'No activated current-state API behaviour baseline exists. The baseline is the behavioural oracle the migration is verified against — without it the plan’s API stories cannot anchor to verified current behaviour.',
    actionLabel:
      'Go to API Behaviour — capture a current-state baseline, accept the captures, Save as Baseline, then Activate',
    buildDestination: (ctx) => `${architectureBase(ctx)}/api-behaviour`,
  },
  unresolved_discovery_decisions: {
    title: 'Unresolved discovery decisions',
    explanation:
      'Discovery raised decision tasks that have not been resolved. Each open decision is an ambiguity in the architecture model the plan generator has to guess at.',
    actionLabel: 'Open the run and resolve decision tasks via the Architecture Room',
    buildDestination: (ctx) => runScopedDestination(ctx, '?room=open'),
  },
  missing_current_to_target_mappings: {
    title: 'Missing current-to-target mappings',
    explanation:
      'Target-state elements are not explicitly mapped from the current state. Mappings drive what gets migrated, replaced, or decommissioned — unmapped elements are invisible to scoping and sequencing.',
    actionLabel:
      'Open the Target State workspace — use Suggest from current and resolve unmapped elements',
    buildDestination: (ctx) =>
      `${architectureBase(ctx)}/architecture-design/target-state`,
  },
  no_database_discovery_findings: {
    title: 'No database discovery findings',
    explanation:
      'No database-source discovery has run. Database discovery is the source for schema migration — without it the plan’s data stories have no schema evidence behind them.',
    actionLabel: 'Open Discovery and start a database discovery run',
    buildDestination: (ctx) => `${architectureBase(ctx)}/discovery`,
  },
  high_severity_unreviewed_findings: {
    title: 'Unreviewed critical/high findings',
    explanation:
      'Critical or high-severity discovery findings are still awaiting review. Only approved findings count toward plan coverage — unreviewed ones are unverified risks the plan can neither include nor safely ignore.',
    actionLabel:
      'Open the run’s Findings tab and approve / reject / defer the critical and high findings',
    buildDestination: (ctx) => runScopedDestination(ctx, '?tab=findings'),
  },
  missing_oas_for_in_scope_interface: {
    title: 'Missing API spec for an in-scope interface',
    explanation:
      'An interface in migration scope has no OpenAPI/WSDL spec attached. The spec seeds capture-session operations and endpoint-completeness checks.',
    actionLabel:
      'Open Applications and attach the interface’s OpenAPI / WSDL spec',
    buildDestination: (ctx) => `${architectureBase(ctx)}/metamodel/applications`,
  },
  insufficient_runtime_evidence: {
    title: 'Insufficient runtime evidence',
    explanation:
      'Little or no runtime evidence (logs) backs the discovered architecture. Runtime evidence confirms which code paths actually execute, separating live behaviour from dead code.',
    actionLabel: 'Start a discovery run with runtime log files uploaded',
    buildDestination: (ctx) => `${architectureBase(ctx)}/discovery`,
  },
  no_sample_data_hints: {
    title: 'No sample data hints',
    explanation:
      'Database discovery ran without data profiling, so the plan has no sample-data shapes. Profiling hints feed data-migration sizing and realistic test-data stories.',
    actionLabel: 'Start a database discovery run with profiling mode enabled',
    buildDestination: (ctx) => `${architectureBase(ctx)}/discovery`,
  },
  incomplete_capture_coverage: {
    title: 'Incomplete capture coverage',
    explanation:
      'The activated baseline includes operations that were never actually captured. Uncaptured operations are holes in the behavioural oracle — migrated behaviour for them cannot be verified.',
    actionLabel:
      'Open API Behaviour and complete capture for the uncovered operations in the Capture Review panel',
    buildDestination: (ctx) => `${architectureBase(ctx)}/api-behaviour`,
  },
  under_specified_endpoints: {
    title: 'Under-specified endpoints',
    explanation:
      'Some endpoints lack the data-effect links that say which entities they read or write. Without them, story scoping cannot trace an endpoint’s blast radius through the data layer.',
    actionLabel:
      'Open the run’s candidates and link endpoints to the entities they touch',
    buildDestination: (ctx) => runScopedDestination(ctx, ''),
  },
  discovery_harness_inventory_mismatch: {
    title: 'Discovery / capture inventory mismatch',
    explanation:
      'The committed endpoint inventory and the capture harness’s operation set diverge — the model and the behavioural baseline disagree about what the service exposes.',
    actionLabel:
      'Re-run the capture wizard and resolve its inventory reconciliation step (include or exclude-with-reason each unmatched endpoint)',
    buildDestination: (ctx) => `${architectureBase(ctx)}/api-behaviour`,
  },
  // -- Persistence-tier pack gaps (Spec 2026-07-02-a/-b) ---------------------
  no_physical_schema_promoted: {
    title: 'Discovered schema not promoted',
    explanation:
      'Database discovery ran but no tables were promoted into the Data domain. The DB migration pack — and the plan’s DB streams — build from the COMMITTED physical model; unpromoted discovery is invisible to them.',
    actionLabel:
      'Open the database discovery run and promote the schema candidates (tables, columns, relationships)',
    buildDestination: (ctx) => runScopedDestination(ctx, ''),
  },
  db_migration_pack_missing: {
    title: 'DB migration pack missing',
    explanation:
      'No deterministic DB migration pack exists for this architecture. The pack is the schema-migration source of truth the plan’s DB streams are generated from; Create Migration Plan generates it automatically once db.engine is captured.',
    actionLabel:
      'Open the Migration Delivery Plan page — the Schema migration tab generates the pack (or re-run Create Migration Plan)',
    buildDestination: (ctx) =>
      `${architectureBase(ctx)}/migration-delivery-plan?section=schema-migration`,
  },
  unresolved_db_pack_decisions: {
    title: 'Unresolved DB pack decisions',
    explanation:
      'The DB migration pack raised needs-decision entries (unmappable types, collation hazards, computed columns, delta keys) that are still open. Flagged objects stay individually gated in the plan until each decision is resolved.',
    actionLabel:
      'Open the Schema migration tab and resolve the pack decision queue, then regenerate',
    buildDestination: (ctx) =>
      `${architectureBase(ctx)}/migration-delivery-plan?section=schema-migration`,
  },
  unapproved_db_translations: {
    title: 'Unapproved DB translations',
    explanation:
      'DB code-object translation drafts (procs / triggers / views) are awaiting review. Only APPROVED translations are ever applied to the target; unreviewed drafts block the apply stories.',
    actionLabel:
      'Open the Schema migration tab → Translations and review the outstanding drafts',
    buildDestination: (ctx) =>
      `${architectureBase(ctx)}/migration-delivery-plan?section=schema-migration`,
  },
  db_consumers_unrevalidated: {
    title: 'DB consumers not revalidated',
    explanation:
      'The DB migration changed schema/procedures that code endpoints depend on (dialect-affected consumers), but those consumers have not been revalidated against the deployed target. Until a scoped parity check clears them, their behaviour after the DB change is unverified.',
    actionLabel:
      'Open the Schema migration tab and run “Revalidate DB consumers” against the deployed target',
    buildDestination: (ctx) =>
      `${architectureBase(ctx)}/migration-delivery-plan?section=schema-migration`,
  },
  // -- Context warnings ------------------------------------------------------
  no_discovery_runs_selected: {
    title: 'No discovery runs selected',
    explanation:
      'The plan context was assembled without any discovery runs, so it carries no findings, candidates, or evidence — the generator works from the committed model alone.',
    actionLabel: 'Select discovery runs in this wizard, or run discovery first',
    buildDestination: (ctx) => `${architectureBase(ctx)}/discovery`,
  },
  no_findings_in_run: {
    title: 'Selected run has no findings',
    explanation:
      'A selected discovery run contributed no findings. Either the run scope was too narrow or it did not complete its analysis stages.',
    actionLabel: 'Open the run’s Findings tab to check what it produced',
    buildDestination: (ctx) => runScopedDestination(ctx, '?tab=findings'),
  },
  // -- Synthetic per-finding entry -------------------------------------------
  // The canonical per-finding cards are built by `buildUnaddressedFindingEntry`
  // (which carries the finding's own title + severity + run); this registry
  // entry is the code-keyed generic so `getGapWayfindingEntry` stays total.
  unaddressed_finding: {
    title: 'Unaddressed finding',
    explanation:
      'This approved finding is not referenced by any book-of-work item — the plan does not address it.',
    actionLabel: 'Open this finding',
    buildDestination: (ctx) => runScopedDestination(ctx, '?tab=findings'),
  },
};

// ============================================================================
// Unknown-code fallback (the registry never throws)
// ============================================================================

/** Humanize a snake_case gap code into sentence case ("foo_bar" → "Foo bar"). */
export function humanizeGapCode(code: string): string {
  const words = (code ?? '')
    .trim()
    .split(/[_\s]+/)
    .filter((w) => w.length > 0);
  if (words.length === 0) return 'Unknown gap';
  const sentence = words.join(' ').toLowerCase();
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

/**
 * Resolve a gap / context-warning code to its registry entry. Unknown codes
 * get a generated fallback (humanized title, generic explanation, no link)
 * so a new server code can never throw or crash a consuming surface.
 */
export function getGapWayfindingEntry(code: string): GapWayfindingEntry {
  const entry = GAP_WAYFINDING[code];
  if (entry) return entry;
  return {
    title: humanizeGapCode(code),
    explanation: 'Review this gap with your architect.',
    actionLabel: 'Review this gap with your architect',
    buildDestination: () => null,
  };
}

// ============================================================================
// Per-finding deep links (shared by the review workspace + registry)
// ============================================================================

/** A fully-resolved card for one unaddressed snapshot finding. */
export interface UnaddressedFindingWayfindingEntry {
  /** The finding's own title. */
  title: string;
  /** The finding's severity (renders as a severity badge). */
  severity: string;
  explanation: string;
  actionLabel: string;
  /**
   * The finding-drawer deep link
   * (`.../discovery/runs/{runId}?tab=findings&findingId={id}`), or the
   * `/discovery` listing route when the finding carries no run id.
   */
  destination: string | null;
}

/**
 * Build the per-finding wayfinding entry for one unaddressed snapshot
 * finding. Uses the finding's OWN runId (not the context's) so the deep
 * link lands on the run that produced the finding; degrades to the
 * `/discovery` listing route when the finding has no run id.
 */
export function buildUnaddressedFindingEntry(
  finding: FindingsCoverageSnapshotFinding,
  ctx: GapWayfindingContext,
): UnaddressedFindingWayfindingEntry {
  const base = architectureBase(ctx);
  const severity = finding.severity || '';
  const runId = typeof finding.runId === 'string' ? finding.runId.trim() : '';
  const destination =
    runId.length > 0
      ? `${base}/discovery/runs/${runId}?tab=findings&findingId=${encodeURIComponent(finding.id)}`
      : `${base}/discovery`;
  return {
    title: finding.title || finding.id,
    severity,
    explanation: `This approved ${severity || 'accepted'} finding is not referenced by any book-of-work item — the plan does not address it.`,
    actionLabel: 'Open this finding',
    destination,
  };
}
