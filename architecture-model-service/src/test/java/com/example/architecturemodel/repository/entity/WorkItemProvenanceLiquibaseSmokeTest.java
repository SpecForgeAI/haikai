package com.example.architecturemodel.repository.entity;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.Objects;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Static smoke check for Liquibase changeset {@code 186} (the
 * {@code work_item.provenance} marker). Confirms the SQL file is well-formed and
 * correctly registered in {@code db.changelog-master.yaml} AFTER changeset 185
 * (D4's {@code source_capability_id}), and that 185 is untouched.
 *
 * <p>Mirrors {@link MigrationExecutionRunStateLiquibaseSmokeTest}: a lightweight
 * registration gate, not a full migration apply. The real apply against the test
 * H2 context is covered by the {@code @DataJpaTest} round-trips in
 * {@link WorkItemProvenanceColumnTest} (the JPA mapping mirrors the changeset
 * column 1:1) and the AMS boot smoke path.</p>
 *
 * <p>Spec: D5 -- Net-new backlog items + provenance (2026-06-14, Spec 5 of 6)
 * -- Task Group 1.</p>
 */
class WorkItemProvenanceLiquibaseSmokeTest {

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
    @DisplayName("changeset 186 SQL adds the work_item.provenance column NOT NULL DEFAULT 'carry_over'")
    void changeset186DeclaresProvenanceColumn() throws Exception {
        String sql = readClasspathResource(
            "db/changelog/sql/186-work-item-provenance.sql");

        assertThat(sql)
            .as("the single column-only ALTER with the carry_over default (no backfill)")
            .contains("ALTER TABLE work_item ADD COLUMN provenance VARCHAR NOT NULL DEFAULT 'carry_over'");
    }

    @Test
    @DisplayName("db.changelog-master.yaml registers changeset 186 AFTER 185 with the not-columnExists precondition idiom; 185 untouched")
    void masterChangelogRegisters186After185() throws Exception {
        String master = readClasspathResource("db/changelog/db.changelog-master.yaml");

        assertThat(master)
            .as("changeset 186 must be registered with its sqlFile path")
            .contains("id: 186-work-item-provenance")
            .contains("db/changelog/sql/186-work-item-provenance.sql");

        // 185 (D4's changeset) must still be present and unmodified.
        assertThat(master)
            .as("changeset 185 anchor must still be present -- verifies we did not delete/alter it")
            .contains("id: 185-work-item-source-capability-id")
            .contains("db/changelog/sql/185-work-item-source-capability-id.sql");

        // 186 must be registered AFTER 185 (the append point per D7).
        int idx185 = master.indexOf("id: 185-work-item-source-capability-id");
        int idx186 = master.indexOf("id: 186-work-item-provenance");
        assertThat(idx185).isGreaterThan(-1);
        assertThat(idx186)
            .as("changeset 186 must be registered AFTER 185 (D7)")
            .isGreaterThan(idx185);

        // The 186 precondition uses the not-columnExists idiom (mirrors 185).
        int idx186Block = master.indexOf("id: 186-work-item-provenance");
        String after186 = master.substring(idx186Block);
        assertThat(after186)
            .as("the 186 precondition guards on the new column name")
            .contains("columnName: provenance");
    }
}
