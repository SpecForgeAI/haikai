# Spec Requirements: LLM-Assisted DB Object Translation Drafts (T-SQL → PL/pgSQL) with Judge Verification

## Initial Description

SPEC 2 of the schema-migration pair. Spec 1 (`agent-os/specs/2026-06-11-db-schema-and-data-migration-pack` — BUILT 2026-06-11, awaiting live shakedown) made discovery a source-grade schema+data migration input: a deterministic Liquibase pack with a decision queue, drift verification, and a manifest that lists stored procedures / triggers / views as `requires_translation_spec_2`. This spec is that deferred part: per-object LLM translation of the captured Sybase ASE T-SQL bodies into PostgreSQL equivalents, as REVIEWED DRAFTS — never silently executable.

**What exists to build on (from raw idea):**
- Discovery findings carry the FULL object bodies: `stored_procedure_logic` / `trigger_logic` finding types + view SQL (redacted + size-capped), plus deterministic T-SQL→Postgres token-conversion hints in `databasePackFindingBuilders.ts` (e.g. sysdatetime→now()).
- The Spec-1 pack data model: `db_migration_packs` / `_files` (file rows with kind + content) / `_decisions` (pack-scoped decision queue with resolve/bulk) / `_drift_reports`; the Schema Migration UI surface (pack view, decision queue, drift tabs) off the Migration Delivery Plan page; the manifest's requires-translation object list.
- The judge-verification pattern from spec `2026-06-11-two-phase-migration-plan-generation` (validators modeled on `techStackPrefillResponseValidator.ts`; one retry; failed-state semantics; verdict-only judge output) and the shared bounded LLM concurrency pool (`llmConcurrencyPool.ts`, `MIGRATION_PLAN_LLM_CONCURRENCY`).

**Scope sketch (from raw idea):**
1. PER-OBJECT TRANSLATION PIPELINE (gateway): for each proc/trigger/view in the pack's requires-translation list:
   - deterministic pre-pass: apply the known token conversions; detect known-untranslatable constructs (flag, don't guess);
   - one focused LLM call translating the body (T-SQL proc → PL/pgSQL function; trigger → Postgres trigger function + CREATE TRIGGER; view → Postgres SQL), carrying the object body + the schema context (its tables/columns from the pack IR) + the token hints;
   - LLM judge pass per draft (verdict-only: semantic-equivalence concerns, flagged constructs, confidence) with one retry; judge failure → object state `failed` (retryable); unverified drafts NEVER land as reviewable drafts without their judge verdict;
   - all LLM calls through the shared bounded concurrency pool.
2. PER-OBJECT DISPOSITION: translate | rewrite-in-application-layer | drop (with reason) — a per-object decision.
3. COVERAGE GUARANTEE (code-enforced): every object in the requires-translation list ends exactly one of translated-draft | rewrite-in-app | dropped(reason) | failed(retryable) — nothing silent.
4. DRAFT REVIEW LIFECYCLE: each draft is reviewable (approve / reject / needs-rework with notes); side-by-side source T-SQL vs translated PL/pgSQL view; judge verdict + flags displayed. APPROVED translations join the downloadable pack. Unapproved drafts are clearly draft-marked and excluded from the executable changelog.
5. UI: extends the existing Schema Migration surface with a Translations tab: object list (name, kind, size, disposition, state, judge confidence), per-object Translate + bulk Translate-all (product rule: never individual-only actions), the side-by-side draft reviewer, approve/reject controls.

**Constraints (from raw idea):**
- Sybase ASE T-SQL → PostgreSQL only (matches Spec 1).
- LLM is allowed ONLY in the translation + judge calls; the orchestration, coverage ledger, disposition handling, and pack/zip assembly stay deterministic.
- Drafts are NEVER auto-included in the executable changelog without explicit approval.
- Pack staleness semantics from Spec 1 apply (translations belong to a pack generation; drafts re-link across regeneration).
- Big-bang migration context; one DB epic carries the pack.

## Codebase Research Findings

Recorded from the spec-shaper research session; these ground the settled answers below.

- **Body capture and redaction**: `discovery-service/src/utils/snippetRedaction.ts` `redactFullBody` caps bodies at 64KB UTF-8 with a `truncated` flag, AND the shared secret-scrub collapses ALL quoted string literals to `?` in every captured proc/trigger/view body. This means legacy-captured bodies have lost their string literals.
- **Token hints**: `NON_PORTABLE_DEFAULT_FUNCTIONS` (13 entries) in `databasePackFindingBuilders.ts` is the existing deterministic T-SQL→Postgres token-conversion hint source.
- **View dependencies** exist only as `view_dependency` risk findings — there is no structured dependency graph.
- **Spec-1 pack files** are wholesale delete+insert on regeneration; `173-db-migration-pack-files.sql` has a CHECK constraint on `file_kind` (6 kinds) — adding a kind requires a NEW Liquibase changeset (changesets are immutable; latest is 175).
- **Decision queue** upserts by stable `decision_key`.
- **Judge/retry precedent**: `migrationBookOfWorkExpansionHandler.ts` `callWithRetry` + verdict-only judge; shared pool `llmConcurrencyPool.ts` / `MIGRATION_PLAN_LLM_CONCURRENCY`.
- **Runtime evidence is endpoint-level HTTP only** — NO per-proc/per-table usage signals exist, so no evidence base for an "appears unused" hint.
- **Side-by-side reviewer precedent**: `frontend/src/components/.../MigrationDeliveryInlineDiff.tsx`.

## Requirements Discussion

Nine clarifying questions were asked; the user accepted ALL recommendations as proposed.

### First Round Questions

**Q1:** Where do translation drafts persist — should they live in a new AMS table rather than as pack file rows (which are wholesale delete+insert on regeneration)?
**Answer:** Drafts persist in a NEW AMS table, `db_migration_pack_translations`: one row per object carrying — object identity ref, kind, disposition, pipeline state, source body + source-body hash, draft content, judge verdict JSON, review status, reviewer notes, timestamps. A NEW `translation` file kind (added via a new Liquibase changeset extending the CHECK constraint — changesets are immutable) is used ONLY when approved translations are emitted into the pack file rows.

**Q2:** How do approved translations land in the downloadable pack and the executable changelog?
**Answer:** Approved translations land BOTH as a `translations/` folder in the zip AND as a distinct `050-translations` Liquibase changelog section referenced from the master changelog — the executable path only ever contains APPROVED content. Unapproved drafts never appear in either.

**Q3:** What happens to drafts and approvals when the pack is regenerated (pack files are wholesale delete+insert)?
**Answer:** Re-link by object identity (`kind--object_ref`, analogous to `decision_key`) plus source-body content-hash comparison. Unchanged body → draft/approval preserved verbatim. Changed body → review status demoted to needs-rework with an explanatory note. Approval NEVER silently survives a source change.

**Q4:** Should per-object dispositions (translate | rewrite-in-app | drop) ride the existing pack decision queue?
**Answer:** No — disposition (translate | rewrite-in-app | drop+reason) is a set of fields on the per-object translation row, NOT decision-queue rows.

**Q5:** What shape should the judge verdict take and how is judge failure handled?
**Answer:** Structured-but-small: overall verdict + confidence + a flags array of `{construct, concern, severity}`; rendered per-draft in the reviewer. One retry; judge transport failure after retry → object state `failed` (retryable). Unverified drafts never become reviewable.

**Q6:** How do we handle body-fidelity problems — truncation at 64KB and the blanket string-literal collapse in capture redaction?
**Answer:** Two parts:
- (a) Truncated >64KB bodies → terminal "needs manual translation — body truncated at capture" state. NO chunking in v1.
- (b) THE CAPTURE FIX IS IN SCOPE: change discovery's body redaction from blanket literal-collapse to a TARGETED secret scrub — preserve string literals EXCEPT where the assignment target / column / variable name matches secret patterns (`password|token|key|secret|credential`, case-insensitive). Requires a re-scan to benefit. Bodies captured by OLD scans (legacy-redacted or truncated) translate with a prominent "literals collapsed at capture — re-scan recommended" fidelity warning on the draft.

**Q7:** Should the "appears unused" hint from runtime evidence be included (raw idea suggested it)?
**Answer:** DROPPED from v1 entirely — runtime evidence is endpoint-level HTTP only, so no per-proc evidence base exists; disposition is a purely manual call. (Proc-level usage evidence is its own future spec.)

**Q8:** Concurrency and bulk-action semantics for Translate / Translate-all?
**Answer:** Reuse the SAME shared pool/knob (`llmConcurrencyPool.ts` / `MIGRATION_PLAN_LLM_CONCURRENCY`). "Translate all" covers `pending` + `failed` states, skipping drafted/approved/dispositioned-away objects. Re-translate of an existing draft is a per-object action.

**Q9:** What is explicitly out of scope for v1?
**Answer:**
- NO in-app SQL editing of drafts — approve / reject / needs-rework with notes only; the draft is a starting artifact for the reviewer's IDE.
- NO live syntax validation against a scratch Postgres schema (noted as a natural follow-up given the verification-scan plumbing exists).
- Plus the raw-idea exclusions: Sybase ASE T-SQL → PostgreSQL only; LLM only in the translate + judge calls; drafts never auto-executable.

### Existing Code to Reference

**Similar Features Identified:**
- Side-by-side draft reviewer: builds on `frontend/src/components/.../MigrationDeliveryInlineDiff.tsx`.
- Judge validators: modeled on `migrationBookOfWorkExpansionValidators.ts` and `techStackPrefillResponseValidator.ts`.
- Judge/retry orchestration: `migrationBookOfWorkExpansionHandler.ts` `callWithRetry` + verdict-only judge pattern.
- LLM concurrency: shared pool `gateway/.../llmConcurrencyPool.ts` with the `MIGRATION_PLAN_LLM_CONCURRENCY` knob.
- Translations tab: slots into `DbMigrationPackView.tsx`'s existing section-tab pattern (Schema Migration surface off the Migration Delivery Plan page).
- Coverage-guarantee philosophy (every object ends exactly one of translated-draft | rewrite-in-app | dropped(reason) | failed — nothing silent): from the Spec-1 and two-phase-migration-plan-generation precedents.
- Identity re-link pattern: decision queue `decision_key` upsert (Spec 1) is the model for `kind--object_ref` draft re-linking.
- Token-conversion hints: `NON_PORTABLE_DEFAULT_FUNCTIONS` (13 entries) in `databasePackFindingBuilders.ts` feeds the deterministic pre-pass.
- Capture-fix touchpoint: `discovery-service/src/utils/snippetRedaction.ts` (`redactFullBody`).

### Follow-up Questions

None required — all nine recommendations were accepted as proposed, and no contradictions were found between the answers, the raw idea, and the research findings.

## Visual Assets

### Files Provided:
No visual assets provided (verified via directory check of `planning/visuals/`).

### Visual Insights:
- Follow existing Schema Migration surface styling (pack view, decision queue, drift tabs) for the new Translations tab and draft reviewer.

## Requirements Summary

### Functional Requirements
- **Per-object translation pipeline (gateway)** for every proc/trigger/view in the pack's requires-translation manifest list: deterministic token-conversion pre-pass (flag known-untranslatable constructs, never guess) → one focused LLM translation call (proc → PL/pgSQL function; trigger → trigger function + CREATE TRIGGER; view → Postgres SQL) carrying body + schema context from the pack IR + token hints → verdict-only LLM judge pass with one retry.
- **Persistence**: new AMS table `db_migration_pack_translations` (one row per object: object identity ref, kind, disposition, pipeline state, source body + hash, draft content, judge verdict JSON, review status, reviewer notes, timestamps) via a NEW Liquibase changeset; a NEW `translation` file_kind (new changeset extending the CHECK constraint) used only for approved-translation pack file rows.
- **Judge verdict**: overall verdict + confidence + flags array `{construct, concern, severity}`, stored as JSON, rendered per-draft; unverified drafts never reviewable; judge failure after retry → `failed` (retryable).
- **Disposition**: translate | rewrite-in-app | drop+reason as fields on the translation row (not decision-queue rows); purely manual (no usage hints in v1).
- **Coverage guarantee (code-enforced)**: every requires-translation object ends exactly one of translated-draft | rewrite-in-app | dropped(reason) | failed(retryable) | needs-manual-translation(truncated) — nothing silent.
- **Review lifecycle**: approve / reject / needs-rework with notes; side-by-side source T-SQL vs draft PL/pgSQL; judge verdict + flags displayed; fidelity warnings shown where applicable.
- **Pack emission**: approved translations land BOTH in a `translations/` zip folder AND a `050-translations` changelog section referenced from the master changelog; only approved content is ever on the executable path.
- **Regeneration survival**: re-link by `kind--object_ref` + source-body hash; unchanged → preserved verbatim; changed → demoted to needs-rework with explanatory note; approval never silently survives a source change.
- **Body fidelity**: >64KB-truncated bodies → terminal "needs manual translation — body truncated at capture" state (no chunking); legacy-redacted/truncated bodies translate with a prominent "literals collapsed at capture — re-scan recommended" warning.
- **Capture fix (in scope, discovery-service)**: replace blanket string-literal collapse in `redactFullBody` with a targeted secret scrub — preserve literals except where the assignment target / column / variable name matches `password|token|key|secret|credential` (case-insensitive); benefits require a re-scan.
- **UI**: Translations tab in `DbMigrationPackView.tsx` — object list (name, kind, size, disposition, state, judge confidence), per-object Translate + bulk Translate-all (never individual-only actions), side-by-side reviewer, approve/reject/needs-rework controls.
- **Concurrency/bulk**: all LLM calls through the shared bounded pool (`MIGRATION_PLAN_LLM_CONCURRENCY`); Translate-all covers pending + failed only; re-translate is per-object.

### Reusability Opportunities
- `MigrationDeliveryInlineDiff.tsx` for the side-by-side reviewer.
- `migrationBookOfWorkExpansionHandler.ts` (`callWithRetry`, verdict-only judge) and validators (`migrationBookOfWorkExpansionValidators.ts`, `techStackPrefillResponseValidator.ts`) for the judge pipeline.
- `llmConcurrencyPool.ts` / `MIGRATION_PLAN_LLM_CONCURRENCY` for bounded LLM concurrency.
- `DbMigrationPackView.tsx` section-tab pattern for the Translations tab.
- `decision_key` upsert pattern for `kind--object_ref` identity re-linking.
- `NON_PORTABLE_DEFAULT_FUNCTIONS` token hints for the deterministic pre-pass.
- Spec-1 coverage-ledger philosophy for the nothing-silent guarantee.

### Scope Boundaries

**In Scope:**
- Per-object translation pipeline with deterministic pre-pass, LLM translate, LLM judge (one retry), coverage guarantee.
- New `db_migration_pack_translations` AMS table + new `translation` file_kind changeset.
- Draft review lifecycle (approve / reject / needs-rework with notes) with side-by-side viewer and judge verdict display.
- Approved-only emission into zip `translations/` folder + `050-translations` changelog section.
- Regeneration re-link by identity + source-hash with demote-on-change.
- Discovery-service capture fix: targeted secret scrub replacing blanket literal collapse; fidelity warnings for legacy/truncated bodies.
- Translations tab on the existing Schema Migration surface; Translate / Translate-all; shared concurrency pool.
- Sybase ASE T-SQL → PostgreSQL only.

**Out of Scope:**
- In-app SQL editing of drafts (the draft is a starting artifact for the reviewer's IDE).
- Live syntax validation against a scratch Postgres schema (natural follow-up — verification-scan plumbing exists).
- Chunking of >64KB-truncated bodies (terminal manual state instead).
- "Appears unused" disposition hints / per-proc runtime usage evidence (future spec; no evidence base exists today — runtime capture is endpoint-level HTTP only).
- LLM use anywhere outside the translate + judge calls (orchestration, coverage ledger, disposition handling, pack/zip assembly stay deterministic).
- Auto-inclusion of any unapproved draft in the executable changelog.
- Other source/target database pairs.

### Technical Considerations
- Liquibase changesets are immutable — both the new translations table and the `file_kind` CHECK extension require NEW changesets (latest is 175; `173-db-migration-pack-files.sql` holds the current 6-kind CHECK).
- Pack files are wholesale delete+insert on regeneration — drafts must NOT live as pack file rows; the dedicated table + identity/hash re-link is the durability mechanism.
- Capture redaction fix lives in `discovery-service/src/utils/snippetRedaction.ts` (`redactFullBody`); 64KB cap + `truncated` flag retained; only the literal-collapse behavior changes to a targeted secret-pattern scrub.
- View dependencies exist only as `view_dependency` risk findings — no structured dependency graph; translation ordering/dependency handling cannot assume one.
- AMS wire format: new AMS DTOs default to snake_case per the global Jackson strategy; apply `@CamelCaseWire` only if a camelCase consumer is introduced (per repository CLAUDE.md guidance).
- Big-bang migration context; one DB epic carries the pack; pack staleness semantics from Spec 1 apply.
