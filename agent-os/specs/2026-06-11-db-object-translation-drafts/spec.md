# Specification: LLM-Assisted DB Object Translation Drafts (T-SQL → PL/pgSQL) with Judge Verification

## Goal

Translate every stored procedure / trigger / view in the Spec-1 migration pack's `requires_translation_spec_2` manifest list from Sybase ASE T-SQL into reviewed PostgreSQL draft equivalents — via a deterministic pre-pass, one focused LLM translation call, and a verdict-only LLM judge — with a code-enforced coverage guarantee, an approve/reject/needs-rework review lifecycle, and approved-only emission into the downloadable pack and executable changelog.

## User Stories

- As a migration engineer, I want each captured proc/trigger/view translated into a judge-verified PL/pgSQL draft that I review side-by-side against the source, so that DB-resident logic migration starts from a vetted draft instead of a blank page.
- As a migration engineer, I want every requires-translation object to end in exactly one explicit bucket (translated draft, rewrite-in-app, dropped with reason, failed, or needs-manual), so that no database object is silently lost in the migration.
- As a migration engineer, I want only explicitly approved translations to ever reach the pack's executable changelog, so that an unreviewed LLM draft can never run against the target database.

## Specific Requirements

**AMS persistence — `db_migration_pack_translations` table + `translation` file kind (NEW changesets only)**

- New table `db_migration_pack_translations` via a NEW changeset file under `architecture-model-service/src/main/resources/db/changelog/sql/` (next free number after `175`; applied changesets are immutable — never edit existing files).
- Columns: id, pack_id FK (→ `db_migration_packs`), translation_key (stable identity `kind--object_ref`, unique per pack — the `decision_key` analogue), object_ref, kind (`stored_procedure` | `trigger` | `view`), disposition (`translate` | `rewrite_in_app` | `drop`), drop_reason, pipeline_state, source_body (text), source_body_hash (SHA-256), fidelity flags (truncated, legacy_redacted), draft_content (text), judge_verdict_json (jsonb), review_status, reviewer_notes, timestamps (created/translated/reviewed).
- A SECOND new changeset extends the `chk_dmpf_file_kind` CHECK on `db_migration_pack_files` (`173-db-migration-pack-files.sql` holds the current 6-kind list) with a 7th kind, `translation` — used ONLY for emitted approved-translation file rows.
- Translation rows live in the dedicated table, NEVER as pack file rows — pack files are wholesale delete+insert on regeneration; this table is the durability mechanism.
- New JPA entity/repository/service/controller following the Spec-1 `DbMigrationPack*` patterns; DTOs use the AMS default snake_case wire (no `@CamelCaseWire` — all consumers are new).
- AMS endpoints (snake_case) nested under the existing pack controller path: list translations for a pack, get one, upsert/patch (pipeline state, draft, verdict, disposition, review fields).

**Gateway translation pipeline (deterministic pre-pass → LLM translate → LLM judge → persist)**

- Extend `gateway/src/services/dbMigrationPackHandler.ts` (+ a new module alongside `gateway/src/services/dbMigrationPack/`) — seeding: on pack generation/regeneration, ensure one translation row exists per `requires_translation_spec_2` manifest entry, source body resolved from its provenance findings (`stored_procedure_logic` / `trigger_logic` / `view_definition` detail_json).
- Stage 1, deterministic pre-pass (no LLM): apply the `NON_PORTABLE_DEFAULT_FUNCTIONS` token conversions from `databasePackFindingBuilders.ts` to produce a pre-converted body, and detect known-untranslatable constructs as flags — never guess; pre-pass output (converted body + flag list) feeds the translation prompt.
- Stage 2, ONE focused LLM translation call per object: T-SQL proc → PL/pgSQL function; trigger → Postgres trigger function + `CREATE TRIGGER`; view → Postgres SQL. Prompt carries the object body, the object's schema context (its tables/columns from the pack IR built in `dbMigrationPack/inputs.ts`), and the token hints/flags.
- Stage 3, verdict-only LLM judge per draft (see judge requirement); a draft is persisted as reviewable (`drafted`) ONLY together with its judge verdict — unverified drafts never become reviewable.
- Translation call failure (transport or response-validation) retries once, mirroring `callWithRetry` in `migrationBookOfWorkExpansionHandler.ts`; failure after retry → pipeline_state `failed` (retryable).
- ALL LLM calls (translate + judge) run through the shared bounded pool `gateway/src/services/llmConcurrencyPool.ts` / `getMigrationPlanLlmPool()` governed by `MIGRATION_PLAN_LLM_CONCURRENCY` — one shared pool instance across Translate-all.
- LLM is allowed ONLY in the translate + judge calls; seeding, the pre-pass, the coverage ledger, disposition handling, emission, and zip assembly stay fully deterministic.
- `[diag-gateway]` stage-marker logs per object/stage, consistent with the Spec-1 handler convention.

**Judge verification (structured-but-small verdict, one retry, failed-retryable)**

- Verdict shape: `{ verdict, confidence, flags: [{ construct, concern, severity }] }` — overall semantic-equivalence verdict, a confidence value, and zero-or-more flagged constructs; stored verbatim in `judge_verdict_json` and rendered per-draft in the reviewer.
- Judge prompt receives source body + draft + schema context; it judges only — it never rewrites the draft.
- Response validator is hand-rolled per-rule with the `{ ok, value | errors }` shape, modeled on `gateway/src/services/architectConversation/techStackPrefillResponseValidator.ts` and `migrationBookOfWorkExpansionValidators.ts` (no schema library).
- One retry on judge transport/validation failure; failure after retry → object pipeline_state `failed` (retryable); the unverified draft is NOT presented for review.
- A judge verdict with concerns/flags does NOT block review — flags are reviewer information, not gates; only judge-call failure blocks.

**Per-object state machine and code-enforced coverage guarantee**

- Three orthogonal fields: pipeline_state (`pending` → `translating` → `drafted` | `failed` (retryable) | `needs_manual` (terminal, truncated-at-capture)), review_status (`unreviewed` → `approved` | `rejected` | `needs_rework`), disposition (`translate` (default) | `rewrite_in_app` | `drop` + mandatory reason).
- Coverage guarantee enforced by a code assertion (Spec-1 / two-phase-plan philosophy, never diligence): every `requires_translation_spec_2` object resolves to exactly one bucket — translated-draft | rewrite-in-app | dropped(reason) | failed(retryable) | needs-manual(truncated) — nothing silent; coverage counts surface in the Translations tab summary.
- Objects dispositioned `rewrite_in_app` or `drop` are excluded from translation runs; flipping disposition back to `translate` returns them to `pending`.
- `Translate-all` processes ONLY `pending` + `failed` objects (skipping drafted/approved/dispositioned-away/needs_manual); re-translate of an existing draft is a per-object action and resets review_status to `unreviewed` with a fresh judge pass.
- Stale `translating` state (gateway restart mid-run) must be recoverable — treated as retryable from the UI.

**Review lifecycle (approve / reject / needs-rework with notes — no in-app editing)**

- Reviewer actions: approve, reject, needs-rework — each accepts optional notes (needs-rework notes encouraged); persisted on the translation row with reviewed-at timestamp.
- NO in-app SQL editing of draft content — the draft is a starting artifact for the reviewer's IDE.
- Approval is per object and explicit; approving triggers re-emission of the pack's translation outputs (next requirement).
- Fidelity warnings render prominently on the draft: "body truncated at capture" (needs_manual, no review possible) and "literals collapsed at capture — re-scan recommended" (legacy-redacted bodies, reviewable but warned).
- Judge verdict, confidence, and the flags table (`construct` / `concern` / `severity`) display alongside the side-by-side view.

**Approved-only dual emission — zip `translations/` folder + `050-translations` changelog section**

- Approved translations (disposition `translate`, review_status `approved`) emit deterministically into `db_migration_pack_files` rows with file_kind `translation`: one file per object at `translations/<kind>.<schema>.<object>.sql`, and a consolidated `liquibase/changesets/050-translations.sql` formatted-SQL changeset section referenced from the master changelog (Spec-1 numbering: 000-schemas … 040-sequences-seed; 050 is next).
- Changeset ids / logicalFilePath are stable functions of object identity (Spec-1 convention) so unchanged approved content produces byte-identical changesets — no checksum churn.
- Emission re-runs whenever a review status changes to/from approved and on pack regeneration; the zip writer (`dbMigrationPack/zip.ts`) picks the rows up unchanged since it assembles from file rows on demand.
- The executable path (master changelog) only EVER contains approved content; unapproved drafts appear in neither the zip nor the changelog — there is no draft-marked emission, drafts live only in the table/UI.
- The pack manifest and readme are updated to describe the translations section and the per-object approval provenance.

**Regeneration survival — identity + source-hash re-link with demote-on-change**

- On pack regeneration, re-link each existing translation row by `translation_key` (`kind--object_ref`) to the new manifest list; recompute the source-body hash from the freshly resolved finding body.
- Unchanged hash → draft, verdict, disposition, review status, and notes preserved verbatim.
- Changed hash → source_body/hash updated, review_status demoted to `needs_rework` with an auto-appended explanatory note; approval NEVER silently survives a source-body change (emission drops the object until re-approved).
- Objects no longer in the manifest are removed (or marked obsolete) deterministically; new objects seed as `pending`.
- Pack staleness semantics from Spec 1 apply unchanged; translation actions operate against the current pack generation.

**Body fidelity — truncated bodies terminal, legacy-redacted bodies warned**

- A source body whose capture finding carries `truncated: true` (>64KB cap in `redactFullBody`) → pipeline_state `needs_manual` ("needs manual translation — body truncated at capture"), terminal; NO chunking in v1; excluded from Translate-all.
- Bodies captured by OLD scans (before the capture fix below) are detected via the absence of the new redaction-policy marker on the finding and flagged `legacy_redacted`; they DO translate, but the draft carries the prominent "literals collapsed at capture — re-scan recommended" fidelity warning.
- Fidelity flags are computed at seeding time from finding detail_json and stored on the translation row.

**Discovery capture fix (IN SCOPE) — targeted secret scrub in `snippetRedaction.ts`**

- In `discovery-service/src/utils/snippetRedaction.ts`, the `redactFullBody` path replaces the blanket quoted-literal collapse (step 3) with a TARGETED scrub: preserve string literals verbatim EXCEPT where the assignment target / column / variable name matches `password|token|key|secret|credential` (case-insensitive) — e.g. `SET @password = '...'`, `pwd_column = '...'`, declare-with-default forms.
- Steps 1–2 (secret key=value masking, auth headers, JDBC/URI credentials, AWS keys, PEM blocks) and the 64KB cap + `truncated` flag are retained unchanged.
- `redactSnippet` (code-pack scanners + DB-pack profilers) KEEPS its historical behaviour exactly, including the blanket literal collapse — only the full-body path changes.
- The full-body result/finding detail gains a redaction-policy version marker (e.g. `literal_policy: targeted_v2`) so newly captured bodies self-identify and legacy bodies are detectable downstream.
- Update `snippetRedaction` unit tests and the proc/trigger/view body-capture callers' tests; benefiting from the fix requires a re-scan (stated in the fidelity warning copy).

**Gateway API surface (snake_case)**

- Extend `gateway/src/routes/dbMigrationPack.ts` (existing registration): list translations (with coverage summary), translate one object, translate-all (pending+failed), set disposition (with drop reason), review action (approve/reject/needs-rework + notes), retry failed.
- Routes proxy persistence to the new AMS endpoints and reuse the file's existing AMS error round-tripping conventions.
- Translate/translate-all responses report per-object outcomes (state transitions + failures) so the UI can update without polling-only behaviour; long bulk runs remain resumable via persisted pipeline state.

**Frontend — Translations tab on the Schema Migration surface**

- Add a fourth section tab "Translations" to `DbMigrationPackView.tsx`'s existing `sectionTabs` pattern (contents / decisions / drift / translations), styled with `DbMigrationPack.module.css`.
- Object list table: name (object_ref), kind, body size, disposition, pipeline state, review status, judge confidence; coverage-summary chips above (drafted / approved / rewrite-in-app / dropped / failed / needs-manual counts).
- Actions: per-object Translate (and Re-translate / Retry) AND bulk Translate-all (product rule: never individual-only actions); per-object disposition control (translate / rewrite-in-app / drop with required reason).
- Side-by-side draft reviewer built on the `frontend/src/components/ProductManager/MigrationDeliveryDashboard/MigrationDeliveryInlineDiff.tsx` precedent: source T-SQL left, draft PL/pgSQL right, judge verdict + flags table, fidelity warning banners, approve/reject/needs-rework controls with notes.
- New typed snake_case functions added to `frontend/src/api/dbMigrationPackApi.ts` following its existing conventions.

## Visual Design

No visual assets provided (`planning/visuals/` is empty).

- Follow the existing Schema Migration surface styling (`DbMigrationPackView.tsx` section tabs, tables, chips, banners + `DbMigrationPack.module.css`) for the Translations tab, and the `MigrationDeliveryInlineDiff.tsx` styling for the side-by-side reviewer.

## Existing Code to Leverage

**Spec-1 pack stack — `gateway/src/services/dbMigrationPackHandler.ts` + `dbMigrationPack/` modules, `routes/dbMigrationPack.ts`, AMS `DbMigrationPack*` (changesets 172–175), `DbMigrationPackView.tsx`**

- The manifest's `requires_translation_spec_2` entries (`{kind, object_ref, finding_ids}` in `dbMigrationPack/types.ts`) are the authoritative object list; finding provenance resolves source bodies.
- `liquibase.ts` changeset-path/id conventions (000–040 numbering, stable ids) extend naturally to `050-translations.sql`; `zip.ts` assembles from file rows unchanged.
- `173-db-migration-pack-files.sql` `chk_dmpf_file_kind` is the CHECK to extend via a NEW changeset; AMS entity/controller layering is the template for the translations table.
- `DbMigrationPackView.tsx` section-tab pattern + `dbMigrationPackApi.ts` are the exact frontend extension points.

**Judge/retry precedent — `migrationBookOfWorkExpansionHandler.ts`, `migrationBookOfWorkExpansionValidators.ts`, `architectConversation/techStackPrefillResponseValidator.ts`**

- `callWithRetry` one-retry convention and verdict-only judge orchestration with failed-retryable semantics are reused for both translate and judge calls.
- Validators are the hand-rolled `{ ok, value | errors }` model for the translation-response and judge-verdict validators.

**`gateway/src/services/llmConcurrencyPool.ts`**

- `getMigrationPlanLlmPool()` shared singleton + `MIGRATION_PLAN_LLM_CONCURRENCY` knob (default 4, serial at 1) bounds ALL translate + judge calls; no new pool or knob.

**`discovery-service` capture surfaces — `utils/snippetRedaction.ts` + `findings/databasePackFindingScanners/databasePackFindingBuilders.ts`**

- `redactFullBody` (`{body, redacted, truncated}`, 64KB UTF-8 cap) is the exact function the targeted-scrub fix modifies; `redactSnippet` callers must stay byte-identical.
- `NON_PORTABLE_DEFAULT_FUNCTIONS` (13 token entries with notes) feeds the deterministic pre-pass; `stored_procedure_logic` / `trigger_logic` / `view_definition` finding detail_json shapes carry the bodies + flags the seeder reads.

**`frontend/.../MigrationDeliveryDashboard/MigrationDeliveryInlineDiff.tsx` + Spec-1 decision_key re-link pattern**

- Inline side-by-side diff component is the reviewer rendering precedent.
- The pack decision queue's stable `decision_key` upsert-on-regeneration pattern is the model for `translation_key` identity re-linking.

## Out of Scope

- In-app SQL editing of draft content — approve / reject / needs-rework with notes only.
- Live syntax validation of drafts against a scratch Postgres schema (natural follow-up; verification-scan plumbing exists — build nothing for it).
- Chunking or multi-call translation of >64KB-truncated bodies — terminal needs-manual state instead.
- "Appears unused" disposition hints or any per-proc runtime usage evidence (runtime capture is endpoint-level HTTP only; future spec).
- LLM involvement anywhere outside the translate + judge calls — orchestration, coverage ledger, dispositions, emission, and zip assembly stay deterministic.
- Auto-inclusion of any unapproved draft in the executable changelog or zip — approved-only, always.
- Any source/target pair other than Sybase ASE T-SQL → PostgreSQL.
- Executing translated SQL from inside the tool — drafts are never auto-executable.
- Structured view-dependency graph or dependency-ordered translation (only `view_dependency` risk findings exist today).
- Changes to `redactSnippet` behaviour or its code-pack/profiler call sites.
