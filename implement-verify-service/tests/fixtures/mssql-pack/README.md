# DB Schema + Data Migration Pack (Sybase ASE -> PostgreSQL)

Generated deterministically from the committed physical model, the persisted
schema-metadata findings, and the captured db.* decisions — NO LLM is involved
in this pack's structural content.

## Contents

- `liquibase/db.changelog-master.xml` — the ordered master changelog.
- `liquibase/changesets/010-tables/` — ONE structural changeset per table
  (table + PK + unique/check constraints), FK-topological order.
- `liquibase/changesets/020-foreign-keys.sql` — ALL FKs, applied post-load.
- `liquibase/changesets/030-indexes.sql` — ALL non-PK indexes, post-load.
- `liquibase/changesets/040-sequences-seed.sql` — identity/sequence restarts
  (captured high-water + seed margin).
- `data/bulk/` — per-table bulk extract + COPY templates (FK-topological).
- `data/incremental/` — per-table incremental top-up scripts, parameterised
  by :last_high_water.
- `liquibase/changesets/050-translations.sql` — APPROVED DB object
  translations (procs/triggers/views) ONLY; present when at least one
  translation is approved. Unapproved drafts NEVER appear here.
- `translations/` — one file per APPROVED translation
  (`<kind>.<schema>.<object>.sql`); per-object approval provenance is
  recorded in `manifest.json` under `translations`.
- `manifest.json` — coverage ledger, provenance, delta strategies, the
  expected-schema JSON (verification baseline), the approved-translations
  section, and all notes.

## Run order (five phases)

1. apply structural changesets (tables, PKs, unique/check constraints) — NO foreign keys, NO non-PK indexes (run liquibase with --contexts=structural).
2. bulk load ALL tables in the FK-topological order listed in this manifest.
3. apply foreign keys + non-PK indexes ONCE (the consolidated foreign-keys and indexes changesets; --contexts=post-load).
4. reseed sequences/identities (the consolidated sequences-seed changeset; restart = captured high-water + seed margin).
5. all subsequent incremental runs execute WITH foreign keys and indexes enforced.

## Deletes

DELETE propagation is OUT OF SCOPE for incremental v1: incremental scripts insert and/or update only. Rows deleted at source after the bulk load are NOT removed by increments — tables configured for full reload each increment are the mechanism that catches deletes.

## Decisions

Objects the generator could not translate deterministically are OMITTED and
flagged as decisions in the tool's pack decision queue — resolve them and
regenerate. The generator never guesses.
