# Code-Tier Oracle Program — Build Log

Branch: `feature/code-tier-oracle-program` (from main @ 58ad992). One commit per spec,
pushed after each. Build order (user-agreed, pure sequential):
G → H → L → M → J → K → N → I → F.

---

## Spec G — Deterministic Code-Stream Planning (2026-07-06)

**Status: BUILT + VERIFIED.**

### What landed

- NEW `gateway/src/services/migrationCodeStreamPlanner.ts` — deterministic Phase-1
  skeletons + Phase-2 stories for `target_service_api_implementation`,
  `api_soap_integration_compatibility`, and the NEW `internal_processing_implementation`
  stream. One story per interface (cap `MIGRATION_PLAN_API_CLUSTER_MAX_ENDPOINTS`,
  default 15), verb-group split (GET / POST+PUT+PATCH / other) then path-sorted chunks,
  SOAP alphabetical operation chunks, flag extraction (missing_baseline /
  attached_finding / soap_metadata_missing) into individual exceptional stories,
  MANUAL-GATE capture stories per below-floor interface sequenced BEFORE implementation,
  closure parity-sweep stories, prerequisite skeletons on unreadable/empty models,
  outbound-direction endpoints excluded (counted). Coverage checks THROW
  "regenerate the migration plan": unplanned endpoint, planned-but-gone, duplicates.
- Skeleton + expansion interception wired in `migrationBookOfWorkHandler.ts` /
  `migrationBookOfWorkExpansionHandler.ts` (mirrors the Spec B DB branches; model view
  fetched once per generation; expansion re-reads the model for the DRIFT check only,
  read failure → epic failed retryable, never a guess).
- `internal_processing_implementation` added to the workstream enum (gateway schema +
  frontend api types + wizard option + readiness defaults) and the stream rank map.
- Execution driver: `execution:manual-gate` items are never dispatched to IVS and never
  demanded spec-ready by the hard block (`migrationDriverAmsReads.ts` BookOfWorkItem
  gains `tags`).

### Deviations from the spec file (all conscious, all visible)

1. **AMS gap codes deferred to Spec I.** `no_committed_endpoints_for_protocol` /
   `internal_entry_points_unplanned` are NOT added AMS-side: the prerequisite skeletons
   already surface the same facts as blocked items with explicit missingInputs in the
   plan UI. Blocking-grade surfacing consolidates into Spec I's gate-code family.
2. **`endpoint_subtype` column deferred to Spec M.** Build-time verification confirmed
   the subtype lives ONLY in candidate `data` (no committed column, no save-back
   mapping, no trivial materialization point found). The internal partition uses the
   documented no-HTTP-verb heuristic; when the model has endpoints but none classify
   internal, the internal stream degrades to an explicit prerequisite naming the
   limitation. Column + save-back mapping belong to Spec M's internal-capture rework.
3. **Flagged stories are fully deterministic** (spec said "existing bespoke LLM rewrite
   retained for prose"). Deterministic fact-stamped stories are strictly more accurate;
   the code streams now make ZERO LLM calls in both phases (test-pinned).
4. **Scaffold gate is NOT skipped for code streams.** Initial implementation skipped it;
   that would have silently killed MAVEN scaffold injection (maven maps to the API
   workstream). Corrected: the scaffold homes onto the stream's lowest-sequence epic
   (foundations) and rides the same validate + atomic append. New pin covers it.
5. **No new AMS REST in G.** The planner reads the EXISTING full-model endpoint
   (`GET /api/model/projects/{p}/architectures/{a}` → `metaModel.entities.{interfaces,endpoints}`,
   field names verified against the AMS DTO source). Spec H/F still add the focused reads.

### Verification

- 22 new tests: `migrationCodeStreamPlanner.test.ts` (16 — anti-explosion 400→40 pin,
  verb-split, SOAP chunking, 3 coverage-throw pins, protocol + 100%-SOAP prerequisite,
  internal routing + heuristic degrade + outbound exclusion, flag/capture/manual-gate/
  closure pins, prerequisite pin) and `migrationBookOfWorkCodeExpansion.test.ts` (6 —
  real-pipeline expansion with throwing-LLM mock, drift → failed retryable, unreadable
  model → failed, maven-scaffold-on-foundations, driver dispatch skip + hard-block
  exemption).
- Legacy suites that used the API streams to pin the GENERIC LLM machinery switched to
  `target_frontend_implementation` (+ npm scaffold pairing where scaffold-related):
  handler, packEnsureWiring, findingsCoverage, scaffoldInjection, scaffoldGapAnalysis,
  expansion. All green.
- Full gateway suite: 3006 passed / 17 failed-at-full-parallelism. Baseline-verified:
  `manifestCodeMapping` + `llmClient` fail at the branch point too (pre-existing);
  `registryLoader` + 2 `chatV2` suites pass in isolation on BOTH sides (parallel-run
  interference via shared `threads/` state, not Spec G). Test-dirtied thread.json files
  restored before commit.
- Frontend: wizard suites are pre-existing red (SyntaxError at an `import type` line,
  identical with edits stashed — the known baseline-red frontend). Frontend edits are
  additive union/array/option entries only.

### Live-shakedown items (for the program review doc)

- G-1: generate a plan with the API streams selected against a real committed model;
  confirm the deterministic skeleton (epic structure, interface features) and that the
  full-model read's wire shape matches (`metaModel.entities.endpoints[].interface_id`).
- G-2: expand an interface epic; confirm cluster stories + coverage; mutate the model;
  confirm the drift throw surfaces as a retryable failed epic.
- G-3: Migrate run over a plan with capture stories: confirm they are never dispatched
  and don't block the hard gate.

---

## Spec H — Verbatim Code-Spec Carriage (2026-07-06)

**Status: BUILT + VERIFIED.**

What landed: NEW `gateway/src/services/migrationCodeSpecCarriage.ts` (markers mapping,
recognition, canonical-JSON serialization, one-full-model-read facts fetch + baseline
items matched by method/path-template, canonical example selection per distinct status,
deterministic spec-text assembly with unbreakable fences, trim ladder + omission
manifest, manual-gate procedure text, honesty statuses) + shape-spec handler wiring
(LoadedBookOfWorkItem markers via exported pure mapper; interception after the DB-pack
carriage branch; `fetchCodeSpecFacts` DI seam). The LLM is never called on any carriage
path.

Verification: 13 new pins in `migrationCodeSpecCarriage.test.ts` (verbatim round-trip
deep-equality incl. backtick-run fence safety; canonical example selection; state-delta
not-captured marker; trim ladder keeps contracts+SQL and manifests every drop; honesty
statuses incl. flagged-missing-baseline pass-through and model-drift naming; manual-gate
procedure text with zero fact fetches; markers mapping both wire cases). Regression:
shape-spec + carriage family 17 suites / 115 tests green; migration family 84 suites /
552 tests green.

Design decisions locked at build start (recon verified):

1. **No new AMS reads for contracts/behaviour:** the full-model read already carries
   `EndpointDto.{request_contract,response_contract,protocol_metadata_json}` and
   `BusinessLogicDto.behavior` — the carriage fetches the full model and filters.
2. **ZERO new AMS surface in H** (upgraded from the earlier plan): verified that the
   full-model response ALSO carries `metaModel.relationships.endpoint_data_effects`
   (`ModelService:1114` maps `findByModelFileId`), so endpoints+contracts, business
   logics+behavior, AND data effects all come from ONE existing read. The dedicated
   `EndpointDataEffectController` (scoped by-endpoint + REVERSE queries + index) is
   wholly Spec F's, where it is actually required.
3. **Baseline examples read exists:** `GET /api/projects/{p}/api-behaviour/baseline-items?baselineId=...`;
   items matched to endpoints by method+path template.
4. **Canonical-set approximation:** until Spec K persists rubric scores, "one example
   per achieved rubric dimension" is approximated as one canonical example per DISTINCT
   captured response status (happy-first ordering). Documented in-module; K upgrades it.
5. **Flagged-story hybrid dropped:** Spec G made flagged stories deterministic, so H
   carries them identically to cluster stories (no LLM anywhere on the carriage paths).
6. **Manual-gate stories (capture/closure)** get deterministic PROCEDURE spec text
   (facts from extras; no LLM) so their rows exist honestly even though never dispatched.
7. Business-logic selection: behaviour blocks whose `behavior.method_id` matches a hop
   `method_id` on the story endpoints' data-effect paths.
8. Module: `gateway/src/services/migrationCodeSpecCarriage.ts` + loader extras mapping
   via exported pure `codeCarriageMarkersFromBlob` (unit-tested); interception in the
   shape-spec handler AFTER the DB-pack carriage branch; `fenceFor`/`languageFor`
   re-exported from the DB carriage module.

---

## Spec L — Spring Classic Response Fidelity (2026-07-06)

**Status: BUILT + VERIFIED.**

What landed (all discovery-service, three new springClassic scanner modules + wiring):

- `webXmlResponseFacts.ts` — full web.xml parse (ordered filter chain w/ url-patterns,
  dispatchers, init-params; error-pages; listeners; session-config; context-params;
  mime-mappings; encoding-filter charset) + servlet-spec url-pattern matcher + attach
  pass (filters ordered per endpoint; app-global error-pages merged into
  `response_contract.error_responses[]` w/ `source: web-xml-error-page`; charset into
  `serialization.charset`). XML helpers exported from `webXmlServletParser` (one idiom).
- `xmlMvcScanner.ts` — SimpleUrlHandlerMapping (props/urlMap/value-lines) +
  BeanNameUrlHandlerMapping endpoints minted as `endpoints` candidates
  (`endpoint_subtype: 'xml-mvc'`, DEFAULT-GET with `verb_inference` marked, never
  guessed silently); `mvc:interceptors` in DOCUMENT order (registration order) attached
  Ant-matched onto endpoints; `security:http intercept-url` (literal
  hasRole/hasAuthority/ROLE_ resolved; everything else attached
  `auth.source='unresolved'` verbatim); `tx:advice`/`aop:config` pointcuts
  (execution/within subset) -> transactional MATCHERS applied as a POST-PASS over the
  emitted `endpoint_data_effects` candidates (zero resolver surgery); unresolved
  pointcuts/rules -> Findings.
- `codeResponseFactsScanner.ts` — code-set headers/status/redirects/cookies from the
  per-method call IR + the `response_kind` view-vs-API classification (`view-html`
  endpoints get `parity_scope: 'out_of_scope_view'` + an info Finding — API-only parity
  per the user decision).
- `requestContractScanner` — `@CookieValue`/`@MatrixVariable`/`@RequestPart` bindings
  emitted as `param_formats` locations `cookie`/`matrix`/`multipart` (source `binding`,
  emitted regardless of type category).
- Wiring: three soft-fail adapter blocks (after the contract scans, so blobs exist to
  merge into); `scanResponseFidelityFindings` peer pass in springClassicFindingScanner
  (run-it-twice pattern, capped); javaLangPack spring-xml IR entries now carry
  `rawContent` (additive; mirrors the web.xml/WADL admission precedent);
  spring-classic.md prompt updated (do-NOT-re-emit list).

Build-time discoveries + honest residuals:

1. **Extractor unquoting constraint:** the Java extractor retains string-literal args
   UNQUOTED (pinned by `javaExtractorCallArgs.test.ts`), so literal-vs-expression
   detection keys on expression markers (`(`, `+`, `.class`); a bare variable reference
   is indistinguishable from its literal value and is carried verbatim as resolved —
   only clear expressions raise `response_header_unresolved`. Documented in-module.
2. **View NAME not extractable** (IR carries no return literals) — the KIND is
   classified; the template name is not. Residual.
3. **Content-negotiation manager / custom HttpMessageConverter capture NOT implemented**
   (spec §6 partial): serialization facts remain annotation-driven; converter classes
   are already flagged by the custom-serializer detect-or-flag pass. Residual for a
   follow-on if shakedown shows drift.
4. Security-XML resolution is the literal subset by design; `permitAll`-style
   expressions surface as unresolved (noisy-but-honest; K/J waivers can absorb).

Verification: 13 new pins in `springClassicResponseFidelity.test.ts` (web-xml parse +
attach + pattern semantics; xml-mvc scan/mint/attach; TX flip pin on an annotation-free
edge; header literal/expression pins; view classification + parity-scope attach;
findings; cookie/matrix/multipart bindings). Regression: springClassic/webXml/
requestContract/hbm/springConfig family 30 suites / 277 tests green; finding-scanner
integration suites green.

---

## Spec M — Spring Classic Internal Functionality (2026-07-06/07)

**Status: BUILT + VERIFIED.**

What landed:

- `internalProcessXmlScanner.ts` — Quartz XML (MethodInvokingJobDetail /
  JobDetailFactoryBean + Cron/Simple triggers joined, cron VERBATIM), `task:` namespace
  (scheduled targets + executor/scheduler pools), Spring Batch job XML (step graph
  VERBATIM: next / tasklet refs / chunk reader-processor-writer / commit-interval),
  `jms:` listeners + DefaultMessageListenerContainer beans. Minted as `endpoints`
  candidates (subtype quartz-job / scheduled / batch-job / jms-listener) mirroring the
  annotation-listener emission (`<SUBTYPE-UC> <identifier>` names, fullPath/httpMethod
  shape). `xmlEntryTargets` feeds the resolver; `attachSelfApiCallLinks` implements the
  v1 self-API-call linkage (`calls_own_endpoint`).
- RESOLVER root extension (`endpointDataEffectResolver.ts`) — `detectInternalEntryPoints`
  (six listener/scheduled annotations with the adapter's exact naming convention via
  `internalListenerEndpointName`; Quartz `Job`/`QuartzJobBean` classes; XML-wired
  targets, annotation-deduped) + `resolveInternalProcessDataEffects` mirroring the SOAP
  variant's reuse contract (same walk, entry gate + name override only). Emission rides
  the extracted `buildDataEffectCandidatesFromResolved` (one implementation, two gates).
- PIPELINE Stage-3b fold (`discoveryV3Pipeline.ts`) — internal edges' hop method-ids
  extend the behaviour-capture reachable set (soft-fail to endpoint-only), so
  batch/listener code gets behaviour blocks exactly like endpoint code (criterion B).
- `myBatisXmlMapper.ts` — mapper XML admitted (javaLangPack, `mybatis-xml` +
  rawContent), statements indexed, POST-PASS enriches query-less edges
  (`query_kind: 'mybatis_xml'`, dynamic tags flagged `dynamic_sql`, verbatim body,
  annotation capture never overwritten).
- `jpaInternalsScanner.ts` — entity lifecycle callbacks (`@PrePersist` family +
  `@EntityListeners`) as `business_logics` candidates + `entity_lifecycle_callback`
  Findings; persistence.xml admitted (`persistence-xml`) and named queries matched
  against `createNamedQuery` call sites (unmatched flagged).
- Finding scanner: internal unresolved chains ride the SAME
  `endpoint_data_effect_unresolved` builder; JPA findings join the response-fidelity
  run-it-twice pass.
- GATEWAY carriage (Spec H integration): internal-stream stories (`protocol:
  'internal'`) skip the contract/baseline requirements and embed the VERBATIM trigger
  metadata + data effects + the four-step DB-DELTA verification recipe (user decision:
  same DB delta + same emitted outputs = parity), effect scope listed from the edges'
  `data_entity_point_id`s.

Build-time discoveries + residuals:

1. **Self-closing XML alternation bug** (found by the QUARTZ pin): a self-closing
   `<bean/>` matched the paired-form branch and its lazy body swallowed sibling
   elements. Fixed in BOTH new scanners (self-closing branch first) — the L-era
   xmlMvcScanner had the same latent bug.
2. **Hyphenated element names**: `\b` treats `-` as a boundary (`scheduled\b` matched
   `<task:scheduled-tasks>`); name-end guard `(?![\w-])` added.
3. Batch job graphs are captured but batch STEP beans' effects resolve only when steps
   reference bean classes scanned as services — reader/writer bean-ref → class walk is
   the mapper for a follow-on if shakedown needs it. `TimerTask`/raw threads remain
   finding-only by design (`unmanaged-concurrency` deferred — not yet emitted).
4. Endpoint `protocol_metadata_json` save-back for internal candidates (schedule
   metadata surviving commit) inherits whatever the existing save-back does with
   `internal_process` data — G-1 shakedown item extended to check it (M-1 below).

Verification: 13 new pins in `springClassicInternalFunctionality.test.ts` (Quartz join +
verbatim cron; task/jms/batch verbatim; minted-shape; ROOTS pins incl. XML-wired target,
annotation dedupe, and HTTP-resolver no-regression; adapter-name-convention pin; MyBatis
enrich/never-overwrite/dynamic; self-call; JPA callbacks + named-query matching) + the
gateway INTERNAL RECIPE pin (14th in the carriage suite). Regression: discovery
springClassic/pipeline/findings family 37 suites / 308 tests green; gateway carriage
suite 14/14.

Shakedown items: M-1 — commit an internal candidate and verify the schedule metadata
lands somewhere readable (endpoint protocol_metadata_json or data blob) for the carriage;
M-2 — run a scan over a Quartz-XML estate and confirm internal edges + behaviour blocks
appear; M-3 — internal story spec text renders the recipe with real effect tables.

---

## Spec J — Parity Exactness & First-Class SOAP (2026-07-07)

**Status: BUILT + VERIFIED.**

AMS (changesets 205 + 206, entities/DTOs/services, 96 api-behaviour tests green):

- 205: `response_body_raw` on baseline items AND captures (nullable, no backfill,
  excluded from the content hash) + `comparison_profile` on diffs (null = 'standard').
- 206: `api_behaviour_comparison_waivers` (scope global/project × dimension header /
  body_path / xml_xpath / ordering_path / break_fingerprint × target × REQUIRED reason)
  with the legacy 16-name header allowlist (`VOLATILE_HEADER_NAMES`, verbatim) seeded as
  visible, deletable global rows. New entity/repo/service/controller
  (`GET/POST/DELETE /api/projects/{p}/api-behaviour/comparison-waivers`).
- Server-side raw fallback: baseline-item create copies the referenced capture row's raw
  when the caller passed none — the frontend Save-as-baseline inherits raw with NO
  client change. Target replay passes raw directly. Back-compat delegating constructors
  on all touched records.

AMVS:

- Executor raw preservation: identity `transformResponse` + interceptor re-parse —
  `data` contract byte-identical for every consumer, `rawBody` carries the exact wire
  text (size-capped). Pinned by a REAL express round-trip test.
- **Raw-body policy (design decision):** raw persists ONLY when redaction was a NO-OP on
  the body (`rawBodyPolicy.ts`) — secrets never reach raw storage; redaction-touched
  bodies degrade to `raw_unavailable` VISIBLY. Target side persists unredacted bodies so
  raw rides verbatim there.
- Comparator: optional 4th `options` param (profile / waivers / raws) — omitted =
  byte-identical legacy behaviour. A passed waiver set REPLACES the in-code header
  allowlist (deleting a seed makes that header strict); body-path waivers tolerate
  value+ordering drift tagged `waived` (shape ALWAYS breaks); strict profile adds
  `byteClassification`: direct raw byte equality, or masked-canonical compare when
  probed/waived paths are in play, `raw_unavailable` when either raw is missing.
- `xmlComparator.ts` (fast-xml-parser, C14N-LITE documented canonical form:
  prefix→URI resolution, attribute sort, whitespace policy) — structural diff with
  XPath-ish paths + `compareXmlBytes` with XPath masks; XML raws route automatically
  inside the strict byte verdict.
- SOAP first-class: WSDL upload 400 REPLACED — `wsdlToInventory.ts` parses WSDL 1.1
  (portType/binding/service essentials) into POST operations carrying the SAME
  `x-amvs-soap` block the model-seeded prepop emits; unparseable WSDL still 400s
  (`WSDL_PARSE_FAILED`). `soapEnvelope.ts` builds byte-stable escaped envelopes
  (values-only filling; replay resends captured request bodies verbatim by design).
- diffRunner threads the diff row's profile + the fetched AMS waiver set (fetch failure
  → legacy-allowlist fallback, logged) + both sides' raws; `byte_classification` rides
  each item's persisted diff_json (additive) with local byte_drift / raw_unavailable
  tallies.

Deviations/residuals: SOAP volatility probing stays GET-only (`not_probed` — Spec N's
schema-derived volatility is the successor); finding-emission rules NOT extended for
byte_drift (Spec I's verdict layer consumes byte_classification directly — recorded);
C14N-lite not W3C C14N (documented; same form both sides).

Verification: 13 new pins (`parityExactness.test.ts`) + rewritten WSDL pins (parse-into-
operations + unparseable-400). AMVS full suite: 464 passed / 2 failed — BOTH failures
(`testConnectionAction`, `captureSessionActions`) verified PRE-EXISTING via stash-run at
the branch point. AMS `ApiBehaviour*`: 96 tests green.

---

## Spec K — Scenario Coverage Floor (2026-07-07)

**Status: BUILT + VERIFIED.**

- AMVS: `GeneratedScenario` gains the floor taxonomy (`dimensionKind`:
  happy / error_status / validation / enum / filter / pagination / content_type / seed +
  `reportedOnly`); EVERY generator site stamped. THREE new dimension families in
  `defaultScenarioSet`: PAGINATION (page/size/offset/limit param detection → first /
  later / past-the-end scenarios, reported-only), CONTENT-TYPE (multi-media-type request
  bodies → one scenario per extra type, capped 2, reported-only), VALIDATION
  missing-required-field (from the operation's request schema `required` list, capped 3,
  FLOOR-BEARING — the schema-derived approximation of committed request_validation
  constraints). The scorer stamps `dimension_kind` + `reported_only` onto every persisted
  `CoverageDimensionResult`, legacy-defaulting kind from expected_status so pre-K
  sessions score identically.
- GATEWAY: `apiBehaviourCoverageFloor.ts` — pure `evaluateCoverageFloor(summary,
  waivedKeys, policy)` over the session's persisted `coverage_summary_json`
  (floor-bearing kinds default happy/error_status/validation/seed; reported-only misses
  enumerated but never blocking; waived (operation, dimension) keys pass WITH the waiver
  enumerated; failed session auth fails the floor) + `aggregateFloorByInterface` (the
  Spec G capture-story + Spec I gate consumer).
- NO AMS change needed: the rubric summary was ALREADY persisted
  (`coverage_summary_json` on capture sessions) — the spec's persistence requirement was
  satisfied by existing storage; K adds the taxonomy + the evaluator.

Deviations/residuals: `resource_lifecycle` dimension DEFERRED (cross-operation
composition belongs with the sequence machinery; reported-only by design so its absence
never blocks — recorded); floor ENFORCEMENT wiring (gate code
`code_coverage_floor_unmet`) lands in Spec I per the program design.

Verification: 3 AMVS pins (`coverageFloorDimensions.test.ts`: dimension families +
reported-only flags + scorer stamping/legacy default) + 6 gateway pins
(`apiBehaviourCoverageFloor.test.ts`: floor/reported/waiver/legacy/auth/aggregate).
Coverage-family regression 6 suites / 43 tests green (one existing scoring-test fixture
gained the two new required fields).

---

## Spec N — Mutating State-Delta Capture (2026-07-09)

**Status: BUILT + VERIFIED.**

- AMS changeset 207: nullable `state_delta_json` JSONB on `api_behaviour_captures` +
  `api_behaviour_baseline_items` (no backfill — null = "state not captured", the
  fail-closed default for every pre-N row). Entity/DTO/CreateRequest/Mapper/Service
  chain mirrors J's raw-body work EXACTLY, including new back-compat delegating record
  constructors and a server-side `resolveStateDeltaJson` capture→item copy in
  `ApiBehaviourBaselineItemService` (Save-as-baseline inherits the delta with zero
  client changes). EXCLUDED from the baseline content hash (derivative evidence;
  existing baselines hash unchanged).
- AMVS `stateDelta.ts` (NEW): `fetchEffectScopeIndex` — ONE committed-model read maps
  `endpoint_data_effects` WRITE/read-write edges → physical table names keyed
  `${METHOD} ${pathTemplate}`; `effectTablesFor` template-matches concrete captured
  paths against `{param}` segments. `snapshotEffectTables` — bounded ladder (COUNT
  always; keyed row when the response exposes an id-ish value), SELECT-only through the
  sqlGuard-enforcing `runReadonlySelect` (maxRows 5 / 10s timeout), SAFE_IDENTIFIER
  regex refuses non-identifier table names with a RECORDED error. `computeStateDelta`
  (strategy-tagged `counts` / `counts+keyed`) + `compareStateDeltas` →
  state_match / state_drift / state_unverified — FAIL-CLOSED: either side missing, a
  snapshot error, or a null delta ⇒ `state_unverified`, never a silent pass; keyed-row
  equivalence skips volatile columns (id / created_at / updated_at / timestamp).
- Capture side (`execute_http_request`): pre/post snapshots around a MUTATING call when
  the session has a DB adapter + mutating confirmed + the committed model names effect
  tables. Single-entry per-session effect-scope cache (one model read per session,
  honouring the no-cross-session-cache contract). Auth-override negatives not
  snapshotted (volatility-probe posture). Every guard-miss/failure leaves the delta
  null → visible `state_unverified`.
- Replay side (`targetReplayRunner`): OPTIONAL `dbAdapter` dep; same pre/post wrap on
  mutating replays; `state_delta_json` rides the target capture AND target baseline
  item.
- Diff side (`diffRunner`): `state_classification` (+ `state_detail`) stamped into the
  persisted item's `body_diff_json` ONLY when at least one side carries a delta (zero
  regression for read-only scenarios / pre-N baselines); local state_drift /
  state_unverified tallies (byte-dimension posture — Spec I's parity gate consumes the
  verdicts; AMS count summary unchanged).

Deviations/residuals: keyed ladder v1 keys on a response-exposed id-ish value only
(spec's metadata-driven key-column discovery deferred; strategy field keeps coverage
honest). Production route wiring for TARGET-DB secrets on the replay route is a LOGGED
RESIDUAL — deps.dbAdapter is injectable and tested; the route currently passes none, so
target deltas stay null (⇒ state_unverified, visible, fail-closed) until that wiring
lands. Type-mapping-aware keyed equivalence simplified to the volatile-column set (the
spec's DB-pack type-mapping reuse belongs with Spec F's dialect work).

Verification: 12 new pins (`stateDelta.test.ts`: SCOPE ×2 / GUARD ×2 / DELTA /
FAIL-CLOSED ×2 / WRITE ×2 / REPLAY / DIFF ×2). Touched-suite regression 13 suites /
70 tests green (execute_http_request ×5, targetReplay ×3, diffRunner ×4,
parityExactness). AMVS tsc clean. AMS compile + `ApiBehaviour*` tests green.

---

## Spec I — Parity Verify Loop & Execution Gates (2026-07-09)

**Status: BUILT + VERIFIED.**

Build note: the 2026-06-14 reconciliation program had ALREADY built the deploy→full-
reconcile→break-record→human-gated-bug-send→scoped-re-reconcile+circuit-breaker loop
(`migrationReconciliationDriver/ValidationClient`), so I lands as EXTENSIONS of that
machinery rather than a parallel verifier: scoping, verdict evaluation, gates, drift
checks, and the IVS parity re-entry.

- **Scoped replay + diff** (SHARED with Spec F): AMS changeset 208 — nullable
  `endpoint_scope_json` JSONB on `api_behaviour_diffs` (`{ keys, purpose }`; null = full
  surface, no backfill; write-once at create — a scoped-clean diff can never be
  re-labelled). AMVS `endpointScope.ts` (normalise/parse/template-tolerant match both
  directions/blob build+read); `/start` route accepts RUN-TIME `endpointScope` +
  `purpose` (never persisted on the session); `runTargetReplay` skips out-of-scope items
  (counted) + stamps the blob on the auto-created diff; `runDiff` filters BOTH sides by
  the diff's scope (no source_only spam on scoped runs).
- **Break predicate hardened** (`isDiffItemABreak`): + `state_classification`
  (`state_drift` AND `state_unverified` break — fail-closed state parity per the Spec N
  amendment) + `byte_classification` (`byte_drift` breaks; `raw_unavailable` is visible
  degradation, not a break). The June loop inherits both dimensions automatically.
- **Gateway `migrationParityVerifier.ts`**: `runScopedParityVerify` /
  `runBaselineDriftCheck` wrap the extended `runHeadlessReconcile` (scope + purpose
  threaded to the start route); `evaluateParityVerdict` — FAIL-CLOSED (lifecycle
  failure / zero-compared never clean), break fingerprints
  `METHOD path::scenario::kind`, waivers consumed from the J-built
  `api_behaviour_comparison_waivers` table (dimension `break_fingerprint` — J made it
  forward-compatible, zero new AMS schema) → clean-with-waivers with waiver ids
  recorded. Target auth per-invocation, in-memory, pushed only to the AMVS
  secretsStore (Spec E pattern).
- **Gateway `migrationCodeExecutionGate.ts`** (gate 4c, stacked in the driver after 4b
  exactly like the DB gate): pre-dispatch `code_baseline_unpinned` /
  `code_baseline_missing` (flagged `missing_baseline` stories exempt; coverage via the
  existing `endpoint-baseline-coverage` AMS read) / `code_coverage_floor_unmet` (K's
  evaluator over the pinned baseline's persisted summary; null summary = pre-K, not a
  false block) / `code_gate_read_failed` (FAIL CLOSED). Completion evaluators:
  `evaluateCodeStoryCompletion` (`code_parity_unverified` / `code_parity_broken` off the
  latest covering diff, judged inside the story's endpoint keys, waiver-aware) +
  `evaluateClosureReadiness` (REQUIRES an unscoped clean diff; scoped rejected — the
  208 audit blob makes this checkable). Drift: `evaluateBaselineDrift` —
  `baseline_drift_unchecked` (no/stale drift check, default max age 14 days) /
  `baseline_behaviour_drift` (latest drift-check diff has breaks; blocking).
- **IVS parity re-entry**: `POST /api/v2/parity-verdict` (bearer-auth, mirrors the
  CI-verdict inbound) — records the verdict on the (repo, 'parity') cell; a fail under
  `PARITY_REPAIR_CAP` (env, default 5) enqueues a fresh verify-task-group run with the
  parity report as the defect input (+`parity_repair_requested` event, attempt
  ordinal); at the cap NO further re-invokes — `parity_repair_exhausted` event + a
  `parity_failed` finding with the FINAL diff attached. Delivery-id dedup.

Deviations/residuals: (1) the driver's item-COMPLETION path is not auto-wired to the
evaluators — in the current execution model stories deploy ONCE at run end (no live
target mid-run), so enforcement = pre-dispatch gate 4c + the deploy-time full reconcile
+ the exported completion/closure/drift evaluators as the readiness-surface reads;
auto-invoking the scoped verifier per story on the deployed callback (and auto-POSTing
verdicts to the IVS route) is the logged follow-up wiring. (2) Floor evaluation is
whole-summary, not story-endpoint-scoped (refinement recorded). (3) Drift-check
scheduling is manual/wizard-invoked (`runBaselineDriftCheck` is callable; no cron).

Verification: 13 gateway pins (`migrationParityGate.test.ts`: STATE / FAIL-CLOSED /
WAIVER / LOOP-scope-threading / DRIFT-purpose / GATE ×4 / SCOPE-AUDIT ×2 / DRIFT
codes) + 3 AMVS pins (`endpointScope.test.ts`: MATCH / REPLAY skip+blob / DIFF filter)
+ 6 IVS pins (`test_parity_verdict_inbound.py`: auth / record / repair-enqueue /
CAP-exhaustion-with-final-diff / dedup). Regressions: gateway 14 suites / 153 tests
green (driver + full reconciliation loop inherit the changes); AMVS 10 touched suites
green (one /start pin updated to the widened `(sessionId, undefined)` arity — the
legacy-unscoped contract, asserted explicitly); IVS verification dir 132 passed /
2 skipped; AMS compile + `ApiBehaviour*` green (changeset 208 chain).

---

## Spec F — T-SQL Affinity & Consumer Revalidation (2026-07-09)

**Status: BUILT + VERIFIED.**

- **Dialect classifier** (discovery `sqlDialectClassifier.ts`, deterministic — no
  parser): pattern families over every captured SQL text — functions/globals (IMPORTED
  from the single-source `NON_PORTABLE_DEFAULT_FUNCTIONS` table the DB pack mirrors —
  pin 7 satisfied by import, plus dateadd/datediff/datepart/convert/isnull/charindex/
  stuff/patindex/str), @@identity/@@rowcount/@@error/@@trancount, lock hints
  (HOLDLOCK/NOLOCK/READPAST/UPDLOCK), legacy joins (*= / =*), TOP n, #temp +
  SELECT-INTO-#, RAISERROR/PRINT/SET ROWCOUNT, EXEC + sp_/xp_ conventions. Output:
  `tsql` (≥1 construct) / `ansi` / `unknown` (fragmentary — no SQL keyword), each
  construct with matched text + position + suggested PostgreSQL equivalent (null =
  flagged, never guessed). Classification STAMPED into every emitted edge's
  `path_metadata_json` (`sql_dialect`, `non_portable_constructs`) via the shared
  candidate builder — API, internal (Spec M) and MyBatis-XML edges all flow through it.
- **Findings**: new cross-file scanner pass (`sqlDialectFindings.ts`, run-it-twice over
  the resolver output, soft-fail + per-type caps) — `tsql_dialect_in_code` (medium;
  HIGH when lock hints / @@identity) with SQL verbatim + construct list + suggestions;
  `proc_call_unmatched` for extracted proc names (`EXEC x`, `{call x}`, `CALL x` —
  case-insensitive, schema-tolerant `dbo.x` ≡ `x`) with no match in the run's proc
  inventory (read defensively off pack candidates; a code-only run defers the match
  VISIBLY in the finding wording, never silently).
- **AMS**: changeset 209 (index on `endpoint_data_effects(data_entity_point_id)` +
  entity `@Index`), `findByEndpointIdIn` / `findByDataEntityPointIdIn` finders, NEW
  `EndpointDataEffectController` — one GET, two modes (`endpoint_ids` /
  `data_entity_point_ids` reverse query); neither-or-both = 400 (never an unfiltered
  dump). Callers resolve object NAMES → `dep_*` ids from the model read they already
  hold (no name-join in AMS — documented deviation from the spec's `object_name`
  param).
- **Gateway**: `endpointDataEffectsClient.ts` (both directions);
  `dbChangeConsumerResolver.ts` — affected iff touches a `translate`-disposition
  proc/view (reverse query), carries `sql_dialect: 'tsql'` on any edge (model read),
  or touches a caller-named altered table; reasons carried per endpoint;
  `packObjectSetFromTranslations` adapts the pack rows. Planner: `dialect_affected`
  EndpointFlag + optional `CodeModelView.dialectAffectedEndpointIds` — affected
  endpoints split OUT of interface clusters into individual stories via the existing
  flagged-endpoint machinery. Carriage: per-effect "T-SQL dialect rewrite guidance"
  block — offending SQL verbatim + per-construct suggested equivalents (carried, never
  invented). `revalidateDbConsumers` + route
  `POST /projects/:p/db-migration-packs/:packId/revalidate-db-consumers` — computes
  the affected set and runs ONE Spec-I scoped replay+diff over exactly those endpoint
  keys (per-invocation target auth, in-memory only).

Deviations/residuals: (1) proc-call EDGES are not minted at discovery (the linkage
surfaces as finding detail + the resolver's reverse queries; minting `query_kind:
'proc_call'` edges to proc data-entity points needs the committed proc inventory at
scan time — recorded); (2) `object_name` query mode lives caller-side (see AMS note);
(3) readiness surfacing (`affectedConsumerCount` + `db_consumers_unrevalidated` gap
code on MigrationDiscoveryContext) NOT wired — the resolver + Spec I gate codes exist,
the context-summary plumbing is the recorded follow-up; (4) planner wiring of
`dialectAffectedEndpointIds` into the book-of-work handler's model-view fetch is
injectable-but-not-defaulted (fail-soft absent = no flags) — wiring the resolver call
at plan time is part of residual (3)'s follow-up.

Verification: 9 discovery pins (`sqlDialectClassifier.test.ts`: golden tsql set ×13
texts / ANSI set ×7 / unknown ×4 / single-source-by-import / HOLDLOCK guidance /
MATCH extraction+schema-tolerance / STAMP ×2 / builder baseline) + 3 AMS MockMvc pins
(REVERSE query / endpoint batch / 400 guard) + 5 gateway pins
(`dbChangeConsumerResolver.test.ts`: AFFECTED ×2 / REVALIDATE-scope / PLAN flag /
CARRIAGE verbatim guidance). Regressions: discovery 5 suites / 48 tests green;
gateway 16 suites / 125 tests green (planner + carriage + book-of-work + parity gate);
AMS compile + new controller test green (changeset 209 chain). tsc clean in both TS
services.
