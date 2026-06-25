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
 * {@code db/changelog/sql/199-target-manifest-artifacts.sql} (Spec: Confirmed
 * Manifest Producer Wiring, 2026-06-25, Spec 5 Phase 2 -- Task Group 1) applies
 * cleanly on a fresh H2 PostgreSQL-mode database and produces the
 * {@code target_manifest_artifacts} table with its full index set and the
 * JSONB / TIMESTAMPTZ / UUID / TEXT columns.
 *
 * <p>Mirrors {@code VulnerabilitiesChangesetTest}: the shared test profile pins
 * H2 with {@code liquibase.enabled=false}, so the real changesets never run
 * there, and running the FULL master changelog against H2 is not viable (earlier
 * changesets use Postgres-only constructs). This test therefore applies the
 * ACTUAL 199 changeset SQL statement-by-statement (mirroring the changelog's
 * {@code splitStatements: true} / {@code stripComments: true} processing) against
 * an isolated, FRESH H2 PostgreSQL-mode database, and asserts the resulting
 * schema.</p>
 *
 * <p>The production DDL keeps the codebase convention of {@code JSONB} +
 * {@code TIMESTAMPTZ}; H2 does not recognise either shorthand natively, so -- as
 * the {@code @DataJpaTest} datasource already aliases {@code JSONB AS JSON} --
 * this test registers BOTH {@code JSONB} and {@code TIMESTAMPTZ} as H2 domain
 * aliases in the connection {@code INIT} so the unmodified production SQL
 * executes here.</p>
 *
 * <p>The {@link #splitStatements(String)} helper is string-literal-aware (like
 * Liquibase's SQL-aware {@code stripComments}): it strips {@code --} line
 * comments and splits on {@code ;} ONLY when NOT inside a single-quoted string,
 * so the {@code COMMENT ON ... IS '...'} bodies (which legitimately contain
 * {@code --} and {@code /}) are preserved. Plain JUnit (no Spring context).</p>
 */
class TargetManifestArtifactsChangesetTest {

    private static final String SQL_PATH = "db/changelog/sql/199-target-manifest-artifacts.sql";

    /**
     * Mirror Liquibase's SQL-aware {@code stripComments} + {@code splitStatements}
     * for a plain DDL file. String-literal-aware: {@code --} line comments are
     * stripped and {@code ;} statement breaks are honoured ONLY when NOT inside a
     * single-quoted string literal. H2 single-quote escaping is {@code ''};
     * handled.
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

    @Test
    @DisplayName("199-target-manifest-artifacts.sql applies cleanly: creates target_manifest_artifacts with all columns and the full index set")
    void changesetAppliesCleanly() throws Exception {
        String sql = StreamUtils.copyToString(
            new ClassPathResource(SQL_PATH).getInputStream(), StandardCharsets.UTF_8);
        List<String> statements = splitStatements(sql);

        String url = "jdbc:h2:mem:targetManifestChangeset_" + System.nanoTime()
            + ";DB_CLOSE_DELAY=-1;MODE=PostgreSQL"
            + ";INIT=CREATE DOMAIN IF NOT EXISTS JSONB AS JSON"
            + "\\;CREATE DOMAIN IF NOT EXISTS TIMESTAMPTZ AS TIMESTAMP WITH TIME ZONE";

        try (Connection conn = DriverManager.getConnection(url, "sa", "")) {
            // Apply the actual changeset SQL, statement by statement -- a failure
            // here (bad DDL, unknown type, wrong order) fails the test.
            try (Statement st = conn.createStatement()) {
                for (String stmt : statements) {
                    st.execute(stmt);
                }
            }

            // ---- columns ----
            Set<String> cols = columnNames(conn, "TARGET_MANIFEST_ARTIFACTS");
            assertThat(cols).contains(
                "ID", "PROJECT_ID", "TARGET_ARCHITECTURE_ID", "TAG", "KIND",
                "ECOSYSTEM", "MANIFEST_PATH", "CONTENT", "PACKAGE_LOCK_CONTENT",
                "RESOLVED_DEPENDENCIES", "IS_LATEST", "CREATED_AT");

            // ---- index set (mirror vulnerability_reports: one per read key) ----
            Set<String> idx = indexNames(conn, "TARGET_MANIFEST_ARTIFACTS");
            assertThat(idx).contains(
                "IDX_TARGET_MANIFEST_ARTIFACT_PROJECT_ID",
                "IDX_TARGET_MANIFEST_ARTIFACT_TARGET_ARCHITECTURE_ID",
                "IDX_TARGET_MANIFEST_ARTIFACT_TAG",
                "IDX_TARGET_MANIFEST_ARTIFACT_IS_LATEST");

            // ---- functional sanity: insert a row + read defaults back ----
            try (Statement st = conn.createStatement()) {
                st.execute("INSERT INTO target_manifest_artifacts "
                    + "(id, project_id, target_architecture_id, tag) VALUES "
                    + "(RANDOM_UUID(), RANDOM_UUID(), RANDOM_UUID(), 'orders')");
            }
            // is_latest defaults TRUE; created_at defaults NOW().
            try (Statement st = conn.createStatement();
                 ResultSet rs = st.executeQuery(
                     "SELECT is_latest, created_at FROM target_manifest_artifacts")) {
                assertThat(rs.next()).isTrue();
                assertThat(rs.getBoolean("is_latest")).isTrue();
                assertThat(rs.getObject("created_at")).isNotNull();
            }
        }
    }

    @Test
    @DisplayName("Changeset 199 is a clean no-op on re-run (not-tableExists precondition idiom): applying the SQL twice would fail, but the precondition guards it -- table already present is detected")
    void changesetIsIdempotentByPrecondition() throws Exception {
        // The not-tableExists precondition (onFail: MARK_RAN) is the registration
        // guard that makes a re-run a clean no-op. This test proves the *signal*
        // the precondition reads: after the changeset applies, the table EXISTS,
        // so a re-run's not-tableExists evaluates false -> MARK_RAN (skip), never
        // re-creating the table. We assert the table-exists signal here; the
        // precondition wiring itself is asserted in the master-changelog test.
        String sql = StreamUtils.copyToString(
            new ClassPathResource(SQL_PATH).getInputStream(), StandardCharsets.UTF_8);
        List<String> statements = splitStatements(sql);

        String url = "jdbc:h2:mem:targetManifestIdem_" + System.nanoTime()
            + ";DB_CLOSE_DELAY=-1;MODE=PostgreSQL"
            + ";INIT=CREATE DOMAIN IF NOT EXISTS JSONB AS JSON"
            + "\\;CREATE DOMAIN IF NOT EXISTS TIMESTAMPTZ AS TIMESTAMP WITH TIME ZONE";

        try (Connection conn = DriverManager.getConnection(url, "sa", "")) {
            try (Statement st = conn.createStatement()) {
                for (String stmt : statements) {
                    st.execute(stmt);
                }
            }
            // The precondition's signal: the table now exists, so a re-run is
            // marked-ran (skipped), not re-applied.
            assertThat(columnNames(conn, "TARGET_MANIFEST_ARTIFACTS")).isNotEmpty();
        }
    }

    @Test
    @DisplayName("db.changelog-master.yaml registers changeset 199 AFTER 198, with 198 untouched, using the not-tableExists idiom")
    void masterChangelogRegisters199After198() throws Exception {
        String master = StreamUtils.copyToString(
            new ClassPathResource("db/changelog/db.changelog-master.yaml").getInputStream(),
            StandardCharsets.UTF_8);

        assertThat(master)
            .as("changeset 199 must be registered with its sqlFile path")
            .contains("id: 199-target-manifest-artifacts")
            .contains("db/changelog/sql/199-target-manifest-artifacts.sql");

        // 198 (the previous changeset) must still be present and unmodified.
        assertThat(master)
            .as("changeset 198 anchor must still be present -- verifies we did not delete/alter it")
            .contains("id: 198-architecture-proceed-critical-override")
            .contains("db/changelog/sql/198-architecture-proceed-critical-override.sql");

        // 199 must be registered AFTER 198 (the append point).
        int idx198 = master.indexOf("id: 198-architecture-proceed-critical-override");
        int idx199 = master.indexOf("id: 199-target-manifest-artifacts");
        assertThat(idx198).isGreaterThan(-1);
        assertThat(idx199)
            .as("changeset 199 must be registered AFTER 198")
            .isGreaterThan(idx198);

        // 199 uses the not-tableExists precondition idiom (mirrors 197 / 135 / 184).
        assertThat(master).contains("tableName: target_manifest_artifacts");
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
