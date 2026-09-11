--liquibase formatted sql logicalFilePath:liquibase/changesets/000-schemas.sql
--changeset db-migration-pack:schemas context:structural splitStatements:false
-- PREREQUISITE: the 'citext' extension is REQUIRED by this pack's type mappings.
CREATE EXTENSION IF NOT EXISTS "citext";
-- PREREQUISITE: the 'ltree' extension is REQUIRED by this pack's type mappings.
CREATE EXTENSION IF NOT EXISTS "ltree";
-- PREREQUISITE: the 'postgis' extension is REQUIRED by this pack's type mappings.
CREATE EXTENSION IF NOT EXISTS "postgis";
CREATE SCHEMA IF NOT EXISTS "Ledger";
CREATE SCHEMA IF NOT EXISTS "Ops";
CREATE SEQUENCE IF NOT EXISTS "Ledger"."PostingBatchNumber" AS bigint INCREMENT BY 10 MINVALUE 1000 MAXVALUE 9223372036854775807 START WITH 1000 NO CYCLE;
