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
 * {@code 216-db-gap-proposals.sql} applies cleanly on a fresh database and
 * that its constraints bite: chk_dgp_kind, chk_dgp_confidence (NULL allowed),
 * chk_dgp_origin, chk_dgp_review_status, the per-project proposal_key unique
 * index (uq_dgp_project_proposal_key), the NOT NULL identity columns and the
 * origin/review_status defaults.
 *
 * <p>Same approach as {@link DbStructuralFindingDispositionChangesetTest}:
 * the shared test profile pins {@code liquibase.enabled=false} and the full
 * master changelog is not H2-runnable, so this test reads the ACTUAL SQL file
 * from the classpath and executes it -- mirroring the changelog's
 * {@code splitStatements} / {@code stripComments} processing -- against an
 * isolated, fresh H2 PostgreSQL-mode database. The table is standalone (no
 * FK by design: proposals are keyed by project + proposal_key so they survive
 * pack regeneration), so no predecessor changesets are needed.</p>
 *
 * <p>Spec: LLM gap-proposal queue (2026-08-04) -- Spec 4.</p>
 */
class DbGapProposalChangesetTest {

    private static final String SQL_PATH =
        "db/changelog/sql/216-db-gap-proposals.sql";

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
    @DisplayName("Changeset 216 applies cleanly: gap-proposals table with CHECKs, per-project proposal_key unique, defaults and NOT NULL identity columns")
    void newChangesetAppliesCleanlyWithBitingConstraints() throws Exception {
        String url = "jdbc:h2:mem:dbGapProposalChangeset_" + System.nanoTime()
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

            assertThat(tableExists(conn, "DB_GAP_PROPOSALS")).isTrue();

            // The table carries every spec'd column.
            assertThat(columnNames(conn, "DB_GAP_PROPOSALS"))
                .containsExactlyInAnyOrder(
                    "ID", "PROJECT_ID", "PROPOSAL_KEY", "FINDING_KEY", "KIND",
                    "PAYLOAD_JSON", "RATIONALE", "CONFIDENCE", "ORIGIN",
                    "REVIEW_STATUS", "REVIEWER_NOTES", "APPLIED_AT",
                    "CREATED_AT", "REVIEWED_AT");

            // Seed one fk_join proposal; origin / review_status / created_at
            // default (llm / unreviewed / NOW).
            try (Statement st = conn.createStatement()) {
                st.execute("INSERT INTO db_gap_proposals "
                    + "(id, project_id, proposal_key, finding_key, kind, payload_json, rationale, confidence) "
                    + "VALUES ('11111111-1111-1111-1111-111111111111', "
                    + "'22222222-2222-2222-2222-222222222222', "
                    + "'fk--rel-orders-customers', 'no_foreign_keys:dbo.orders', "
                    + "'fk_join', "
                    + "'{\"relationship_id\":\"rel-orders-customers\",\"from_table\":\"dbo.orders\",\"join_columns\":[\"customer_id\"],\"to_table\":\"dbo.customers\",\"referenced_columns\":[\"id\"]}', "
                    + "'columns line up', 'high')");
            }
            try (Statement st = conn.createStatement();
                 ResultSet rs = st.executeQuery(
                     "SELECT origin, review_status, created_at, applied_at, reviewed_at "
                         + "FROM db_gap_proposals "
                         + "WHERE id = '11111111-1111-1111-1111-111111111111'")) {
                assertThat(rs.next()).isTrue();
                assertThat(rs.getString("origin")).as("origin defaults llm").isEqualTo("llm");
                assertThat(rs.getString("review_status")).as("defaults unreviewed")
                    .isEqualTo("unreviewed");
                assertThat(rs.getTimestamp("created_at")).isNotNull();
                assertThat(rs.getTimestamp("applied_at")).isNull();
                assertThat(rs.getTimestamp("reviewed_at")).isNull();
            }

            // proposal_key unique per project (uq_dgp_project_proposal_key).
            assertThatThrownBy(() -> {
                try (Statement st = conn.createStatement()) {
                    st.execute("INSERT INTO db_gap_proposals "
                        + "(id, project_id, proposal_key, finding_key, kind, payload_json) "
                        + "VALUES ('33333333-3333-3333-3333-333333333333', "
                        + "'22222222-2222-2222-2222-222222222222', "
                        + "'fk--rel-orders-customers', 'no_foreign_keys:dbo.orders', "
                        + "'fk_join', '{}')");
                }
            }).isInstanceOf(SQLException.class);

            // ...but the SAME key on a DIFFERENT project is fine (per-project
            // scoping, the regeneration-survival property).
            try (Statement st = conn.createStatement()) {
                st.execute("INSERT INTO db_gap_proposals "
                    + "(id, project_id, proposal_key, finding_key, kind, payload_json, origin) "
                    + "VALUES ('44444444-4444-4444-4444-444444444444', "
                    + "'55555555-5555-5555-5555-555555555555', "
                    + "'fk--rel-orders-customers', 'no_foreign_keys:dbo.orders', "
                    + "'fk_join', '{}', 'manual')");
            }

            // chk_dgp_kind bites: an unknown kind rejects.
            assertThatThrownBy(() -> {
                try (Statement st = conn.createStatement()) {
                    st.execute("INSERT INTO db_gap_proposals "
                        + "(id, project_id, proposal_key, finding_key, kind, payload_json) "
                        + "VALUES ('66666666-6666-6666-6666-666666666666', "
                        + "'22222222-2222-2222-2222-222222222222', "
                        + "'ix--dbo.orders', 'no_indexes:dbo.orders', "
                        + "'index', '{}')");
                }
            }).isInstanceOf(SQLException.class);

            // chk_dgp_confidence bites (NULL is allowed, seeded above as
            // non-null; here a bogus value rejects).
            assertThatThrownBy(() -> {
                try (Statement st = conn.createStatement()) {
                    st.execute("INSERT INTO db_gap_proposals "
                        + "(id, project_id, proposal_key, finding_key, kind, payload_json, confidence) "
                        + "VALUES ('77777777-7777-7777-7777-777777777777', "
                        + "'22222222-2222-2222-2222-222222222222', "
                        + "'pk--dbo.orders', 'no_primary_keys:all_tables', "
                        + "'primary_key', '{}', 'certain')");
                }
            }).isInstanceOf(SQLException.class);

            // chk_dgp_origin bites.
            assertThatThrownBy(() -> {
                try (Statement st = conn.createStatement()) {
                    st.execute("INSERT INTO db_gap_proposals "
                        + "(id, project_id, proposal_key, finding_key, kind, payload_json, origin) "
                        + "VALUES ('88888888-8888-8888-8888-888888888888', "
                        + "'22222222-2222-2222-2222-222222222222', "
                        + "'pk--dbo.orders', 'no_primary_keys:all_tables', "
                        + "'primary_key', '{}', 'oracle')");
                }
            }).isInstanceOf(SQLException.class);

            // chk_dgp_review_status bites.
            assertThatThrownBy(() -> {
                try (Statement st = conn.createStatement()) {
                    st.execute("INSERT INTO db_gap_proposals "
                        + "(id, project_id, proposal_key, finding_key, kind, payload_json, review_status) "
                        + "VALUES ('99999999-9999-9999-9999-999999999999', "
                        + "'22222222-2222-2222-2222-222222222222', "
                        + "'pk--dbo.orders', 'no_primary_keys:all_tables', "
                        + "'primary_key', '{}', 'shrugged')");
                }
            }).isInstanceOf(SQLException.class);

            // NOT NULL identity columns bite (payload_json omitted).
            assertThatThrownBy(() -> {
                try (Statement st = conn.createStatement()) {
                    st.execute("INSERT INTO db_gap_proposals "
                        + "(id, project_id, proposal_key, finding_key, kind) "
                        + "VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', "
                        + "'22222222-2222-2222-2222-222222222222', "
                        + "'pk--dbo.orders', 'no_primary_keys:all_tables', 'primary_key')");
                }
            }).isInstanceOf(SQLException.class);

            // A valid primary_key proposal with NULL confidence persists
            // (chk_dgp_confidence allows NULL).
            try (Statement st = conn.createStatement()) {
                st.execute("INSERT INTO db_gap_proposals "
                    + "(id, project_id, proposal_key, finding_key, kind, payload_json) "
                    + "VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', "
                    + "'22222222-2222-2222-2222-222222222222', "
                    + "'pk--dbo.orders', 'no_primary_keys:all_tables', "
                    + "'primary_key', "
                    + "'{\"table\":\"dbo.orders\",\"entity_id\":\"entity-orders\",\"columns\":[\"order_id\"]}')");
            }

            assertThat(rowCount(conn, "db_gap_proposals")).isEqualTo(3);
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
