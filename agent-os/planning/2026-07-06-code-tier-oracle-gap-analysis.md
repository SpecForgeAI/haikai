# Code-Tier Oracle Gap Analysis — Code Discovery Scan & the Parity Chain

**Date:** 2026-07-06
**Status:** Gap analysis complete; program questions ANSWERED (see §7); specs G–M + F
SHAPED under `agent-os/specs/2026-07-06-*`; awaiting explicit build go (shape→build boundary)
**Predecessor:** Persistence-Tier Oracle Program (Specs A–E, merged to main 2026-07-03;
see `agent-os/planning/2026-07-02-persistence-oracle-program-decisions.md`)

---

## 1. Oracle criteria for the code tier

The overall migration workflow must guarantee, for a like-for-like migration:

- **A) External equivalence** — the same request sent to a current-state API endpoint
  and to the target-state endpoint produces THE EXACT same response.
- **B) Internal equivalence** — functionality with no HTTP surface (scheduled jobs,
  batch processing, message listeners, startup logic) is captured losslessly and
  recreated in the target.

Scope of this analysis: the **code discovery scan** (generic pipeline + language/framework
packs, starting with **Java + Spring Classic**), and every downstream link that turns what
the scan captured into a proven-equivalent target system. Spec F (T-SQL affinity &
consumer revalidation, deferred from the persistence program) is folded in.

Method: seven parallel deep-reads (discovery V3 pipeline; Java/Spring Classic packs;
api-migration-validation-service; AMS code-side model; plan-layer code streams; code↔DB
linkage; IVS verify + runtime evidence), followed by direct verification of the four most
load-bearing claims (story-per-endpoint stamping, stream-scoped inventory fetch, absence
of an exact comparison mode, SOAP prepop-but-no-envelope status).

---

## 2. The chain, link by link

The oracle is only as strong as the weakest link in:

```
Scan → Model (AMS) → Plan (book of work) → Spec (shape-spec text) → Implement (IVS) → Verify (AMVS)
```

| Link | State | One-line verdict |
|---|---|---|
| **Scan** (discovery-service V3) | STRONG with known blind spots | Deterministic-first, deep Spring Classic endpoint/contract capture, behaviour blocks, data effects with verbatim SQL, operational-artifact scan. Blind spots are enumerable (§5, §6). |
| **Model** (AMS) | STRONG storage, weak read surface | Endpoints carry `request_contract` + `response_contract` + `protocol_metadata_json` JSONB; `business_logics.behavior` 7-part blocks; `endpoint_data_effects` with call-path + `query_text`/`query_kind`. But: **no REST read for data effects**, no reverse query ("endpoints touching table X"), full candidate `data` preserved at commit. |
| **Plan** (gateway book-of-work) | WEAK — the same two diseases the DB tier had | LLM skeleton (shape unpinned), stream-scoped inventory with per-epic expansion (duplication/miss depends on LLM epic shape), **one story per endpoint** (explosion), no plan-wide coverage assertion, internal entry points mis-flow into the API stream. |
| **Spec** (shape-spec generation) | WEAK — references, not facts | Spec text carries IDs (baseline/mapping/contract IDs), never the verbatim contracts, behaviour blocks, SQL, or example captures. The implementer LLM is left to invent what we already know byte-for-byte. |
| **Implement** (IVS) | ADEQUATE | 4-step Claude CLI orchestration, batch test-gate repair loop (`/haikai:debug` → `/haikai:fix`), CI binding for async verdicts, deploy with `base_url`. |
| **Verify** (AMVS) | HARNESS EXISTS, **SEAM OPEN** | Capture sessions (LLM loop + DB tools + volatility probes k=3), baselines, deterministic target replay with auto-diff, shape/value/ordering/header comparator, scenario rubric with status+auth dimensions, finding emission. **But nothing in the execution path ever calls it** — parity is a wizard a human may run, not a gate a machine enforces. And it cannot assert exactness (no strict/byte mode) nor speak SOAP envelopes. |

---

## 3. What is already genuinely strong (calibration)

To avoid the earlier over/under-confidence whiplash, the following are verified strengths:

1. **Spring Classic endpoint detection breadth** — annotations incl. meta-annotations
   (8-level resolution with canonical synthesis), raw servlets + web.xml servlet mappings,
   JAX-RS (javax+jakarta), JAX-WS/Spring-WS SOAP (WSDL parse, message reconciliation,
   DTO field models), WADL+XSD, WebFlux functional routes, message listeners
   (`@JmsListener`/`@KafkaListener`/`@RabbitListener`/`@SqsListener`/`@EventListener`),
   `@Scheduled` (emitted as endpoint subtype AND business logic).
2. **Request contract capture** — params/path/header/body bindings with Java types
   (generic unwrap), required/defaults, JSR-380 validation constraints, date formats with
   a 4-level global-precedence ladder (`spring.jackson.date-format` → ObjectMapper config
   → `@InitBinder`/CustomDateEditor → bare SimpleDateFormat literals), consumes/headers
   discriminators. Unresolvable custom serializers emit `request_format_unresolved`
   evidence-gap findings rather than silently guessing.
3. **Response contract capture** — `@ControllerAdvice`/`@ExceptionHandler`/`@ResponseStatus`
   error mapping, Jackson serialization config (`@JsonInclude`/`@JsonFormat`/`@JsonProperty`),
   method security → auth block, config-conditional variants, LLM prose enrichment that
   never overwrites deterministic values.
4. **Data effects** — controller→service→repository call paths (same-class helper inlining),
   access mode + operation hints + transactional flags, **verbatim SQL** for `@Query`
   JPQL/native and MyBatis annotations; dynamic persistence (JdbcTemplate/EntityManager)
   correctly FAILS CLOSED into unresolved findings carrying the SQL text.
5. **AMVS science** — empirical volatility probing (k=3 self-replays → per-path envelopes),
   canonical-capture selection per scenario intent, status+auth coverage rubric, header
   dimension with presence-always-breaks semantics, non-deterministic-endpoint signals,
   integrity hashes, redaction. Sybase and Postgres DB adapters have tool parity.
6. **Plan expansion discipline (within its scope)** — deterministic batching, template
   stamping from verified model facts only, referential checks, judge pass, per-epic
   coverage assertion, bespoke overrides for missing-baseline/findings/complex-SOAP,
   execution hard-gate requiring a pinned active baseline.

The bones of the oracle exist. The program below is about closing the chain, not rebuilding it.

---

## 4. Gap register (prioritised)

### P1 — The verify seam is open: parity is never machine-proven (criterion A)
**Evidence:** IVS verify = inline test-gate repair only (`implement-verify-service/src/job_queue/tasks.py:555–576`);
no call to AMVS anywhere in the implement/verify/execution path. The plan stamps
"Behavioural parity with baseline {id}" as acceptance-criterion TEXT
(`migrationBookOfWorkExpansionHandler.ts:429–432`) with no enforcement. Target replay +
auto-diff exist (`targetReplayRunner.ts`, `diffRunner.ts`) but are wizard-initiated only.
`apiBehaviourClient.ts` exists in the gateway and is unused by the plan/exec pipeline.
**Impact:** The single most important oracle property — same request → same response —
is aspirational text. A migration can complete "green" without one response ever compared.
**Fix:** Spec I (close the loop: deploy → scoped replay → diff → repair-until-parity → gate).

### P2 — The comparator cannot assert exactness; SOAP is envelope-blind
**Evidence:** No strict/canonical/byte mode (verified by direct search; "canonical" in AMVS
means canonical capture selection). Non-volatile array reorder classifies as
`body_ordering_drift` and is advisory per spec 2026-06-17. Header allowlist is fixed at 18
names in code. JSON compared structurally post-parse (`1.0` vs `1.00`, key order, whitespace
semantics untested as bytes). XML/HTML/binary compare as strings/structure. WSDL upload is
400-rejected (`contractFormatDetector.ts:15–17,156`); SOAP operations CAN be pre-populated
from committed model metadata (seven `x-amvs-soap` fields, `captureSessionActions.soapPrepop.test.ts`)
but envelope construction is left to the capture LLM and diffing is string-blunt.
**Impact:** For a Spring Classic estate (SOAP heartland), criterion A is currently
*unprovable* for SOAP surface and only structurally provable for REST.
**Fix:** Spec J (strict mode + durable waivers + XML/SOAP-aware capture, replay, compare).

### P3 — Plan layer repeats the DB tier's pre-Spec-B diseases for code streams
**Evidence (all verified directly):**
- One story per inventory item — story-per-endpoint (`stampStoryFromTemplate`,
  coverage assertion `migrationBookOfWorkExpansionHandler.ts:1263–1280`). An estate with
  400 endpoints → 400 stories → 400 IVS spec jobs. Same explosion the user vetoed for tables.
- Inventory fetch is STREAM-scoped, not epic-scoped (`defaultFetchEpicInventory` at
  `:694–769` fetches ALL model `Endpoints` for any epic in the stream). Correctness of
  coverage therefore depends on the LLM skeleton emitting exactly one inventory-bearing
  epic per stream — an unpinned assumption. Multiple epics → duplicated stories; an epic
  never expanded → zero stories, silently.
- BOTH API streams (`target_service_api_implementation` AND `api_soap_integration_compatibility`)
  map to the same `Applications/Endpoints` source (`:646–655`) — REST and SOAP endpoints
  are not split by protocol, so expanding both streams double-covers every endpoint.
- Internal entry points (endpoint subtypes `scheduled`/`jms-listener`/etc., committed as
  endpoints) flow into the API inventory where the HTTP-method name parse fails
  (`HTTP_METHOD_PATTERN :668`), baseline resolution fails (no HTTP baseline exists for a
  JMS listener) and they land in the bespoke path with parity ACs that are meaningless
  for them. There is no internal-functionality stream at all.
- No plan-wide assertion that every committed endpoint appears in exactly one story
  (the DB planner has exactly this; code streams do not).
**Fix:** Spec G (deterministic code-stream planner mirroring Spec B: protocol split,
controller/interface clustering with cap, flagged split-outs, plan-wide coverage assertion,
internal-processing stream).

### P4 — Spec text is thin: IDs instead of verbatim facts
**Evidence:** `migrationShapeSpecGenerationHandler.ts` + `migrationSpecContextClient.ts:59–238` —
context blocks carry `oasContractId`, `behaviourBaselineIds[]`, `mappingIds[]` etc.; the
generated spec text contains story title/description/ACs and references. It never embeds
the committed `request_contract`/`response_contract` JSON, behaviour blocks, data-effect
SQL, or example captured request/response pairs — all of which exist byte-exact in AMS.
**Impact:** The IVS implementer works from prose and invents details we already possess.
Directly violates the agreed principle from the DB program: verbatim facts as the total
spec input; the LLM invents little or nothing.
**Fix:** Spec H (verbatim code-spec carriage, mirror of Spec C).

### P5 — Spring Classic response-fidelity blind spots (criterion A, pack depth)
**Evidence (pack audit):** NOT captured today:
- web.xml beyond servlet mappings: `<filter>`+ordering, `<listener>`, `<error-page>`
  (directly shapes error responses), `<session-config>`, `<init-param>`, encoding filters.
- Response headers set in code (`response.setHeader/addHeader`, `ResponseEntity` builder
  header chains beyond Location detection), redirects, cache-control, cookies
  (`@CookieValue` unbound), `@MatrixVariable`, multipart metadata.
- Charset/encoding (CharacterEncodingFilter, JVM default assumptions).
- View resolution (ViewResolver config, ModelAndView/view-name returns → HTML responses) —
  view-serving endpoints are indistinguishable from JSON ones in the model.
- Pre-annotation XML MVC: `SimpleUrlHandlerMapping`/`BeanNameUrlHandlerMapping`/
  Controller-interface implementations invisible as endpoints; `mvc:interceptors`;
  HandlerInterceptors/filters detected as FINDINGS only, never mapped onto the endpoints
  they wrap; XML `tx:advice`/AOP transaction boundaries not folded into transactional flags.
- Content negotiation config and custom HttpMessageConverters.
- Spring Security filter-chain XML parsed best-effort → `unresolved` (annotations are
  captured; the chain that produces 401/403/redirect behaviour is not).
**Fix:** Spec L (pack depth wave 1 — response fidelity).

### P6 — Internal functionality is captured but never planned or verified (criterion B)
**Evidence:** Scan side is decent: `@Scheduled`/listeners as endpoint subtypes, batch
`main()` entrypoints (gated on batch signals), `@PostConstruct`/lifecycle, operational-artifact
scan (shell/JIL/perl, LLM-summarised, 2000-file cap with overflow finding), capability
synthesis (JIL-DAG). BUT: Quartz XML (SchedulerFactoryBean/JobDetail/CronTrigger) and
Spring Batch XML are import-level FINDINGS only — cron expressions/triggers/job graphs not
extracted; XML-configured `MessageListenerContainer` not detected (annotation listeners only);
`ExecutorService`/`TaskExecutor`/`@EnableAsync` invisible; `ServletContextListener` invisible;
MyBatis/iBatis XML mapper files unparsed (annotation SQL only) — a classic-estate staple.
Downstream: no plan stream, no story kind, no verification method exists for any of it
(you cannot replay a scheduled job over HTTP; nothing compares side effects).
**Fix:** Spec M (pack depth wave 2 — internal + data-access XML; side-effect parity oracle
via DB-delta comparison reusing Spec D reconciliation machinery) + the internal-processing
stream in Spec G.

### P7 — Capture coverage floor is advisory and its rubric incomplete
**Evidence:** Scenario rubric EXISTS and is better than expected: generated scenarios carry
`expectedStatus` intents, canonical-capture selection decides "achieved", auth contributes
a dedicated dimension (`captureSessionOrchestrator.ts:639–870`). Start-gate is
"zero unaccounted endpoints OR override justification" (409). But: rubric lacks pagination,
content-type, and request-validation-error dimensions (all derivable from committed
contracts); scoring is not enforced anywhere downstream (Migrate never checks it);
runtime evidence contributes usage counts only (access logs carry no bodies; no HAR
ingestion exists anywhere in the repo).
**Fix:** Spec K (small: rubric extension + floor enforcement surfaced to the Spec I gate).

### P8 — Code↔DB bridge (Spec F, now fully grounded)
**Evidence:** No T-SQL dialect classifier exists over captured Java-side SQL (verified:
no HOLDLOCK/getdate/@@identity/`*=`/TOP/raiserror/#temp detection; `query_text` filed
verbatim, dialect-blind). Proc-call strings (SimpleJdbcCall/CallableStatement/EXEC) are
captured but never matched against the sidecar's proc inventory. AMS `endpoint_data_effects`
has NO REST controller (repository finders `findByModelFileId`/`findByEndpointId` only,
no reverse query by data entity, no index on `data_entity_point_id`). AMVS diffs accept
whole baselines — no affected-endpoint scoping. DB pack translation drafts have no linkage
back to calling endpoints.
**Impact:** When the DB moves, we cannot enumerate — let alone re-verify — the code paths
whose inline SQL or proc calls broke.
**Fix:** Spec F (dialect classifier + proc matching + AMS data-effects REST/reverse-query +
scoped revalidation runs + planner flags).

---

## 5. Java + Spring Classic capture inventory (condensed)

CAPTURED: MVC annotations + meta-annotations; servlets + web.xml mappings; JAX-RS;
JAX-WS/Spring-WS + WSDL; WADL+XSD; WebFlux routes; message-listener + scheduled subtypes;
request params/validation/date-formats/consumes/headers; exception→status mapping; Jackson
config; method security; conditional variants; @Transactional; @Aspect (as business logic);
JPA entities + hbm.xml; Spring Data repos + @Query verbatim; MyBatis annotations verbatim;
JDBC/proc usage flagged fail-closed with SQL text; applicationContext bean/import/scan
parse; properties/yml global date format; batch main() entrypoints; @PostConstruct.

PARTIAL: custom (de)serializers (flagged unresolved — correct); InitBinder/converters
(finding-level, not folded into contracts); Spring Security chain (unresolved); Location
header (detected, pattern not extracted); Quartz/Spring Batch (import findings only);
@GeneratedValue (not marked auto-generated).

NOT CAPTURED: web.xml filters/listeners/error-pages/session-config; code-set response
headers; charset config; view resolution; XML MVC handler mappings + interceptor mapping;
XML tx:advice; content-negotiation config/custom converters; cookies/@MatrixVariable/
multipart metadata; locale/i18n; HttpSession usage; Quartz/Batch XML details; XML JMS
containers; ExecutorService/TaskExecutor; ServletContextListener; MyBatis XML mappers;
persistence.xml named queries; entity listeners; @Converter; @EmbeddedId; dialect
classification of captured SQL.

(Boot-vs-Classic: parity on shared detectors; Classic additionally does meta-annotation
walking + XML/hbm parsing; Boot additionally does Actuator/Feign/Lombok-prompting.)

---

## 6. Proposed spec program — "Code-Tier Oracle" (Specs G–M + F)

Letters continue the persistence program (A–E used; F reserved and kept).

| Spec | Title | Closes | Size | Key contents |
|---|---|---|---|---|
| **G** | Deterministic code-stream planning (anti-explosion + full coverage) | P3, plan half of P6 | L | Deterministic skeleton for API streams (pinned epic structure, protocol split REST vs SOAP); clustering by controller/interface with `MIGRATION_PLAN_API_CLUSTER_MAX_ENDPOINTS` (default ~15) for mechanical endpoints; flagged endpoints (missing baseline, findings, complex SOAP, dialect-affected once F lands, live conflicts) get individual stories; NEW internal-processing stream fed by non-HTTP entry points (subtypes, batch entrypoints, capabilities) clustered by capability; plan-wide code-asserted coverage: every committed endpoint in exactly one story ("regenerate the migration plan" on drift). Mirrors Spec B. |
| **H** | Verbatim code-spec carriage | P4 | M | Spec text embeds byte-for-byte: committed `request_contract` + `response_contract` + `protocol_metadata_json`, behaviour blocks of endpoint-reachable `business_logics`, data-effect paths + verbatim SQL, N example captured scenarios (request/response pairs, redacted) from the active baseline, attached findings. Unbreakable fences (longest-run+1, min 4), size guardrails, missing→insufficient_context. Requires new AMS focused reads (endpoint by id incl. contracts; data effects by endpoint — SHARED with F). Mirrors Spec C. |
| **I** | Implement→parity verify loop + execution gates | P1 | L | After IVS implement+deploy (`deploy_on_complete` base_url): programmatic AMVS target session → replay SCOPED to the story's endpoints → auto-diff → verdict into IVS verification loop (breaks become repair-loop input, cap attempts) → repeat until clean. Migrate gate extension (gate-4b pattern): code stories blocked unless every in-scope endpoint has an active baseline meeting the coverage floor; run completion requires last diff clean or explicit durable waivers. FAIL-CLOSED on unreadable state. The crown of criterion A. |
| **J** | Exactness & SOAP for the parity harness | P2 | L | STRICT mode: canonical-JSON byte comparison option, ordering breaks by default, configurable header policy with persisted reasoned waivers, charset/content-type semantics, numeric-literal fidelity. SOAP: WSDL upload (reuse discovery's parser), envelope construction from WSDL + committed `x-amvs-soap` metadata, SOAP replay, XML-aware canonical comparator (namespace-aware, XPath volatility paths). Volatility-envelope machinery retained; strictness governs everything not explicitly probed/waived. |
| **K** | Scenario coverage floor | P7 | S | Extend the existing rubric with pagination, content-type, and request-validation-error dimensions derived from committed contracts; persist per-endpoint coverage scores; enforce floor at the Spec I gate (replace advisory 409-override with explicit durable waivers). |
| **L** | Spring Classic pack depth — response fidelity | P5 | L | Full web.xml (filters+order, listeners, error-pages→response_contract, session-config, init-params, encoding); code-set response headers; redirects; cookies/@CookieValue/@MatrixVariable/multipart; charset; view-resolution capture + `response_kind` marking (json/xml/view-html) so the parity harness knows what it is diffing; XML MVC (handler mappings, controller-interface endpoints, mvc:interceptors mapped ONTO endpoints); XML tx:advice→transactional flags; content-negotiation + custom converters; Security filter-chain XML best-effort upgrade. |
| **M** | Spring Classic pack depth — internal functionality + data-access XML | P6 | M/L | Quartz XML + task:* XML + Spring Batch XML → first-class internal-process candidates with VERBATIM schedule/cron/trigger/job-graph metadata; XML JMS listener containers; ServletContextListener; ExecutorService/TaskExecutor beans; MyBatis/iBatis XML mappers (SQL verbatim → data effects); persistence.xml named queries; side-effect parity oracle design for internal jobs: run on both sides, compare DB deltas via Spec D reconciliation machinery (jobs' data effects tell it which tables), plus emitted-file/message checks. |
| **F** | T-SQL affinity & consumer revalidation | P8 | M | Deterministic T-SQL dialect classifier over all captured/unresolved Java-side SQL (getdate, @@identity/@@rowcount, HOLDLOCK/NOLOCK, `*=`, TOP-without-parens, convert/datediff/dateadd/isnull, #temp, raiserror, sp_/EXEC calls) → per-edge dialect + non-portable-construct list; proc-call name matching against sidecar proc inventory → endpoint↔proc edges; AMS: data-effects REST read + reverse query (endpoints by table/proc, with index); planner: dialect-affected endpoints auto-flagged into individual stories carrying the pack's construct-mapping guidance verbatim; AMVS: replay/diff runs scoped to an affected-endpoint set ("revalidate these N endpoints") — component shared with I. |

**Dependency notes:** H and F share the new AMS data-effects read. I consumes G's tags,
K's floor, and shares scoped-replay with F. L/M feed everything upstream (richer capture →
richer specs/scenarios) but nothing hard-depends on them. Suggested build order:
G → H (plan+carriage) in parallel with L → M (capture depth); then J, K, I (prove it),
then F (bridge). If the estate is SOAP-heavy, J moves ahead of H.

---

## 7. Program questions — ANSWERED 2026-07-06

1. **SOAP share:** Haikai is a migration TOOL — a given app may be 100% SOAP, 100% REST,
   or (less likely) a mix. → SOAP support is FIRST-CLASS, not conditional. Spec J's
   WSDL/envelope/XML-compare work is core; Spec G must plan a 100%-SOAP app as cleanly
   as a 100%-REST one.
2. **View-serving endpoints:** API-only for now; UI migration is a later program (not
   this-session future). → Spec L still DETECTS and CLASSIFIES view-serving endpoints
   (`response_kind`) but they are marked out-of-parity-scope with a visible finding
   (nothing silent) rather than given HTML byte-parity. Spec J drops HTML comparison.
3. **Internal-job oracle:** YES — DB-delta + outputs is the accepted equivalence proof.
   Specs must capture batch jobs, their INPUTS, WHAT THEY DO, and their OUTPUTS/UPDATES.
   Two estate facts folded into Spec M's design: (a) batch jobs typically update the DB
   through the app's own service/DAO/persistence layers → data-effect + behaviour capture
   must be rooted at INTERNAL entry points, not just HTTP endpoints (today both the
   behaviour-capture selector and the data-effect resolver are endpoint-rooted);
   (b) a batch job may call one of the app's OWN API endpoints → detect self-HTTP-calls
   in batch-reachable code and link them to the endpoint inventory, so endpoint parity
   evidence partially covers the batch path.
4. **Endpoint clustering:** cluster unit = the INTERFACE (Controller class or SOAP
   service equivalent) — one spec per interface by default. If an interface exceeds the
   cap: split by VERB GROUP (all GETs / all POSTs+PUTs(+PATCH) / all other verbs e.g.
   DELETE, OPTIONS, HEAD). If a verb group still exceeds the cap: deterministic
   path-sorted chunking. SOAP interfaces (no verbs): alphabetical operation-group
   chunking. Flagged endpoints are still extracted to individual stories regardless.
   Guiding rule stated by the user: ACCURACY over spec count.

---

## 8. Focused review: API Behaviour Baseline Capture Scans (added 2026-07-06)

User reframe that triggered this section: the capture scans are not merely verification —
together with the code discovery scans they are the PRODUCERS of the input to the
eventually-created migration plan specs (1: building correct specs; 2: reconciliation).

### What the capture side already does well (verified; unchanged by the program)

- Model-seeded inventory + protocol-aware reconciliation with a REAL staleness gate for
  INVENTORY drift (D8: endpoint committed after configure → 409 at `/start`, override
  persisted; `captureSessionActions.inventoryReconciliation.e2e.test.ts`).
- Intent-driven scenario generation (expectedStatus directives), canonical-capture
  selection, coverage rubric with status+auth dimensions
  (`captureSessionOrchestrator.ts:639–870`).
- Data realism grounding: DB tools (payload context, `sample_db_values`,
  `run_readonly_sql` behind `sqlGuard`), contract formats from code discovery feed request
  construction (`captureSessionOrchestrator.ts:379`), Postman-collection import with
  LLM delta top-up (Mode 1b), redaction + per-invocation secrets.
- Volatility science (k=3 probes, per-path envelopes, endpoint signals) and stateful
  SEQUENCES with cross-step reference volatility (`sequenceReplayRunner.ts`,
  `statefulSequenceRefVolatilityRoundTrip.test.ts`) — more mature than assumed.

### Gaps exposed by the producer framing → program deltas

| Gap | Evidence | Delta |
|---|---|---|
| **Write endpoints capture only half the truth.** Response recorded; the DB delta the write caused is not (`sample_db_values` → `business_notes`, audit-only; verified no pre/post state anywhere in AMVS). Reconciliation can pass a target that returns the right response and writes the wrong rows. Mutating volatility is `not_probed`. | direct grep 2026-07-06 | **NEW Spec N** — effect-scoped pre/post snapshots (tables from committed data effects; keyed rows when derivable from verbatim `query_text`/response values; bounded fallbacks, nothing silent), `state_delta_json` on baseline items, target-side delta comparison with type-mapping-aware equivalence (DB pack single-source mapping), `state_match/state_drift/state_unverified` classifications, schema-derived mutating volatility. |
| **Capture work is unplanned.** `missing_baseline` → flagged story, but no story CREATES baselines; gates would dead-end. | plan trace §4 | **Spec G amendment** — "Baseline capture & coverage" epic: one deterministic capture story per below-floor interface, sequenced before that interface's implementation story. |
| **Spec-input channel too shallow.** H embedded a fixed 3 examples/endpoint. | Spec H v1 | **Spec H amendment** — embed the full canonical scenario set (one per achieved rubric dimension), revised trim ladder; embed expected `state_delta_json` for mutating endpoints (explicit not-captured marker otherwise). |
| **Behavioural drift vs the live legacy is undetected.** Baselines are point-in-time; the legacy app stays live until swap-over. D8 covers inventory drift only. | grep 2026-07-06 | **Spec I amendment** — drift-check run mode (scoped replay pointed at CURRENT), gate codes `baseline_drift_unchecked` (age policy, default 14d) + `baseline_behaviour_drift` (blocking); state parity folded into the verdict (from N). |
| **No lifecycle scenarios in the rubric** (sequences exist but aren't a scored dimension). | rubric read | **Spec K amendment** — optional REPORTED-only `resource_lifecycle` dimension reusing existing sequence machinery; interface-level score aggregation for G's capture stories. |

### Revised program (9 specs)

G (planning, +capture stories) · H (verbatim carriage, +full canonical set +deltas) ·
I (parity loop, +state parity +drift check) · J (exactness+SOAP) · K (floor, +lifecycle) ·
L (Spring Classic response fidelity) · M (internal functionality) · **N (state-delta
capture & reconciliation — NEW)** · F (T-SQL affinity & consumer revalidation).

Suggested build order: G → H ∥ L → M, then J, K, N, I, F.

## 9. Standing constraints carried forward

- Anti-explosion is a program invariant: no story-per-endpoint, no story-per-table.
- Nothing silent: every cap/skip/unresolved emits a finding; gates FAIL CLOSED.
- Verbatim facts are the spec input; the LLM invents as little as possible.
- Baseline-red inventory discipline: verify changed modules in isolation
  (whole-repo tsc/lint pre-existingly red on main).
- App under test runs on ANOTHER machine: no localhost probing from tools here.
