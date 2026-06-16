- [x] FU-1 `nonDeterministicEndpointKeys` (`endpoint_signal` tolerance) POPULATED
  in production end-to-end. RESOLVED.
  The diff runner's injectable `nonDeterministicEndpointKeys: Set<"${METHOD}|{path}">`
  seam was inert (defaulted empty) because nothing built it. A new finding->key
  bridge (`api-migration-validation-service/src/services/nonDeterministicEndpointKeys.ts`,
  `resolveNonDeterministicEndpointKeys`) now resolves the discovery
  `non_deterministic_endpoint` signal into the set and is wired into BOTH in-process
  diff trigger sites, so a production reconcile populates it.
  - Resolution path (candidate-link, NO AMS change): the signal is an
    `evidence_gap` finding with `detail_json.gapType='non_deterministic_endpoint'`
    that `supports`-LINKS to an `endpoints` discovery candidate; the candidate's
    `data` carries the HTTP route (`httpMethod`/`operation_verb` +
    `fullPath`/`path_or_address`, `name` as fallback). AMS exposes findings +
    candidates RUN-SCOPED only (no architecture-wide finding search), so the bridge
    enumerates the architecture's discovery runs (`listDiscoveryRuns`), lists
    `evidence_gap` findings linked to `discovery_candidate` per run
    (`listFindingsForRun`), filters by `gapType`, follows the `supports` link, and
    resolves the candidate via the run's `endpoints` candidates
    (`listCandidatesForRun`). Three thin read wrappers added to `archModelClient.ts`
    over EXISTING AMS endpoints -- no new AMS route, no schema change.
  - Template-vs-concrete keying (the load-bearing safety property): candidate
    `fullPath` is a route TEMPLATE (`/widgets/{id}`) but the diff keys on the
    CONCRETE captured path (`/widgets/42`). The bridge takes the diff's OWN source
    baseline items and emits each item's CONCRETE `operationKey` -- keyed BYTE-
    IDENTICALLY to `diffRunner.operationKey` (`${(method??'GET').toUpperCase()}|
    ${path??'/'}`) -- when its method+path structurally matches a flagged template
    (segment count + literal/single-placeholder match = exact router semantics, NOT
    a fuzzy matcher). So tolerance cannot silently miss AND cannot wrongly widen.
  - Wired sites (all fail-soft to the strict G1 default): `targetReplayRunner.ts`
    auto-diff (reuses the already-loaded source `items`), plus `routes/diffActions.ts`
    POST `/api/diffs` create + `/recompute` (each lists the source baseline items and
    resolves the keys before spawning the runner). The resolver is injectable on each
    site for tests; `runDiffFn` widened to `(diffId, deps?)`.
  - Invariants preserved: an UNRESOLVED finding (no candidate link / candidate
    missing / no route / no matching source op) is DROPPED + logged, never guessed;
    any AMS read error degrades to an empty set = strict; the seam only ADDS value
    tolerance (presence/shape STILL break -- proven by the shape-still-breaks test);
    no findings / empty arch = strict, exactly today's behaviour.
  - Ran (green): validation-service `tsc --noEmit` clean + the full jest suite (243
    passed / 1 pre-existing skip), incl. the new
    `nonDeterministicEndpointKeys.test.ts` (9: resolve, template match, all four
    drop-to-strict paths, name fallback, no-signal, fail-soft) and
    `nonDeterministicEndpointKeysE2e.test.ts` (2: bridge->runDiff tolerates value
    drift tagged `endpoint_signal` / still breaks on a shape change), plus the
    pre-existing `diffRunner.volatility.test.ts` + the updated
    `targetReplayRunnerAutoDiff.test.ts` (call shape now `('diff-1', { keys })`). No
    AMS build needed (no AMS change).
- [x] FU-2 Probe INVOCATION wired end-to-end at current-state capture/pin. RESOLVED.
  The probe's natural call site is the CAPTURE loop, not a new pin route: the only
  moment the current system is authoritative and callable through a live
  `SessionHttpExecutor` is inside `execute_http_request`
  (`api-migration-validation-service/src/services/tools/execute_http_request.ts`),
  where the orchestrator's per-session `httpExecutor` AND the scenario request
  (method/path/query/headers/body) are both in hand. The probe now runs THERE
  (`runVolatilityProbe` + `volatilityEnvelopeToWire`) for non-mutating, 2xx
  scenarios and records its envelope on the capture row. The traced promotion path
  (`SaveAsBaselineModal.tsx` -> AMS `createBaselineItem`) is frontend-driven, so the
  envelope is carried forward: capture row `volatile_paths_json` (new AMS column,
  changeset 188) -> capture DTO read -> `SaveAsBaselineModal` passes
  `cap.volatile_paths_json` -> AMS `createBaselineItem` -> source baseline item's
  `volatile_paths_json` (changeset 187, Group 1). A production current-state capture
  now writes a REAL probed envelope that reaches `volatile_paths_json`.
  - Schema change: new AMS column `api_behaviour_captures.volatile_paths_json JSONB
    NULL` (changeset `188-capture-volatile-paths.sql`, registered after 187 with the
    `not.columnExists` precondition) -- the carrier that survives capture->promotion.
  - Guards preserved: mutating / non-idempotent scenarios are tagged `not_probed`
    with NO replay calls; non-2xx responses leave the envelope `null` (strict);
    deterministic responses yield an empty-`paths` `probed` envelope (still non-null,
    distinct from `null`); a probe error is non-fatal (envelope stays `null` = strict,
    G1). Verified by `executeHttpRequestVolatilityProbe.test.ts` and the extended
    `captureSessionFullFlow.e2e.test.ts` (real run -> real stub -> real executor ->
    envelope on capture row -> threaded to `createBaselineItem` -> on the baseline item).
  - Ran (green): AMS `CaptureVolatilePathsTest` + `BaselineItemVolatilePathsTest` +
    the full AMS api-behaviour suite (63); validation-service `tsc --noEmit` clean +
    the touched capture-flow/probe tests (49, incl. the 2 incidental request-count
    assertions in `executeHttpRequestRewrite.test.ts` updated to `1 + k` for the
    probe firing). Could NOT run: frontend tests/`tsc` -- `typescript`/`vitest` are
    absent from `frontend/node_modules` and there is no network for an offline
    install (matches the Group-5 5.4 residual). The frontend change is a minimal,
    structurally type-safe optional-field add + one carry-through line.
