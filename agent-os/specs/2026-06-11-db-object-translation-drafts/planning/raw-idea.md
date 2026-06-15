# LLM-Assisted DB Object Translation Drafts (T-SQL → PL/pgSQL) with Judge Verification

## Context — SPEC 2 of the schema-migration pair
Spec 1 (agent-os/specs/2026-06-11-db-schema-and-data-migration-pack — BUILT 2026-06-11, awaiting live shakedown) made discovery a source-grade schema+data migration input: a deterministic Liquibase pack with a decision queue, drift verification, and a manifest that lists stored procedures / triggers / views as `requires_translation_spec_2`. This spec is that deferred part: per-object LLM translation of the captured T-SQL bodies into PostgreSQL equivalents, as REVIEWED DRAFTS — never silently executable.

## What exists to build on
- Discovery findings carry the FULL object bodies: `stored_procedure_logic` / `trigger_logic` finding types + view SQL (redacted + size-capped — check the caps in databasePackFindingBuilders.ts), plus deterministic T-SQL→Postgres token-conversion hints already in databasePackFindingBuilders.ts (e.g. sysdatetime→now()).
- The Spec-1 pack data model: db_migration_packs/_files (file rows with kind + content)/_decisions (pack-scoped decision queue with resolve/bulk)/_drift_reports; the Schema Migration UI surface (pack view, decision queue, drift tabs) off the Migration Delivery Plan page; the manifest's requires-translation object list.
- The judge-verification pattern from spec 2026-06-11-two-phase-migration-plan-generation (validators modeled on techStackPrefillResponseValidator.ts; one retry; failed-state semantics; verdict-only judge output) and the shared bounded LLM concurrency pool (llmConcurrencyPool.ts, MIGRATION_PLAN_LLM_CONCURRENCY).
- Runtime evidence: discovery captures runtime usage signals that could inform an "appears unused" suggestion per object.

## Scope sketch
1. PER-OBJECT TRANSLATION PIPELINE (gateway): for each proc/trigger/view in the pack's requires-translation list:
   - deterministic pre-pass: apply the known token conversions; detect known-untranslatable constructs (flag, don't guess);
   - one focused LLM call translating the body (T-SQL proc → PL/pgSQL function; trigger → Postgres trigger function + CREATE TRIGGER; view → Postgres SQL), carrying the object body + the schema context (its tables/columns from the pack IR) + the token hints;
   - LLM judge pass per draft (verdict-only: semantic-equivalence concerns, flagged constructs, confidence) with one retry; judge failure → object state `failed` (retryable), unverified drafts NEVER land as reviewable drafts without their judge verdict.
   - All LLM calls through the shared bounded concurrency pool.
2. PER-OBJECT DISPOSITION: translate | rewrite-in-application-layer | drop (unused / superseded) — a per-object decision. Runtime-usage evidence (if captured) surfaces an "appears unused" hint. Dispositions ride the EXISTING pack decision queue mechanism where sensible.
3. COVERAGE GUARANTEE (code-enforced, same philosophy): every object in the requires-translation list ends exactly one of translated-draft | rewrite-in-app | dropped(reason) | failed(retryable) — nothing silent.
4. DRAFT REVIEW LIFECYCLE: each draft is reviewable (approve / reject / needs-rework with notes); side-by-side source T-SQL vs translated PL/pgSQL view; judge verdict + flags displayed. APPROVED translations join the downloadable pack (e.g. a translations/ section; whether they also become Liquibase changesets in the changelog when approved is an open design question). Unapproved drafts are clearly draft-marked and excluded from the executable changelog.
5. UI: extends the existing Schema Migration surface with a Translations tab: object list (name, kind, size, disposition, state, judge confidence), per-object Translate + bulk Translate-all (product rule: never individual-only actions), the side-by-side draft reviewer, approve/reject controls.

## Constraints
- Sybase ASE T-SQL → PostgreSQL only (matches Spec 1).
- LLM is allowed ONLY in the translation + judge calls; the orchestration, coverage ledger, disposition handling, and pack/zip assembly stay deterministic.
- Drafts are NEVER auto-included in the executable changelog without explicit approval.
- Pack staleness semantics from Spec 1 apply (translations belong to a pack generation; what happens to drafts on regenerate is an open design question — likely re-link by object identity like decision_key re-link).
- Big-bang migration context; one DB epic carries the pack.
