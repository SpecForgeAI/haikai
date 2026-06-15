-- ============================================================================
-- Migration 097: BEFORE INSERT trigger to auto-derive architecture_id
-- Spec: Hotfix for Spec #1 / Spec #6 / Spec #7 (Multi-Architecture Plumbing)
--
-- Problem:
--   Spec #1's Group 2 (and Spec #4 for discovery_run) added an `architectureId`
--   field to ONLY a small set of JPA entities (ModelFileEntity,
--   TemporaryDiagramEntity, DiscoveryRunEntity). The 56 OTHER in-scope tables
--   ALL got an `architecture_id UUID NOT NULL` column at the DB layer
--   (changesets 089/090/091) but their JPA entities never gained the field.
--   Existing rows continued to work because changeset 090 backfilled them, but
--   any NEW INSERT issued by JPA fails with:
--     null value in column "architecture_id" of relation "applications"
--     violates not-null constraint
--   because Hibernate omits the unmapped column from the INSERT statement.
--
-- Fix:
--   Add a PostgreSQL `BEFORE INSERT` trigger on every in-scope table whose JPA
--   entity does not know about `architecture_id`. The trigger derives the
--   value from the row's parent (model_files, sequence_diagrams, or
--   sequence_fragments) at insert time. The trigger only fires when
--   architecture_id is NULL, so explicit values from any future JPA mapping or
--   from raw-SQL inserts still take priority.
--
-- Idempotency:
--   - Functions are CREATE OR REPLACE.
--   - Triggers are DROP TRIGGER IF EXISTS ... CREATE TRIGGER (re-create
--     pattern is the safe equivalent of "create if not exists" for triggers
--     in PostgreSQL).
--   - The whole changeset is wrapped so re-running cleanly drops and
--     re-creates everything to the same state.
--
-- Tables WITH JPA `architectureId` field (NO trigger needed -- JPA writes the
-- column itself):
--   - model_files                  (project_id-direct, JPA has the field)
--   - temporary_diagrams           (project_id-direct, JPA has the field)
--   - discovery_run                (Spec #4, JPA has the field)
--
-- DERIVATION CHAINS COVERED BY THIS TRIGGER FAMILY:
--   - model_file_id -> model_files.architecture_id      (53 tables)
--   - sequence_diagram_id -> sequence_diagrams.architecture_id (4 tables)
--   - fragment_id -> sequence_fragments.architecture_id (1 table)
-- ============================================================================

-- -----------------------------------------------------------------------------
-- FUNCTION 1: derive architecture_id from NEW.model_file_id
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_architecture_id_from_model_file()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.architecture_id IS NULL AND NEW.model_file_id IS NOT NULL THEN
        SELECT mf.architecture_id INTO NEW.architecture_id
          FROM model_files mf
         WHERE mf.id = NEW.model_file_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- FUNCTION 2: derive architecture_id from NEW.sequence_diagram_id
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_architecture_id_from_sequence_diagram()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.architecture_id IS NULL AND NEW.sequence_diagram_id IS NOT NULL THEN
        SELECT sd.architecture_id INTO NEW.architecture_id
          FROM sequence_diagrams sd
         WHERE sd.id = NEW.sequence_diagram_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- FUNCTION 3: derive architecture_id from NEW.fragment_id (sequence_operands)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_architecture_id_from_sequence_fragment()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.architecture_id IS NULL AND NEW.fragment_id IS NOT NULL THEN
        SELECT sf.architecture_id INTO NEW.architecture_id
          FROM sequence_fragments sf
         WHERE sf.id = NEW.fragment_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- BATCH B: BUSINESS DOMAIN -- model_file_id-derived
-- ============================================================================
DROP TRIGGER IF EXISTS trg_set_architecture_id ON business_users;
CREATE TRIGGER trg_set_architecture_id BEFORE INSERT ON business_users
FOR EACH ROW EXECUTE FUNCTION set_architecture_id_from_model_file();

DROP TRIGGER IF EXISTS trg_set_architecture_id ON business_processes;
CREATE TRIGGER trg_set_architecture_id BEFORE INSERT ON business_processes
FOR EACH ROW EXECUTE FUNCTION set_architecture_id_from_model_file();

DROP TRIGGER IF EXISTS trg_set_architecture_id ON process_activities;
CREATE TRIGGER trg_set_architecture_id BEFORE INSERT ON process_activities
FOR EACH ROW EXECUTE FUNCTION set_architecture_id_from_model_file();

DROP TRIGGER IF EXISTS trg_set_architecture_id ON business_points;
CREATE TRIGGER trg_set_architecture_id BEFORE INSERT ON business_points
FOR EACH ROW EXECUTE FUNCTION set_architecture_id_from_model_file();

DROP TRIGGER IF EXISTS trg_set_architecture_id ON business_user_business_points;
CREATE TRIGGER trg_set_architecture_id BEFORE INSERT ON business_user_business_points
FOR EACH ROW EXECUTE FUNCTION set_architecture_id_from_model_file();

DROP TRIGGER IF EXISTS trg_set_architecture_id ON application_point_business_points;
CREATE TRIGGER trg_set_architecture_id BEFORE INSERT ON application_point_business_points
FOR EACH ROW EXECUTE FUNCTION set_architecture_id_from_model_file();

DROP TRIGGER IF EXISTS trg_set_architecture_id ON business_logics;
CREATE TRIGGER trg_set_architecture_id BEFORE INSERT ON business_logics
FOR EACH ROW EXECUTE FUNCTION set_architecture_id_from_model_file();

DROP TRIGGER IF EXISTS trg_set_architecture_id ON application_point_business_logics;
CREATE TRIGGER trg_set_architecture_id BEFORE INSERT ON application_point_business_logics
FOR EACH ROW EXECUTE FUNCTION set_architecture_id_from_model_file();

DROP TRIGGER IF EXISTS trg_set_architecture_id ON user_journeys;
CREATE TRIGGER trg_set_architecture_id BEFORE INSERT ON user_journeys
FOR EACH ROW EXECUTE FUNCTION set_architecture_id_from_model_file();

DROP TRIGGER IF EXISTS trg_set_architecture_id ON activity_steps;
CREATE TRIGGER trg_set_architecture_id BEFORE INSERT ON activity_steps
FOR EACH ROW EXECUTE FUNCTION set_architecture_id_from_model_file();

DROP TRIGGER IF EXISTS trg_set_architecture_id ON user_journey_links;
CREATE TRIGGER trg_set_architecture_id BEFORE INSERT ON user_journey_links
FOR EACH ROW EXECUTE FUNCTION set_architecture_id_from_model_file();

-- ============================================================================
-- BATCH C: APPLICATION DOMAIN
-- ============================================================================
DROP TRIGGER IF EXISTS trg_set_architecture_id ON applications;
CREATE TRIGGER trg_set_architecture_id BEFORE INSERT ON applications
FOR EACH ROW EXECUTE FUNCTION set_architecture_id_from_model_file();

DROP TRIGGER IF EXISTS trg_set_architecture_id ON application_components;
CREATE TRIGGER trg_set_architecture_id BEFORE INSERT ON application_components
FOR EACH ROW EXECUTE FUNCTION set_architecture_id_from_model_file();

DROP TRIGGER IF EXISTS trg_set_architecture_id ON services;
CREATE TRIGGER trg_set_architecture_id BEFORE INSERT ON services
FOR EACH ROW EXECUTE FUNCTION set_architecture_id_from_model_file();

DROP TRIGGER IF EXISTS trg_set_architecture_id ON interfaces;
CREATE TRIGGER trg_set_architecture_id BEFORE INSERT ON interfaces
FOR EACH ROW EXECUTE FUNCTION set_architecture_id_from_model_file();

DROP TRIGGER IF EXISTS trg_set_architecture_id ON endpoints;
CREATE TRIGGER trg_set_architecture_id BEFORE INSERT ON endpoints
FOR EACH ROW EXECUTE FUNCTION set_architecture_id_from_model_file();

DROP TRIGGER IF EXISTS trg_set_architecture_id ON application_points;
CREATE TRIGGER trg_set_architecture_id BEFORE INSERT ON application_points
FOR EACH ROW EXECUTE FUNCTION set_architecture_id_from_model_file();

DROP TRIGGER IF EXISTS trg_set_architecture_id ON classes;
CREATE TRIGGER trg_set_architecture_id BEFORE INSERT ON classes
FOR EACH ROW EXECUTE FUNCTION set_architecture_id_from_model_file();

DROP TRIGGER IF EXISTS trg_set_architecture_id ON methods;
CREATE TRIGGER trg_set_architecture_id BEFORE INSERT ON methods
FOR EACH ROW EXECUTE FUNCTION set_architecture_id_from_model_file();

DROP TRIGGER IF EXISTS trg_set_architecture_id ON package_sets;
CREATE TRIGGER trg_set_architecture_id BEFORE INSERT ON package_sets
FOR EACH ROW EXECUTE FUNCTION set_architecture_id_from_model_file();

DROP TRIGGER IF EXISTS trg_set_architecture_id ON packages;
CREATE TRIGGER trg_set_architecture_id BEFORE INSERT ON packages
FOR EACH ROW EXECUTE FUNCTION set_architecture_id_from_model_file();

DROP TRIGGER IF EXISTS trg_set_architecture_id ON package_set_default_rules;
CREATE TRIGGER trg_set_architecture_id BEFORE INSERT ON package_set_default_rules
FOR EACH ROW EXECUTE FUNCTION set_architecture_id_from_model_file();

DROP TRIGGER IF EXISTS trg_set_architecture_id ON package_set_standards_import_status;
CREATE TRIGGER trg_set_architecture_id BEFORE INSERT ON package_set_standards_import_status
FOR EACH ROW EXECUTE FUNCTION set_architecture_id_from_model_file();

-- ============================================================================
-- BATCH D: DATA DOMAIN
-- ============================================================================
DROP TRIGGER IF EXISTS trg_set_architecture_id ON logical_data_entities;
CREATE TRIGGER trg_set_architecture_id BEFORE INSERT ON logical_data_entities
FOR EACH ROW EXECUTE FUNCTION set_architecture_id_from_model_file();

DROP TRIGGER IF EXISTS trg_set_architecture_id ON logical_data_attributes;
CREATE TRIGGER trg_set_architecture_id BEFORE INSERT ON logical_data_attributes
FOR EACH ROW EXECUTE FUNCTION set_architecture_id_from_model_file();

DROP TRIGGER IF EXISTS trg_set_architecture_id ON physical_data_entities;
CREATE TRIGGER trg_set_architecture_id BEFORE INSERT ON physical_data_entities
FOR EACH ROW EXECUTE FUNCTION set_architecture_id_from_model_file();

DROP TRIGGER IF EXISTS trg_set_architecture_id ON physical_data_attributes;
CREATE TRIGGER trg_set_architecture_id BEFORE INSERT ON physical_data_attributes
FOR EACH ROW EXECUTE FUNCTION set_architecture_id_from_model_file();

DROP TRIGGER IF EXISTS trg_set_architecture_id ON logical_data_entity_relationships;
CREATE TRIGGER trg_set_architecture_id BEFORE INSERT ON logical_data_entity_relationships
FOR EACH ROW EXECUTE FUNCTION set_architecture_id_from_model_file();

DROP TRIGGER IF EXISTS trg_set_architecture_id ON logical_data_entity_physical_data_entities;
CREATE TRIGGER trg_set_architecture_id BEFORE INSERT ON logical_data_entity_physical_data_entities
FOR EACH ROW EXECUTE FUNCTION set_architecture_id_from_model_file();

DROP TRIGGER IF EXISTS trg_set_architecture_id ON logical_data_attribute_physical_data_attributes;
CREATE TRIGGER trg_set_architecture_id BEFORE INSERT ON logical_data_attribute_physical_data_attributes
FOR EACH ROW EXECUTE FUNCTION set_architecture_id_from_model_file();

DROP TRIGGER IF EXISTS trg_set_architecture_id ON data_entity_points;
CREATE TRIGGER trg_set_architecture_id BEFORE INSERT ON data_entity_points
FOR EACH ROW EXECUTE FUNCTION set_architecture_id_from_model_file();

DROP TRIGGER IF EXISTS trg_set_architecture_id ON data_movements;
CREATE TRIGGER trg_set_architecture_id BEFORE INSERT ON data_movements
FOR EACH ROW EXECUTE FUNCTION set_architecture_id_from_model_file();

DROP TRIGGER IF EXISTS trg_set_architecture_id ON interface_logical_entities;
CREATE TRIGGER trg_set_architecture_id BEFORE INSERT ON interface_logical_entities
FOR EACH ROW EXECUTE FUNCTION set_architecture_id_from_model_file();

-- ============================================================================
-- BATCH E: INTERACTION DOMAIN
-- ============================================================================
DROP TRIGGER IF EXISTS trg_set_architecture_id ON app_business_points;
CREATE TRIGGER trg_set_architecture_id BEFORE INSERT ON app_business_points
FOR EACH ROW EXECUTE FUNCTION set_architecture_id_from_model_file();

DROP TRIGGER IF EXISTS trg_set_architecture_id ON interactions;
CREATE TRIGGER trg_set_architecture_id BEFORE INSERT ON interactions
FOR EACH ROW EXECUTE FUNCTION set_architecture_id_from_model_file();

-- ============================================================================
-- BATCH F: BEHAVIOURAL DOMAIN (events / states / activities / sequence parents)
-- ============================================================================
DROP TRIGGER IF EXISTS trg_set_architecture_id ON events;
CREATE TRIGGER trg_set_architecture_id BEFORE INSERT ON events
FOR EACH ROW EXECUTE FUNCTION set_architecture_id_from_model_file();

DROP TRIGGER IF EXISTS trg_set_architecture_id ON states;
CREATE TRIGGER trg_set_architecture_id BEFORE INSERT ON states
FOR EACH ROW EXECUTE FUNCTION set_architecture_id_from_model_file();

DROP TRIGGER IF EXISTS trg_set_architecture_id ON state_transitions;
CREATE TRIGGER trg_set_architecture_id BEFORE INSERT ON state_transitions
FOR EACH ROW EXECUTE FUNCTION set_architecture_id_from_model_file();

DROP TRIGGER IF EXISTS trg_set_architecture_id ON activities;
CREATE TRIGGER trg_set_architecture_id BEFORE INSERT ON activities
FOR EACH ROW EXECUTE FUNCTION set_architecture_id_from_model_file();

DROP TRIGGER IF EXISTS trg_set_architecture_id ON activity_flows;
CREATE TRIGGER trg_set_architecture_id BEFORE INSERT ON activity_flows
FOR EACH ROW EXECUTE FUNCTION set_architecture_id_from_model_file();

DROP TRIGGER IF EXISTS trg_set_architecture_id ON activity_partitions;
CREATE TRIGGER trg_set_architecture_id BEFORE INSERT ON activity_partitions
FOR EACH ROW EXECUTE FUNCTION set_architecture_id_from_model_file();

DROP TRIGGER IF EXISTS trg_set_architecture_id ON sequence_diagrams;
CREATE TRIGGER trg_set_architecture_id BEFORE INSERT ON sequence_diagrams
FOR EACH ROW EXECUTE FUNCTION set_architecture_id_from_model_file();

-- ============================================================================
-- BATCH G: SEQUENCE DIAGRAM CHILDREN -- derived via sequence_diagrams
-- (sequence_operands is special: derived via sequence_fragments)
-- ============================================================================
DROP TRIGGER IF EXISTS trg_set_architecture_id ON sequence_participants;
CREATE TRIGGER trg_set_architecture_id BEFORE INSERT ON sequence_participants
FOR EACH ROW EXECUTE FUNCTION set_architecture_id_from_sequence_diagram();

DROP TRIGGER IF EXISTS trg_set_architecture_id ON sequence_messages;
CREATE TRIGGER trg_set_architecture_id BEFORE INSERT ON sequence_messages
FOR EACH ROW EXECUTE FUNCTION set_architecture_id_from_sequence_diagram();

DROP TRIGGER IF EXISTS trg_set_architecture_id ON sequence_fragments;
CREATE TRIGGER trg_set_architecture_id BEFORE INSERT ON sequence_fragments
FOR EACH ROW EXECUTE FUNCTION set_architecture_id_from_sequence_diagram();

DROP TRIGGER IF EXISTS trg_set_architecture_id ON sequence_nodes;
CREATE TRIGGER trg_set_architecture_id BEFORE INSERT ON sequence_nodes
FOR EACH ROW EXECUTE FUNCTION set_architecture_id_from_sequence_diagram();

DROP TRIGGER IF EXISTS trg_set_architecture_id ON sequence_operands;
CREATE TRIGGER trg_set_architecture_id BEFORE INSERT ON sequence_operands
FOR EACH ROW EXECUTE FUNCTION set_architecture_id_from_sequence_fragment();

-- ============================================================================
-- BATCH H: UI DOMAIN
-- ============================================================================
DROP TRIGGER IF EXISTS trg_set_architecture_id ON ui_screens;
CREATE TRIGGER trg_set_architecture_id BEFORE INSERT ON ui_screens
FOR EACH ROW EXECUTE FUNCTION set_architecture_id_from_model_file();

DROP TRIGGER IF EXISTS trg_set_architecture_id ON ui_workflow_transitions;
CREATE TRIGGER trg_set_architecture_id BEFORE INSERT ON ui_workflow_transitions
FOR EACH ROW EXECUTE FUNCTION set_architecture_id_from_model_file();

DROP TRIGGER IF EXISTS trg_set_architecture_id ON ui_components;
CREATE TRIGGER trg_set_architecture_id BEFORE INSERT ON ui_components
FOR EACH ROW EXECUTE FUNCTION set_architecture_id_from_model_file();

DROP TRIGGER IF EXISTS trg_set_architecture_id ON ui_actions;
CREATE TRIGGER trg_set_architecture_id BEFORE INSERT ON ui_actions
FOR EACH ROW EXECUTE FUNCTION set_architecture_id_from_model_file();

DROP TRIGGER IF EXISTS trg_set_architecture_id ON ui_contracts;
CREATE TRIGGER trg_set_architecture_id BEFORE INSERT ON ui_contracts
FOR EACH ROW EXECUTE FUNCTION set_architecture_id_from_model_file();

DROP TRIGGER IF EXISTS trg_set_architecture_id ON ui_characteristics;
CREATE TRIGGER trg_set_architecture_id BEFORE INSERT ON ui_characteristics
FOR EACH ROW EXECUTE FUNCTION set_architecture_id_from_model_file();

-- ============================================================================
-- BATCH I: DIAGRAM DOMAIN
-- ============================================================================
DROP TRIGGER IF EXISTS trg_set_architecture_id ON diagrams;
CREATE TRIGGER trg_set_architecture_id BEFORE INSERT ON diagrams
FOR EACH ROW EXECUTE FUNCTION set_architecture_id_from_model_file();

DROP TRIGGER IF EXISTS trg_set_architecture_id ON diagram_nodes;
CREATE TRIGGER trg_set_architecture_id BEFORE INSERT ON diagram_nodes
FOR EACH ROW EXECUTE FUNCTION set_architecture_id_from_model_file();

DROP TRIGGER IF EXISTS trg_set_architecture_id ON diagram_edges;
CREATE TRIGGER trg_set_architecture_id BEFORE INSERT ON diagram_edges
FOR EACH ROW EXECUTE FUNCTION set_architecture_id_from_model_file();

DROP TRIGGER IF EXISTS trg_set_architecture_id ON diagram_interaction_edges;
CREATE TRIGGER trg_set_architecture_id BEFORE INSERT ON diagram_interaction_edges
FOR EACH ROW EXECUTE FUNCTION set_architecture_id_from_model_file();

DROP TRIGGER IF EXISTS trg_set_architecture_id ON diagram_decorations;
CREATE TRIGGER trg_set_architecture_id BEFORE INSERT ON diagram_decorations
FOR EACH ROW EXECUTE FUNCTION set_architecture_id_from_model_file();
