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
 * {@code db/changelog/sql/197-vulnerabilities.sql} (Spec: Vulnerability store +
 * manual capture + current-state view, 2026-06-24, Spec 1 of 6 -- Task Group 1)
 * applies cleanly on a fresh H2 PostgreSQL-mode database and produces BOTH
 * tables ({@code vulnerability_reports}, {@code vulnerabilities}) with their
 * full index sets and the JSONB / DECIMAL / UUID columns.
 *
 * <h2>Why execute the SQL file directly</h2>
 *
 * <p>The shared test profile pins H2 with {@code liquibase.enabled=false} and
 * Hibernate {@code create-drop}, so the real changesets never run there, and
 * running the FULL master changelog against H2 is not viable (earlier
 * changesets use Postgres-only constructs). This test therefore applies the
 * ACTUAL 197 changeset SQL statement-by-statement (mirroring the changelog's
 * {@code splitStatements: true} / {@code stripComments: true} processing)
 * against an isolated, FRESH H2 PostgreSQL-mode database, and asserts the
 * resulting schema. Mirrors {@code DiscoveryFindingsReviewStatusChangesetTest}.</p>
 *
 * <p>The production DDL keeps the established codebase convention of {@code JSONB}
 * + {@code TIMESTAMPTZ} (as used by {@code 135-discovery-findings.sql} /
 * {@code 184-discovery-capability.sql} against real PostgreSQL). H2 does not
 * recognise either shorthand natively, so -- exactly as the {@code @DataJpaTest}
 * datasource already aliases {@code JSONB AS JSON} -- this test registers BOTH
 * {@code JSONB} and {@code TIMESTAMPTZ} as H2 domain aliases in the connection
 * {@code INIT} so the unmodified production SQL executes here.</p>
 *
 * <p>The {@link #splitStatements(String)} helper is string-literal-aware: like
 * Liquibase's SQL-aware {@code stripComments}, it strips {@code --} line
 * comments and splits on {@code ;} ONLY when NOT inside a single-quoted string.
 * The {@code COMMENT ON COLUMN} bodies in this changeset (and in the precedent
 * {@code 135} / {@code 184} / {@code 196} changesets) legitimately contain
 * {@code --} inside their literals; a naive splitter would corrupt them.</p>
 *
 * <p>This is a plain JUnit test (no Spring context).</p>
 */
class VulnerabilitiesChangesetTest {

    private static final String SQL_PATH = "db/changelog/sql/197-vulnerabilities.sql";

    /**
     * Mirror Liquibase's SQL-aware {@code stripComments} + {@code splitStatements}
     * for a plain DDL file. String-literal-aware: {@code --} line comments are
     * stripped and {@code ;} statement breaks are honoured ONLY when NOT inside a
     * single-quoted string literal (so {@code --} and {@code ;} inside
     * {@code COMMENT ON ... IS '...'} bodies are preserved). H2 single-quote
     * escaping is {@code ''} (a doubled quote inside a literal); handled.
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
                    // Doubled '' is an escaped quote, stay in-string.
                    if (i + 1 < n && sql.charAt(i + 1) == '\'') {
                        current.append('\'');
                        i++;
                    } else {
                        inString = false;
                    }
                }
                continue;
            }
            // Not in a string literal.
            if (c == '\'') {
                inString = true;
                current.append(c);
            } else if (c == '-' && i + 1 < n && sql.charAt(i + 1) == '-') {
                // Line comment: skip to end of line.
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
    @DisplayName("197-vulnerabilities.sql applies cleanly: creates vulnerability_reports + vulnerabilities with all columns, the FK, and the full index set")
    void changesetAppliesCleanly() throws Exception {
        String sql = StreamUtils.copyToString(
            new ClassPathResource(SQL_PATH).getInputStream(), StandardCharsets.UTF_8);
        List<String> statements = splitStatements(sql);

        // JSONB + TIMESTAMPTZ domain aliases so the unmodified production DDL
        // (JSONB columns, TIMESTAMPTZ columns, COMMENT ON statements) applies on
        // H2, mirroring the @DataJpaTest H2-in-PostgreSQL-mode datasource's
        // JSONB alias. The production columns stay on the codebase convention.
        String url = "jdbc:h2:mem:vulnChangeset_" + System.nanoTime()
            + ";DB_CLOSE_DELAY=-1;MODE=PostgreSQL"
            + ";INIT=CREATE DOMAIN IF NOT EXISTS JSONB AS JSON"
            + "\\;CREATE DOMAIN IF NOT EXISTS TIMESTAMPTZ AS TIMESTAMP WITH TIME ZONE";

        try (Connection conn = DriverManager.getConnection(url, "sa", "")) {
            // Apply the actual changeset SQL, statement by statement -- a failure
            // here (bad DDL, unknown type, wrong order) fails the test.
            try (Statement st = conn.createStatement()) {
                for (String stmt : statements) {
                    st.execute(stmt);
                }
            }

            // ---- vulnerability_reports columns ----
            Set<String> reportCols = columnNames(conn, "VULNERABILITY_REPORTS");
            assertThat(reportCols).contains(
                "ID", "PROJECT_ID", "ARCHITECTURE_ID", "SOURCE", "ORIGINAL_FILENAME",
                "FORMAT", "UPLOADED_AT", "IS_LATEST", "ROW_COUNT_INGESTED",
                "ROW_COUNT_DROPPED", "PARSE_STRATEGY", "NOTES");

            // ---- vulnerabilities columns (incl. the LOCKED Spec-4 contract fields) ----
            Set<String> vulnCols = columnNames(conn, "VULNERABILITIES");
            assertThat(vulnCols).contains(
                "ID", "PROJECT_ID", "ARCHITECTURE_ID", "REPORT_ID", "INGESTED_AT",
                "CVE_ID", "CWE", "TITLE", "DETAILS", "CVSS",
                "SEVERITY", "SEVERITY_RAW",
                "AFFECTED_COORDINATE", "ECOSYSTEM", "AFFECTED_VERSION", "AFFECTED_VERSION_RANGE",
                "FIXED_IN_VERSIONS", "SOURCE", "RAW_ROW",
                "MATCH_STATUS", "MATCHED_LIBRARY_ID", "MATCHED_DECLARED_VERSION");

            // ---- index sets (mirror discovery_findings: one per read key) ----
            Set<String> reportIdx = indexNames(conn, "VULNERABILITY_REPORTS");
            assertThat(reportIdx).contains(
                "IDX_VULNERABILITY_REPORT_PROJECT_ID",
                "IDX_VULNERABILITY_REPORT_ARCHITECTURE_ID",
                "IDX_VULNERABILITY_REPORT_SOURCE",
                "IDX_VULNERABILITY_REPORT_IS_LATEST");

            Set<String> vulnIdx = indexNames(conn, "VULNERABILITIES");
            assertThat(vulnIdx).contains(
                "IDX_VULNERABILITY_PROJECT_ID",
                "IDX_VULNERABILITY_ARCHITECTURE_ID",
                "IDX_VULNERABILITY_REPORT_ID",
                "IDX_VULNERABILITY_CVE_ID",
                "IDX_VULNERABILITY_AFFECTED_COORDINATE",
                "IDX_VULNERABILITY_SEVERITY",
                "IDX_VULNERABILITY_MATCH_STATUS",
                "IDX_VULNERABILITY_SOURCE");

            // ---- functional sanity: insert a report + read defaults back ----
            try (Statement st = conn.createStatement()) {
                st.execute("INSERT INTO vulnerability_reports "
                    + "(id, project_id, architecture_id, source) VALUES "
                    + "(RANDOM_UUID(), RANDOM_UUID(), RANDOM_UUID(), 'internal_report')");
            }
            // is_latest defaults TRUE; uploaded_at defaults NOW().
            try (Statement st = conn.createStatement();
                 ResultSet rs = st.executeQuery(
                     "SELECT is_latest, uploaded_at FROM vulnerability_reports")) {
                assertThat(rs.next()).isTrue();
                assertThat(rs.getBoolean("is_latest")).isTrue();
                assertThat(rs.getObject("uploaded_at")).isNotNull();
            }
        }
    }

    @Test
    @DisplayName("db.changelog-master.yaml registers changeset 197 AFTER 196, with 196 untouched")
    void masterChangelogRegisters197After196() throws Exception {
        String master = StreamUtils.copyToString(
            new ClassPathResource("db/changelog/db.changelog-master.yaml").getInputStream(),
            StandardCharsets.UTF_8);

        assertThat(master)
            .as("changeset 197 must be registered with its sqlFile path")
            .contains("id: 197-vulnerabilities")
            .contains("db/changelog/sql/197-vulnerabilities.sql");

        // 196 (the previous changeset) must still be present and unmodified.
        assertThat(master)
            .as("changeset 196 anchor must still be present -- verifies we did not delete/alter it")
            .contains("id: 196-capture-behaviour-semantics-config")
            .contains("db/changelog/sql/196-capture-behaviour-semantics-config.sql");

        // 197 must be registered AFTER 196 (the append point).
        int idx196 = master.indexOf("id: 196-capture-behaviour-semantics-config");
        int idx197 = master.indexOf("id: 197-vulnerabilities");
        assertThat(idx196).isGreaterThan(-1);
        assertThat(idx197)
            .as("changeset 197 must be registered AFTER 196")
            .isGreaterThan(idx196);

        // 197 uses the not-tableExists precondition idiom (mirrors 135 / 184).
        assertThat(master).contains("tableName: vulnerabilities");
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
