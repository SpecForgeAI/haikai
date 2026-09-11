package com.example.architecturemodel.migration;

import com.example.architecturemodel.model.entity.DbMigrationPackDecisionEntity;
import com.example.architecturemodel.model.entity.DbMigrationPackTranslationEntity;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;
import org.springframework.util.StreamUtils;

import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Changeset {@code 234-db-pack-mssql-decision-and-translation-kinds.sql}
 * (SQL Server 16 -&gt; PostgreSQL 18 pair programme, Spec 5, 2026-09-11).
 *
 * <p>SQL Server carries object shapes ASE does not, and PostgreSQL has no
 * like-for-like form for any of them. Doctrine: nothing deferred, no manual
 * residue -- each is either emulated by the pack with a confirmable default
 * or gated by a decision with named options. This test pins BOTH halves of
 * that contract at the database level:</p>
 *
 * <ul>
 *   <li>every NEW decision category and translation kind is accepted;</li>
 *   <li>every ORIGINAL category and kind still is (the 220/221 CHECKs are
 *       re-created, never narrowed);</li>
 *   <li>an unknown value still REJECTS, so the re-created CHECK is live
 *       rather than accidentally dropped;</li>
 *   <li>the Java constant sets mirror the SQL exactly -- the drift that a
 *       CHECK extension without its constant list would otherwise hide.</li>
 * </ul>
 *
 * <p>Same H2-in-PostgreSQL-mode approach as
 * {@link DbMigrationPackChangesetTest}: the shared test profile pins
 * {@code liquibase.enabled=false} and the full master changelog is not
 * H2-runnable, so the ACTUAL changeset files are read from the classpath and
 * executed in master-changelog order.</p>
 */
class DbMigrationPackMssqlKindsChangesetTest {

    private static final List<String> SQL_PATHS = List.of(
        "db/changelog/sql/172-db-migration-packs.sql",
        "db/changelog/sql/173-db-migration-pack-files.sql",
        "db/changelog/sql/174-db-migration-pack-decisions.sql",
        "db/changelog/sql/176-db-migration-pack-translations.sql",
        "db/changelog/sql/177-db-migration-pack-file-kind-translation.sql",
        "db/changelog/sql/220-db-pack-decision-and-translation-kind-extensions.sql",
        "db/changelog/sql/221-db-pack-decision-surrogate-pk-category.sql",
        "db/changelog/sql/233-translation-untranslatable-reason.sql",
        "db/changelog/sql/234-db-pack-mssql-decision-and-translation-kinds.sql");

    /** The item-5 categories changeset 234 adds (shaping ruling 3, item 5). */
    private static final List<String> NEW_CATEGORIES = List.of(
        "temporal_table", "fulltext_index", "xml_method", "hierarchyid_column",
        "spatial_column", "sql_variant_column", "clr_object", "service_broker",
        "filestream", "memory_optimized_table", "synonym", "user_defined_table_type",
        "index_predicate", "columnstore_index", "cross_database_reference", "indexed_view");

    /** The categories 174/220/221 already allowed -- none may be lost. */
    private static final List<String> ORIGINAL_CATEGORIES = List.of(
        "type_mapping", "computed_column", "collation", "delta_key",
        "pk_composition", "surrogate_pk", "other");

    /** The queue kinds changeset 234 adds. */
    private static final List<String> NEW_KINDS = List.of(
        "table_valued_function", "scalar_function", "synonym", "user_defined_table_type",
        "sequence", "clr_object", "service_broker_object", "temporal_history");

    /** The kinds 176/220 already allowed -- none may be lost. */
    private static final List<String> ORIGINAL_KINDS = List.of(
        "stored_procedure", "trigger", "view", "check_constraint", "scheduled_job");

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
    @DisplayName("Changeset 234 extends chk_dmpd_category + chk_dmpt_kind with the item-5 buckets, keeps every original value, still rejects an unknown one, and the Java constants mirror it")
    void changeset234ExtendsBothChecksWithoutLosingAnyOriginalValue() throws Exception {
        String url = "jdbc:h2:mem:dbMigPackMssqlKinds_" + System.nanoTime()
            + ";DB_CLOSE_DELAY=-1;MODE=PostgreSQL;INIT=CREATE DOMAIN IF NOT EXISTS JSONB AS JSON";

        try (Connection conn = DriverManager.getConnection(url, "sa", "")) {
            try (Statement st = conn.createStatement()) {
                for (String path : SQL_PATHS) {
                    String sql = StreamUtils.copyToString(
                        new ClassPathResource(path).getInputStream(), StandardCharsets.UTF_8);
                    for (String stmt : splitStatements(sql)) {
                        st.execute(stmt);
                    }
                }
                st.execute("INSERT INTO db_migration_packs "
                    + "(id, project_id, architecture_id, status) "
                    + "VALUES ('11111111-1111-1111-1111-111111111111', "
                    + "'22222222-2222-2222-2222-222222222222', "
                    + "'33333333-3333-3333-3333-333333333333', 'generated')");
            }

            // --- every category, new AND original, is accepted --------------
            int n = 0;
            List<String> allCategories = new ArrayList<>(ORIGINAL_CATEGORIES);
            allCategories.addAll(NEW_CATEGORIES);
            for (String category : allCategories) {
                insertDecision(conn, n++, category);
            }

            // --- every kind, new AND original, is accepted ------------------
            List<String> allKinds = new ArrayList<>(ORIGINAL_KINDS);
            allKinds.addAll(NEW_KINDS);
            for (String kind : allKinds) {
                insertTranslation(conn, n++, kind);
            }

            // --- the re-created CHECKs are LIVE: unknown values reject ------
            assertThatThrownBy(() -> insertDecision(conn, 900, "not-a-category"))
                .isInstanceOf(SQLException.class);
            assertThatThrownBy(() -> insertTranslation(conn, 901, "not-a-kind"))
                .isInstanceOf(SQLException.class);

            // --- the named untranslatable reason (233) rides a 234 kind -----
            // clr_object / service_broker_object rows are queued with the
            // reason and the rewrite_in_app disposition -- shown, never
            // attempted.
            try (Statement st = conn.createStatement()) {
                st.execute("INSERT INTO db_migration_pack_translations "
                    + "(id, pack_id, translation_key, object_ref, kind, disposition, "
                    + " untranslatable_reason) "
                    + "VALUES ('" + uuid(950) + "', "
                    + "'11111111-1111-1111-1111-111111111111', "
                    + "'clr_object--dbo.Encrypt', 'dbo.Encrypt', 'clr_object', "
                    + "'rewrite_in_app', 'clr_object')");
            }
        }

        // --- the Java constant sets mirror the SQL exactly ------------------
        assertThat(DbMigrationPackDecisionEntity.ALL_CATEGORIES)
            .containsAll(NEW_CATEGORIES)
            .containsAll(ORIGINAL_CATEGORIES)
            .hasSize(NEW_CATEGORIES.size() + ORIGINAL_CATEGORIES.size());
        assertThat(DbMigrationPackTranslationEntity.ALL_KINDS)
            .containsAll(NEW_KINDS)
            .containsAll(ORIGINAL_KINDS)
            // `synonym` and `user_defined_table_type` are BOTH a decision
            // category and a queue kind, so the two lists overlap by name but
            // not by set: the kind list has no duplicates.
            .hasSize(NEW_KINDS.size() + ORIGINAL_KINDS.size());
    }

    private static String uuid(int n) {
        return String.format("%08d-0000-0000-0000-%012d", n, n);
    }

    private static void insertDecision(Connection conn, int n, String category) throws SQLException {
        try (Statement st = conn.createStatement()) {
            st.execute("INSERT INTO db_migration_pack_decisions "
                + "(id, pack_id, decision_key, category, status) "
                + "VALUES ('" + uuid(n) + "', "
                + "'11111111-1111-1111-1111-111111111111', "
                + "'" + category + "--dbo.obj" + n + "', '" + category + "', 'open')");
        }
    }

    private static void insertTranslation(Connection conn, int n, String kind) throws SQLException {
        try (Statement st = conn.createStatement()) {
            st.execute("INSERT INTO db_migration_pack_translations "
                + "(id, pack_id, translation_key, object_ref, kind) "
                + "VALUES ('" + uuid(n) + "', "
                + "'11111111-1111-1111-1111-111111111111', "
                + "'" + kind + "--dbo.obj" + n + "', 'dbo.obj" + n + "', '" + kind + "')");
        }
    }
}
