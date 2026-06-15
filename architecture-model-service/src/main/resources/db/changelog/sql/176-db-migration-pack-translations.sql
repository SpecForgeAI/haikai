-- 176-db-migration-pack-translations.sql
-- Spec: LLM-Assisted DB Object Translation Drafts (T-SQL -> PL/pgSQL) with
--       Judge Verification (2026-06-11) -- Task Group 2
--
-- Introduces `db_migration_pack_translations` -- ONE row per object in the
-- pack manifest's requires_translation_spec_2 list (stored procedures /
-- triggers / views). Translation rows are NOT pack file rows: pack files are
-- wholesale delete+insert on regeneration, while this table is the
-- DURABILITY mechanism -- rows survive regeneration via the stable
-- translation_key identity (`kind--object_ref`, the decision_key analogue)
-- plus a source-body hash re-link performed by the gateway.
--
-- Columns:
--   * pack_id            -> FK to db_migration_packs ON DELETE CASCADE.
--   * translation_key    -> stable identity `kind--object_ref`; UNIQUE per
--                           pack (uq_dmpt_pack_translation_key) so
--                           regeneration re-links instead of duplicating.
--   * object_ref / kind  -> human-readable schema.object reference + the
--                           object kind (chk_dmpt_kind).
--   * disposition        -> translate | rewrite_in_app | drop
--                           (chk_dmpt_disposition); drop requires drop_reason
--                           (service-enforced).
--   * pipeline_state     -> pending | translating | drafted | failed |
--                           needs_manual (chk_dmpt_pipeline_state).
--                           needs_manual is TERMINAL (body truncated at
--                           capture); failed is RETRYABLE.
--   * source_body        -> the captured (redacted, size-capped) T-SQL body;
--                           source_body_hash is its SHA-256 -- the re-link
--                           change detector.
--   * truncated /        -> fidelity flags computed at seeding time from the
--     legacy_redacted       finding detail_json (truncated > 64KB cap;
--                           legacy_redacted = no literal_policy marker).
--                           Boxed Booleans in the JPA entity per
--                           project_primitive_double_dto_overwrite.md.
--   * draft_content      -> the LLM-translated PL/pgSQL draft. NEVER emitted
--                           to the zip/changelog unless review_status is
--                           'approved' (approved-only invariant).
--   * judge_verdict_json -> the verdict-only judge output, stored verbatim:
--                           { verdict, confidence, flags: [{construct,
--                           concern, severity}] }. A draft persists as
--                           'drafted' ONLY together with its verdict.
--   * review_status      -> unreviewed | approved | rejected | needs_rework
--                           (chk_dmpt_review_status); reviewer_notes +
--                           reviewed_at ride alongside.
--
-- Per feedback_liquibase_immutable_changesets.md: applied changesets are
-- immutable. This is a NEW changeset only; changesets <= 175 are not edited.

CREATE TABLE db_migration_pack_translations (
  id                 UUID PRIMARY KEY,
  pack_id            UUID NOT NULL,
  translation_key    TEXT NOT NULL,
  object_ref         TEXT NULL,
  kind               VARCHAR(32) NOT NULL,
  disposition        VARCHAR(32) NOT NULL DEFAULT 'translate',
  drop_reason        TEXT NULL,
  pipeline_state     VARCHAR(32) NOT NULL DEFAULT 'pending',
  source_body        TEXT NULL,
  source_body_hash   VARCHAR(80) NULL,
  truncated          BOOLEAN NULL,
  legacy_redacted    BOOLEAN NULL,
  draft_content      TEXT NULL,
  judge_verdict_json JSONB NULL,
  review_status      VARCHAR(32) NOT NULL DEFAULT 'unreviewed',
  reviewer_notes     TEXT NULL,
  created_at         TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  translated_at      TIMESTAMP WITH TIME ZONE NULL,
  reviewed_at        TIMESTAMP WITH TIME ZONE NULL,
  CONSTRAINT chk_dmpt_kind CHECK (kind IN
    ('stored_procedure','trigger','view')),
  CONSTRAINT chk_dmpt_disposition CHECK (disposition IN
    ('translate','rewrite_in_app','drop')),
  CONSTRAINT chk_dmpt_pipeline_state CHECK (pipeline_state IN
    ('pending','translating','drafted','failed','needs_manual')),
  CONSTRAINT chk_dmpt_review_status CHECK (review_status IN
    ('unreviewed','approved','rejected','needs_rework')),
  CONSTRAINT fk_dmpt_pack
    FOREIGN KEY (pack_id) REFERENCES db_migration_packs(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX uq_dmpt_pack_translation_key
  ON db_migration_pack_translations (pack_id, translation_key);

CREATE INDEX idx_dmpt_pack
  ON db_migration_pack_translations (pack_id);

COMMENT ON TABLE db_migration_pack_translations IS
  'One row per requires_translation_spec_2 object (proc/trigger/view). Durable across pack regeneration via translation_key (kind + object_ref) and source_body_hash re-link; NEVER stored as pack file rows. Drafts live ONLY here until explicitly approved. Spec: DB Object Translation Drafts (2026-06-11), Task Group 2.';

COMMENT ON COLUMN db_migration_pack_translations.translation_key IS
  'Stable identity of the form kind, double hyphen, object_ref (decision_key analogue). Unique per pack via uq_dmpt_pack_translation_key; upserts re-link rather than duplicate.';

COMMENT ON COLUMN db_migration_pack_translations.pipeline_state IS
  'pending | translating | drafted | failed | needs_manual. Enforced by chk_dmpt_pipeline_state. failed is retryable; needs_manual (truncated capture) is terminal.';

COMMENT ON COLUMN db_migration_pack_translations.review_status IS
  'unreviewed | approved | rejected | needs_rework. Enforced by chk_dmpt_review_status. Only approved translations are emitted into pack files / the master changelog.';
