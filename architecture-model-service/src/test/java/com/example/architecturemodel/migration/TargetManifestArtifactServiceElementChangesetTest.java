package com.example.architecturemodel.migration;

import com.example.architecturemodel.model.dto.targetmanifest.TargetManifestArtifactDto;
import com.example.architecturemodel.model.entity.targetmanifest.TargetManifestArtifactEntity;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;
import org.springframework.util.StreamUtils;

import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.Statement;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Validates the NEW Liquibase changeset
 * {@code db/changelog/sql/202-target-manifest-service-element.sql} (Spec: Target
 * Manifest -&gt; Service Association (Foreign Key), 2026-06-26 -- Task Group 1,
 * FR2). The changeset ADDS the nullable {@code target_service_element_id} UUID
 * column to the {@code target_manifest_artifacts} table created by changeset
 * 199 -- a LOGICAL foreign key to a target-state Application-domain
 * {@code services} element (no physical FK, since elements are soft-deleted).
 *
 * <p>Mirrors {@code TargetManifestArtifactsTier2FactsChangesetTest}: the shared
 * test profile pins H2 with {@code liquibase.enabled=false} (the real changesets
 * never run there), and running the FULL master changelog against H2 is not
 * viable (earlier changesets use Postgres-only constructs). This test applies
 * the ACTUAL 199 (create) THEN 201 (tier2_facts) THEN 202
 * (target_service_element_id) changeset SQL statement-by-statement against a
 * FRESH H2 PostgreSQL-mode database and asserts the resulting schema,
 * registering {@code JSONB}/{@code TIMESTAMPTZ} as H2 domain aliases so the
 * unmodified production SQL executes here.</p>
 *
 * <p>The {@link #splitStatements(String)} helper is string-literal-aware
 * (copied verbatim from the sibling changeset test): it strips {@code --} line
 * comments and splits on {@code ;} ONLY when NOT inside a single-quoted string,
 * so the {@code COMMENT ON ... IS '...'} bodies are preserved. Plain JUnit (no
 * Spring context).</p>
 */
class TargetManifestArtifactServiceElementChangesetTest {

    private static final String CREATE_SQL_PATH = "db/changelog/sql/199-target-manifest-artifacts.sql";
    private static final String TIER2_SQL_PATH = "db/changelog/sql/201-target-manifest-tier2-facts.sql";
    private static final String ALTER_SQL_PATH = "db/changelog/sql/202-target-manifest-service-element.sql";

    /**
     * Mirror Liquibase's SQL-aware {@code stripComments} + {@code splitStatements}
     * for a plain DDL file (string-literal-aware). Copied from
     * {@code TargetManifestArtifactsTier2FactsChangesetTest} so the tests stay in
     * lock-step.
     */
    private static List<String> splitStatements(String sql) {
        List<String> statements = new ArrayList<>();
        StringBuilder current = new StringBuilder();
        boolean inString = false;
        int n = sql.length();
        for (int i = 0; i < n; i++) {
            char c = sql.charAt(i);
            if (inString) {
                current.append(c);
                if (c == '\'') {
                    if (i + 1 < n && sql.charAt(i + 1) == '\'') {
                        current.append('\'');
                        i++;
                    } else {
                        inString = false;
                    }
                }
                continue;
            }
            if (c == '\'') {
                inString = true;
                current.append(c);
            } else if (c == '-' && i + 1 < n && sql.charAt(i + 1) == '-') {
                while (i < n && sql.charAt(i) != '\n') {
                    i++;
                }
                current.append('\n');
            } else if (c == ';') {
                String stmt = current.toString().trim();
                if (!stmt.isEmpty()) {
                    statements.add(stmt);
                }
                current.setLength(0);
            } else {
                current.append(c);
            }
        }
        String tail = current.toString().trim();
        if (!tail.isEmpty()) {
            statements.add(tail);
        }
        return statements;
    }

    @Test
    @DisplayName("202-target-manifest-service-element.sql applies after 199+201: adds the nullable target_service_element_id UUID column; existing columns untouched; a UUID round-trips and a row without it reads back null")
    void changesetAppliesCleanly() throws Exception {
        String createSql = StreamUtils.copyToString(
            new ClassPathResource(CREATE_SQL_PATH).getInputStream(), StandardCharsets.UTF_8);
        String tier2Sql = StreamUtils.copyToString(
            new ClassPathResource(TIER2_SQL_PATH).getInputStream(), StandardCharsets.UTF_8);
        String alterSql = StreamUtils.copyToString(
            new ClassPathResource(ALTER_SQL_PATH).getInputStream(), StandardCharsets.UTF_8);

        List<String> statements = new ArrayList<>();
        statements.addAll(splitStatements(createSql)); // 199: create table
        statements.addAll(splitStatements(tier2Sql));  // 201: add tier2_facts
        statements.addAll(splitStatements(alterSql));  // 202: add target_service_element_id

        String url = "jdbc:h2:mem:serviceElementChangeset_" + System.nanoTime()
            + ";DB_CLOSE_DELAY=-1;MODE=PostgreSQL"
            + ";INIT=CREATE DOMAIN IF NOT EXISTS JSONB AS JSON"
            + "\\;CREATE DOMAIN IF NOT EXISTS TIMESTAMPTZ AS TIMESTAMP WITH TIME ZONE";

        try (Connection conn = DriverManager.getConnection(url, "sa", "")) {
            try (Statement st = conn.createStatement()) {
                for (String stmt : statements) {
                    st.execute(stmt);
                }
            }

            // ---- the new column is present alongside the originals ----
            Set<String> cols = columnNames(conn, "TARGET_MANIFEST_ARTIFACTS");
            assertThat(cols).contains("TARGET_SERVICE_ELEMENT_ID");
            assertThat(cols).contains(
                "ID", "PROJECT_ID", "TARGET_ARCHITECTURE_ID", "TAG",
                "RESOLVED_DEPENDENCIES", "TIER2_FACTS", "CONTENT", "IS_LATEST", "CREATED_AT");

            // ---- functional: a service-element UUID round-trips ----
            UUID serviceId = UUID.randomUUID();
            try (Statement st = conn.createStatement()) {
                st.execute("INSERT INTO target_manifest_artifacts "
                    + "(id, project_id, target_architecture_id, tag, target_service_element_id) VALUES "
                    + "(RANDOM_UUID(), RANDOM_UUID(), RANDOM_UUID(), 'orders', '" + serviceId + "')");
            }
            try (Statement st = conn.createStatement();
                 ResultSet rs = st.executeQuery(
                     "SELECT target_service_element_id FROM target_manifest_artifacts WHERE tag = 'orders'")) {
                assertThat(rs.next()).isTrue();
                assertThat(rs.getString("target_service_element_id"))
                    .isEqualToIgnoringCase(serviceId.toString());
            }

            // ---- target_service_element_id is nullable: a row without it reads back null ----
            try (Statement st = conn.createStatement()) {
                st.execute("INSERT INTO target_manifest_artifacts "
                    + "(id, project_id, target_architecture_id, tag) VALUES "
                    + "(RANDOM_UUID(), RANDOM_UUID(), RANDOM_UUID(), 'billing')");
            }
            try (Statement st = conn.createStatement();
                 ResultSet rs = st.executeQuery(
                     "SELECT target_service_element_id FROM target_manifest_artifacts WHERE tag = 'billing'")) {
                assertThat(rs.next()).isTrue();
                assertThat(rs.getString("target_service_element_id")).isNull();
            }
        }
    }

    @Test
    @DisplayName("db.changelog-master.yaml registers changeset 202 AFTER 201, with 201 untouched, using the not-columnExists / MARK_RAN idiom (clean re-run no-op)")
    void masterChangelogRegisters202After201() throws Exception {
        String master = StreamUtils.copyToString(
            new ClassPathResource("db/changelog/db.changelog-master.yaml").getInputStream(),
            StandardCharsets.UTF_8);

        assertThat(master)
            .as("changeset 202 must be registered with its sqlFile path")
            .contains("id: 202-target-manifest-service-element")
            .contains("db/changelog/sql/202-target-manifest-service-element.sql");

        // 201 (the previous changeset) must still be present and unmodified.
        assertThat(master)
            .as("changeset 201 anchor must still be present -- verifies we did not delete/alter it")
            .contains("id: 201-target-manifest-tier2-facts")
            .contains("db/changelog/sql/201-target-manifest-tier2-facts.sql");

        // 202 must be registered AFTER 201 (the append point).
        int idx201 = master.indexOf("id: 201-target-manifest-tier2-facts");
        int idx202 = master.indexOf("id: 202-target-manifest-service-element");
        assertThat(idx201).isGreaterThan(-1);
        assertThat(idx202)
            .as("changeset 202 must be registered AFTER 201")
            .isGreaterThan(idx201);

        // 202 uses the not-columnExists / MARK_RAN precondition idiom so a re-run is
        // a clean no-op (mirrors 201 / 200 / 195 / 198).
        assertThat(master).contains("columnName: target_service_element_id");
        int blockStart = idx202;
        int blockEnd = master.indexOf("columnName: target_service_element_id", blockStart);
        String block = master.substring(blockStart, blockEnd);
        assertThat(block)
            .as("changeset 202 precondition must be onFail MARK_RAN with the not-columnExists idiom")
            .contains("onFail: MARK_RAN")
            .contains("not:")
            .contains("columnExists:");
    }

    @Test
    @DisplayName("TargetManifestArtifactDto.fromEntity carries target_service_element_id through entity -> DTO unchanged (and a null id maps to a null DTO field)")
    void fromEntityCarriesTargetServiceElementId() {
        UUID serviceId = UUID.randomUUID();
        TargetManifestArtifactEntity entity = TargetManifestArtifactEntity.builder()
            .id(UUID.randomUUID())
            .projectId(UUID.randomUUID())
            .targetArchitectureId(UUID.randomUUID())
            .tag("orders")
            .targetServiceElementId(serviceId)
            .isLatest(Boolean.TRUE)
            .createdAt(Instant.now())
            .build();

        TargetManifestArtifactDto dto = TargetManifestArtifactDto.fromEntity(entity);
        assertThat(dto.targetServiceElementId()).isEqualTo(serviceId);

        // A legacy (unbound) entity maps to a null DTO field -- no NPE, no default.
        TargetManifestArtifactEntity unbound = TargetManifestArtifactEntity.builder()
            .id(UUID.randomUUID())
            .projectId(UUID.randomUUID())
            .targetArchitectureId(UUID.randomUUID())
            .tag("billing")
            .isLatest(Boolean.TRUE)
            .createdAt(Instant.now())
            .build();
        assertThat(TargetManifestArtifactDto.fromEntity(unbound).targetServiceElementId()).isNull();
    }

    private static Set<String> columnNames(Connection conn, String table) throws Exception {
        Set<String> cols = new HashSet<>();
        try (ResultSet rs = conn.getMetaData().getColumns(null, null, table, null)) {
            while (rs.next()) {
                cols.add(rs.getString("COLUMN_NAME"));
            }
        }
        return cols;
    }
}
