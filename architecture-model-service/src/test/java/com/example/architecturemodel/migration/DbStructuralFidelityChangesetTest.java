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
 * Validates that the NEW Liquibase changesets
 * {@code 163-physical-attribute-structural-fidelity.sql},
 * {@code 164-physical-entity-constraints-jsonb.sql}, and
 * {@code 165-relationship-fk-columns.sql} (Spec: DB Structural Fidelity for
 * Discovery, 2026-05-29 -- Task Group 1, sub-task 1.1) apply cleanly on a fresh
 * database and add the intended nullable columns to the EXISTING tables.
 *
 * <h2>Why execute the SQL files directly</h2>
 *
 * <p>Mirrors {@code BusinessLogicBehaviorChangesetTest} /
 * {@code EndpointDataEffectsChangesetTest}: the shared test profile pins H2 with
 * {@code liquibase.enabled=false}, and running the FULL master changelog against
 * H2 is not viable (earlier changesets use Postgres-only plpgsql). This test
 * reads the ACTUAL changeset SQL from the classpath and executes its statements
 * against an isolated, FRESH H2 PostgreSQL-mode database (mirroring
 * {@code splitStatements: true} / {@code stripComments: true}), then asserts the
 * resulting schema. H2 has no native JSONB type, so the
 * {@code CREATE DOMAIN JSONB AS JSON} alias is registered first.</p>
 *
 * <p>All three changesets are {@code ALTER TABLE ... ADD COLUMN} on tables that
 * pre-exist (applied changesets), so this test stubs the minimal parent tables
 * first (exactly as the precedent tests stub their FK parents), then applies the
 * changesets and asserts the new columns.</p>
 */
class DbStructuralFidelityChangesetTest {

    private static final String ATTR_SQL_PATH =
        "db/changelog/sql/163-physical-attribute-structural-fidelity.sql";
    private static final String ENTITY_SQL_PATH =
        "db/changelog/sql/164-physical-entity-constraints-jsonb.sql";
    private static final String REL_SQL_PATH =
        "db/changelog/sql/165-relationship-fk-columns.sql";

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

    private static List<String> readStatements(String path) throws Exception {
        String sql = StreamUtils.copyToString(
            new ClassPathResource(path).getInputStream(), StandardCharsets.UTF_8);
        return splitStatements(sql);
    }

    @Test
    @DisplayName("163/164/165 apply on a clean DB: add the new nullable structural columns to the existing tables")
    void changesetsApplyCleanly() throws Exception {
        List<String> attrStatements = readStatements(ATTR_SQL_PATH);
        List<String> entityStatements = readStatements(ENTITY_SQL_PATH);
        List<String> relStatements = readStatements(REL_SQL_PATH);

        // 163 adds six columns; 164 and 165 each add one JSONB column.
        assertThat(attrStatements).hasSize(6);
        assertThat(entityStatements).hasSize(1);
        assertThat(relStatements).hasSize(1);

        String url = "jdbc:h2:mem:dbStructFidelityChangeset_" + System.nanoTime()
            + ";DB_CLOSE_DELAY=-1;MODE=PostgreSQL;INIT=CREATE DOMAIN IF NOT EXISTS JSONB AS JSON";

        try (Connection conn = DriverManager.getConnection(url, "sa", "")) {
            try (Statement st = conn.createStatement()) {
                // Stub the minimal pre-existing shapes (applied changesets) so the
                // ALTERs resolve. The changesets only ADD the new columns.
                st.execute("CREATE TABLE physical_data_attributes ("
                    + "id TEXT PRIMARY KEY, model_file_id TEXT NOT NULL, physical_entity_id TEXT NOT NULL, "
                    + "name TEXT NOT NULL, description TEXT, data_type TEXT, "
                    + "is_primary_key BOOLEAN NOT NULL, is_nullable BOOLEAN NOT NULL, tags TEXT)");
                st.execute("CREATE TABLE physical_data_entities ("
                    + "id TEXT PRIMARY KEY, model_file_id TEXT NOT NULL, name TEXT NOT NULL, "
                    + "description TEXT, physical_type TEXT, database_name TEXT, tags TEXT, "
                    + "valid_from TEXT, valid_to TEXT)");
                st.execute("CREATE TABLE logical_data_entity_relationships ("
                    + "id TEXT PRIMARY KEY, model_file_id TEXT NOT NULL, "
                    + "from_data_entity_point_id TEXT NOT NULL, to_data_entity_point_id TEXT NOT NULL, "
                    + "cardinality TEXT, relationship TEXT, description TEXT, tags TEXT, "
                    + "valid_from TEXT, valid_to TEXT)");

                for (String stmt : attrStatements) {
                    st.execute(stmt);
                }
                for (String stmt : entityStatements) {
                    st.execute(stmt);
                }
                for (String stmt : relStatements) {
                    st.execute(stmt);
                }
            }

            // 163: the six new attribute columns exist; the pre-existing ones are untouched.
            Set<String> attrCols = columnNames(conn, "PHYSICAL_DATA_ATTRIBUTES");
            assertThat(attrCols).contains(
                "SOURCE_TYPE", "SCALE", "PRECISION", "COLUMN_DEFAULT", "ORDINAL", "IS_IDENTITY");
            assertThat(attrCols).contains(
                "ID", "MODEL_FILE_ID", "PHYSICAL_ENTITY_ID", "NAME", "DATA_TYPE",
                "IS_PRIMARY_KEY", "IS_NULLABLE", "TAGS");

            // 164: the constraints_metadata JSONB column exists (JSONB -> JSON in H2).
            Set<String> entityCols = columnNames(conn, "PHYSICAL_DATA_ENTITIES");
            assertThat(entityCols).contains("CONSTRAINTS_METADATA");
            assertThat(columnType(conn, "PHYSICAL_DATA_ENTITIES", "CONSTRAINTS_METADATA"))
                .containsIgnoringCase("JSON");

            // 165: the fk_columns JSONB column exists.
            Set<String> relCols = columnNames(conn, "LOGICAL_DATA_ENTITY_RELATIONSHIPS");
            assertThat(relCols).contains("FK_COLUMNS");
            assertThat(columnType(conn, "LOGICAL_DATA_ENTITY_RELATIONSHIPS", "FK_COLUMNS"))
                .containsIgnoringCase("JSON");

            // Functional check: a row exercising the new columns inserts and reads
            // back, and a row leaving them NULL is accepted (all additive + nullable).
            try (Statement st = conn.createStatement()) {
                st.execute("INSERT INTO physical_data_attributes "
                    + "(id, model_file_id, physical_entity_id, name, is_primary_key, is_nullable, "
                    + "source_type, scale, precision, column_default, ordinal, is_identity) VALUES "
                    + "('pa-1', 'mf-1', 'pe-1', 'amount', FALSE, TRUE, "
                    + "'numeric(10,2)', 2, 10, '0.00', 3, TRUE)");
                st.execute("INSERT INTO physical_data_attributes "
                    + "(id, model_file_id, physical_entity_id, name, is_primary_key, is_nullable) "
                    + "VALUES ('pa-2', 'mf-1', 'pe-1', 'id', TRUE, FALSE)");
                st.execute("INSERT INTO physical_data_entities "
                    + "(id, model_file_id, name, constraints_metadata) VALUES "
                    + "('pe-1', 'mf-1', 'orders', "
                    + "'{\"primary_key\":{\"name\":\"pk_orders\",\"columns\":[\"id\"]}}')");
                st.execute("INSERT INTO logical_data_entity_relationships "
                    + "(id, model_file_id, from_data_entity_point_id, to_data_entity_point_id, fk_columns) "
                    + "VALUES ('rel-1', 'mf-1', 'dep_phy_a', 'dep_phy_b', "
                    + "'{\"join_columns\":[\"customer_id\"],\"referenced_columns\":[\"id\"]}')");
            }
            try (Statement st = conn.createStatement();
                 ResultSet rs = st.executeQuery(
                     "SELECT source_type, scale, precision, column_default, ordinal, is_identity "
                     + "FROM physical_data_attributes WHERE id = 'pa-1'")) {
                assertThat(rs.next()).isTrue();
                assertThat(rs.getString("source_type")).isEqualTo("numeric(10,2)");
                assertThat(rs.getInt("scale")).isEqualTo(2);
                assertThat(rs.getInt("precision")).isEqualTo(10);
                assertThat(rs.getString("column_default")).isEqualTo("0.00");
                assertThat(rs.getInt("ordinal")).isEqualTo(3);
                assertThat(rs.getBoolean("is_identity")).isTrue();
            }
            try (Statement st = conn.createStatement();
                 ResultSet rs = st.executeQuery(
                     "SELECT source_type, scale FROM physical_data_attributes WHERE id = 'pa-2'")) {
                assertThat(rs.next()).isTrue();
                assertThat(rs.getString("source_type")).isNull();
                rs.getInt("scale");
                assertThat(rs.wasNull()).isTrue();
            }
            try (Statement st = conn.createStatement();
                 ResultSet rs = st.executeQuery(
                     "SELECT constraints_metadata FROM physical_data_entities WHERE id = 'pe-1'")) {
                assertThat(rs.next()).isTrue();
                assertThat(rs.getString("constraints_metadata")).contains("pk_orders");
            }
            try (Statement st = conn.createStatement();
                 ResultSet rs = st.executeQuery(
                     "SELECT fk_columns FROM logical_data_entity_relationships WHERE id = 'rel-1'")) {
                assertThat(rs.next()).isTrue();
                assertThat(rs.getString("fk_columns")).contains("customer_id");
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
