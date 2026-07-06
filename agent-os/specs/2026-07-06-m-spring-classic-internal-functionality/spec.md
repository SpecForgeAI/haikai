# Spec M — Spring Classic Pack Depth, Wave 2: Internal Functionality + Data-Access XML

**Program:** Code-Tier Oracle (see `agent-os/planning/2026-07-06-code-tier-oracle-gap-analysis.md`)
**Closes:** Gap P6 (criterion B) — internal (non-HTTP) functionality is only shallowly
captured and never verifiable; classic-estate data-access XML (MyBatis/iBatis) is unparsed.
**User decisions binding this spec:** the internal-job oracle is **same DB delta + same
emitted outputs**; batch jobs update the DB through the app's own service/DAO layers; a
batch job may call one of the app's OWN API endpoints.

## Goal

Every internal entry point (scheduled job, message listener, batch entrypoint, startup
hook) is captured as a first-class model element with its TRIGGER (verbatim schedule),
INPUTS, BEHAVIOUR, and OUTPUTS/UPDATES (data effects with verbatim SQL) — deep enough that
Spec G plans it, Spec H carries it verbatim, and a side-by-side DB-delta run can verify it.

## Evidence / current gaps

- Quartz (`SchedulerFactoryBean`/`JobDetail`/`CronTriggerFactoryBean`) and Spring Batch:
  import-level FINDINGS only (`springClassicFindingScanner.ts:161–165`) — cron expressions,
  triggers, job graphs NOT extracted.
- XML-configured JMS (`DefaultMessageListenerContainer` etc.): invisible (annotation
  listeners only, `springClassic/index.ts:195–202`).
- `ExecutorService`/`TaskExecutor`/`@EnableAsync` beans, `TimerTask`,
  `ServletContextListener`: invisible.
- Behaviour capture selector and data-effect resolver are ENDPOINT-rooted
  (`llmBehaviourCaptureStep.ts` selector requires endpoint-reachability;
  `endpointDataEffectResolver.ts` resolves from controllers) — batch/listener-reachable
  code gets NO behaviour blocks and NO data effects today.
- MyBatis/iBatis XML mapper files unparsed (annotations only,
  `endpointDataEffectResolver.ts:168`); `persistence.xml` named queries unparsed; JPA
  entity listeners (@PrePersist etc.) unsurfaced.

## Scope

### 1. First-class internal-process capture (springClassic adapter + parsers)

- **Quartz XML:** `SchedulerFactoryBean`, `JobDetail`/`JobDetailFactoryBean` (job class,
  durability, data map), `CronTriggerFactoryBean`/`SimpleTriggerFactoryBean` (cron
  expression VERBATIM, misfire policy, repeat config) → internal-process candidates
  (endpoint subtype `quartz-job` + trigger metadata in `data.schedule` verbatim).
- **task: namespace XML:** `task:scheduled-tasks` (method + cron/fixed-delay/fixed-rate
  verbatim), `task:scheduler`/`task:executor` (pool config) → same treatment
  (`scheduled` subtype; executor beans as app-level facts).
- **Spring Batch XML:** `<job>`/`<step>`/`<tasklet>`/chunk (reader/processor/writer bean
  refs, commit-interval, listeners, flow/decision graph) → internal-process candidate per
  job with the step graph verbatim in `data.batch_graph`; step beans linked.
- **XML JMS:** `DefaultMessageListenerContainer`/`jms:listener-container` (destination
  name VERBATIM, concurrency, selector, listener bean/method) → `jms-listener` subtype
  candidates (parity with annotation listeners).
- **Startup hooks:** `ServletContextListener` (web.xml `<listener>` — parse from Spec L's
  extension), `InitializingBean`/`@PostConstruct` on singletons doing more than wiring →
  `startup-hook` internal-process candidates (boilerplate exclusions per java.md kept).
- **TimerTask/raw threads:** detected → `unmanaged-concurrency` finding (visible; not
  modelled as first-class — recorded residual).

### 2. Root extension: behaviour + data effects from internal entry points

The load-bearing change for criterion B:

- Generalize the data-effect resolver's ROOTS: today controllers; add internal entry
  points (scheduled methods, listener methods, Quartz job `execute`, Batch
  reader/processor/writer methods, batch `main()` entrypoints, startup hooks). Same
  hop-walk, same verbatim `query_text`/`query_kind` capture, same fail-closed unresolved
  findings — producing `internal_process_data_effects` edges (same edge shape; owner is
  the internal-process element rather than an HTTP endpoint).
- Generalize the behaviour-capture selector: `endpointReachableMethodIds` becomes
  entry-point-reachable (HTTP + internal). Existing caps/cache/token ceilings unchanged
  (they scale by selection size; cap-hit stays a visible degraded signal).
- **Self-API-call detection:** outbound HTTP usage (RestTemplate/HttpClient/WebClient —
  existing outbound-integration detection) inside INTERNAL-reachable code, whose URL
  matches the app's OWN endpoint inventory (path-template match) → linkage fact
  `calls_own_endpoint: [endpointIds]` on the internal process. Consequence: endpoint
  parity evidence (Specs I/J) partially covers that batch path, and the DB-delta oracle
  knows those effects arrive via the endpoint.

### 3. Data-access XML (classic estates)

- **MyBatis/iBatis XML mappers:** parse mapper files (`<select>/<insert>/<update>/<delete>`,
  resultMap → entity links, parameterType). SQL VERBATIM → data effects with
  `query_kind: 'mybatis_xml'`; dynamic-SQL tags (`<if>`, `<choose>`, `<foreach>`) carried
  verbatim and flagged `dynamic_sql` (fail-closed honesty: the composed SQL is
  runtime-dependent).
- **persistence.xml / orm.xml named queries:** parsed → data effects on their invoking
  methods (match by name at `createNamedQuery` call sites; unmatched named queries emit a
  finding).
- **JPA entity listeners** (`@PrePersist/@PostPersist/@PreUpdate/@PostUpdate/@PreRemove`,
  `@EntityListeners`): surfaced as business_logics attached to the entity (they mutate
  data invisibly — parity-relevant) + finding.

### 4. Internal-job verification design (the DB-delta oracle)

Design + minimal machinery, consumed by Spec G's internal-stream stories and executed
through the H-carried spec text:

- Per internal process, the verification recipe embedded in its story/spec:
  1. **Inputs pinned:** schedule suppressed on both sides; job triggered manually with
     pinned inputs (job data map / batch parameters / a captured representative message
     for listeners).
  2. **Effect scope:** the process's data-effect table set (from §2) defines the
     comparison scope.
  3. **DB-delta compare:** before/after snapshots on current and target, compared with
     the Persistence Spec D reconciliation machinery (row counts + checksums scoped to
     the effect tables); expected outcome: identical deltas.
  4. **Outputs compare:** emitted files (byte compare), emitted messages (payload
     compare), self-API-calls (covered by endpoint parity, cross-referenced).
- Gate note: internal-stream stories are exempt from Spec I's HTTP-parity gate and instead
  carry this recipe as their verification obligation; automating the recipe end-to-end is
  a candidate FOLLOW-ON once shakedown shows the manual-assisted loop works (recorded in
  the program log — scoped OUT of this spec to keep it buildable).

## Non-goals

- Full automation of the internal-job oracle (recipe + machinery hooks only, see §4).
- Spring Cloud Task, distributed schedulers beyond Quartz, locale/i18n.
- Any DB-pack change (Spec D machinery is consumed, not modified).

## Acceptance criteria

1. **QUARTZ PIN:** fixture Quartz XML (2 jobs, cron + simple trigger) → 2 internal-process
   candidates with verbatim cron/trigger config; finding-only behaviour gone.
2. **BATCH PIN:** Spring Batch XML fixture → job candidate with step graph verbatim;
   reader/writer beans linked.
3. **ROOTS PIN:** a scheduled method calling a DAO with `@Query` → internal data-effect
   edge with verbatim SQL; same method receives a behaviour block (selector extension);
   an equivalent HTTP-only fixture is byte-identical to pre-change output (no regression
   to endpoint rooting).
4. **SELF-CALL PIN:** batch code calling `http://.../api/orders` matching an own endpoint
   → `calls_own_endpoint` linkage with the endpoint id.
5. **MYBATIS PIN:** mapper XML fixture → data effects with `query_kind: 'mybatis_xml'`,
   SQL verbatim; dynamic-SQL statement flagged, not guessed.
6. **RECIPE PIN:** internal-stream story spec text (via H) contains the four-step
   verification recipe with the process's own effect-table list and verbatim schedule.
7. XML JMS container fixture → `jms-listener` candidate with verbatim destination.

## Test plan

Parser fixture suites per construct (pins 1,2,5,7); resolver/selector root-extension tests
incl. the no-regression pin (pin 3); self-call matcher tests (pin 4); H-integration test
for the recipe (pin 6). Baseline-red discipline; existing behaviour-capture and
data-effect suites must stay green unmodified.

## Dependencies & sizing

Depends on: Spec L's web.xml listener parse (soft — can inline if built first); Spec H for
recipe carriage (test-level). Feeds: G (internal inventory), H (verbatim facts), the
program's criterion B end-to-end. Size: **M/L**. Build after L.
