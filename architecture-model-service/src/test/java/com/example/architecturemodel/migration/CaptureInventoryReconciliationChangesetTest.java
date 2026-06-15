package com.example.architecturemodel.migration;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;
import org.springframework.util.StreamUtils;

import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Validates the two NEW Liquibase changesets from Spec "Model-Seeded Capture
 * Inventory" (2026-06-11) -- Task Group 1:
 *
 * <ul>
 *   <li>{@code 178-capture-session-scope-and-coverage-override.sql} --
 *       capture-session scope + override columns, operation
 *       {@code exclusion_reason};</li>
 *   <li>{@code 179-discovery-findings-capture-session-origin.sql} -- third
 *       finding origin {@code api_behaviour_capture_session_id} + the
 *       DROPPED-and-re-ADDED three-way exactly-one-of-origin CHECK
 *       (changeset-160 precedent; the applied two-way constraint is
 *       immutable so the replacement happens in 179).</li>
 * </ul>
 *
 * <p>Why execute the SQL files directly: the shared test profile pins H2
 * with {@code liquibase.enabled=false}, so the real changesets never run
 * there. This test seeds the minimal pre-178/179 shape (including the
 * changeset-160 TWO-WAY origin CHECK), then applies the ACTUAL changeset SQL
 * statement-by-statement against a fresh H2 PostgreSQL-mode database
 * (mirrors {@code DiscoveryFindingsReviewStatusChangesetTest}).</p>
 *
 * <p>H2 limitations worked around (production PostgreSQL is unaffected):
 * {@code COMMENT ON ...} statements are skipped (H2 lacks
 * {@code COMMENT ON CONSTRAINT}); the partial-index {@code WHERE} clause is
 * stripped (H2 has no partial indexes). The load-bearing DDL -- columns, FK
 * CASCADE, and the three-way CHECK -- runs verbatim.</p>
 */
class CaptureInventoryReconciliationChangesetTest {

    private static final String SQL_178 =
        "db/changelog/sql/178-capture-session-scope-and-coverage-override.sql";
    private static final String SQL_179 =
        "db/changelog/sql/179-discovery-findings-capture-session-origin.sql";

    @Test
    @DisplayName("178 + 179 apply cleanly on the pre-existing shape; the three-way origin CHECK accepts a capture-session row, rejects two-origin/no-origin rows, and cascades on session delete")
    void changesetsApplyAndThreeWayOriginCheckHolds() throws Exception {
        String url = "jdbc:h2:mem:captureInventory_" + System.nanoTime()
            + ";DB_CLOSE_DELAY=-1;MODE=PostgreSQL;INIT=CREATE DOMAIN IF NOT EXISTS JSONB AS JSON";

        try (Connection conn = DriverManager.getConnection(url, "sa", "")) {
            seedPreChangesetShape(conn);

            apply(conn, SQL_178);
            apply(conn, SQL_179);

            // --- 178: new session + operation columns exist and accept rows. ---
            Set<String> sessionCols = columnNames(conn, "API_BEHAVIOUR_CAPTURE_SESSIONS");
            assertThat(sessionCols).contains(
                "SCOPE_INTERFACE_IDS_JSON",
                "COVERAGE_OVERRIDE_JUSTIFICATION",
                "COVERAGE_OVERRIDE_UNACCOUNTED_COUNT",
                "COVERAGE_OVERRIDE_AT");
            Set<String> operationCols = columnNames(conn, "API_BEHAVIOUR_OPERATIONS");
            assertThat(operationCols).contains("EXCLUSION_REASON");

            try (Statement st = conn.createStatement()) {
                st.execute("INSERT INTO api_behaviour_capture_sessions "
                    + "(id, scope_interface_ids_json, coverage_override_justification, "
                    + " coverage_override_unaccounted_count, coverage_override_at) VALUES "
                    + "('99999999-9999-9999-9999-999999999999', "
                    + " '[\"iface-a\",\"iface-b\"]', 'known gap, accepted', 3, "
                    + " TIMESTAMP WITH TIME ZONE '2026-06-11 10:00:00+00')");
                st.execute("INSERT INTO api_behaviour_operations "
                    + "(id, included, exclusion_reason) VALUES "
                    + "('88888888-8888-8888-8888-888888888888', FALSE, 'retired endpoint')");
            }

            // --- 179 column present. ---
            Set<String> findingCols = columnNames(conn, "DISCOVERY_FINDINGS");
            assertThat(findingCols).contains("API_BEHAVIOUR_CAPTURE_SESSION_ID");

            // (g) A capture-session-origin row (other origins null) SATISFIES
            // the re-created three-way CHECK.
            try (Statement st = conn.createStatement()) {
                st.execute("INSERT INTO discovery_findings "
                    + "(id, api_behaviour_capture_session_id, title) VALUES "
                    + "('f-session-origin', '99999999-9999-9999-9999-999999999999', 't')");
            }

            // (g) A TWO-ORIGIN row is REJECTED ...
            assertThatThrownBy(() -> {
                try (Statement st = conn.createStatement()) {
                    st.execute("INSERT INTO discovery_findings "
                        + "(id, run_id, api_behaviour_capture_session_id, title) VALUES "
                        + "('f-two-origins', '77777777-7777-7777-7777-777777777777', "
                        + " '99999999-9999-9999-9999-999999999999', 't')");
                }
            }).isInstanceOf(SQLException.class);
            // ... and so is a NO-ORIGIN row.
            assertThatThrownBy(() -> {
                try (Statement st = conn.createStatement()) {
                    st.execute("INSERT INTO discovery_findings (id, title) VALUES "
                        + "('f-no-origin', 't')");
                }
            }).isInstanceOf(SQLException.class);

            // Pre-existing origins still work under the three-way CHECK.
            try (Statement st = conn.createStatement()) {
                st.execute("INSERT INTO discovery_findings (id, run_id, title) VALUES "
                    + "('f-run-origin', '77777777-7777-7777-7777-777777777777', 't')");
            }

            // FK CASCADE: deleting the session removes ONLY its finding.
            try (Statement st = conn.createStatement()) {
                st.execute("DELETE FROM api_behaviour_capture_sessions "
                    + "WHERE id = '99999999-9999-9999-9999-999999999999'");
            }
            assertThat(findingIds(conn)).containsExactly("f-run-origin");
        }
    }

    // ------------------------------------------------------------------
    // Seed: the minimal PRE-178/179 schema (incl. the changeset-160 two-way
    // origin CHECK that 179 drops + re-creates as three-way).
    // ------------------------------------------------------------------

    private static void seedPreChangesetShape(Connection conn) throws Exception {
        try (Statement st = conn.createStatement()) {
            st.execute("CREATE TABLE api_behaviour_capture_sessions ("
                + " id UUID PRIMARY KEY)");
            st.execute("CREATE TABLE api_behaviour_operations ("
                + " id UUID PRIMARY KEY,"
                + " included BOOLEAN NULL)");
            st.execute("CREATE TABLE api_behaviour_diffs (id UUID PRIMARY KEY)");
            st.execute("CREATE TABLE discovery_findings ("
                + " id TEXT PRIMARY KEY,"
                + " run_id UUID NULL,"
                + " api_behaviour_diff_id UUID NULL REFERENCES api_behaviour_diffs(id)"
                + "   ON DELETE CASCADE,"
                + " title TEXT NOT NULL)");
            // The changeset-160 TWO-WAY constraint 179 must drop + re-create.
            st.execute("ALTER TABLE discovery_findings "
                + "ADD CONSTRAINT discovery_finding_exactly_one_origin "
                + "CHECK ((run_id IS NOT NULL)::int + (api_behaviour_diff_id IS NOT NULL)::int = 1)");
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
                    // H2 lacks COMMENT ON CONSTRAINT; comments are
                    // documentation-only -- skip under H2.
                    continue;
                }
                // H2 lacks the TIMESTAMPTZ alias -- expand to the standard
                // spelling (identical type in PostgreSQL).
                stmt = stmt.replace("TIMESTAMPTZ", "TIMESTAMP WITH TIME ZONE");
                if (upper.startsWith("CREATE INDEX")) {
                    // H2 has no partial indexes -- strip the WHERE clause
                    // (production PostgreSQL runs it verbatim).
                    int where = upper.indexOf("WHERE");
                    if (where >= 0) {
                        stmt = stmt.substring(0, where).trim() + ";";
                    }
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

    private static List<String> findingIds(Connection conn) throws Exception {
        List<String> ids = new ArrayList<>();
        try (Statement st = conn.createStatement();
             ResultSet rs = st.executeQuery("SELECT id FROM discovery_findings ORDER BY id")) {
            while (rs.next()) {
                ids.add(rs.getString("id"));
            }
        }
        return ids;
    }
}
