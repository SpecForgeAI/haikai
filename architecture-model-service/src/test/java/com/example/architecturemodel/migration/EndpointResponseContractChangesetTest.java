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
 * {@code db/changelog/sql/168-endpoint-response-contract.sql} (Spec: Per-endpoint
 * response-contract capture for discovery, 2026-05-30 -- Task Group 1, sub-task
 * 1.1) applies cleanly on a fresh database and adds the intended nullable
 * {@code response_contract} JSONB column to the EXISTING {@code endpoints} table.
 *
 * <h2>Why execute the SQL file directly</h2>
 *
 * <p>Mirrors {@code BusinessLogicBehaviorChangesetTest}: the shared test profile
 * pins H2 with {@code liquibase.enabled=false}, and running the FULL master
 * changelog against H2 is not viable (earlier changesets use Postgres-only
 * plpgsql). This test reads the ACTUAL {@code 168-endpoint-response-contract.sql}
 * from the classpath and executes its statements against an isolated, FRESH H2
 * PostgreSQL-mode database (mirroring {@code splitStatements: true} /
 * {@code stripComments: true}), then asserts the resulting schema. H2 has no
 * native JSONB type, so the {@code CREATE DOMAIN JSONB AS JSON} alias is
 * registered first.</p>
 *
 * <p>Because {@code 168} is an {@code ALTER TABLE endpoints ADD COLUMN} (the
 * table pre-exists from an applied changeset), this test stubs a minimal
 * {@code endpoints} table first, then applies the changeset and asserts the new
 * column -- exactly as {@code BusinessLogicBehaviorChangesetTest} stubs
 * {@code business_logics}.</p>
 */
class EndpointResponseContractChangesetTest {

    private static final String SQL_PATH = "db/changelog/sql/168-endpoint-response-contract.sql";

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
    @DisplayName("168-endpoint-response-contract.sql applies on a clean DB: adds a nullable response_contract JSONB column to endpoints")
    void changesetAppliesCleanly() throws Exception {
        String sql = StreamUtils.copyToString(
            new ClassPathResource(SQL_PATH).getInputStream(), StandardCharsets.UTF_8);
        List<String> statements = splitStatements(sql);

        // A single ALTER TABLE ... ADD COLUMN statement expected.
        assertThat(statements).hasSize(1);

        String url = "jdbc:h2:mem:endpointResponseContractChangeset_" + System.nanoTime()
            + ";DB_CLOSE_DELAY=-1;MODE=PostgreSQL;INIT=CREATE DOMAIN IF NOT EXISTS JSONB AS JSON";

        try (Connection conn = DriverManager.getConnection(url, "sa", "")) {
            try (Statement st = conn.createStatement()) {
                // endpoints pre-exists on the real DB (an applied changeset);
                // stub the minimal label-only shape here so the ALTER resolves.
                // 168 only adds the response_contract column.
                st.execute("CREATE TABLE endpoints ("
                    + "id TEXT PRIMARY KEY, model_file_id TEXT NOT NULL, interface_id TEXT NOT NULL, "
                    + "name TEXT NOT NULL, description TEXT, endpoint_type TEXT, path_or_address TEXT, "
                    + "protocol TEXT, operation_verb TEXT, direction TEXT, "
                    + "protocol_metadata_json JSONB)");
                // Apply the actual changeset SQL, statement by statement.
                for (String stmt : statements) {
                    st.execute(stmt);
                }
            }

            // The new column exists on endpoints.
            Set<String> columns = columnNames(conn, "ENDPOINTS");
            assertThat(columns).contains("RESPONSE_CONTRACT");
            // The pre-existing columns are untouched (the applied changeset is not edited).
            assertThat(columns).contains("ID", "MODEL_FILE_ID", "INTERFACE_ID", "NAME",
                "ENDPOINT_TYPE", "PATH_OR_ADDRESS", "PROTOCOL_METADATA_JSON");

            // The column type is the JSONB domain alias (H2 maps JSONB -> JSON).
            assertThat(columnType(conn, "ENDPOINTS", "RESPONSE_CONTRACT"))
                .containsIgnoringCase("JSON");

            // Functional check: a row with a JSON contract blob inserts and reads
            // back, and a row with a NULL contract is accepted (nullable).
            try (Statement st = conn.createStatement()) {
                st.execute("INSERT INTO endpoints "
                    + "(id, model_file_id, interface_id, name, response_contract) VALUES "
                    + "('ep-1', 'mf-1', 'ifc-1', 'Create Order', "
                    + "'{\"schema_version\":\"response-contract.v1\",\"confidence\":0.74}')");
                st.execute("INSERT INTO endpoints "
                    + "(id, model_file_id, interface_id, name) VALUES "
                    + "('ep-2', 'mf-1', 'ifc-1', 'No Contract')");
            }
            try (Statement st = conn.createStatement();
                 ResultSet rs = st.executeQuery(
                     "SELECT response_contract FROM endpoints WHERE id = 'ep-1'")) {
                assertThat(rs.next()).isTrue();
                assertThat(rs.getString("response_contract")).contains("response-contract.v1");
            }
            try (Statement st = conn.createStatement();
                 ResultSet rs = st.executeQuery(
                     "SELECT response_contract FROM endpoints WHERE id = 'ep-2'")) {
                assertThat(rs.next()).isTrue();
                assertThat(rs.getString("response_contract")).isNull();
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
