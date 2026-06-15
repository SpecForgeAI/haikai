/**
 * `specFileLinker` scanner sub-module -- public orchestrator entry point.
 *
 * Spec: agent-os/specs/2026-05-17-spec-file-auto-linking-phase-3/spec.md
 *
 * Standalone scanner that promotes discovered OAS / Swagger spec files
 * to `interface.spec_link` on already-produced interface candidates.
 *
 * Pipeline placement (P-1): runs as a stage AFTER framework adapters in
 * the existing pack-scanner pipeline. Reuses the same `FindingEmitter`
 * and run context as every other scanner -- no parallel emitter.
 *
 * Inputs:
 *  - `repoRoot`: absolute path to the repo root being scanned.
 *  - `serviceRootPath`: repo-relative service-root prefix for P-17
 *    scoping (`null` disables scoping; only safe for single-service
 *    repos).
 *  - `existingInterfaceCandidates`: candidates produced by upstream
 *    framework adapters. The linker only ever MUTATES these in place
 *    (sets `data.spec_link`) -- it NEVER creates new candidates (P-5).
 *  - `runContext`: forwarded into emitted findings.
 *
 * Output schema (`runSpecFileLinker(input) -> { updatedCandidates,
 * diagnostics, findings }`):
 *  - `updatedCandidates`: pass-through of the input list with
 *    `spec_link` set on the matched entries (in-place).
 *  - `diagnostics`: structured `[diag-pack]` log lines, also written
 *    to stdout via `console.log`.
 *  - `findings`: `FindingEmitInput[]` for ambiguous / orphan cases
 *    (P-4) that the caller folds into the existing emit batch.
 *
 * Matching priority order (P-2), first match wins; once a level yields
 * a unique match, lower-priority levels are NOT consulted:
 *  1. `info.title` exact match against `candidate.name`.
 *  2. `paths` common base prefix match against `candidate.data.basePath`.
 *  3. springdoc `tags[].name` match against `candidate.data.openApiTag`.
 *
 * Service-root scoping (P-17): files outside the run's target service
 * root are NOT scanned. Cross-service spec sharing in a monorepo emits
 * `oas_spec_orphan` when no in-scope interface matches.
 *
 * Pre-existing `spec_link` policy (P-8): a non-null `spec_link` is
 * NEVER overwritten. The user's manual choice always wins.
 *
 * Evidence-gap emission (P-4, P-5):
 *  - Ambiguous match (>=2 candidates at the same priority level): emit
 *    `oas_spec_ambiguous_match` via `buildOasSpecAmbiguousGap` with the
 *    full candidate-id list and the spec file path; leave `spec_link`
 *    null on ALL involved candidates -- never guess.
 *  - Orphan spec (qualifying spec file with no in-scope match): emit
 *    `oas_spec_orphan` via `buildOasSpecOrphanGap` with the file path.
 *    No new candidate is created.
 *
 * Diagnostic log line shapes (P-10), all prefixed with
 * `[diag-pack] scanner=spec_file_linker `:
 *  - Start:    `start files=<N>`
 *  - Per-file: `file=<rel-path> kind=<openapi-3|swagger-2|shape-based|non-spec> result=<matched|ambiguous|orphan|skipped_pre_existing|skipped_non_spec>`
 *  - Skipped (pre-existing-link): `spec_link_skipped pre_existing=<existing> path=<discovered>`
 *  - Done:     `done matched=<N> ambiguous=<N> orphan=<N> skipped=<N>`
 *
 * Design-point references: P-1 (pipeline stage), P-2 (priority ladder),
 * P-4 (evidence gaps), P-5 (never create candidates), P-8 (pre-existing
 * skip), P-10 (log shapes), P-17 (service-root scoping).
 */

import type { DiscoveryCandidate } from '../../../../types/candidate';
import type {
  FindingEmitInput,
  FindingEmitRunContext,
} from '../../FindingEmitter';
import {
  buildOasSpecAmbiguousGap,
  buildOasSpecOrphanGap,
} from '../../emissionSources';
import { findSpecFileCandidates, type SpecFileCandidate } from './fileWalker';
import { isOasSpecFile, type DetectionResult } from './signatureDetector';
import { matchSpecToInterface } from './matcher';

// ----------------------------------------------------------------------------
// Public types
// ----------------------------------------------------------------------------

export interface DiagLine {
  /** Free-form diagnostic message (without the `[diag-pack] scanner=spec_file_linker` prefix). */
  message: string;
}

export interface SpecFileLinkerInput {
  /** Absolute path to the repo root being scanned. */
  repoRoot: string;
  /** Repo-relative service-root prefix for P-17 scoping; `null` disables. */
  serviceRootPath: string | null;
  /**
   * Interface candidates from upstream framework adapters. The linker
   * only mutates entries whose `candidateType === 'interfaces'`.
   */
  existingInterfaceCandidates: DiscoveryCandidate[];
  /**
   * Per-run scoping forwarded into emitted findings. Reuses the same
   * shape the rest of the finding pipeline carries (P-1 / P-12 -- no
   * parallel emitter).
   */
  runContext: FindingEmitRunContext;
}

export interface SpecFileLinkerOutput {
  /**
   * The candidate list with `spec_link` updates applied. Same references
   * as `input.existingInterfaceCandidates` -- this is a pass-through with
   * in-place mutation on the `data` field, returned for ergonomic
   * chaining. Pre-existing `spec_link` values are NEVER overwritten.
   */
  updatedCandidates: DiscoveryCandidate[];
  /**
   * Structured diagnostic lines mirrored to `console.log`. Returned so
   * tests can assert specific log shapes without relying on console
   * capture in addition to spying.
   */
  diagnostics: DiagLine[];
  /**
   * `FindingEmitInput`s for ambiguous / orphan cases. Caller folds these
   * into the existing emit batch -- the linker does NOT call the emitter
   * directly (P-1: same emission pipeline, no parallel emitter).
   */
  findings: FindingEmitInput[];
}

// ----------------------------------------------------------------------------
// Internal helpers
// ----------------------------------------------------------------------------

function emit(line: string, sink: DiagLine[]): void {
  sink.push({ message: line });
  // eslint-disable-next-line no-console
  console.log(`[diag-pack] scanner=spec_file_linker ${line}`);
}

/** Filter the candidate set down to interface candidates. */
function filterInterfaces(
  candidates: DiscoveryCandidate[],
): DiscoveryCandidate[] {
  return candidates.filter((c) => c.candidateType === 'interfaces');
}

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

/**
 * Run the standalone spec-file linker pass. Pure (beyond disk reads and
 * `console.log` writes for diagnostics).
 */
export function runSpecFileLinker(
  input: SpecFileLinkerInput,
): SpecFileLinkerOutput {
  const diagnostics: DiagLine[] = [];
  const findings: FindingEmitInput[] = [];
  const updatedCandidates = input.existingInterfaceCandidates;
  const interfaceCandidates = filterInterfaces(updatedCandidates);

  // Stage 1: walk the three documented scopes.
  let walkedFiles: SpecFileCandidate[];
  try {
    walkedFiles = findSpecFileCandidates(input.repoRoot, input.serviceRootPath);
  } catch (err) {
    // Soft-fail: a directory-read crash must not abort the scanner.
    emit(
      `walk_failed reason=${err instanceof Error ? err.message : String(err)}`,
      diagnostics,
    );
    walkedFiles = [];
  }

  emit(`start files=${walkedFiles.length}`, diagnostics);

  let matchedCount = 0;
  let ambiguousCount = 0;
  let orphanCount = 0;
  let skippedCount = 0;

  // Stage 2: per-file signature detection + matching + emission.
  for (const file of walkedFiles) {
    let detection: DetectionResult;
    try {
      detection = isOasSpecFile(file.path, file.content, file.format);
    } catch {
      // Defensive: signatureDetector is soft-fail internally, but guard
      // anyway so a single malformed file cannot crash the scanner.
      detection = { kind: null };
    }

    if (detection.kind == null) {
      emit(
        `file=${file.path} kind=non-spec result=skipped_non_spec`,
        diagnostics,
      );
      continue;
    }

    const matchResult = matchSpecToInterface(
      { parsed: detection.parsed!, filePath: file.path },
      interfaceCandidates,
    );

    // Branch A: unique match.
    if (matchResult.matched) {
      const target = matchResult.matched;
      const existingSpecLink = target.data?.spec_link;
      // Pre-existing `spec_link` skip (P-8) -- user's manual choice wins.
      if (existingSpecLink != null && existingSpecLink !== '') {
        emit(
          `spec_link_skipped pre_existing=${String(existingSpecLink)} path=${file.path}`,
          diagnostics,
        );
        emit(
          `file=${file.path} kind=${detection.kind} result=skipped_pre_existing`,
          diagnostics,
        );
        skippedCount += 1;
        continue;
      }
      // Set the link on the candidate in-place.
      target.data = { ...target.data, spec_link: file.path };
      emit(
        `file=${file.path} kind=${detection.kind} result=matched`,
        diagnostics,
      );
      matchedCount += 1;
      continue;
    }

    // Branch B: ambiguous (multiple candidates at the same priority level).
    if (matchResult.competingMatches.length >= 2) {
      // Leave `spec_link` null on ALL involved candidates -- never guess.
      const candidateIds = matchResult.competingMatches.map((c) => c.id);
      findings.push(
        buildOasSpecAmbiguousGap({
          specFilePath: file.path,
          candidateInterfaceIds: candidateIds,
          reason: matchResult.heuristic
            ? `multiple interfaces matched on ${matchResult.heuristic} heuristic`
            : undefined,
        }),
      );
      emit(
        `file=${file.path} kind=${detection.kind} result=ambiguous`,
        diagnostics,
      );
      ambiguousCount += 1;
      continue;
    }

    // Branch C: orphan (no candidate matched any heuristic).
    findings.push(
      buildOasSpecOrphanGap({
        specFilePath: file.path,
        reason:
          "no interface candidate's name / basePath / openApiTag matched the spec's info.title / paths / tags[].name",
      }),
    );
    emit(
      `file=${file.path} kind=${detection.kind} result=orphan`,
      diagnostics,
    );
    orphanCount += 1;
  }

  emit(
    `done matched=${matchedCount} ambiguous=${ambiguousCount} orphan=${orphanCount} skipped=${skippedCount}`,
    diagnostics,
  );

  return { updatedCandidates, diagnostics, findings };
}
