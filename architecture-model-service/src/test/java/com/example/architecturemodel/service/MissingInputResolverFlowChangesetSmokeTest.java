package com.example.architecturemodel.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Smoke-level coverage that the three new Liquibase changeset files (148,
 * 149, 150) exist, are registered in the master changelog, and contain the
 * expected schema elements (table / columns / unique-index / CHECK).
 *
 * <p>Spec: Missing Input Resolver Flow (2026-05-20) -- Task Group 1.</p>
 *
 * <p>Why a content-level smoke check rather than a full H2 + Postgres
 * Liquibase apply test: per the project's test workaround notes, the full
 * AMS test suite has test-compile issues on this branch; the foundation
 * group's brief explicitly authorises this check as the verification
 * vehicle. A later integration pass (Task Group 8) can layer a full
 * end-to-end Liquibase application test once the broader test suite is
 * green.</p>
 *
 * <p>The five assertions in this file each guard one of the load-bearing
 * schema additions called out in the spec:</p>
 * <ol>
 *   <li>changeset 148 creates the {@code missing_input_resolutions} table
 *       with the CHECK constraint on {@code missing_input_type}.</li>
 *   <li>changeset 148 declares the partial unique index
 *       ({@code WHERE soft_deleted = FALSE}).</li>
 *   <li>changeset 149 adds {@code missing_input_keys_json} JSONB column.</li>
 *   <li>changeset 150 adds {@code stale_reason} varchar(32) column with
 *       its CHECK vocabulary constraint.</li>
 *   <li>all three changesets are registered in {@code db.changelog-master.yaml}
 *       in dependency order (148 -> 149 -> 150).</li>
 * </ol>
 */
class MissingInputResolverFlowChangesetSmokeTest {

    private static final Path PROJECT_ROOT = locateProjectRoot();
    private static final Path CHANGELOG_DIR = PROJECT_ROOT.resolve(
        Paths.get("src", "main", "resources", "db", "changelog"));
    private static final Path SQL_DIR = CHANGELOG_DIR.resolve("sql");
    private static final Path MASTER_YAML = CHANGELOG_DIR.resolve("db.changelog-master.yaml");

    @Test
    @DisplayName("changeset 148: missing_input_resolutions table created with type CHECK constraint")
    void changeset148_createsTableAndTypeCheck() throws IOException {
        String sql = readSql("148-missing-input-resolutions.sql");

        assertThat(sql).contains("CREATE TABLE missing_input_resolutions");
        assertThat(sql).contains("project_id");
        assertThat(sql).contains("missing_input_key");
        assertThat(sql).contains("missing_input_type");
        assertThat(sql).contains("resolution_payload_json");
        assertThat(sql).contains("resolved_at");
        assertThat(sql).contains("resolved_by");
        assertThat(sql).contains("soft_deleted");
        assertThat(sql).contains("soft_deleted_at");
        assertThat(sql).contains("soft_deleted_by");
        assertThat(sql).contains("CONSTRAINT chk_mir_type");
        assertThat(sql).contains("api_contract");
        assertThat(sql).contains("mapping");
        assertThat(sql).contains("target_element");
    }

    @Test
    @DisplayName("changeset 148: partial unique index covers only soft_deleted=false rows")
    void changeset148_partialUniqueIndex() throws IOException {
        String sql = readSql("148-missing-input-resolutions.sql");

        assertThat(sql).contains("CREATE UNIQUE INDEX ux_mir_project_key_active");
        assertThat(sql).contains("(project_id, missing_input_key)");
        assertThat(sql).contains("WHERE soft_deleted = FALSE");

        // Lookup index for cross-story matcher + dashboard list endpoint
        assertThat(sql).contains("idx_mir_project_key_soft_deleted");
        assertThat(sql).contains("idx_mir_project_soft_deleted");
    }

    @Test
    @DisplayName("changeset 149: adds missing_input_keys_json JSONB column to migration_story_spec_generations")
    void changeset149_addsKeysJsonColumn() throws IOException {
        String sql = readSql("149-migration-story-spec-generations-missing-input-keys-json.sql");

        assertThat(sql).contains("ALTER TABLE migration_story_spec_generations");
        assertThat(sql).contains("ADD COLUMN missing_input_keys_json JSONB");
    }

    @Test
    @DisplayName("changeset 150: adds stale_reason varchar(32) with CHECK vocabulary constraint")
    void changeset150_addsStaleReasonColumn() throws IOException {
        String sql = readSql("150-migration-story-spec-generations-stale-reason.sql");

        assertThat(sql).contains("ALTER TABLE migration_story_spec_generations");
        assertThat(sql).contains("ADD COLUMN stale_reason VARCHAR(32)");
        assertThat(sql).contains("CONSTRAINT chk_msg_stale_reason");
        assertThat(sql).contains("target_architecture_changed");
        assertThat(sql).contains("resolution_reset");
    }

    @Test
    @DisplayName("master changelog: registers 148, 149, 150 in dependency order")
    void masterChangelog_registersAllThreeInOrder() throws IOException {
        String yaml = Files.readString(MASTER_YAML, StandardCharsets.UTF_8);

        int idx148 = yaml.indexOf("id: 148-missing-input-resolutions");
        int idx149 = yaml.indexOf("id: 149-migration-story-spec-generations-missing-input-keys-json");
        int idx150 = yaml.indexOf("id: 150-migration-story-spec-generations-stale-reason");

        assertThat(idx148).as("changeset 148 registered").isPositive();
        assertThat(idx149).as("changeset 149 registered").isPositive();
        assertThat(idx150).as("changeset 150 registered").isPositive();
        assertThat(idx148).as("148 appears before 149").isLessThan(idx149);
        assertThat(idx149).as("149 appears before 150").isLessThan(idx150);

        // Each registration must reference the matching sqlFile path
        assertThat(yaml).contains("db/changelog/sql/148-missing-input-resolutions.sql");
        assertThat(yaml).contains("db/changelog/sql/149-migration-story-spec-generations-missing-input-keys-json.sql");
        assertThat(yaml).contains("db/changelog/sql/150-migration-story-spec-generations-stale-reason.sql");
    }

    // ------------------------------------------------------------------

    private static String readSql(String filename) throws IOException {
        return Files.readString(SQL_DIR.resolve(filename), StandardCharsets.UTF_8);
    }

    /**
     * The AMS module root is where {@code pom.xml} lives. Working directory
     * during a Surefire run is the module root; during the isolated javac /
     * console-launcher workaround it is also the module root (the runner
     * cd's there before invoking the launcher). Fall back to walking
     * upward in case a future runner changes the convention.
     */
    private static Path locateProjectRoot() {
        Path candidate = Paths.get("").toAbsolutePath();
        for (int i = 0; i < 6; i++) {
            if (Files.exists(candidate.resolve("pom.xml"))
                && Files.exists(candidate.resolve(
                    Paths.get("src", "main", "resources", "db", "changelog", "db.changelog-master.yaml")))) {
                return candidate;
            }
            Path parent = candidate.getParent();
            if (parent == null) {
                break;
            }
            candidate = parent;
        }
        throw new IllegalStateException("Could not locate AMS project root from " + Paths.get("").toAbsolutePath());
    }
}
