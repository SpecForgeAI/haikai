# Specification: Target-conversation tech-stack constraints + versioned selection

## Goal
Add the constraint/filtering layer the target-state architect conversation currently lacks — today's `cascades` map only seeds proposed answers and never stops incompatible picks — and decouple version from framework so framework x version selection stops exploding into chips. This is Spec 6 of the CVE-reduction / target-state-conversation-overhaul initiative and provides the version-selection surface that Spec 4 steering and Spec 3 manifest auto-answer plug into.

## User Stories
- As an architect, I want incompatible downstream choices hidden (e.g. Java 21 never offers FastAPI/NestJS) so I cannot author an invalid target stack and moot questions are skipped.
- As an architect, I want to pick a framework as one chip and its version in a dedicated control (recommended default pre-selected, free-text exact for off-list), captured as one resolved `{framework, version}` chip instead of a cartesian grid of chips.
- As an architect, I want the version control to surface a non-blocking vulnerability nudge and a one-click "use recommended" so steering lives exactly where I choose the version.

## Specific Requirements

**FR1 — Finalized per-question dependency matrix (the deliverable)**
- Classify every one of the 51 questions as `hard-dependent` (branches on a foundational answer), `independent` (constant set), or `grey` (deterministic-matrix-then-LLM-judge); the finalized per-question table is in the **Per-Question Dependency Matrix** section below and is the authoritative artifact that drives filtering. A fourth treatment, `L` (locked / auto-answered from source), is applied to the API-surface set under API like-for-like (see FR9) and supersedes H/I/G for those questions while that mode is active.
- Each `hard-dependent` / `grey` row names its **foundational input(s)**: `service.language` (primary), `service.runtime` / `build.tool` (refiners), `db.engine`, `api.protocol`, `ui.framework`, or `interservice.asyncBus`.
- Encode the matrix as new metadata on `QuestionLibraryEntry` (alongside the existing `cascades`, not replacing it): a `dependencyClass` field plus `foundationalInputs: string[]`.
- The `independent` bucket is LOCKED constant: `cutover.*`, `api.auth`, `api.rateLimiting`, `secrets.management`, `tracing.framework`, plus the others marked independent below — never filtered.
- Extend `loadConfigs.ts` loader-time validation: `dependencyClass` is a known enum; every `foundationalInputs` code resolves to a real library entry; every `hard-dependent`/`grey` entry has at least one branch-list / matrix row covering it. Extend `__tests__/questionLibrary.test.ts`.

**FR2 — `service.language` primary brancher + deterministic branch-lists**
- `service.language` (A.1) is the foundational primary brancher; `service.runtime` (A.3) and `build.tool` (G.1) refine the branch.
- Add a deterministic, data-only `branchLists` structure keyed on foundational answer(s) that maps each `hard-dependent` question's `choices` to the compatible subset (no LLM on this path).
- Worked example (LOCKED): `Java 21` ⇒ `service.framework` offers only `Spring Boot 3.4` / `Quarkus 3` / `Micronaut 4` (Micronaut to be added to choices), never FastAPI / NestJS / Gin / ASP.NET.
- Branch-lists are pure data validated at load time; runtime filtering reads them and applies FR4 hide/skip.
- Refiner answers narrow further (e.g. language=Java + `build.tool`=Maven keeps Maven-buildable JVM frameworks); language alone is sufficient for the headline filter.

**FR3 — Grey-area handling = deterministic compatibility matrix + LLM-judge**
- Provide a deterministic compatibility matrix (code pre-filter) that resolves all clear-cut `grey` cases without an LLM call.
- Only the genuinely ambiguous residue falls through to an LLM-judge that adjudicates compatibility — the code-pre-filter-then-LLM shape, mirroring the vuln-dedup pattern.
- Reuse the `openTurnTechStackPrefill.ts` single-shot LLM seam (injectable `ArchitectLlmClient`, deps object) for the judge; never invoke the LLM on the happy path; log every grey adjudication input/output.
- The LLM-judge returns keep/hide per candidate choice; an unavailable/failed judge fails OPEN (offer the full set) so the conversation is never blocked.

**FR4 — Hide-incompatible filtering + "Other (advanced)" escape hatch + skip-moot**
- At runtime, hide choices incompatible with prior foundational answers (do not merely warn).
- Always append an `Other (advanced)` escape hatch to a filtered question so the architect is never trapped into the constrained set; selecting it accepts a free-text value outside the branch-list.
- Skip questions that have become moot given prior answers, extending the existing tier-gated `relevanceCondition` / `RelevanceContext` auto-skip to be answer-driven (e.g. `api.contractFormat` moot when no protocol implies a contract format).
- Filtering and seeding coexist: a `cascades`-seeded default must still be a member of the filtered set, else fall back to the recommended/first compatible choice.

**FR5 — Decoupled framework vs version selection**
- Framework axis = constrained single-select chips, target <= 6 chips, filtered per FR2/FR3.
- Version axis = a dedicated control (dropdown / typeahead) scoped to the chosen framework, with a recommended default pre-selected and a free-text exact entry for off-list versions; this is a new `structured` answer shape, not extra chips.
- Capture the pair as a structured `{framework, version}` value through the existing captured-decision `{value, sourceQuote, sourceFile}` envelope — `answerValue = JSON.stringify({ value: { framework, version }, sourceQuote, sourceFile })`, `answerSummary` = the resolved chip label.
- Display exactly ONE resolved chip (e.g. `Spring Boot 3.4.1`) — never framework x version cartesian chips. Applies to versioned questions: `service.language`, `service.framework`, `db.engine`, `db.driver`, `ui.framework`, `build.tool` (and other framework-bearing codes flagged `versioned` in the matrix).

**FR6 — Version source = free-text + recommended default + optional registry/OSV enrichment**
- Version list sources: (a) free-text exact, (b) a recommended default (curated per framework), (c) OPTIONAL enrichment from a registry/OSV feed (Maven Central / npm registry / OSV) for the typeahead.
- Enrichment is strictly non-blocking and reuses Spec 2's proxy/CA-aware, swappable egress discipline (honor `HTTP(S)_PROXY` + custom CA); when egress is unavailable, free-text + recommended default still work offline and the control shows a quiet "enrichment unavailable" affordance.
- Enrichment NEVER gates submission and NEVER changes the recommended default; it only augments the suggestion list.

**FR7 — Constraint layer is additive to the existing seeding `cascades`**
- Layer the new `branchLists` + compatibility matrix + `dependencyClass`/`foundationalInputs` metadata alongside the existing `CascadeEntry` arrays; `cascades` continues to seed proposed downstream values.
- Seeding (propose a default) and filtering (restrict the allowable set) are complementary; neither is removed. The hardcoded seed map stays (runtime standards-registry lookup remains a future spec).

**FR8 — Integration seam for Spec 3 (manifest auto-answer) and Spec 4 (steering)**
- The version control is the designated surface where Spec 4 renders an inline, non-blocking vulnerability nudge (recommended minimum fixed version + one-click "use this version") — expose a stable slot/prop in the control; do NOT implement Spec 4 compute here.
- Spec 3 manifest auto-answer writes resolved `{framework, version}` through the same envelope/writer, with a `version-unknown` state when a manifest cannot resolve the version — expose the writer path/shape; do NOT implement pom.xml/package.json parsing here.
- Mirror any new shared `{framework, version}` shape into `frontend/src/api/architectConversationApi.ts` and guard it with a gateway↔frontend contract test in the style of `scopeRefType.contractWithGateway.test.ts`.

**FR9 — API like-for-like locks the API surface (auto-answer from source)**
- Add a migration mode `api.surfaceMode` (`like_for_like` | `may_change`). It DEFAULTS to `like_for_like` whenever the architecture has a reconciled API Behaviour Baseline / oracle — the like-for-like / reconciliation contract forbids API deviation.
- Under `like_for_like`, the API-surface questions are NOT asked: they are auto-answered and LOCKED from the captured source contract/baseline (treatment class `L`). Locked members = the whole of Group B (`api.protocol`, `api.versioning`, `api.contractFormat`, `api.auth`, `api.errorContract`, `api.rateLimiting`), each flagged `lockableFromSource: true` in the matrix metadata.
- Locked answers are written through the captured-decision envelope with provenance pointing at the source contract/baseline, and rendered read-only ("locked — API like-for-like") rather than as editable choices.
- Under `may_change`, those questions revert to their underlying H/I/G class and are asked normally. `L` supersedes H/I/G only while `like_for_like` is active.
- The dependency-matrix metadata records BOTH a question's underlying class AND `lockableFromSource`.
- Out of scope here: computing/deriving the locked values from the baseline is a thin read of the existing source contract/oracle — wire the lock + provenance + read-only display; do not rebuild the reconciliation engine.

## Per-Question Dependency Matrix

> FINALIZED per-question classification across all 51 questions. `Class`: H = hard-dependent, I = independent, G = grey. `Foundational input` = the answer(s) the filter keys on. `Versioned` = renders the FR5 framework+version control (one resolved chip). Independent rows are never filtered.

**Group A — Service runtime (6)**

| Code | Class | Foundational input | Versioned | Notes |
|---|---|---|---|---|
| `service.language` | H (foundational/primary brancher) | — (the brancher) | yes | Drives every other A/D/I hard branch. |
| `service.framework` | H | `service.language` (+ `service.runtime` refine) | yes | Java 21 ⇒ JVM-only; add Micronaut 4 to choices. |
| `service.runtime` | H | `service.language` | yes | Node lang ⇒ only Node runtime, etc.; refines framework. |
| `service.processModel` | I | — | no | Process model independent of language. |
| `service.config` | I | — | no | Config-source policy independent. |
| `service.healthcheck` | G | `service.framework` | no | Spring Actuator only sensible under Spring Boot; else deterministic-clear, grey residue to judge. |

**Group B — API surface (6)**

| Code | Class | Foundational input | Versioned | Notes |
|---|---|---|---|---|
| `api.protocol` | I (sub-foundational for B) | — | no | Free multi-choice; seeds B branches. |
| `api.versioning` | G | `api.protocol` | no | gRPC ⇒ header-based; clear-cut deterministic, grey to judge. |
| `api.contractFormat` | H | `api.protocol` | no | gRPC⇒proto3, GraphQL⇒SDL, REST⇒OpenAPI; moot if protocol implies single format. |
| `api.auth` | I | — | no | LOCKED independent (auth policy). |
| `api.errorContract` | G | `api.protocol` | no | gRPC⇒gRPC status, GraphQL⇒errors[]; grey residue to judge. |
| `api.rateLimiting` | I | — | no | LOCKED independent (rate limiting). |

> **Under API like-for-like (FR9):** the ENTIRE Group B set is treated as `L` (locked / auto-answered from the source contract/baseline) and is NOT asked. The H/I/G classes above apply only under `api.surfaceMode = may_change`.

**Group C — Data persistence (6)**

| Code | Class | Foundational input | Versioned | Notes |
|---|---|---|---|---|
| `db.engine` | I (sub-foundational for C) | — (freely chosen; drives C) | yes | Engine choice keys the C branches; it is NOT narrowed by `service.language`. |
| `db.migrations` | H | `db.engine` | no | Mongo⇒Mongock; SQL⇒Flyway/Liquibase. |
| `db.connectionPool` | H | `db.engine` (+ `service.language`) | no | HikariCP JVM-only; Mongo⇒native pool. |
| `db.transactionStrategy` | I | — | no | LOCKED independent. |
| `db.readReplicaUsage` | I | — | no | LOCKED independent. |
| `db.driver` | H | `db.engine` + `service.language` | yes | Drivers are engine- AND language-specific (LOCKED hard). |

**Group D — Domain / DTO (4)**

| Code | Class | Foundational input | Versioned | Notes |
|---|---|---|---|---|
| `dto.style` | H | `service.language` | no | Java records vs Kotlin data classes vs TS interfaces vs Pydantic. |
| `validation.framework` | H | `service.language` (+ `service.framework`) | no | Bean Validation vs class-validator vs Pydantic v2. |
| `domain.mappingStrategy` | G | `service.language` | no | MapStruct/ModelMapper JVM-only ⇒ grey/hard; non-JVM ⇒ manual/direct. |
| `domain.errorModel` | I | — | no | LOCKED independent. |

**Group E — Frontend (5, tier-gated `onlyWhenUiTier`)**

| Code | Class | Foundational input | Versioned | Notes |
|---|---|---|---|---|
| `ui.framework` | I (foundational for E) | — (freely chosen; drives all of E) | yes | Freely-chosen UI-tier brancher; not narrowed by an earlier answer. |
| `ui.buildTool` | H | `ui.framework` | no | React/Vue⇒Vite, Angular⇒Angular CLI. |
| `ui.testing` | H | `ui.framework` | no | React⇒Vitest+RTL, Angular⇒Karma. |
| `ui.stateManagement` | H | `ui.framework` | no | React⇒Redux Toolkit, Vue⇒Pinia, Angular⇒NgRx. |
| `ui.designSystem` | G | `ui.framework` | no | MUI/Chakra React-leaning; mostly cross-framework ⇒ grey residue to judge. |

**Group F — Cross-cutting (5)**

| Code | Class | Foundational input | Versioned | Notes |
|---|---|---|---|---|
| `logging.framework` | G | `service.language` | no | SLF4J vs pino vs structlog vs zap — language-flavoured grey. |
| `logging.format` | I | — | no | JSON/key=value/plain independent. |
| `metrics.framework` | G | `service.language` | no | Micrometer JVM, prom-client Node; OTel cross-language ⇒ grey. |
| `tracing.framework` | I | — | no | OTel cross-language; LOCKED independent. |
| `secrets.management` | I | — | no | LOCKED independent. |

**Group G — Infrastructure (5)**

| Code | Class | Foundational input | Versioned | Notes |
|---|---|---|---|---|
| `build.tool` | H (refiner of A) | `service.language` | yes | Gradle/Maven vs npm vs uv vs go build vs dotnet. |
| `container.runtime` | I | — | no | LOCKED independent. |
| `container.baseImage` | H | `service.runtime` (+ `service.language`) | no | Base-image family follows runtime (temurin/node/python/distroless). |
| `ci.pipeline` | I | — | no | LOCKED independent. |
| `deployment.target` | I | — | no | LOCKED independent. |

**Group H — Inter-service comms (5, tier-gated `onlyWhenServiceTier`)**

| Code | Class | Foundational input | Versioned | Notes |
|---|---|---|---|---|
| `interservice.syncProtocol` | I | — | no | Independent. |
| `interservice.asyncBus` | I (sub-foundational for H) | — | no | Bus choice seeds messageFormat branch. |
| `interservice.messageFormat` | G | `interservice.asyncBus` | no | Kafka⇒Avro+Registry, SQS⇒plain JSON; grey residue to judge. |
| `interservice.discoveryMechanism` | I | — | no | Independent. |
| `interservice.retryStrategy` | G | `service.language` | no | Resilience4j JVM-only ⇒ grey; others cross-language. |

**Group I — Testing (5)**

| Code | Class | Foundational input | Versioned | Notes |
|---|---|---|---|---|
| `testing.unit` | H | `service.language` | no | JUnit vs Vitest vs pytest vs go test vs NUnit. |
| `testing.integration` | H | `service.language` (+ `service.framework`) | no | Spring Boot Test vs Quarkus Test vs Vitest+TC vs pytest+TC. |
| `testing.e2e` | I | — | no | LOCKED independent (Playwright/Cypress cross-language). |
| `testing.contractTesting` | I | — | no | LOCKED independent. |
| `testing.mocking` | H | `service.language` | no | Mockito vs MockK vs vi.mock vs pytest-mock vs gomock. |

**Group J — Cut-over (4) — the canonical independent bucket**

| Code | Class | Foundational input | Versioned | Notes |
|---|---|---|---|---|
| `cutover.strategy` | I | — | no | LOCKED independent. |
| `cutover.dataMigration` | I | — | no | Keys off persistence-tier presence only (existing tier-gate). |
| `cutover.rollback` | I | — | no | LOCKED independent. |
| `cutover.parallelRunWindow` | I | — | no | LOCKED independent. |

> Tally: 15 hard-dependent, 9 grey, 27 independent (= 51) — `db.engine` and `ui.framework` are freely-chosen branchers (Independent), not narrowed by an earlier answer. Separately, under API like-for-like (FR9) the entire Group B set is treated as `L` (locked / auto-answered from the source contract) and not asked. Versioned codes: `service.language`, `service.framework`, `service.runtime`, `db.engine`, `db.driver`, `ui.framework`, `build.tool`.

## Visual Design
No visual assets were provided (`planning/visuals/` contains no image files). The one-resolved-chip rendering and the dedicated version control (recommended default pre-selected + free-text exact + non-blocking enrichment affordance + Spec 4 nudge slot) are specified in FR5/FR6/FR8.

## Existing Code to Leverage

**`gateway/src/config/architect-conversation/questionLibrary.ts` (`QuestionLibraryEntry`, `CascadeEntry`)**
- The 51-entry library and per-entry `cascades` seed map are the subject of the deliverable; extend the entry type with `dependencyClass` / `foundationalInputs` / `branchLists` / `versioned` rather than a parallel structure.
- `cascades` (`{ decisionCode, valueByTriggerValue, sourceStandardId }`) keeps seeding; the new constraint metadata sits beside it.

**`gateway/src/config/architect-conversation/loadConfigs.ts` + `__tests__/questionLibrary.test.ts`**
- `validateQuestionLibrary` already resolves cascade `decisionCode`s and validates closed sets at load time; add the new validations (known `dependencyClass`, resolvable `foundationalInputs`, branch-list coverage) into the same structured-error path that throws at startup.

**`gateway/src/services/architectConversation/openTurnTechStackPrefill.ts`**
- The injectable single-shot LLM seam (deps object + `ArchitectLlmClient`) and the `answerValue = JSON.stringify({ value, sourceQuote, sourceFile })` envelope (with `answerSummary`) are the exact pattern to reuse for the grey LLM-judge and the structured `{framework, version}` capture/writer.

**`frontend/src/api/architectConversationApi.ts` + `__tests__/scopeRefType.contractWithGateway.test.ts`**
- The gateway-derived / frontend-mirrored shape contract (turn types, `ScopeRefType`) is the precedent for the new `{framework, version}` shape; add the matching frontend types + a contract test in the same style.

**Spec 2 OSV/registry egress (proxy/CA-aware, swappable, non-blocking)**
- Reuse the same `HTTP(S)_PROXY` + custom-CA, swappable, fail-open egress discipline for the optional version-registry enrichment; the control is fully usable offline on free-text + recommended default.

## Out of Scope
- Spec 3 manifest upload / auto-answer logic (pom.xml + package.json parsing, Maven parent/BOM version resolution) — only the writer seam + `version-unknown` state are exposed here.
- Spec 4 vulnerability computation / steering logic, critical hard-gating, and "use this version" recompute — only the inline non-blocking nudge slot is exposed here.
- Any blocking external call: all registry/OSV enrichment stays non-blocking and proxy/CA-aware.
- Replacing the existing `cascades` seeding behaviour (it is extended, never removed).
- A runtime standards-registry lookup to replace the hardcoded seed map (future spec).
- Gradle parsing (out of scope across the whole initiative — pom.xml + package.json only).
- Conversation-close artifact format changes beyond carrying the resolved `{framework, version}` chips into `target-tech-stack-<id>.md`.

## Build-safety (bake into `tasks.md`)
- Whole-repo frontend tsc/lint baseline is RED — verify each feature in ISOLATION (targeted vitest/jest + scoped tsc on changed files); never gate on whole-repo green.
- Implementer subagents have Write (not Edit) — use anchored/surgical Bash edits; after each edit run `git diff --stat`, symbol-survival greps, and a mojibake/NUL scan on touched files.
- AMS DTOs default to snake_case wire; apply `@CamelCaseWire` only for new camelCase consumers; keep `{framework, version}` consistent with the existing captured-decision envelope.
- No silent caps/sampling — log every dropped/hidden choice and every grey LLM-judge adjudication.
