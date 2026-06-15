package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Focused tests for the {@code manuallyEdited} field on
 * {@link MigrationDeliveryHierarchyNodeDto} added by the In-Product Spec
 * Editor + Confirm-Overwrite spec (2026-05-20).
 *
 * <p>Spec: In-Product Spec Editor + Confirm-Overwrite (2026-05-20) --
 * Task Group 4.1.</p>
 *
 * <p>Tests cover:</p>
 * <ol>
 *   <li>Canonical 18-arg constructor surfaces {@code manuallyEdited} on the
 *       DTO and serialises it under JSON property name
 *       {@code manually_edited} (snake_case wire).</li>
 *   <li>17-arg back-compat constructor (post-qualityGrade, pre-manuallyEdited)
 *       compiles and yields {@code manuallyEdited == null}.</li>
 *   <li>15-arg back-compat constructor (pre-staleReason, pre-qualityGrade,
 *       pre-manuallyEdited) still compiles and yields all three NULL.</li>
 *   <li>A node built with {@code manuallyEdited=null} serialises with
 *       {@code manually_edited: null} (no spec row case).</li>
 * </ol>
 */
class MigrationDeliveryHierarchyNodeDtoManuallyEditedTest {

    @Test
    @DisplayName("18-arg canonical constructor surfaces manuallyEdited and serialises as manually_edited (snake_case)")
    void canonicalConstructor_surfacesManuallyEditedTrueAsSnakeCase() throws Exception {
        MigrationDeliveryHierarchyNodeDto node = new MigrationDeliveryHierarchyNodeDto(
            "story-1", "feature-1", "story", "Migrate accounts API",
            "core-banking", 7, null, "saved",
            "generated", "high", "in_progress", "covered",
            0L, 0L,
            "target_architecture_changed",
            "A",
            Boolean.TRUE,
            List.of());

        // camelCase getter / record component
        assertThat(node.manuallyEdited()).isTrue();
        // Pre-existing fields still pass through.
        assertThat(node.qualityGrade()).isEqualTo("A");
        assertThat(node.staleReason()).isEqualTo("target_architecture_changed");

        ObjectMapper mapper = new ObjectMapper()
            .setPropertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE);
        String json = mapper.writeValueAsString(node);
        // The @JsonProperty annotation on the record component pins the wire
        // name to manually_edited regardless of the global naming strategy.
        assertThat(json).contains("\"manually_edited\":true");
    }

    @Test
    @DisplayName("17-arg back-compat constructor leaves manuallyEdited null (post-qualityGrade, pre-manuallyEdited callers)")
    void backCompat17ArgConstructor_manuallyEditedNull() {
        MigrationDeliveryHierarchyNodeDto node = new MigrationDeliveryHierarchyNodeDto(
            "story-1", "feature-1", "story", "x",
            null, null, null, "saved",
            "generated", "high", "in_progress", "covered",
            0L, 0L,
            "target_architecture_changed",
            "B",
            List.of());

        assertThat(node.manuallyEdited())
            .as("17-arg constructor defaults manuallyEdited to null")
            .isNull();
        assertThat(node.qualityGrade()).isEqualTo("B");
        assertThat(node.staleReason()).isEqualTo("target_architecture_changed");
    }

    @Test
    @DisplayName("15-arg back-compat constructor leaves staleReason / qualityGrade / manuallyEdited all null")
    void backCompat15ArgConstructor_allOptionalFieldsNull() {
        MigrationDeliveryHierarchyNodeDto node = new MigrationDeliveryHierarchyNodeDto(
            "story-1", "feature-1", "story", "x",
            null, null, null, "saved",
            "generated", "high", "in_progress", "covered",
            0L, 0L,
            List.of());

        assertThat(node.staleReason()).isNull();
        assertThat(node.qualityGrade()).isNull();
        assertThat(node.manuallyEdited()).isNull();
    }

    @Test
    @DisplayName("18-arg constructor with null manuallyEdited serialises as manually_edited:null (no spec row case)")
    void canonicalConstructor_nullManuallyEditedSerialisesAsNull() throws Exception {
        MigrationDeliveryHierarchyNodeDto node = new MigrationDeliveryHierarchyNodeDto(
            "story-1", "feature-1", "story", "x",
            null, null, null, "saved",
            null, null, null, "no_coverage",
            0L, 0L,
            null,
            null,
            null,
            List.of());

        assertThat(node.manuallyEdited()).isNull();

        ObjectMapper mapper = new ObjectMapper()
            .setPropertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE);
        String json = mapper.writeValueAsString(node);
        assertThat(json).contains("\"manually_edited\":null");
    }
}
