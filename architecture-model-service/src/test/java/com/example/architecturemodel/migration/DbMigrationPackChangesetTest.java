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
 * Validates that the FOUR new Liquibase changesets
 * {@code 172-db-migration-packs.sql} / {@code 173-db-migration-pack-files.sql}
 * / {@code 174-db-migration-pack-decisions.sql} /
 * {@code 175-db-migration-pack-drift-reports.sql} apply cleanly IN ORDER on a
 * fresh database and produce the intended tables, uniques and FK cascades
 * (Task Group 1, sub-tasks 1.2 + 1.6).
 *
 * <p>Same approach as {@link EndpointDataEffectsChangesetTest}: the shared
 * test profile pins {@code liquibase.enabled=false}, and the full master
 * changelog is not H2-runnable (Postgres-only constructs in earlier
 * changesets), so this test reads the ACTUAL SQL files from the classpath and
 * executes them -- mirroring the changelog's {@code splitStatements} /
 * {@code stripComments} processing -- against an isolated, fresh H2
 * PostgreSQL-mode database with the {@code CREATE DOMAIN JSONB AS JSON}
 * alias.</p>
 *
 * <p>Spec: Source-Grade DB Schema + Data Migration Pack (2026-06-11) --
 * Task Group 1.</p>
 */
class DbMigrationPackChangesetTest {

    private static final List<String> SQL_PATHS = List.of(
        "db/changelog/sql/172-db-migration-packs.sql",
        "db/changelog/sql/173-db-migration-pack-files.sql",
        "db/changelog/sql/174-db-migration-pack-decisions.sql",
        "db/changelog/sql/175-db-migration-pack-drift-reports.sql");

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
    @DisplayName("Changesets 172-175 apply in order on a clean DB: four pack tables with uniques, checks and FK cascades")
    void changesetsApplyCleanlyInOrder() throws Exception {
        String url = "jdbc:h2:mem:dbMigPackChangeset_" + System.nanoTime()
            + ";DB_CLOSE_DELAY=-1;MODE=PostgreSQL;INIT=CREATE DOMAIN IF NOT EXISTS JSONB AS JSON";

        try (Connection conn = DriverManager.getConnection(url, "sa", "")) {
            // Apply the four ACTUAL changeset files in master-changelog order.
            try (Statement st = conn.createStatement()) {
                for (String path : SQL_PATHS) {
                    String sql = StreamUtils.copyToString(
                        new ClassPathResource(path).getInputStream(), StandardCharsets.UTF_8);
                    for (String stmt : splitStatements(sql)) {
                        st.execute(stmt);
                    }
                }
            }

            // All four tables exist.
            assertThat(tableExists(conn, "DB_MIGRATION_PACKS")).isTrue();
            assertThat(tableExists(conn, "DB_MIGRATION_PACK_FILES")).isTrue();
            assertThat(tableExists(conn, "DB_MIGRATION_PACK_DECISIONS")).isTrue();
            assertThat(tableExists(conn, "DB_MIGRATION_PACK_DRIFT_REPORTS")).isTrue();

            // The pack table carries every spec'd column.
            assertThat(columnNames(conn, "DB_MIGRATION_PACKS")).containsExactlyInAnyOrder(
                "ID", "PROJECT_ID", "ARCHITECTURE_ID", "STATUS", "STALE_REASON",
                "INPUT_SNAPSHOT_HASH", "GENERATED_AT", "WORK_ITEM_ID",
                "TRANSLATED_COUNT", "SKIPPED_COUNT", "FLAGGED_COUNT",
                "SEED_MARGIN", "MANIFEST_JSON", "CREATED_AT", "UPDATED_AT");

            // Functional checks: seed one pack + children.
            try (Statement st = conn.createStatement()) {
                st.execute("INSERT INTO db_migration_packs "
                    + "(id, project_id, architecture_id, status, input_snapshot_hash, "
                    + " translated_count, skipped_count, flagged_count, seed_margin, manifest_json) "
                    + "VALUES ('11111111-1111-1111-1111-111111111111', "
                    + "'22222222-2222-2222-2222-222222222222', "
                    + "'33333333-3333-3333-3333-333333333333', 'generated', 'sha256:x', "
                    + "10, 2, 3, 1000, '{\"phase_ordering\":[]}')");
                st.execute("INSERT INTO db_migration_pack_files "
                    + "(id, pack_id, file_path, file_kind, content, sort_order) "
                    + "VALUES ('44444444-4444-4444-4444-444444444444', "
                    + "'11111111-1111-1111-1111-111111111111', "
                    + "'liquibase/db.changelog-master.xml', 'liquibase_master', '<include/>', 0)");
                st.execute("INSERT INTO db_migration_pack_decisions "
                    + "(id, pack_id, decision_key, category, status) "
                    + "VALUES ('55555555-5555-5555-5555-555555555555', "
                    + "'11111111-1111-1111-1111-111111111111', "
                    + "'type_mapping:dbo.orders.rowver', 'type_mapping', 'open')");
                st.execute("INSERT INTO db_migration_pack_drift_reports "
                    + "(id, pack_id, match_count, missing_count, mismatch_count, report_json) "
                    + "VALUES ('66666666-6666-6666-6666-666666666666', "
                    + "'11111111-1111-1111-1111-111111111111', 5, 1, 0, '{\"objects\":[]}')");
            }

            // source defaulted to 'in_tool' by the column default.
            try (Statement st = conn.createStatement();
                 ResultSet rs = st.executeQuery(
                     "SELECT source FROM db_migration_pack_drift_reports "
                         + "WHERE id = '66666666-6666-6666-6666-666666666666'")) {
                assertThat(rs.next()).isTrue();
                assertThat(rs.getString("source")).isEqualTo("in_tool");
            }

            // One active pack per (project, architecture): duplicate insert
            // violates uq_dmp_project_architecture.
            assertThatThrownBy(() -> {
                try (Statement st = conn.createStatement()) {
                    st.execute("INSERT INTO db_migration_packs "
                        + "(id, project_id, architecture_id, status) "
                        + "VALUES ('77777777-7777-7777-7777-777777777777', "
                        + "'22222222-2222-2222-2222-222222222222', "
                        + "'33333333-3333-3333-3333-333333333333', 'generated')");
                }
            }).isInstanceOf(SQLException.class);

            // decision_key unique per pack: duplicate key violates
            // uq_dmpd_pack_decision_key.
            assertThatThrownBy(() -> {
                try (Statement st = conn.createStatement()) {
                    st.execute("INSERT INTO db_migration_pack_decisions "
                        + "(id, pack_id, decision_key, category, status) "
                        + "VALUES ('88888888-8888-8888-8888-888888888888', "
                        + "'11111111-1111-1111-1111-111111111111', "
                        + "'type_mapping:dbo.orders.rowver', 'type_mapping', 'open')");
                }
            }).isInstanceOf(SQLException.class);

            // CHECK constraints bite: invalid status / category rejected.
            assertThatThrownBy(() -> {
                try (Statement st = conn.createStatement()) {
                    st.execute("INSERT INTO db_migration_packs "
                        + "(id, project_id, architecture_id, status) "
                        + "VALUES ('99999999-9999-9999-9999-999999999999', "
                        + "'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', "
                        + "'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'not-a-status')");
                }
            }).isInstanceOf(SQLException.class);

            // FK ON DELETE CASCADE: deleting the pack removes files,
            // decisions and drift reports.
            try (Statement st = conn.createStatement()) {
                st.execute("DELETE FROM db_migration_packs "
                    + "WHERE id = '11111111-1111-1111-1111-111111111111'");
            }
            assertThat(rowCount(conn, "db_migration_pack_files")).isZero();
            assertThat(rowCount(conn, "db_migration_pack_decisions")).isZero();
            assertThat(rowCount(conn, "db_migration_pack_drift_reports")).isZero();
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
