# Loop-Guardrail Test Coverage Mapping

## Spec
2026-05-20 Cross-Story Context Injection for Migration Shape-Spec Generation -- Task Group 10.

This document maps each of the four required loop guardrails to one or more explicit, named tests across the AMS, gateway, frontend, and persistence layers. Each guardrail has at least one explicit named test (the spec's acceptance criterion); most are corroborated by tests at multiple layers.

## Guardrail (a) -- Hard cap: pass 2 NEVER triggers a pass 3

| Layer | File | Test (explicit name) |
| ----- | ---- | -------------------- |
| Gateway handler | `gateway/src/__tests__/migrationShapeSpecGenerationHandlerTwoPass.test.ts` | `Test 1 -- LOOP GUARDRAIL: a caller-requested third pass is refused with InvalidPassNumberError; MAX_PASS=2` |
| Persistence (service guard) | `architecture-model-service/src/test/java/com/example/architecturemodel/repository/entity/CrossStoryContextPersistenceTest.java` | `generation_pass vocabulary admits only 1 and 2; service-layer guard rejects every other value` |
| Persistence (SQL CHECK) | `architecture-model-service/src/test/java/com/example/architecturemodel/repository/entity/CrossStoryLiquibaseSmokeTest.java` | `changeset 141 SQL file declares all eight new columns + chk_msg_generation_pass constraint` |

The gateway handler refuses any caller-supplied `pass` outside `[1, MAX_PASS]` with `InvalidPassNumberError` before the LLM is touched. The DB CHECK `(generation_pass IN (1, 2))` is the underlying source of truth at the storage boundary.

## Guardrail (b) -- Pass 2 reads ONLY pass-1 outputs (resolver + handler boundaries)

| Layer | File | Test (explicit name) |
| ----- | ---- | -------------------- |
| Gateway handler | `gateway/src/__tests__/migrationShapeSpecGenerationHandlerTwoPass.test.ts` | `Test 2 -- LOOP GUARDRAIL: pass 2 reads ONLY pass-1 outputs; AMS context call carries pass=2 and passOneSpecIdsInScope populated only with pass-1 ids` |
| AMS resolver | `architecture-model-service/src/test/java/com/example/architecturemodel/service/migration/MigrationSpecContextResolverCrossStoryTest.java` | `sibling_summaries[] returns ONLY generation_pass=1 rows; pass-2 outputs are excluded` |
| AMS resolver (new -- Group 10) | `architecture-model-service/src/test/java/com/example/architecturemodel/service/migration/MigrationSpecContextResolverCrossStoryTest.java` | `sibling_summaries[] omits a pass-1 row whose id is NOT in passOneSpecIdsInScope (resolver-boundary cross-check)` |

Both the gateway (which decides what `passOneSpecIdsInScope` contains) and the AMS resolver (which performs the final `generation_pass = 1` filter) independently enforce this guardrail.

## Guardrail (c) -- Failed / insufficient_context pass-1 stories excluded from sibling context (resolver boundary)

| Layer | File | Test (explicit name) |
| ----- | ---- | -------------------- |
| AMS resolver | `architecture-model-service/src/test/java/com/example/architecturemodel/service/migration/MigrationSpecContextResolverCrossStoryTest.java` | `Pass-1 rows with status failed or insufficient_context are EXCLUDED from sibling_summaries[]` |
| Gateway handler | `gateway/src/__tests__/migrationShapeSpecGenerationHandlerTwoPass.test.ts` | `Test 3 -- LOOP GUARDRAIL: stories whose pass-1 status is failed or insufficient_context are NOT retried in pass 2` |

The resolver test is the canonical guardrail: even when the caller's `passOneSpecIdsInScope[]` includes failed / insufficient_context row ids, they are not returned in `sibling_summaries[]`. The gateway test is the upstream complement: those rows are never even sent forward for pass-2 retry.

## Guardrail (d) -- Token-budget tiered trimming preserves story description, parent rollup, and epic capturedDecisions

| Layer | File | Test (explicit name) |
| ----- | ---- | -------------------- |
| AMS resolver | `architecture-model-service/src/test/java/com/example/architecturemodel/service/migration/MigrationSpecContextResolverCrossStoryTest.java` | `budget_meta.trimmed records sibling specs dropped under a small cross-story cap` |
| AMS resolver | `architecture-model-service/src/test/java/com/example/architecturemodel/service/migration/MigrationSpecContextResolverCrossStoryTest.java` | `Tiered trimming: siblings drop before evidence, evidence before findings; non-trimmable items always retained` |

The second test reserves non-trimmable per-story and cross-story tokens for story description, parent rollup, and epic captured decisions, then asserts those reservations remain accounted for in `usedTokens()` after sibling/evidence/finding admission cycles have run. The `BudgetMetaTracker` itself has no `admit` API for any of the three protected categories, which is itself the contract.

## Additional gap-filling tests added by Task Group 10 (max 10)

Per task notes, Group 10 may add up to 10 additional strategic tests covering gaps not already covered by Groups 1-9. After review, 5 strategic tests are added (well under the cap). The remaining items in the task notes are already covered by Groups 5, 7, and 9, so they are not duplicated here.

| # | Layer | New file / extension | Test name | Gap addressed |
| - | ----- | -------------------- | --------- | ------------- |
| 1 | Gateway | `gateway/src/__tests__/crossStoryLoopGuardrailsIntegration.test.ts` | `autoRunPass2 per-batch override OFF -- pass 2 is skipped even when project default is ON` | Per-batch `autoRunPass2: false` override path explicitly skips pass 2 (task-note gap 4) |
| 2 | Gateway | `gateway/src/__tests__/crossStoryLoopGuardrailsIntegration.test.ts` | `Route maps WorkstreamLockedError to HTTP 409 with WORKSTREAM_LOCKED envelope` | Route-layer 409 mapping not previously covered (cross-layer contract) |
| 3 | Gateway | `gateway/src/__tests__/crossStoryLoopGuardrailsIntegration.test.ts` | `Cross-layer contract: pass-2 BatchResult carries every field the StoryPassTwoDetail drawer reads` | End-to-end handler -> drawer shape contract (cross-layer integration) |
| 4 | AMS resolver | `MigrationSpecContextResolverCrossStoryTest.java` | `parent_rollup excludes superseded epic captured decisions` | Resolver-side enforcement of `status IN (draft, confirmed)` feed contract (status feed cross-check) |
| 5 | AMS resolver | `MigrationSpecContextResolverCrossStoryTest.java` | `sibling_summaries[] omits a pass-1 row whose id is NOT in passOneSpecIdsInScope (resolver-boundary cross-check)` | Resolver-boundary corroboration of guardrail (b): the resolver does not silently widen scope (also referenced in the guardrail (b) table above) |

## Test counts per layer (post-Group 10)

| Layer | Source | Tests |
| ----- | ------ | ----- |
| AMS persistence | `CrossStoryContextPersistenceTest`, `CrossStoryLiquibaseSmokeTest` | 5 + 3 = 8 |
| AMS parser | `ShapeSpecHeadingParserTest` | 4 |
| AMS resolver | `MigrationSpecContextResolverCrossStoryTest` (existing 6 + Group 10's 2) | 8 |
| AMS controller | `EpicCapturedDecisionsControllerTest` | 6 |
| AMS project config | `MigrationSpecContextResolverProjectConfigTest`, `ProjectControllerConfigPatchTest` | (Group 9) |
| Gateway handler / preview | `migrationShapeSpecGenerationHandlerTwoPass`, `migrationShapeSpecCostPreview` | 8 + 4 = 12 |
| Gateway -- Group 10 additions | `crossStoryLoopGuardrailsIntegration.test.ts` | 3 |
| Frontend pass-2 surfaces | `MigrationDeliveryPassTwoSurfaces` | 10 |
| Frontend epic decisions panel | `EpicCapturedDecisionsPanel` | 5 |
| Frontend project config | `project-config-modal` | (Group 9) |

The runtime test count reported below is what the runners actually saw.

## Conclusion

All four required loop guardrails have at least one explicit, named test at the layer where the guardrail is enforced. Cross-layer corroboration exists for guardrails (a), (b), and (c). The five additions in Task Group 10 close the two task-note gaps (autoRunPass2 per-batch override, route 409 mapping) and add cross-layer shape contracts that protect against silent drift between the handler's pass-2 result and the drawer's read model.
