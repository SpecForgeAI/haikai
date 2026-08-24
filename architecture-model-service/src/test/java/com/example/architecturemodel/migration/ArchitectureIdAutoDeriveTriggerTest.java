package com.example.architecturemodel.migration;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Inventory test for changeset 097 (architecture_id auto-derive trigger).
 *
 * The PostgreSQL trigger SQL cannot be exercised in the test profile (H2 +
 * Liquibase disabled + ddl-auto=create-drop). Instead, this test validates
 * the SQL content of the changeset by parsing it from the classpath and
 * asserting:
 *   1. The three derivation functions are declared.
 *   2. Every in-scope table (the 56 tables that lack a JPA architectureId
 *      field) has a corresponding CREATE TRIGGER statement.
 *   3. The 3 tables WITH a JPA architectureId field (model_files,
 *      temporary_diagrams, discovery_run) are NOT trigger-managed -- those
 *      entities populate the column themselves.
 *   4. Tables route to the correct derivation function (model_file vs
 *      sequence_diagram vs sequence_fragment).
 *
 * Spec: Hotfix for Spec #1 / Spec #6 / Spec #7 -- changeset 097.
 */
class ArchitectureIdAutoDeriveTriggerTest {

    private static final String CHANGESET_PATH =
        "db/changelog/sql/097-architecture-id-auto-derive-trigger.sql";

    /** 53 tables that derive architecture_id via model_files. */
    private static final List<String> MODEL_FILE_DERIVED_TABLES = List.of(
        // Business
        "business_users", "business_processes", "process_activities",
        "business_points", "business_user_business_points",
        "application_point_business_points", "business_logics",
        "application_point_business_logics", "user_journeys",
        "activity_steps", "user_journey_links",
        // Application
        "applications", "application_components", "services", "interfaces",
        "endpoints", "application_points", "classes", "methods",
        "package_sets", "packages", "package_set_default_rules",
        "package_set_standards_import_status",
        // Data
        "logical_data_entities", "logical_data_attributes",
        "physical_data_entities", "physical_data_attributes",
        "logical_data_entity_relationships",
        "logical_data_entity_physical_data_entities",
        "logical_data_attribute_physical_data_attributes",
        "data_entity_points", "data_movements", "interface_logical_entities",
        // Interaction
        "app_business_points", "interactions",
        // Behavioural (events / states / activities / sequence parents)
        "events", "states", "state_transitions",
        "activities", "activity_flows", "activity_partitions",
        "sequence_diagrams",
        // UI
        "ui_screens", "ui_workflow_transitions", "ui_components",
        "ui_actions", "ui_contracts", "ui_characteristics",
        // Diagram
        "diagrams", "diagram_nodes", "diagram_edges",
        "diagram_interaction_edges", "diagram_decorations"
    );

    /** 4 sequence-diagram-children tables that derive via sequence_diagrams. */
    private static final List<String> SEQUENCE_DIAGRAM_DERIVED_TABLES = List.of(
        "sequence_participants", "sequence_messages",
        "sequence_fragments", "sequence_nodes"
    );

    /** 1 fragment child that derives via sequence_fragments. */
    private static final List<String> FRAGMENT_DERIVED_TABLES = List.of(
        "sequence_operands"
    );

    /** Tables whose JPA entity has the architectureId field -- these MUST NOT be trigger-managed. */
    private static final List<String> JPA_MANAGED_TABLES = List.of(
        "model_files", "temporary_diagrams", "discovery_run"
    );

    @Test
    @DisplayName("Changeset 097 exists on the classpath and declares the three derivation functions")
    void changesetDeclaresThreeDerivationFunctions() throws IOException {
        String sql = readChangeset();

        assertThat(sql)
            .as("function for model_file derivation must exist")
            .contains("CREATE OR REPLACE FUNCTION set_architecture_id_from_model_file()");
        assertThat(sql)
            .as("function for sequence_diagram derivation must exist")
            .contains("CREATE OR REPLACE FUNCTION set_architecture_id_from_sequence_diagram()");
        assertThat(sql)
            .as("function for sequence_fragment derivation must exist")
            .contains("CREATE OR REPLACE FUNCTION set_architecture_id_from_sequence_fragment()");

        // The functions must guard against overwriting an explicit value and
        // must guard against a NULL parent FK (else the SELECT subquery would
        // silently set architecture_id to NULL, leading to a confusing NOT NULL
        // violation downstream).
        assertThat(sql)
            .as("functions must only fire when architecture_id IS NULL")
            .contains("IF NEW.architecture_id IS NULL");
    }

    @Test
    @DisplayName("Every in-scope table that lacks a JPA architectureId field has a BEFORE INSERT trigger")
    void everyInScopeTableHasABeforeInsertTrigger() throws IOException {
        String sql = readChangeset();

        Set<String> allCoveredTables = new LinkedHashSet<>();
        allCoveredTables.addAll(MODEL_FILE_DERIVED_TABLES);
        allCoveredTables.addAll(SEQUENCE_DIAGRAM_DERIVED_TABLES);
        allCoveredTables.addAll(FRAGMENT_DERIVED_TABLES);

        // Sanity: 53 + 4 + 1 = 58 tables covered (matches the spec inventory).
        assertThat(allCoveredTables)
            .as("trigger inventory size matches the in-scope-without-JPA-field count")
            .hasSize(58);

        for (String table : allCoveredTables) {
            assertThat(sql)
                .as("table '%s' must have a BEFORE INSERT trigger", table)
                .contains("CREATE TRIGGER trg_set_architecture_id BEFORE INSERT ON " + table);
            assertThat(sql)
                .as("table '%s' must have an idempotent DROP TRIGGER guard", table)
                .contains("DROP TRIGGER IF EXISTS trg_set_architecture_id ON " + table);
        }
    }

    @Test
    @DisplayName("Tables WITH a JPA architectureId field are NOT trigger-managed (model_files, temporary_diagrams, discovery_run)")
    void jpaManagedTablesAreNotTriggerManaged() throws IOException {
        String sql = readChangeset();

        for (String table : JPA_MANAGED_TABLES) {
            assertThat(sql)
                .as("table '%s' has a JPA architectureId field; trigger would be redundant", table)
                .doesNotContain("CREATE TRIGGER trg_set_architecture_id BEFORE INSERT ON " + table + "\n");
        }
    }

    @Test
    @DisplayName("Each table routes to the correct derivation function (model_file / sequence_diagram / sequence_fragment)")
    void eachTableRoutesToCorrectDerivationFunction() throws IOException {
        String sql = readChangeset();

        // Every model_file-derived table must call the model_file function.
        for (String table : MODEL_FILE_DERIVED_TABLES) {
            String expected =
                "CREATE TRIGGER trg_set_architecture_id BEFORE INSERT ON " + table + "\n" +
                "FOR EACH ROW EXECUTE FUNCTION set_architecture_id_from_model_file();";
            assertThat(sql)
                .as("table '%s' must derive via set_architecture_id_from_model_file()", table)
                .contains(expected);
        }

        // Every sequence_diagram-derived table must call the sequence_diagram function.
        for (String table : SEQUENCE_DIAGRAM_DERIVED_TABLES) {
            String expected =
                "CREATE TRIGGER trg_set_architecture_id BEFORE INSERT ON " + table + "\n" +
                "FOR EACH ROW EXECUTE FUNCTION set_architecture_id_from_sequence_diagram();";
            assertThat(sql)
                .as("table '%s' must derive via set_architecture_id_from_sequence_diagram()", table)
                .contains(expected);
        }

        // sequence_operands must call the sequence_fragment function.
        for (String table : FRAGMENT_DERIVED_TABLES) {
            String expected =
                "CREATE TRIGGER trg_set_architecture_id BEFORE INSERT ON " + table + "\n" +
                "FOR EACH ROW EXECUTE FUNCTION set_architecture_id_from_sequence_fragment();";
            assertThat(sql)
                .as("table '%s' must derive via set_architecture_id_from_sequence_fragment()", table)
                .contains(expected);
        }
    }

    // ------------------------------------------------------------------------

    private String readChangeset() throws IOException {
        try (InputStream is = getClass().getClassLoader().getResourceAsStream(CHANGESET_PATH)) {
            assertThat(is)
                .as("changeset SQL file must be on the classpath at %s", CHANGESET_PATH)
                .isNotNull();
            // Maven resource filtering rewrites classpath resources with
            // PLATFORM line endings (CRLF on Windows); the assertions pin
            // multi-line content with \n, so normalise before comparing.
            return new String(is.readAllBytes(), StandardCharsets.UTF_8).replace("\r\n", "\n");
        }
    }
}
