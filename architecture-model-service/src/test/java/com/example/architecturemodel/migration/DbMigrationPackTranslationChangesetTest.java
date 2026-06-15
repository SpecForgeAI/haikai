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
 * Validates that the TWO new Liquibase changesets
 * {@code 176-db-migration-pack-translations.sql} /
 * {@code 177-db-migration-pack-file-kind-translation.sql} apply cleanly on a
 * fresh database AFTER the Spec-1 pack changesets (172-173), and that the
 * extended {@code chk_dmpf_file_kind} accepts the 7th kind
 * {@code translation} while the original kinds still validate
 * (Spec 2, Task Group 2, sub-tasks 2.1(d) + 2.2 + 2.6).
 *
 * <p>Same approach as {@link DbMigrationPackChangesetTest}: the shared test
 * profile pins {@code liquibase.enabled=false} and the full master changelog
 * is not H2-runnable, so this test reads the ACTUAL SQL files from the
 * classpath and executes them -- mirroring the changelog's
 * {@code splitStatements} / {@code stripComments} processing -- against an
 * isolated, fresh H2 PostgreSQL-mode database with the
 * {@code CREATE DOMAIN JSONB AS JSON} alias. Per
 * {@code feedback_liquibase_immutable_changesets.md} the 173 file is applied
 * VERBATIM and never edited; 177 drops + re-creates its CHECK.</p>
 *
 * <p>Spec: LLM-Assisted DB Object Translation Drafts (2026-06-11) --
 * Task Group 2.</p>
 */
class DbMigrationPackTranslationChangesetTest {

    private static final List<String> SQL_PATHS = List.of(
        "db/changelog/sql/172-db-migration-packs.sql",
        "db/changelog/sql/173-db-migration-pack-files.sql",
        "db/changelog/sql/176-db-migration-pack-translations.sql",
        "db/changelog/sql/177-db-migration-pack-file-kind-translation.sql");

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
    @DisplayName("Changesets 176+177 apply cleanly after 172-173: translations table with checks/uniques/cascade; file_kind accepts 'translation' and the original kinds")
    void newChangesetsApplyCleanlyAndExtendTheFileKindCheck() throws Exception {
        String url = "jdbc:h2:mem:dbMigPackTranslationChangeset_" + System.nanoTime()
            + ";DB_CLOSE_DELAY=-1;MODE=PostgreSQL;INIT=CREATE DOMAIN IF NOT EXISTS JSONB AS JSON";

        try (Connection conn = DriverManager.getConnection(url, "sa", "")) {
            // Apply the ACTUAL changeset files in master-changelog order.
            try (Statement st = conn.createStatement()) {
                for (String path : SQL_PATHS) {
                    String sql = StreamUtils.copyToString(
                        new ClassPathResource(path).getInputStream(), StandardCharsets.UTF_8);
                    for (String stmt : splitStatements(sql)) {
                        st.execute(stmt);
                    }
                }
            }

            assertThat(tableExists(conn, "DB_MIGRATION_PACK_TRANSLATIONS")).isTrue();

            // The translations table carries every spec'd column.
            assertThat(columnNames(conn, "DB_MIGRATION_PACK_TRANSLATIONS"))
                .containsExactlyInAnyOrder(
                    "ID", "PACK_ID", "TRANSLATION_KEY", "OBJECT_REF", "KIND",
                    "DISPOSITION", "DROP_REASON", "PIPELINE_STATE",
                    "SOURCE_BODY", "SOURCE_BODY_HASH", "TRUNCATED", "LEGACY_REDACTED",
                    "DRAFT_CONTENT", "JUDGE_VERDICT_JSON",
                    "REVIEW_STATUS", "REVIEWER_NOTES",
                    "CREATED_AT", "TRANSLATED_AT", "REVIEWED_AT");

            // Seed one pack + one translation row; defaults land.
            try (Statement st = conn.createStatement()) {
                st.execute("INSERT INTO db_migration_packs "
                    + "(id, project_id, architecture_id, status) "
                    + "VALUES ('11111111-1111-1111-1111-111111111111', "
                    + "'22222222-2222-2222-2222-222222222222', "
                    + "'33333333-3333-3333-3333-333333333333', 'generated')");
                st.execute("INSERT INTO db_migration_pack_translations "
                    + "(id, pack_id, translation_key, object_ref, kind, source_body, "
                    + " source_body_hash, truncated, legacy_redacted, judge_verdict_json) "
                    + "VALUES ('44444444-4444-4444-4444-444444444444', "
                    + "'11111111-1111-1111-1111-111111111111', "
                    + "'stored_procedure--dbo.calc_tax', 'dbo.calc_tax', 'stored_procedure', "
                    + "'CREATE PROCEDURE ...', 'sha256:x', FALSE, FALSE, "
                    + "'{\"verdict\":\"equivalent\",\"confidence\":0.9,\"flags\":[]}')");
            }
            try (Statement st = conn.createStatement();
                 ResultSet rs = st.executeQuery(
                     "SELECT disposition, pipeline_state, review_status "
                         + "FROM db_migration_pack_translations "
                         + "WHERE id = '44444444-4444-4444-4444-444444444444'")) {
                assertThat(rs.next()).isTrue();
                assertThat(rs.getString("disposition")).isEqualTo("translate");
                assertThat(rs.getString("pipeline_state")).isEqualTo("pending");
                assertThat(rs.getString("review_status")).isEqualTo("unreviewed");
            }

            // translation_key unique per pack (uq_dmpt_pack_translation_key).
            assertThatThrownBy(() -> {
                try (Statement st = conn.createStatement()) {
                    st.execute("INSERT INTO db_migration_pack_translations "
                        + "(id, pack_id, translation_key, kind) "
                        + "VALUES ('55555555-5555-5555-5555-555555555555', "
                        + "'11111111-1111-1111-1111-111111111111', "
                        + "'stored_procedure--dbo.calc_tax', 'stored_procedure')");
                }
            }).isInstanceOf(SQLException.class);

            // CHECK constraints bite: invalid kind / pipeline_state rejected.
            assertThatThrownBy(() -> {
                try (Statement st = conn.createStatement()) {
                    st.execute("INSERT INTO db_migration_pack_translations "
                        + "(id, pack_id, translation_key, kind) "
                        + "VALUES ('66666666-6666-6666-6666-666666666666', "
                        + "'11111111-1111-1111-1111-111111111111', "
                        + "'sequence--dbo.seq', 'sequence')");
                }
            }).isInstanceOf(SQLException.class);
            assertThatThrownBy(() -> {
                try (Statement st = conn.createStatement()) {
                    st.execute("INSERT INTO db_migration_pack_translations "
                        + "(id, pack_id, translation_key, kind, pipeline_state) "
                        + "VALUES ('66666666-6666-6666-6666-666666666666', "
                        + "'11111111-1111-1111-1111-111111111111', "
                        + "'view--dbo.v', 'view', 'not-a-state')");
                }
            }).isInstanceOf(SQLException.class);

            // The EXTENDED chk_dmpf_file_kind: an original kind still works...
            try (Statement st = conn.createStatement()) {
                st.execute("INSERT INTO db_migration_pack_files "
                    + "(id, pack_id, file_path, file_kind, content, sort_order) "
                    + "VALUES ('77777777-7777-7777-7777-777777777777', "
                    + "'11111111-1111-1111-1111-111111111111', "
                    + "'liquibase/db.changelog-master.xml', 'liquibase_master', '<include/>', 0)");
                // ...AND the NEW 'translation' kind is accepted.
                st.execute("INSERT INTO db_migration_pack_files "
                    + "(id, pack_id, file_path, file_kind, content, sort_order) "
                    + "VALUES ('88888888-8888-8888-8888-888888888888', "
                    + "'11111111-1111-1111-1111-111111111111', "
                    + "'translations/stored_procedure.dbo.calc_tax.sql', 'translation', "
                    + "'CREATE FUNCTION ...', 1)");
            }
            // An unknown kind still rejects (the re-created CHECK is active).
            assertThatThrownBy(() -> {
                try (Statement st = conn.createStatement()) {
                    st.execute("INSERT INTO db_migration_pack_files "
                        + "(id, pack_id, file_path, file_kind) "
                        + "VALUES ('99999999-9999-9999-9999-999999999999', "
                        + "'11111111-1111-1111-1111-111111111111', "
                        + "'x.sql', 'not-a-kind')");
                }
            }).isInstanceOf(SQLException.class);

            // FK ON DELETE CASCADE: deleting the pack removes its translations.
            try (Statement st = conn.createStatement()) {
                st.execute("DELETE FROM db_migration_packs "
                    + "WHERE id = '11111111-1111-1111-1111-111111111111'");
            }
            assertThat(rowCount(conn, "db_migration_pack_translations")).isZero();
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
