# Spec 1 — Endpoint→data-effect call graph for discovery (Java / Spring Classic first)

Part of the HAIKAI discovery richness program (a like-for-like API/DB migration tool). North star: see memory `project_migration_ultimate_goal`. This is Spec 1 of a multi-spec program (B: this; C: business-logic behaviour; D: DB structural fidelity; E: SOAP/WSDL field depth; A-remainder: capture coverage).

## Problem / goal
Discovery captures `endpoints` and data entities as two disconnected islands — there is no captured linkage showing which data entities/tables each API endpoint reads/writes. The controller→service→repository→entity/table data-effect chain is never built (the `uses_data` relationship type exists in `discovery-service/src/types/relationship.ts` but nothing produces it). Without this chain, the migration book-of-work / shape-spec generation cannot produce an implementation-ready spec ("reimplement endpoint X, which reads A and writes B"). This is the highest-leverage gap for making Discovery + Architect chat + PM chat a sufficient *specification oracle* for the migration. The runtime API harness (`api-migration-validation-service`) remains the *equivalence verifier* — discovery does not need to prove behaviour, only describe it completely and honestly.

## Key decisions already agreed (constraints — not open for re-litigation)
1. Do NOT add `class`/`method` as first-class reviewable candidate types — would drown the candidate-review stream; the source's class structure is not a migration target (target re-implements differently).
2. Build the class/method call graph as EXTRACTION-LAYER SUBSTRATE — enrich the Java IR (already has classes/methods) with intra-method call/usage edges.
3. Persist only the RELEVANT SUBGRAPH — class/method hops on a path from an endpoint to a data entity, or rule-bearing methods — never the whole codebase.
4. First-class reviewable artifact = the ENDPOINT→DATA-ENTITY EDGE with an access mode (read / write / read-write); hang the path (class/method hops, e.g. `OwnerController.create → OwnerService.save → OwnerRepository`) on the edge as METADATA — no per-hop approve/reject entities.
5. Include the SHARED IDENTITY/MATCHING PRIMITIVE: resolve an entity reference by normalized name + confidence (not exact-string). Save-back today matches by exact name and duplicates (`Owner` vs `owners`). Reused by Spec 3 (DB) and Issue 2 (model-aware enrichment).
6. Unresolved chains (dynamic dispatch, JdbcTemplate / native SQL, reflection) → emit discovery FINDINGS ("endpoint X touches data we could not statically resolve"), never silent drops. Static resolution is best-effort, not 100%.
7. Key `business_logics` + the call graph by a stable method identifier (FQN + signature) so a later spec (Gap C) can attach behaviour to methods without persisting all methods.
8. OPEN/DEFERRED: optional separate collapsible "code-structure" UI layer for full call-tree traceability. Default = edge + path-metadata; only build the structural layer if needed (shaping question).

## Layering (AMS meta-model schema is the gating dependency)
(a) AMS meta-model — add endpoint→data-entity edge + access mode + path metadata; (b) MCP save-back — persist the edge, resolving entities via the identity primitive; (c) discovery-service extraction — enrich the Java IR with call/usage edges + a controller→service→repository→entity resolver. Java/Spring Classic pack FIRST; design to extend to other packs.

## Repo conventions / constraints
AMS speaks snake_case at the wire by default (CLAUDE.md). New Liquibase changesets must be NEW files (never edit applied changesets). Do not edit `discovery-service/src/**` during an in-flight discovery run. Relevant code: `discovery-service/src/services/extensionPacks/languageExtractors/java` (IR); `.../frameworkAdapters/springClassic/index.ts` (endpoint/candidate emit + existing `interface_logical_entities` / `logical_data_entity_physical_data_entities` links); `discovery-service/src/types/relationship.ts` (`uses_data`, unwired); `mcp-server/src/services/candidateSaveBackService.ts` (exact-name save-back); AMS endpoint + relationship model entities.
