# D3 (Keystone) — Internal-behaviour implementation-ready spec generation (+ modernisation)

This is Spec 3 (of 6) in the discovery-completeness + net_new program, and the KEYSTONE: it closes the verified "dead zone" so that non-API / internal functionality (batch capabilities, stored procs, scheduled jobs, monitoring, deployment) can become a genuinely IMPLEMENTATION-READY, Migrate-able spec — exactly as the already-built migration program does for API endpoints.

## The dead zone D3 closes (verified)
The built migration spec generator only produces implementation-ready specs for stories that resolve to the SIX existing migration spec-context types — service / api / soap / data / infrastructure / test_pack. A story about non-API internal work resolves to ZERO context blocks → is marked `insufficient_context` → never reaches `generated` → sits un-actioned. D1 (operational_artifact findings) and D2 (discovery_capability groupings + batch spines: JIL topology, plain-Java main() entrypoints, JIL→shell→Java→DB invocation edges) now SURFACE this work; D3 makes it implementable.

## What D3 does
1. ADD a 7th migration spec-context type (e.g. `internal_behaviour` / `operational_capability`) to the resolver that currently hardcodes the 6 types (gateway migrationSpecContextClient.ts + AMS MigrationSpecContextResolver.java KNOWN_CONTEXT_TYPES). The new type assembles focused context from a D2 `discovery_capability` (PREFERRED — the coherent unit, with its members/batch-spine/schedule/inputs-outputs/side-effects/external-systems) OR a behaviour-bearing finding (per-file fallback) — instead of an endpoint/table.
2. GENERATE the implementation-ready spec for that internal-behaviour story by REUSING the built generator: the migration_story_spec_generations row, the `/agent-os:shape-spec` combined spec-text assembler, the implement-state.json writer (so the Implement screen hydrates like a completed PM→TE session), the structured test pack, confidence + no-fabrication (`insufficient_context`). Output = a story that the already-built Migration Execution Driver can dispatch.
3. MODERNISATION ("like-for-like but modern tech") — the user wants operational work re-implemented in a modern way: Autosys → a modern orchestrator (Airflow / Spring Batch / Quartz / Step Functions), Argon/TIBCO → modern messaging, Sybase → Postgres, Geneos → modern observability. The generated spec targets the MODERN equivalent the target-state architect chose, while PRESERVING the behavioural contract (same schedule semantics; same data/message/snapshot OUTCOMES). The WHAT (effect/contract) is fixed; the HOW is modern. KEY OPEN QUESTION: does the existing target-state Architect already let the user choose a modern equivalent for an operational capability, or must D3 add that?
4. The generated spec's test pack is EFFECT-asserting for non-API work (run the pipeline → assert DB tables + downstream message + snapshot), because reconciliation is API-only and can't verify batch. (Actual TEST-item generation is the built holistic mechanism + the later D6; D3 just ensures the test pack is effect-oriented.)

## KEY OPEN SCOPE QUESTION — capability → work_item
The built generator runs over STORIES already in the book-of-work. For a `discovery_capability`, WHO creates the backlog work_item the generator runs on? Options: (a) D3 adds a "approved capability → work_item → spec-gen" path; (b) the existing book-of-work generation is extended to turn capabilities into stories; (c) lean on manual-add (the later net_new spec). This must be pinned during shaping — it determines whether D3 includes capability→work_item creation or assumes the story already exists.

## Reuse (the built "implementation-ready-migration-spec-generation" spec = Spec 1 of the prior program)
- migrationShapeSpecGenerationHandler.ts (generator: two-pass, confidence, no-fab, batch)
- migration_story_spec_generations row (incl. structured_tests_json / covered_endpoint_ids from changeset 181)
- migrationImplementReadyState.ts (buildPersistedImplementStateLiteral, buildPlannerResponseFromGenerated, buildTestPlannerResponseFromTests, defaultPutImplementState) — writes implement-state.json
- specGenerationResponseValidator.ts (SPEC_TEXT_REQUIRED_PREFIX = '/agent-os:shape-spec')
- the migration spec-context resolver (gateway migrationSpecContextClient.ts + AMS MigrationSpecContextResolver.java — the 6-type KNOWN_CONTEXT_TYPES to extend)
- D2's discovery_capability entity (the new context source)

## Owners
- gateway: the 7th context type wiring + the generator consuming capabilities/findings + the modernisation prompt + the effect-oriented test pack.
- AMS: extend MigrationSpecContextResolver KNOWN_CONTEXT_TYPES + assemble context from a discovery_capability/finding (reads D2's entity). Likely NO new Liquibase changeset (reuses built-Spec-1's migration_story_spec_generations + D2's capability entity) — confirm.
- frontend: the generated internal-behaviour spec surfaces in the existing Specs/Implementation review (like built-Spec-1's scope/AC/test-pack tiles) — minimal reuse.

## Scope boundaries (OUT of D3)
- The completeness gate (D4 — every capability cited-or-dismissed before Migrate).
- Net-new items + provenance (D5).
- Reconcile-time verification routing / net_new target_only handling (D6).
D3 = capability/finding → ONE implementation-ready (modernised) spec + implement-state, consumable by the already-built Migrate dispatch.

## Repo conventions
gateway = Express/TypeScript, jest with the live-LLM guard (mock llmClient) + src/testSetup/architectureModelClientMock.ts; AMS = Java/Spring, new Liquibase changesets ONLY if truly needed (latest applied 183; D2 adds 184 — D3 likely none), boxed PATCH-mutable types, snake_case wire (@CamelCaseWire only where camelCase consumers exist); frontend = React/TS, vitest + renderWithProviders + a tsc baseline. Reuse the built migration spec-generation patterns rather than forking.
