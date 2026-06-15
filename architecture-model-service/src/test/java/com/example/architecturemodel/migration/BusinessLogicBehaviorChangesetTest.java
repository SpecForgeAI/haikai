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
 * Validates that the NEW Liquibase changeset
 * {@code db/changelog/sql/162-business-logic-behavior.sql} (Spec: Business-logic
 * behaviour capture for discovery, 2026-05-29 -- Task Group 1, sub-task 1.1)
 * applies cleanly on a fresh database and adds the intended nullable
 * {@code behavior} JSONB column to the EXISTING {@code business_logics} table.
 *
 * <h2>Why execute the SQL file directly</h2>
 *
 * <p>Mirrors {@code EndpointDataEffectsChangesetTest}: the shared test profile
 * pins H2 with {@code liquibase.enabled=false}, and running the FULL master
 * changelog against H2 is not viable (earlier changesets use Postgres-only
 * plpgsql). This test reads the ACTUAL {@code 162-business-logic-behavior.sql}
 * from the classpath and executes its statements against an isolated, FRESH H2
 * PostgreSQL-mode database (mirroring {@code splitStatements: true} /
 * {@code stripComments: true}), then asserts the resulting schema. H2 has no
 * native JSONB type, so the {@code CREATE DOMAIN JSONB AS JSON} alias is
 * registered first.</p>
 *
 * <p>Because {@code 162} is an {@code ALTER TABLE business_logics ADD COLUMN}
 * (the table pre-exists from the applied changeset {@code 015}), this test
 * stubs a minimal {@code business_logics} table first (exactly as
 * {@code EndpointDataEffectsChangesetTest} stubs the {@code model_files} FK
 * parent), then applies the changeset and asserts the new column.</p>
 */
class BusinessLogicBehaviorChangesetTest {

    private static final String SQL_PATH = "db/changelog/sql/162-business-logic-behavior.sql";

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
    @DisplayName("162-business-logic-behavior.sql applies on a clean DB: adds a nullable behavior JSONB column to business_logics")
    void changesetAppliesCleanly() throws Exception {
        String sql = StreamUtils.copyToString(
            new ClassPathResource(SQL_PATH).getInputStream(), StandardCharsets.UTF_8);
        List<String> statements = splitStatements(sql);

        // A single ALTER TABLE ... ADD COLUMN statement expected.
        assertThat(statements).hasSize(1);

        String url = "jdbc:h2:mem:blBehaviorChangeset_" + System.nanoTime()
            + ";DB_CLOSE_DELAY=-1;MODE=PostgreSQL;INIT=CREATE DOMAIN IF NOT EXISTS JSONB AS JSON";

        try (Connection conn = DriverManager.getConnection(url, "sa", "")) {
            try (Statement st = conn.createStatement()) {
                // business_logics pre-exists on the real DB (applied changeset
                // 015); stub the minimal label-only shape here so the ALTER
                // resolves. 162 only adds the behavior column.
                st.execute("CREATE TABLE business_logics ("
                    + "id TEXT PRIMARY KEY, model_file_id TEXT NOT NULL, name TEXT NOT NULL, "
                    + "type_text TEXT, description_md TEXT, tags TEXT, valid_from TEXT, valid_to TEXT)");
                // Apply the actual changeset SQL, statement by statement.
                for (String stmt : statements) {
                    st.execute(stmt);
                }
            }

            // The new column exists on business_logics.
            Set<String> columns = columnNames(conn, "BUSINESS_LOGICS");
            assertThat(columns).contains("BEHAVIOR");
            // The pre-existing label-only columns are untouched (015 not edited).
            assertThat(columns).contains("ID", "MODEL_FILE_ID", "NAME", "TYPE_TEXT",
                "DESCRIPTION_MD", "TAGS", "VALID_FROM", "VALID_TO");

            // The column type is the JSONB domain alias (H2 maps JSONB -> JSON).
            assertThat(columnType(conn, "BUSINESS_LOGICS", "BEHAVIOR"))
                .containsIgnoringCase("JSON");

            // Functional check: a row with a JSON behaviour blob inserts and reads
            // back, and a row with a NULL behaviour blob is accepted (nullable).
            try (Statement st = conn.createStatement()) {
                st.execute("INSERT INTO business_logics "
                    + "(id, model_file_id, name, behavior) VALUES "
                    + "('bl-1', 'mf-1', 'Tax Calc', "
                    + "'{\"schema_version\":\"behaviour.v1\",\"confidence\":0.77}')");
                st.execute("INSERT INTO business_logics "
                    + "(id, model_file_id, name) VALUES ('bl-2', 'mf-1', 'No Behaviour')");
            }
            try (Statement st = conn.createStatement();
                 ResultSet rs = st.executeQuery(
                     "SELECT behavior FROM business_logics WHERE id = 'bl-1'")) {
                assertThat(rs.next()).isTrue();
                assertThat(rs.getString("behavior")).contains("behaviour.v1");
            }
            try (Statement st = conn.createStatement();
                 ResultSet rs = st.executeQuery(
                     "SELECT behavior FROM business_logics WHERE id = 'bl-2'")) {
                assertThat(rs.next()).isTrue();
                assertThat(rs.getString("behavior")).isNull();
            }
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

    private static String columnType(Connection conn, String table, String column) throws Exception {
        try (ResultSet rs = conn.getMetaData().getColumns(null, null, table, column)) {
            if (rs.next()) {
                return rs.getString("TYPE_NAME");
            }
        }
        return null;
    }
}
