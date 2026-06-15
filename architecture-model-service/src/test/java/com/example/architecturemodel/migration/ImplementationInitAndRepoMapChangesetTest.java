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
 * Validates that the NEW Liquibase changeset
 * {@code db/changelog/sql/180-implementation-init-and-repo-map.sql}
 * (Spec: Implementation-Service Init and Integration Repair, 2026-06-12 --
 * Task Group 6 gap analysis) applies cleanly and produces the intended DDL:
 *
 * <ul>
 *   <li>the three nullable init-status columns on {@code project};</li>
 *   <li>the {@code project_implementation_repos} table whose project FK is
 *       {@code ON DELETE CASCADE} -- deleting a project must remove its repo
 *       map rows (the JPA entity uses a bare UUID column, so NO other test
 *       exercises this DB-level cascade);</li>
 *   <li>the {@code (project_id, folder)} uniqueness constraint (same folder
 *       allowed across different projects);</li>
 *   <li>the three nullable git-outcome columns on {@code work_item}.</li>
 * </ul>
 *
 * <p>Why execute the SQL file directly: the shared test profile pins H2 with
 * {@code liquibase.enabled=false}, so the real changesets never run there, and
 * the full master changelog is not H2-viable. This test seeds the minimal
 * pre-180 {@code project}/{@code work_item} shapes and applies the ACTUAL 180
 * changeset statement-by-statement against an isolated fresh H2
 * PostgreSQL-mode database. Mirrors
 * {@code CaptureInventoryReconciliationChangesetTest} (COMMENT ON skipped
 * under H2; {@code TIMESTAMPTZ} expanded to the standard spelling).</p>
 *
 * <p>This is a plain JUnit test (no Spring context).</p>
 */
class ImplementationInitAndRepoMapChangesetTest {

    private static final String SQL_PATH =
        "db/changelog/sql/180-implementation-init-and-repo-map.sql";

    private static final String PROJECT_A = "11111111-1111-1111-1111-111111111111";
    private static final String PROJECT_B = "22222222-2222-2222-2222-222222222222";

    @Test
    @DisplayName("180 changeset applies cleanly: init columns + outcome columns exist, and project DELETE cascades project_implementation_repos rows")
    void changesetAppliesAndProjectDeleteCascadesRepoRows() throws Exception {
        try (Connection conn = freshDatabase("implRepoCascade")) {
            seedPreChangesetShape(conn);
            apply(conn, SQL_PATH);

            // New nullable columns landed on both tables.
            assertThat(columnNames(conn, "PROJECT"))
                .contains("IMPLEMENTATION_INIT_SUCCESS", "IMPLEMENTATION_MODE",
                    "IMPLEMENTATION_PROJECT_DIR");
            assertThat(columnNames(conn, "WORK_ITEM"))
                .contains("IMPLEMENTATION_BRANCH", "IMPLEMENTATION_PR_URL",
                    "IMPLEMENTATION_LOGS_URL");

            // Seed a project with a two-repo map.
            try (Statement st = conn.createStatement()) {
                st.execute("INSERT INTO project (id, name) VALUES "
                    + "('" + PROJECT_A + "', 'acme-app')");
                st.execute("INSERT INTO project_implementation_repos "
                    + "(id, project_id, folder, git_url) VALUES "
                    + "('aaaaaaaa-0000-0000-0000-000000000001', '" + PROJECT_A
                    + "', 'backend', 'https://github.com/acme/backend.git'),"
                    + "('aaaaaaaa-0000-0000-0000-000000000002', '" + PROJECT_A
                    + "', 'frontend', 'https://github.com/acme/frontend.git')");
            }
            assertThat(repoRowCount(conn, PROJECT_A)).isEqualTo(2);

            // FK ON DELETE CASCADE: deleting the project removes its map.
            try (Statement st = conn.createStatement()) {
                st.execute("DELETE FROM project WHERE id = '" + PROJECT_A + "'");
            }
            assertThat(repoRowCount(conn, PROJECT_A))
                .as("project delete must cascade project_implementation_repos rows")
                .isZero();
        }
    }

    @Test
    @DisplayName("uq (project_id, folder): duplicate folder rejected within a project but the same folder is fine on another project")
    void uniqueProjectFolderConstraintEnforced() throws Exception {
        try (Connection conn = freshDatabase("implRepoUnique")) {
            seedPreChangesetShape(conn);
            apply(conn, SQL_PATH);

            try (Statement st = conn.createStatement()) {
                st.execute("INSERT INTO project (id, name) VALUES "
                    + "('" + PROJECT_A + "', 'acme-app'), ('" + PROJECT_B + "', 'beta-app')");
                st.execute("INSERT INTO project_implementation_repos "
                    + "(id, project_id, folder, git_url) VALUES "
                    + "('aaaaaaaa-0000-0000-0000-000000000001', '" + PROJECT_A
                    + "', 'backend', 'https://github.com/acme/backend.git')");
            }

            // Same (project_id, folder) pair -> constraint violation.
            assertThatThrownBy(() -> {
                try (Statement st = conn.createStatement()) {
                    st.execute("INSERT INTO project_implementation_repos "
                        + "(id, project_id, folder, git_url) VALUES "
                        + "('aaaaaaaa-0000-0000-0000-000000000003', '" + PROJECT_A
                        + "', 'backend', 'https://github.com/acme/other.git')");
                }
            }).isInstanceOf(SQLException.class);

            // Same folder on a DIFFERENT project is allowed.
            try (Statement st = conn.createStatement()) {
                st.execute("INSERT INTO project_implementation_repos "
                    + "(id, project_id, folder, git_url) VALUES "
                    + "('bbbbbbbb-0000-0000-0000-000000000001', '" + PROJECT_B
                    + "', 'backend', 'https://github.com/beta/backend.git')");
            }
            assertThat(repoRowCount(conn, PROJECT_B)).isEqualTo(1);
        }
    }

    // ------------------------------------------------------------------
    // Seed: the minimal pre-180 schema (only what the changeset touches).
    // ------------------------------------------------------------------

    private static Connection freshDatabase(String name) throws Exception {
        String url = "jdbc:h2:mem:" + name + "_" + System.nanoTime()
            + ";DB_CLOSE_DELAY=-1;MODE=PostgreSQL";
        return DriverManager.getConnection(url, "sa", "");
    }

    private static void seedPreChangesetShape(Connection conn) throws Exception {
        try (Statement st = conn.createStatement()) {
            st.execute("CREATE TABLE project (id UUID PRIMARY KEY, name TEXT NOT NULL)");
            st.execute("CREATE TABLE work_item (id UUID PRIMARY KEY, title TEXT)");
        }
    }

    // ------------------------------------------------------------------
    // Changeset application (mirrors Liquibase splitStatements/stripComments;
    // COMMENT ON skipped + TIMESTAMPTZ expanded for H2, same as
    // CaptureInventoryReconciliationChangesetTest).
    // ------------------------------------------------------------------

    private static void apply(Connection conn, String classpathSql) throws Exception {
        String sql = StreamUtils.copyToString(
            new ClassPathResource(classpathSql).getInputStream(), StandardCharsets.UTF_8);
        try (Statement st = conn.createStatement()) {
            for (String stmt : splitStatements(sql)) {
                String upper = stmt.toUpperCase();
                if (upper.startsWith("COMMENT ON")) {
                    // Documentation-only -- production PostgreSQL runs them.
                    continue;
                }
                stmt = stmt.replace("TIMESTAMPTZ", "TIMESTAMP WITH TIME ZONE");
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
        if (!current.toString().trim().isEmpty()) {
            statements.add(current.toString().trim());
        }
        return statements;
    }

    private static int repoRowCount(Connection conn, String projectId) throws Exception {
        try (Statement st = conn.createStatement();
             ResultSet rs = st.executeQuery(
                 "SELECT COUNT(*) FROM project_implementation_repos "
                     + "WHERE project_id = '" + projectId + "'")) {
            assertThat(rs.next()).isTrue();
            return rs.getInt(1);
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
}
