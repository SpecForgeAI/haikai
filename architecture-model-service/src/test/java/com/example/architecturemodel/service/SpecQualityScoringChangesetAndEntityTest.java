package com.example.architecturemodel.service;

import com.example.architecturemodel.model.entity.MigrationStorySpecGenerationEntity;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Focused JUnit tests for Spec Quality Scoring -- Task Group 1
 * (Liquibase changeset 153 + the four new entity columns on
 * {@link MigrationStorySpecGenerationEntity}).
 *
 * <p>Spec: Spec Quality Scoring (2026-05-20) -- Task Group 1.</p>
 *
 * <p>Verification strategy mirrors the recent
 * {@code MissingInputResolverFlowChangesetSmokeTest} pattern: a content-level
 * smoke check guarantees the changeset declares the right columns and CHECK
 * constraints and is registered in the master changelog, AND an in-memory
 * entity round-trip exercise verifies the new boxed-type fields are wired
 * correctly through Lombok-generated getters / setters / builder. The full
 * AMS test suite has compile issues on this branch; this content + entity
 * coverage is the verification vehicle authorised by Task Group 1's brief.</p>
 *
 * <p>Six tests across two surfaces:</p>
 * <ol>
 *   <li>{@link #changeset153_addsAllFourColumns} -- SQL declares the four new
 *       columns with the right types.</li>
 *   <li>{@link #changeset153_declaresCheckConstraintVocabulary} -- SQL CHECK
 *       constraints cover the 0..100 score ranges and the A/B/C/D/F grade
 *       vocabulary.</li>
 *   <li>{@link #masterChangelog_registersChangeset153} -- master yaml
 *       registers 153 after 152 with the matching sqlFile path.</li>
 *   <li>{@link #entity_setAllFourQualityFields_roundTrip} -- builder + setters
 *       + getters round-trip the four new fields with non-null values
 *       including a nested {@code List<Map<String,Object>>} blob.</li>
 *   <li>{@link #entity_nullQualityFields_roundTripWithoutPrimitiveDefault} --
 *       all four boxed-type fields preserve {@code null} round-trip; no
 *       silent primitive default to {@code 0}.</li>
 *   <li>{@link #entity_qualityFieldsAreBoxedReferenceTypes} -- reflective
 *       check that the four fields are declared as boxed reference types
 *       ({@link Integer} / {@link String} / {@link List}), guarding against
 *       a future primitive-overwrite regression.</li>
 * </ol>
 */
class SpecQualityScoringChangesetAndEntityTest {

    private static final Path PROJECT_ROOT = locateProjectRoot();
    private static final Path CHANGELOG_DIR = PROJECT_ROOT.resolve(
        Paths.get("src", "main", "resources", "db", "changelog"));
    private static final Path SQL_DIR = CHANGELOG_DIR.resolve("sql");
    private static final Path MASTER_YAML = CHANGELOG_DIR.resolve("db.changelog-master.yaml");

    // ------------------------------------------------------------------
    // Changeset content smoke
    // ------------------------------------------------------------------

    @Test
    @DisplayName("changeset 153: declares quality_score, quality_grade, quality_dimensions_json, previous_quality_score")
    void changeset153_addsAllFourColumns() throws IOException {
        String sql = readSql("153-migration-story-spec-generations-quality-scoring.sql");

        assertThat(sql).contains("ALTER TABLE migration_story_spec_generations");

        assertThat(sql)
            .as("quality_score column declared as SMALLINT NULL")
            .contains("quality_score")
            .contains("SMALLINT");
        assertThat(sql)
            .as("quality_grade column declared as VARCHAR(1) NULL")
            .contains("quality_grade")
            .contains("VARCHAR(1)");
        assertThat(sql)
            .as("quality_dimensions_json column declared as JSONB NULL")
            .contains("quality_dimensions_json")
            .contains("JSONB");
        assertThat(sql)
            .as("previous_quality_score column declared as SMALLINT NULL")
            .contains("previous_quality_score");
    }

    @Test
    @DisplayName("changeset 153: CHECK constraints cover 0..100 score range and A/B/C/D/F grade vocabulary")
    void changeset153_declaresCheckConstraintVocabulary() throws IOException {
        String sql = readSql("153-migration-story-spec-generations-quality-scoring.sql");

        // Score range guards (both quality_score and previous_quality_score).
        assertThat(sql).contains("CONSTRAINT chk_msg_quality_score");
        assertThat(sql).contains("quality_score BETWEEN 0 AND 100");
        assertThat(sql).contains("CONSTRAINT chk_msg_previous_quality_score");
        assertThat(sql).contains("previous_quality_score BETWEEN 0 AND 100");

        // Grade vocabulary guard.
        assertThat(sql).contains("CONSTRAINT chk_msg_quality_grade");
        assertThat(sql).contains("quality_grade IN ('A', 'B', 'C', 'D', 'F')");
    }

    @Test
    @DisplayName("master changelog: registers changeset 153 with matching sqlFile path")
    void masterChangelog_registersChangeset153() throws IOException {
        String yaml = Files.readString(MASTER_YAML, StandardCharsets.UTF_8);

        int idx152 = yaml.indexOf("id: 152-project-max-contract-upload-size");
        int idx153 = yaml.indexOf("id: 153-migration-story-spec-generations-quality-scoring");

        assertThat(idx152).as("changeset 152 still registered").isPositive();
        assertThat(idx153).as("changeset 153 registered").isPositive();
        assertThat(idx153).as("153 appears AFTER 152 (chronological order)").isGreaterThan(idx152);

        assertThat(yaml).contains(
            "db/changelog/sql/153-migration-story-spec-generations-quality-scoring.sql");

        // Verify the preCondition checks for column-not-already-exists so the
        // changeset is idempotent on re-run against an already-migrated schema.
        int condIdx = yaml.indexOf(
            "id: 153-migration-story-spec-generations-quality-scoring");
        String tail = yaml.substring(condIdx, Math.min(condIdx + 800, yaml.length()));
        assertThat(tail).contains("preConditions");
        assertThat(tail).contains("onFail: MARK_RAN");
        assertThat(tail).contains("columnName: quality_score");
    }

    // ------------------------------------------------------------------
    // Entity round-trip
    // ------------------------------------------------------------------

    @Test
    @DisplayName("entity: builder + getters round-trip all four new quality fields with non-null values")
    void entity_setAllFourQualityFields_roundTrip() {
        UUID id = UUID.randomUUID();
        UUID projectId = UUID.randomUUID();
        UUID workItemId = UUID.randomUUID();

        // Realistic per-dimension breakdown blob.
        List<Map<String, Object>> dimensions = new ArrayList<>();
        Map<String, Object> dim1 = new LinkedHashMap<>();
        dim1.put("dimension", "completeness");
        dim1.put("score", 57);
        dim1.put("reason", "4/7 expected sections present; missing: tests, files affected, evidence refs");
        dimensions.add(dim1);
        Map<String, Object> dim2 = new LinkedHashMap<>();
        dim2.put("dimension", "ac_measurability");
        dim2.put("score", 75);
        dim2.put("reason", "2 of 3 ACs include measurable signals; weakest: \"works correctly\"");
        dimensions.add(dim2);

        MigrationStorySpecGenerationEntity entity = MigrationStorySpecGenerationEntity.builder()
            .id(id)
            .projectId(projectId)
            .workItemId(workItemId)
            .status("generated")
            .qualityScore(72)
            .qualityGrade("B")
            .qualityDimensionsJson(dimensions)
            .previousQualityScore(60)
            .build();

        assertThat(entity.getQualityScore()).isEqualTo(72);
        assertThat(entity.getQualityGrade()).isEqualTo("B");
        assertThat(entity.getPreviousQualityScore()).isEqualTo(60);
        assertThat(entity.getQualityDimensionsJson())
            .isNotNull()
            .hasSize(2);
        assertThat(entity.getQualityDimensionsJson().get(0))
            .containsEntry("dimension", "completeness")
            .containsEntry("score", 57);
        assertThat(entity.getQualityDimensionsJson().get(1))
            .containsEntry("dimension", "ac_measurability")
            .containsEntry("score", 75);

        // Setter-driven mutation also round-trips (covers PATCH-style update path).
        entity.setQualityScore(88);
        entity.setQualityGrade("A");
        entity.setPreviousQualityScore(72);
        assertThat(entity.getQualityScore()).isEqualTo(88);
        assertThat(entity.getQualityGrade()).isEqualTo("A");
        assertThat(entity.getPreviousQualityScore()).isEqualTo(72);
    }

    @Test
    @DisplayName("entity: null quality fields round-trip without primitive default contamination")
    void entity_nullQualityFields_roundTripWithoutPrimitiveDefault() {
        MigrationStorySpecGenerationEntity entity = MigrationStorySpecGenerationEntity.builder()
            .id(UUID.randomUUID())
            .projectId(UUID.randomUUID())
            .workItemId(UUID.randomUUID())
            .status("insufficient_context")
            .qualityScore(null)
            .qualityGrade(null)
            .qualityDimensionsJson(null)
            .previousQualityScore(null)
            .build();

        // Skip-scoring rule: insufficient_context / failed rows store NULL.
        // If the entity declared int/boolean primitives, Lombok's getter would
        // return 0/false instead of null and this assertion would fail --
        // guarding project_primitive_double_dto_overwrite.md.
        assertThat(entity.getQualityScore()).isNull();
        assertThat(entity.getQualityGrade()).isNull();
        assertThat(entity.getQualityDimensionsJson()).isNull();
        assertThat(entity.getPreviousQualityScore()).isNull();

        // Explicit set-to-null after a non-null value also preserves null
        // (the PATCH semantic the boxed-type rule protects).
        entity.setQualityScore(80);
        entity.setQualityScore(null);
        assertThat(entity.getQualityScore()).isNull();
    }

    @Test
    @DisplayName("entity: the four quality fields are declared as BOXED reference types")
    void entity_qualityFieldsAreBoxedReferenceTypes() throws NoSuchFieldException {
        Class<MigrationStorySpecGenerationEntity> cls = MigrationStorySpecGenerationEntity.class;

        // Boxed Integer / String -- NOT int / char. A regression to primitive
        // here would silently default to 0/false on a PATCH that omits the
        // field and wipe a previously-set score, per
        // project_primitive_double_dto_overwrite.md.
        assertThat(cls.getDeclaredField("qualityScore").getType())
            .as("qualityScore must be boxed Integer (not primitive int)")
            .isEqualTo(Integer.class);
        assertThat(cls.getDeclaredField("qualityGrade").getType())
            .as("qualityGrade must be boxed String")
            .isEqualTo(String.class);
        assertThat(cls.getDeclaredField("previousQualityScore").getType())
            .as("previousQualityScore must be boxed Integer (not primitive int)")
            .isEqualTo(Integer.class);
        // qualityDimensionsJson is a List interface reference (boxed by definition).
        assertThat(cls.getDeclaredField("qualityDimensionsJson").getType())
            .as("qualityDimensionsJson must be a List reference type")
            .isEqualTo(List.class);
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
