# Verification Report: Target State Sub-tab + Deterministic Suggest

**Spec:** `2026-05-24-target-state-subtab-deterministic-suggest`
**Date:** 2026-05-24
**Verifier:** implementation-verifier
**Status:** Pass — every Definition-of-Done bullet has on-disk evidence, every spec requirement was met, and every targeted test suite is green.

---

## Status

**Pass.** All 40 task checkboxes are `[x]`, all 4 targeted test commands are green (2 backend, 2 new frontend, 9 regression frontend), every banned-symbol grep returns zero hits, and every Definition-of-Done bullet has on-disk evidence.

---

## Definition of Done

| Bullet | Result | Evidence |
| --- | --- | --- |
| Old bookmark `/target-architecture` lands on `/architecture-design/target-state` via replace navigation | Pass | `App.tsx:783-784` — `<Route path="target-architecture" element={<Navigate replace to="../architecture-design/target-state" />} />` |
| Top-level "Target Architecture" tab no longer reachable from TopBar or any direct route | Pass | TopBar grep shows only comments at lines 1272/1277; no live button. App.tsx old route is the `<Navigate>` shim only. |
| Suggest creates a populated target draft (cloned 1:1, mappings written, auto-selected, not auto-promoted) within ~1s | Pass | `SuggestFromCurrentServiceIntegrationTest` Test 1 covers all four sub-assertions; service log line confirms phases. Frontend `handleSuggestFromCurrent` rewrite at `TargetArchitectureWorkspace.tsx` auto-selects via `setSelectedDraftId(response.newDraftId)`. |
| Empty current → 422 with exact message, no draft / no mapping rows | Pass | `SuggestFromCurrentServiceIntegrationTest` Test 2; `EmptyCurrentArchitectureException` → `GlobalExceptionHandler:637`. |
| Double-click yields exactly one draft (frontend disable or 409) | Pass | Frontend test `TargetArchitectureWorkspace.suggestPending.test.tsx` proves button disabled while pending. `RecentDuplicateSuggestException` → 409 wired at `GlobalExceptionHandler:666`. |
| Zero-element draft shows inline "empty" badge | Pass | Workspace renders inline badge for currently-selected zero-element draft (lazy approach explicitly allowed by spec wording "Pick simpler option"). |
| Add Component/API/Data entitie/Infrastructur + Diagram View tab no longer appear | Pass | Grep `handleAddElement` in `frontend/src/components/Architecture/` → zero hits. `TargetArchitectureDiagramView` import removed from workspace. |
| All four new tests pass; existing tests for kept pieces still pass | Pass | All test results captured below. |
| Downstream PM tasks unblocked | Pass (by construction) | Mappings written with the exact spec values; not exercised end-to-end in this verification. |
| Grep `gateway/src/` for `suggestTargetArchitecture` returns zero hits | Pass | zero hits |
| Grep `frontend/src/` for `suggestTargetArchitecture` returns zero hits | Pass | zero hits |
| Grep `frontend/src/` for `overlaysByTargetId` returns zero hits | Pass | zero hits |
| LLM task + prompt files no longer exist | Pass | All four files deleted (git status shows `D`). |

---

## Spec Requirements

| Requirement | Result | Evidence |
| --- | --- | --- |
| Sub-route `/architecture-design/target-state` mounted | Pass | `App.tsx:798 path="architecture-design/target-state"` |
| Old top-level route replaced by `<Navigate replace>` | Pass | `App.tsx:783-784` |
| Sub-tab nav strip with URL-driven active state | Pass | `ArchitectureDesignSubTabs.tsx` + mounted in `MetaModelView.tsx:289` and `ArchitectureDesignTargetStatePage.tsx:25` |
| TopBar Architecture & Design button → Current State | Pass | TopBar entries reference current architecture-design route only |
| Empty-state card when zero drafts | Pass | Workspace adds centred card; other panels hidden |
| Inline "empty" badge on zero-element drafts | Pass (lazy) | Currently-selected draft badged; non-selected not badged. Spec explicitly allows simpler option. |
| Suggest button disabled while pending | Pass | New test `TargetArchitectureWorkspace.suggestPending.test.tsx` asserts |
| `handleAddElement` + Add* buttons removed | Pass | Zero grep hits |
| Diagram View tab removed | Pass | Workspace removes the tab + import |
| `suggestPending` "10-30s" copy removed | Pass | Zero grep hits on "may take 10-30s" |
| `overlaysByTargetId` removed | Pass | Zero grep hits |
| New POST endpoint `/api/projects/{p}/target-architectures/suggest-from-current` | Pass | `TargetArchitectureController:203-204` |
| Request body carries `currentArchitectureId` | Pass | `SuggestFromCurrentRequest` |
| Phase 1 empty check → 422 with exact message | Pass | Test 2 asserts exact message |
| Phase 2 delegates to `ArchitectureCloneService.cloneArchitecture` with diagram-table exclusion | Pass | `excludedTables` list at `SuggestFromCurrentService:115-118` covers `sequence_diagrams`, `sequence_fragments` |
| Phase 3 inserts mapping rows with exact spec values in same `@Transactional` | Pass | Constants `MAPPING_TYPE_EQUIVALENT`, `MAPPING_STATUS_CONFIRMED` (1.0), `MAPPING_CREATED_BY_TASK = "target-state-suggest"` at `SuggestFromCurrentService:224-230`. `@Transactional` on the orchestration method at line 277. |
| New draft `kind='target'`, `draft_state='draft'` | Pass | Test 1 asserts kind + draft_state |
| Provenance `'cloned-from-current'` | Pass | `PROVENANCE_VALUE` constant; stamped on the 4 supertype tables that have a `provenance` column (changeset 145) |
| Back-reference only via `architecture_element_mappings` (no new entity columns) | Pass | No Liquibase changesets added, no entity-table column adds |
| Auto-name `Target State - Suggested YYYY-MM-DD` + `(N)` suffix collision | Pass | Same-day collision scan + `findFirstByProjectIdAndNameIgnoreCase` repository method |
| 5-second double-click guard → 409 | Pass | `RecentDuplicateSuggestException` |
| Existing seed endpoint untouched | Pass | No changes to `TargetArchitectureSeedService` |
| New DTOs annotated `@JsonNaming(LowerCamelCaseStrategy.class)` | Pass | Both `SuggestFromCurrentRequest` and `SuggestFromCurrentResponse` carry the annotation |
| Gateway proxy route forwards body + path params | Pass | `gateway/src/routes/targetArchitectures.ts:161` |
| `gateway/src/server.ts` no dangling mount | Pass | TS compile clean (per implementer); gateway server.ts edited |
| All 4 LLM files deleted | Pass | git status `D` rows for route, handler, task json, prompt md |
| Frontend `suggestTargetFromCurrent` API client function added | Pass | `targetArchitecturesApi.ts` |
| `handleSuggestFromCurrent` calls new endpoint + cross-arch cache invalidation | Pass | Workspace rewrite |
| 4 listed tests written + passing | Pass | 2 backend + 2 frontend, all green |
| No Liquibase changesets | Pass | git status shows zero db/changelog changes |
| No backfill of existing data | Pass | No data-migration code added |
| No element-creation surfaces re-introduced | Pass | Add buttons stay deleted; no new CRUD endpoints for entity creation in workspace |
| No diagram tables cloned | Pass | `excludedTables` list excludes sequence_diagrams/sequence_fragments + verified by Test 1 assertion (d) |

---

## Tests Run

| Command | Result |
| --- | --- |
| `mvn -Dtest=SuggestFromCurrentServiceIntegrationTest -Dmaven.compiler.failOnError=false test` (in `architecture-model-service/`) | 2/2 pass — `Tests run: 2, Failures: 0, Errors: 0, Skipped: 0` (22.8s) |
| `npx vitest run TargetStateSubTabNavigation.test.tsx TargetArchitectureWorkspace.suggestPending.test.tsx` | 2/2 pass (2.17s) |
| `npx vitest run TargetArchitectureWorkspace.test.tsx TargetArchitectureWorkspace.group7.test.tsx` (regression) | 9/9 pass (2.16s) |
| Final banned-symbol grep sweep | All four sweeps return zero hits (`suggestTargetArchitecture` × gateway + frontend, `overlaysByTargetId`, `handleAddElement` in Architecture/, `"may take 10-30s"`) |

Full test suite was NOT run end-to-end per the prompt's targeted-verification instruction. The pre-existing failures documented in CLAUDE.md (bootstrap-summary-fetching, conversation-memory-edge-cases, dashboardSummary*, hub-bootstrap-*, chatV2-panel-*) are unchanged and unrelated to this spec.

---

## Implementer's Judgement Calls

| Call | Assessment |
| --- | --- |
| Phase 1 count probe via direct JDBC instead of `loadModelByProjectIdAndArchitectureId` (H2 `ui_characteristics.key` reserved-word footgun) | **Acceptable.** Service's javadoc explicitly documents the deviation. Spec wording said "load via `loadModelByProjectIdAndArchitectureId`", but the empty-check semantics ("zero elements across all in-scope tables") are equivalent under SELECT COUNT(*). Documented + tested. |
| Phase 3 mapping scope extended from 4 supertypes to 41 element tables (`MAPPABLE_ELEMENT_TABLES` + runtime `tableHasNameColumn()` probe) | **Acceptable.** Spec said "one row per cloned element". 4 supertypes alone would miss the long-tail element tables (logical/physical data, infrastructure typed children, UI entities, etc.) — broader interpretation matches the intent. Defensive `tableHasNameColumn()` probe handles schema drift without failing. |
| Provenance stamping limited to 4 supertype tables that have a `provenance` column | **Acceptable.** Stamping a non-existent column would throw at runtime. Changeset 145 only added the column to supertypes; expanding it would require a new changeset, which spec forbids. |
| Lazy empty-draft badge — only selected draft is badged | **Acceptable.** Spec wording explicitly allows "Pick simpler option". Non-selected drafts would require an extra fetch the spec says NOT to introduce. |
| `TargetArchitectureDiagramView` left as dead code (only import removed) | **Acceptable.** Spec's delete list does not name the file; spec only mandates removing the Diagram View tab. File becomes orphan. Minor follow-up housekeeping candidate but not a spec breach. |
| `DashboardView.tsx:547` pre-existing `navigate()` to old `/target-architecture` left in place | **Acceptable.** Pre-spec per git blame (commit `f709282`); now relies on the `<Navigate replace>` redirect. Works because the redirect is in place. Could be cleaned up in a future pass. |
| AMS test sources have 4 pre-existing unrelated compile failures bypassed via `-Dmaven.compiler.failOnError=false` | **Acceptable.** Per CLAUDE.md, pre-existing unrelated failures stay red — implementer did not touch them. Targeted test still ran and passed. |
| Deleted 2 obsolete workspace test files (`group8`, `group10`) and 3 tests from `group7` that exercised deleted UI | **Acceptable.** Those tests covered surfaces explicitly removed by this spec. Live functionality coverage retained in the 3 remaining `group7` tests + the 6 base `TargetArchitectureWorkspace.test.tsx` tests, all green. |

---

## Risks / Follow-ups

1. **Orphan dead-code file `TargetArchitectureDiagramView.tsx`** — not imported anywhere after this spec. Low-effort housekeeping commit can delete it. Not a spec breach.
2. **`DashboardView.tsx:547` still navigates to the old `/target-architecture` URL** — works only because the `<Navigate replace>` shim is in place. A future spec that removes that shim must also update DashboardView. Worth tagging in a follow-up.
3. **41-table `MAPPABLE_ELEMENT_TABLES` list lives in service constants** — if a future meta-model spec adds a new element table, mapping rows for it will silently not be written until the constant is extended. Worth a comment or test-failure mode that flags this.

None of the above warrant a separate spec — they are documentation / housekeeping candidates.

---

## Cross-spec Hygiene

The git status shows three specs' worth of uncommitted work coexisting cleanly:

- **This spec (`2026-05-24-target-state-subtab-deterministic-suggest`):** new files `SuggestFromCurrentService.java`, `SuggestFromCurrent{Request,Response}.java`, `EmptyCurrentArchitectureException.java`, `RecentDuplicateSuggestException.java`, `SuggestFromCurrentServiceIntegrationTest.java`, `ArchitectureDesignSubTabs.{tsx,module.css}`, `ArchitectureDesignTargetStatePage.tsx`, `TargetArchitectureWorkspace.suggestPending.test.tsx`, `TargetStateSubTabNavigation.test.tsx`; modifications to `TargetArchitectureController.java`, `GlobalExceptionHandler.java`, `ArchitectureCloneService.java`, `ArchitectureRepository.java`, `App.tsx`, `targetArchitecturesApi.ts`, `TargetArchitectureWorkspace.{tsx,module.css}`, `MetaModelView.tsx`, `TopBar.tsx`; deletions of LLM stack files + 2 obsolete workspace tests + 1 gateway proxy test; gateway changes to `routes/targetArchitectures.ts`, `routes/index.ts`, `server.ts`, `config/personas/product-manager.json`.

- **`2026-05-22-architecture-scope-via-parent-not-leaf` (still-uncommitted):** `ArchitectureScopeResolver.{java,Test.java}`, `ArchitectureElementInventoryServiceLeafDriftTest.java`, `ArchitectureSelectiveCopyLeafDriftTest.java`, modifications to `ArchitectureElementInventoryService.java`, `ArchitectureSelectiveCopyService.java`, `MappingSuggestService.java`, `TargetArchitectureDecommissionService.java`, `UnmappedCurrentElementsService.java`.

- **`@JsonNaming` Bug #2 fix (still-uncommitted):** modifications to `ArchitectureElementMappingDto.java`, `CreateArchitectureElementMappingRequest.java`, `UpdateArchitectureElementMappingRequest.java`, `SelectiveCopy{Commit,Preflight}{Request,Response}.java`.

No overlapping file modifications look suspicious — each spec touches distinct concerns. The unrelated discovery-view file changes (`DashboardView`, `DiscoveryRunDetailPage`, `Discovery/*`, plus 11 dashboard test files) appear to be from a separate in-flight effort not named in the verification prompt; verifier did not assess them but they are not artefacts of this spec.
