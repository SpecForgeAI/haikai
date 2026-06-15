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
 * {@code db/changelog/sql/161-endpoint-data-effects.sql} (Spec:
 * Endpoint&rarr;Data-Effect Call Graph for Discovery, 2026-05-29 -- Task Group
 * 1, sub-task 1.9) applies cleanly on a fresh database and produces the
 * intended {@code endpoint_data_effects} table, columns and indexes.
 *
 * <h2>Why execute the SQL file directly</h2>
 *
 * <p>The shared test profile pins H2 with {@code liquibase.enabled=false} and
 * Hibernate {@code create-drop} (see {@code ArchitectureMigrationTest}), so the
 * real changesets never run there. Running the FULL master changelog against H2
 * is also not viable -- earlier changesets use Postgres-only constructs
 * (plpgsql functions / triggers H2 cannot parse). This test therefore reads the
 * ACTUAL {@code 161-endpoint-data-effects.sql} from the classpath and executes
 * its statements against an isolated, FRESH H2 PostgreSQL-mode database
 * (mirroring the changelog's {@code splitStatements: true} /
 * {@code stripComments: true} processing), then asserts the resulting schema.
 * H2 has no native JSONB type, so the same {@code CREATE DOMAIN JSONB AS JSON}
 * alias used by {@code DiscoveryFindingPersistenceTest} is registered first;
 * the FK target {@code model_files(id)} is stubbed (it pre-exists from
 * changeset 001 on the real DB).</p>
 *
 * <p>This is a plain JUnit test (no Spring context) so it neither starts the
 * service nor depends on the Postgres-only parts of the changelog.</p>
 */
class EndpointDataEffectsChangesetTest {

    private static final String SQL_PATH = "db/changelog/sql/161-endpoint-data-effects.sql";

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
    @DisplayName("161-endpoint-data-effects.sql applies on a clean DB: creates endpoint_data_effects with the intended columns + indexes")
    void changesetAppliesCleanly() throws Exception {
        String sql = StreamUtils.copyToString(
            new ClassPathResource(SQL_PATH).getInputStream(), StandardCharsets.UTF_8);
        List<String> statements = splitStatements(sql);

        // One CREATE TABLE + two CREATE INDEX statements expected.
        assertThat(statements).hasSize(3);

        String url = "jdbc:h2:mem:edeChangeset_" + System.nanoTime()
            + ";DB_CLOSE_DELAY=-1;MODE=PostgreSQL;INIT=CREATE DOMAIN IF NOT EXISTS JSONB AS JSON";

        try (Connection conn = DriverManager.getConnection(url, "sa", "")) {
            try (Statement st = conn.createStatement()) {
                // FK prerequisite -- model_files pre-exists on the real DB
                // (changeset 001); stub it here so the inline FK resolves.
                st.execute("CREATE TABLE model_files (id TEXT PRIMARY KEY)");
                // Apply the actual changeset SQL, statement by statement.
                for (String stmt : statements) {
                    st.execute(stmt);
                }
            }

            // Table exists.
            assertThat(tableExists(conn, "ENDPOINT_DATA_EFFECTS")).isTrue();

            // All intended columns exist.
            Set<String> columns = columnNames(conn, "ENDPOINT_DATA_EFFECTS");
            assertThat(columns).containsExactlyInAnyOrder(
                "ID",
                "MODEL_FILE_ID",
                "ENDPOINT_ID",
                "DATA_ENTITY_POINT_ID",
                "ACCESS_MODE",
                "PATH_METADATA_JSON",
                "CONFIDENCE",
                "DESCRIPTION",
                "TAGS",
                "VALID_FROM",
                "VALID_TO");

            // Both indexes exist.
            Set<String> indexes = indexNames(conn, "ENDPOINT_DATA_EFFECTS");
            assertThat(indexes).contains(
                "IDX_ENDPOINT_DATA_EFFECTS_MODEL_FILE",
                "IDX_ENDPOINT_DATA_EFFECTS_ENDPOINT");

            // Functional check: a row inserts and reads back (confidence as a
            // floating-point, path_metadata_json as JSON text). Seed the FK
            // parent first -- the model_files(id) FK is real and enforced.
            try (Statement st = conn.createStatement()) {
                st.execute("INSERT INTO model_files (id) VALUES ('mf-1')");
                st.execute("INSERT INTO endpoint_data_effects "
                    + "(id, model_file_id, endpoint_id, data_entity_point_id, access_mode, "
                    + "path_metadata_json, confidence) VALUES "
                    + "('ede-1', 'mf-1', 'ep-1', 'dep_log_owner', 'read-write', "
                    + "'{\"operation_hint\":\"select\"}', 0.83)");
            }
            try (Statement st = conn.createStatement();
                 ResultSet rs = st.executeQuery(
                     "SELECT access_mode, confidence FROM endpoint_data_effects WHERE id = 'ede-1'")) {
                assertThat(rs.next()).isTrue();
                assertThat(rs.getString("access_mode")).isEqualTo("read-write");
                assertThat(rs.getDouble("confidence")).isEqualTo(0.83);
            }
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

    private static Set<String> indexNames(Connection conn, String table) throws Exception {
        Set<String> idx = new HashSet<>();
        try (ResultSet rs = conn.getMetaData().getIndexInfo(null, null, table, false, false)) {
            while (rs.next()) {
                String name = rs.getString("INDEX_NAME");
                if (name != null) {
                    idx.add(name.toUpperCase());
                }
            }
        }
        return idx;
    }
}
