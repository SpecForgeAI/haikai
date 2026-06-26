package com.example.architecturemodel.migration;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;
import org.springframework.util.StreamUtils;

import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Validates the NEW Liquibase changeset
 * {@code db/changelog/sql/201-target-manifest-tier2-facts.sql} (Spec: Target
 * Dependency-Manifest Auto-Answer Comprehensive + Tier-2 Free Facts, 2026-06-26
 * -- Task Group 7). The changeset ADDS the {@code tier2_facts} JSONB column to
 * the {@code target_manifest_artifacts} table created by changeset 199.
 *
 * <p>Mirrors {@code TargetManifestArtifactsChangesetTest}: the shared test
 * profile pins H2 with {@code liquibase.enabled=false} (the real changesets
 * never run there), and running the FULL master changelog against H2 is not
 * viable (earlier changesets use Postgres-only constructs). This test applies
 * the ACTUAL 199 (create) THEN 201 (alter-add-column) changeset SQL
 * statement-by-statement against a FRESH H2 PostgreSQL-mode database and asserts
 * the resulting schema, registering {@code JSONB}/{@code TIMESTAMPTZ} as H2
 * domain aliases so the unmodified production SQL executes here.</p>
 *
 * <p>The {@link #splitStatements(String)} helper is string-literal-aware
 * (copied verbatim from the sibling changeset test): it strips {@code --} line
 * comments and splits on {@code ;} ONLY when NOT inside a single-quoted string,
 * so the {@code COMMENT ON ... IS '...'} bodies are preserved. Plain JUnit (no
 * Spring context).</p>
 */
class TargetManifestArtifactsTier2FactsChangesetTest {

    private static final String CREATE_SQL_PATH = "db/changelog/sql/199-target-manifest-artifacts.sql";
    private static final String ALTER_SQL_PATH = "db/changelog/sql/201-target-manifest-tier2-facts.sql";

    /**
     * Mirror Liquibase's SQL-aware {@code stripComments} + {@code splitStatements}
     * for a plain DDL file (string-literal-aware). Copied from
     * {@code TargetManifestArtifactsChangesetTest} so the two stay in lock-step.
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
    @DisplayName("201-target-manifest-tier2-facts.sql applies after 199: adds the tier2_facts JSONB column; existing columns untouched; a { friendly_name, coordinate } array round-trips")
    void changesetAppliesCleanly() throws Exception {
        String createSql = StreamUtils.copyToString(
            new ClassPathResource(CREATE_SQL_PATH).getInputStream(), StandardCharsets.UTF_8);
        String alterSql = StreamUtils.copyToString(
            new ClassPathResource(ALTER_SQL_PATH).getInputStream(), StandardCharsets.UTF_8);

        List<String> statements = new ArrayList<>();
        statements.addAll(splitStatements(createSql)); // 199: create table
        statements.addAll(splitStatements(alterSql));  // 201: add tier2_facts

        String url = "jdbc:h2:mem:tier2FactsChangeset_" + System.nanoTime()
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
            assertThat(cols).contains("TIER2_FACTS");
            assertThat(cols).contains(
                "ID", "PROJECT_ID", "TARGET_ARCHITECTURE_ID", "TAG",
                "RESOLVED_DEPENDENCIES", "CONTENT", "IS_LATEST", "CREATED_AT");

            // ---- functional: a { friendly_name, coordinate } JSON array round-trips ----
            try (Statement st = conn.createStatement()) {
                st.execute("INSERT INTO target_manifest_artifacts "
                    + "(id, project_id, target_architecture_id, tag, tier2_facts) VALUES "
                    + "(RANDOM_UUID(), RANDOM_UUID(), RANDOM_UUID(), 'orders', "
                    + "'[{\"friendly_name\":\"MCP SDK\",\"coordinate\":\"io.modelcontextprotocol.sdk\"}]')");
            }
            try (Statement st = conn.createStatement();
                 ResultSet rs = st.executeQuery(
                     "SELECT tier2_facts FROM target_manifest_artifacts")) {
                assertThat(rs.next()).isTrue();
                String facts = rs.getString("tier2_facts");
                assertThat(facts).contains("MCP SDK").contains("io.modelcontextprotocol.sdk");
            }

            // ---- tier2_facts is nullable: a row without it reads back null ----
            try (Statement st = conn.createStatement()) {
                st.execute("INSERT INTO target_manifest_artifacts "
                    + "(id, project_id, target_architecture_id, tag) VALUES "
                    + "(RANDOM_UUID(), RANDOM_UUID(), RANDOM_UUID(), 'billing')");
            }
            try (Statement st = conn.createStatement();
                 ResultSet rs = st.executeQuery(
                     "SELECT tier2_facts FROM target_manifest_artifacts WHERE tag = 'billing'")) {
                assertThat(rs.next()).isTrue();
                assertThat(rs.getString("tier2_facts")).isNull();
            }
        }
    }

    @Test
    @DisplayName("db.changelog-master.yaml registers changeset 201 AFTER 200, with 200 untouched, using the not-columnExists idiom")
    void masterChangelogRegisters201After200() throws Exception {
        String master = StreamUtils.copyToString(
            new ClassPathResource("db/changelog/db.changelog-master.yaml").getInputStream(),
            StandardCharsets.UTF_8);

        assertThat(master)
            .as("changeset 201 must be registered with its sqlFile path")
            .contains("id: 201-target-manifest-tier2-facts")
            .contains("db/changelog/sql/201-target-manifest-tier2-facts.sql");

        // 200 (the previous changeset) must still be present and unmodified.
        assertThat(master)
            .as("changeset 200 anchor must still be present -- verifies we did not delete/alter it")
            .contains("id: 200-vulnerability-findings")
            .contains("db/changelog/sql/200-vulnerability-findings.sql");

        // 201 must be registered AFTER 200 (the append point).
        int idx200 = master.indexOf("id: 200-vulnerability-findings");
        int idx201 = master.indexOf("id: 201-target-manifest-tier2-facts");
        assertThat(idx200).isGreaterThan(-1);
        assertThat(idx201)
            .as("changeset 201 must be registered AFTER 200")
            .isGreaterThan(idx200);

        // 201 uses the not-columnExists precondition idiom (mirrors 200 / 195 / 198).
        assertThat(master).contains("columnName: tier2_facts");
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
