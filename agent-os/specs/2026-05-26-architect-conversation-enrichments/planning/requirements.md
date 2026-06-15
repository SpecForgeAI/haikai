# Spec Requirements: Architect Conversation Enrichments (Batched #11 + #12)

## Initial Description

Two deferred Spec 3 enrichments to the Architect Conversation tab, batched into one commit:

- **#11** — Per-question static context lead-ins (51 hand-authored framing strings rendered above each question prompt in a muted `<small>`-style block).
- **#12** — Transcript export: an "Export transcript" button on the Architect Conversation tab that downloads a Markdown file of all turns chronologically.

Same surface, same review pass, one commit boundary. Raw-idea has settled the batch scope and 11+ decisions already (don't re-litigate).

---

## Validated Reuse Inventory

Confirmed by reading the relevant files end-to-end:

### Files / symbols this spec touches

| File | Role in this spec |
| --- | --- |
| `gateway/src/config/architect-conversation/questionLibrary.ts` | Add `staticContextLeadIn?: string` to `QuestionLibraryEntry`. Populate per-entry copy for all 51 rows. The existing unused `discoveryContextLead?: string` field stays untouched. |
| `gateway/src/services/architectConversation/turnShape.ts` | Add `staticContextLeadIn?: string` to `QuestionTurn` (additive, optional). |
| `gateway/src/services/architectConversation/architectConversationCoordinator.ts` | Line 204 — `QuestionTurn` constructor copies `args.entry.staticContextLeadIn` onto the turn payload. |
| `frontend/src/api/architectConversationApi.ts` | Mirror the new optional `staticContextLeadIn` on the `QuestionTurn` type (lines 96-101). |
| `frontend/src/components/targetState/architectConversation/ConversationMainPane.tsx` | TurnView `case 'question'` (lines 276-287) — insertion point for the lead-in `<small>` block above the prompt text. |
| `frontend/src/components/targetState/architectConversation/ArchitectConversationTab.tsx` | Add an "Export transcript" button. No existing toolbar today — needs a new toolbar slot inside `styles.container` above the `styles.layout` grid. |
| `frontend/src/components/targetState/architectConversation/exportTranscript.ts` | **NEW** utility: `buildTranscriptMarkdown({ turns, architectureName, architectureId, projectId, exportedAt }) → string`. |
| `frontend/src/components/Architecture/TargetArchitectureWorkspace.tsx` | Line 927-934 — pass new `architectureName={activeTarget?.name}` prop into `ArchitectConversationTab`. |
| `frontend/src/components/targetState/architectConversation/ArchitectConversation.module.css` | Add a `.contextLeadIn` style (color `#57606a`, font-size `0.8rem`, `font-style: italic`, `margin-bottom: 0.25rem`). The existing `.turnLabel` class (line 90-96) already uses `color: #57606a` — that hex is the established muted color. Mirror it. |

### Existing patterns to mirror

- **Muted-text color**: `#57606a` is already used by `.turnLabel`, `.summaryGroupHeader`, `.emptyStateCopy`, `.summaryRowCode`, and the close-gate hint inline-style (`CloseConversationFlow.tsx` line 123). New `.contextLeadIn` should use the same hex.
- **Button styling**: `.secondaryButton` (line 158 of the CSS module — `background: #f6f8fa; color: #24292f; border: 1px solid #d0d7de;`) is the natural mirror for an "Export transcript" button. The "Retire current and start new" button at `CloseConversationFlow.tsx:106` uses this class.
- **lucide-react `Download` icon**: confirmed earlier as already a dep (used in spec #7). The button should mirror the existing usage pattern in the codebase.
- **Slug helper**: a quick lowercase + replace non-`[a-z0-9-]` with `-` regex is sufficient — no existing slugify util in the frontend; defining a small inline helper in `exportTranscript.ts` is fine.

### Confirmed additive wire-shape change

Adding `staticContextLeadIn?: string` to:

1. `QuestionLibraryEntry` (gateway library schema) — optional, so existing rows without it stay valid until populated.
2. `QuestionTurn` interface (gateway `turnShape.ts` + frontend mirror in `architectConversationApi.ts`) — optional; backward-compatible with prior persisted turns that have no field.
3. The coordinator's `QuestionTurn` construction (line 204-209) — one new line copying `args.entry.staticContextLeadIn` through.

No new endpoints. No new fetches. The library-fetch path introduced by the Four-Spec Hardening Pass (Item 4) is for the **scope map only**; this lead-in copy flows on the turn payload instead. Persisted older turns (pre-spec) that don't carry the field continue to render normally — the frontend guards `turn.staticContextLeadIn != null && turn.staticContextLeadIn.length > 0`.

### Existing similar features identified

- **`tech-stack-prefill-summary` banner** — same conversation pane, demonstrates the precedent of a peer-banner above the `layout` grid (lines 650-655 of `ArchitectConversationTab.tsx`). The export button toolbar should sit in a similar zone.
- **`DownstreamCodesBanner`** (lines 656-661) — another precedent for a slim element above the main layout.
- **`CloseConversationFlow` close button** — precedent for a styled action button (`primaryButton`); the export button mirrors the secondary variant.

---

## Requirements Discussion

### Investigation Findings

1. **Question library is in scope as planned.** All 51 questions verified across groups A-J (6+6+6+4+5+5+5+5+5+4 = 51). The existing `discoveryContextLead?: string` field is on the entry but never populated and never read at runtime (the coordinator at line 200-202 still concatenates it into the prompt if present, but no entry has one — confirmed by reading all 51 entries). Per raw-idea decision 2, that field stays untouched.

2. **No existing toolbar in `ArchitectConversationTab.tsx`.** The tab renders `container > [TechStackPrefillBanner?] > [DownstreamCodesBanner?] > layout`. The natural placement for the export button is a new toolbar `<div>` inserted between the banner zone and the `styles.layout` grid (right-aligned, single button for now). Raw-idea said "alongside Close conversation" but Close is inside `CloseConversationFlow` which lives in the right-rail column of the `layout` grid — that's not the right spot for a tab-level export. **Recommend** putting the button at the top of the tab in its own toolbar `<div>` aligned to the right.

3. **Question turn rendering insertion point.** Lines 276-287 of `ConversationMainPane.tsx` — `case 'question'`. The lead-in goes BEFORE `{turn.promptText}` and AFTER the `turnLabel` div, wrapped in a `<small className={styles.contextLeadIn}>` block. Guard with `{turn.staticContextLeadIn && (...)}`.

4. **Turn-kind enumeration.** 14 turn kinds total (not 12-13 as raw-idea estimated): `question`, `answer`, `cascade-summary`, `cascade-accepted`, `cascade-overridden`, `decision-captured`, `mapping-mutation-summary`, `exception-pinned`, `edit-superseded`, `system-skip`, `error`, `open`, `close`, `tech-stack-prefill-summary`. All need an export emit shape.

---

## #11 — Per-Question Lead-In Copy Draft Table

**Style guide applied:** 30-120 chars per entry. Lead with decision subject, then list 3-5 modern picks. Neutral — no recommendation. Plain text.

**User: please review + revise as needed. Strikethrough or rewrite any row before implementation.**

### Group A — Service runtime (6)

| # | code | prompt (excerpt) | DRAFT `staticContextLeadIn` |
| --- | --- | --- | --- |
| A.1 | `service.language` | language + major version | The language and version each service runs on. Common modern picks: Java 21, Kotlin 2, Node 20, Python 3.12, Go 1.22, C# 12. |
| A.2 | `service.framework` | application framework | The application framework hosting service code. Common modern picks: Spring Boot, Quarkus, Micronaut, NestJS, FastAPI, ASP.NET. |
| A.3 | `service.runtime` | runtime/JVM/container base | The runtime or JVM/container base each service is packaged onto. Common modern picks: Temurin JRE, GraalVM, Node slim, Python slim, distroless. |
| A.4 | `service.processModel` | process model | Whether each service runs single-process, worker-pool, or event-loop. Modern services usually pick single-process or async event loop. |
| A.5 | `service.config` | runtime configuration | How services consume runtime config. Common modern picks: env vars (12-factor), Spring Cloud Config, Consul KV, Kubernetes ConfigMaps. |
| A.6 | `service.healthcheck` | liveness/readiness contract | The liveness/readiness/startup check contract services expose. Common modern picks: Spring Actuator, Kubernetes `/healthz` + `/readyz`, custom JSON. |

### Group B — API surface (6)

| # | code | prompt (excerpt) | DRAFT `staticContextLeadIn` |
| --- | --- | --- | --- |
| B.1 | `api.protocol` | external protocols | The protocols services expose externally. Common modern picks: REST/JSON, gRPC, GraphQL, SOAP passthrough, AsyncAPI/Kafka. |
| B.2 | `api.versioning` | versioning strategy | How API versions are signalled to consumers. Common modern picks: URL path, header-based, content negotiation, semantic field deprecation. |
| B.3 | `api.contractFormat` | contract spec format | The source-of-truth format for API contracts. Common modern picks: OpenAPI 3.1, proto3, GraphQL SDL, AsyncAPI 3, WSDL 1.1. |
| B.4 | `api.auth` | authn/authz stack | How callers authenticate to the API. Common modern picks: OAuth2 + JWT, mTLS, API keys, session cookies + CSRF. |
| B.5 | `api.errorContract` | error response shape | The error envelope endpoints emit. Common modern picks: RFC 7807 Problem Details, custom JSON envelope, gRPC status, GraphQL errors[]. |
| B.6 | `api.rateLimiting` | rate-limit strategy | Where rate-limiting is enforced. Common modern picks: gateway-enforced, per-service in-process, or none. |

### Group C — Data persistence (6)

| # | code | prompt (excerpt) | DRAFT `staticContextLeadIn` |
| --- | --- | --- | --- |
| C.1 | `db.engine` | primary database engine | The primary store for transactional workloads. Common modern picks: PostgreSQL, MySQL, SQL Server, Oracle, MongoDB, DynamoDB. |
| C.2 | `db.migrations` | schema-migration tool | The tool managing DDL changes. Common modern picks: Flyway, Liquibase, Mongock, or app-managed. |
| C.3 | `db.connectionPool` | connection-pool implementation | The connection-pool library services use. Common modern picks: HikariCP, Agroal, native driver pool. |
| C.4 | `db.transactionStrategy` | transactional boundary strategy | Where transactional boundaries live. Common modern picks: per-request, saga-orchestrated, or no transactions (event-driven). |
| C.5 | `db.readReplicaUsage` | read-replica use | Whether read-heavy paths route to replicas. Common modern picks: routed via proxy, app-selected, or no replicas. |
| C.6 | `db.driver` | database driver/adapter | The driver/adapter each service uses. Common modern picks: pgjdbc, mysql-connector-j, mssql-jdbc, oracle ojdbc, mongo-java-driver. |

### Group D — Domain / DTO style (4)

| # | code | prompt (excerpt) | DRAFT `staticContextLeadIn` |
| --- | --- | --- | --- |
| D.1 | `dto.style` | DTO style | The DTO style services adopt. Common modern picks: Java records, Kotlin data classes, TypeScript interfaces, Pydantic models, Go structs. |
| D.2 | `validation.framework` | validation framework | The validation library on the input boundary. Common modern picks: Bean Validation, Hibernate Validator, class-validator, Pydantic v2. |
| D.3 | `domain.mappingStrategy` | entity-to-DTO mapping | How persistence entities map to DTOs. Common modern picks: MapStruct, manual mappers, ModelMapper, or direct entity exposure. |
| D.4 | `domain.errorModel` | domain error propagation | How domain errors travel through service layers. Common modern picks: typed exceptions, Result/Either, error codes on the response envelope. |

### Group E — Frontend (5; relevance-gated)

| # | code | prompt (excerpt) | DRAFT `staticContextLeadIn` |
| --- | --- | --- | --- |
| E.1 | `ui.framework` | frontend framework | The framework powering the target UI. Common modern picks: React 18, Vue 3, Angular 17, Svelte 5, or server-rendered. |
| E.2 | `ui.buildTool` | UI build tool | The bundler/build tool for the UI. Common modern picks: Vite 5, Webpack 5, esbuild, Angular CLI. |
| E.3 | `ui.testing` | UI testing stack | The UI test framework. Common modern picks: Vitest + Testing Library, Jest + Testing Library, Karma + Jasmine, Playwright. |
| E.4 | `ui.stateManagement` | client-side state | The client state library. Common modern picks: Redux Toolkit, Zustand, Pinia, NgRx, MobX, or local-state-only. |
| E.5 | `ui.designSystem` | design system | The component library/design system. Common modern picks: MUI, Ant Design, Chakra, Tailwind + headless, in-house. |

### Group F — Cross-cutting (5)

| # | code | prompt (excerpt) | DRAFT `staticContextLeadIn` |
| --- | --- | --- | --- |
| F.1 | `logging.framework` | logging stack | The logging library each service uses. Common modern picks: SLF4J + Logback JSON, Log4j 2, pino, structlog, zap. |
| F.2 | `logging.format` | log line format | The on-the-wire log format. Common modern picks: JSON one-line, key=value, plain text. |
| F.3 | `metrics.framework` | metrics emission | The metrics library services use. Common modern picks: Micrometer, prom-client, OpenTelemetry metrics. |
| F.4 | `tracing.framework` | distributed-tracing library | The distributed-tracing SDK. Common modern picks: OpenTelemetry SDK, Spring Cloud Sleuth, Zipkin Brave. |
| F.5 | `secrets.management` | secrets source | Where services fetch secrets from. Common modern picks: Vault, AWS Secrets Manager, Azure Key Vault, env vars from CI. |

### Group G — Infrastructure (5)

| # | code | prompt (excerpt) | DRAFT `staticContextLeadIn` |
| --- | --- | --- | --- |
| G.1 | `build.tool` | service build tool | The build tool each service uses. Common modern picks: Gradle 8, Maven 3.9, npm + tsc, uv, go build, dotnet. |
| G.2 | `container.runtime` | container runtime/packaging | How services are packaged into containers. Common modern picks: OCI image via Docker, Buildpacks, Jib, or bare-metal. |
| G.3 | `container.baseImage` | container base image family | The base image family services derive from. Common modern picks: eclipse-temurin, node-slim, python-slim, distroless, ubi-minimal. |
| G.4 | `ci.pipeline` | CI system | The CI system running the build pipeline. Common modern picks: GitHub Actions, GitLab CI, Jenkins, Azure DevOps Pipelines. |
| G.5 | `deployment.target` | deployment target | Where services deploy. Common modern picks: Kubernetes, ECS Fargate, Cloud Run, on-prem VM, serverless functions. |

### Group H — Inter-service communication (5)

| # | code | prompt (excerpt) | DRAFT `staticContextLeadIn` |
| --- | --- | --- | --- |
| H.1 | `interservice.syncProtocol` | sync inter-service protocol | The protocol for synchronous service-to-service calls. Common modern picks: REST/JSON, gRPC, or async-only. |
| H.2 | `interservice.asyncBus` | async messaging bus | The bus carrying async events between services. Common modern picks: Kafka, RabbitMQ, AWS SQS, Azure Service Bus, or none. |
| H.3 | `interservice.messageFormat` | async payload format | The on-the-wire format for async messages. Common modern picks: Avro + Schema Registry, JSON Schema, Protobuf, plain JSON. |
| H.4 | `interservice.discoveryMechanism` | service discovery | How services find each other at runtime. Common modern picks: Kubernetes DNS, Consul, Eureka, or hardcoded config URLs. |
| H.5 | `interservice.retryStrategy` | retry/backoff policy | The retry/backoff policy on inter-service calls. Common modern picks: Resilience4j defaults, exponential with jitter, or fail-fast. |

### Group I — Testing (5)

| # | code | prompt (excerpt) | DRAFT `staticContextLeadIn` |
| --- | --- | --- | --- |
| I.1 | `testing.unit` | unit-test framework | The unit-test framework for service code. Common modern picks: JUnit 5, Vitest, pytest, go test, NUnit 4. |
| I.2 | `testing.integration` | integration-test framework | The integration-test framework. Common modern picks: Spring Boot Test + Testcontainers, Quarkus Test, Vitest + Testcontainers, pytest + testcontainers-python. |
| I.3 | `testing.e2e` | end-to-end test framework | The end-to-end test framework. Common modern picks: Playwright, Cypress, REST Assured, Karate, or none. |
| I.4 | `testing.contractTesting` | consumer-driven contract testing | The consumer-driven contract framework. Common modern picks: Pact, Spring Cloud Contract, or none. |
| I.5 | `testing.mocking` | mocking library | The mocking library for unit tests. Common modern picks: Mockito 5, MockK, vi.mock, pytest-mock, gomock. |

### Group J — Cut-over (4)

| # | code | prompt (excerpt) | DRAFT `staticContextLeadIn` |
| --- | --- | --- | --- |
| J.1 | `cutover.strategy` | cut-over strategy | How the migration moves traffic from current to target. Common modern picks: strangler fig, big-bang, blue-green, dark launch + shadow traffic. |
| J.2 | `cutover.dataMigration` | data migration approach | How data moves from current to target persistence. Common modern picks: online dual-write + backfill, offline ETL with downtime, change-data-capture, shared DB. |
| J.3 | `cutover.rollback` | rollback plan | The rollback plan if cut-over fails. Common modern picks: DNS flip back, traffic-shaped percentage rollback, restore from backup + replay. |
| J.4 | `cutover.parallelRunWindow` | parallel-run window | How long current and target run in parallel for verification. Common modern picks: no parallel run, hours, days, weeks. |

**Character counts:** all rows above land in 80-180 chars. The 120-char cap suggested in the raw-idea is too tight for "subject + 4-5 picks" pattern — common rows clock 130-170. **Recommend relaxing the cap to ~200 chars.** Final wording subject to user revision.

---

## #12 — Markdown Emit Shape per Turn Kind

**File header template** (emitted once at the top, before any turn-fragment):

```markdown
# Architect Conversation Transcript

- **Project**: {projectId}
- **Architecture**: {architectureName} (`{architectureId}`)
- **Exported**: {exportedAtIsoUtc}
- **Turn count**: {turnCount}

---

```

**Per-turn-kind emit fragments** (chronological, joined with `\n\n`):

| # | turn kind | Markdown emit template |
| --- | --- | --- |
| 1 | `open` | `## Session opened\n\n- Opened by: {openedBy}\n- Session id: \`{sessionId}\`` |
| 2 | `close` | `## Session closed\n\n- Reason: {closeReason}\n- Session id: \`{sessionId}\`\n\n{summaryMarkdown}` *(summaryMarkdown already Markdown — inline verbatim)* |
| 3 | `tech-stack-prefill-summary` | `### Tech-stack pre-fill ({bannerVariant})\n\n- Matched: {matchedCount} of {denominator}\n- Org file present: {orgFilePresent} ({orgFilePath or "—"})\n- Project file present: {projectFilePresent} ({projectFilePath or "—"})\n- Partial failures: {partialFailureCodes.join(", ") or "none"}\n- Failure reason: {failureReason or "—"}` |
| 4 | `question` | `### Q · {decisionCode} · round {roundIndex}\n\n> {promptText}` *(then if `staticContextLeadIn` present, append a second line: `\n\n_{staticContextLeadIn}_`)* |
| 5 | `answer` | `**Architect:** {answerText}` |
| 6 | `cascade-summary` | `**Cascade summary** — proposed downstream values:\n\n{for each entry: "- \`{decisionCode}\` → {String(proposedValue)}  _(source: {sourceStandardId})_"}` |
| 7 | `cascade-accepted` | `**Cascades accepted:**\n\n{for each entry: "- \`{decisionCode}\` → {String(answerValue)}"}` |
| 8 | `cascade-overridden` | `**Cascades overridden:**\n\n{for each entry: "- \`{decisionCode}\` → {String(answerValue)}  _(reason: {overrideReason})_"}` |
| 9 | `decision-captured` | `**Captured:** \`{decisionCode}\` = {String(answerValue)}  _(scope: {scope.kind}{if element: ":" + refType + ":" + refId}; id: \`{decisionId}\`{if standardsLookupRef: "; standard: " + standardsLookupRef})_` |
| 10 | `mapping-mutation-summary` | `**Mapping mutations:** {affectedMappings} mappings affected, {mappingTypeChanges} type changes, {notesDecorations} notes added.\n\n{for each tableSetSummary: "- {tableSet}: {affectedMappings}/{mappingTypeChanges}/{notesDecorations}"}` |
| 11 | `exception-pinned` | `**Exception pinned:** \`{decisionCode}\` = {String(answerValue)} _(on {scope.refType}:{scope.refId})_` |
| 12 | `edit-superseded` | `**Revision:** decision \`{originalDecisionId}\` → \`{newDecisionId}\`.  Downstream codes possibly affected: {affectedDownstreamCodes.join(", ") or "(none)"}` |
| 13 | `system-skip` | `**Skipped:** \`{decisionCode}\` — {relevanceReason}` |
| 14 | `error` | `**Error** _({errorKind})_: {errorMessage}{if recoverableHint: " — hint: " + recoverableHint}` |

**Notes on the emit shape:**

- Each fragment is a standalone Markdown block, joined with `\n\n` so blocks visually separate in any previewer.
- `String(...)` wrappers around `proposedValue` / `answerValue` are intentional — values are `unknown` on the wire and may be primitives or JSON-serialisable objects; the export does naive string-coerce. (Complex object payloads on those fields are not expected today and rendering them as `[object Object]` is acceptable for v1.)
- `{summaryMarkdown}` on the `close` turn is already a well-formed Markdown fragment (built by `buildCloseSummaryMarkdown`) — emit verbatim.
- Backticks around codes use single `` ` `` to render as inline code in Markdown.
- The header uses `# H1` once; per-turn headings use `## H2` for session lifecycle events and `### H3` for question turns and tech-stack-prefill. Other turn kinds use bold-label paragraphs (no heading) so they nest visually under the most recent `## / ###`.

**Filename pattern:**
```
architect-conversation-{slug(architectureName)}-{ISO-date}.md
```

Slug rule: lowercase, replace non-`[a-z0-9-]` with `-`, collapse repeated `-`, trim leading/trailing `-`. ISO date is `YYYY-MM-DD` from `new Date().toISOString().slice(0, 10)`.

Example: `architect-conversation-target-payments-v2-2026-05-26.md`

---

## Clarifying Questions — for user review

These cover the **real product calls** that remain after investigation. Raw-idea's 12 open questions have been refined / merged / dropped based on the investigation:

- Raw-idea Q1 (field name): resolved by raw-idea — `staticContextLeadIn`. Dropped.
- Raw-idea Q2 (wire path): resolved by raw-idea — payload-borne (option b). Dropped.
- Raw-idea Q3 (draft table): in this file. Active question below covers any revisions.
- Raw-idea Q4 (style guide): see relaxation note above. Active question below.
- Raw-idea Q5 (Markdown emit shape): in this file. Active question below covers any revisions.
- Raw-idea Q6 (filename ISO date): resolved by raw-idea — ISO. Dropped.
- Raw-idea Q7 (slug sanitization): resolved by raw-idea. Dropped.
- Raw-idea Q8 (Markdown inside UI): resolved by raw-idea — plain text. Dropped.
- Raw-idea Q9 (button visibility): resolved by raw-idea — always visible, disabled when zero turns. Dropped.
- Raw-idea Q10 (metadata header): resolved by raw-idea — yes, include `projectId` + `architectureId`. Reflected in the header template above. Dropped.
- Raw-idea Q11 (commit boundary): resolved by raw-idea — one commit. Dropped.
- Raw-idea Q12 (test cap): resolved by raw-idea — 4-5 tests. Dropped.

### Active questions

**Q1.** **Lead-in copy draft — any revisions?** The 51-row table above is the first-draft copy. Please review row-by-row. Strikethrough or rewrite any row before implementation. Particular calls to make:

- Is the "Common modern picks: X, Y, Z" pattern too repetitive across 51 rows? An alternative is to vary the trailing phrase ("Typical choices include…", "Modern options span…", "Industry-standard picks:…") — but variation may hurt scannability. **My instinct: keep the uniform phrasing — uniformity is a feature; the architect's eye gets used to skimming "after the colon" for the picks.**

**Q2.** **Char cap relaxation.** Raw-idea proposed 30-120 chars per lead-in. The draft above clocks 80-180 chars to fit "subject + 4-5 modern picks" cleanly. Should we (a) keep the 120 cap and shrink each row to ~3 picks max, or (b) relax the cap to ~200? **My instinct: (b) relax to ~200 chars. Long lead-ins do crowd the pane, but a 4-5 pick list is the whole point of the framing — clipping to 3 hides the architect's options.**

**Q3.** **Markdown emit shape — any revisions?** Table above covers all 14 turn kinds. Two specific judgement calls to confirm:

- **Heading level for `question` turns.** Currently `### Q · {code} · round {round}`. Alternatives: `#### Q.N — {code}` (one level deeper, less visual weight), or no heading at all (just a bold label like `**Q · {code}:**`). **My instinct: keep `### H3` — questions are the spine of the conversation; they should have heading weight to break up a long transcript.**
- **How to render `unknown`-typed values** (cascade `proposedValue`, captured `answerValue`). Current plan: naive `String(v)` — primitives render cleanly; complex objects render as `[object Object]`. Alternative: `JSON.stringify(v)` to surface object internals. **My instinct: naive `String(v)` for v1. Captured-decision answers are nearly always strings in practice; the tech-stack-md-prefill JSON edge case (`{value, sourceQuote, sourceFile}`) is the only known wrinkle and it's better handled by the `decision-captured` template emitting the `answerValue` raw string verbatim — which Spec 3's pipeline already produces — than by force-stringifying as JSON.**

**Q4.** **Export button placement & label.** Raw-idea said "header / toolbar area alongside Close conversation" but there is **no existing tab-level header today** — Close lives in the right-rail column, not at tab-level. **My instinct: insert a new toolbar `<div>` at the top of the tab, above the `styles.layout` grid, right-aligned. Label: "Export transcript" with the lucide `Download` icon. Style: `.secondaryButton` (matches "Retire current and start new"). Disabled when `turns.length === 0`.** Confirm or propose an alternative location.

**Q5.** **Lead-in absent on persisted older turns.** Question turns persisted before this spec ships won't have `staticContextLeadIn` on their payload. The frontend should silently render those turns without a lead-in block (no degradation banner / no placeholder). **My instinct: silent no-render when the field is null/empty.** Confirm.

**Q6.** **Lead-in field name in the gateway turn-payload — exactly `staticContextLeadIn`?** Raw-idea uses this name (verbatim, with "TBD by shape-spec" caveat). It mirrors the library entry field name exactly, which keeps the coordinator copy at line 204-209 a one-liner. **My instinct: yes, identical name end-to-end.** Confirm.

**Q7.** **Markdown rendering inside the lead-in (UI side).** Raw-idea says plain text for v1. Confirmed: the lead-in field type is `string`, rendered in a `<small>` block — no `dangerouslySetInnerHTML`, no Markdown parsing. **My instinct: plain text only — keep v1 simple.** Confirm.

**Q8.** **Newline rendering in the lead-in.** The 51-row draft has all entries on one line. If a future row has an embedded `\n`, should we (a) preserve it via `white-space: pre-wrap` on `.contextLeadIn`, or (b) collapse to a single line? **My instinct: (a) preserve via `white-space: pre-wrap` — costs nothing, future-proofs.**

**Q9.** **Export button: clipboard fallback?** Raw-idea explicitly defers "copy to clipboard" to v2. **My instinct: confirm v2 deferral — no clipboard button in this spec.** Confirm.

**Q10.** **Architecture name source.** The export filename needs the architecture's display name. `TargetArchitectureWorkspace.tsx` line 938 has `activeTarget?.name` in scope. **My instinct: thread that down as a new optional `architectureName?: string` prop on `ArchitectConversationTab`, defaulting to `selectedTargetArchitectureId` if null.** Confirm.

**Q11.** **Test cap.** Raw-idea suggests 4-5 tests: (a) lead-in renders when present, (b) lead-in absent when null, (c) export utility produces expected Markdown for a mix of turn kinds, (d) export button click triggers download, (e) export button disabled when zero turns. **My instinct: yes, 5 tests as listed. No gateway-side test for the library schema change — the existing `questionLibrary.test.ts` already asserts entries are well-formed and will catch any drift via the loader.** Confirm.

---

## Accepted Answers (2026-05-26)

User accepted all defaults. Decisions to encode in the spec:

- **Q1 Lead-in copy.** The 51-row draft table in this file is approved
  as-is. Uniform pattern "Subject. Common modern picks: X, Y, Z, A, B."
  stays. Implementer applies the table verbatim into
  `gateway/src/config/architect-conversation/questionLibrary.ts`.
- **Q2 Char cap relaxed to ~200.** Clipping to 3 picks would hide the
  architect's options. Implementer keeps the existing 80-180 char
  drafts; future contributors aim for ≤200.
- **Q3 Markdown emit shape:**
  - (a) Question heading level: `### H3 · Q · {code} · round {n}` — H3
    matches the conversation's spine.
  - (b) `unknown`-typed values rendered via `String(v)` — matches
    existing `ConversationMainPane` behaviour.
- **Q4 Export button placement & label.** New toolbar `<div>` at the
  top of `ArchitectConversationTab.tsx`, right-aligned, label "Export
  transcript", lucide `Download` icon, `.secondaryButton` styling,
  disabled when `turns.length === 0`.
- **Q5 Older question turns** without the field render silently (no
  banner, no placeholder, no muted block).
- **Q6 Field name `staticContextLeadIn` end-to-end.** Identical
  identifier on:
  - `QuestionLibraryEntry` (gateway `questionLibrary.ts`)
  - `QuestionTurn` (gateway `turnShape.ts`)
  - Frontend mirror (`architectConversationApi.ts`)
  Keeps the coordinator a one-line `staticContextLeadIn:
  entry.staticContextLeadIn` pass-through.
- **Q7 Plain-text lead-in only.** No Markdown rendering in the UI.
  Field stays a `string`.
- **Q8 Newlines preserved** via `white-space: pre-wrap` on the
  `.contextLeadIn` CSS class. Costs nothing; future-proofs against
  multi-line lead-ins.
- **Q9 Clipboard fallback deferred to v2.** Download only for v1.
- **Q10 Architecture name source.** New optional
  `architectureName?: string` prop passed down from
  `TargetArchitectureWorkspace.tsx:938` (`activeTarget?.name`); falls
  back to `selectedTargetArchitectureId` if null.
- **Q11 Test cap: 5 frontend Vitest tests:**
  1. Lead-in renders when `staticContextLeadIn` is non-empty.
  2. No muted block renders when the field is null/empty.
  3. `exportTranscript` produces expected Markdown across all 14 turn
     kinds (use a fixture covering each kind once).
  4. Export button click triggers download (mock
     `URL.createObjectURL` + spy on `<a>.click`).
  5. Export button disabled when `turns.length === 0`.
  No new gateway test — `questionLibrary.test.ts` already catches schema
  drift.

**Net effect on sizing:** Confirmed **Small-Medium**. One commit
covering:

- Library data change: 51 lead-in strings added to existing entries +
  new optional field on `QuestionLibraryEntry`.
- Gateway turn-payload field: `staticContextLeadIn?: string` on
  `QuestionTurn` + coordinator pass-through.
- Frontend type mirror + render change in `ConversationMainPane.tsx`
  (single `<small className={styles.contextLeadIn}>` above prompt when
  present).
- New `exportTranscript.ts` utility (~100-150 LOC) + Markdown emit
  shape per turn kind per the table in this file.
- Export button in `ArchitectConversationTab.tsx` (new toolbar `<div>`,
  ~30 LOC + CSS).
- CSS additions (`.contextLeadIn` muted-text + `.tabToolbar`
  right-aligned flex).
- 5 Vitest tests.

Total: ~250-350 LOC across 5-6 files + tests.

---

## Out of Scope

_(matches raw-idea — not re-litigated)_

- LLM-generated lead-in copy.
- Runtime-derived lead-ins from discovery context (`discoveryContextLead` stays untouched).
- Non-Markdown export formats (plain text, HTML, PDF).
- Selective / partial export.
- Server-side export endpoint.
- In-flight / draft turn export.
- Re-import / restore from transcript.
- Markdown rendering of the lead-in in the UI.
- A rich-text editor for editing lead-ins.
- Localisation / i18n.
- Clipboard fallback for the export.
- Email / Slack sharing.
- Linking the transcript to a decision-record artefact.
- Changes to any other turn kind's existing rendering.

---

## Visual Assets

No visual assets in scope — code-only spec. Not requested per the orchestrator instructions.

---

## Dependencies & Surprises

**Dependencies (verified):**

- `2026-05-24-target-state-architect-conversation` — shipped; provides the conversation flow, turn types, and surfaces this spec enriches.
- `2026-05-25-tech-stack-prefill-and-target-write` — shipped; introduced `tech-stack-prefill-summary` turn kind. The export shape table handles this kind.
- `2026-05-25-four-spec-hardening-pass` — shipped; the lead-in copy flows on the turn payload, not via the new `questionLibraryScopes` endpoint, so that contract stays unchanged.

**No new external deps.** `lucide-react` already provides `Download`.

**Surprises noted during investigation:**

1. **There is no tab-level toolbar/header in `ArchitectConversationTab.tsx` today.** Raw-idea's "alongside Close conversation" placement isn't possible literally — Close is inside the right-rail. The export button needs a fresh toolbar slot (see Q4).
2. **Turn-kind count is 14, not 12-13** as raw-idea estimated. The 14th is `tech-stack-prefill-summary` (already enumerated in raw-idea text but not in the count). All 14 are covered in the emit shape table above.
3. **Char cap of 120 in raw-idea is too tight** for the "subject + 4-5 picks" pattern. Recommend relaxing to ~200 (see Q2).
4. **The existing `discoveryContextLead` field is fully wired through the coordinator already** (line 200-202: prepends to `promptText` if non-null). No entries populate it, so it's silently a no-op. Staying untouched is fine; the new `staticContextLeadIn` lives on the **turn payload directly**, NOT prepended into `promptText`, so the frontend can style it separately from the prompt body.
5. **`String(unknown)` for cascade `proposedValue`** is what `ConversationMainPane.tsx` does today (line 320: `String(c.proposedValue)`). The export shape mirrors this for consistency — no risk of producing different content in the export vs. on screen.
