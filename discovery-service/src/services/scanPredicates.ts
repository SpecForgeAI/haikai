/**
 * SCAN-stage predicate emission — predicate run-judging batch. See
 * docs/trace-logging.md §Predicate self-scoring layer and
 * agent-os/planning/2026-07-10-predicate-run-judging-design.md.
 *
 * Pure counting over the in-memory candidate set at code-scan completion;
 * emission only — never mutates candidates, never throws (a predicate failure
 * must not affect the run). Field access is defensive: a missing blob counts
 * as "absent", not an error.
 */
import { createTracer, Corr } from '../trace';
import { DiscoveryCandidate } from '../types/candidate';

const trace = createTracer('discovery');

/** Shape of the findings-emission summary the run manager already computes. */
export interface FindingsEmitSummary {
  attempted?: number;
  persisted?: number;
  deduped?: number;
  failed?: boolean;
}

function dataOf(c: DiscoveryCandidate): Record<string, unknown> {
  return (c.data as Record<string, unknown> | undefined) ?? {};
}

export function emitCodeScanPredicates(
  candidates: DiscoveryCandidate[],
  findingsEmit: FindingsEmitSummary | undefined,
  corr: Corr,
): void {
  if (!trace.enabled) return;
  try {
    const byType = new Map<string, number>();
    for (const c of candidates) {
      byType.set(c.candidateType, (byType.get(c.candidateType) ?? 0) + 1);
    }
    const typeSummary =
      [...byType.entries()].sort().map(([t, n]) => `${t}=${n}`).join(' ') || 'none';
    const endpoints = candidates.filter((c) => c.candidateType === 'endpoints');

    // SCAN.CAND.01 — the scan minted endpoint candidates at all.
    trace.predicate(
      'SCAN.CAND.01', 'endpoint candidates minted',
      endpoints.length > 0,
      'endpoints > 0',
      `endpoints=${endpoints.length} (${typeSummary})`,
      corr,
    );

    // SCAN.VIEW.01 — every view-rendering endpoint carries the
    // out-of-parity-scope marker (parity is API-only by user decision).
    let viewTotal = 0;
    let viewMarked = 0;
    for (const e of endpoints) {
      const contract = dataOf(e).response_contract as Record<string, unknown> | undefined;
      if (!contract || contract.response_kind !== 'view-html') continue;
      viewTotal += 1;
      if (contract.parity_scope === 'out_of_scope_view') viewMarked += 1;
    }
    if (viewTotal === 0) {
      trace.predicateSkip(
        'SCAN.VIEW.01', 'view endpoints carry out-of-parity-scope marker',
        'no view-rendering endpoints discovered in this codebase', corr,
      );
    } else {
      trace.predicate(
        'SCAN.VIEW.01', 'view endpoints carry out-of-parity-scope marker',
        viewMarked === viewTotal,
        `marked=${viewTotal}/${viewTotal}`,
        `marked=${viewMarked}/${viewTotal}`,
        corr,
      );
    }

    // SCAN.PROC.01 — internal processes (Quartz / scheduled-task / batch /
    // JMS) minted with entry metadata. Internal-process entries ride the
    // `endpoints` candidate type with `endpoint_subtype` (+ verbatim
    // `internal_process` metadata for the XML-declared ones).
    const internal = endpoints.filter((e) => {
      const d = dataOf(e);
      return d.endpoint_subtype !== undefined || d.internal_process !== undefined;
    });
    if (internal.length === 0) {
      trace.predicateSkip(
        'SCAN.PROC.01', 'internal processes minted with entry metadata',
        'no internal-process entry points discovered in this codebase', corr,
      );
    } else {
      const bySubtype = new Map<string, number>();
      let withMeta = 0;
      for (const e of internal) {
        const d = dataOf(e);
        const sub = String(d.endpoint_subtype ?? d.httpMethod ?? 'unknown').toLowerCase();
        bySubtype.set(sub, (bySubtype.get(sub) ?? 0) + 1);
        if (d.internal_process !== undefined) withMeta += 1;
      }
      const subtypeSummary =
        [...bySubtype.entries()].sort().map(([t, n]) => `${t}=${n}`).join(' ');
      trace.predicate(
        'SCAN.PROC.01', 'internal processes minted with entry metadata',
        internal.length > 0,
        'internal-process candidates > 0 with entry kinds',
        `count=${internal.length} (${subtypeSummary}) with_verbatim_metadata=${withMeta}`,
        corr,
      );
    }

    // SCAN.DIAL.01 — every data-effect edge that captured explicit SQL/JPQL
    // (`query_text`) carries a deterministic `sql_dialect` classification
    // (Spec 2026-07-06-f). Derived-query edges carry neither, by design.
    const effects = candidates.filter((c) => c.candidateType === 'endpoint_data_effects');
    let withQuery = 0;
    let withDialect = 0;
    const dialectCounts = new Map<string, number>();
    let constructsTotal = 0;
    for (const eff of effects) {
      const meta = dataOf(eff).path_metadata_json as Record<string, unknown> | undefined;
      if (!meta || meta.query_text === undefined) continue;
      withQuery += 1;
      const dialect = meta.sql_dialect;
      if (typeof dialect === 'string' && dialect !== '') {
        withDialect += 1;
        dialectCounts.set(dialect, (dialectCounts.get(dialect) ?? 0) + 1);
      }
      const constructs = meta.non_portable_constructs;
      if (Array.isArray(constructs)) constructsTotal += constructs.length;
    }
    if (withQuery === 0) {
      trace.predicateSkip(
        'SCAN.DIAL.01', 'query_text edges carry sql_dialect classification',
        `no data-effect edges with explicit query_text (effects=${effects.length})`, corr,
      );
    } else {
      const dialectSummary =
        [...dialectCounts.entries()].sort().map(([d, n]) => `${d}=${n}`).join(' ');
      trace.predicate(
        'SCAN.DIAL.01', 'query_text edges carry sql_dialect classification',
        withDialect === withQuery,
        `classified=${withQuery}/${withQuery}`,
        `classified=${withDialect}/${withQuery} (${dialectSummary}) non_portable_constructs=${constructsTotal}`,
        corr,
      );
    }

    // SCAN.FID.01 — response-fidelity contracts extracted onto endpoints.
    const withContract = endpoints.filter(
      (e) => dataOf(e).response_contract !== undefined,
    ).length;
    if (endpoints.length === 0) {
      trace.predicateSkip(
        'SCAN.FID.01', 'response-fidelity contracts extracted',
        'no endpoint candidates minted', corr,
      );
    } else {
      trace.predicate(
        'SCAN.FID.01', 'response-fidelity contracts extracted',
        withContract > 0,
        'response_contract attached to > 0 endpoints',
        `with_contract=${withContract}/${endpoints.length}`,
        corr,
      );
    }

    // SCAN.FIND.01 — pipeline findings persisted without loss (attempted ==
    // persisted after dedupe; the emitter already computes the summary).
    if (!findingsEmit) {
      trace.predicateSkip(
        'SCAN.FIND.01', 'pipeline findings persisted without loss',
        'finding-emission summary unavailable for this run', corr,
      );
    } else {
      trace.predicate(
        'SCAN.FIND.01', 'pipeline findings persisted without loss',
        findingsEmit.failed !== true,
        'persisted + deduped == attempted',
        `attempted=${findingsEmit.attempted ?? 0} persisted=${findingsEmit.persisted ?? 0} ` +
          `deduped=${findingsEmit.deduped ?? 0} failed=${findingsEmit.failed === true}`,
        corr,
      );
    }
  } catch {
    /* predicates must never affect the run */
  }
}
