package com.example.architecturemodel.service;

import com.example.architecturemodel.model.entity.MissingInputResolutionEntity;
import com.example.architecturemodel.model.entity.ProjectEntity;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Smoke-level coverage for the two new Liquibase changeset files (151, 152)
 * plus entity round-trip for the new boxed fields on
 * {@link MissingInputResolutionEntity} and {@link ProjectEntity}.
 *
 * <p>Spec: Bulk-Resolve OAS/WSDL Parser (2026-05-20) -- Task Group 1.</p>
 *
 * <p>Why a content-level smoke check + builder-round-trip rather than a full
 * H2 + Postgres Liquibase apply test: per the project's test workaround notes
 * referenced in tasks.md Task Group 1.1, the broader AMS test suite has
 * test-compile issues on this branch; the foundation group's brief
 * explicitly authorises content-level changeset checks as the verification
 * vehicle. A later integration pass (Task Group 8) can layer a full
 * end-to-end Liquibase application test once the broader test suite is
 * green.</p>
 *
 * <p>Six focused assertions in this file, each guarding one of the
 * load-bearing schema or entity additions called out in the spec:</p>
 * <ol>
 *   <li>changeset 151 adds {@code resolution_source} (nullable VARCHAR(32),
 *       NO DB CHECK constraint by design) and {@code project_artifact_id}
 *       (UUID) with FK {@code fk_mir_project_artifact} ON DELETE SET NULL to
 *       {@code project_artifact(id)}.</li>
 *   <li>changeset 151 backfills every pre-existing
 *       {@code missing_input_resolutions} row to
 *       {@code resolution_source = 'manual'}.</li>
 *   <li>changeset 152 adds {@code max_contract_upload_file_size_mb} (nullable
 *       INTEGER, DB DEFAULT 10) to the {@code project} table.</li>
 *   <li>master changelog registers both new changesets in dependency order
 *       (151 -> 152) and both reference their matching sqlFile paths.</li>
 *   <li>{@link MissingInputResolutionEntity} surfaces the two new boxed
 *       fields via getters/setters and round-trips them through a builder.</li>
 *   <li>{@link ProjectEntity} surfaces the new boxed
 *       {@code maxContractUploadFileSizeMb} field via the builder, and the
 *       builder leaves it null when omitted (preserves PATCH null semantics
 *       per {@code project_primitive_double_dto_overwrite.md}).</li>
 * </ol>
 */
class BulkResolveOasWsdlParserChangesetSmokeTest {

    private static final Path PROJECT_ROOT = locateProjectRoot();
    private static final Path CHANGELOG_DIR = PROJECT_ROOT.resolve(
        Paths.get("src", "main", "resources", "db", "changelog"));
    private static final Path SQL_DIR = CHANGELOG_DIR.resolve("sql");
    private static final Path MASTER_YAML = CHANGELOG_DIR.resolve("db.changelog-master.yaml");

    @Test
    @DisplayName("changeset 151: adds resolution_source (no DB CHECK) and project_artifact_id FK ON DELETE SET NULL")
    void changeset151_addsProvenanceColumnsAndFk() throws IOException {
        String sql = readSql("151-missing-input-resolutions-source-and-artifact.sql");

        // resolution_source -- VARCHAR(32) NULL, open vocabulary (no DB CHECK)
        assertThat(sql)
            .as("changeset 151 must ALTER missing_input_resolutions to add resolution_source as nullable VARCHAR(32)")
            .contains("ALTER TABLE missing_input_resolutions")
            .contains("ADD COLUMN resolution_source VARCHAR(32) NULL");

        // Open-vocabulary discipline: NO DB CHECK constraint on resolution_source.
        // Service layer enforces cooperatively so new sources can be added without
        // schema migration. Guard against an accidentally-added CHECK clause here.
        assertThat(sql)
            .as("resolution_source must NOT carry a DB CHECK constraint -- vocabulary stays open per spec")
            .doesNotContain("chk_mir_resolution_source")
            .doesNotContain("CHECK (resolution_source IN");

        // project_artifact_id -- UUID NULL with ON DELETE SET NULL FK
        assertThat(sql)
            .as("changeset 151 must add project_artifact_id UUID NULL")
            .contains("ADD COLUMN project_artifact_id UUID NULL");

        assertThat(sql)
            .as("changeset 151 must add fk_mir_project_artifact FK to project_artifact(id) ON DELETE SET NULL")
            .contains("CONSTRAINT fk_mir_project_artifact")
            .contains("FOREIGN KEY (project_artifact_id)")
            .contains("REFERENCES project_artifact(id)")
            .contains("ON DELETE SET NULL");
    }

    @Test
    @DisplayName("changeset 151: backfills pre-existing missing_input_resolutions rows to resolution_source='manual'")
    void changeset151_backfillsManualOnPreExistingRows() throws IOException {
        String sql = readSql("151-missing-input-resolutions-source-and-artifact.sql");

        // Backfill statement -- pre-existing rows came from the manual-entry
        // bulk-resolve modal before parse-files shipped, so 'manual' is the
        // correct provenance value.
        assertThat(sql)
            .as("changeset 151 must backfill pre-existing rows to resolution_source = 'manual'")
            .contains("UPDATE missing_input_resolutions")
            .contains("SET resolution_source = 'manual'")
            .contains("WHERE resolution_source IS NULL");
    }

    @Test
    @DisplayName("changeset 152: adds max_contract_upload_file_size_mb (INTEGER NULL DEFAULT 10) to project table")
    void changeset152_addsProjectMaxContractUploadSize() throws IOException {
        String sql = readSql("152-project-max-contract-upload-size.sql");

        assertThat(sql)
            .as("changeset 152 must ALTER project to add max_contract_upload_file_size_mb as nullable INTEGER with DB DEFAULT 10")
            .contains("ALTER TABLE project")
            .contains("ADD COLUMN max_contract_upload_file_size_mb INTEGER NULL DEFAULT 10");

        // Existing rows must inherit the default value. Postgres 11+ back-fills
        // any column added with a DEFAULT in a metadata-only operation, so the
        // DEFAULT 10 clause itself is the backfill -- no separate UPDATE is
        // required. Guard against a stray separate UPDATE statement that would
        // silently mis-stamp pre-existing rows.
        assertThat(sql)
            .as("changeset 152 must NOT contain a separate UPDATE statement -- the DB DEFAULT clause back-fills existing rows")
            .doesNotContain("UPDATE project")
            .doesNotContain("SET max_contract_upload_file_size_mb");
    }

    @Test
    @DisplayName("master changelog: registers 151 then 152 in dependency order with matching sqlFile paths")
    void masterChangelog_registersBothInOrder() throws IOException {
        String yaml = Files.readString(MASTER_YAML, StandardCharsets.UTF_8);

        int idx151 = yaml.indexOf("id: 151-missing-input-resolutions-source-and-artifact");
        int idx152 = yaml.indexOf("id: 152-project-max-contract-upload-size");

        assertThat(idx151).as("changeset 151 registered").isPositive();
        assertThat(idx152).as("changeset 152 registered").isPositive();
        assertThat(idx151).as("151 appears before 152 in the master changelog").isLessThan(idx152);

        // Each registration must reference the matching sqlFile path. If the
        // path is wrong Liquibase startup fails silently with "changeset
        // applied" but no schema changes, so guard the path explicitly.
        assertThat(yaml)
            .as("master changelog must reference the 151 sql file")
            .contains("db/changelog/sql/151-missing-input-resolutions-source-and-artifact.sql");
        assertThat(yaml)
            .as("master changelog must reference the 152 sql file")
            .contains("db/changelog/sql/152-project-max-contract-upload-size.sql");

        // Sanity: prior changeset 150 still appears before 151 (no
        // accidentally-reordered registrations).
        int idx150 = yaml.indexOf("id: 150-migration-story-spec-generations-stale-reason");
        assertThat(idx150).as("changeset 150 still registered").isPositive();
        assertThat(idx150).as("150 still appears before 151").isLessThan(idx151);
    }

    @Test
    @DisplayName("MissingInputResolutionEntity round-trips resolutionSource + projectArtifactId via builder + setters")
    void missingInputResolutionEntity_roundTripsNewBoxedFields() {
        UUID artifactId = UUID.randomUUID();

        // Build with resolution_source='oas_wsdl_upload' and a non-null
        // project_artifact_id -- this is the canonical parse-files-commit
        // path shape (Task Group 4 will stamp this from the service layer).
        MissingInputResolutionEntity entity = MissingInputResolutionEntity.builder()
            .id(UUID.randomUUID())
            .projectId(UUID.randomUUID())
            .missingInputKey("abc1234567890def")
            .missingInputType("api_contract")
            .resolvedBy("alice@example.com")
            .resolutionSource("oas_wsdl_upload")
            .projectArtifactId(artifactId)
            .build();

        assertThat(entity.getResolutionSource())
            .as("Builder round-trips resolution_source through the new boxed String field")
            .isEqualTo("oas_wsdl_upload");
        assertThat(entity.getProjectArtifactId())
            .as("Builder round-trips project_artifact_id through the new boxed UUID field")
            .isEqualTo(artifactId);

        // Setter round-trip -- swap to 'manual' (the backfilled value) and
        // clear the artefact FK, mimicking a soft-deletion + restore of the
        // source artefact (FK ON DELETE SET NULL fires in DB; the service
        // layer can also clear the column explicitly).
        entity.setResolutionSource("manual");
        entity.setProjectArtifactId(null);
        assertThat(entity.getResolutionSource()).isEqualTo("manual");
        assertThat(entity.getProjectArtifactId()).isNull();

        // Default-omitted: builder leaves both null when not set. This is the
        // legacy manual-entry path's posture (before service-layer stamps
        // 'manual' explicitly on commit). The PATCH-preserves-null contract
        // depends on these fields being boxed -- a primitive UUID is
        // impossible, but a primitive String is also impossible so this is
        // structural rather than runtime defensive.
        MissingInputResolutionEntity blank = MissingInputResolutionEntity.builder()
            .id(UUID.randomUUID())
            .projectId(UUID.randomUUID())
            .missingInputKey("0123456789abcdef")
            .missingInputType("api_contract")
            .resolvedBy("bob@example.com")
            .build();
        assertThat(blank.getResolutionSource())
            .as("Builder leaves resolution_source null when omitted -- preserves PATCH null semantics")
            .isNull();
        assertThat(blank.getProjectArtifactId())
            .as("Builder leaves project_artifact_id null when omitted")
            .isNull();
    }

    @Test
    @DisplayName("ProjectEntity round-trips maxContractUploadFileSizeMb as boxed Integer (null when omitted)")
    void projectEntity_roundTripsMaxContractUploadFileSizeMb() {
        // BOXED Integer (NOT primitive int) per
        // project_primitive_double_dto_overwrite.md. A builder that omits the
        // field leaves the column as null -- the DB DEFAULT 10 supplies the
        // fallback at insert time, but on a PATCH that omits the field the
        // null-guarded service-layer assignment leaves the existing value
        // unchanged. A primitive int field would have silently flipped any
        // existing value to 0.

        // Round-trip an explicit value first.
        ProjectEntity withCap = ProjectEntity.builder()
            .id(UUID.randomUUID())
            .name("test-project")
            .projectParentFolder("/tmp/test")
            .maxContractUploadFileSizeMb(25)
            .build();
        assertThat(withCap.getMaxContractUploadFileSizeMb())
            .as("Builder round-trips max_contract_upload_file_size_mb through the new boxed Integer field")
            .isEqualTo(25);

        // Setter clears back to null -- a primitive int could not represent
        // this and would silently default to 0.
        withCap.setMaxContractUploadFileSizeMb(null);
        assertThat(withCap.getMaxContractUploadFileSizeMb())
            .as("Setter accepts null (boxed Integer) -- a primitive int would silently default to 0")
            .isNull();

        // Default-omitted builder leaves the field null so the DB DEFAULT 10
        // applies on insert and PATCH semantics preserve null on omission.
        ProjectEntity blank = ProjectEntity.builder()
            .id(UUID.randomUUID())
            .name("blank-project")
            .projectParentFolder("/tmp/blank")
            .build();
        assertThat(blank.getMaxContractUploadFileSizeMb())
            .as("Builder leaves max_contract_upload_file_size_mb null when omitted -- DB DEFAULT 10 supplies the fallback")
            .isNull();
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
