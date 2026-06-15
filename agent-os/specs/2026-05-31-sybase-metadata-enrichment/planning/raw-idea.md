TITLE: Sybase metadata enrichment (data-layer fidelity parity)

For the HAIKAI like-for-like API/DB migration tool, the discovery-service's database-layer capture reaches full fidelity for PostgreSQL (reads its system catalogs directly) but only partial fidelity for Sybase, because Sybase is reached via the in-repo `sybase-discovery-sidecar` Spring Boot service, which currently surfaces structural shape but NOT the richer metadata. The discovery side already has optional slots + "value unavailable — TODO(oracle-W3)" evidence-gap Findings waiting to be filled (added by the Spec-6 data-layer-fidelity-2 work).

This spec is a FULL TWO-SIDED enrichment (user-confirmed scope):
1. Modify `sybase-discovery-sidecar` (its own Spring Boot module: `SidecarController`, `SybaseQueryService` ~38KB of catalog queries, `SidecarSqlGuard` read-only enforcement, `IntrospectionRequest/Response` contract, jConnect/jTDS driver strategies) to run new Sybase system-catalog queries and additively extend its introspection response.
2. Wire the discovery-service (`databasePacks/sybase/*`, `candidateStructuralFidelity.ts`, `types.ts`, `databasePackFindingScanners/databasePackFindingBuilders.ts`) to map the new fields into the existing slots and stop emitting "unavailable" Findings when present.

Target metadata (six groups): (1) collation / case-sensitivity / sort-order; (2) computed columns (expression SQL); (3) sequence/identity current value; (4) FK referential actions (on_delete/on_update); (5) index ordering / clustering / partial-predicate; (6) DB-resident jobs.

GROUNDING CONSTRAINT: this metadata is migration REALITY, captured as Findings + JSONB, NOT new architecture meta-model entity types.
