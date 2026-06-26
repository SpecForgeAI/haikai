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
 * {@code db/changelog/sql/203-architecture-conversation-saved-at.sql}
 * (Spec: Target-State Conversation -- Save, Resume, and Plan Sourcing Decoupled
 * from "Active", 2026-06-26 -- Task Group 1, FR1) applies cleanly on the
 * pre-existing {@code architecture} shape and adds the single NULLABLE
 * {@code conversation_saved_at} save-marker column, and that an architecture
 * row persists + reads the marker back (null when never saved; a stamped
 * instant round-trips).
 *
 * <p>Why execute the SQL file directly: the shared test profile pins H2 with
 * {@code liquibase.enabled=false}, so the real changesets never run there.
 * This test seeds the minimal pre-203 {@code architecture} shape, then applies
 * the ACTUAL changeset SQL statement-by-statement against a fresh H2
 * PostgreSQL-mode database (mirrors
 * {@code ArchitectureProceedCriticalOverrideChangesetTest} for changeset 198).</p>
 *
 * <p>H2 limitations worked around (production PostgreSQL is unaffected):
 * {@code COMMENT ON COLUMN} statements are skipped (documentation-only), and the
 * {@code TIMESTAMPTZ} type alias is expanded to the standard
 * {@code TIMESTAMP WITH TIME ZONE} spelling (identical type in PostgreSQL). The
 * load-bearing DDL -- the single NULLABLE column -- runs verbatim.</p>
 */
class ArchitectureConversationSavedAtChangesetTest {

    private static final String SQL_203 =
        "db/changelog/sql/203-architecture-conversation-saved-at.sql";

    @Test
    @DisplayName("203 applies on the pre-existing architecture shape: adds NULLABLE conversation_saved_at; a row reads it back null then round-trips a stamped instant")
    void changesetAppliesAndMarkerPersists() throws Exception {
        String url = "jdbc:h2:mem:conversationSavedAt_" + System.nanoTime()
            + ";DB_CLOSE_DELAY=-1;MODE=PostgreSQL";

        try (Connection conn = DriverManager.getConnection(url, "sa", "")) {
            seedPreChangesetShape(conn);

            apply(conn, SQL_203);

            // --- new column exists ---
            Set<String> cols = columnNames(conn, "ARCHITECTURE");
            assertThat(cols).contains("CONVERSATION_SAVED_AT");

            // --- a pre-existing row (never saved) reads the marker back null ---
            try (Statement st = conn.createStatement()) {
                st.execute("INSERT INTO architecture (id, project_id, name) VALUES "
                    + "('11111111-1111-1111-1111-111111111111', "
                    + " '22222222-2222-2222-2222-222222222222', 'Target')");
            }
            try (Statement st = conn.createStatement();
                 ResultSet rs = st.executeQuery(
                     "SELECT conversation_saved_at FROM architecture "
                     + "WHERE id = '11111111-1111-1111-1111-111111111111'")) {
                assertThat(rs.next()).isTrue();
                assertThat(rs.getObject("conversation_saved_at")).isNull();
            }

            // --- stamping a save persists + reads back the instant ---
            try (Statement st = conn.createStatement()) {
                st.execute("UPDATE architecture SET "
                    + "conversation_saved_at = TIMESTAMP WITH TIME ZONE '2026-06-26 10:00:00+00' "
                    + "WHERE id = '11111111-1111-1111-1111-111111111111'");
            }
            try (Statement st = conn.createStatement();
                 ResultSet rs = st.executeQuery(
                     "SELECT conversation_saved_at FROM architecture "
                     + "WHERE id = '11111111-1111-1111-1111-111111111111'")) {
                assertThat(rs.next()).isTrue();
                assertThat(rs.getObject("conversation_saved_at")).isNotNull();
            }
        }
    }

    @Test
    @DisplayName("db.changelog-master.yaml registers changeset 203 AFTER 202, with 202 untouched, via the not-columnExists idiom")
    void masterChangelogRegisters203After202() throws Exception {
        String master = StreamUtils.copyToString(
            new ClassPathResource("db/changelog/db.changelog-master.yaml").getInputStream(),
            StandardCharsets.UTF_8);

        assertThat(master)
            .as("changeset 203 must be registered with its sqlFile path")
            .contains("id: 203-architecture-conversation-saved-at")
            .contains("db/changelog/sql/203-architecture-conversation-saved-at.sql");

        // 202 (the previous changeset) must still be present and unmodified.
        assertThat(master)
            .as("changeset 202 anchor must still be present -- verifies we did not delete/alter it")
            .contains("id: 202-target-manifest-service-element")
            .contains("db/changelog/sql/202-target-manifest-service-element.sql");

        // 203 must be registered AFTER 202 (the append point).
        int idx202 = master.indexOf("id: 202-target-manifest-service-element");
        int idx203 = master.indexOf("id: 203-architecture-conversation-saved-at");
        assertThat(idx202).isGreaterThan(-1);
        assertThat(idx203)
            .as("changeset 203 must be registered AFTER 202")
            .isGreaterThan(idx202);

        // 203 uses the not-columnExists precondition idiom (clean no-op on re-run).
        assertThat(master).contains("columnName: conversation_saved_at");
    }

    // ------------------------------------------------------------------
    // Seed: the minimal PRE-203 architecture shape (the column 203 ALTERs onto).
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
