/**
 * Kratos Framework Pack (V3 `FrameworkPack`).
 *
 * Spec: V3 Pack Migration Batch (Task Group 7)
 *
 * Stage 2 producer for Go + Kratos codebases. Consumes the IR map
 * emitted by `goLangPack` (the V3 Stage 1 producer) and delegates to
 * the existing deterministic `runKratosAdapter` to emit
 * `DiscoveryCandidate[]` tagged with `_addedBy: 'kratos-adapter'`.
 *
 * The V2 `runKratosAdapter` signature takes a flat `SourceFileIR[]`
 * array plus `runId`. The V3 `FrameworkPack.adapt` contract passes
 * `Map<string, SourceFileIR>`; we convert the map's values into the
 * flat array here so no adapter-logic change is needed.
 *
 * Applicability predicate (`when`) requires BOTH `language: 'Go'` AND
 * `technology: 'Kratos'` — per-field AND semantics preserved by
 * `matchesPredicate`.
 *
 * Candidate tagging (`_addedBy: 'kratos-adapter'`) is unchanged from
 * V2 — downstream consumers and per-pack baseline gates rely on this
 * tag shape.
 *
 * Detection surface (copied from the V2 adapter, unchanged):
 *   - physical_entity: Go structs where ANY field carries a `gorm:`
 *     struct tag.
 *   - physical_attribute: each field of a gorm-tagged struct, with
 *     column name extracted from the `column:` portion of the tag when
 *     present, and `isPrimaryKey` inferred from `primaryKey` in the
 *     tag.
 *   - logical_entity: Go structs with only `json:` tags (no `gorm:`) —
 *     DTO-style request / response structs.
 *   - logical_data_attribute: each field of a json-only struct.
 *   - interface: Go interface types whose name ends in `Server` /
 *     `Service` / `Client` — the shape of protobuf-generated gRPC
 *     service contracts. Other interface types are skipped.
 *
 * NOT covered by the deterministic adapter (prompt-layer territory):
 *   - `.proto` file parsing — service / message definitions live in
 *     generated `*.pb.go` / `*_grpc.pb.go` files which the adapter
 *     picks up via the `Server` / `Client` interface-name heuristic
 *     but the source-of-truth `.proto` contracts are invisible.
 *   - Wire dependency-injection graphs (`wire_gen.go` / `wire.go`).
 *   - Kratos middleware chain ordering and registration sites.
 *   - Biz / Data / Service layering conventions and the repository
 *     pattern (`UserRepo` interface + `userRepo` impl).
 *   - Metrics / tracing hook registrations and gRPC stream handlers.
 *   - Event publishers / subscribers for message-bus integrations.
 */

import type { FrameworkPack, TechHints } from '../../packTypes';
import type { SourceFileIR } from '../../languageIR';
import type { DiscoveryCandidate } from '../../../../types/candidate';
import { runKratosAdapter } from '../../frameworkAdapters/kratos';

export const kratosFrameworkPack: FrameworkPack = {
  id: 'kratos',
  when: { language: 'Go', technology: 'Kratos' },

  adapt(
    irFiles: Map<string, SourceFileIR>,
    runId: string,
    _techHints: TechHints,
  ): DiscoveryCandidate[] {
    // V2 adapter takes a flat IR array; convert the Map values to preserve
    // the existing adapter shape without changing any adapter logic.
    const irArray = Array.from(irFiles.values());
    const candidates = runKratosAdapter(irArray, runId);
    console.log(
      `[kratos] Emitted ${candidates.length} candidates from ${irArray.length} IR files.`,
    );
    return candidates;
  },
};
