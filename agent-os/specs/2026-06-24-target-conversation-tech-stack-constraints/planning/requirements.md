# Spec Requirements: Target-conversation tech-stack constraints + versioned selection

> **Provenance:** All requirements below are LOCKED and sourced verbatim from
> `agent-os/planning/2026-06-24-vuln-target-state-6-spec-decisions.md` — the **"Spec 6"**
> section plus the shared **"Existing-code anchors"**, **"Cross-cutting decisions"**, and
> **"Build-safety guidance"** sections — and from
> `agent-os/specs/2026-06-24-target-conversation-tech-stack-constraints/planning/raw-idea.md`.
> No open-ended discovery was performed; the decisions doc is authoritative. This is Spec 6
> in the CVE-reduction / target-state-conversation-overhaul initiative
> (authoring/build order 1 → 2 → 6 → 3 → 4 → 5).

## Initial Description

Overhaul the target-state architect conversation so downstream choices are **constrained**
by earlier answers and framework+version selection **doesn't explode into chips**.

Deliverable: a **per-question dependency matrix** over the 51 questions in
`gateway/src/config/architect-conversation/questionLibrary.ts`, classifying each as
**hard-dependent on the foundational answer / independent / grey**. `service.language` is the
**primary brancher** (build tool + runtime refine); multiple deterministic branch-lists are
keyed on the foundational answer (e.g. Java 21 ⇒ only JVM frameworks, never FastAPI/NestJS).
Grey-area questions get a **deterministic compatibility matrix for clear-cut cases + an
LLM-judge for the grey** (code pre-filter + LLM, same pattern as vuln dedup). Filtering
strictness = **hide incompatible choices + an "Other (advanced)" escape hatch**; skip moot
questions. **Decouple the version axis from framework**: framework = constrained single-select
chips; version = its own dedicated control scoped to the chosen framework (recommended default,
free-text exact), captured as a structured `{framework, version}` and shown as ONE resolved chip.
Version source = **free-text + recommended default + optional registry/OSV enrichment
(non-blocking, same proxy/CA caveat)**. This version control is THE surface where Spec 4
vulnerability steering lives.

## Goal

Add the **constraint / filtering layer** the conversation currently lacks. Today the
`cascades` map in `questionLibrary.ts` only **seeds** downstream answers (pre-fills a proposed
value); it performs **no filtering** and does not stop an architect from picking incompatible
combinations (e.g. Java 21 + FastAPI), nor does it prevent framework×version chip explosion.
This spec:

1. Constrains downstream conversation choices by earlier (foundational) answers so incompatible
   options are never offered.
2. Stops the framework+version chip explosion by **decoupling** the version axis from the
   framework axis.
3. Produces the per-question dependency matrix that drives the filtering.
4. Provides the **version-selection surface** where Spec 4 vulnerability steering and the
   "use recommended version" action plug in, and where Spec 3 manifest auto-answer writes its
   resolved versions.

## Requirements Discussion

> Requirements were pre-decided in the locked decisions document; no clarifying-question round
> was run with the user. The Q/A below reframes the locked decisions as the resolved design
> questions for this spec.

**Q1: What is the headline deliverable?**
**Answer:** A **per-question dependency matrix** over the 51 questions (groups A–J) in
`questionLibrary.ts`, classifying each question as **hard-dependent on the foundational answer**,
**independent**, or **grey**. The independent bucket stays constant; the hard-dependent bucket
branches on the foundational answer(s); the grey bucket gets soft handling.

**Q2: What is the primary brancher?**
**Answer:** `service.language` (group A.1) is the **primary brancher** (Java/Kotlin vs Node/TS
vs Python vs Go vs C# ...). Build tool and runtime **refine** the branch. Multiple deterministic
branch-lists are keyed on the foundational answer(s). Example: Java 21 ⇒ the framework question
offers only JVM frameworks (Spring Boot / Quarkus / Micronaut), never FastAPI / NestJS.

**Q3: How are grey-area questions handled?**
**Answer:** **Deterministic compatibility matrix for clear-cut cases + LLM-judge for the grey**
— a code pre-filter handles the unambiguous classifications deterministically and an LLM judge
adjudicates only the genuinely ambiguous cases. This is the **same pattern as the vuln dedup**
(code pre-filter + LLM) used elsewhere in the initiative.

**Q4: How strict is choice filtering — hide or warn?**
**Answer:** **Hide incompatible choices** and provide an **"Other (advanced)" escape hatch** so
the user is **never trapped**. Questions that have become **moot** (given prior answers) are
**skipped** entirely.

**Q5: How is the framework+version chip explosion fixed?**
**Answer:** **Decouple the version axis from the framework axis.** Framework = a constrained
single-select (target ≤6 chips). Version = its **own dedicated control** (dropdown / typeahead
scoped to the chosen framework, with a **recommended default pre-selected** and a **free-text
exact** entry for off-list versions). The pair is captured as a structured `{framework, version}`
and the conversation shows **ONE resolved chip** (e.g. `Spring Boot 3.4.1`) — never the cartesian
product of framework × version chips.

**Q6: Where do version values come from?**
**Answer:** **Free-text + recommended default + optional registry/OSV enrichment** (Maven Central
/ npm registry / OSV). Enrichment is **non-blocking** and subject to the **same proxy/CA/egress
caveat as OSV** — it degrades gracefully when unavailable; free-text + recommended default always
work offline.

**Q7: How does this relate to the existing `cascades` map?**
**Answer:** Today's `cascades` map only **seeds** answers (pre-fills a proposed downstream value);
it does **no filtering**. This spec adds the **constraint / filtering layer** on top. Seeding and
filtering are complementary — seeding proposes a default; filtering restricts the allowable set.

**Q8: What downstream specs plug into this surface?**
**Answer:** The version-selection control is **THE surface where Spec 4 vulnerability steering
lives** (inline non-blocking nudge + "use this version" one-click), and where **Spec 3 manifest
auto-answer** writes resolved `{framework, version}` values (with `{value, sourceQuote, sourceFile}`
provenance and a "version-unknown" state when unresolved).

### Existing Code to Reference

**Similar Features / anchors identified (from the locked "Existing-code anchors" section):**

- **Question library (the subject of the deliverable):**
  `gateway/src/config/architect-conversation/questionLibrary.ts` — 51 questions, groups A–J,
  each with `code`, `group`, `orderInGroup`, `choices`, `defaultsWhenUnchanged`, a `cascades`
  seed map, and an optional `relevanceCondition` (per-tier auto-skip). Loader-time validation in
  the sibling `loadConfigs.ts`; tests in `__tests__/questionLibrary.test.ts`.
- **Existing seed map (to extend, not replace):** the `cascades` arrays inside each
  `QuestionLibraryEntry` (`CascadeEntry { decisionCode, valueByTriggerValue, sourceStandardId }`)
  — these **seed** answers today; the new constraint layer sits alongside them.
- **Existing relevance / auto-skip pattern:** `relevanceCondition` predicates
  (`onlyWhenServiceTier` / `onlyWhenUiTier` / `onlyWhenPersistenceTier`) plus the
  `RelevanceContext` tier flags — the precedent for "skip moot questions". The new layer extends
  the moot-skip concept to be answer-driven (not just tier-driven).
- **Captured decisions store:** `target_state_captured_decisions` (`answer_value TEXT`,
  append-only supersession; `{value, sourceQuote, sourceFile}` JSON envelope). Structured
  `{framework, version}` must be captured through this same envelope convention.
- **LLM-extract / prefill seam (the deterministic-sibling pattern):**
  `openTurnTechStackPrefill.ts` — LLM-extracts decision codes from a file and writes
  captured-decision rows. The grey-area LLM-judge and the Spec 3 manifest auto-answerer follow
  this proven seam.
- **Code-pre-filter-+-LLM pattern (reuse the shape):** the vuln-dedup approach (code pre-filter
  then LLM judge) is the explicit model for "deterministic matrix for clear-cut + LLM-judge for
  grey".
- **Frontend mirror / contract:** `frontend/src/api/architectConversationApi.ts` and the
  `scopeRefType.json` cross-package contract test
  (`frontend/src/api/__tests__/scopeRefType.contractWithGateway.test.ts`) — the precedent for
  gateway↔frontend shape contracts that any new structured `{framework, version}` shape should
  follow.
- **Version-registry / OSV egress (non-blocking, proxy/CA-aware):** the OSV client built in
  Spec 2 must honor `HTTP(S)_PROXY` + custom CA and be swappable; the registry-enrichment path
  here reuses the same non-blocking, proxy/CA-aware discipline.
- **Conversation close artifact:** conversation close writes `target-tech-stack-<id>.md`; the
  resolved `{framework, version}` chips feed the Migration Delivery Plan + per-story shape-spec
  generation.

### Follow-up Questions

No follow-up questions were required — the decisions doc fully specifies the spec.

## Visual Assets

### Files Provided:

No visual assets provided. (Mandatory check of
`agent-os/specs/2026-06-24-target-conversation-tech-stack-constraints/planning/visuals/`
returned no image files.)

### Visual Insights:

Not applicable.

## Requirements Summary

### Functional Requirements

**FR1 — Per-question dependency matrix (the deliverable).**
Produce a matrix over all 51 questions classifying each as **hard-dependent on the foundational
answer**, **independent**, or **grey**, at least by group A–J (and per-question where it differs
from the group). The matrix is the artifact that drives runtime filtering. Proposed
classification (LOCKED categories; per-question placement to be finalised in spec.md, examples
called out in the decisions doc):

| Group | Questions (count) | Members | Default classification |
|-------|-------------------|---------|------------------------|
| **A — Service runtime** | 6 | `service.language`, `service.framework`, `service.runtime`, `service.processModel`, `service.config`, `service.healthcheck` | **Hard-dependent** (the brancher group): `service.language` is the **primary brancher (foundational)**; `service.framework`, `service.runtime`, `service.healthcheck` hard-branch on language/runtime. `service.processModel`, `service.config` lean **grey/independent**. |
| **B — API surface** | 6 | `api.protocol`, `api.versioning`, `api.contractFormat`, `api.auth`, `api.errorContract`, `api.rateLimiting` | **Grey / mostly independent.** `api.auth`, `api.rateLimiting` are independent (auth policy / rate limiting explicitly called out as independent). `api.contractFormat` / `api.errorContract` are grey (gRPC⇒proto3, GraphQL⇒errors[]) and key off `api.protocol`, not language. |
| **C — Data persistence** | 6 | `db.engine`, `db.migrations`, `db.connectionPool`, `db.transactionStrategy`, `db.readReplicaUsage`, `db.driver` | **Hard-dependent** on `db.engine` (and language): `db.driver`, `db.migrations`, `db.connectionPool` hard-branch (drivers are language- and engine-specific — explicitly "drivers" in the hard bucket). `db.transactionStrategy`, `db.readReplicaUsage` are **independent**. |
| **D — Domain / DTO** | 4 | `dto.style`, `validation.framework`, `domain.mappingStrategy`, `domain.errorModel` | **Hard-dependent** on language: `dto.style` (Java records vs Kotlin data classes vs TS interfaces vs Pydantic) and `validation.framework` hard-branch. `domain.mappingStrategy` (MapStruct is JVM-only) is grey/hard; `domain.errorModel` is **independent**. |
| **E — Frontend** | 5 | `ui.framework`, `ui.buildTool`, `ui.testing`, `ui.stateManagement`, `ui.designSystem` | **Hard-dependent** but on the **UI-tier foundational answer** (`ui.framework`), NOT on `service.language`. `ui.buildTool`, `ui.testing`, `ui.stateManagement` branch on `ui.framework` (React⇒Vite/Vitest/RTK). Whole group already tier-gated via `onlyWhenUiTier`. |
| **F — Cross-cutting** | 5 | `logging.framework`, `logging.format`, `metrics.framework`, `tracing.framework`, `secrets.management` | **Grey.** Logging/metrics libraries are language-flavoured (SLF4J vs pino vs structlog vs zap) ⇒ grey, language-influenced. `tracing.framework` (OTel is cross-language) and `secrets.management` are **independent**. |
| **G — Infrastructure** | 5 | `build.tool`, `container.runtime`, `container.baseImage`, `ci.pipeline`, `deployment.target` | **Mixed.** `build.tool` and `container.baseImage` are **hard-dependent** on language/runtime (Gradle/Maven vs npm vs uv vs go build; base image family). `container.runtime`, `ci.pipeline`, `deployment.target` are **independent**. |
| **H — Inter-service comms** | 5 | `interservice.syncProtocol`, `interservice.asyncBus`, `interservice.messageFormat`, `interservice.discoveryMechanism`, `interservice.retryStrategy` | **Mostly independent / grey.** `interservice.messageFormat` is grey (keys off `asyncBus`). `retryStrategy` (Resilience4j is JVM) is grey. The rest are **independent**. |
| **I — Testing** | 5 | `testing.unit`, `testing.integration`, `testing.e2e`, `testing.contractTesting`, `testing.mocking` | **Hard-dependent** on language: `testing.unit` (JUnit vs Vitest vs pytest vs go test vs NUnit), `testing.integration`, `testing.mocking` hard-branch by language. `testing.e2e`, `testing.contractTesting` are **independent**. |
| **J — Cut-over** | 4 | `cutover.strategy`, `cutover.dataMigration`, `cutover.rollback`, `cutover.parallelRunWindow` | **Independent** (the canonical independent bucket — cutover strategy, rollback, parallel-run window). `cutover.dataMigration` keys off persistence tier presence only. |

> The table above is the **starting classification** to be confirmed/finalised at the
> per-question level in spec.md. The LOCKED constraint is: independent bucket (cutover, auth
> policy, rate limiting, secrets, ...) stays constant; hard-dependent (framework, libraries,
> build tool, drivers, versions) branches; grey gets soft handling.

**FR2 — `service.language` as primary brancher + deterministic branch-lists.**
`service.language` (A.1) is the foundational primary brancher. Build tool (`build.tool`) and
runtime (`service.runtime`) **refine** the branch. Implement **multiple deterministic
branch-lists** keyed on the foundational answer(s) that restrict each hard-dependent question's
`choices` to the compatible subset. Worked example (LOCKED): **Java 21 ⇒ `service.framework`
offers only JVM frameworks (Spring Boot / Quarkus / Micronaut), never FastAPI / NestJS / Gin /
ASP.NET.** Branch-lists are deterministic data (not LLM-derived) for clear-cut cases.

**FR3 — Grey-area handling = deterministic matrix + LLM-judge.**
For clear-cut compatibility, use a **deterministic compatibility matrix** (code pre-filter). For
genuinely grey questions, fall through to an **LLM-judge** that adjudicates compatibility — the
**code-pre-filter-then-LLM** pattern (same shape as vuln dedup). The LLM is invoked only on the
grey residue, never as the primary filter.

**FR4 — Hide-incompatible filtering + "Other (advanced)" escape hatch + skip moot.**
At runtime, **hide** choices that are incompatible with prior answers. Always offer an **"Other
(advanced)"** escape hatch so the user is never trapped into the constrained set. **Skip
questions that have become moot** given prior answers (extending the existing tier-gated
auto-skip to be answer-driven).

**FR5 — Decoupled framework vs version selection.**
- **Framework axis:** constrained single-select chips, target **≤6 chips**, filtered by FR2/FR3.
- **Version axis:** a **dedicated control** (dropdown / typeahead) **scoped to the chosen
  framework**, with a **recommended default pre-selected** and a **free-text exact** entry for
  off-list versions.
- **Capture:** the pair is stored as a structured **`{framework, version}`** value through the
  existing captured-decision `{value, sourceQuote, sourceFile}` envelope convention.
- **Display:** the conversation renders **ONE resolved chip** (e.g. `Spring Boot 3.4.1`) — never
  framework × version cartesian chips.

**FR6 — Version source = free-text + recommended default + optional registry/OSV enrichment.**
Version values come from (a) free-text exact, (b) a recommended default, and (c) **optional**
enrichment from a registry/OSV source (Maven Central / npm registry / OSV) for the typeahead /
dropdown list. Enrichment is **strictly non-blocking**: when the proxy/egress/CA path is
unavailable, free-text + recommended default still function and the control degrades gracefully
(quiet "enrichment unavailable" affordance, consistent with the OSV non-blocking discipline).

**FR7 — Constraint layer is additive to the existing seeding `cascades`.**
The new filtering/constraint layer is layered **on top of** the existing `cascades` seed map,
which continues to **seed** proposed downstream answers. Seeding (propose a default) and
filtering (restrict the set) coexist; neither replaces the other.

**FR8 — Integration surface for Spec 3 and Spec 4.**
The version-selection control is the designated surface where:
- **Spec 4 vulnerability steering** renders an **inline, non-blocking nudge** with the recommended
  minimum fixed version and a one-click **"use this version"** action.
- **Spec 3 manifest auto-answer** writes resolved `{framework, version}` values (with provenance;
  "version-unknown" when a manifest can't resolve the version).
This spec must expose the seam; it does not implement Spec 3/4 logic.

### Reusability Opportunities

- Extend `QuestionLibraryEntry` / the `cascades` map in `questionLibrary.ts` with the new
  constraint metadata rather than introducing a parallel structure; reuse `loadConfigs.ts`
  loader-time validation and `__tests__/questionLibrary.test.ts`.
- Model the answer-driven moot-skip on the existing `relevanceCondition` / `RelevanceContext`
  tier-gating mechanism.
- Reuse the `openTurnTechStackPrefill.ts` LLM-extract seam and `{value, sourceQuote, sourceFile}`
  envelope for the grey-area LLM-judge and for the structured `{framework, version}` capture.
- Reuse the vuln-dedup **code-pre-filter-+-LLM** shape for grey adjudication.
- Reuse the gateway↔frontend contract-test pattern (`scopeRefType.contractWithGateway.test.ts`)
  for any new shared `{framework, version}` shape between `gateway` and
  `frontend/src/api/architectConversationApi.ts`.
- Reuse the non-blocking, proxy/CA-aware OSV/registry egress discipline from Spec 2.

### Scope Boundaries

**In Scope:**
- The per-question dependency matrix (the deliverable) over all 51 questions, groups A–J.
- Deterministic branch-lists keyed on `service.language` (+ build/runtime refining).
- Grey-area handling = deterministic compatibility matrix + LLM-judge (code pre-filter + LLM).
- Hide-incompatible filtering + "Other (advanced)" escape hatch + skip-moot.
- Decoupled framework (single-select chips) vs version (dedicated scoped control), captured as
  structured `{framework, version}`, displayed as one resolved chip.
- Version source = free-text + recommended default + optional registry/OSV enrichment
  (non-blocking, proxy/CA-aware).
- Exposing the version-control seam for Spec 4 steering and Spec 3 manifest auto-answer.

**Out of Scope:**
- Spec 3 manifest upload / auto-answer logic itself (pom.xml + package.json parsing, version
  resolution) — this spec only exposes the seam.
- Spec 4 vulnerability computation / steering logic, hard-gating, "use this version" recompute —
  only the inline surface/seam is provided here.
- A runtime standards-registry lookup to replace the hardcoded seed map (noted as a future spec).
- Gradle parsing (out of scope across the whole initiative — pom.xml + package.json only).
- Any change to OSV/registry egress that makes external calls blocking — all external calls stay
  non-blocking and proxy/CA-aware.
- Replacing the existing `cascades` seeding behaviour (it is extended, not removed).

### Technical Considerations

- **Module:** primary change is in `gateway` (`src/config/architect-conversation/`), with a
  matching frontend control in `frontend/src/api/architectConversationApi.ts` and the
  conversation UI. Persisted decisions live in AMS / `target_state_captured_decisions`.
- **Wire format:** AMS defaults to snake_case wire; apply `@CamelCaseWire` only to new DTOs whose
  consumers expect camelCase. Keep any new `{framework, version}` shape consistent with the
  existing captured-decision envelope.
- **Determinism first:** deterministic matrix / branch-lists handle clear-cut cases; the LLM is
  invoked only on the grey residue (code pre-filter + LLM). No LLM call on the happy path.
- **Non-blocking enrichment:** registry/OSV enrichment must honor `HTTP(S)_PROXY` + custom CA and
  degrade gracefully; the control is fully usable offline on free-text + recommended default.
- **Chip-count budget:** framework single-select targets ≤6 chips; version never multiplies the
  chip count (one resolved chip per framework+version).
- **Build-safety (bake into every `tasks.md` for the unattended overnight `implement-tasks`):**
  - The whole-repo frontend tsc/lint baseline is **RED** — verify each feature in **ISOLATION**
    (targeted vitest/jest + scoped tsc on changed files); never gate on whole-repo green.
  - Implementer subagents have **Write (not Edit)** — use anchored/surgical Bash edits; after each
    edit run `git diff --stat`, symbol-survival greps, and a mojibake/NUL scan on touched files.
  - No silent caps/sampling — log anything dropped.
