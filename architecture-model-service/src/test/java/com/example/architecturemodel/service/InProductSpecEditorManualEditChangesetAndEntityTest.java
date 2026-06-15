package com.example.architecturemodel.service;

import com.example.architecturemodel.mapper.MigrationStorySpecGenerationMapper;
import com.example.architecturemodel.model.dto.MigrationStorySpecGenerationDto;
import com.example.architecturemodel.model.entity.MigrationStorySpecGenerationEntity;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Focused JUnit tests for In-Product Spec Editor + Confirm-Overwrite -- Task
 * Group 1 (Liquibase changeset 154 + the four new manual-edit entity columns
 * on {@link MigrationStorySpecGenerationEntity} + DTO + mapper round-trip).
 *
 * <p>Spec: In-Product Spec Editor + Confirm-Overwrite (2026-05-20) --
 * Task Group 1.</p>
 *
 * <p>Verification strategy mirrors the prior
 * {@code SpecQualityScoringChangesetAndEntityTest} pattern: a content-level
 * smoke check guarantees the changeset declares the right columns + the NOT
 * NULL DEFAULT false constraint on {@code manually_edited}, that it is
 * registered in the master changelog, and that the new fields round-trip
 * cleanly through the entity builder + the DTO + the mapper. The full AMS
 * Surefire suite has unrelated compile errors on this branch; this content +
 * entity + DTO + mapper coverage is the verification vehicle authorised by
 * Task Group 1's brief.</p>
 *
 * <p>Six focused tests across four surfaces:</p>
 * <ol>
 *   <li>{@link #changeset154_addsAllFourColumnsAndNotNullDefaultOnManuallyEdited} --
 *       SQL declares the four new columns and the NOT NULL DEFAULT false guard
 *       on {@code manually_edited}.</li>
 *   <li>{@link #masterChangelog_registersChangeset154AfterChangeset153} --
 *       master yaml registers 154 after 153 with the matching sqlFile path and
 *       a columnExists pre-condition.</li>
 *   <li>{@link #entity_setAllFourManualEditFields_roundTrip} -- builder +
 *       setters + getters round-trip non-null values for all four new
 *       fields.</li>
 *   <li>{@link #entity_defaultManuallyEditedIsFalse} -- a freshly-built entity
 *       that omits {@code manuallyEdited} surfaces {@code false} via
 *       Builder.Default; the explicit {@code @PrePersist} guard also restores
 *       {@code false} when the field is nulled out before INSERT.</li>
 *   <li>{@link #entity_manualEditFieldsAreBoxedReferenceTypes} -- reflective
 *       guard against a primitive-type regression on the four new fields
 *       (boxed {@link Boolean} / {@link String} / {@link Instant} only).</li>
 *   <li>{@link #mapper_roundTripsAllFourManualEditFieldsEntityToDto} -- the
 *       mapper carries the four new fields through entity -&gt; DTO -&gt;
 *       entity preserving values, including the ISO-8601 string formatting of
 *       {@link MigrationStorySpecGenerationEntity#getLastManuallyEditedAt()}.</li>
 * </ol>
 */
class InProductSpecEditorManualEditChangesetAndEntityTest {

    private static final Path PROJECT_ROOT = locateProjectRoot();
    private static final Path CHANGELOG_DIR = PROJECT_ROOT.resolve(
        Paths.get("src", "main", "resources", "db", "changelog"));
    private static final Path SQL_DIR = CHANGELOG_DIR.resolve("sql");
    private static final Path MASTER_YAML = CHANGELOG_DIR.resolve("db.changelog-master.yaml");

    // ------------------------------------------------------------------
    // Changeset content smoke
    // ------------------------------------------------------------------

    @Test
    @DisplayName("changeset 154: declares manually_edited (NOT NULL DEFAULT false), last_manually_edited_at, last_manually_edited_by, previous_spec_text")
    void changeset154_addsAllFourColumnsAndNotNullDefaultOnManuallyEdited() throws IOException {
        String sql = readSql("154-migration-story-spec-generations-manual-edit.sql");

        assertThat(sql).contains("ALTER TABLE migration_story_spec_generations");

        // manually_edited -- the only NOT NULL column with a DEFAULT.
        assertThat(sql)
            .as("manually_edited declared as BOOLEAN NOT NULL DEFAULT false")
            .contains("manually_edited")
            .contains("BOOLEAN")
            .contains("NOT NULL")
            .contains("DEFAULT false");

        // last_manually_edited_at -- nullable TIMESTAMPTZ.
        assertThat(sql)
            .as("last_manually_edited_at declared as TIMESTAMPTZ NULL")
            .contains("last_manually_edited_at")
            .contains("TIMESTAMPTZ");

        // last_manually_edited_by -- nullable VARCHAR(255).
        assertThat(sql)
            .as("last_manually_edited_by declared as VARCHAR(255) NULL")
            .contains("last_manually_edited_by")
            .contains("VARCHAR(255)");

        // previous_spec_text -- nullable TEXT.
        assertThat(sql)
            .as("previous_spec_text declared as TEXT NULL")
            .contains("previous_spec_text")
            .contains("TEXT");
    }

    @Test
    @DisplayName("master changelog: registers changeset 154 with matching sqlFile path AFTER changeset 153")
    void masterChangelog_registersChangeset154AfterChangeset153() throws IOException {
        String yaml = Files.readString(MASTER_YAML, StandardCharsets.UTF_8);

        int idx153 = yaml.indexOf("id: 153-migration-story-spec-generations-quality-scoring");
        int idx154 = yaml.indexOf("id: 154-migration-story-spec-generations-manual-edit");

        assertThat(idx153).as("changeset 153 still registered").isPositive();
        assertThat(idx154).as("changeset 154 registered").isPositive();
        assertThat(idx154)
            .as("154 appears AFTER 153 (chronological order preserved)")
            .isGreaterThan(idx153);

        assertThat(yaml).contains(
            "db/changelog/sql/154-migration-story-spec-generations-manual-edit.sql");

        // The new changeset must declare an idempotent pre-condition so it
        // re-runs cleanly against an already-migrated schema.
        int condIdx = yaml.indexOf("id: 154-migration-story-spec-generations-manual-edit");
        String tail = yaml.substring(condIdx, Math.min(condIdx + 800, yaml.length()));
        assertThat(tail).contains("preConditions");
        assertThat(tail).contains("onFail: MARK_RAN");
        assertThat(tail).contains("columnName: manually_edited");
    }

    // ------------------------------------------------------------------
    // Entity round-trip
    // ------------------------------------------------------------------

    @Test
    @DisplayName("entity: builder + getters round-trip all four manual-edit fields with non-null values")
    void entity_setAllFourManualEditFields_roundTrip() {
        UUID id = UUID.randomUUID();
        UUID projectId = UUID.randomUUID();
        UUID workItemId = UUID.randomUUID();
        Instant editedAt = Instant.parse("2026-05-20T10:30:45.123Z");

        MigrationStorySpecGenerationEntity entity = MigrationStorySpecGenerationEntity.builder()
            .id(id)
            .projectId(projectId)
            .workItemId(workItemId)
            .status("generated")
            .manuallyEdited(Boolean.TRUE)
            .lastManuallyEditedAt(editedAt)
            .lastManuallyEditedBy("garyjohnston83@gmail.com")
            .previousSpecText("/agent-os:shape-spec OLD content\n- old AC line\n")
            .build();

        assertThat(entity.getManuallyEdited()).isTrue();
        assertThat(entity.getLastManuallyEditedAt()).isEqualTo(editedAt);
        assertThat(entity.getLastManuallyEditedBy()).isEqualTo("garyjohnston83@gmail.com");
        assertThat(entity.getPreviousSpecText())
            .isEqualTo("/agent-os:shape-spec OLD content\n- old AC line\n");

        // Setter-driven mutation also round-trips (covers PATCH-style update path).
        entity.setManuallyEdited(Boolean.FALSE);
        entity.setLastManuallyEditedAt(null);
        entity.setLastManuallyEditedBy(null);
        entity.setPreviousSpecText(null);

        assertThat(entity.getManuallyEdited()).isFalse();
        assertThat(entity.getLastManuallyEditedAt()).isNull();
        assertThat(entity.getLastManuallyEditedBy()).isNull();
        assertThat(entity.getPreviousSpecText()).isNull();
    }

    @Test
    @DisplayName("entity: default manuallyEdited is FALSE (Builder.Default + @PrePersist mirror DB DEFAULT false)")
    void entity_defaultManuallyEditedIsFalse() throws Exception {
        // 1) A builder that omits manuallyEdited entirely picks up the
        //    Builder.Default value (Boolean.FALSE), NOT null, NOT a primitive
        //    default. This is the contract that lets the @PrePersist /
        //    NOT NULL column accept the insert without an explicit set.
        MigrationStorySpecGenerationEntity built = MigrationStorySpecGenerationEntity.builder()
            .id(UUID.randomUUID())
            .projectId(UUID.randomUUID())
            .workItemId(UUID.randomUUID())
            .status("generated")
            .build();

        assertThat(built.getManuallyEdited())
            .as("Builder.Default supplies Boolean.FALSE when manuallyEdited is omitted")
            .isNotNull()
            .isFalse();

        // 2) An entity whose manuallyEdited has been explicitly nulled before
        //    INSERT must still surface FALSE post-PrePersist. The PrePersist
        //    method is package-protected on the entity; invoke it reflectively
        //    to mirror what JPA does at flush time.
        MigrationStorySpecGenerationEntity nulled = MigrationStorySpecGenerationEntity.builder()
            .id(UUID.randomUUID())
            .projectId(UUID.randomUUID())
            .workItemId(UUID.randomUUID())
            .status("generated")
            .manuallyEdited(null)
            .build();
        assertThat(nulled.getManuallyEdited())
            .as("explicit null on the builder survives until @PrePersist runs")
            .isNull();

        java.lang.reflect.Method onCreate =
            MigrationStorySpecGenerationEntity.class.getDeclaredMethod("onCreate");
        onCreate.setAccessible(true);
        onCreate.invoke(nulled);

        assertThat(nulled.getManuallyEdited())
            .as("@PrePersist restores Boolean.FALSE before INSERT so the NOT NULL column accepts the row")
            .isNotNull()
            .isFalse();
    }

    @Test
    @DisplayName("entity: the four manual-edit fields are declared as BOXED reference types")
    void entity_manualEditFieldsAreBoxedReferenceTypes() throws NoSuchFieldException {
        Class<MigrationStorySpecGenerationEntity> cls = MigrationStorySpecGenerationEntity.class;

        // Boxed Boolean -- NOT primitive boolean. A regression to primitive
        // would silently default to false on a PATCH that omits the field and
        // could wipe a previously-set true flag, per
        // project_primitive_double_dto_overwrite.md.
        assertThat(cls.getDeclaredField("manuallyEdited").getType())
            .as("manuallyEdited must be boxed Boolean (not primitive boolean)")
            .isEqualTo(Boolean.class);
        assertThat(cls.getDeclaredField("lastManuallyEditedAt").getType())
            .as("lastManuallyEditedAt must be boxed Instant")
            .isEqualTo(Instant.class);
        assertThat(cls.getDeclaredField("lastManuallyEditedBy").getType())
            .as("lastManuallyEditedBy must be boxed String")
            .isEqualTo(String.class);
        assertThat(cls.getDeclaredField("previousSpecText").getType())
            .as("previousSpecText must be boxed String")
            .isEqualTo(String.class);
    }

    // ------------------------------------------------------------------
    // Mapper round-trip (entity -> DTO -> entity)
    // ------------------------------------------------------------------

    @Test
    @DisplayName("mapper: round-trips all four manual-edit fields entity -> DTO -> entity")
    void mapper_roundTripsAllFourManualEditFieldsEntityToDto() {
        UUID id = UUID.randomUUID();
        UUID projectId = UUID.randomUUID();
        UUID workItemId = UUID.randomUUID();
        Instant editedAt = Instant.parse("2026-05-20T14:15:00Z");
        Instant generatedAt = Instant.parse("2026-05-20T09:00:00Z");

        MigrationStorySpecGenerationEntity source = MigrationStorySpecGenerationEntity.builder()
            .id(id)
            .projectId(projectId)
            .workItemId(workItemId)
            .status("generated")
            .confidence("high")
            .generatedSpecText("/agent-os:shape-spec NEW content")
            .generatedAt(generatedAt)
            .generationAttemptNumber(1)
            .manuallyEdited(Boolean.TRUE)
            .lastManuallyEditedAt(editedAt)
            .lastManuallyEditedBy("alice@example.com")
            .previousSpecText("/agent-os:shape-spec PRIOR content")
            .build();

        // Entity -> DTO carries every new field through.
        MigrationStorySpecGenerationDto dto = MigrationStorySpecGenerationMapper.toDto(source);
        assertThat(dto.manuallyEdited()).isTrue();
        assertThat(dto.lastManuallyEditedAt())
            .as("ISO-8601 string serialisation of lastManuallyEditedAt")
            .isEqualTo(editedAt.toString());
        assertThat(dto.lastManuallyEditedBy()).isEqualTo("alice@example.com");
        assertThat(dto.previousSpecText()).isEqualTo("/agent-os:shape-spec PRIOR content");

        // DTO -> fresh entity (toNewEntity) also carries every field through.
        MigrationStorySpecGenerationEntity roundTripped =
            MigrationStorySpecGenerationMapper.toNewEntity(dto, projectId);

        assertThat(roundTripped.getManuallyEdited()).isTrue();
        assertThat(roundTripped.getLastManuallyEditedAt())
            .as("ISO-8601 string parses back to an equal Instant")
            .isEqualTo(editedAt);
        assertThat(roundTripped.getLastManuallyEditedBy()).isEqualTo("alice@example.com");
        assertThat(roundTripped.getPreviousSpecText())
            .isEqualTo("/agent-os:shape-spec PRIOR content");

        // The back-compat 19-arg constructor on the DTO defaults manuallyEdited
        // to FALSE (mirroring the DB DEFAULT) and the three audit fields to
        // null -- existing positional call sites compile and produce the safe
        // default.
        MigrationStorySpecGenerationDto backCompat = new MigrationStorySpecGenerationDto(
            UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), null, null,
            "generated", null, null, null, null, null, null, null,
            null, null, 0, null, null, null);
        assertThat(backCompat.manuallyEdited())
            .as("19-arg constructor defaults manuallyEdited to FALSE (DB DEFAULT)")
            .isFalse();
        assertThat(backCompat.lastManuallyEditedAt()).isNull();
        assertThat(backCompat.lastManuallyEditedBy()).isNull();
        assertThat(backCompat.previousSpecText()).isNull();
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private static String readSql(String filename) throws IOException {
        return Files.readString(SQL_DIR.resolve(filename), StandardCharsets.UTF_8);
    }

    /**
     * The AMS module root is where {@code pom.xml} lives. Working directory
     * during a Surefire run is the module root; during the isolated javac /
     * console-launcher workaround it is also the module root. Fall back to
     * walking upward in case a future runner changes the convention.
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
        throw new IllegalStateException(
            "Could not locate AMS project root from " + Paths.get("").toAbsolutePath());
    }
}
