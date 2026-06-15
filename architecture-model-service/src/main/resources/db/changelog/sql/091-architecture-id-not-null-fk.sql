-- ============================================================================
-- Migration 091: Enforce NOT NULL + Foreign Key on architecture_id
-- Spec: Multi-Architecture Plumbing (Spec #1)
--
-- After backfill (changeset 090), every in-scope row should have a non-null
-- architecture_id pointing at the project's `Default` architecture. This
-- changeset:
--   1. Adds the FK constraint architecture_id -> architecture(id) for every
--      in-scope table.
--   2. Sets NOT NULL on architecture_id for all tables EXCEPT model_files
--      (whose project_id is itself nullable per migration 051 to support
--      file-only mode without a project).
--   3. Adds composite (project_id, architecture_id) indexes where the table
--      already has a project_id column AND its existing query patterns
--      benefit (model_files, temporary_diagrams).
--
-- Failure mode if pre-existing data has orphans (rows whose model_file_id
-- chain doesn't reach a project, hence no architecture): the SET NOT NULL
-- will fail with a clear error pointing at the offending table. The operator
-- must then resolve the orphan before re-running.
-- ============================================================================

-- ============================================================================
-- STEP 1: Add FK constraints for every in-scope table.
-- Naming convention: fk_<table>_architecture
-- ============================================================================

-- ROOT
ALTER TABLE model_files                                    ADD CONSTRAINT fk_model_files_architecture                                    FOREIGN KEY (architecture_id) REFERENCES architecture(id);

-- BUSINESS DOMAIN
ALTER TABLE business_users                                 ADD CONSTRAINT fk_business_users_architecture                                 FOREIGN KEY (architecture_id) REFERENCES architecture(id);
ALTER TABLE business_processes                             ADD CONSTRAINT fk_business_processes_architecture                             FOREIGN KEY (architecture_id) REFERENCES architecture(id);
ALTER TABLE process_activities                             ADD CONSTRAINT fk_process_activities_architecture                             FOREIGN KEY (architecture_id) REFERENCES architecture(id);
ALTER TABLE business_points                                ADD CONSTRAINT fk_business_points_architecture                                FOREIGN KEY (architecture_id) REFERENCES architecture(id);
ALTER TABLE business_user_business_points                  ADD CONSTRAINT fk_business_user_business_points_architecture                  FOREIGN KEY (architecture_id) REFERENCES architecture(id);
ALTER TABLE application_point_business_points              ADD CONSTRAINT fk_application_point_business_points_architecture              FOREIGN KEY (architecture_id) REFERENCES architecture(id);
ALTER TABLE business_logics                                ADD CONSTRAINT fk_business_logics_architecture                                FOREIGN KEY (architecture_id) REFERENCES architecture(id);
ALTER TABLE application_point_business_logics              ADD CONSTRAINT fk_application_point_business_logics_architecture              FOREIGN KEY (architecture_id) REFERENCES architecture(id);
ALTER TABLE user_journeys                                  ADD CONSTRAINT fk_user_journeys_architecture                                  FOREIGN KEY (architecture_id) REFERENCES architecture(id);
ALTER TABLE activity_steps                                 ADD CONSTRAINT fk_activity_steps_architecture                                 FOREIGN KEY (architecture_id) REFERENCES architecture(id);
ALTER TABLE user_journey_links                             ADD CONSTRAINT fk_user_journey_links_architecture                             FOREIGN KEY (architecture_id) REFERENCES architecture(id);

-- APPLICATION DOMAIN
ALTER TABLE applications                                   ADD CONSTRAINT fk_applications_architecture                                   FOREIGN KEY (architecture_id) REFERENCES architecture(id);
ALTER TABLE application_components                         ADD CONSTRAINT fk_application_components_architecture                         FOREIGN KEY (architecture_id) REFERENCES architecture(id);
ALTER TABLE services                                       ADD CONSTRAINT fk_services_architecture                                       FOREIGN KEY (architecture_id) REFERENCES architecture(id);
ALTER TABLE interfaces                                     ADD CONSTRAINT fk_interfaces_architecture                                     FOREIGN KEY (architecture_id) REFERENCES architecture(id);
ALTER TABLE endpoints                                      ADD CONSTRAINT fk_endpoints_architecture                                      FOREIGN KEY (architecture_id) REFERENCES architecture(id);
ALTER TABLE application_points                             ADD CONSTRAINT fk_application_points_architecture                             FOREIGN KEY (architecture_id) REFERENCES architecture(id);
ALTER TABLE classes                                        ADD CONSTRAINT fk_classes_architecture                                        FOREIGN KEY (architecture_id) REFERENCES architecture(id);
ALTER TABLE methods                                        ADD CONSTRAINT fk_methods_architecture                                        FOREIGN KEY (architecture_id) REFERENCES architecture(id);
ALTER TABLE package_sets                                   ADD CONSTRAINT fk_package_sets_architecture                                   FOREIGN KEY (architecture_id) REFERENCES architecture(id);
ALTER TABLE packages                                       ADD CONSTRAINT fk_packages_architecture                                       FOREIGN KEY (architecture_id) REFERENCES architecture(id);
ALTER TABLE package_set_default_rules                      ADD CONSTRAINT fk_package_set_default_rules_architecture                      FOREIGN KEY (architecture_id) REFERENCES architecture(id);
ALTER TABLE package_set_standards_import_status            ADD CONSTRAINT fk_package_set_standards_import_status_architecture            FOREIGN KEY (architecture_id) REFERENCES architecture(id);

-- DATA DOMAIN
ALTER TABLE logical_data_entities                          ADD CONSTRAINT fk_logical_data_entities_architecture                          FOREIGN KEY (architecture_id) REFERENCES architecture(id);
ALTER TABLE logical_data_attributes                        ADD CONSTRAINT fk_logical_data_attributes_architecture                        FOREIGN KEY (architecture_id) REFERENCES architecture(id);
ALTER TABLE physical_data_entities                         ADD CONSTRAINT fk_physical_data_entities_architecture                         FOREIGN KEY (architecture_id) REFERENCES architecture(id);
ALTER TABLE physical_data_attributes                       ADD CONSTRAINT fk_physical_data_attributes_architecture                       FOREIGN KEY (architecture_id) REFERENCES architecture(id);
ALTER TABLE logical_data_entity_relationships              ADD CONSTRAINT fk_logical_data_entity_relationships_architecture              FOREIGN KEY (architecture_id) REFERENCES architecture(id);
ALTER TABLE logical_data_entity_physical_data_entities     ADD CONSTRAINT fk_logical_data_entity_physical_data_entities_architecture     FOREIGN KEY (architecture_id) REFERENCES architecture(id);
ALTER TABLE logical_data_attribute_physical_data_attributes ADD CONSTRAINT fk_logical_data_attribute_physical_data_attributes_architecture FOREIGN KEY (architecture_id) REFERENCES architecture(id);
ALTER TABLE data_entity_points                             ADD CONSTRAINT fk_data_entity_points_architecture                             FOREIGN KEY (architecture_id) REFERENCES architecture(id);
ALTER TABLE data_movements                                 ADD CONSTRAINT fk_data_movements_architecture                                 FOREIGN KEY (architecture_id) REFERENCES architecture(id);
ALTER TABLE interface_logical_entities                     ADD CONSTRAINT fk_interface_logical_entities_architecture                     FOREIGN KEY (architecture_id) REFERENCES architecture(id);

-- INTERACTION DOMAIN
ALTER TABLE app_business_points                            ADD CONSTRAINT fk_app_business_points_architecture                            FOREIGN KEY (architecture_id) REFERENCES architecture(id);
ALTER TABLE interactions                                   ADD CONSTRAINT fk_interactions_architecture                                   FOREIGN KEY (architecture_id) REFERENCES architecture(id);

-- BEHAVIOURAL DOMAIN
ALTER TABLE events                                         ADD CONSTRAINT fk_events_architecture                                         FOREIGN KEY (architecture_id) REFERENCES architecture(id);
ALTER TABLE states                                         ADD CONSTRAINT fk_states_architecture                                         FOREIGN KEY (architecture_id) REFERENCES architecture(id);
ALTER TABLE state_transitions                              ADD CONSTRAINT fk_state_transitions_architecture                              FOREIGN KEY (architecture_id) REFERENCES architecture(id);
ALTER TABLE activities                                     ADD CONSTRAINT fk_activities_architecture                                     FOREIGN KEY (architecture_id) REFERENCES architecture(id);
ALTER TABLE activity_flows                                 ADD CONSTRAINT fk_activity_flows_architecture                                 FOREIGN KEY (architecture_id) REFERENCES architecture(id);
ALTER TABLE activity_partitions                            ADD CONSTRAINT fk_activity_partitions_architecture                            FOREIGN KEY (architecture_id) REFERENCES architecture(id);
ALTER TABLE sequence_diagrams                              ADD CONSTRAINT fk_sequence_diagrams_architecture                              FOREIGN KEY (architecture_id) REFERENCES architecture(id);

-- SEQUENCE DIAGRAM CHILDREN
ALTER TABLE sequence_participants                          ADD CONSTRAINT fk_sequence_participants_architecture                          FOREIGN KEY (architecture_id) REFERENCES architecture(id);
ALTER TABLE sequence_messages                              ADD CONSTRAINT fk_sequence_messages_architecture                              FOREIGN KEY (architecture_id) REFERENCES architecture(id);
ALTER TABLE sequence_fragments                             ADD CONSTRAINT fk_sequence_fragments_architecture                             FOREIGN KEY (architecture_id) REFERENCES architecture(id);
ALTER TABLE sequence_operands                              ADD CONSTRAINT fk_sequence_operands_architecture                              FOREIGN KEY (architecture_id) REFERENCES architecture(id);
ALTER TABLE sequence_nodes                                 ADD CONSTRAINT fk_sequence_nodes_architecture                                 FOREIGN KEY (architecture_id) REFERENCES architecture(id);

-- UI DOMAIN
ALTER TABLE ui_screens                                     ADD CONSTRAINT fk_ui_screens_architecture                                     FOREIGN KEY (architecture_id) REFERENCES architecture(id);
ALTER TABLE ui_workflow_transitions                        ADD CONSTRAINT fk_ui_workflow_transitions_architecture                        FOREIGN KEY (architecture_id) REFERENCES architecture(id);
ALTER TABLE ui_components                                  ADD CONSTRAINT fk_ui_components_architecture                                  FOREIGN KEY (architecture_id) REFERENCES architecture(id);
ALTER TABLE ui_actions                                     ADD CONSTRAINT fk_ui_actions_architecture                                     FOREIGN KEY (architecture_id) REFERENCES architecture(id);
ALTER TABLE ui_contracts                                   ADD CONSTRAINT fk_ui_contracts_architecture                                   FOREIGN KEY (architecture_id) REFERENCES architecture(id);
ALTER TABLE ui_characteristics                             ADD CONSTRAINT fk_ui_characteristics_architecture                             FOREIGN KEY (architecture_id) REFERENCES architecture(id);

-- DIAGRAM DOMAIN
ALTER TABLE diagrams                                       ADD CONSTRAINT fk_diagrams_architecture                                       FOREIGN KEY (architecture_id) REFERENCES architecture(id);
ALTER TABLE diagram_nodes                                  ADD CONSTRAINT fk_diagram_nodes_architecture                                  FOREIGN KEY (architecture_id) REFERENCES architecture(id);
ALTER TABLE diagram_edges                                  ADD CONSTRAINT fk_diagram_edges_architecture                                  FOREIGN KEY (architecture_id) REFERENCES architecture(id);
ALTER TABLE diagram_interaction_edges                      ADD CONSTRAINT fk_diagram_interaction_edges_architecture                      FOREIGN KEY (architecture_id) REFERENCES architecture(id);
ALTER TABLE diagram_decorations                            ADD CONSTRAINT fk_diagram_decorations_architecture                            FOREIGN KEY (architecture_id) REFERENCES architecture(id);

-- PROJECT-DIRECT META-MODEL
ALTER TABLE temporary_diagrams                             ADD CONSTRAINT fk_temporary_diagrams_architecture                             FOREIGN KEY (architecture_id) REFERENCES architecture(id);

-- ============================================================================
-- STEP 2: Enforce NOT NULL on architecture_id where the row's project chain
-- can always be resolved.
-- model_files is intentionally EXCLUDED here -- its own project_id is nullable
-- (per migration 051) to support file-only mode without a project. If
-- model_files.project_id is null, model_files.architecture_id must also be
-- nullable.
-- ============================================================================

-- BUSINESS DOMAIN
ALTER TABLE business_users                                 ALTER COLUMN architecture_id SET NOT NULL;
ALTER TABLE business_processes                             ALTER COLUMN architecture_id SET NOT NULL;
ALTER TABLE process_activities                             ALTER COLUMN architecture_id SET NOT NULL;
ALTER TABLE business_points                                ALTER COLUMN architecture_id SET NOT NULL;
ALTER TABLE business_user_business_points                  ALTER COLUMN architecture_id SET NOT NULL;
ALTER TABLE application_point_business_points              ALTER COLUMN architecture_id SET NOT NULL;
ALTER TABLE business_logics                                ALTER COLUMN architecture_id SET NOT NULL;
ALTER TABLE application_point_business_logics              ALTER COLUMN architecture_id SET NOT NULL;
ALTER TABLE user_journeys                                  ALTER COLUMN architecture_id SET NOT NULL;
ALTER TABLE activity_steps                                 ALTER COLUMN architecture_id SET NOT NULL;
ALTER TABLE user_journey_links                             ALTER COLUMN architecture_id SET NOT NULL;

-- APPLICATION DOMAIN
ALTER TABLE applications                                   ALTER COLUMN architecture_id SET NOT NULL;
ALTER TABLE application_components                         ALTER COLUMN architecture_id SET NOT NULL;
ALTER TABLE services                                       ALTER COLUMN architecture_id SET NOT NULL;
ALTER TABLE interfaces                                     ALTER COLUMN architecture_id SET NOT NULL;
ALTER TABLE endpoints                                      ALTER COLUMN architecture_id SET NOT NULL;
ALTER TABLE application_points                             ALTER COLUMN architecture_id SET NOT NULL;
ALTER TABLE classes                                        ALTER COLUMN architecture_id SET NOT NULL;
ALTER TABLE methods                                        ALTER COLUMN architecture_id SET NOT NULL;
ALTER TABLE package_sets                                   ALTER COLUMN architecture_id SET NOT NULL;
ALTER TABLE packages                                       ALTER COLUMN architecture_id SET NOT NULL;
ALTER TABLE package_set_default_rules                      ALTER COLUMN architecture_id SET NOT NULL;
ALTER TABLE package_set_standards_import_status            ALTER COLUMN architecture_id SET NOT NULL;

-- DATA DOMAIN
ALTER TABLE logical_data_entities                          ALTER COLUMN architecture_id SET NOT NULL;
ALTER TABLE logical_data_attributes                        ALTER COLUMN architecture_id SET NOT NULL;
ALTER TABLE physical_data_entities                         ALTER COLUMN architecture_id SET NOT NULL;
ALTER TABLE physical_data_attributes                       ALTER COLUMN architecture_id SET NOT NULL;
ALTER TABLE logical_data_entity_relationships              ALTER COLUMN architecture_id SET NOT NULL;
ALTER TABLE logical_data_entity_physical_data_entities     ALTER COLUMN architecture_id SET NOT NULL;
ALTER TABLE logical_data_attribute_physical_data_attributes ALTER COLUMN architecture_id SET NOT NULL;
ALTER TABLE data_entity_points                             ALTER COLUMN architecture_id SET NOT NULL;
ALTER TABLE data_movements                                 ALTER COLUMN architecture_id SET NOT NULL;
ALTER TABLE interface_logical_entities                     ALTER COLUMN architecture_id SET NOT NULL;

-- INTERACTION DOMAIN
ALTER TABLE app_business_points                            ALTER COLUMN architecture_id SET NOT NULL;
ALTER TABLE interactions                                   ALTER COLUMN architecture_id SET NOT NULL;

-- BEHAVIOURAL DOMAIN
ALTER TABLE events                                         ALTER COLUMN architecture_id SET NOT NULL;
ALTER TABLE states                                         ALTER COLUMN architecture_id SET NOT NULL;
ALTER TABLE state_transitions                              ALTER COLUMN architecture_id SET NOT NULL;
ALTER TABLE activities                                     ALTER COLUMN architecture_id SET NOT NULL;
ALTER TABLE activity_flows                                 ALTER COLUMN architecture_id SET NOT NULL;
ALTER TABLE activity_partitions                            ALTER COLUMN architecture_id SET NOT NULL;
ALTER TABLE sequence_diagrams                              ALTER COLUMN architecture_id SET NOT NULL;

-- SEQUENCE DIAGRAM CHILDREN
ALTER TABLE sequence_participants                          ALTER COLUMN architecture_id SET NOT NULL;
ALTER TABLE sequence_messages                              ALTER COLUMN architecture_id SET NOT NULL;
ALTER TABLE sequence_fragments                             ALTER COLUMN architecture_id SET NOT NULL;
ALTER TABLE sequence_operands                              ALTER COLUMN architecture_id SET NOT NULL;
ALTER TABLE sequence_nodes                                 ALTER COLUMN architecture_id SET NOT NULL;

-- UI DOMAIN
ALTER TABLE ui_screens                                     ALTER COLUMN architecture_id SET NOT NULL;
ALTER TABLE ui_workflow_transitions                        ALTER COLUMN architecture_id SET NOT NULL;
ALTER TABLE ui_components                                  ALTER COLUMN architecture_id SET NOT NULL;
ALTER TABLE ui_actions                                     ALTER COLUMN architecture_id SET NOT NULL;
ALTER TABLE ui_contracts                                   ALTER COLUMN architecture_id SET NOT NULL;
ALTER TABLE ui_characteristics                             ALTER COLUMN architecture_id SET NOT NULL;

-- DIAGRAM DOMAIN
ALTER TABLE diagrams                                       ALTER COLUMN architecture_id SET NOT NULL;
ALTER TABLE diagram_nodes                                  ALTER COLUMN architecture_id SET NOT NULL;
ALTER TABLE diagram_edges                                  ALTER COLUMN architecture_id SET NOT NULL;
ALTER TABLE diagram_interaction_edges                      ALTER COLUMN architecture_id SET NOT NULL;
ALTER TABLE diagram_decorations                            ALTER COLUMN architecture_id SET NOT NULL;

-- PROJECT-DIRECT META-MODEL
ALTER TABLE temporary_diagrams                             ALTER COLUMN architecture_id SET NOT NULL;

-- ============================================================================
-- STEP 3: Composite (project_id, architecture_id) indexes for tables with both
-- columns where existing query patterns benefit (model_files, temporary_diagrams).
-- ============================================================================

CREATE INDEX idx_model_files_project_architecture
  ON model_files(project_id, architecture_id);

CREATE INDEX idx_temporary_diagrams_project_architecture
  ON temporary_diagrams(project_id, architecture_id);

-- For all model_file_id-scoped tables, the existing model_file_id index already
-- supports the dominant query pattern. A pure architecture_id index is sufficient
-- for the new architecture-scoped query patterns introduced in spec #1's
-- Bucket A controllers.

-- Single-column architecture_id indexes for fast architecture-scoped lookups
-- on the highest-traffic tables (the ones in the meta-model summary endpoint
-- and the model load endpoint). These complement the existing model_file_id
-- indexes rather than replace them.

CREATE INDEX idx_applications_architecture                 ON applications(architecture_id);
CREATE INDEX idx_application_components_architecture       ON application_components(architecture_id);
CREATE INDEX idx_services_architecture                     ON services(architecture_id);
CREATE INDEX idx_interfaces_architecture                   ON interfaces(architecture_id);
CREATE INDEX idx_endpoints_architecture                    ON endpoints(architecture_id);
CREATE INDEX idx_application_points_architecture           ON application_points(architecture_id);
CREATE INDEX idx_logical_data_entities_architecture        ON logical_data_entities(architecture_id);
CREATE INDEX idx_physical_data_entities_architecture       ON physical_data_entities(architecture_id);
CREATE INDEX idx_diagrams_architecture                     ON diagrams(architecture_id);
CREATE INDEX idx_user_journeys_architecture                ON user_journeys(architecture_id);
