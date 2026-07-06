# Spec G — Deterministic Code-Stream Planning (Anti-Explosion + Full Coverage)

**Program:** Code-Tier Oracle (see `agent-os/planning/2026-07-06-code-tier-oracle-gap-analysis.md`)
**Closes:** Gap P3 (plan nondeterminism, story-per-endpoint explosion, silent-miss/duplication
seams, internal entry points mis-flowing into the API stream) and the planning half of P6.
**Mirrors:** Persistence Spec B (`2026-07-02-b-clustered-db-plan-generation`) — same idioms,
same test discipline.

## Goal

"Create Migration Plan" produces the code-tier work deterministically from the committed
model: pinned epic structure per stream, one story per interface (verb-split when large),
flagged endpoints split out individually, internal (non-HTTP) functionality routed to its
own stream, and a code-asserted guarantee that every committed endpoint and internal entry
point appears in exactly one story.

## Evidence / current behaviour

- One story per inventory item (endpoint): `gateway/src/services/migrationBookOfWorkExpansionHandler.ts`
  (`stampStoryFromTemplate`, per-epic coverage assertion ~:1263–1280). 400 endpoints → 400 stories.
- Inventory fetch is STREAM-scoped, not epic-scoped (`defaultFetchEpicInventory` :694–769):
  every epic in an API stream fetches ALL model `Endpoints`. Coverage/duplication therefore
  depends on the LLM skeleton emitting exactly one inventory-bearing epic per stream — unpinned.
- BOTH API streams (`target_service_api_implementation`, `api_soap_integration_compatibility`)
  map to the same `Applications/Endpoints` source (`INVENTORY_STREAM_SOURCES` :642–666) —
  no protocol split; expanding both double-covers every endpoint.
- Internal entry points (endpoint subtypes `scheduled`/`jms-listener`/`kafka-listener`/etc.)
  flow into the API inventory where `HTTP_METHOD_PATTERN` (:668) fails, baseline resolution
  fails, and parity ACs are meaningless for them. No internal stream exists.
- Phase-1 skeleton for these streams is an LLM call (`migrationBookOfWorkHandler.ts:1081–1249`).

## User decisions binding this spec

- Cluster unit = INTERFACE (Controller class / SOAP service). One story per interface.
- Interface too large → split by verb group: GETs | POSTs+PUTs(+PATCH) | other verbs
  (DELETE, OPTIONS, HEAD, ...). Verb group still too large → deterministic path-sorted chunks.
  SOAP (no verbs) → alphabetical operation-group chunks.
- Accuracy over spec count; flagged endpoints always split out individually.
- A target app may be 100% SOAP or 100% REST — both must plan cleanly.

## Scope

### 1. Deterministic skeletons for code streams (replaces LLM Phase 1 for these streams)

New module `gateway/src/services/migrationCodeStreamPlanner.ts` (sibling of
`migrationDbPackPlanner.ts`), providing:

- `buildCodeStreamSkeleton(stream, modelView)` for:
  - `target_service_api_implementation` (REST endpoints)
  - `api_soap_integration_compatibility` (SOAP endpoints)
  - `internal_processing_implementation` (NEW stream — see §3)
- Pinned epic structure per stream (Spec B idiom):
  1. **Foundations & cross-cutting** — static stories: security/auth parity setup,
     serialization/converter configuration, error-mapping conventions, environment wiring.
  2. **Interface implementation** — one FEATURE per interface; one STORY per interface
     (or per verb-group/chunk when split, see §2).
  3. **Exceptional endpoints** — individual stories for flagged endpoints (§2).
  4. **Closure & full-surface parity** — final sweep story: full replay+diff across the
     stream's surface, sign-off (consumed by Spec I's completion gate).
- **Prerequisite skeleton** when the committed model has no endpoints for the stream's
  protocol: single prerequisite epic pointing at discovery/commit (Spec B idiom); a
  100%-SOAP app therefore yields a prerequisite-only REST stream and vice versa — never
  invented work.
- Stream skeletons for OTHER streams (infra, test pack, cutover, ...) remain LLM-generated —
  unchanged.

### 2. Deterministic expansion: interface clustering + flags

Deterministic branch in the expansion handler for the three code streams (before the LLM
path, mirroring the DB branch):

- `ModelView` fetch: committed interfaces + their endpoints (with `endpoint_type`, protocol,
  verb, path, subtype where present), endpoint→baseline coverage
  (`fetchEndpointBaselineCoverage`), attached findings (existing heuristic), SOAP protocol
  metadata presence.
- **Protocol partition:** REST endpoints → REST stream; SOAP → SOAP stream. An endpoint is
  in exactly one stream. Fixes the double-fetch seam.
- **Internal partition:** endpoints with non-HTTP subtypes (`scheduled`, `jms-listener`,
  `kafka-listener`, `rabbit-listener`, `sqs-listener`, `event-listener`) + batch-entrypoint
  `business_logics` + operational capabilities → internal stream ONLY (§3).
- **Clustering:** one story per interface. `MIGRATION_PLAN_API_CLUSTER_MAX_ENDPOINTS`
  (config + env, default **15**) caps a story's endpoint count; overflow splits by verb
  group, then path-sorted chunks; SOAP by alphabetical operation chunks.
- **Flag extraction** (individual stories, existing bespoke LLM rewrite path retained for
  their prose): `missing_baseline` (REST/SOAP), `attached_finding`, `live_conflict`,
  `complex_soap`, `not ready_for_spec`, and (once Spec F lands) `dialect_affected`.
  Flagged endpoints are REMOVED from their interface cluster story.
- **Tags/extras contract** (consumed by Specs H, I, F):
  - tags: `stream:<stream>`, `provenance:plan-deterministic`, `interface:<interfaceId>`
  - extras: `apiInterfaceId`, `apiEndpointIds[]` (committed endpoint element ids),
    `verbGroup` (when split), `protocol` (`rest`|`soap`), `flagReason` (flagged stories)
- Story ACs remain fact-stamped only (parity AC references the baseline id when resolved;
  flagged stories state the flag reason). No LLM invention for cluster stories.

### 3. New delivery stream: `internal_processing_implementation`

- Add to stream constants, `STREAM_SEQUENCE_RANK` (after `api_soap_integration_compatibility`,
  before `data_migration`), wizard/user-guide surfaces, and the frontend wayfinding registry
  if a gap code is added (see AMS note below).
- Epic structure: Foundations (scheduler/queue infra rehoming) → Processes (one feature per
  capability where capability synthesis grouped them, else per artifact; one story per
  job/listener cluster, cap shared with §2) → Exceptional → Closure (side-by-side job-run
  parity sweep per Spec M's oracle).
- Inventory: internal entry points from the committed model + operational capabilities.
  Stories carry extras `internalEntryPointIds[]`, `capabilityId?`.
- Verification semantics for these stories reference the DB-delta oracle (Spec M); this
  spec only PLANS them.

### 4. Coverage assertion (plan-wide, code-asserted)

By construction the planner covers everything it fetched; additionally assert (Spec B
idiom, throw `"... regenerate the migration plan"`):

- Every committed HTTP endpoint (REST+SOAP) appears in exactly ONE story across the two
  API streams (no duplicates, no misses).
- Every internal entry point appears in exactly ONE internal-stream story.
- Assertion failures are thrown, not logged (fail closed).

### 5. AMS deltas (small)

- **Gap codes:** add `no_committed_endpoints_for_protocol` (drives prerequisite skeleton
  visibility) and `internal_entry_points_unplanned` to `MigrationGapCodes` + discovery-context
  readiness, + frontend `gapWayfindingRegistry` entries (pattern from Spec A).
- **Endpoint subtype on the committed model — build-time verification task:** discovery
  candidates carry `endpoint_subtype` in `data`; VERIFY where (whether) it lands on committed
  `EndpointEntity` at save-back. If absent: add nullable `endpoint_subtype` column (NEW
  Liquibase changeset — never edit an existing one), map it in the discovery save-back path,
  and make the internal partition read it. Until backfilled, partition falls back to
  name/verb heuristics + a `subtype_unknown` warning finding (nothing silent).

## Non-goals

- Spec text content (Spec H). Parity verification (Spec I). Comparator/SOAP replay (Spec J).
- Any change to DB streams (Specs B–E remain authoritative).
- Re-planning existing generated plans (regeneration is the refresh mechanism, as with the DB pack).

## Acceptance criteria

1. **ANTI-EXPLOSION PIN:** 40 interfaces × 10 endpoints (400 endpoints, none flagged) →
   exactly 40 interface stories (+ fixed foundations/closure stories); 0 per-endpoint stories.
2. **VERB-SPLIT PIN:** one interface with 40 endpoints (cap 15) → GET/POST-PUT/other-verb
   stories, each ≤ cap, union == the interface's endpoints.
3. **COVERAGE PIN:** removing any endpoint from any story's extras (or planting a duplicate)
   makes the assertion throw with the regenerate message.
4. **PROTOCOL PIN:** a mixed model plans SOAP endpoints only in the SOAP stream, REST only
   in the REST stream; a 100%-SOAP model yields a prerequisite-only REST stream.
5. **INTERNAL PIN:** a `jms-listener` subtype endpoint never appears in an API stream story;
   it appears in exactly one internal-stream story.
6. **FLAG PIN:** an endpoint with no baseline is absent from its interface cluster and has
   an individual story with `flagReason: missing_baseline`.
7. Existing DB-stream and non-inventory-stream behaviour unchanged (regression suite green
   vs baseline-red inventory).

## Test plan

`migrationCodeStreamPlanner.test.ts` (pins 1–6 as unit tests over an in-memory ModelView),
expansion-handler wiring tests with throwing-LLM mock for the three streams (LLM never
called on the deterministic path), skeleton tests incl. prerequisite mode. Baseline
discipline: verify against a stash-run/worktree at the pre-change commit.

## Dependencies & sizing

Depends on: nothing new (AMS reads exist; subtype task is internal). Feeds: H (tags/extras),
I (endpoint ids for scoped replay), F (flag hook). Size: **L**. Build first in the program.

---

## Amendment 2026-07-06 — capture-scan review (gap analysis §9)

Baseline capture work must be PLANNED, not assumed. The API Behaviour Baseline capture
scans are a producer of spec input (Spec H embeds captured scenarios; Spec I gates on
coverage), yet the plan today schedules no capture work — `missing_baseline` endpoints
just become flagged stories with no story that creates the baseline.

- **Epic structure change (§1):** the API and SOAP stream skeletons gain a
  **"Baseline capture & coverage"** epic between Foundations and Interface implementation:
  one deterministic story per interface whose endpoints are below the Spec K coverage
  floor at plan-generation time (same interface clustering; extras carry
  `apiInterfaceId` + `apiEndpointIds` + `captureWork: true`). AC = coverage floor met for
  the interface's endpoints. Interfaces already at floor get no capture story; the
  generation summary records the counts (nothing silent). Regeneration refreshes —
  consistent with the pack staleness model.
- **Sequencing:** capture stories rank before the same interface's implementation story
  within the stream, so Spec I's `code_baseline_missing` / `code_coverage_floor_unmet`
  gates have scheduled work that clears them instead of dead-ending.
- **Execution semantics:** capture stories are MANUAL-GATE items, not IVS work — they are
  performed by a human driving the capture wizard against the live legacy system. Tag
  `execution:manual-gate`; the execution driver NEVER dispatches them to IVS; they are
  auto-satisfiable at gate-evaluation time (complete iff the interface's coverage floor is
  met, re-checked live) so a floor reached by any means clears them without ceremony.
- **Additional acceptance criterion:** **CAPTURE-STORY PIN** — an interface below floor
  yields exactly one capture story sequenced before its implementation story; an
  interface at floor yields none and the summary says so. **MANUAL-GATE PIN** — the
  execution driver skips capture stories for IVS dispatch; a capture story whose interface
  meets the floor evaluates complete; one below floor blocks its interface's
  implementation story per Spec I's gate.
