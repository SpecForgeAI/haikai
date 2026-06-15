-- liquibase formatted sql
-- changeset gjohnston:2026-04-20-tech-hints-resolved
--
-- Spec: Tech Hints LLM Resolution
--
-- Adds five columns to the services table to persist the save-time, LLM-assisted
-- resolution of the free-text core_tech hint against the closed set of registered
-- language and framework packs. Columns are all nullable so existing rows default
-- to NULL (unresolved) and the discovery run tier gate can reject them until the
-- user re-saves the row.
--
-- Column notes:
--   * core_tech_resolved            - Full resolver response JSON (language,
--                                     frameworks, confirmationSentence,
--                                     repoCrossCheck). NULL = unresolved.
--   * core_tech_language_pack       - Denormalised language pack ID (e.g.
--                                     'java-21'). NULL when the resolver could
--                                     not match a registered language pack.
--   * core_tech_framework_packs     - Denormalised framework pack IDs. Stored as
--                                     JSONB (string array) for consistency with
--                                     all other list columns in this service.
--                                     Empty array allowed; NULL = unresolved.
--   * core_tech_resolution_confidence - One of 'high','low','none','tech-only',
--                                     'manual-override'. Enforced via CHECK
--                                     constraint. NULL = unresolved.
--   * core_tech_resolved_at         - Instant the resolve was persisted. Used
--                                     by the frontend to compute staleness.

ALTER TABLE services
    ADD COLUMN core_tech_resolved JSONB NULL;

ALTER TABLE services
    ADD COLUMN core_tech_language_pack VARCHAR(100) NULL;

ALTER TABLE services
    ADD COLUMN core_tech_framework_packs JSONB NULL;

ALTER TABLE services
    ADD COLUMN core_tech_resolution_confidence VARCHAR(20) NULL;

ALTER TABLE services
    ADD CONSTRAINT services_core_tech_resolution_confidence_check
    CHECK (core_tech_resolution_confidence IS NULL
           OR core_tech_resolution_confidence IN ('high','low','none','tech-only','manual-override'));

ALTER TABLE services
    ADD COLUMN core_tech_resolved_at TIMESTAMP WITH TIME ZONE NULL;

-- rollback ALTER TABLE services DROP CONSTRAINT IF EXISTS services_core_tech_resolution_confidence_check;
-- rollback ALTER TABLE services DROP COLUMN IF EXISTS core_tech_resolved_at;
-- rollback ALTER TABLE services DROP COLUMN IF EXISTS core_tech_resolution_confidence;
-- rollback ALTER TABLE services DROP COLUMN IF EXISTS core_tech_framework_packs;
-- rollback ALTER TABLE services DROP COLUMN IF EXISTS core_tech_language_pack;
-- rollback ALTER TABLE services DROP COLUMN IF EXISTS core_tech_resolved;
