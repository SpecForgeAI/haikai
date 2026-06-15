package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Focused tests for the {@code qualityGrade} field on
 * {@link MigrationDeliveryHierarchyNodeDto} added by the Spec Quality Scoring
 * spec (2026-05-20).
 *
 * <p>Spec: Spec Quality Scoring (2026-05-20) -- Task Group 4.1.</p>
 *
 * <p>Tests cover:</p>
 * <ol>
 *   <li>The canonical 17-arg constructor surfaces {@code qualityGrade} on the
 *       DTO and serialises it under JSON property name
 *       {@code quality_grade}.</li>
 *   <li>The 15-arg back-compat constructor (predates {@code staleReason} and
 *       {@code qualityGrade}) still compiles and yields
 *       {@code qualityGrade == null}.</li>
 *   <li>The 16-arg back-compat constructor (predates {@code qualityGrade}
 *       only) still compiles, preserves {@code staleReason}, and yields
 *       {@code qualityGrade == null}.</li>
 *   <li>A node built with no spec row (null quality grade) serialises with
 *       {@code quality_grade: null}.</li>
 * </ol>
 */
class MigrationDeliveryHierarchyNodeDtoQualityGradeTest {

    @Test
    @DisplayName("17-arg canonical constructor surfaces qualityGrade and serialises it as quality_grade")
    void canonicalConstructor_surfacesQualityGrade() throws Exception {
        MigrationDeliveryHierarchyNodeDto node = new MigrationDeliveryHierarchyNodeDto(
            "story-1", "feature-1", "story", "Migrate accounts API",
            "core-banking", 7, null, "saved",
            "generated", "high", "in_progress", "covered",
            0L, 0L,
            "target_architecture_changed",
            "A",
            List.of());

        assertThat(node.qualityGrade()).isEqualTo("A");
        assertThat(node.staleReason()).isEqualTo("target_architecture_changed");

        ObjectMapper mapper = new ObjectMapper()
            .setPropertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE);
        String json = mapper.writeValueAsString(node);
        assertThat(json).contains("\"quality_grade\":\"A\"");
        assertThat(json).contains("\"stale_reason\":\"target_architecture_changed\"");
    }

    @Test
    @DisplayName("15-arg back-compat constructor leaves qualityGrade null (pre-staleReason, pre-qualityGrade callers)")
    void backCompat15ArgConstructor_qualityGradeNull() {
        MigrationDeliveryHierarchyNodeDto node = new MigrationDeliveryHierarchyNodeDto(
            "story-1", "feature-1", "story", "x",
            null, null, null, "saved",
            "generated", "high", "in_progress", "covered",
            0L, 0L,
            List.of());

        assertThat(node.qualityGrade()).isNull();
        assertThat(node.staleReason()).isNull();
    }

    @Test
    @DisplayName("16-arg back-compat constructor preserves staleReason and leaves qualityGrade null")
    void backCompat16ArgConstructor_qualityGradeNull() {
        MigrationDeliveryHierarchyNodeDto node = new MigrationDeliveryHierarchyNodeDto(
            "story-1", "feature-1", "story", "x",
            null, null, null, "saved",
            "generated", "high", "in_progress", "covered",
            0L, 0L,
            "resolution_reset",
            List.of());

        assertThat(node.qualityGrade()).isNull();
        assertThat(node.staleReason()).isEqualTo("resolution_reset");
    }

    @Test
    @DisplayName("17-arg constructor with null qualityGrade serialises as null (skipped row / no spec)")
    void canonicalConstructor_nullQualityGradeSerialisesAsNull() throws Exception {
        MigrationDeliveryHierarchyNodeDto node = new MigrationDeliveryHierarchyNodeDto(
            "story-1", "feature-1", "story", "x",
            null, null, null, "saved",
            "insufficient_context", null, null, "no_coverage",
            0L, 0L,
            null,
            null,
            List.of());

        assertThat(node.qualityGrade()).isNull();

        ObjectMapper mapper = new ObjectMapper()
            .setPropertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE);
        String json = mapper.writeValueAsString(node);
        assertThat(json).contains("\"quality_grade\":null");
    }
}
