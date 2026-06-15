/**
 * Open-phase LLM grounding assembly — Target State Architect-Persona Conversation,
 * Open-Ended LLM Phase (Spec 2026-06-06-architect-conversation-open-ended-phase,
 * Task Group 2; Q1).
 *
 * Assembles the grounding context the SIBLING open-phase loop (Task Group 3)
 * consumes so its proactively-suggested candidate areas (P3) and its proposed
 * options (S4) are genuinely RELEVANT to the actual system being migrated.
 *
 * Grounding sources (Q1) — four, with a three-source fallback:
 *   1. Captured decisions so far     — rendered VERBATIM via the existing
 *                                      `buildTargetStateDecisionsPromptText`
 *                                      (`../contextResolvers`). No re-implementation.
 *   2. Loaded target-model summary   — taken from the already-fetched
 *                                      `MigrationDiscoveryContext.targetArchitectureSummary`
 *                                      (the existing migration-discovery resolver's
 *                                      output). NO new AMS call.
 *   3. Migration goal / product      — the existing `ProductSummaryContextResolver`
 *      summary                         output (`product-summary` resolver key),
 *                                      passed in as text. NO new AMS call.
 *   4. Discovery findings summary    — taken from the already-fetched
 *      (WHEN AVAILABLE)                `MigrationDiscoveryContext.findingsSummary`
 *                                      (current-state reality). When there are NO
 *                                      findings it is cleanly OMITTED and the three
 *                                      remaining sources stand alone (the Q1 fallback).
 *
 * IMPORTANT — this module is PURE and SIDE-EFFECT-FREE:
 *   - No I/O, no AMS calls, no LLM, no filesystem, no clock, no randomness.
 *   - It COMPOSES already-resolved materials (the caller — Task Group 3 — fetches
 *     them via the existing resolvers/clients and passes them in). This keeps the
 *     helper trivially unit-testable with the underlying resolvers mocked.
 *   - It REUSES `buildTargetStateDecisionsPromptText` verbatim for the captured
 *     decisions section; it does not invent a new captured-decisions renderer.
 *
 * The single grounding source-of-truth here means the sibling loop's prompt
 * assembly (Task Group 3) has one well-formed block to drop into its system /
 * user prompt; no other module needs to re-derive the grounding.
 */

import type { MigrationDiscoveryContext } from '../migrationDiscoveryContextClient';
import type { TargetStateCapturedDecision } from '../targetStateCapturedDecisionsClient';
import { buildTargetStateDecisionsPromptText } from '../contextResolvers';

/**
 * The already-resolved materials the grounding is composed from. The caller
 * (Task Group 3's sibling loop) fetches each via the EXISTING resolvers/clients
 * and passes the results in — this module performs no I/O of its own.
 */
export interface OpenPhaseGroundingInput {
  /**
   * The latest non-superseded captured decisions for the (project, target)
   * pair — exactly what `fetchLatestCapturedDecisions` returns and what the
   * `target-state-decisions-context` resolver already consumes. Rendered via
   * `buildTargetStateDecisionsPromptText`. May be empty.
   */
  capturedDecisions: readonly TargetStateCapturedDecision[];
  /**
   * The already-fetched migration-discovery context (the existing
   * `migration-discovery-context` resolver's underlying object). Carries BOTH
   * the loaded target-model summary (`targetArchitectureSummary`) and the
   * discovery findings summary (`findingsSummary`) — no new AMS call is made
   * here. `null` when the discovery context could not be resolved (the
   * target-model + findings sections are then omitted; the captured-decisions
   * and product-summary sources still ground the loop).
   */
  discoveryContext: MigrationDiscoveryContext | null;
  /**
   * The migration goal / product summary text — exactly what the existing
   * `ProductSummaryContextResolver` (`product-summary` key) returns. `null` /
   * empty when unavailable (that section is then omitted).
   */
  productSummary: string | null;
}

/**
 * A header used to delimit each grounding section so the LLM (and tests) can
 * see which source each block came from. Kept terse — this is prompt context,
 * not user-facing copy.
 */
const SECTION_HEADERS = {
  capturedDecisions: '## Captured decisions so far',
  targetModel: '## Target model summary',
  productSummary: '## Migration goal / product summary',
  findings: '## Discovery findings (current-state reality)',
} as const;

/**
 * Render the loaded target-model summary block from the already-fetched
 * discovery context's `targetArchitectureSummary`. Returns `null` when there is
 * no target-architecture summary to render (so the section is cleanly omitted).
 *
 * Mirrors the count-rendering style of
 * `buildMigrationDiscoveryContextPromptText`'s "Target Architecture Highlights"
 * block but keeps it self-contained (pure; no shared mutable state).
 */
function renderTargetModelSummary(
  ctx: MigrationDiscoveryContext | null,
): string | null {
  const a = ctx?.targetArchitectureSummary;
  if (!a) return null;
  const lines: string[] = [];
  lines.push(`Name: ${a.name} (id ${a.architectureId})`);
  const counts: string[] = [];
  if (a.applicationCount != null) counts.push(`applications=${a.applicationCount}`);
  if (a.serviceCount != null) counts.push(`services=${a.serviceCount}`);
  if (a.interfaceCount != null) counts.push(`interfaces=${a.interfaceCount}`);
  if (a.dataEntityCount != null) counts.push(`dataEntities=${a.dataEntityCount}`);
  if (a.dataStoreCount != null) counts.push(`dataStores=${a.dataStoreCount}`);
  if (a.businessUserCount != null) counts.push(`businessUsers=${a.businessUserCount}`);
  if (a.processActivityCount != null) counts.push(`processActivities=${a.processActivityCount}`);
  if (a.uiScreenCount != null) counts.push(`uiScreens=${a.uiScreenCount}`);
  if (a.userJourneyCount != null) counts.push(`userJourneys=${a.userJourneyCount}`);
  if (counts.length > 0) lines.push(`Entity counts: ${counts.join(', ')}`);
  if (a.hasModel === false) lines.push('NOTE: target architecture has no model loaded.');
  return lines.join('\n');
}

/**
 * Internal: render a key/value count map as a comma-separated "k:v" string.
 * Sorts keys for deterministic output. Returns '' for empty / null maps.
 * (Local copy so this module stays pure + dependency-light — it must not import
 * the private helper in `contextResolvers.ts`.)
 */
function renderCountMap(map: Record<string, number> | undefined | null): string {
  if (!map) return '';
  const keys = Object.keys(map).filter((k) => Number.isFinite(map[k]));
  if (keys.length === 0) return '';
  keys.sort();
  return keys.map((k) => `${k}:${map[k]}`).join(', ');
}

/**
 * Render the discovery-findings summary block from the already-fetched
 * discovery context's `findingsSummary`. Returns `null` when there are NO
 * findings — the Q1 fallback condition: `findingsSummary` absent, OR present but
 * carrying no usable signal (every count null/empty AND `totalFindings` 0 or
 * unset). A `null` return means the caller omits the section and the three
 * remaining sources stand alone.
 */
function renderFindingsSummary(
  ctx: MigrationDiscoveryContext | null,
): string | null {
  const f = ctx?.findingsSummary;
  if (!f) return null;

  const lines: string[] = [];
  if (f.totalFindings != null) lines.push(`Total findings: ${f.totalFindings}`);
  if (f.highSeverityUnreviewedCount != null) {
    lines.push(`High-severity unreviewed: ${f.highSeverityUnreviewedCount}`);
  }
  if (f.sampleDataHintCount != null) {
    lines.push(`Sample-data hints: ${f.sampleDataHintCount}`);
  }
  const byStatus = renderCountMap(f.countsByStatus);
  if (byStatus) lines.push(`By status: ${byStatus}`);
  const bySeverity = renderCountMap(f.countsBySeverity);
  if (bySeverity) lines.push(`By severity: ${bySeverity}`);
  const byCategory = renderCountMap(f.countsByCategory);
  if (byCategory) lines.push(`By category: ${byCategory}`);

  // "No findings" fallback: a findings object that carries no usable signal is
  // treated as ABSENT so the three-source fallback applies cleanly (Q1). A
  // present-but-zero `totalFindings` with no other counts is the empty case.
  const hasUsableSignal =
    lines.length > 0 && !(lines.length === 1 && (f.totalFindings ?? 0) === 0);
  if (!hasUsableSignal) return null;

  return lines.join('\n');
}

/**
 * Compose the open-phase grounding block from already-resolved materials.
 *
 * PURE: no I/O, no AMS calls, no LLM. Reuses `buildTargetStateDecisionsPromptText`
 * verbatim for the captured-decisions section. Sections with no content are
 * cleanly omitted (in particular: the discovery-findings section is omitted when
 * there are no findings — the Q1 three-source fallback).
 *
 * Section order (stable):
 *   1. Captured decisions so far
 *   2. Target model summary
 *   3. Migration goal / product summary
 *   4. Discovery findings (current-state reality) — WHEN AVAILABLE
 *
 * @returns a single well-formed grounding string (sections separated by a blank
 *   line). When NONE of the four sources yields content (no decisions, no
 *   discovery context, no product summary), a short explicit placeholder line is
 *   returned so the prompt never carries an empty grounding block.
 */
export function buildOpenPhaseGrounding(input: OpenPhaseGroundingInput): string {
  const sections: string[] = [];

  // 1 — Captured decisions so far (reuse the existing renderer VERBATIM).
  if (input.capturedDecisions && input.capturedDecisions.length > 0) {
    const decisionsText = buildTargetStateDecisionsPromptText(input.capturedDecisions);
    if (decisionsText && decisionsText.trim().length > 0) {
      sections.push(`${SECTION_HEADERS.capturedDecisions}\n${decisionsText.trim()}`);
    }
  }

  // 2 — Loaded target-model summary (from the already-fetched discovery context).
  const targetModel = renderTargetModelSummary(input.discoveryContext);
  if (targetModel && targetModel.trim().length > 0) {
    sections.push(`${SECTION_HEADERS.targetModel}\n${targetModel.trim()}`);
  }

  // 3 — Migration goal / product summary (existing ProductSummaryContextResolver).
  if (input.productSummary && input.productSummary.trim().length > 0) {
    sections.push(`${SECTION_HEADERS.productSummary}\n${input.productSummary.trim()}`);
  }

  // 4 — Discovery findings summary WHEN AVAILABLE (Q1). Omitted on the
  //     no-findings fallback so the three remaining sources stand alone.
  const findings = renderFindingsSummary(input.discoveryContext);
  if (findings && findings.trim().length > 0) {
    sections.push(`${SECTION_HEADERS.findings}\n${findings.trim()}`);
  }

  if (sections.length === 0) {
    // Defensive: never emit an empty grounding block. The sibling loop still
    // runs (the open phase is optional + user-driven); the LLM is simply told
    // no grounding context is available rather than being handed an empty
    // string it might fill with invented details.
    return 'No additional grounding context is available for the open phase.';
  }

  return sections.join('\n\n');
}
