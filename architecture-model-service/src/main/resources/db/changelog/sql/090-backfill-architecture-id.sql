-- ============================================================================
-- Migration 090: Backfill architecture_id on All In-Scope Tables
-- Spec: Multi-Architecture Plumbing (Spec #1)
--
-- For every existing row in every in-scope meta-model table, sets
-- architecture_id to the project's `Default` architecture id (created in
-- changeset 088). Resolution path differs by table:
--
--   - model_files:           model_files.project_id            -> architecture(project_id, name='Default')
--   - temporary_diagrams:    temporary_diagrams.project_id     -> architecture(project_id, name='Default')
--   - all model_file_id-scoped: parent.model_file_id -> model_files.project_id -> architecture(project_id, name='Default')
--   - sequence_diagram children: sequence_diagram_id -> sequence_diagrams.architecture_id (chained backfill)
--
-- Idempotency: every UPDATE has a `WHERE architecture_id IS NULL` guard, so
-- re-running this changeset is a no-op (zero rows updated).
--
-- Order matters: parents (model_files, sequence_diagrams) must be backfilled
-- BEFORE their children, because the child resolution chains through the
-- parent's already-populated architecture_id.
-- ============================================================================

-- -----------------------------------------------------------------------------
-- STEP 1: model_files (root) -- resolves directly via its own project_id.
-- -----------------------------------------------------------------------------
UPDATE model_files mf
SET architecture_id = (
    SELECT a.id FROM architecture a
    WHERE a.project_id = mf.project_id AND a.name = 'Default'
    LIMIT 1
)
WHERE mf.architecture_id IS NULL
  AND mf.project_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- STEP 2: temporary_diagrams -- resolves directly via its own project_id.
-- -----------------------------------------------------------------------------
UPDATE temporary_diagrams td
SET architecture_id = (
    SELECT a.id FROM architecture a
    WHERE a.project_id = td.project_id AND a.name = 'Default'
    LIMIT 1
)
WHERE td.architecture_id IS NULL;

-- -----------------------------------------------------------------------------
-- STEP 3: BUSINESS DOMAIN -- resolve via model_file -> project -> architecture.
-- -----------------------------------------------------------------------------
UPDATE business_users                       SET architecture_id = (SELECT mf.architecture_id FROM model_files mf WHERE mf.id = business_users.model_file_id)                       WHERE architecture_id IS NULL;
UPDATE business_processes                   SET architecture_id = (SELECT mf.architecture_id FROM model_files mf WHERE mf.id = business_processes.model_file_id)                   WHERE architecture_id IS NULL;
UPDATE process_activities                   SET architecture_id = (SELECT mf.architecture_id FROM model_files mf WHERE mf.id = process_activities.model_file_id)                   WHERE architecture_id IS NULL;
UPDATE business_points                      SET architecture_id = (SELECT mf.architecture_id FROM model_files mf WHERE mf.id = business_points.model_file_id)                      WHERE architecture_id IS NULL;
UPDATE business_user_business_points        SET architecture_id = (SELECT mf.architecture_id FROM model_files mf WHERE mf.id = business_user_business_points.model_file_id)        WHERE architecture_id IS NULL;
UPDATE application_point_business_points    SET architecture_id = (SELECT mf.architecture_id FROM model_files mf WHERE mf.id = application_point_business_points.model_file_id)    WHERE architecture_id IS NULL;
UPDATE business_logics                      SET architecture_id = (SELECT mf.architecture_id FROM model_files mf WHERE mf.id = business_logics.model_file_id)                      WHERE architecture_id IS NULL;
UPDATE application_point_business_logics    SET architecture_id = (SELECT mf.architecture_id FROM model_files mf WHERE mf.id = application_point_business_logics.model_file_id)    WHERE architecture_id IS NULL;
UPDATE user_journeys                        SET architecture_id = (SELECT mf.architecture_id FROM model_files mf WHERE mf.id = user_journeys.model_file_id)                        WHERE architecture_id IS NULL;
UPDATE activity_steps                       SET architecture_id = (SELECT mf.architecture_id FROM model_files mf WHERE mf.id = activity_steps.model_file_id)                       WHERE architecture_id IS NULL;
UPDATE user_journey_links                   SET architecture_id = (SELECT mf.architecture_id FROM model_files mf WHERE mf.id = user_journey_links.model_file_id)                   WHERE architecture_id IS NULL;

-- -----------------------------------------------------------------------------
-- STEP 4: APPLICATION DOMAIN
-- -----------------------------------------------------------------------------
UPDATE applications                         SET architecture_id = (SELECT mf.architecture_id FROM model_files mf WHERE mf.id = applications.model_file_id)                         WHERE architecture_id IS NULL;
UPDATE application_components               SET architecture_id = (SELECT mf.architecture_id FROM model_files mf WHERE mf.id = application_components.model_file_id)               WHERE architecture_id IS NULL;
UPDATE services                             SET architecture_id = (SELECT mf.architecture_id FROM model_files mf WHERE mf.id = services.model_file_id)                             WHERE architecture_id IS NULL;
UPDATE interfaces                           SET architecture_id = (SELECT mf.architecture_id FROM model_files mf WHERE mf.id = interfaces.model_file_id)                           WHERE architecture_id IS NULL;
UPDATE endpoints                            SET architecture_id = (SELECT mf.architecture_id FROM model_files mf WHERE mf.id = endpoints.model_file_id)                            WHERE architecture_id IS NULL;
UPDATE application_points                   SET architecture_id = (SELECT mf.architecture_id FROM model_files mf WHERE mf.id = application_points.model_file_id)                   WHERE architecture_id IS NULL;
UPDATE classes                              SET architecture_id = (SELECT mf.architecture_id FROM model_files mf WHERE mf.id = classes.model_file_id)                              WHERE architecture_id IS NULL;
UPDATE methods                              SET architecture_id = (SELECT mf.architecture_id FROM model_files mf WHERE mf.id = methods.model_file_id)                              WHERE architecture_id IS NULL;
UPDATE package_sets                         SET architecture_id = (SELECT mf.architecture_id FROM model_files mf WHERE mf.id = package_sets.model_file_id)                         WHERE architecture_id IS NULL;
UPDATE packages                             SET architecture_id = (SELECT mf.architecture_id FROM model_files mf WHERE mf.id = packages.model_file_id)                             WHERE architecture_id IS NULL;
UPDATE package_set_default_rules            SET architecture_id = (SELECT mf.architecture_id FROM model_files mf WHERE mf.id = package_set_default_rules.model_file_id)            WHERE architecture_id IS NULL;
UPDATE package_set_standards_import_status  SET architecture_id = (SELECT mf.architecture_id FROM model_files mf WHERE mf.id = package_set_standards_import_status.model_file_id)  WHERE architecture_id IS NULL;

-- -----------------------------------------------------------------------------
-- STEP 5: DATA DOMAIN
-- -----------------------------------------------------------------------------
UPDATE logical_data_entities                            SET architecture_id = (SELECT mf.architecture_id FROM model_files mf WHERE mf.id = logical_data_entities.model_file_id)                            WHERE architecture_id IS NULL;
UPDATE logical_data_attributes                          SET architecture_id = (SELECT mf.architecture_id FROM model_files mf WHERE mf.id = logical_data_attributes.model_file_id)                          WHERE architecture_id IS NULL;
UPDATE physical_data_entities                           SET architecture_id = (SELECT mf.architecture_id FROM model_files mf WHERE mf.id = physical_data_entities.model_file_id)                           WHERE architecture_id IS NULL;
UPDATE physical_data_attributes                         SET architecture_id = (SELECT mf.architecture_id FROM model_files mf WHERE mf.id = physical_data_attributes.model_file_id)                         WHERE architecture_id IS NULL;
UPDATE logical_data_entity_relationships                SET architecture_id = (SELECT mf.architecture_id FROM model_files mf WHERE mf.id = logical_data_entity_relationships.model_file_id)                WHERE architecture_id IS NULL;
UPDATE logical_data_entity_physical_data_entities       SET architecture_id = (SELECT mf.architecture_id FROM model_files mf WHERE mf.id = logical_data_entity_physical_data_entities.model_file_id)       WHERE architecture_id IS NULL;
UPDATE logical_data_attribute_physical_data_attributes  SET architecture_id = (SELECT mf.architecture_id FROM model_files mf WHERE mf.id = logical_data_attribute_physical_data_attributes.model_file_id)  WHERE architecture_id IS NULL;
UPDATE data_entity_points                               SET architecture_id = (SELECT mf.architecture_id FROM model_files mf WHERE mf.id = data_entity_points.model_file_id)                               WHERE architecture_id IS NULL;
UPDATE data_movements                                   SET architecture_id = (SELECT mf.architecture_id FROM model_files mf WHERE mf.id = data_movements.model_file_id)                                   WHERE architecture_id IS NULL;
UPDATE interface_logical_entities                       SET architecture_id = (SELECT mf.architecture_id FROM model_files mf WHERE mf.id = interface_logical_entities.model_file_id)                       WHERE architecture_id IS NULL;

-- -----------------------------------------------------------------------------
-- STEP 6: INTERACTION DOMAIN
-- -----------------------------------------------------------------------------
UPDATE app_business_points                  SET architecture_id = (SELECT mf.architecture_id FROM model_files mf WHERE mf.id = app_business_points.model_file_id)                  WHERE architecture_id IS NULL;
UPDATE interactions                         SET architecture_id = (SELECT mf.architecture_id FROM model_files mf WHERE mf.id = interactions.model_file_id)                         WHERE architecture_id IS NULL;

-- -----------------------------------------------------------------------------
-- STEP 7: BEHAVIOURAL DOMAIN (events / states / activities / sequence parents)
-- -----------------------------------------------------------------------------
UPDATE events                               SET architecture_id = (SELECT mf.architecture_id FROM model_files mf WHERE mf.id = events.model_file_id)                               WHERE architecture_id IS NULL;
UPDATE states                               SET architecture_id = (SELECT mf.architecture_id FROM model_files mf WHERE mf.id = states.model_file_id)                               WHERE architecture_id IS NULL;
UPDATE state_transitions                    SET architecture_id = (SELECT mf.architecture_id FROM model_files mf WHERE mf.id = state_transitions.model_file_id)                    WHERE architecture_id IS NULL;
UPDATE activities                           SET architecture_id = (SELECT mf.architecture_id FROM model_files mf WHERE mf.id = activities.model_file_id)                           WHERE architecture_id IS NULL;
UPDATE activity_flows                       SET architecture_id = (SELECT mf.architecture_id FROM model_files mf WHERE mf.id = activity_flows.model_file_id)                       WHERE architecture_id IS NULL;
UPDATE activity_partitions                  SET architecture_id = (SELECT mf.architecture_id FROM model_files mf WHERE mf.id = activity_partitions.model_file_id)                  WHERE architecture_id IS NULL;
UPDATE sequence_diagrams                    SET architecture_id = (SELECT mf.architecture_id FROM model_files mf WHERE mf.id = sequence_diagrams.model_file_id)                    WHERE architecture_id IS NULL;

-- -----------------------------------------------------------------------------
-- STEP 8: SEQUENCE DIAGRAM CHILDREN -- chain through sequence_diagrams.architecture_id (now populated by step 7).
-- -----------------------------------------------------------------------------
UPDATE sequence_participants  SET architecture_id = (SELECT sd.architecture_id FROM sequence_diagrams sd WHERE sd.id = sequence_participants.sequence_diagram_id)  WHERE architecture_id IS NULL;
UPDATE sequence_messages      SET architecture_id = (SELECT sd.architecture_id FROM sequence_diagrams sd WHERE sd.id = sequence_messages.sequence_diagram_id)      WHERE architecture_id IS NULL;
UPDATE sequence_fragments     SET architecture_id = (SELECT sd.architecture_id FROM sequence_diagrams sd WHERE sd.id = sequence_fragments.sequence_diagram_id)     WHERE architecture_id IS NULL;
UPDATE sequence_nodes         SET architecture_id = (SELECT sd.architecture_id FROM sequence_diagrams sd WHERE sd.id = sequence_nodes.sequence_diagram_id)         WHERE architecture_id IS NULL;
-- sequence_operands is scoped to fragments, not directly to a sequence_diagram. Chain through fragments.
UPDATE sequence_operands      SET architecture_id = (SELECT sf.architecture_id FROM sequence_fragments sf WHERE sf.id = sequence_operands.fragment_id)             WHERE architecture_id IS NULL;

-- -----------------------------------------------------------------------------
-- STEP 9: UI DOMAIN
-- -----------------------------------------------------------------------------
UPDATE ui_screens                           SET architecture_id = (SELECT mf.architecture_id FROM model_files mf WHERE mf.id = ui_screens.model_file_id)                           WHERE architecture_id IS NULL;
UPDATE ui_workflow_transitions              SET architecture_id = (SELECT mf.architecture_id FROM model_files mf WHERE mf.id = ui_workflow_transitions.model_file_id)              WHERE architecture_id IS NULL;
UPDATE ui_components                        SET architecture_id = (SELECT mf.architecture_id FROM model_files mf WHERE mf.id = ui_components.model_file_id)                        WHERE architecture_id IS NULL;
UPDATE ui_actions                           SET architecture_id = (SELECT mf.architecture_id FROM model_files mf WHERE mf.id = ui_actions.model_file_id)                           WHERE architecture_id IS NULL;
UPDATE ui_contracts                         SET architecture_id = (SELECT mf.architecture_id FROM model_files mf WHERE mf.id = ui_contracts.model_file_id)                         WHERE architecture_id IS NULL;
UPDATE ui_characteristics                   SET architecture_id = (SELECT mf.architecture_id FROM model_files mf WHERE mf.id = ui_characteristics.model_file_id)                   WHERE architecture_id IS NULL;

-- -----------------------------------------------------------------------------
-- STEP 10: DIAGRAM DOMAIN
-- -----------------------------------------------------------------------------
UPDATE diagrams                             SET architecture_id = (SELECT mf.architecture_id FROM model_files mf WHERE mf.id = diagrams.model_file_id)                             WHERE architecture_id IS NULL;
UPDATE diagram_nodes                        SET architecture_id = (SELECT mf.architecture_id FROM model_files mf WHERE mf.id = diagram_nodes.model_file_id)                        WHERE architecture_id IS NULL;
UPDATE diagram_edges                        SET architecture_id = (SELECT mf.architecture_id FROM model_files mf WHERE mf.id = diagram_edges.model_file_id)                        WHERE architecture_id IS NULL;
UPDATE diagram_interaction_edges            SET architecture_id = (SELECT mf.architecture_id FROM model_files mf WHERE mf.id = diagram_interaction_edges.model_file_id)            WHERE architecture_id IS NULL;
UPDATE diagram_decorations                  SET architecture_id = (SELECT mf.architecture_id FROM model_files mf WHERE mf.id = diagram_decorations.model_file_id)                  WHERE architecture_id IS NULL;
