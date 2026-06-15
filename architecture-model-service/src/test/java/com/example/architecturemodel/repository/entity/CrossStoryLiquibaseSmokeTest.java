package com.example.architecturemodel.repository.entity;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.Objects;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Static smoke check for the two Liquibase changesets added by this spec
 * (141 and 142). Verifies the SQL files are well-formed enough to be parsed
 * by Liquibase / Hibernate and that they are correctly registered in
 * {@code db.changelog-master.yaml}.
 *
 * <p>This is a lightweight gate -- not a full migration apply test. A real
 * apply against a Postgres testcontainer is the responsibility of the AMS
 * boot smoke path. Here we just confirm:</p>
 * <ol>
 *   <li>Both new SQL files exist on the classpath.</li>
 *   <li>The master changelog registers both new changesets by id and path.</li>
 *   <li>Each SQL file contains the expected anchor tokens (table names,
 *       constraint names) so a future accidental rename surfaces here
 *       immediately rather than at app-boot time.</li>
 * </ol>
 *
 * <p>Spec: Cross-Story Context Injection for Migration Shape-Spec Generation
 * (2026-05-20) -- Task Group 1.</p>
 */
class CrossStoryLiquibaseSmokeTest {

    private String readClasspathResource(String path) throws Exception {
        try (var stream = Objects.requireNonNull(
            getClass().getClassLoader().getResourceAsStream(path),
            "missing classpath resource: " + path);
             var reader = new BufferedReader(
                 new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) {
                sb.append(line).append('\n');
            }
            return sb.toString();
        }
    }

    @Test
    @DisplayName("changeset 141 SQL file declares all eight new columns + chk_msg_generation_pass constraint")
    void changeset141DeclaresAllNewColumns() throws Exception {
        String sql = readClasspathResource(
            "db/changelog/sql/141-migration-story-spec-generations-pass-fields.sql");

        assertThat(sql)
            .contains("ALTER TABLE migration_story_spec_generations")
            .contains("ADD COLUMN generation_pass")
            .contains("ADD COLUMN pass1_spec_text")
            .contains("ADD COLUMN pass2_changes_summary")
            .contains("ADD COLUMN budget_meta_json")
            .contains("ADD COLUMN no_meaningful_change")
            .contains("ADD COLUMN decisions_json")
            .contains("ADD COLUMN interfaces_json")
            .contains("ADD COLUMN assumptions_json")
            .contains("chk_msg_generation_pass")
            .contains("CHECK (generation_pass IN (1, 2))");

        // generation_pass MUST be NOT NULL with a default so existing rows
        // (from changeset 140) get a stable pass=1 value at migration time.
        assertThat(sql)
            .as("generation_pass must be NOT NULL DEFAULT 1 so existing rows survive the migration with pass=1")
            .contains("NOT NULL DEFAULT 1");
    }

    @Test
    @DisplayName("changeset 142 SQL file declares the epic_captured_decisions table with the required constraints + indexes")
    void changeset142DeclaresEpicCapturedDecisionsTable() throws Exception {
        String sql = readClasspathResource(
            "db/changelog/sql/142-epic-captured-decisions.sql");

        assertThat(sql)
            .contains("CREATE TABLE epic_captured_decisions")
            .contains("id")
            .contains("project_id")
            .contains("epic_work_item_id")
            .contains("decision_key")
            .contains("decision_text")
            .contains("source")
            .contains("source_spec_generation_id")
            .contains("status")
            .contains("last_edited_by")
            .contains("created_at")
            .contains("updated_at");

        // Source / status CHECK constraints
        assertThat(sql)
            .contains("chk_ecd_source")
            .contains("auto_extracted")
            .contains("user_edited")
            .contains("user_added")
            .contains("chk_ecd_status")
            .contains("draft")
            .contains("confirmed")
            .contains("superseded");

        // FK with ON DELETE SET NULL on source_spec_generation_id
        assertThat(sql)
            .contains("fk_ecd_source_spec_generation")
            .contains("REFERENCES migration_story_spec_generations (id)")
            .contains("ON DELETE SET NULL");

        // Indexes
        assertThat(sql)
            .contains("ux_ecd_project_epic_key")
            .contains("idx_ecd_project_epic")
            .contains("idx_ecd_status")
            .contains("idx_ecd_source_spec");
    }

    @Test
    @DisplayName("db.changelog-master.yaml registers both new changesets by id and sqlFile path")
    void masterChangelogRegistersBothNewChangesets() throws Exception {
        String master = readClasspathResource("db/changelog/db.changelog-master.yaml");

        assertThat(master)
            .as("changeset 141 must be registered with its sqlFile path")
            .contains("id: 141-migration-story-spec-generations-pass-fields")
            .contains("db/changelog/sql/141-migration-story-spec-generations-pass-fields.sql");

        assertThat(master)
            .as("changeset 142 must be registered with its sqlFile path")
            .contains("id: 142-epic-captured-decisions")
            .contains("db/changelog/sql/142-epic-captured-decisions.sql");

        // Per feedback_liquibase_immutable_changesets: confirm we have NOT
        // touched the previously-applied changeset 140. (We grep for the
        // anchor text that lives only in changeset 140's body.)
        assertThat(master)
            .as("Changeset 140 anchor must still be present -- verifies we did not delete it")
            .contains("id: 140-migration-story-spec-generations");
    }
}
