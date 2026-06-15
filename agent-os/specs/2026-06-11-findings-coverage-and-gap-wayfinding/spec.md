# Specification: Deterministic Findings-Coverage Verification + Gap Wayfinding

## Goal

Replace the LLM-asserted (and currently broken) `findingsAddressed` / `findingsNotAddressed` numbers with a deterministic, code-computed coverage check — accepted critical/high discovery findings snapshotted at plan create, graded on read against `discoveryFindingReferences` — and give every readiness gap code a human explanation plus a deep link (or nearest-route link) to the surface that resolves it.

## User Stories

- As a PM, I want the plan's findings-coverage numbers computed by code from the actual accepted findings and the actual book-of-work references, so I can trust them the same way I trust the endpoint and capture-inventory coverage checks.
- As a PM reviewing a plan draft, I want an "Unaddressed findings" panel listing each accepted critical/high finding the plan does not reference, with a link straight to that finding, so I can decide whether to expand the plan or accept the gap.
- As a migration engineer looking at the wizard's readiness panel, I want each gap explained in plain English with a "Go to ..." link to where I fix it, so I don't need to already know the product to act on `discovery_harness_inventory_mismatch`.

## Specific Requirements

**Accepted-findings snapshot at plan CREATE time (gateway, `migrationBookOfWorkHandler.ts`)**
- Add a `fetchAcceptedFindings` dependency seam to `MigrationBookOfWorkHandlerDeps` (alongside `fetchContext` / `createDraft`), defaulting to a paged AMS walk per selected discovery run: `GET {amsBase}/api/model/projects/{projectId}/architectures/{currentArchitectureId}/discovery/runs/{runId}/findings?status=approved&severity=...&page=&size=` — follow the "keep going until a short page" walk in `gateway/src/services/dbMigrationPack/inputs.ts` (~line 600).
- The endpoint's `severity` filter is SINGLE-VALUE (verified in `DiscoveryFindingController.list`), so perform TWO passes per run — `severity=critical` and `severity=high` — and union by finding id. The `status` param filters the reviewer disposition (`review_status`); `approved` is the "accepted" semantics.
- NEVER source coverage from the context's `highPriorityFindings` (all-statuses, capped at 100).
- Compose the snapshot into `generationSummary` BEFORE the Stage-5 `createDraft` call, in BOTH generation modes (legacy combined and per-stream `assembleBookOfWork` output). Shape, deterministic and timestamp-free: `generationSummary.findingsCoverage = { findings: [{ id, title, severity, runId }] }`, sorted by `id`.
- In the legacy combined mode, DELETE any LLM-emitted `findingsAddressed` / `findingsNotAddressed` keys from `generationSummary` before create — new drafts never persist LLM-asserted coverage in any mode.
- When no discovery runs were selected, omit `findingsCoverage` entirely (nothing to grade — the draft renders like a legacy draft). When runs were selected but zero approved critical/high findings exist, persist `findingsCoverage` with an empty `findings` array (an honest "nothing to cover").
- Fail-soft: if the findings fetch errors, log a warning, append a generation warning (existing `warnings` array), and omit the snapshot — coverage is advisory and must NEVER fail or block generation. No AMS schema or write changes anywhere; `generation_summary_json` stays immutable post-create.

**One shared on-read coverage computation module (frontend)**
- New module `frontend/src/utils/findingsCoverage.ts` — the SINGLE implementation every surface imports; no per-surface copies.
- Contract: `computeFindingsCoverage(generationSummary, items)` returns `null` when `generationSummary.findingsCoverage.findings` is not an array (legacy drafts, fetch-failed drafts) — consumers hide the coverage section entirely on `null`.
- Otherwise returns `{ total, addressedCount, notAddressedCount, unaddressed: [{ id, title, severity, runId }] }` where the referenced set is the union of `items[].discoveryFindingReferences` across the draft's `bookOfWork.items` (tolerate missing/non-array fields).
- Matching is deterministic: trimmed, case-insensitive id equality between snapshot ids and reference strings — no fuzzy/title matching, no LLM.
- Because expansion appends keep `book_of_work_json.items[].discoveryFindingReferences` current, on-read computation self-updates as epic expansions land stories — no recompute writes or hooks.
- Type the `findingsCoverage` snapshot in `frontend/src/api/migrationBookOfWorkApi.ts` / `migrationDeliveryPlanApi.ts` `MigrationBookOfWorkGenerationSummary` and deprecate-remove the `findingsAddressed?` / `findingsNotAddressed?` typed accessors.

**Replace the LLM-asserted numbers on every draft surface (fixes the live bug)**
- `MigrationDeliveryPlanProgressSummary.tsx` (~lines 360–361, 490–493): delete the `safeNumber(gen?.findingsAddressed, 0)` reads; render "Findings addressed / unaddressed" from `computeFindingsCoverage`, and HIDE both lines when it returns `null` — the current behaviour (always-0 from dropped/array-typed fields) is the bug being fixed.
- `MigrationBookOfWorkReviewWorkspace.tsx`: same computed values in its summary area (it loads the full draft, so items + snapshot are at hand).
- `MigrationBookOfWorkDraftListView.tsx`: the list API returns full drafts including `book_of_work_json`, so each row may show the computed counts; rows whose draft has no snapshot show nothing.
- Back-compat rule (D8): hide, don't approximate — no "not computed" badges, no fallback derivation from references alone, and the legacy `gen.findingsAddressed` values stop rendering for OLD drafts too.
- Advisory-only: coverage numbers never gate Save Draft, Save to Backlog, or expansion.

**"Unaddressed findings" panel in the plan review workspace**
- New panel in `MigrationBookOfWorkReviewWorkspace.tsx` listing each `unaddressed` snapshot finding: title + severity badge + a per-finding deep link built by the registry's `unaddressed_finding` entry (`.../discovery/runs/{runId}?tab=findings&findingId={id}`).
- When `notAddressedCount === 0` and the snapshot is non-empty, render a positive confirmation ("All N accepted critical/high findings are addressed by this plan"); when the snapshot is empty, render "No accepted critical/high findings to cover".
- Panel hidden entirely when `computeFindingsCoverage` returns `null` (legacy drafts).
- Panel re-derives from current draft state so it updates after an epic expansion refreshes the draft.

**Dashboard card fix (`MigrationDeliverySummaryCards`, D7)**
- The Evidence coverage card currently shows only the reference count (`evidenceSummary.discoveryFindingReferenceCount`); the addressed/unaddressed figures the progress summary shows are broken at source. Surface the SAME computed-on-read values here: the dashboard route (`migration-books-of-work/:bookId/delivery`) fetches the draft via the existing `getMigrationBookOfWork(projectId, bookId)` and passes the computed coverage into the cards.
- Card breakdown gains "Findings addressed: A / T" (computed) alongside the existing reference-count line; the line is omitted when the draft has no snapshot — no knowingly-broken or knowingly-fake number left behind.
- Draft fetch failure degrades to the current card (reference counts only); never blocks the dashboard load.

**Gap wayfinding registry — one frontend module (D1)**
- New module `frontend/src/config/gapWayfindingRegistry.ts` exporting `GAP_WAYFINDING: Record<string, GapWayfindingEntry>` with `GapWayfindingEntry = { title, explanation, actionLabel, buildDestination(ctx) }`; `ctx = { projectId, architectureId, runIds?, flaggedRunId?, baselineIds? }`. Follow the `SECTION_LABELS` / `humanizeCandidateType` code→label idiom from `DiscoveryReviewRoom.tsx`.
- `buildDestination` returns an app route string or `null`; run-scoped entries use `flaggedRunId ?? runIds[0]`, and degrade to the `/discovery` listing route when no run id is available (D4 — context derived client-side, first-selected-run fallback; no readiness-response enrichment).
- Unknown codes get a generated fallback entry: humanized code (snake_case → sentence case), generic "Review this gap with your architect" explanation, no link — the registry must never throw on a new server code.
- Per-finding entries are built by an exported `buildUnaddressedFindingEntry(finding, ctx)` helper so the review workspace and registry share the same link construction.
- All routes below are relative to the architecture base `/projects/{projectId}/architectures/{architectureId}`.

**Registry content — the complete entry table (user-facing copy)**

| Code | Title | Explanation | Action label | Destination |
| --- | --- | --- | --- | --- |
| `no_api_behaviour_baseline` | No API behaviour baseline | No activated current-state API behaviour baseline exists. The baseline is the behavioural oracle the migration is verified against — without it the plan's API stories cannot anchor to verified current behaviour. | Go to API Behaviour — capture a current-state baseline, accept the captures, Save as Baseline, then Activate | `/api-behaviour` (nearest route; capture wizard is a modal) |
| `unresolved_discovery_decisions` | Unresolved discovery decisions | Discovery raised decision tasks that have not been resolved. Each open decision is an ambiguity in the architecture model the plan generator has to guess at. | Open the run and resolve decision tasks via the Architecture Room | `/discovery/runs/{runId}?room=open` (D3 approximate link; no run → `/discovery`) |
| `missing_current_to_target_mappings` | Missing current-to-target mappings | Target-state elements are not explicitly mapped from the current state. Mappings drive what gets migrated, replaced, or decommissioned — unmapped elements are invisible to scoping and sequencing. | Open the Target State workspace — use Suggest from current and resolve unmapped elements | `/architecture-design/target-state` |
| `no_database_discovery_findings` | No database discovery findings | No database-source discovery has run. Database discovery is the source for schema migration — without it the plan's data stories have no schema evidence behind them. | Open Discovery and start a database discovery run | `/discovery` (Start Discovery Run is a modal) |
| `high_severity_unreviewed_findings` | Unreviewed critical/high findings | Critical or high-severity discovery findings are still awaiting review. Only approved findings count toward plan coverage — unreviewed ones are unverified risks the plan can neither include nor safely ignore. | Open the run's Findings tab and approve / reject / defer the critical and high findings | `/discovery/runs/{runId}?tab=findings` |
| `missing_oas_for_in_scope_interface` | Missing API spec for an in-scope interface | An interface in migration scope has no OpenAPI/WSDL spec attached. The spec seeds capture-session operations and endpoint-completeness checks. | Open Applications and attach the interface's OpenAPI / WSDL spec | `/metamodel/applications` (nearest route; upload is per-interface) |
| `insufficient_runtime_evidence` | Insufficient runtime evidence | Little or no runtime evidence (logs) backs the discovered architecture. Runtime evidence confirms which code paths actually execute, separating live behaviour from dead code. | Start a discovery run with runtime log files uploaded | `/discovery` |
| `no_sample_data_hints` | No sample data hints | Database discovery ran without data profiling, so the plan has no sample-data shapes. Profiling hints feed data-migration sizing and realistic test-data stories. | Start a database discovery run with profiling mode enabled | `/discovery` |
| `incomplete_capture_coverage` | Incomplete capture coverage | The activated baseline includes operations that were never actually captured. Uncaptured operations are holes in the behavioural oracle — migrated behaviour for them cannot be verified. | Open API Behaviour and complete capture for the uncovered operations in the Capture Review panel | `/api-behaviour` |
| `under_specified_endpoints` | Under-specified endpoints | Some endpoints lack the data-effect links that say which entities they read or write. Without them, story scoping cannot trace an endpoint's blast radius through the data layer. | Open the run's candidates and link endpoints to the entities they touch | `/discovery/runs/{runId}` (Candidates is the default tab) |
| `discovery_harness_inventory_mismatch` | Discovery / capture inventory mismatch | The committed endpoint inventory and the capture harness's operation set diverge — the model and the behavioural baseline disagree about what the service exposes. | Re-run the capture wizard and resolve its inventory reconciliation step (include or exclude-with-reason each unmatched endpoint) | `/api-behaviour` |
| `no_discovery_runs_selected` (context warning) | No discovery runs selected | The plan context was assembled without any discovery runs, so it carries no findings, candidates, or evidence — the generator works from the committed model alone. | Select discovery runs in this wizard, or run discovery first | `/discovery` |
| `no_findings_in_run` (context warning) | Selected run has no findings | A selected discovery run contributed no findings. Either the run scope was too narrow or it did not complete its analysis stages. | Open the run's Findings tab to check what it produced | `/discovery/runs/{runId}?tab=findings` |
| `unaddressed_finding` (per-finding, synthetic) | The finding's own title (+ severity badge) | This approved {severity} finding is not referenced by any book-of-work item — the plan does not address it. | Open this finding | `/discovery/runs/{runId}?tab=findings&findingId={findingId}` |

**Wizard readiness panel — explanation cards replace bare codes**
- In `MigrationDeliveryPlanWizard.tsx`, replace the `Gaps: {gaps.join(', ')}` row (~lines 676–684) with one explanation card per gap code: registry title, explanation, and a "Go to ..." `Link` when `buildDestination` returns a route (action label as plain text when it returns `null`).
- `contextWarnings` (`no_discovery_runs_selected`, `no_findings_in_run`) render the same card treatment in the readiness card area.
- Deep-link `ctx` comes from wizard state: projectId/architectureId from the route, selected run ids from the wizard's run selection, `flaggedRunId` derived client-side (e.g. the run id carried on relevant `highPriorityFindings` highlights), falling back to the first selected run (D4).
- Styling extends the existing `readinessCard` / `warningBanner` / chip conventions in the wizard's module CSS and the `secretsPrompt` banner pattern — no new design system.
- Navigation away from the wizard is a plain link (new readiness fetch on return is acceptable); no wizard-state preservation work in this spec.
- Cards remain advisory — no gating of the Generate action.

**`?findingId=` and `?room=open` route params on the discovery run detail page**
- `DiscoveryRunDetailPage.tsx` already drives `?tab=` via `useSearchParams` (`TAB_QUERY_PARAM`, `parseTabParam`) — read `findingId` and `room` the same way; query params on existing routes only, no new routes.
- `findingId` present with no explicit `tab` param → treat the active tab as `findings`. Thread `initialFindingId` through `DiscoveryRunDetailView` to `FindingsTab`.
- `FindingsTab` fetches the single finding via the existing `GET .../findings/{findingId}` (so paging/filters cannot hide it) and sets `selectedFinding` to open the existing `FindingDetailDrawer`, once, on mount. Unknown/404 id → no drawer, no crash, no error banner.
- `room=open` → `DiscoveryRunDetailView` gains an `initialReviewRoomOpen` prop seeding the existing `reviewRoomOpen` state (~line 274) so the Discovery Review Room (Architecture Room) opens on load.
- Both params are tolerant of garbage values and absent runs; they never throw.

**Testing (gateway Jest + frontend Vitest)**
- Gateway: snapshot composition in BOTH modes; two-pass severity union + paged walk; legacy-key stripping; no-runs-selected omission; empty-findings empty snapshot; fail-soft warning path (generation still succeeds, snapshot absent); `fetchAcceptedFindings` seam used by all tests (no live AMS).
- Frontend `findingsCoverage.ts` unit tests: null on missing/legacy snapshot, id matching (trim/case), union across items, empty references.
- Registry test: every one of the 13 codes has an entry; unknown-code fallback; run-scoped destinations degrade to `/discovery` without a run id.
- Surface tests: wizard cards (gap + context-warning rendering, link hrefs), review workspace panel (unaddressed rows + positive/empty states + hidden for legacy drafts), progress summary (computed values + hidden lines for legacy drafts), dashboard card line, `?findingId=` / `?room=open` behaviours (drawer opens, room opens, unknown id ignored).

## Visual Design

No visual assets provided (`planning/visuals/` is empty). Follow existing Migration Delivery Plan styling: the wizard's `readinessCard` / `warningBanner` / chip classes and the `secretsPrompt` banner are the precedents for the explanation cards; the review workspace, draft list, progress summary, and dashboard cards keep their current layout conventions with the coverage elements added in place.

## Existing Code to Leverage

**`gateway/src/services/migrationBookOfWorkHandler.ts` + `dbMigrationPack/inputs.ts` paged findings walk**
- The handler's deps-seam pattern (`fetchContext` / `callLlm` / `createDraft`) is the template for `fetchAcceptedFindings`; Stage 5 (`AmsCreateRequestBody`, ~line 899) is where the snapshot-bearing `generationSummary` is posted.
- `assembleBookOfWork` (~line 476) already composes deterministic counts "never trusted from the LLM" — `findingsCoverage` joins that composition; the legacy combined branch (~line 768) needs the same merge plus key stripping.
- `dbMigrationPack/inputs.ts` (~lines 559–614) shows the AMS findings URL shape, error wrapping, and the page-until-short-page walk to copy.

**`frontend/src/components/.../MigrationDeliveryPlanProgressSummary.tsx` + sibling draft surfaces**
- Lines ~360–361 and ~490–493 are the exact broken `safeNumber(gen?.findingsAddressed, 0)` reads being replaced; its count-badge layout is reused for the computed values.
- `MigrationBookOfWorkReviewWorkspace` and `MigrationBookOfWorkDraftListView` already hold full drafts (`listMigrationBookOfWorks` / `getMigrationBookOfWork` return `book_of_work_json`); the dashboard route holds `bookId` for the same fetch.

**`DiscoveryRunDetailPage.tsx` / `DiscoveryRunDetailView.tsx` / `FindingsTab.tsx`**
- `TAB_QUERY_PARAM` + `parseTabParam` + `useSearchParams` is the established query-param idiom to extend for `findingId` / `room`.
- The view's controlled-tab props and `reviewRoomOpen` state (~line 274) and `FindingsTab`'s `selectedFinding` → `FindingDetailDrawer` flow are the seams the two new params drive — no new drawer or room plumbing.

**`DiscoveryReviewRoom.tsx` `SECTION_LABELS` / `humanizeCandidateType`**
- The repo's code→human-label map precedent; the registry follows the same shape in `frontend/src/config/` (alongside `personaConfig.ts` / `taskConfig.ts`), extended with explanation + destination builder + action label.

**`extractGatewayErrorMessage` pattern (`frontend/src/api/dbMigrationPackApi.ts` ~line 325)**
- The error-parsing idiom for any new frontend fetch handling (dashboard draft fetch, single-finding fetch) introduced by this spec.

## Out of Scope

- Any AMS schema, endpoint, or write changes — `generation_summary_json` stays immutable post-create; `MigrationGapCodes` / readiness assessment are read-only references.
- Server-side `gapContexts` readiness enrichment (noted future option if the 100-finding context cap bites in practice).
- A dedicated decision-tasks page/surface — `unresolved_discovery_decisions` keeps the approximate run-detail link (D3).
- Routing frameworks for modals — the capture wizard, Start Discovery Run modal, and per-interface OAS upload remain modals reached via nearest-route links.
- Any blocking behaviour — coverage and gap cards are advisory; generation, Save Draft, Save to Backlog, and expansion are never gated.
- Retroactive snapshot backfill or recompute for existing drafts — they hide the coverage section (D8).
- Recompute-on-write hooks in the expansion handler — on-read computation already self-updates.
- Fuzzy or title-based matching of `discoveryFindingReferences` to findings, or any LLM involvement in the computation.
- Changing the LLM prompts or the `discoveryFindingReferences` production contract.
- Wizard-state preservation across "Go to ..." navigation round trips.
