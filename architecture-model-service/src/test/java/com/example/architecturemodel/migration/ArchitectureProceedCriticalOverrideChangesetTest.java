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
 * {@code db/changelog/sql/198-architecture-proceed-critical-override.sql}
 * (Spec: Vulnerability Reduction + Steering, 2026-06-24, Spec 4 of 6 -- Task
 * Group 4) applies cleanly on the pre-existing {@code architecture} shape and
 * adds the proceed-with-remaining-criticals override audit trio
 * ({@code proceed_critical_override_justification} /
 * {@code proceed_remaining_critical_count} / {@code proceed_critical_override_at}),
 * all NULLABLE, and that an architecture row persists + reads the trio back.
 *
 * <p>Why execute the SQL file directly: the shared test profile pins H2 with
 * {@code liquibase.enabled=false}, so the real changesets never run there.
 * This test seeds the minimal pre-198 {@code architecture} shape, then applies
 * the ACTUAL changeset SQL statement-by-statement against a fresh H2
 * PostgreSQL-mode database (mirrors {@code CaptureInventoryReconciliationChangesetTest}
 * for the analogous capture-session coverage-override trio in changeset 178).</p>
 *
 * <p>H2 limitations worked around (production PostgreSQL is unaffected):
 * {@code COMMENT ON COLUMN} statements are skipped (documentation-only), and the
 * {@code TIMESTAMPTZ} type alias is expanded to the standard
 * {@code TIMESTAMP WITH TIME ZONE} spelling (identical type in PostgreSQL). The
 * load-bearing DDL -- the three NULLABLE columns -- runs verbatim.</p>
 */
class ArchitectureProceedCriticalOverrideChangesetTest {

    private static final String SQL_198 =
        "db/changelog/sql/198-architecture-proceed-critical-override.sql";

    @Test
    @DisplayName("198 applies on the pre-existing architecture shape: adds the proceed-override trio; a row persists + reads the trio back; defaults are null")
    void changesetAppliesAndTrioPersists() throws Exception {
        String url = "jdbc:h2:mem:proceedOverride_" + System.nanoTime()
            + ";DB_CLOSE_DELAY=-1;MODE=PostgreSQL";

        try (Connection conn = DriverManager.getConnection(url, "sa", "")) {
            seedPreChangesetShape(conn);

            apply(conn, SQL_198);

            // --- new columns exist ---
            Set<String> cols = columnNames(conn, "ARCHITECTURE");
            assertThat(cols).contains(
                "PROCEED_CRITICAL_OVERRIDE_JUSTIFICATION",
                "PROCEED_REMAINING_CRITICAL_COUNT",
                "PROCEED_CRITICAL_OVERRIDE_AT");

            // --- a pre-existing row (no override) reads the trio back as null ---
            try (Statement st = conn.createStatement()) {
                st.execute("INSERT INTO architecture (id, project_id, name) VALUES "
                    + "('11111111-1111-1111-1111-111111111111', "
                    + " '22222222-2222-2222-2222-222222222222', 'Target')");
            }
            try (Statement st = conn.createStatement();
                 ResultSet rs = st.executeQuery(
                     "SELECT proceed_critical_override_justification, "
                     + "proceed_remaining_critical_count, proceed_critical_override_at "
                     + "FROM architecture WHERE id = '11111111-1111-1111-1111-111111111111'")) {
                assertThat(rs.next()).isTrue();
                assertThat(rs.getString("proceed_critical_override_justification")).isNull();
                rs.getInt("proceed_remaining_critical_count");
                assertThat(rs.wasNull()).isTrue();
                assertThat(rs.getObject("proceed_critical_override_at")).isNull();
            }

            // --- recording an override persists + reads back the full trio ---
            try (Statement st = conn.createStatement()) {
                st.execute("UPDATE architecture SET "
                    + "proceed_critical_override_justification = 'approved by SRE on-call', "
                    + "proceed_remaining_critical_count = 2, "
                    + "proceed_critical_override_at = TIMESTAMP WITH TIME ZONE '2026-06-24 10:00:00+00' "
                    + "WHERE id = '11111111-1111-1111-1111-111111111111'");
            }
            try (Statement st = conn.createStatement();
                 ResultSet rs = st.executeQuery(
                     "SELECT proceed_critical_override_justification, "
                     + "proceed_remaining_critical_count, proceed_critical_override_at "
                     + "FROM architecture WHERE id = '11111111-1111-1111-1111-111111111111'")) {
                assertThat(rs.next()).isTrue();
                assertThat(rs.getString("proceed_critical_override_justification"))
                    .isEqualTo("approved by SRE on-call");
                assertThat(rs.getInt("proceed_remaining_critical_count")).isEqualTo(2);
                assertThat(rs.getObject("proceed_critical_override_at")).isNotNull();
            }
        }
    }

    @Test
    @DisplayName("db.changelog-master.yaml registers changeset 198 AFTER 197, with 197 untouched")
    void masterChangelogRegisters198After197() throws Exception {
        String master = StreamUtils.copyToString(
            new ClassPathResource("db/changelog/db.changelog-master.yaml").getInputStream(),
            StandardCharsets.UTF_8);

        assertThat(master)
            .as("changeset 198 must be registered with its sqlFile path")
            .contains("id: 198-architecture-proceed-critical-override")
            .contains("db/changelog/sql/198-architecture-proceed-critical-override.sql");

        // 197 (the previous changeset) must still be present and unmodified.
        assertThat(master)
            .as("changeset 197 anchor must still be present -- verifies we did not delete/alter it")
            .contains("id: 197-vulnerabilities")
            .contains("db/changelog/sql/197-vulnerabilities.sql");

        // 198 must be registered AFTER 197 (the append point).
        int idx197 = master.indexOf("id: 197-vulnerabilities");
        int idx198 = master.indexOf("id: 198-architecture-proceed-critical-override");
        assertThat(idx197).isGreaterThan(-1);
        assertThat(idx198)
            .as("changeset 198 must be registered AFTER 197")
            .isGreaterThan(idx197);

        // 198 uses the not-columnExists precondition idiom (clean no-op on re-run).
        assertThat(master).contains("columnName: proceed_critical_override_justification");
    }

    // ------------------------------------------------------------------
    // Seed: the minimal PRE-198 architecture shape (the columns 198 ALTERs onto).
    // ------------------------------------------------------------------

    private static void seedPreChangesetShape(Connection conn) throws Exception {
        try (Statement st = conn.createStatement()) {
            st.execute("CREATE TABLE architecture ("
                + " id UUID PRIMARY KEY,"
                + " project_id UUID NOT NULL,"
                + " name VARCHAR(255) NOT NULL,"
                + " draft_state VARCHAR(32) NULL,"
                + " kind VARCHAR(32) NULL)");
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
                    // Documentation-only; skip under H2.
                    continue;
                }
                // H2 lacks the TIMESTAMPTZ alias -- expand to the standard
                // spelling (identical type in PostgreSQL).
                stmt = stmt.replace("TIMESTAMPTZ", "TIMESTAMP WITH TIME ZONE");
                st.execute(stmt);
            }
        }
    }

    /**
     * Mirror Liquibase stripComments + splitStatements for a plain DDL file.
     * String-literal-aware: {@code --} line comments are stripped and {@code ;}
     * statement breaks honoured ONLY when NOT inside a single-quoted string (so
     * {@code --} and {@code ;} inside {@code COMMENT ON ... IS '...'} bodies are
     * preserved). H2 single-quote escaping is {@code ''}; handled.
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
