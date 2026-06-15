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
 * Validates that the NEW Liquibase changeset
 * {@code db/changelog/sql/170-discovery-findings-review-status.sql} (Spec:
 * Normalize Findings Review Actions / Spec F, 2026-06-02 -- Task Group 1)
 * applies cleanly on a database that already carries the pre-Spec-F
 * {@code discovery_findings} shape, and produces the intended
 * {@code review_status} rename + value migration + audit column + index
 * rebuild.
 *
 * <h2>Why execute the SQL file directly</h2>
 *
 * <p>The shared test profile pins H2 with {@code liquibase.enabled=false} and
 * Hibernate {@code create-drop}, so the real changesets never run there, and
 * running the FULL master changelog against H2 is not viable (earlier
 * changesets use Postgres-only constructs). This test therefore seeds a
 * minimal pre-Spec-F {@code discovery_findings} table (old {@code status}
 * column + old {@code idx_discovery_finding_status} index + one row per legacy
 * value), then applies the ACTUAL 170 changeset SQL statement-by-statement
 * (mirroring the changelog's {@code splitStatements: true} /
 * {@code stripComments: true} processing) against an isolated, FRESH H2
 * PostgreSQL-mode database, and asserts the resulting schema + migrated
 * values. Mirrors {@code EndpointDataEffectsChangesetTest}.</p>
 *
 * <p>This is a plain JUnit test (no Spring context).</p>
 */
class DiscoveryFindingsReviewStatusChangesetTest {

    private static final String SQL_PATH =
        "db/changelog/sql/170-discovery-findings-review-status.sql";

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

    @Test
    @DisplayName("170-discovery-findings-review-status.sql renames status->review_status, migrates all five legacy values, adds previous_review_status, and rebuilds the single status index")
    void changesetAppliesCleanlyAndMigratesValues() throws Exception {
        String sql = StreamUtils.copyToString(
            new ClassPathResource(SQL_PATH).getInputStream(), StandardCharsets.UTF_8);
        List<String> statements = splitStatements(sql);

        String url = "jdbc:h2:mem:findingsReviewStatus_" + System.nanoTime()
            + ";DB_CLOSE_DELAY=-1;MODE=PostgreSQL";

        try (Connection conn = DriverManager.getConnection(url, "sa", "")) {
            // Seed the pre-Spec-F discovery_findings shape: TEXT `status`
            // column with the legacy default + the old status index. Only the
            // columns the 170 changeset touches are needed.
            try (Statement st = conn.createStatement()) {
                st.execute(
                    "CREATE TABLE discovery_findings ("
                        + "  id TEXT PRIMARY KEY,"
                        + "  status TEXT NOT NULL DEFAULT 'new',"
                        + "  title TEXT NOT NULL"
                        + ")");
                st.execute("CREATE INDEX idx_discovery_finding_status "
                    + "ON discovery_findings (status)");
                // One row per legacy value.
                st.execute("INSERT INTO discovery_findings (id, status, title) VALUES "
                    + "('f-new', 'new', 't'),"
                    + "('f-accepted', 'accepted', 't'),"
                    + "('f-ignored', 'ignored', 't'),"
                    + "('f-needs-review', 'needs_review', 't'),"
                    + "('f-resolved', 'resolved', 't')");
            }

            // Apply the actual changeset SQL, statement by statement.
            try (Statement st = conn.createStatement()) {
                for (String stmt : statements) {
                    st.execute(stmt);
                }
            }

            Set<String> columns = columnNames(conn, "DISCOVERY_FINDINGS");
            assertThat(columns)
                .as("status renamed to review_status; previous_review_status added")
                .contains("REVIEW_STATUS", "PREVIOUS_REVIEW_STATUS")
                .doesNotContain("STATUS");

            // Exactly one status-ish index remains, now on review_status.
            Set<String> indexes = indexNames(conn, "DISCOVERY_FINDINGS");
            assertThat(indexes).contains("IDX_DISCOVERY_FINDING_REVIEW_STATUS");
            assertThat(indexes).doesNotContain("IDX_DISCOVERY_FINDING_STATUS");

            // The new column default is pending_review (a fresh insert without
            // review_status lands on it).
            try (Statement st = conn.createStatement()) {
                st.execute("INSERT INTO discovery_findings (id, title) VALUES ('f-default', 't')");
            }
            assertThat(reviewStatusOf(conn, "f-default"))
                .as("new rows default to pending_review")
                .isEqualTo("pending_review");

            // All five legacy values are migrated.
            assertThat(reviewStatusOf(conn, "f-new")).isEqualTo("pending_review");
            assertThat(reviewStatusOf(conn, "f-accepted")).isEqualTo("approved");
            assertThat(reviewStatusOf(conn, "f-ignored")).isEqualTo("rejected");
            assertThat(reviewStatusOf(conn, "f-needs-review")).isEqualTo("deferred");
            assertThat(reviewStatusOf(conn, "f-resolved")).isEqualTo("approved");

            // No legacy value remains anywhere in the column.
            assertThat(distinctReviewStatuses(conn))
                .containsExactlyInAnyOrder("pending_review", "approved", "rejected", "deferred")
                .doesNotContain("new", "accepted", "ignored", "needs_review", "resolved");

            // previous_review_status is nullable and unset by the migration
            // (the rename does not populate the audit column).
            try (Statement st = conn.createStatement();
                 ResultSet rs = st.executeQuery(
                     "SELECT previous_review_status FROM discovery_findings WHERE id = 'f-accepted'")) {
                assertThat(rs.next()).isTrue();
                assertThat(rs.getString("previous_review_status")).isNull();
            }
        }
    }

    private static String reviewStatusOf(Connection conn, String id) throws Exception {
        try (Statement st = conn.createStatement();
             ResultSet rs = st.executeQuery(
                 "SELECT review_status FROM discovery_findings WHERE id = '" + id + "'")) {
            assertThat(rs.next()).as("row %s exists", id).isTrue();
            return rs.getString("review_status");
        }
    }

    private static Set<String> distinctReviewStatuses(Connection conn) throws Exception {
        Set<String> out = new HashSet<>();
        try (Statement st = conn.createStatement();
             ResultSet rs = st.executeQuery(
                 "SELECT DISTINCT review_status FROM discovery_findings")) {
            while (rs.next()) {
                out.add(rs.getString("review_status"));
            }
        }
        return out;
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

    private static Set<String> indexNames(Connection conn, String table) throws Exception {
        Set<String> idx = new HashSet<>();
        try (ResultSet rs = conn.getMetaData().getIndexInfo(null, null, table, false, false)) {
            while (rs.next()) {
                String name = rs.getString("INDEX_NAME");
                if (name != null) {
                    idx.add(name.toUpperCase());
                }
            }
        }
        return idx;
    }
}
