# D6 — Non-reconciling work at reconcile time

This is Spec 6 (of 6, FINAL) in the discovery-completeness + net_new program. It is an EXTENSION of the ALREADY-BUILT reconciliation + bug loop (the prior program's spec `migration-reconciliation-and-bug-loop`, BUILT + verified — changeset 183, migrationReconciliationDriver, the disposition states, the circuit breaker) and the ALREADY-BUILT holistic TEST mechanism (the prior program's `holistic-integration-e2e-test-work-items`). D6 does NOT rebuild either — it extends both to correctly handle the non-API / net_new world the rest of this program introduced.

## Two things D6 does

### 1. net_new API endpoint → target_only = EXPECTED (not a break)
A net_new API endpoint (provenance=net_new, from D5) appears in reconciliation as a `target_only` diff (present in the migrated target, absent from the pinned current-state baseline). Today the built reconciler classifies target_only diffs and they would surface as breaks for human disposition. D6 AUTO-RECOGNISES that a target_only diff whose operation maps to a known net_new work item is EXPECTED — so it is NOT surfaced as a break (auto-dispositioned as intentional/expected via the built disposition states), reducing human toil. This CONSUMES D5's provenance marker. The oracle does NOT change (current-state always) — D6 just stops a deliberately-added endpoint from being a false break.

THE MATCHING CHALLENGE (flag for shaping): mapping a target_only diff (which carries method+path + source identity) back to a net_new work item. Earlier investigation found NO clean id-join exists today — the model↔operation link is by "<METHOD> <path>" string key. So D6's match is likely by method+path string key against the net_new API work items' operations (the built Spec-1 `coveredEndpointIds` groundwork + the describe→generate spec content from D5 are candidate sources for a net_new endpoint's operation). Default when a target_only can't be matched to a net_new item: treat it as a break for human disposition (the SAFE default — never silently swallow).

### 2. Steer the holistic TEST mechanism to verify non-API/batch work by EFFECT
Reconciliation is API-only, so it can't verify non-API work (D3 operational_capability stories, D5 operational net_new). The built holistic TEST mechanism generates integration/E2E TEST work items by reviewing stories' specs. D6 STEERS it so that for non-API / operational stories it writes EFFECT-asserting tests (run the pipeline → assert DB tables + downstream message + snapshot) — the only way to verify the batch tier reconciliation can't touch. This is a steering enhancement to the built holisticTestPlanningPrompt / holisticTestDefinitionHandler: recognise operational/non-API stories (by provenance + the operational_capability marker / source_capability_id) and emit effect-assertion tests for them.

## Key open questions (for shaping)
- WHERE the net_new target_only auto-recognition lives: a post-diff disposition pass in the built reconciler (migrationReconciliationDriver / the deployed→reconcile path), vs inside diff classification. Likely a post-diff pass that auto-dispositions matched target_only diffs.
- HOW a net_new API endpoint's operation(s) are known for matching (coveredEndpointIds groundwork? the generated spec content? a new per-item operations field?). This determines match reliability.
- WHICH disposition state a net_new-expected target_only gets (reuse the built accepted/wont_report/intentional_deviation, or a dedicated "expected_net_new"?).
- HOW the holistic reviewer recognises a non-API/operational story (provenance=net_new operational + the operational_capability context / source_capability_id) and the prompt steering for effect-assertions.
- Whether D6 needs ANY new changeset (likely NONE — reuses D5 provenance + the built disposition states + the built holistic schema) — confirm.

## Owners
- gateway: the reconciler extension (the post-diff net_new-target_only auto-disposition + the match logic) + the holistic effect-test steering (prompt + handler recognition of operational/non-API stories).
- AMS: likely NONE (reuses D5 provenance + built disposition states + built holistic schema); confirm no changeset.
- frontend: minimal — surface a net_new target_only as expected/auto-dispositioned in the built breaks review (so the human sees it was recognised, not hidden).

## Reuse
- The BUILT migration-reconciliation-and-bug-loop: the diff runner / diff items (method+path + source_baseline_item_id), migrationReconciliationDriver (the deployed→full-baseline reconcile + the disposition lifecycle), the disposition states (accepted/wont_report/intentional_deviation), the breaks review surface.
- The BUILT holistic TEST mechanism: holisticTestPlanningPrompt + holisticTestDefinitionHandler (feature/epic review → integration|e2e TEST work items).
- D5 provenance marker; D3 operational_capability stories + source_capability_id; built Spec-1 coveredEndpointIds groundwork.

## Scope boundaries (OUT of D6)
- The provenance marker itself (D5); the carry_over completeness gate (D4); capability synthesis + spec-gen (D2/D3). D6 = reconcile-time CONSUMPTION of provenance (net_new target_only = expected) + holistic effect-test STEERING only. The oracle stays current-state-always; the bug loop / circuit breaker / disposition machinery are untouched.

## Repo conventions
gateway = Express/TS, jest with the live-LLM guard (mock llmClient) + architectureModelClientMock; AMS = Java/Spring, new Liquibase changesets ONLY if truly needed (latest applied 183; D2=184, D4≈185, D5≈186 — D6 likely NONE), boxed PATCH-mutable types, snake_case wire; frontend = React/TS, vitest + renderWithProviders + tsc baseline. EXTEND the built reconciliation + holistic mechanisms, do not fork or rebuild them.
