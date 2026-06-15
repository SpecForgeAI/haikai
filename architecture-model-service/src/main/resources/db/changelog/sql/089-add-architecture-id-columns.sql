-- ============================================================================
-- Migration 089: Add Nullable architecture_id Column to All In-Scope Tables
-- Spec: Multi-Architecture Plumbing (Spec #1)
--
-- Adds a nullable `architecture_id UUID` column to every in-scope meta-model
-- table. The column is nullable in this changeset; backfill happens in
-- changeset 090, and NOT NULL + FK enforcement happens in changeset 091.
--
-- ============================================================================
-- AUTHORITATIVE IN-SCOPE TABLE LIST
-- ============================================================================
-- The following list was compiled from a sweep of
-- architecture-model-service/src/main/resources/db/changelog/sql/*.sql.
-- Every table here gets architecture_id UUID NOT NULL FK to architecture(id).
--
-- ROOT (project-aware, owns the architecture binding):
--   model_files
--
-- BUSINESS DOMAIN (model_file_id-scoped):
--   business_users, business_processes, process_activities, business_points
--   business_user_business_points, application_point_business_points
--   business_logics, application_point_business_logics
--   user_journeys, activity_steps, user_journey_links
--
-- APPLICATION DOMAIN (model_file_id-scoped):
--   applications, application_components, services
--   interfaces, endpoints, application_points
--   classes, methods
--   package_sets, packages, package_set_default_rules,
--     package_set_standards_import_status
--
-- DATA DOMAIN (model_file_id-scoped):
--   logical_data_entities, logical_data_attributes
--   physical_data_entities, physical_data_attributes
--   logical_data_entity_relationships,
--     logical_data_entity_physical_data_entities,
--     logical_data_attribute_physical_data_attributes
--   data_entity_points, data_movements
--   interface_logical_entities
--
-- INTERACTION DOMAIN (model_file_id-scoped):
--   app_business_points, interactions
--
-- BEHAVIOURAL DOMAIN (model_file_id-scoped):
--   events, states, state_transitions
--   activities, activity_flows, activity_partitions
--   sequence_diagrams
--
-- SEQUENCE DIAGRAM CHILDREN (sequence_diagram_id-scoped):
--   sequence_participants, sequence_messages, sequence_fragments,
--   sequence_operands, sequence_nodes
--
-- UI DOMAIN (model_file_id-scoped):
--   ui_screens, ui_workflow_transitions, ui_components, ui_actions,
--   ui_contracts, ui_characteristics
--
-- DIAGRAM DOMAIN (model_file_id-scoped):
--   diagrams, diagram_nodes, diagram_edges,
--   diagram_interaction_edges, diagram_decorations
--
-- PROJECT-DIRECT META-MODEL (already has project_id):
--   temporary_diagrams
--
-- ============================================================================
-- EXPLICITLY EXCLUDED (NOT in scope for architecture_id):
-- ============================================================================
--   project, delivery_teams, organisations           (not meta-model)
--   work_item, work_item_implement_context,
--     work_item_implement_workspace,
--     project_artifact, product_definitions          (PM/roadmap/product)
--   discovery_config, discovery_run, discovery_evidence,
--     discovery_relationship, discovery_cluster,
--     discovery_cluster_member, discovery_candidate,
--     discovery_decision_task,
--     discovery_candidate_entity_mapping             (deferred to spec #4)
--   architecture, architecture_tag                   (the new tables themselves)
-- ============================================================================

-- -----------------------------------------------------------------------------
-- BATCH A: ROOT
-- -----------------------------------------------------------------------------
ALTER TABLE model_files                                    ADD COLUMN architecture_id UUID NULL;

-- -----------------------------------------------------------------------------
-- BATCH B: BUSINESS DOMAIN
-- -----------------------------------------------------------------------------
ALTER TABLE business_users                                 ADD COLUMN architecture_id UUID NULL;
ALTER TABLE business_processes                             ADD COLUMN architecture_id UUID NULL;
ALTER TABLE process_activities                             ADD COLUMN architecture_id UUID NULL;
ALTER TABLE business_points                                ADD COLUMN architecture_id UUID NULL;
ALTER TABLE business_user_business_points                  ADD COLUMN architecture_id UUID NULL;
ALTER TABLE application_point_business_points              ADD COLUMN architecture_id UUID NULL;
ALTER TABLE business_logics                                ADD COLUMN architecture_id UUID NULL;
ALTER TABLE application_point_business_logics              ADD COLUMN architecture_id UUID NULL;
ALTER TABLE user_journeys                                  ADD COLUMN architecture_id UUID NULL;
ALTER TABLE activity_steps                                 ADD COLUMN architecture_id UUID NULL;
ALTER TABLE user_journey_links                             ADD COLUMN architecture_id UUID NULL;

-- -----------------------------------------------------------------------------
-- BATCH C: APPLICATION DOMAIN
-- -----------------------------------------------------------------------------
ALTER TABLE applications                                   ADD COLUMN architecture_id UUID NULL;
ALTER TABLE application_components                         ADD COLUMN architecture_id UUID NULL;
ALTER TABLE services                                       ADD COLUMN architecture_id UUID NULL;
ALTER TABLE interfaces                                     ADD COLUMN architecture_id UUID NULL;
ALTER TABLE endpoints                                      ADD COLUMN architecture_id UUID NULL;
ALTER TABLE application_points                             ADD COLUMN architecture_id UUID NULL;
ALTER TABLE classes                                        ADD COLUMN architecture_id UUID NULL;
ALTER TABLE methods                                        ADD COLUMN architecture_id UUID NULL;
ALTER TABLE package_sets                                   ADD COLUMN architecture_id UUID NULL;
ALTER TABLE packages                                       ADD COLUMN architecture_id UUID NULL;
ALTER TABLE package_set_default_rules                      ADD COLUMN architecture_id UUID NULL;
ALTER TABLE package_set_standards_import_status            ADD COLUMN architecture_id UUID NULL;

-- -----------------------------------------------------------------------------
-- BATCH D: DATA DOMAIN
-- -----------------------------------------------------------------------------
ALTER TABLE logical_data_entities                          ADD COLUMN architecture_id UUID NULL;
ALTER TABLE logical_data_attributes                        ADD COLUMN architecture_id UUID NULL;
ALTER TABLE physical_data_entities                         ADD COLUMN architecture_id UUID NULL;
ALTER TABLE physical_data_attributes                       ADD COLUMN architecture_id UUID NULL;
ALTER TABLE logical_data_entity_relationships              ADD COLUMN architecture_id UUID NULL;
ALTER TABLE logical_data_entity_physical_data_entities     ADD COLUMN architecture_id UUID NULL;
ALTER TABLE logical_data_attribute_physical_data_attributes ADD COLUMN architecture_id UUID NULL;
ALTER TABLE data_entity_points                             ADD COLUMN architecture_id UUID NULL;
ALTER TABLE data_movements                                 ADD COLUMN architecture_id UUID NULL;
ALTER TABLE interface_logical_entities                     ADD COLUMN architecture_id UUID NULL;

-- -----------------------------------------------------------------------------
-- BATCH E: INTERACTION DOMAIN
-- -----------------------------------------------------------------------------
ALTER TABLE app_business_points                            ADD COLUMN architecture_id UUID NULL;
ALTER TABLE interactions                                   ADD COLUMN architecture_id UUID NULL;

-- -----------------------------------------------------------------------------
-- BATCH F: BEHAVIOURAL DOMAIN (events / states / activities / sequence)
-- -----------------------------------------------------------------------------
ALTER TABLE events                                         ADD COLUMN architecture_id UUID NULL;
ALTER TABLE states                                         ADD COLUMN architecture_id UUID NULL;
ALTER TABLE state_transitions                              ADD COLUMN architecture_id UUID NULL;
ALTER TABLE activities                                     ADD COLUMN architecture_id UUID NULL;
ALTER TABLE activity_flows                                 ADD COLUMN architecture_id UUID NULL;
ALTER TABLE activity_partitions                            ADD COLUMN architecture_id UUID NULL;
ALTER TABLE sequence_diagrams                              ADD COLUMN architecture_id UUID NULL;

-- -----------------------------------------------------------------------------
-- BATCH G: SEQUENCE DIAGRAM CHILDREN
-- -----------------------------------------------------------------------------
ALTER TABLE sequence_participants                          ADD COLUMN architecture_id UUID NULL;
ALTER TABLE sequence_messages                              ADD COLUMN architecture_id UUID NULL;
ALTER TABLE sequence_fragments                             ADD COLUMN architecture_id UUID NULL;
ALTER TABLE sequence_operands                              ADD COLUMN architecture_id UUID NULL;
ALTER TABLE sequence_nodes                                 ADD COLUMN architecture_id UUID NULL;

-- -----------------------------------------------------------------------------
-- BATCH H: UI DOMAIN
-- -----------------------------------------------------------------------------
ALTER TABLE ui_screens                                     ADD COLUMN architecture_id UUID NULL;
ALTER TABLE ui_workflow_transitions                        ADD COLUMN architecture_id UUID NULL;
ALTER TABLE ui_components                                  ADD COLUMN architecture_id UUID NULL;
ALTER TABLE ui_actions                                     ADD COLUMN architecture_id UUID NULL;
ALTER TABLE ui_contracts                                   ADD COLUMN architecture_id UUID NULL;
ALTER TABLE ui_characteristics                             ADD COLUMN architecture_id UUID NULL;

-- -----------------------------------------------------------------------------
-- BATCH I: DIAGRAM DOMAIN
-- -----------------------------------------------------------------------------
ALTER TABLE diagrams                                       ADD COLUMN architecture_id UUID NULL;
ALTER TABLE diagram_nodes                                  ADD COLUMN architecture_id UUID NULL;
ALTER TABLE diagram_edges                                  ADD COLUMN architecture_id UUID NULL;
ALTER TABLE diagram_interaction_edges                      ADD COLUMN architecture_id UUID NULL;
ALTER TABLE diagram_decorations                            ADD COLUMN architecture_id UUID NULL;

-- -----------------------------------------------------------------------------
-- BATCH J: PROJECT-DIRECT META-MODEL
-- -----------------------------------------------------------------------------
ALTER TABLE temporary_diagrams                             ADD COLUMN architecture_id UUID NULL;
