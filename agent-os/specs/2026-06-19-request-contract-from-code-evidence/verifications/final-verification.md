# Verification Report: Request Contract from Code Evidence

**Spec:** `2026-06-19-request-contract-from-code-evidence`
**Date:** 2026-06-19
**Verifier:** implementation-verifier
**Status:** ✅ Passed

---

## Executive Summary

All four services (AMS, mcp-server, discovery-service, api-migration-validation-service)
were verified end-to-end by running every command directly — not trusting the
implementers' task marks. Every layer compiles/typechecks clean, every targeted
suite is green, and the full amvs jest gate sits at **367 pass / 1 skip** exactly
as expected. All seven load-bearing invariants are met, the mojibake scan is
empty, and `execute_http_request.ts` is fully intact. One benign, intentional
observation (a NUL-character composite-map-key delimiter in
`requestContractEnrichment.ts`) and one cosmetic note (an internal
`schema_version` string-format difference) are recorded below; neither affects
correctness. **Overall verdict: PASS.**

---

## 1. Tasks Verification

**Status:** ✅ All Complete

All 7 task groups were marked `- [x]` in `tasks.md`. There was NO
`implementation/` report content (the directory is empty) and NO prior
`verifications/` content, so every claim was verified by direct code inspection
and command execution rather than by trusting reports. All marks are confirmed
correct by evidence.

### Completed Tasks
- [x] Task Group 1: AMS `request_contract` column, entity, DTO, mapper, changeset 194
- [x] Task Group 2: mcp-server save-back pass-through of `request_contract`
- [x] Task Group 3: AMS-endpoint OAS enrichment at `/start` (content-type + headers)
- [x] Task Group 4: Executor Content-Type default broadening (Fix #3)
- [x] Task Group 5: `requestContractScanner.ts` — request date-format + validation
- [x] Task Group 6: OAS param-format enrichment from `request_contract.param_formats`
- [x] Task Group 7: Cross-layer test review & gap analysis

### Incomplete or Issues
None. All marks verified against code + passing tests.

---

## 2. Per-Service Verification (command evidence)

### AMS (architecture-model-service, JDK 21) — ✅ PASS
- `mvn -o -q compile test-compile` → **exit 0** (offline, clean).
- `mvn -o -q test -Dtest='EndpointRequestContract*'` → **exit 0**.
  - `EndpointRequestContractChangesetTest`: **2 run, 0 fail, 0 error**.
  - `EndpointRequestContractPersistenceTest`: **5 run, 0 fail, 0 error**.
  - Total **7 AMS tests pass**. Hibernate insert/select SQL confirmed to carry the
    `request_contract` column.
- `194-endpoint-request-contract.sql` exists and mirrors
  `168-endpoint-response-contract.sql` (`ALTER TABLE endpoints ADD COLUMN
  request_contract JSONB;`, additive + nullable, internal `schema_version`
  documented, no separate confidence column).
- Master block `id: 194-endpoint-request-contract` registered AFTER `193` (last
  changeset in the file): `onFail: MARK_RAN`, `onError: HALT`, `not columnExists`
  guard on `request_contract`, `sqlFile` with `splitStatements: true` +
  `stripComments: true` — a faithful clone of the 168 block.
- **189–193 unedited:** `git diff` of the master changelog shows ONLY added (`+`)
  lines for the 193 and 194 changeSets — zero `-`/modification lines touching
  189–193; `git diff --stat` for the 189–192 SQL files is empty (unchanged).
- Entity `EndpointEntity.requestContract` (`@Type(JsonType.class)
  @Column(name="request_contract", columnDefinition="jsonb") Map<String,Object>`),
  DTO `EndpointDto` `@JsonProperty("request_contract")` (snake_case, **NO
  `@CamelCaseWire`**), and `EntityMapper` toDto + toEntity passthrough all
  confirmed sibling to `responseContract`.

### mcp-server (Node/TS) — ✅ PASS
- `npx tsc --noEmit` → **exit 0** (clean).
- `npx jest candidateSaveBackRequestContract candidateSaveBackResponseContract
  candidateSaveBack.soap candidateSaveBackEndpointVerbPathFallback` →
  **4 suites, 17 tests, all pass**.
- `case 'endpoints':` now has a `request_contract` arm that (1) rides a
  pre-assembled `data.request_contract ?? data.requestContract` block through
  verbatim, and (2) otherwise ASSEMBLES the blob from the loose adapter facts
  (`consumes` → `content_type`/`consumes`, required `headers`/`requestHeaders` →
  `required_headers[]`, `requestParams` → `params`). Snake/camel-tolerant,
  additive, absent-key (undefined → ABSENT key, never null). The sibling
  `response_contract` arm is unchanged (asserted by a dedicated no-regression
  test).

### discovery-service (Node/TS) — ✅ PASS
- `npx tsc --noEmit` → **exit 0** (clean).
- `npx jest requestContractScanner responseContractScanner springClassicAdapter
  springClassicJaxRs springClassicMultiMethodPath springClassicInboundMetaInherit`
  → **7 suites, 109 tests, all pass** (no regression to `response_contract` or
  candidate emission).
  - `requestContractScanner` alone: **7 tests pass**, including
    `@JsonFormat(pattern="dd-MMM-yyyy")` on a `@RequestBody` field →
    `param_formats[]`; `@DateTimeFormat` on `@PathVariable`/`@RequestParam`;
    `@NotNull`/`@Pattern` → `request_validation[]`; content_type + required_headers
    from discriminators; attach-by-name with the no-fact endpoint left untouched.
- `requestContractScanner.ts` is a standalone sibling to
  `responseContractScanner.ts` exporting `scanRequestContracts(files)` +
  `attachRequestContractsToCandidates(candidates, output)`. Attach rides on
  `candidate.data.request_contract` keyed by endpoint name. It is invoked
  soft-failing in `springClassic/index.ts` (lines 2542–2558) directly after the
  response-contract scan block — additive, try/catch, never poisons the run.

### api-migration-validation-service (Node/TS) — ✅ PASS
- `npx tsc --noEmit` → **exit 0** (clean).
- FULL `npx jest` → **exit 0**: **Test Suites 1 skipped, 71 passed, 72 total;
  Tests: 1 skipped, 367 passed, 368 total** — matches the expected ~367 / 1 skip.
- New `requestContractEnrichment.ts` (`enrichInventoryWithRequestContracts`) wired
  at capture `/start` in `captureSessionActions.ts:1730-1734`, fetching AMS
  endpoints via `archModelClient.listEndpointsForArchitecture(projectId,
  session.architecture_id)` and mutating the SAME `inventory` object (line 1540)
  that is passed to `spawnOrchestrator` as `oasInventory` (line 1778). Fully
  fail-soft (try/catch downgrades any AMS error to a no-op, never blocks /start).
- Enrichment is an OVERRIDE: content_type → `requestBody.content` media type,
  `required_headers[]` → `in:header, required:true` params, `param_formats[]` →
  `parameters[].schema.format`/`pattern` (and request-body schema props). Each
  override stamps `x-amvs-source: code-scan` (operation-level for content/headers,
  schema-level for param formats) ONLY where a value was actually changed.
- Executor (`execute_http_request.ts`): `CONTENT_TYPE_DEFAULTING_VERBS =
  {put,post,patch}`; gate broadened to
  `body !== undefined || CONTENT_TYPE_DEFAULTING_VERBS.has(method)`, sourcing the
  media type from the enriched operation (`resolveOperationContentType`) with
  `application/json` fallback, preserving a caller-set Content-Type
  case-insensitively. The shared `httpExecutor` is untouched.

---

## 3. Load-Bearing Invariants

**Status:** ✅ All 7 met (with command evidence)

1. **Code-evidence OVERRIDES the contract, tagged `code-scan`** — ✅ MET.
   `requestContractEnrichment.paramFormats.test.ts` asserts a scanned
   `dd-MMM-yyyy` beats a misleading query `format:'date'`/`xsd:date` and is
   stamped at the schema level; `requestContractEnrichment.test.ts` asserts
   `content_type` overrides the operation request media type, op-level
   `x-amvs-source: code-scan`.
2. **Contract stands where code is silent (untouched/unmarked)** — ✅ MET.
   "leaves a param NOT present in param_formats untouched and UNMARKED",
   "leaves an operation with no matching endpoint untouched and unmarked", and the
   cross-layer "leaves the contract OAS untouched + UNMARKED for endpoint rows
   that carry no request_contract" all pass.
3. **Runtime levers (error-correction + accepted-value reuse) untouched** — ✅ MET.
   `extractErrorSummary` branches and the accepted-value/learned-fact paths are
   intact; full jest green confirms no regression to those paths.
4. **#3 deterministic — a body-less PUT now sends a Content-Type** — ✅ MET.
   `executeHttpRequestContentTypeDefault.test.ts` (a): "a body-less PUT now sends
   a Content-Type (defaults application/json …)"; (b) sources from enriched
   content-type; (c) preserves caller-set; (d) POST/PATCH same, GET still none.
5. **#1 — `@JsonFormat(pattern="dd-MMM-yyyy")` reaches the LLM-facing operation
   detail as `pattern`** — ✅ MET. discovery `requestContractScanner` reads it into
   `param_formats[]`; amvs param-format test "exposes the dd-MMM-yyyy override on
   `oasOperation.parameters[].schema` (the extractOasParams /
   get_oas_operation_detail read site)".
6. **Cross-layer SEAM (scanner blob == save-back == enrichment-consumed)** — ✅ MET.
   `requestContractCrossLayerSeam.test.ts` (3 tests) feeds the scanner-shaped blob
   through enrichment and asserts it reaches BOTH read seams, beating the contract.
7. **No regression of A/B/C/D (changesets 189–193) or single-shot
   capture/reconcile** — ✅ MET. 189–193 confirmed unedited (git, above); full amvs
   jest 367/1-skip green; `reconcileFullResponseFidelityCrossLayer` (6 tests) and
   `captureSessionFullFlow.e2e` (5 tests, incl. mutating-confirmation flow) pass.

---

## 4. Repo-Health Checks

**Status:** ✅ Clean

- **Mojibake scan:** `grep -rn "â€" api-migration-validation-service/src
  discovery-service/src mcp-server/src` → **exit 1, no matches (EMPTY)**. Clean.
- **`execute_http_request.ts` intact:** 0 NUL bytes; `extractErrorSummary`
  title/message/description branches present; `authMode` enum
  (`coerceAuthMode`/`resolveAuthOverride`, schema enum `['session','none',
  'bad_token']`) present; `normaliseBodyForAms` used for request + response body;
  `requestUrlRedacted`/`request_url_redacted` present; `tsc` clean. The noted
  bash-backtick repair is sound.

---

## 5. Test Suite Results

**Status:** ✅ All Passing

### Per-service totals (verifier-run)
- **AMS:** 7 feature tests pass (2 changeset + 5 persistence), 0 fail, 0 error.
  `compile test-compile` clean.
- **mcp-server:** 17 save-back tests pass; tsc clean.
- **discovery-service:** 109 tests pass across the request/response scanner +
  springClassic adapter suites; tsc clean.
- **api-migration-validation-service (FULL gate):**
  - Total tests: **368**
  - Passing: **367**
  - Skipped: **1**
  - Failing: **0** / Errors: **0**
  - Suites: 71 passed, 1 skipped, 72 total.

### Failed Tests
None — all run tests pass. The single skipped amvs test is the pre-existing
expected skip (suite was 347/1-skip before this spec; raised to 367/1-skip as
this spec added tests).

### Notes
- A non-blocking jest warning ("A worker process has failed to exit gracefully")
  appeared in the mcp-server run; it is a teardown/open-handle warning, not a
  test failure (exit 0).

---

## 6. Roadmap Updates

**Status:** ⚠️ No Updates Needed

No `agent-os/product/roadmap.md` file is present in the repo, and no roadmap item
maps to this multi-service data-pipeline spec. No roadmap update was required or
possible.

---

## 7. Deviations & Observations (non-blocking)

1. **NUL-byte composite-map-key delimiter (intentional, not corruption).**
   `requestContractEnrichment.ts` contains exactly 3 literal NUL (`\x00`)
   characters, used consistently as the delimiter in a composite operation-index
   key (`` `${method}\x00${path}` `` — built, inserted, and looked up in the same
   shape). This is what makes `grep` report the file as "binary." The file has
   **0 non-ASCII bytes and 0 CR bytes** (no mojibake, no UTF-16), `tsc` is clean,
   and all enrichment tests pass. It is an unusual but correct collision-safe-key
   idiom; recommend (optional) switching the delimiter to a printable separator
   for grep-friendliness. **Does not affect correctness.**
2. **Cosmetic `schema_version` string difference.** The discovery scanner emits
   `schema_version: 'request_contract.v1'` (underscore) while the AMS SQL header
   comment and the AMS persistence test use `'request-contract.v1'` (hyphen).
   This is an internal, free-text version string inside the loose JSONB blob — it
   is not parsed or matched anywhere in the seam (the seam keys on field
   presence, not on the version literal), so it does not break the
   scanner→save-back→AMS→enrichment flow. Worth aligning for tidiness only.
3. **Scanner invocation location.** The spec text said "invoke in `index.ts`
   ~2504-2517"; the actual (correct) site is the springClassic adapter's
   `index.ts` (the response-contract scan's sibling), not the top-level
   `src/index.ts`. This matches the precedent and is correct.

---

## Overall Verdict: ✅ PASS

Four services verified independently and at the cross-layer seam. All compiles/
typechecks clean, all targeted suites green, full amvs gate at 367 pass / 1 skip,
all 7 load-bearing invariants met, mojibake scan empty, `execute_http_request.ts`
intact, and changesets 189–193 confirmed undisturbed. The only findings are two
cosmetic/benign observations that do not affect correctness.
