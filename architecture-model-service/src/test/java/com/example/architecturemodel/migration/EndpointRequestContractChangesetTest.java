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
 * {@code db/changelog/sql/194-endpoint-request-contract.sql} (Spec: Request
 * Contract from Code Evidence, 2026-06-19 -- Task Group 1, sub-task 1.5) applies
 * cleanly on a fresh database and adds the intended nullable
 * {@code request_contract} JSONB column to the EXISTING {@code endpoints} table,
 * and that it is registered in the master changelog AFTER changeset 193.
 *
 * <p>Mirrors {@code EndpointResponseContractChangesetTest}: the shared test
 * profile pins H2 with {@code liquibase.enabled=false}, and running the FULL
 * master changelog against H2 is not viable (earlier changesets use Postgres-only
 * plpgsql). This test reads the ACTUAL {@code 194-endpoint-request-contract.sql}
 * from the classpath and executes its statements against an isolated, FRESH H2
 * PostgreSQL-mode database (mirroring {@code splitStatements: true} /
 * {@code stripComments: true}), then asserts the resulting schema.</p>
 */
class EndpointRequestContractChangesetTest {

    private static final String SQL_PATH = "db/changelog/sql/194-endpoint-request-contract.sql";
    private static final String MASTER_PATH = "db/changelog/db.changelog-master.yaml";

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
    @DisplayName("194-endpoint-request-contract.sql applies on a clean DB: adds a nullable request_contract JSONB column to endpoints")
    void changesetAppliesCleanly() throws Exception {
        String sql = StreamUtils.copyToString(
            new ClassPathResource(SQL_PATH).getInputStream(), StandardCharsets.UTF_8);
        List<String> statements = splitStatements(sql);

        // An ALTER TABLE ... ADD COLUMN plus a COMMENT ON COLUMN statement expected.
        assertThat(statements).hasSize(2);

        String url = "jdbc:h2:mem:endpointRequestContractChangeset_" + System.nanoTime()
            + ";DB_CLOSE_DELAY=-1;MODE=PostgreSQL;INIT=CREATE DOMAIN IF NOT EXISTS JSONB AS JSON";

        try (Connection conn = DriverManager.getConnection(url, "sa", "")) {
            try (Statement st = conn.createStatement()) {
                // endpoints pre-exists on the real DB (an applied changeset);
                // stub the minimal shape here so the ALTER resolves. 194 only adds
                // the request_contract column (response_contract added by 168).
                st.execute("CREATE TABLE endpoints ("
                    + "id TEXT PRIMARY KEY, model_file_id TEXT NOT NULL, interface_id TEXT NOT NULL, "
                    + "name TEXT NOT NULL, description TEXT, endpoint_type TEXT, path_or_address TEXT, "
                    + "protocol TEXT, operation_verb TEXT, direction TEXT, "
                    + "protocol_metadata_json JSONB, response_contract JSONB)");
                // Apply the actual changeset SQL, statement by statement.
                for (String stmt : statements) {
                    st.execute(stmt);
                }
            }

            // The new column exists on endpoints.
            Set<String> columns = columnNames(conn, "ENDPOINTS");
            assertThat(columns).contains("REQUEST_CONTRACT");
            // The pre-existing columns are untouched (the applied changesets are not edited).
            assertThat(columns).contains("ID", "MODEL_FILE_ID", "INTERFACE_ID", "NAME",
                "ENDPOINT_TYPE", "PATH_OR_ADDRESS", "PROTOCOL_METADATA_JSON", "RESPONSE_CONTRACT");

            // The column type is the JSONB domain alias (H2 maps JSONB -> JSON).
            assertThat(columnType(conn, "ENDPOINTS", "REQUEST_CONTRACT"))
                .containsIgnoringCase("JSON");

            // Functional check: a row with a JSON contract blob inserts and reads
            // back, and a row with a NULL contract is accepted (nullable).
            try (Statement st = conn.createStatement()) {
                st.execute("INSERT INTO endpoints "
                    + "(id, model_file_id, interface_id, name, request_contract) VALUES "
                    + "('ep-1', 'mf-1', 'ifc-1', 'Create Order', "
                    + "'{\"schema_version\":\"request_contract.v1\",\"content_type\":\"application/json\"}')");
                st.execute("INSERT INTO endpoints "
                    + "(id, model_file_id, interface_id, name) VALUES "
                    + "('ep-2', 'mf-1', 'ifc-1', 'No Contract')");
            }
            try (Statement st = conn.createStatement();
                 ResultSet rs = st.executeQuery(
                     "SELECT request_contract FROM endpoints WHERE id = 'ep-1'")) {
                assertThat(rs.next()).isTrue();
                assertThat(rs.getString("request_contract")).contains("request_contract.v1");
            }
            try (Statement st = conn.createStatement();
                 ResultSet rs = st.executeQuery(
                     "SELECT request_contract FROM endpoints WHERE id = 'ep-2'")) {
                assertThat(rs.next()).isTrue();
                assertThat(rs.getString("request_contract")).isNull();
            }
        }
    }

    @Test
    @DisplayName("Changeset 194-endpoint-request-contract is registered in the master changelog AFTER 193 with a not columnExists guard on request_contract")
    void changesetRegisteredAfter193() throws Exception {
        String master = StreamUtils.copyToString(
            new ClassPathResource(MASTER_PATH).getInputStream(), StandardCharsets.UTF_8);

        int idx193 = master.indexOf("id: 193-capture-accepted-nullable");
        int idx194 = master.indexOf("id: 194-endpoint-request-contract");

        // 194 is registered, and registered strictly after 193 (next-free slot).
        assertThat(idx193).as("193 must be present").isGreaterThanOrEqualTo(0);
        assertThat(idx194).as("194 must be registered").isGreaterThanOrEqualTo(0);
        assertThat(idx194).as("194 must come after 193").isGreaterThan(idx193);

        // The 194 block wires the actual SQL file and guards on the new column.
        String block194 = master.substring(idx194);
        assertThat(block194).contains("db/changelog/sql/194-endpoint-request-contract.sql");
        assertThat(block194).contains("columnName: request_contract");
        assertThat(block194).contains("onFail: MARK_RAN");
        assertThat(block194).contains("onError: HALT");
        assertThat(block194).contains("splitStatements: true");
        assertThat(block194).contains("stripComments: true");
        // The guard is the `not columnExists` form (idempotent re-run MARK_RANs).
        int notIdx = block194.indexOf("not:");
        int colIdx = block194.indexOf("columnName: request_contract");
        assertThat(notIdx).as("the request_contract guard is a `not columnExists`")
            .isGreaterThanOrEqualTo(0);
        assertThat(notIdx).isLessThan(colIdx);
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
