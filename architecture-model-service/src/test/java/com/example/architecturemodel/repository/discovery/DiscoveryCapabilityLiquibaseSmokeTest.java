package com.example.architecturemodel.repository.discovery;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.Objects;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Static smoke check for Liquibase changeset {@code 184} (the discovery
 * capability + member store). Confirms the SQL file is well-formed and correctly
 * registered in {@code db.changelog-master.yaml} AFTER changeset 183, with 183
 * untouched.
 *
 * <p>Mirrors {@code MigrationReconciliationBreakLiquibaseSmokeTest}: a
 * lightweight gate, not a full migration apply. The real apply against the test
 * H2 context is covered by the {@code @DataJpaTest} round-trips in
 * {@link DiscoveryCapabilityPersistenceTest} (the JPA mapping mirrors the
 * changeset columns 1:1).</p>
 *
 * <p>Spec: D2 -- Capability Synthesis + Batch Spines (2026-06-14, Spec 2 of 6)
 * -- Task Group 1.</p>
 */
class DiscoveryCapabilityLiquibaseSmokeTest {

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
    @DisplayName("changeset 184 SQL declares both capability tables, the member FK + CASCADE, and the read-key indexes")
    void changeset184DeclaresCapabilitySchema() throws Exception {
        String sql = readClasspathResource(
            "db/changelog/sql/184-discovery-capability.sql");

        // The capability table + its load-bearing columns.
        assertThat(sql)
            .contains("CREATE TABLE discovery_capability")
            .contains("run_id")
            .contains("project_id")
            .contains("architecture_id")
            .contains("name")
            .contains("kind")
            .contains("summary")
            .contains("review_status")
            .contains("previous_review_status")
            .contains("confidence")
            .contains("detail_json")
            .contains("source")
            .contains("created_by_stage");

        // review_status default + boxed confidence (DOUBLE PRECISION, nullable).
        assertThat(sql)
            .contains("review_status               TEXT NOT NULL DEFAULT 'pending_review'")
            .contains("confidence                  DOUBLE PRECISION NULL")
            .contains("detail_json                 JSONB NULL");

        // The member table + its polymorphic columns + FK CASCADE.
        assertThat(sql)
            .contains("CREATE TABLE discovery_capability_member")
            .contains("capability_id")
            .contains("member_type")
            .contains("member_id")
            .contains("fk_dcm_capability")
            .contains("REFERENCES discovery_capability(id) ON DELETE CASCADE");

        // The capability read-key indexes + the member indexes.
        assertThat(sql)
            .contains("idx_discovery_capability_run_id")
            .contains("idx_discovery_capability_project_id")
            .contains("idx_discovery_capability_architecture_id")
            .contains("idx_discovery_capability_review_status")
            .contains("idx_discovery_capability_member_capability_id")
            .contains("idx_discovery_capability_member_member");
    }

    @Test
    @DisplayName("db.changelog-master.yaml registers changeset 184 AFTER 183, with 183 untouched")
    void masterChangelogRegisters184After183() throws Exception {
        String master = readClasspathResource("db/changelog/db.changelog-master.yaml");

        assertThat(master)
            .as("changeset 184 must be registered with its sqlFile path")
            .contains("id: 184-discovery-capability")
            .contains("db/changelog/sql/184-discovery-capability.sql");

        // 183 (Spec 4's changeset) must still be present and unmodified.
        assertThat(master)
            .as("changeset 183 anchor must still be present -- verifies we did not delete/alter it")
            .contains("id: 183-migration-reconciliation-break")
            .contains("db/changelog/sql/183-migration-reconciliation-break.sql");

        // 184 must be registered AFTER 183 (the append point).
        int idx183 = master.indexOf("id: 183-migration-reconciliation-break");
        int idx184 = master.indexOf("id: 184-discovery-capability");
        assertThat(idx183).isGreaterThan(-1);
        assertThat(idx184)
            .as("changeset 184 must be registered AFTER 183")
            .isGreaterThan(idx183);

        // The 184 precondition uses the not-tableExists idiom (mirrors 183).
        assertThat(master)
            .contains("tableName: discovery_capability");
    }
}
