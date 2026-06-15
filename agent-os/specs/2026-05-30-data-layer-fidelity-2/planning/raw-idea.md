# Raw Idea: Data-Layer Fidelity 2 (cross-engine DB capture completeness)

HAIKAI Phase-2 "oracle perfection" program — **Spec #6 of 6 (the final spec)**.

Discovery IS the database schema-migration source of truth. A Sybase→Postgres
schema migration is a STATIC transform — there is no runtime "fire the same
request at both engines" oracle for a schema — so whatever Discovery captures
about database reality must be **lossless** for a like-for-like cross-engine
migration. Spec 3 (`2026-05-29-db-structural-fidelity`) plus the already-merged
quick-win **W3** (FK referential actions in `fk_columns`; index
ordering/clustering/partial-predicate detail in `constraints_metadata`) closed
the first wave of structural drops. This spec closes the REMAINING audited gaps
that still break a faithful cross-engine reproduction.

Gaps this spec addresses (verified against HEAD):

1. **Per-endpoint SQL text is never captured.** There is no
   `@Query` / native-query / JdbcTemplate-string / MyBatis SQL scanner. The
   endpoint data-effect resolver yields an entity NAME + coarse access mode /
   operation hint only; on native / dynamic SQL it emits an
   `endpoint_data_effect_unresolved` Finding and DISCARDS the SQL literal that
   is sitting in the IR. Result-set shape/order cannot be reproduced without the
   query text.
2. **Collation / case-sensitivity** is captured nowhere (Sybase
   case-insensitive vs Postgres case-sensitive diverge silently).
3. **Sequence current value** is never read (only start/increment/min/max/cycle)
   → the first post-cutover INSERT collides with existing primary keys.
4. **Engine-specific default expressions** are stored verbatim but carry no
   cross-engine hazard flag (`getdate()` / `newid()` / `suser_name()` have no
   identical Postgres equivalent).
5. **Computed / generated columns** are not distinguished from plain writable
   columns (`GENERATED ALWAYS AS` / Sybase computed) → recreated wrongly.
6. **Database-resident scheduled jobs / agents** are never introspected; both
   packs' "unsupported feature" finding emitters are empty stubs.
7. **Postgres procedure capture uses the body only** (`prosrc`) → signature /
   args / return / volatility / `SECURITY DEFINER` are lost.

EVERYTHING additive: database reality lands as **Findings** plus **on-attribute
/ on-relationship JSONB metadata** — NEVER new meta-model entity types
(architecture ≠ reality). Engine type/expression strings captured VERBATIM (no
normalization). Out of scope: redoing W3; a SQL rewriter/translator; engines
other than Sybase + Postgres. Built STRICTLY LAST of the six so it extends every
prior committed spec (reuses Spec #5's call-arg-literal retention for SQL-string
capture, Spec #3's introspection + structural-fidelity builders, and Spec #1's
data-effect path).
