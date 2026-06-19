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
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Validates the ONE new Liquibase changeset from Spec "Capture-Review Reviewer
 * Column Bug Fix" (2026-06-19):
 *
 * <ul>
 *   <li>{@code 193-capture-accepted-nullable.sql} -- makes
 *       {@code api_behaviour_captures.accepted} nullable defaulting NULL
 *       (DROP DEFAULT + DROP NOT NULL, COMMENT ON COLUMN, NO backfill).</li>
 * </ul>
 *
 * <p>BUG context: a freshly-captured row defaulted to {@code accepted = FALSE},
 * so the capture-review "Reviewer" column showed "rejected" before any review.
 * The pre-review state must be UN-REVIEWED (NULL -&gt; blank).</p>
 *
 * <p>Why execute the SQL file directly: the shared test profile pins H2 with
 * {@code liquibase.enabled=false}, so the real changesets never run there. This
 * test seeds the minimal pre-193 table shape ({@code accepted BOOLEAN NOT NULL
 * DEFAULT FALSE}), applies the ACTUAL changeset SQL statement-by-statement
 * against a fresh H2 PostgreSQL-mode database, then proves an INSERT that omits
 * {@code accepted} now reads back NULL (DROP DEFAULT + DROP NOT NULL took
 * effect). Mirrors {@code CaptureCoverageSummaryChangesetTest}.</p>
 *
 * <p>It also asserts the SQL file text declares both ALTER statements and that
 * the changeset is registered AFTER 192 in {@code db.changelog-master.yaml}.</p>
 *
 * <p>{@code COMMENT ON COLUMN} is skipped under H2 (documentation-only).</p>
 *
 * <p>Spec: Capture-Review Reviewer Column Bug Fix (2026-06-19).</p>
 */
class CaptureAcceptedNullableChangesetTest {

    private static final String SQL_193 =
        "db/changelog/sql/193-capture-accepted-nullable.sql";
    private static final String CHANGELOG_MASTER =
        "db/changelog/db.changelog-master.yaml";

    @Test
    @DisplayName("193 applies cleanly: a row inserted WITHOUT accepted reads back NULL (un-reviewed); DROP DEFAULT + DROP NOT NULL both took effect")
    void changesetMakesAcceptedNullableDefaultingNull() throws Exception {
        String url = "jdbc:h2:mem:captureAcceptedNullable_" + System.nanoTime()
            + ";DB_CLOSE_DELAY=-1;MODE=PostgreSQL";

        try (Connection conn = DriverManager.getConnection(url, "sa", "")) {
            // Seed the minimal pre-193 shape: accepted is NOT NULL DEFAULT FALSE
            // (the buggy contract), plus one EXISTING row that was written FALSE.
            try (Statement st = conn.createStatement()) {
                st.execute("CREATE TABLE api_behaviour_captures ("
                    + " id UUID PRIMARY KEY,"
                    + " accepted BOOLEAN NOT NULL DEFAULT FALSE)");
                st.execute("INSERT INTO api_behaviour_captures (id) VALUES "
                    + "('11111111-1111-1111-1111-111111111111')");
            }

            apply(conn, SQL_193);

            // A freshly-captured row that OMITS accepted must now read back NULL
            // (DROP DEFAULT removed the auto-FALSE; DROP NOT NULL allows NULL).
            try (Statement st = conn.createStatement()) {
                st.execute("INSERT INTO api_behaviour_captures (id) VALUES "
                    + "('22222222-2222-2222-2222-222222222222')");
            }
            try (Statement st = conn.createStatement();
                 ResultSet rs = st.executeQuery(
                     "SELECT accepted FROM api_behaviour_captures "
                         + "WHERE id = '22222222-2222-2222-2222-222222222222'")) {
                assertThat(rs.next()).isTrue();
                rs.getBoolean(1);
                assertThat(rs.wasNull())
                    .as("new row that omits accepted must be NULL (un-reviewed), not FALSE")
                    .isTrue();
            }

            // NO backfill: the pre-existing FALSE row stays FALSE (not retro-NULL).
            try (Statement st = conn.createStatement();
                 ResultSet rs = st.executeQuery(
                     "SELECT accepted FROM api_behaviour_captures "
                         + "WHERE id = '11111111-1111-1111-1111-111111111111'")) {
                assertThat(rs.next()).isTrue();
                assertThat(rs.getBoolean(1))
                    .as("existing FALSE row stays FALSE -- no backfill")
                    .isFalse();
                assertThat(rs.wasNull()).isFalse();
            }
        }
    }

    @Test
    @DisplayName("193 SQL declares DROP DEFAULT and DROP NOT NULL on api_behaviour_captures.accepted")
    void sqlDeclaresBothDropStatements() throws Exception {
        String sql = StreamUtils.copyToString(
            new ClassPathResource(SQL_193).getInputStream(), StandardCharsets.UTF_8);
        String normalised = sql.toUpperCase().replaceAll("\\s+", " ");

        assertThat(normalised)
            .contains("ALTER TABLE API_BEHAVIOUR_CAPTURES ALTER COLUMN ACCEPTED DROP DEFAULT");
        assertThat(normalised)
            .contains("ALTER TABLE API_BEHAVIOUR_CAPTURES ALTER COLUMN ACCEPTED DROP NOT NULL");
        assertThat(sql)
            .as("documents NULL = un-reviewed on the accepted column")
            .contains("COMMENT ON COLUMN api_behaviour_captures.accepted");
    }

    @Test
    @DisplayName("193 changeset is registered in db.changelog-master.yaml AFTER 192")
    void changesetRegisteredAfter192() throws Exception {
        String yaml = StreamUtils.copyToString(
            new ClassPathResource(CHANGELOG_MASTER).getInputStream(), StandardCharsets.UTF_8);

        assertThat(yaml)
            .as("193 sqlFile entry is registered")
            .contains("db/changelog/sql/193-capture-accepted-nullable.sql");
        assertThat(yaml)
            .as("193 changeSet id is registered")
            .contains("id: 193-capture-accepted-nullable");

        int idx192 = yaml.indexOf("id: 192-baseline-item-sequence");
        int idx193 = yaml.indexOf("id: 193-capture-accepted-nullable");
        assertThat(idx192).as("192 is present").isGreaterThanOrEqualTo(0);
        assertThat(idx193).as("193 is present").isGreaterThanOrEqualTo(0);
        assertThat(idx193)
            .as("193 must be registered AFTER 192")
            .isGreaterThan(idx192);
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
                    // H2 lacks the same COMMENT ON COLUMN surface; doc-only -- skip.
                    continue;
                }
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
        if (current.toString().trim().length() > 0) {
            statements.add(current.toString().trim());
        }
        return statements;
    }
}
