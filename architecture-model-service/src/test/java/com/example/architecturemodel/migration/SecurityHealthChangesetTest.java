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
import java.util.HashSet;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Validates the NEW Liquibase changesets
 * {@code 211-security-health-foundation.sql} (tables) and
 * {@code 212-cwe-mitre-seed.sql} (the real MITRE view-1000 CWE seed) apply
 * cleanly against a fresh H2 PostgreSQL-mode database (Security health
 * dashboard, 2026-07-19, Spec 1 of 3).
 *
 * <p>Why execute the SQL directly: the shared test profile pins H2 with
 * {@code liquibase.enabled=false}, so the real changesets never run there
 * (mirrors {@code VulnerabilityFindingsChangesetTest}). {@code COMMENT ON}
 * statements are documentation-only and skipped under H2; the load-bearing DDL
 * + the 944 seed INSERTs run verbatim. 212 is applied line-wise (one INSERT
 * per line) because CWE descriptions legitimately contain semicolons.</p>
 */
class SecurityHealthChangesetTest {

    private static final String SQL_211 = "db/changelog/sql/211-security-health-foundation.sql";
    private static final String SQL_212 = "db/changelog/sql/212-cwe-mitre-seed.sql";
    private static final String SQL_213 = "db/changelog/sql/213-security-finding-entity-id.sql";

    @Test
    @DisplayName("211 creates the seven security-health tables with the M:N joins + unique keys; 212 seeds 944 MITRE CWEs (CWE-89 = SQL injection) onto them")
    void changesetsApplyAndSeedReadsBack() throws Exception {
        String url = "jdbc:h2:mem:secHealth_" + System.nanoTime()
            + ";DB_CLOSE_DELAY=-1;MODE=PostgreSQL;NON_KEYWORDS=KEY;"
            + "INIT=CREATE DOMAIN IF NOT EXISTS JSONB AS JSON";

        try (Connection conn = DriverManager.getConnection(url, "sa", "")) {
            applyStatementWise(conn, SQL_211);

            for (String table : new String[] {
                    "SECURITY_FINDING_REPORTS", "SECURITY_FINDINGS", "CVES", "CWES",
                    "SECURITY_FINDING_CVES", "SECURITY_FINDING_CWES",
                    "SECURITY_LINKING_ALIASES"}) {
                assertThat(tableExists(conn, table))
                    .as("table %s exists", table)
                    .isTrue();
            }
            assertThat(columnNames(conn, "SECURITY_FINDINGS"))
                .contains("LINKING_VALUE", "LEVEL", "APPLICATION_ID", "MATCH_STATUS",
                    "SEVERITY", "SEVERITY_RAW", "TITLE", "DESCRIPTION", "DETECTED_AT",
                    "LOCATION", "SOURCE_PATH", "CVSS_VECTOR_REPORTED",
                    "SOURCE_FINDING_ID", "OTHER_IDENTIFIERS")
                // The user-scoped v1 subset deliberately EXCLUDES these:
                .doesNotContain("TOOL", "SCANNER_NAME", "GROUP_NAME", "ACTIVITY",
                    "COMMENTS", "DISMISSAL_REASON", "TRACKED_CONTEXT_NAME", "RAW_ROW");
            assertThat(columnNames(conn, "SECURITY_FINDING_REPORTS"))
                .contains("ASSOCIATION_LEVEL", "COLUMN_MAPPING", "ORIGINAL_FILENAMES",
                    "IS_LATEST");

            applyStatementWise(conn, SQL_212);
            applyStatementWise(conn, SQL_213);
            assertThat(columnNames(conn, "SECURITY_FINDINGS"))
                .as("213 adds the level-generic entity_id attribution column")
                .contains("ENTITY_ID");

            try (Statement st = conn.createStatement()) {
                ResultSet rs = st.executeQuery("SELECT COUNT(*) FROM cwes");
                rs.next();
                assertThat(rs.getInt(1)).isEqualTo(944);

                rs = st.executeQuery(
                    "SELECT name, source, enrichment_status FROM cwes WHERE cwe_id = 'CWE-89'");
                assertThat(rs.next()).isTrue();
                assertThat(rs.getString(1)).contains("SQL");
                assertThat(rs.getString(2)).isEqualTo("mitre");
                assertThat(rs.getString(3)).isEqualTo("enriched");
            }

            // The 211 unique key holds: a duplicate cwe_id insert must fail.
            boolean duplicateRejected = false;
            try (Statement st = conn.createStatement()) {
                st.execute("INSERT INTO cwes (id, cwe_id, enrichment_status) VALUES "
                    + "('00000000-0000-0000-0000-000000000001', 'CWE-89', 'pending')");
            } catch (Exception expected) {
                duplicateRejected = true;
            }
            assertThat(duplicateRejected).as("uq_cwes_cwe_id enforced").isTrue();
        }
    }

    // ---------------------------------------------------------------------

    /**
     * Apply a changeset with a QUOTE-AWARE statement splitter: comment text and
     * string literals (CWE descriptions, COMMENT ON bodies) legitimately contain
     * semicolons, so splitting happens only on ';' OUTSIDE single-quoted strings
     * after full-line comments are stripped. COMMENT ON statements are
     * documentation-only and skipped under H2.
     */
    private static void applyStatementWise(Connection conn, String resource) throws Exception {
        // H2 has no TIMESTAMPTZ alias (Postgres shorthand for the same type).
        String sql = read(resource).replace("TIMESTAMPTZ", "TIMESTAMP WITH TIME ZONE");
        for (String statement : splitStatements(stripLineComments(sql))) {
            String trimmed = statement.trim();
            if (trimmed.isEmpty() || trimmed.toUpperCase().startsWith("COMMENT ON")) {
                continue;
            }
            try (Statement st = conn.createStatement()) {
                st.execute(trimmed);
            }
        }
    }

    /** Split on ';' outside single-quoted literals ('' is the escape). */
    private static java.util.List<String> splitStatements(String sql) {
        java.util.List<String> out = new java.util.ArrayList<>();
        StringBuilder current = new StringBuilder();
        boolean inQuote = false;
        for (int i = 0; i < sql.length(); i++) {
            char c = sql.charAt(i);
            if (c == '\'') {
                inQuote = !inQuote;
                current.append(c);
            } else if (c == ';' && !inQuote) {
                out.add(current.toString());
                current.setLength(0);
            } else {
                current.append(c);
            }
        }
        if (!current.toString().isBlank()) {
            out.add(current.toString());
        }
        return out;
    }

    private static String stripLineComments(String block) {
        StringBuilder sb = new StringBuilder();
        for (String line : block.split("\r?\n")) {
            if (!line.trim().startsWith("--")) {
                sb.append(line).append('\n');
            }
        }
        return sb.toString();
    }

    private static String read(String resource) throws Exception {
        return StreamUtils.copyToString(
            new ClassPathResource(resource).getInputStream(), StandardCharsets.UTF_8);
    }

    private static boolean tableExists(Connection conn, String table) throws Exception {
        try (ResultSet rs = conn.getMetaData().getTables(null, null, table, null)) {
            return rs.next();
        }
    }

    private static Set<String> columnNames(Connection conn, String table) throws Exception {
        Set<String> names = new HashSet<>();
        try (ResultSet rs = conn.getMetaData().getColumns(null, null, table, null)) {
            while (rs.next()) {
                names.add(rs.getString("COLUMN_NAME").toUpperCase());
            }
        }
        return names;
    }
}
