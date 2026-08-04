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
 * Validates that the new Liquibase changeset
 * {@code 215-db-structural-finding-dispositions.sql} applies cleanly on a
 * fresh database and that its constraints bite: chk_dsfd_disposition, the
 * per-project finding_key unique index (uq_dsfd_project_finding_key) and the
 * NOT NULL identity columns.
 *
 * <p>Same approach as {@link DbMigrationPackTranslationChangesetTest}: the
 * shared test profile pins {@code liquibase.enabled=false} and the full
 * master changelog is not H2-runnable, so this test reads the ACTUAL SQL file
 * from the classpath and executes it -- mirroring the changelog's
 * {@code splitStatements} / {@code stripComments} processing -- against an
 * isolated, fresh H2 PostgreSQL-mode database. The table is standalone (no
 * FK by design: dispositions are keyed by project + finding_key so they
 * survive pack regeneration), so no predecessor changesets are needed.</p>
 *
 * <p>Spec: Structural findings dispositions (2026-08-04) -- Spec 2.</p>
 */
class DbStructuralFindingDispositionChangesetTest {

    private static final String SQL_PATH =
        "db/changelog/sql/215-db-structural-finding-dispositions.sql";

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
    @DisplayName("Changeset 215 applies cleanly: dispositions table with CHECK, per-project finding_key unique and NOT NULL identity columns")
    void newChangesetAppliesCleanlyWithBitingConstraints() throws Exception {
        String url = "jdbc:h2:mem:dbStructFindingDispChangeset_" + System.nanoTime()
            + ";DB_CLOSE_DELAY=-1;MODE=PostgreSQL;INIT=CREATE DOMAIN IF NOT EXISTS JSONB AS JSON";

        try (Connection conn = DriverManager.getConnection(url, "sa", "")) {
            // Apply the ACTUAL changeset file.
            try (Statement st = conn.createStatement()) {
                String sql = StreamUtils.copyToString(
                    new ClassPathResource(SQL_PATH).getInputStream(), StandardCharsets.UTF_8);
                for (String stmt : splitStatements(sql)) {
                    st.execute(stmt);
                }
            }

            assertThat(tableExists(conn, "DB_STRUCTURAL_FINDING_DISPOSITIONS")).isTrue();

            // The table carries every spec'd column.
            assertThat(columnNames(conn, "DB_STRUCTURAL_FINDING_DISPOSITIONS"))
                .containsExactlyInAnyOrder(
                    "ID", "PROJECT_ID", "FINDING_KEY", "KIND", "SUBJECT",
                    "DISPOSITION", "NOTE", "CREATED_AT", "UPDATED_AT");

            // Seed one disposition row; created_at defaults.
            try (Statement st = conn.createStatement()) {
                st.execute("INSERT INTO db_structural_finding_dispositions "
                    + "(id, project_id, finding_key, kind, subject, disposition, note) "
                    + "VALUES ('11111111-1111-1111-1111-111111111111', "
                    + "'22222222-2222-2222-2222-222222222222', "
                    + "'no_primary_keys:all_tables', 'no_primary_keys', 'all_tables', "
                    + "'accepted', 'legacy schema never had PKs')");
            }
            try (Statement st = conn.createStatement();
                 ResultSet rs = st.executeQuery(
                     "SELECT disposition, created_at, updated_at "
                         + "FROM db_structural_finding_dispositions "
                         + "WHERE id = '11111111-1111-1111-1111-111111111111'")) {
                assertThat(rs.next()).isTrue();
                assertThat(rs.getString("disposition")).isEqualTo("accepted");
                assertThat(rs.getTimestamp("created_at")).isNotNull();
                assertThat(rs.getTimestamp("updated_at")).isNull();
            }

            // finding_key unique per project (uq_dsfd_project_finding_key).
            assertThatThrownBy(() -> {
                try (Statement st = conn.createStatement()) {
                    st.execute("INSERT INTO db_structural_finding_dispositions "
                        + "(id, project_id, finding_key, kind, subject, disposition) "
                        + "VALUES ('33333333-3333-3333-3333-333333333333', "
                        + "'22222222-2222-2222-2222-222222222222', "
                        + "'no_primary_keys:all_tables', 'no_primary_keys', 'all_tables', "
                        + "'fix_upstream')");
                }
            }).isInstanceOf(SQLException.class);

            // ...but the SAME key on a DIFFERENT project is fine (per-project
            // scoping, the regeneration-survival property).
            try (Statement st = conn.createStatement()) {
                st.execute("INSERT INTO db_structural_finding_dispositions "
                    + "(id, project_id, finding_key, kind, subject, disposition) "
                    + "VALUES ('44444444-4444-4444-4444-444444444444', "
                    + "'55555555-5555-5555-5555-555555555555', "
                    + "'no_primary_keys:all_tables', 'no_primary_keys', 'all_tables', "
                    + "'fix_upstream')");
            }

            // chk_dsfd_disposition bites: an unknown disposition rejects.
            assertThatThrownBy(() -> {
                try (Statement st = conn.createStatement()) {
                    st.execute("INSERT INTO db_structural_finding_dispositions "
                        + "(id, project_id, finding_key, kind, subject, disposition) "
                        + "VALUES ('66666666-6666-6666-6666-666666666666', "
                        + "'22222222-2222-2222-2222-222222222222', "
                        + "'no_foreign_keys:dbo.orders', 'no_foreign_keys', 'dbo.orders', "
                        + "'shrugged')");
                }
            }).isInstanceOf(SQLException.class);

            // NOT NULL identity columns bite (kind omitted).
            assertThatThrownBy(() -> {
                try (Statement st = conn.createStatement()) {
                    st.execute("INSERT INTO db_structural_finding_dispositions "
                        + "(id, project_id, finding_key, subject, disposition) "
                        + "VALUES ('77777777-7777-7777-7777-777777777777', "
                        + "'22222222-2222-2222-2222-222222222222', "
                        + "'no_foreign_keys:dbo.orders', 'dbo.orders', 'fix_upstream')");
                }
            }).isInstanceOf(SQLException.class);

            // note is NULLABLE at the schema level (the accepted/known_gap
            // note rule is service-enforced) -- fix_upstream without a note
            // persists.
            assertThat(rowCount(conn, "db_structural_finding_dispositions")).isEqualTo(2);
        }
    }

    private static boolean tableExists(Connection conn, String table) throws Exception {
        try (ResultSet rs = conn.getMetaData().getTables(null, null, table, new String[]{"TABLE"})) {
            return rs.next();
        }
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

    private static int rowCount(Connection conn, String table) throws Exception {
        try (Statement st = conn.createStatement();
             ResultSet rs = st.executeQuery("SELECT COUNT(*) FROM " + table)) {
            rs.next();
            return rs.getInt(1);
        }
    }
}
