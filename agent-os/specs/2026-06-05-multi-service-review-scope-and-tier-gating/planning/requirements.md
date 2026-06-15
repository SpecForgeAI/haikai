# Spec Requirements: Multi-Service Review Scope + Tier-Gating (Spec ⑤)

> **SPLIT 2026-06-05 — DO NOT BUILD FROM THIS FOLDER.** Per the user's decision
> this combined idea is split into TWO specs:
> - **Half A — Per-service scan selection** → `agent-os/specs/2026-06-05-per-service-scan-selection/`
>   (shaping FINALISED; built first).
> - **Half B — Architect tier-gating** → SHAPED at
>   `2026-06-05-architect-tier-gating/` (all decisions resolved 2026-06-05:
>   in-session-only tier confirmation; A/B/D/H = Service, C = Persistence, E = UI,
>   F/G/I/J = Generic; `hasUiScreens` folded into `hasUiTier`).
>
> This folder is retained ONLY as the shared investigation + the Half B grounding
> until Half B is shaped. The pure `deriveServiceTier` helper is shared by both.

## Initial Description

Two related improvements that both hinge on modelling the discovered SERVICES and
their TIERS (UI / Service / Persistence). Fixes original triage points 6 and 7.

- **Half A (point 7) — Per-service scan selection (Discovery Review Room):** the
  Review Room scan picker currently allows MAX 1 code scan + 1 database scan
  (hardcoded). That is wrong — a UI + a Service + a DB scan = 2 code + 1 DB is
  legitimate. Replace the single "Code scan" + single "Database scan" pickers
  with ONE picker PER scanned SERVICE (e.g. "MyApp UI", "MyApp API", "MyApp
  Sybase Database"); if a service was scanned twice, the user picks which run for
  THAT service.
- **Half B (point 6) — Tier-gating the target-state Architect conversation:** the
  conversation currently asks ALL questions (including UI: `ui.framework`,
  `ui.buildTool`, …) even when there is no UI. Only Group E (Frontend) is
  relevance-gated. The user wants: questions grouped by TIER (generic / UI-only /
  service-only / DB-only); a START-of-conversation CONFIRMATION ("I see these
  scans involve Service Tier and Persistence Tier only — is that correct?"); then
  only the applicable groups are asked.

User INTENT is locked: per-service scan selection; tier-grouped questions; a
start-of-conversation tier confirmation. This document grounds the OPEN design
questions in real code and surfaces the genuinely-undecided ones.

---

## Lead Findings (these frame everything else)

### Finding 0 — ONE spec or TWO? Recommendation: **TWO specs, sequenced (A then B), with a tiny shared tier-derivation helper.**

Half A lives in the **Discovery Review Room** (current-state review surface,
`frontend/src/components/Discovery/DiscoveryReviewRoom.tsx` + the gateway
`discoveryReviewConversation/*` stack). Half B lives in the **target-state
Architect conversation** (a completely different surface:
`frontend/src/components/targetState/architectConversation/*` + the gateway
`architectConversation/*` stack + `config/architect-conversation/questionLibrary.ts`).
They share NO code files. They are joined ONLY by the concept "services have
tiers (UI / Service / Persistence)".

The pivotal question the brief asked me to assess: **does the tier signal
genuinely FLOW from Half A's selection into Half B?** The code says **no — not
without inventing a new cross-surface channel that does not exist today, and that
the user has not asked for:**

- Half A's selection (the chosen runs) is recorded on the Review Room's `open`
  turn as a `SelectedScanPair` in the **discovery-review thread**
  (`discoveryReviewConversationStore.ts`). It is current-state, run-scoped, and
  ephemeral to that review session.
- Half B opens against a **target architecture** (`targetArchitectureId`) and
  derives its context from the **persisted meta-model** (services + app_components
  + tech_type), NOT from any discovery-review thread. There is no read path today
  from the architect conversation into a discovery-review thread, and building one
  would be a net-new coupling.
- Critically, BOTH halves can derive "which tiers are in play" **independently
  from the same source of truth** — the meta-model's `services[].app_component_id
  → app_components[].tech_type` (see Finding 1). Half A derives it from the
  SELECTED runs' services; Half B derives it from the TARGET architecture's
  components. They do not need to talk to each other; they need the SAME small
  derivation helper.

This mirrors the earlier reject-cascade/agenda split the user already lived
through (recorded in MEMORY): two improvements bundled under one banner concept,
but cleanly separable by surface. Splitting keeps each spec shippable and
reviewable on its own surface, and avoids a fake "tier handoff" coupling.

**Recommended shape:** two specs that share ONE tiny pure helper
`deriveServiceTier(service, appComponentsById)` (run/service → `'UI' | 'Service'
| 'Persistence' | 'Unknown'`). Spec A (Half A) is the natural first build (it is
self-contained UI + gateway-shape work and unblocks reviewing multi-service
scans now); Spec B (Half B) follows. They can alternatively be built in either
order since neither depends on the other's runtime output. The brief notes the
user's INTENT is locked across both — so if the user prefers to TRACK them as one
spec folder for intent cohesion, that is fine; the recommendation is about
**build/delivery separation**, not about re-litigating intent. **This is the #1
thing to confirm with the user (Q1).**

### Finding 1 — The run → service → tier BRIDGE (resolved, with file:line)

The tier chain is a **two-hop meta-model traversal**, both hops nullable:

1. **run → service.** `DiscoveryRunDto.service_id`
   (`frontend/src/api/discoveryApi.ts:151`; AMS column
   `architecture-model-service/.../model/entity/DiscoveryRunEntity.java:105`
   `@Column(name="service_id")`). Nullable since Liquibase 126 (ON DELETE SET
   NULL → "orphan runs"). The FK resolves to a **`service` entity**, NOT directly
   to an application_component.
2. **service → app_component.** `ServiceDto.appComponentId`
   (`architecture-model-service/.../model/dto/entity/ServiceDto.java:29-30`,
   `@JsonProperty("app_component_id")`). Nullable.
3. **app_component → tier.** `ApplicationComponentDto.techType`
   (`architecture-model-service/.../model/dto/entity/ApplicationComponentDto.java:30-31`,
   `@JsonProperty("tech_type")`, a String). Values: `'UI Tier' | 'Service Tier'
   | 'Persistence Tier' | 'Other'` (frontend mirror: `TechType` in
   `frontend/src/types/model.ts:270`). Defaults to `'Other'` when unset.

**Is there an endpoint to FETCH app_components (with tech_type) for an
architecture?** Yes — but only via the **full-model GET**, not a dedicated
component-list endpoint:

- `GET /api/model/projects/{projectId}/architectures/{architectureId}` →
  `ArchitectureModelDto` (`ModelController.loadModelForArchitecture`,
  `architecture-model-service/.../controller/ModelController.java:81`). The DTO
  is `{ metaModel: { entities: { services[], app_components[], … } }, diagrams }`
  (`ArchitectureModelDto.java`, `MetaModelDto.java`,
  `MetaModelEntitiesDto.java:21-28` — `app_components` →
  `List<ApplicationComponentDto>`, `services` → `List<ServiceDto>`). This single
  fetch carries **both** hops' data (services with `app_component_id` +
  app_components with `tech_type`).
- The **only** per-component AMS endpoint is `GET
  /api/model/.../entities/app_components/{appComponentId}`
  (`ModelEntityController.java:145`, `getAppComponent`) — a by-id getter, not a
  list-all. There is **no** "list all app_components for an architecture"
  endpoint, and **no** gateway proxy that fetches components/tech_type today
  (grep for `tech_type`/`application-components` in `gateway/src` returns only
  cascade test fixtures, not a live fetch path).
- The frontend AppShell ALREADY loads the full model per (project, architecture)
  and caches it (MEMORY: "AppShell holds a per-(project,architecture) in-memory
  model cache"), so Half B's tier signal can be derived **client-side** from the
  already-loaded model with NO new backend endpoint. Half A is already on the
  Discovery surface where the model is in scope too.

**Can tier be inferred from `discovery_kind` instead?** Partially, and lossily.
`discovery_kind` is `'code' | 'database' | 'combined'`
(`discoveryApi.ts:159`). `database` → Persistence Tier is reliable. But `code`
is **ambiguous** — a code scan of a UI repo and a code scan of a backend service
are BOTH `discovery_kind: 'code'`; `discovery_kind` cannot distinguish UI Tier
from Service Tier. So `discovery_kind` is a usable FALLBACK (esp. for orphan runs
with no `service_id`), but the **authoritative** tier source is
`app_component.tech_type`. Recommendation: derive from `tech_type` when the
chain resolves; fall back to `discovery_kind` heuristic (database→Persistence,
code→Service-or-Unknown) for orphan/unresolved runs.

### Finding 2 — "Tier" is a DANGEROUSLY overloaded word in this codebase

There are TWO unrelated "tier" concepts and the spec MUST disambiguate in all
prose + identifiers:

- **V3 discovery confidence tier** = `'A' | 'B' | 'C'`, on
  `DiscoveryRunDto.tier` (`discoveryApi.ts:140`) and computed by
  `computeTierFromResolvedColumns(...)` (`discovery-service/src/routes/runs.ts:360`).
  This is the pack-confidence ladder (pack-supervised / language-only / llm-solo).
  **NOT** what this spec means.
- **Architectural technology tier** = `'UI Tier' | 'Service Tier' | 'Persistence
  Tier' | 'Other'`, on `ApplicationComponentDto.tech_type` / `TechType`. **THIS**
  is the spec's "tier".

Recommendation: in this spec, always say "**technology tier**" or name the
literal ("UI Tier"), and name any new field/flag unambiguously (e.g.
`hasUiTier` / `hasServiceTier` / `hasPersistenceTier`, NOT bare `tierA`-style).

---

## Half A — Per-service scan selection (grounded)

**Current state (verified):**
- `DiscoveryReviewRoom.tsx` holds `selectedCodeRunId` + `selectedDbRunId`, each
  strictly 0-or-1 (lines 148-153). Two radio `<fieldset>`s — "Code scan" and
  "Database scan" — each with a "None" option (lines 656-712). Help text: "Pick
  up to one code scan and up to one database scan" (line 640-645).
- The selected pair is assembled in `handleBegin` (lines 244-301) into a
  `SelectedScanPairWire` and posted via `startReview({ … scanPair })`. The PRIMARY
  run keys the thread; the optional SECOND run (the OTHER kind) is recorded
  in-session only.
- Runs are grouped purely by `discovery_kind` into `codeRuns` / `dbRuns`
  (lines 202-209). There is NO grouping by service today.
- `runLabel(run)` (lines 86-90) = `"<8-char id>… · <status>"` — there is **no
  human service name** on the label because there is no name field on
  `DiscoveryRunDto`. The room comment at line 86 explicitly notes "no name field
  exists on the DTO".

**The shape that must change (verified):**
`SelectedScanPair` (`gateway/.../reviewTurnShape.ts:64-73`) is hardcoded to TWO
runs (`primaryRunId`/`primaryScanKind`/`secondRunId`/`secondScanKind`) and
ASSUMES `primaryScanKind !== secondScanKind` (one code XOR one DB). This is the
exact 1-code-1-DB constraint Half A removes. It is consumed by:
- `DiscoveryReviewRoom.tsx` (`handleBegin`, `refetchCounts` which passes
  `primaryRunId` + `secondRunId` to `getReviewModelCounts`).
- The Review Room's `open`-turn renderer (lines 772-779: "code + database scans"
  vs "<kind> scan").
- `getReviewModelCounts(projectId, architectureId, primaryRunId, secondRunId)` —
  a two-run-max count API.

**The backbone ALREADY supports N runs (verified — important):**
`buildReviewModel(runs: readonly ScanRunInput[])`
(`discovery-service/.../reviewModel/buildReviewModel.ts:372`) takes an **array**
of runs and unions them (node-set, survivor index, relationship edges, findings)
across ALL of them; `scan_selection: runs.map(...)` (line 438). The cross-scan
logical↔physical pass (`computeCrossScanEdges`) takes the same `runs` array. So
the deterministic review-model union is **already N-run-capable**; the
constraint is ENTIRELY in (a) the `SelectedScanPair` 2-run wire shape and (b) the
review-model COUNTS API + the gateway `startReview`/`/answer`/`/capture`/`/confirm`
plumbing that currently passes `primaryRunId` (+ optional `secondRunId`). This
makes Half A primarily a **wire-shape + UI** change, not a backbone rewrite.

**Open questions for Half A (grounded → recommended default):**

1. **Service identity + grouping + display name.** Group runs by
   `DiscoveryRunDto.service_id`. The DISPLAY name is the crux: there is NO
   `service_name` on the run DTO. The only name source on the run itself is the
   **`serviceIdentitySnapshot`** stored at run-create
   (`discovery-service/src/routes/runs.ts:369-376`). **Wire-shape mismatch found:**
   the snapshot is WRITTEN camelCase (`serviceName`, `serviceId`, `serviceType`,
   …) into AMS as a `Map<String,Object>` stored verbatim, but the frontend
   `ServiceIdentitySnapshot` type (`discoveryApi.ts:120-127`) declares snake_case
   (`service_name`, `service_id`, …). The spec must reconcile this (read the
   camelCase keys, or normalize) to surface the service name. Alternatively, since
   the meta-model is already loaded, resolve `service_id → services[].name` from
   the model for live (non-orphan) runs and fall back to
   `serviceIdentitySnapshot.serviceName` for orphan runs. **Recommended default:**
   group by `service_id`; display name = `services[].name` from the loaded model
   when resolvable, else the snapshot's `serviceName`, else a short run-id label
   (today's `runLabel`). Orphan runs (NULL `service_id`) group under a synthetic
   "Unassigned scans" bucket keyed by run id, labeled from the snapshot when
   present.

2. **One-pick-per-service cardinality + the new selection shape.** The new shape
   replaces `SelectedScanPair`'s primary/second with a **list of chosen run ids
   (1 per service the user includes)**. Recommended: allow **0-or-1 per service**
   (a service may be skipped), require **≥1 run selected overall** to Begin (mirrors
   today's `disabled={!selectedCodeRunId && !selectedDbRunId}` at line 726). New
   wire shape (proposed): `SelectedScanSet { runs: Array<{ runId: string;
   scanKind: 'code' | 'database'; serviceId: string | null }>; primaryRunId:
   string }` where `primaryRunId` (still keys the thread) is the first chosen run
   in a deterministic order (e.g. first code run, else first run). Keep
   `primaryRunId` so the thread-keying + existing `runId`-keyed routes
   (`startReview`, `/answer`, `/capture`, `/confirm`,
   `loadReviewConversation`) stay stable — the SET rides alongside, the way
   `secondRunId` does today. **Recommended default:** 0-or-1 per service; ≥1
   overall; `SelectedScanSet` with a retained `primaryRunId` thread key.

3. **Counts API for N runs.** `getReviewModelCounts(...primaryRunId,
   secondRunId)` is 2-run. It must accept N run ids (the review-model endpoint
   already unions N via `buildReviewModel`; the COUNTS proxy + its query params
   need widening from a single optional `secondRunId` to a run-id list).
   **Recommended default:** widen the counts API + the gateway review routes to
   carry the full selected run-id set (query param list or body), preserving
   `primaryRunId` as the thread key.

---

## Half B — Tier-gating the Architect conversation (grounded)

**Current state (verified):**
- `RelevanceContext` (`questionLibrary.ts:111-114`) has EXACTLY ONE field:
  `hasUiScreens: boolean`. No tier fields.
- The ONLY gated group is **E (Frontend)** via `relevanceCondition:
  onlyWhenUiPresent` (`questionLibrary.ts:174` → `ctx.hasUiScreens === true`),
  applied to all five Group E entries (`ui.framework`, `ui.buildTool`,
  `ui.testing`, `ui.stateManagement`, `ui.designSystem`; lines 825/840/860/882/904).
  Every other group is asked unconditionally.
- `evaluateRelevance` (`relevanceEvaluator.ts:66-87`) is pure; an absent predicate
  ⇒ always relevant; a false predicate ⇒ `{ relevant: false, reason }` →
  orchestrator writes a `not_applicable` captured-decision + a `system-skip` turn.
- `selectNextQuestion` (`questionSequencer.ts`) consults
  `entry.relevanceCondition(ctx)` to skip.
- The route builds `RelevanceContext` from a query param / body field, NEVER from
  the model: `next-question` reads `?hasUiScreens` defaulting true
  (`architectConversation.ts:485, 501-504`); `open` reads
  `body.relevanceContext?.hasUiScreens` defaulting **true**
  (`architectConversation.ts:636-642`).
- **The frontend never sends it.** `ArchitectConversationTab.tsx:309` calls
  `openConversation(projectId, targetArchitectureId, { openedBy })` with **no**
  `relevanceContext`. So today `hasUiScreens` is ALWAYS true → **Group E (UI)
  questions are ALWAYS asked**, exactly the bug Half B fixes. There is **no
  pre-confirmation turn** today; app_components are never fetched at open.

**The full A-J question taxonomy (verified — every code), for tier tagging:**

| Group | Theme | Codes | Proposed technology tier |
|---|---|---|---|
| A | Service runtime | service.language, service.framework, service.runtime, service.processModel, service.config, service.healthcheck | **Service** |
| B | API surface | api.protocol, api.versioning, api.contractFormat, api.auth, api.errorContract, api.rateLimiting | **Service** |
| C | Data persistence | db.engine, db.migrations, db.connectionPool, db.transactionStrategy, db.readReplicaUsage, db.driver | **Persistence** |
| D | Domain / DTO | dto.style, validation.framework, domain.mappingStrategy, domain.errorModel | **Service** (domain/DTO live in the service tier) |
| E | Frontend | ui.framework, ui.buildTool, ui.testing, ui.stateManagement, ui.designSystem | **UI** (already gated) |
| F | Cross-cutting | logging.framework, logging.format, metrics.framework, tracing.framework, secrets.management | **Generic** (applies to any tier present) |
| G | Infrastructure | build.tool, container.runtime, container.baseImage, ci.pipeline, deployment.target | **Generic** |
| H | Inter-service comms | interservice.syncProtocol, interservice.asyncBus, interservice.messageFormat, interservice.discoveryMechanism, interservice.retryStrategy | **Service** (debatable — see Q below) |
| I | Testing | testing.unit, testing.integration, testing.e2e, testing.contractTesting, testing.mocking | **Generic** |
| J | Cut-over | cutover.strategy, cutover.dataMigration, cutover.rollback, cutover.parallelRunWindow | **Generic** |

**Open questions for Half B (grounded → recommended default):**

4. **Tier→group classification (the debatable ones).** A/B/C/E map cleanly
   (Service/Service/Persistence/UI). The genuinely-undecided ones:
   - **D (Domain/DTO):** recommended **Service** (DTO style, validation, domain
     mapping are backend concerns), but a UI-only migration arguably has DTOs too.
   - **H (Inter-service comms):** recommended **Service**, BUT only relevant when
     there is MORE THAN ONE service tier participant; for a single-service
     migration these may be moot regardless of tier. Could be Generic-but-
     service-gated.
   - **F/G/I/J:** recommended **Generic** (always asked if ANY tier is present) —
     logging/build/testing/cut-over apply to every migration.
   **Recommended default:** A/B/D/H = Service, C = Persistence, E = UI, F/G/I/J =
   Generic. Generic groups are asked whenever ≥1 tier is in play (i.e. always for
   a non-empty migration). A group is SKIPPED only when its tier is confirmed
   ABSENT.

5. **`RelevanceContext` extension + predicate shape.** Add `hasUiTier` /
   `hasServiceTier` / `hasPersistenceTier: boolean` to `RelevanceContext`
   (keeping `hasUiScreens` as a back-compat alias of `hasUiTier`, or folding
   `hasUiScreens` INTO `hasUiTier`). Each non-generic group gets a
   `relevanceCondition` reading its tier flag (Group E's `onlyWhenUiPresent`
   becomes `onlyWhenUiTier`). **Recommended default:** extend `RelevanceContext`
   with the three tier booleans; fold `hasUiScreens` into `hasUiTier` (Group E
   keeps working unchanged in behaviour); add `onlyWhenServiceTier` /
   `onlyWhenPersistenceTier` predicates and tag groups A/B/C/D/H accordingly;
   leave F/G/I/J ungated (generic).

6. **How the tier set reaches the conversation + the confirmation turn.** Derive
   tiers from the **already-loaded target-architecture meta-model**
   (`services[].app_component_id → app_components[].tech_type`) — NO new endpoint
   (Finding 1). Compute the set of distinct tech tiers present, then:
   - At conversation OPEN, surface a **tier-confirmation turn** ("I see this
     migration involves Service Tier and Persistence Tier — is that right?") with
     confirm / adjust controls, BEFORE the first question. This is a NEW opening
     turn kind in the architect-conversation turn union + a new coordinator step.
   - The confirmed tier set becomes the `RelevanceContext` tier flags the
     sequencer gates on. Today `open` already accepts `body.relevanceContext`
     (`architectConversation.ts:636`) and the frontend simply doesn't send it —
     so the channel half-exists; Half B (a) derives the default tier set
     client-side from the model, (b) sends it on `open`, (c) lets the user adjust
     it via the confirmation turn, (d) threads the adjusted set into every
     `next-question` call (which today only carries `hasUiScreens`).
   **Recommended default:** client-side derivation from the loaded model →
   default tier set → confirmation turn at open → user-adjustable → flows into
   `RelevanceContext` for all subsequent `next-question`/`open` relevance gating.
   **Open sub-question:** does the confirmation turn WRITE anything durable (a
   captured-decision recording the in-scope tiers), or is it purely an in-session
   gate? Recommended: in-session gate only (no new durable decision row) for v1,
   matching how `hasUiScreens` is ephemeral today.

---

## The connection (validated)

Both halves derive "which technology tiers are in play" from the SAME meta-model
chain (`service.app_component_id → app_component.tech_type`), but from DIFFERENT
inputs on DIFFERENT surfaces (Half A: the selected current-state runs' services;
Half B: the target architecture's components) and they do NOT exchange a runtime
signal. The shared, reusable unit is a small pure `deriveServiceTier` helper, not
a data handoff. This is the basis for the **two-specs** recommendation in
Finding 0.

---

## Existing Code to Reference (for the spec-writer)

**Half A surface:**
- `frontend/src/components/Discovery/DiscoveryReviewRoom.tsx` — the scan-selection
  opener (`ScanSelection`, lines 624-733), `handleBegin` (244-301), `runLabel`
  (86-90), the counts refetch (223-239).
- `frontend/src/components/Discovery/DiscoveryRunDetailView.tsx` — renders the
  Review Room (passes `runId`/`runDiscoveryKind`).
- `gateway/src/services/discoveryReviewConversation/reviewTurnShape.ts` —
  `SelectedScanPair` (64-73) + `OpenTurn` (131-137).
- `gateway/src/routes/discoveryReviewConversation.ts` — `startReview` /
  `/answer` / `/capture` / `/confirm` routes (the run-id-keyed plumbing).
- `discovery-service/src/services/reviewModel/buildReviewModel.ts` — the
  ALREADY-N-run union (`buildReviewModel(runs[])`, line 372).
- `frontend/src/api/discoveryApi.ts` — `DiscoveryRunDto` (129-180),
  `ServiceIdentitySnapshot` (120-127, the snake_case-vs-camelCase mismatch).
- `discovery-service/src/routes/runs.ts:323-376` — the camelCase
  `serviceIdentitySnapshot` write.

**Half B surface:**
- `gateway/src/config/architect-conversation/questionLibrary.ts` —
  `RelevanceContext` (111-114), `onlyWhenUiPresent` (174), all A-J entries.
- `gateway/src/services/architectConversation/relevanceEvaluator.ts`,
  `questionSequencer.ts`, `architectConversationCoordinator.ts`.
- `gateway/src/routes/architectConversation.ts` — `open` (621+, RelevanceContext
  build 636-642) and `next-question` (481+, 501-504).
- `frontend/src/components/targetState/architectConversation/ArchitectConversationTab.tsx`
  — `handleStartConversation` (306-331; the open call that omits
  `relevanceContext`).
- `frontend/src/api/architectConversationApi.ts` — `openConversation` (510+),
  `next-question` client (461+).
- The architect-conversation TURN UNION (`turnShape.ts` in the same gateway
  folder) — where the new tier-confirmation turn kind hooks in (parallels the
  Review Room's `open`-turn pattern in `reviewTurnShape.ts`).

**The bridge / shared:**
- AMS: `ModelController.loadModelForArchitecture`
  (`controller/ModelController.java:81`) → `ArchitectureModelDto` →
  `MetaModelDto` → `MetaModelEntitiesDto` (`app_components` line 24-25, `services`
  27-28). `ServiceDto.app_component_id` (`entity/ServiceDto.java:29-30`),
  `ApplicationComponentDto.tech_type` (`entity/ApplicationComponentDto.java:30-31`).
- `frontend/src/types/model.ts` — `TechType` (260-281), `ApplicationComponent`
  (301-318, `tech_type`), `ServiceDto` mirror (for `app_component_id`).
- AppShell per-(project,architecture) model cache (MEMORY note) — the already-
  loaded model the tier helper reads from.

---

## Requirements Summary

### Functional Requirements
- **Half A:** group discovery runs by service; render one scan picker per scanned
  service (0-or-1 run each); replace the 2-run `SelectedScanPair` with an N-run
  selection set (retaining a `primaryRunId` thread key); widen the review-model
  COUNTS API + gateway review routes to carry the full run-id set; surface a human
  service display name (model `services[].name` or the snapshot's `serviceName`,
  with the camelCase/snake_case reconciliation).
- **Half B:** classify question groups A-J by technology tier; extend
  `RelevanceContext` with `hasUiTier`/`hasServiceTier`/`hasPersistenceTier`; add a
  start-of-conversation tier-confirmation turn (derived from the target model's
  `app_component.tech_type`, user-adjustable); gate non-generic groups on their
  tier flag; thread the confirmed tier set through `open` + `next-question`.

### Reusability Opportunities
- ONE shared pure helper `deriveServiceTier(service, appComponentsById) →
  'UI'|'Service'|'Persistence'|'Unknown'` used by BOTH halves (run→service for A,
  component-set for B). This is the only genuine code-sharing point.
- The Review Room's `open`-turn-with-`SelectedScanPair` pattern is the template
  for Half B's tier-confirmation opening turn.
- The model is already loaded + cached client-side (AppShell), so no new backend
  fetch endpoint is needed for either half.

### Scope Boundaries
**In scope:** per-service scan picker (Half A); N-run selection wire shape + counts
API widening; tier classification of A-J; `RelevanceContext` tier extension;
tier-confirmation opening turn; tier-gated question flow (Half B).

**Out of scope:** the agenda redesign (done); reject-cascade correctness (done);
any new discovery SCANNING logic; the backbone review-model union (already N-run);
a new AMS list-components endpoint (the full-model GET suffices); persisting the
confirmed tier set as a durable decision (recommended in-session only for v1).

### Technical Considerations
- "tier" overload (Finding 2): V3 confidence tier (A/B/C) vs technology tier
  (UI/Service/Persistence). Disambiguate everywhere.
- The tier chain is two nullable hops; orphan runs (NULL `service_id`) and
  services with NULL `app_component_id` / `tech_type='Other'` need graceful
  "Unknown tier" handling — never block on an unresolved tier.
- `serviceIdentitySnapshot` is written camelCase but typed snake_case on the
  frontend — a real defect-adjacent mismatch this spec touches for the display
  name.
- `discovery_kind` is a lossy fallback (code can't distinguish UI vs Service);
  `tech_type` is authoritative.

---

## Visual Assets
[To be filled after the mandatory visuals-folder check during answer processing.]

## Follow-up Questions
[To be filled if needed after the user's first-round answers.]
