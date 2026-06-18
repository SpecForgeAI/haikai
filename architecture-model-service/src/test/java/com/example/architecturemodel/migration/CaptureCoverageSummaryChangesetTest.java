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
 * Validates the ONE new Liquibase changeset from Spec "Oracle Coverage Scoring"
 * (2026-06-17) -- Task Group 1:
 *
 * <ul>
 *   <li>{@code 189-capture-coverage-summary.sql} -- adds the nullable JSONB
 *       column {@code coverage_summary_json} to
 *       {@code api_behaviour_capture_sessions} (ADD COLUMN jsonb NULL, NO
 *       backfill, not-columnExists precondition, COMMENT ON COLUMN).</li>
 * </ul>
 *
 * <p>Why execute the SQL file directly: the shared test profile pins H2 with
 * {@code liquibase.enabled=false}, so the real changesets never run there. This
 * test seeds the minimal pre-189 table shape, then applies the ACTUAL changeset
 * SQL statement-by-statement against a fresh H2 PostgreSQL-mode database
 * (mirrors {@code CaptureInventoryReconciliationChangesetTest}).</p>
 *
 * <p>H2 limitations worked around (production PostgreSQL is unaffected):
 * {@code COMMENT ON COLUMN} is skipped (documentation-only); a
 * {@code CREATE DOMAIN JSONB AS JSON} alias is registered on the JDBC URL so
 * the {@code ADD COLUMN ... jsonb} DDL runs verbatim. The load-bearing DDL --
 * the nullable JSONB column -- runs and is verified.</p>
 *
 * <p>Spec: Oracle Coverage Scoring (2026-06-17) -- Task Group 1.</p>
 */
class CaptureCoverageSummaryChangesetTest {

    private static final String SQL_189 =
        "db/changelog/sql/189-capture-coverage-summary.sql";

    @Test
    @DisplayName("189 applies cleanly: coverage_summary_json (JSONB NULL) is added, accepts a JSON row, and defaults to NULL (no backfill)")
    void changesetAddsNullableJsonbColumn() throws Exception {
        String url = "jdbc:h2:mem:captureCoverage_" + System.nanoTime()
            + ";DB_CLOSE_DELAY=-1;MODE=PostgreSQL;INIT=CREATE DOMAIN IF NOT EXISTS JSONB AS JSON";

        try (Connection conn = DriverManager.getConnection(url, "sa", "")) {
            // Seed the minimal pre-189 shape, plus one EXISTING row to prove the
            // ADD COLUMN does not backfill it (reads back NULL).
            try (Statement st = conn.createStatement()) {
                st.execute("CREATE TABLE api_behaviour_capture_sessions (id UUID PRIMARY KEY)");
                st.execute("INSERT INTO api_behaviour_capture_sessions (id) VALUES "
                    + "('11111111-1111-1111-1111-111111111111')");
            }

            apply(conn, SQL_189);

            // The new column exists.
            Set<String> cols = columnNames(conn, "API_BEHAVIOUR_CAPTURE_SESSIONS");
            assertThat(cols).contains("COVERAGE_SUMMARY_JSON");

            // The pre-existing row was NOT backfilled (reads back NULL).
            try (Statement st = conn.createStatement();
                 ResultSet rs = st.executeQuery(
                     "SELECT coverage_summary_json FROM api_behaviour_capture_sessions "
                         + "WHERE id = '11111111-1111-1111-1111-111111111111'")) {
                assertThat(rs.next()).isTrue();
                rs.getString(1);
                assertThat(rs.wasNull())
                    .as("existing row stays NULL -- no backfill")
                    .isTrue();
            }

            // The column accepts a JSON value on a new row.
            try (Statement st = conn.createStatement()) {
                st.execute("INSERT INTO api_behaviour_capture_sessions "
                    + "(id, coverage_summary_json) VALUES "
                    + "('22222222-2222-2222-2222-222222222222', "
                    + " '{\"overall_score\":0.5,\"dimensions_total\":2,\"dimensions_achieved\":1}')");
            }
            try (Statement st = conn.createStatement();
                 ResultSet rs = st.executeQuery(
                     "SELECT coverage_summary_json FROM api_behaviour_capture_sessions "
                         + "WHERE id = '22222222-2222-2222-2222-222222222222'")) {
                assertThat(rs.next()).isTrue();
                assertThat(rs.getString(1)).contains("overall_score");
            }
        }
    }

    // ------------------------------------------------------------------
    // Changeset application (mirrors Liquibase splitStatements/stripComments)
    // ------------------------------------------------------------------

    private static void apply(Connection conn, String classpathSql) throws Exception {
        String sql = StreamUtils.copyToString(
            new ClassPathResource(classpathSql).getInputStream(), StandardCharsets.UTF_8);
        try (Statement st = conn.createStatement()) {
            for (String stmt : splitStatements(sql)) {
                String upper = stmt.toUpperCase();
                if (upper.startsWith("COMMENT ON")) {
                    // H2 lacks COMMENT ON COLUMN with the same surface; the
                    // comment is documentation-only -- skip under H2.
                    continue;
                }
                st.execute(stmt);
            }
        }
    }

    /** Mirror Liquibase stripComments + splitStatements for a plain DDL file. */
    private static List<String> splitStatements(String sql) {
        List<String> statements = new ArrayList<>();
        StringBuilder current = new StringBuilder();
        for (String rawLine : sql.split("\n")) {
            String line = rawLine;
            int comment = line.indexOf("--");
            if (comment >= 0) {
                line = line.substring(0, comment);
            }
            if (line.isBlank()) {
                continue;
            }
            current.append(line).append('\n');
            if (line.trim().endsWith(";")) {
                statements.add(current.toString().trim());
                current.setLength(0);
            }
        }
        if (current.toString().trim().length() > 0) {
            statements.add(current.toString().trim());
        }
        return statements;
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
