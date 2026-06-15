# Task Breakdown: LLM-Assisted DB Object Translation Drafts (T-SQL → PL/pgSQL) with Judge Verification

## Overview

Total Tasks: 6 task groups (35 sub-tasks)

Translate every stored procedure / trigger / view in the Spec-1 migration
pack's `requires_translation_spec_2` manifest list from Sybase ASE T-SQL into
reviewed PostgreSQL drafts — deterministic pre-pass → one focused LLM
translation call → verdict-only LLM judge — with a code-enforced coverage
guarantee, an approve/reject/needs-rework review lifecycle, regeneration
survival via identity + source-hash re-link, approved-only emission into the
zip `translations/` folder + `050-translations` changelog section, and the
in-scope discovery capture fix (targeted secret scrub replacing the blanket
literal collapse in `redactFullBody`).

**Cross-cutting constraints (apply to every group):**

- **LLM is allowed ONLY in the translate + judge calls.** Seeding, the
  deterministic pre-pass, the coverage ledger, disposition handling, review
  transitions, emission, and zip assembly are pure deterministic code.
- **Approved-only executable path.** Unapproved drafts NEVER appear in the
  zip or the master changelog — no draft-marked emission exists; drafts live
  only in the `db_migration_pack_translations` table and the UI.
- **Never edit applied Liquibase changesets.** Both the new translations
  table AND the `chk_dmpf_file_kind` CHECK extension arrive via NEW changeset
  files under `architecture-model-service/src/main/resources/db/changelog/sql/`
  using the next free numbers after `175` (i.e. `176-...` onward);
  `173-db-migration-pack-files.sql` is immutable.
- **Translation rows are NOT pack file rows.** Pack files are wholesale
  delete+insert on regeneration; the dedicated table + `translation_key`
  (`kind--object_ref`) + source-body-hash re-link is the durability
  mechanism. The `translation` file kind is used ONLY for emitted
  approved-translation file rows.
- **AMS wire format:** all new DTOs use the default snake_case wire — NO
  `@CamelCaseWire` (all consumers are new). Any DTO field that participates
  in PATCH semantics MUST be a boxed type (`Boolean`/`Long`/`Double`), never
  a primitive, with null guards in update handlers.
- **One retry, then `failed` (retryable):** both translate and judge calls
  follow the `callWithRetry` convention from
  `migrationBookOfWorkExpansionHandler.ts`; ALL LLM calls run through the
  shared bounded pool `llmConcurrencyPool.ts` / `getMigrationPlanLlmPool()`
  governed by `MIGRATION_PLAN_LLM_CONCURRENCY` — no new pool or knob.
- **Unverified drafts never become reviewable:** a draft persists as
  `drafted` ONLY together with its judge verdict.
- **Coverage guarantee enforced in code, never diligence:** every
  `requires_translation_spec_2` object resolves to exactly one bucket —
  translated-draft | rewrite-in-app | dropped(reason) | failed(retryable) |
  needs-manual(truncated) — nothing silent.
- **`redactSnippet` stays byte-identical.** Only the `redactFullBody`
  full-body path changes in `snippetRedaction.ts`; code-pack scanners and
  DB-pack profilers keep their historical behaviour exactly.
- **Checksum stability:** `050-translations` changeset ids and
  `logicalFilePath` are stable functions of object identity (Spec-1
  convention) so unchanged approved content emits byte-identical changesets.
- **Out of scope (do not build):** in-app SQL editing of drafts, live syntax
  validation against a scratch Postgres, chunking of >64KB-truncated bodies,
  "appears unused" hints, dependency-ordered translation, executing
  translated SQL, any pair other than Sybase ASE T-SQL → PostgreSQL.
- **Three test stacks:** AMS = JUnit (`mvn test -Dtest=...`),
  gateway + discovery-service = Jest, frontend = Vitest. Each group runs
  ONLY its own newly-written tests; never whole suites.
- **`tsx` watch caution (repo rule):** do not edit `discovery-service/src/**`
  while a discovery run is active — the watcher reload kills in-flight runs.

## Task List

### Discovery-Service — Capture Fix

#### Task Group 1: Targeted secret scrub in `redactFullBody` + policy marker
**Dependencies:** None

The in-scope capture fix: replace the blanket quoted-literal collapse in the
full-body redaction path with a targeted secret scrub, and surface a
redaction-policy version marker on the captured findings so downstream
seeding can distinguish new-policy bodies from legacy-redacted ones. This
group is independent of everything else and unblocks nothing downstream
(legacy detection works off marker ABSENCE), so it goes first while the
surface area is smallest.

- [x] 1.0 Complete the discovery capture fix
  - [x] 1.1 Write 2-8 focused tests for the targeted scrub
    - Limit to 2-8 highly focused tests maximum (Jest, extending the
      existing `snippetRedaction` unit tests in discovery-service).
    - Cover ONLY: (a) ordinary string literals in a proc body survive
      `redactFullBody` verbatim (e.g. `WHERE status = 'ACTIVE'`,
      `PRINT 'starting'`); (b) secret-named targets are scrubbed —
      `SET @password = '...'`, a `pwd`/`token`/`secret`/`credential`-named
      column assignment, and a declare-with-default form, case-insensitive;
      (c) steps 1-2 still fire (key=value secret masking / JDBC-URI
      credentials / PEM block in a body still redacted) and the 64KB cap
      still sets `truncated: true`; (d) the result carries the
      `literal_policy: targeted_v2` marker; (e) `redactSnippet` output is
      byte-identical to its historical behaviour on a literal-bearing
      snippet (blanket collapse retained).
    - Skip exhaustive secret-pattern permutation coverage.
  - [x] 1.2 Implement the targeted scrub in `redactFullBody`
    - In `discovery-service/src/utils/snippetRedaction.ts`, replace step 3's
      blanket quoted-literal collapse (full-body path ONLY) with a targeted
      scrub: preserve string literals verbatim EXCEPT where the assignment
      target / column / variable name matches
      `password|token|key|secret|credential` (case-insensitive) — covering
      `SET @var = '...'`, `column = '...'`, and declare-with-default forms.
    - Retain steps 1-2 (secret key=value masking, auth headers, JDBC/URI
      credentials, AWS keys, PEM blocks) and the 64KB UTF-8 cap +
      `truncated` flag unchanged.
    - `redactSnippet` and its call sites are NOT touched.
  - [x] 1.3 Add the redaction-policy version marker
    - The full-body result gains `literal_policy: 'targeted_v2'`; thread it
      into the `stored_procedure_logic` / `trigger_logic` /
      `view_definition` finding detail_json in the proc/trigger/view
      body-capture callers (the `databasePackFindingBuilders.ts` /
      Sybase-pack scanner surfaces) so newly captured bodies self-identify
      and legacy bodies are detectable by marker absence.
    - Update the affected body-capture callers' existing tests for the new
      detail field.
  - [x] 1.4 Ensure the capture-fix tests pass
    - Run ONLY the 2-8 tests written in 1.1 plus the directly updated
      caller tests.
    - Do NOT run the entire discovery-service suite at this stage.

**Acceptance Criteria:**
- The 2-8 tests written in 1.1 pass.
- Secret-named assignments are still scrubbed; ordinary literals survive
  verbatim; truncation cap behaviour unchanged.
- New-policy findings carry `literal_policy: targeted_v2`; legacy bodies are
  detectable downstream by its absence.
- `redactSnippet` behaviour is provably byte-identical.

### AMS Persistence Layer

#### Task Group 2: `db_migration_pack_translations` table + `translation` file kind + full stack
**Dependencies:** None (parallel-safe with Group 1)

The durable home for translation rows, plus the CHECK-constraint extension
for the emitted-file kind, following the Spec-1 `DbMigrationPack*`
entity/service/controller patterns.

- [x] 2.0 Complete the AMS translations persistence layer
  - [x] 2.1 Write 2-8 focused tests for the translations stack
    - Limit to 2-8 highly focused tests maximum (JUnit, modeled on the
      Spec-1 `DbMigrationPack*` service/controller test conventions).
    - Cover ONLY: (a) create translation rows for a pack + read-back round
      trip (snake_case wire, `judge_verdict_json` jsonb intact);
      (b) `translation_key` uniqueness per pack — upsert by key re-links
      rather than duplicates; (c) a sparse PATCH (e.g. review_status +
      reviewer_notes only) leaves pipeline_state, draft_content, and
      fidelity flags untouched (boxed-type/null-guard check); (d) a
      `db_migration_pack_files` row with `file_kind = 'translation'` is
      accepted after the CHECK extension (and one of the original 6 kinds
      still works); (e) list-translations-for-pack returns rows with all
      lifecycle fields for the coverage summary.
    - Skip exhaustive validation-permutation coverage.
  - [x] 2.2 Create the two NEW Liquibase changeset files
    - NEW files numbered `176-...` onward (never touch applied files):
      (1) `db_migration_pack_translations` — id, pack_id FK
      (→ `db_migration_packs`), translation_key (unique per pack),
      object_ref, kind CHECK (`stored_procedure`|`trigger`|`view`),
      disposition CHECK (`translate`|`rewrite_in_app`|`drop`), drop_reason,
      pipeline_state CHECK
      (`pending`|`translating`|`drafted`|`failed`|`needs_manual`),
      source_body text, source_body_hash (SHA-256), truncated boolean,
      legacy_redacted boolean, draft_content text, judge_verdict_json jsonb,
      review_status CHECK
      (`unreviewed`|`approved`|`rejected`|`needs_rework`), reviewer_notes,
      created_at / translated_at / reviewed_at; unique index on
      (pack_id, translation_key), lookup index on pack_id.
    - (2) a SECOND new changeset that drops and re-adds `chk_dmpf_file_kind`
      on `db_migration_pack_files` with the 7th kind `translation`
      (`173-db-migration-pack-files.sql` is immutable — extend via the new
      file only).
  - [x] 2.3 Create JPA entity + repository
    - Follow the Spec-1 `DbMigrationPack*` entity patterns (jsonb columns,
      timestamps). Boxed types (`Boolean`) for the fidelity flags and any
      other PATCH-touchable fields.
  - [x] 2.4 Create service + DTOs (snake_case wire)
    - Service methods: bulk upsert-by-translation_key for a pack (seeding /
      re-link — preserves draft/verdict/review fields on unchanged rows per
      caller-supplied values), get one, list for pack, PATCH (pipeline
      state, draft + verdict together, disposition + drop_reason, review
      status + notes + reviewed_at), delete rows absent from the manifest.
    - DTOs use the AMS snake_case default — no `@CamelCaseWire`.
  - [x] 2.5 Create controller endpoints nested under the existing pack controller path
    - Endpoints: list translations for a pack, get one, bulk upsert, PATCH
      one. Error conventions (404 unknown pack/translation, 400 invalid
      state value) matching the Spec-1 controller patterns.
  - [x] 2.6 Ensure the AMS tests pass
    - Run ONLY the 2-8 tests written in 2.1 (`mvn test -Dtest=...`); verify
      both new changesets apply cleanly on a fresh context start.
    - Do NOT run the entire AMS suite at this stage.

**Acceptance Criteria:**
- The 2-8 tests written in 2.1 pass; changesets `176-...`+ apply cleanly on
  a fresh start (no checksum errors on existing files).
- `translation_key` upsert re-links rather than duplicates; sparse PATCH
  never wipes untouched fields.
- `file_kind = 'translation'` is accepted on pack file rows; the original 6
  kinds still validate.
- All DTOs are snake_case wire.

### Gateway — Translation Pipeline

#### Task Group 3: Seeding, pre-pass, LLM translate + judge, state machine, coverage
**Dependencies:** Task Groups 1, 2

The pipeline core: a new module alongside `gateway/src/services/
dbMigrationPack/` (e.g. `dbMigrationPack/translations.ts`) orchestrated from
`dbMigrationPackHandler.ts`, plus the new routes in
`gateway/src/routes/dbMigrationPack.ts`. LLM appears ONLY in stages 2-3.

- [x] 3.0 Complete the gateway translation pipeline
  - [x] 3.1 Write 2-8 focused tests for the pipeline
    - Limit to 2-8 highly focused tests maximum (Jest, new
      `gateway/src/__tests__/dbMigrationPackTranslations*.test.ts`, AMS +
      LLM client mocked per the `migrationBookOfWorkExpansion` test
      conventions).
    - Cover ONLY: (a) seeding — one row per `requires_translation_spec_2`
      manifest entry with source body resolved from its provenance finding
      detail_json, fidelity flags computed at seed time (`truncated: true`
      finding → `needs_manual` terminal; missing `literal_policy` marker →
      `legacy_redacted: true`); (b) deterministic pre-pass — a body
      containing `NON_PORTABLE_DEFAULT_FUNCTIONS` tokens gets the token
      conversions applied and a known-untranslatable construct is flagged
      (never guessed), with the converted body + flags feeding the
      translation prompt; (c) happy path — translate call → judge call →
      ONE persist as `drafted` carrying both draft and verdict (assert a
      draft is never persisted without its verdict); (d) judge failure
      after one retry → `failed` (retryable), draft NOT reviewable;
      translate validation failure after one retry → `failed`;
      (e) coverage assertion — every manifest object ends in exactly one
      bucket and an artificially unaccounted object FAILS the run;
      (f) Translate-all selects ONLY `pending` + `failed` (skipping
      drafted/approved/dispositioned-away/needs_manual) and re-translate of
      a drafted object resets review_status to `unreviewed` with a fresh
      judge pass; (g) all LLM calls demonstrably route through the shared
      `getMigrationPlanLlmPool()` (mock the pool, count admissions).
    - Skip exhaustive per-construct and per-error permutation coverage.
  - [x] 3.2 Implement seeding + regeneration re-link
    - On pack generation/regeneration (hook in `dbMigrationPackHandler.ts`):
      ensure one translation row per `requires_translation_spec_2` manifest
      entry, source body resolved from `stored_procedure_logic` /
      `trigger_logic` / `view_definition` finding detail_json; compute
      SHA-256 source_body_hash; compute fidelity flags (truncated →
      `needs_manual`; no `literal_policy: targeted_v2` marker →
      `legacy_redacted`).
    - Re-link existing rows by `translation_key` (`kind--object_ref`,
      decision_key pattern): unchanged hash → draft/verdict/disposition/
      review/notes preserved verbatim; changed hash → source_body + hash
      updated and review_status demoted to `needs_rework` with an
      auto-appended explanatory note (approval NEVER silently survives a
      source change); manifest-removed objects deleted deterministically;
      new objects seed as `pending`.
  - [x] 3.3 Implement the deterministic pre-pass (no LLM)
    - Apply the `NON_PORTABLE_DEFAULT_FUNCTIONS` token conversions from
      `databasePackFindingBuilders.ts` to produce a pre-converted body;
      detect known-untranslatable constructs as a flag list — never guess.
    - Output (converted body + flags) feeds the translation prompt.
  - [x] 3.4 Implement the LLM translate call + response validator
    - ONE focused call per object: proc → PL/pgSQL function; trigger →
      Postgres trigger function + `CREATE TRIGGER`; view → Postgres SQL.
      Prompt carries the pre-passed body, the object's schema context (its
      tables/columns from the pack IR in `dbMigrationPack/inputs.ts`), and
      the token hints/flags.
    - Hand-rolled per-rule response validator with the
      `{ ok, value | errors }` shape (modeled on
      `techStackPrefillResponseValidator.ts` /
      `migrationBookOfWorkExpansionValidators.ts` — no schema library).
    - `callWithRetry` one-retry convention; failure after retry →
      pipeline_state `failed` (retryable).
  - [x] 3.5 Implement the verdict-only LLM judge + validator
    - Judge prompt receives source body + draft + schema context; judges
      only, never rewrites. Verdict shape
      `{ verdict, confidence, flags: [{ construct, concern, severity }] }`,
      validated hand-rolled, stored verbatim in `judge_verdict_json`.
    - One retry; failure after retry → `failed` (retryable); the unverified
      draft is NOT persisted as reviewable. A verdict WITH flags does not
      block review — only judge-call failure blocks.
    - Draft + verdict persist together as `drafted` in one PATCH.
  - [x] 3.6 Implement the state machine, coverage ledger, and orchestration
    - pipeline_state transitions: `pending` → `translating` → `drafted` |
      `failed` (retryable) | `needs_manual` (terminal); stale `translating`
      (gateway restart mid-run) surfaced as retryable.
    - Disposition handling (deterministic): `rewrite_in_app` / `drop` (+
      mandatory reason) excluded from translation runs; flipping back to
      `translate` returns the row to `pending`.
    - Translate-all: ONLY `pending` + `failed`; per-object re-translate
      resets review_status to `unreviewed` + fresh judge pass; all calls
      through the one shared pool instance across the run.
    - Code-enforced coverage assertion after every run: every manifest
      object in exactly one bucket; coverage counts computed for the list
      response.
    - `[diag-gateway]` stage-marker logs per object/stage (seed / pre-pass /
      translate / judge / persist), Spec-1 handler convention.
  - [x] 3.7 Add the gateway routes
    - Extend `gateway/src/routes/dbMigrationPack.ts` (existing
      registration): list translations (with coverage summary), translate
      one, translate-all, set disposition (with drop reason), review action
      (approve/reject/needs-rework + notes), retry failed.
    - Proxy persistence to the Group 2 AMS endpoints reusing the file's
      AMS error round-tripping conventions; translate/translate-all
      responses report per-object outcomes (state transitions + failures);
      long bulk runs remain resumable via persisted pipeline state.
  - [x] 3.8 Ensure the pipeline tests pass
    - Run ONLY the 2-8 tests written in 3.1.
    - Do NOT run the entire gateway suite at this stage.

**Acceptance Criteria:**
- The 2-8 tests written in 3.1 pass.
- LLM client usage exists ONLY in the translate + judge calls; seeding,
  pre-pass, ledger, dispositions stay deterministic.
- A draft is never persisted as reviewable without its judge verdict; both
  call types retry once then land `failed` (retryable).
- Coverage assertion fails the run on any unaccounted object; Translate-all
  scope and re-translate semantics match the spec exactly.
- Regeneration re-link preserves unchanged rows verbatim and demotes
  changed-hash rows to `needs_rework` with a note.

### Gateway — Approved-Only Emission

#### Task Group 4: `translations/` zip folder + `050-translations` changelog section
**Dependencies:** Task Group 3

Deterministic emission of approved translations into pack file rows, picked
up unchanged by the existing zip writer, with the approved-only invariant on
the executable path.

- [x] 4.0 Complete the approved-only emission
  - [x] 4.1 Write 2-8 focused tests for emission
    - Limit to 2-8 highly focused tests maximum (Jest, sibling
      `dbMigrationPackTranslationEmission*.test.ts`).
    - Cover ONLY: (a) an approved `translate`-disposition object emits one
      `translation`-kind file row at `translations/<kind>.<schema>.<object>.sql`
      AND its changeset appears in `liquibase/changesets/050-translations.sql`
      referenced from the master changelog; (b) unapproved / rejected /
      needs-rework / dispositioned-away objects appear in NEITHER the file
      rows nor the changelog (approved-only invariant); (c) un-approving
      (approve → needs_rework, e.g. via the regeneration demote) re-runs
      emission and the object drops out of both outputs; (d) changeset ids /
      logicalFilePath are stable functions of object identity — re-emission
      of unchanged approved content is byte-identical (no checksum churn);
      (e) the manifest/readme describe the translations section with
      per-object approval provenance.
    - Skip exhaustive per-kind permutation coverage.
  - [x] 4.2 Implement the dual emission
    - For each approved (disposition `translate`, review_status `approved`)
      translation: one `db_migration_pack_files` row, file_kind
      `translation`, at `translations/<kind>.<schema>.<object>.sql`; plus a
      consolidated `liquibase/changesets/050-translations.sql` formatted-SQL
      section referenced from the master changelog (Spec-1 numbering — 050
      is next after 040-sequences-seed), via the `liquibase.ts` conventions.
    - Changeset ids / logicalFilePath stable per object identity; the
      master changelog includes 050 ONLY when at least one approved
      translation exists.
    - `zip.ts` requires no changes — it assembles from file rows on demand.
  - [x] 4.3 Wire emission triggers
    - Re-run emission whenever a review status changes to/from `approved`
      (the Group 3 review route) and on pack regeneration (after the 3.2
      re-link, so demoted approvals drop out until re-approved).
    - Update the pack manifest and readme to describe the translations
      section and per-object approval provenance.
  - [x] 4.4 Ensure the emission tests pass
    - Run ONLY the 2-8 tests written in 4.1.
    - Do NOT run the entire gateway suite at this stage.

**Acceptance Criteria:**
- The 2-8 tests written in 4.1 pass.
- The executable path (master changelog) only EVER contains approved
  content; no draft-marked emission exists anywhere.
- Approve and un-approve both re-emit correctly; regeneration demote removes
  the object from emission until re-approved.
- Unchanged approved content re-emits byte-identical (no checksum churn).

### Frontend — Translations Tab + Side-by-Side Reviewer

#### Task Group 5: Tab, object list, actions, reviewer, review controls
**Dependencies:** Task Groups 3, 4

The fourth section tab on the Schema Migration surface plus the side-by-side
draft reviewer, following the named existing patterns. No visual assets
exist — follow `DbMigrationPackView.tsx` / `DbMigrationPack.module.css`
styling and the `MigrationDeliveryInlineDiff.tsx` reviewer precedent.

- [x] 5.0 Complete the frontend Translations surface
  - [x] 5.1 Write 2-8 focused tests for the UI
    - Limit to 2-8 highly focused tests maximum (Vitest, alongside the
      Spec-1 `DbMigrationPackView` tests; API module mocked).
    - Cover ONLY: (a) the Translations tab renders the object list (name,
      kind, body size, disposition, pipeline state, review status, judge
      confidence) plus coverage-summary chips from a mocked payload;
      (b) per-object Translate and bulk Translate-all both invoke the API
      (never individual-only) and a `failed` row offers Retry; (c) setting
      disposition `drop` requires a reason before the API call fires;
      (d) the side-by-side reviewer renders source T-SQL left / draft
      PL/pgSQL right with the judge verdict, confidence, and the
      construct/concern/severity flags table; (e) approve / reject /
      needs-rework post the review action with notes and a `needs_manual`
      (truncated) row shows the terminal warning with NO review controls;
      (f) a `legacy_redacted` draft shows the "literals collapsed at
      capture — re-scan recommended" banner.
    - Skip exhaustive per-state and styling coverage.
  - [x] 5.2 Extend `frontend/src/api/dbMigrationPackApi.ts`
    - New typed snake_case functions for the Group 3 routes: list
      translations (+ coverage summary), translate one, translate-all,
      set disposition, review action, retry failed — following the file's
      existing conventions.
  - [x] 5.3 Add the "Translations" section tab to `DbMigrationPackView.tsx`
    - Fourth tab in the existing `sectionTabs` pattern
      (contents / decisions / drift / translations), styled with
      `DbMigrationPack.module.css`.
    - Object list table: object_ref, kind, body size, disposition, pipeline
      state, review status, judge confidence; coverage-summary chips above
      (drafted / approved / rewrite-in-app / dropped / failed / needs-manual
      counts) fed by the list response.
  - [x] 5.4 Build the actions
    - Per-object Translate / Re-translate / Retry AND bulk Translate-all
      (product rule: never individual-only actions); Translate-all targets
      pending + failed only and surfaces per-object outcomes from the
      response (no polling-only behaviour).
    - Per-object disposition control (translate / rewrite-in-app / drop
      with required reason); flipping back to translate returns the row to
      pending; `needs_manual` rows are excluded from Translate-all and show
      no translate action.
    - Stale `translating` rows (gateway restart) render as retryable.
  - [x] 5.5 Build the side-by-side draft reviewer
    - Built on the `MigrationDeliveryInlineDiff.tsx` precedent: source
      T-SQL left, draft PL/pgSQL right; judge verdict + confidence + flags
      table (construct / concern / severity) alongside; NO editing of draft
      content anywhere.
    - Fidelity warning banners rendered prominently: "body truncated at
      capture" (needs_manual — no review possible) and "literals collapsed
      at capture — re-scan recommended" (legacy_redacted — reviewable but
      warned).
    - Review controls: approve / reject / needs-rework, each with optional
      notes (needs-rework notes encouraged); reviewed-at shown after
      action; judge flags inform but never gate the actions.
  - [x] 5.6 Ensure the UI tests pass
    - Run ONLY the 2-8 tests written in 5.1.
    - Confirm net-zero NEW `tsc` errors from this group's changes (large
      pre-existing baseline — verify net-zero new, do NOT chase the
      baseline).
    - Do NOT run the entire frontend suite at this stage.

**Acceptance Criteria:**
- The 2-8 tests written in 5.1 pass; no new `tsc` errors beyond the
  baseline.
- Translations tab, coverage chips, per-object + bulk actions, disposition
  controls, side-by-side reviewer, judge display, fidelity banners, and
  review controls all render from API data per the named patterns.
- Drop requires a reason; needs-manual rows are terminal in the UI; there
  is no draft-editing affordance anywhere.

### Testing

#### Task Group 6: Test Review & Gap Analysis
**Dependencies:** Task Groups 1-5

- [x] 6.0 Review existing tests and fill critical gaps only
  - [x] 6.1 Review tests from Task Groups 1-5
    - Review the 2-8 tests from each group: capture fix (1.1), AMS
      persistence (2.1), translation pipeline (3.1), emission (4.1),
      UI (5.1).
    - Total existing tests: approximately 10-40 across Jest, JUnit, and
      Vitest.
  - [x] 6.2 Analyze test coverage gaps for THIS feature only
    - Priority end-to-end candidates: (a) full lifecycle through the
      gateway routes with AMS + LLM mocked — seed → translate-all →
      drafted-with-verdict → approve → emission produces the
      `translations/` file row + `050-translations` changeset → reject a
      second object → it never reaches emission; (b) regeneration
      survival — unchanged-hash object preserves approval + emission,
      changed-hash object demotes to needs_rework with the auto note AND
      drops out of emission until re-approved, manifest-removed object
      disappears, new object seeds pending; (c) fidelity path — a
      truncated finding lands needs_manual and is skipped by
      Translate-all while a legacy-redacted (no policy marker) body
      translates with the warning flag persisted; (d) coverage summary
      counts agree with the per-bucket row states after a mixed run
      (drafted + failed + dropped + rewrite-in-app + needs_manual).
    - Focus ONLY on gaps related to this spec's requirements; do NOT
      assess whole-application coverage.
  - [x] 6.3 Write up to 10 additional strategic tests maximum
    - Fill the identified critical gaps only — integration points and
      end-to-end workflows over unit gaps.
    - Skip edge cases, performance tests, and accessibility tests unless
      business-critical.
  - [x] 6.4 Run feature-specific tests only
    - Run ONLY tests related to this spec (those from 1.1, 2.1, 3.1, 4.1,
      5.1, and 6.3) — expected total approximately 20-50 tests.
    - Do NOT run the entire test suite of any of the four services.
    - Verify the critical workflows pass.

**Acceptance Criteria:**
- All feature-specific tests pass across discovery-service + gateway
  (Jest), AMS (JUnit), and frontend (Vitest).
- The translate → judge → review → approve → emission and
  regenerate → re-link/demote workflows are covered end-to-end at the
  mocked-service level.
- No more than 10 additional tests added.
- Testing stays scoped to this spec's feature.

## Execution Order

Recommended implementation sequence (dependency-ordered):

1. **Discovery Capture Fix** (Task Group 1) — targeted secret scrub +
   policy marker; independent, smallest surface, defines the
   legacy-detection contract Group 3 reads.
2. **AMS Persistence Layer** (Task Group 2) — translations table, file-kind
   CHECK extension, entity/service/controller stack (parallel-safe with
   Group 1).
3. **Gateway Translation Pipeline** (Task Group 3) — seeding + re-link,
   pre-pass, translate + judge with validators, state machine, coverage
   guarantee, routes.
4. **Approved-Only Emission** (Task Group 4) — zip `translations/` folder +
   `050-translations` changelog section with the approved-only invariant.
5. **Frontend** (Task Group 5) — Translations tab, actions, side-by-side
   reviewer, review controls, fidelity banners.
6. **Test Review & Gap Analysis** (Task Group 6).

## Notes

- **One identity + hash convention, defined once:** `translation_key`
  (`kind--object_ref`) and the SHA-256 source-body hash are computed in one
  shared gateway helper used by seeding (3.2), re-link (3.2), and emission
  id derivation (4.2) — do not re-derive per call site.
- **The policy marker is the legacy detector:** Group 3's
  `legacy_redacted` flag is the ABSENCE of `literal_policy: targeted_v2` on
  the finding — Group 1 must land its marker shape before 3.2 is written,
  and benefiting from the fix requires a re-scan (stated in the warning
  copy).
- **Review-status changes are emission triggers:** the Group 3 review route
  and the regeneration re-link both call the Group 4 emission; build the
  emission as a callable function of (pack, approved rows), not a
  route-inline block.
- **Groups 3 and 4 are one pack-generation hook:** seeding/re-link (3.2)
  and re-emission (4.3) both run inside the Spec-1 regenerate flow — wire
  them as ordered steps of one hook so pack files and translation rows can
  never disagree mid-regeneration.
- **Spec-1 staleness applies unchanged:** translation actions operate
  against the current pack generation; build no new staleness mechanism.
- **`tsx` watch caution (repo rule):** do not edit
  `discovery-service/src/**` while a discovery run is active.
- **Frontend `tsc` baseline:** verify net-zero NEW errors per group; do NOT
  chase the large pre-existing baseline.
