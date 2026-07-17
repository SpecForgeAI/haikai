# Spec X — Schema-apply runner (bootstrap shell)

**Status:** building (lean). Reframe doc §5, §8. One of two runner gaps.

## Purpose

Provide a **kept, generic, pair / target-tech-pluggable** mechanism that
**applies** the generated schema pack to a target database — closing the
"generate vs apply" gap for schema. For `sybase15 → postgres18 + Spring`, this
is a minimal Spring Boot + Liquibase bootstrap that auto-runs the pack's
`db.changelog-master.xml` on boot against the target datasource.

## Changes

- New small Java module (beside `architecture-read-service` / `jira-service` /
  `sybase-discovery-sidecar`): a Spring Boot app whose sole job is to boot with
  (a) target datasource config (per-invocation, env / in-memory, **never
  persisted**) and (b) a mounted / generated Liquibase changelog, and let
  Liquibase apply it.
- Pluggable per target tech: the changelog path + datasource are inputs; **no
  engine name hard-coded** in generic logic (engine specifics stay in the
  pack / ruleset).
- Kept artefact (not throwaway per migration).

## Acceptance

- Boots, applies a sample generated changelog to an embedded / Testcontainers
  Postgres, exits success; non-zero on Liquibase failure.
- No target credentials logged or persisted.
- **NEW changesets only** (never edits applied ones).
- Predicate / trace hooks so a live apply is judgeable (align with
  `HAIKAI_TRACE` + a GATE/EXEC-style stage).

## Out of scope

- Data movement (Spec Y).
- Orchestration / dispatch of the runner within phased execution (Spec W).
