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
