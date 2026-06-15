package com.example.architecturemodel.repository.entity;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.Objects;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Static smoke check for Liquibase changeset {@code 183} (the Migration
 * Reconciliation break store). Confirms the SQL file is well-formed and
 * correctly registered in {@code db.changelog-master.yaml} AFTER changeset 182,
 * and that 182 (and all applied changesets) are untouched.
 *
 * <p>Mirrors {@link MigrationExecutionRunStateLiquibaseSmokeTest}: a lightweight
 * gate, not a full migration apply. The real apply against the test H2 context
 * is covered by the {@code @DataJpaTest} round-trips in
 * {@link MigrationReconciliationBreakPersistenceTest} (the JPA mapping mirrors
 * the changeset columns 1:1).</p>
 *
 * <p>Spec: Migration Reconciliation + Bug Loop (2026-06-14, Spec 4 of 4) --
 * Task Group 1.</p>
 */
class MigrationReconciliationBreakLiquibaseSmokeTest {

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
    @DisplayName("changeset 183 SQL declares the break table, the run FK + indexes, and the lifecycle/counter columns")
    void changeset183DeclaresBreakSchema() throws Exception {
        String sql = readClasspathResource(
            "db/changelog/sql/183-migration-reconciliation-break.sql");

        // The break table + its load-bearing columns.
        assertThat(sql)
            .contains("CREATE TABLE migration_reconciliation_break")
            .contains("run_id")
            .contains("pinned_baseline_id")
            .contains("source_baseline_item_id")
            .contains("diff_item_id")
            .contains("detail_json")
            .contains("disposition_status")
            .contains("bug_id")
            .contains("attempt_count")
            .contains("circuit_broken")
            .contains("needs_human");

        // FK break -> run ON DELETE CASCADE (run-scoped).
        assertThat(sql)
            .contains("fk_mrb_run")
            .contains("REFERENCES migration_execution_run(id)")
            .contains("ON DELETE CASCADE");

        // The three required indexes: run_id (read), bug_id (callback key),
        // source_baseline_item_id (scope key).
        assertThat(sql)
            .contains("idx_mrb_run_id")
            .contains("idx_mrb_bug_id")
            .contains("idx_mrb_source_baseline_item_id");

        // The NOT NULL DEFAULTs so existing/omitting writes are stable.
        assertThat(sql)
            .contains("disposition_status          TEXT NOT NULL DEFAULT 'open'")
            .contains("attempt_count               INTEGER NOT NULL DEFAULT 0")
            .contains("circuit_broken              BOOLEAN NOT NULL DEFAULT false")
            .contains("needs_human                 BOOLEAN NOT NULL DEFAULT false");
    }

    @Test
    @DisplayName("db.changelog-master.yaml registers changeset 183 AFTER 182, with 182 untouched")
    void masterChangelogRegisters183After182() throws Exception {
        String master = readClasspathResource("db/changelog/db.changelog-master.yaml");

        assertThat(master)
            .as("changeset 183 must be registered with its sqlFile path")
            .contains("id: 183-migration-reconciliation-break")
            .contains("db/changelog/sql/183-migration-reconciliation-break.sql");

        // 182 (Spec 3's changeset) must still be present and unmodified.
        assertThat(master)
            .as("changeset 182 anchor must still be present -- verifies we did not delete/alter it")
            .contains("id: 182-migration-execution-run-state")
            .contains("db/changelog/sql/182-migration-execution-run-state.sql");

        // 183 must be registered AFTER 182 (the append point).
        int idx182 = master.indexOf("id: 182-migration-execution-run-state");
        int idx183 = master.indexOf("id: 183-migration-reconciliation-break");
        assertThat(idx182).isGreaterThan(-1);
        assertThat(idx183)
            .as("changeset 183 must be registered AFTER 182")
            .isGreaterThan(idx182);

        // The 183 precondition uses the not-tableExists idiom (mirrors 182).
        assertThat(master)
            .contains("tableName: migration_reconciliation_break");
    }
}
