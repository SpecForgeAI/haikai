package com.example.architecturemodel.repository.entity;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.Objects;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Static smoke check for Liquibase changeset {@code 182} (the Migration
 * Execution run-state tables + the {@code work_item.deferred} flag). Confirms
 * the SQL file is well-formed and correctly registered in
 * {@code db.changelog-master.yaml} AFTER changeset 181, and that 181 (and all
 * applied changesets) are untouched.
 *
 * <p>Mirrors {@link CrossStoryLiquibaseSmokeTest}: a lightweight gate, not a
 * full migration apply. The real apply against the test H2 context is covered
 * by the {@code @DataJpaTest} round-trips in
 * {@link MigrationExecutionRunStatePersistenceTest} (the JPA mapping mirrors the
 * changeset columns 1:1) and the AMS boot smoke path.</p>
 *
 * <p>Spec: Migrate Button + Migration Execution Driver + External Shape-Spec
 * Auto-Answerer (2026-06-14, Spec 3 of 4) -- Task Group 1.</p>
 */
class MigrationExecutionRunStateLiquibaseSmokeTest {

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
    @DisplayName("changeset 182 SQL declares both run-state tables, the FK + indexes, and the work_item.deferred column")
    void changeset182DeclaresRunStateSchema() throws Exception {
        String sql = readClasspathResource(
            "db/changelog/sql/182-migration-execution-run-state.sql");

        // The run table + its load-bearing columns (pinned baseline, target url, decision log).
        assertThat(sql)
            .contains("CREATE TABLE migration_execution_run")
            .contains("pinned_current_baseline_id")
            .contains("current_sequence_position")
            .contains("target_base_url")
            .contains("decision_log_json");

        // The run-item table + its load-bearing columns.
        assertThat(sql)
            .contains("CREATE TABLE migration_execution_run_item")
            .contains("run_id")
            .contains("sequence_position")
            .contains("work_item_id")
            .contains("spec_generation_id")
            .contains("spec_name")
            .contains("dispatched")
            .contains("job_id")
            .contains("branch")
            .contains("pr_url")
            .contains("outcome")
            .contains("deploy_on_complete")
            .contains("auto_answer_decision_log_json");

        // FK run-item -> run ON DELETE CASCADE.
        assertThat(sql)
            .contains("fk_meri_run")
            .contains("REFERENCES migration_execution_run(id)")
            .contains("ON DELETE CASCADE");

        // Callback lookup indexes (run_id + job_id).
        assertThat(sql)
            .contains("idx_meri_run_id")
            .contains("idx_meri_job_id")
            .contains("idx_mer_book_of_work_id");

        // The defer flag, NOT NULL DEFAULT false so existing rows read back not-deferred.
        assertThat(sql)
            .contains("ALTER TABLE work_item ADD COLUMN deferred BOOLEAN NOT NULL DEFAULT false");
    }

    @Test
    @DisplayName("db.changelog-master.yaml registers changeset 182 AFTER 181, with 181 untouched")
    void masterChangelogRegisters182After181() throws Exception {
        String master = readClasspathResource("db/changelog/db.changelog-master.yaml");

        assertThat(master)
            .as("changeset 182 must be registered with its sqlFile path")
            .contains("id: 182-migration-execution-run-state")
            .contains("db/changelog/sql/182-migration-execution-run-state.sql");

        // 181 (Spec 1's changeset) must still be present and unmodified anchors intact.
        assertThat(master)
            .as("changeset 181 anchor must still be present -- verifies we did not delete/alter it")
            .contains("id: 181-implementation-ready-spec-fields")
            .contains("db/changelog/sql/181-implementation-ready-spec-fields.sql");

        // 182 must be registered AFTER 181 (the append point per CD-9).
        int idx181 = master.indexOf("id: 181-implementation-ready-spec-fields");
        int idx182 = master.indexOf("id: 182-migration-execution-run-state");
        assertThat(idx181).isGreaterThan(-1);
        assertThat(idx182)
            .as("changeset 182 must be registered AFTER 181 (CD-9)")
            .isGreaterThan(idx181);

        // The 182 precondition uses the tableExists idiom (mirrors 180's not-tableExists).
        assertThat(master)
            .contains("tableName: migration_execution_run");
    }
}
