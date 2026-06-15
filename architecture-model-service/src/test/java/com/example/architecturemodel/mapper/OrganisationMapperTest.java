package com.example.architecturemodel.mapper;

import com.example.architecturemodel.model.dto.OrganisationDto;
import com.example.architecturemodel.model.entity.OrganisationEntity;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for OrganisationMapper.
 *
 * Tests mapping between OrganisationEntity and OrganisationDto including new fields.
 *
 * Spec: Organisation Model + DB + API DTOs (Backend Foundation)
 * Task Group 3: Entity, DTO, Repository, and Mapper Updates
 */
class OrganisationMapperTest {

    private OrganisationMapper mapper;

    @BeforeEach
    void setUp() {
        mapper = new OrganisationMapper();
    }

    /**
     * Test 1: OrganisationEntity builder initializes List fields to empty ArrayList by default.
     */
    @Test
    @DisplayName("OrganisationEntity builder initializes List fields to empty ArrayList by default")
    void testEntityBuilderInitializesListFieldsToEmptyArrayList() {
        OrganisationEntity entity = OrganisationEntity.builder()
            .id("org-test-1")
            .name("Test Org")
            .build();

        assertThat(entity.getDocsAppliedToAllSources()).isNotNull().isEmpty();
        assertThat(entity.getDocsAppliedToTechStack()).isNotNull().isEmpty();
        assertThat(entity.getDocsAppliedToCodingStyles()).isNotNull().isEmpty();
        assertThat(entity.getDocsAppliedToConventions()).isNotNull().isEmpty();
        assertThat(entity.getDocsAppliedToErrorHandling()).isNotNull().isEmpty();
        assertThat(entity.getDocsAppliedToValidation()).isNotNull().isEmpty();
    }

    /**
     * Test 2: OrganisationEntity builder initializes techStandardsGenerated to false by default.
     */
    @Test
    @DisplayName("OrganisationEntity builder initializes techStandardsGenerated to false by default")
    void testEntityBuilderInitializesTechStandardsGeneratedToFalse() {
        OrganisationEntity entity = OrganisationEntity.builder()
            .id("org-test-2")
            .name("Test Org")
            .build();

        assertThat(entity.getTechStandardsGenerated()).isFalse();
    }

    /**
     * Test 3: OrganisationMapper.toDto() converts null lists to empty lists.
     */
    @Test
    @DisplayName("OrganisationMapper.toDto() converts null lists to empty lists")
    void testToDtoConvertsNullListsToEmptyLists() {
        // Create entity with explicit nulls for list fields
        OrganisationEntity entity = new OrganisationEntity();
        entity.setId("org-test-3");
        entity.setName("Test Org");
        entity.setDescription("Test description");
        entity.setDocsAppliedToAllSources(null);
        entity.setDocsAppliedToTechStack(null);
        entity.setDocsAppliedToCodingStyles(null);
        entity.setDocsAppliedToConventions(null);
        entity.setDocsAppliedToErrorHandling(null);
        entity.setDocsAppliedToValidation(null);
        entity.setTechStandardsGenerated(null);

        OrganisationDto dto = mapper.toDto(entity);

        assertThat(dto.docsAppliedToAllSources()).isNotNull().isEmpty();
        assertThat(dto.docsAppliedToTechStack()).isNotNull().isEmpty();
        assertThat(dto.docsAppliedToCodingStyles()).isNotNull().isEmpty();
        assertThat(dto.docsAppliedToConventions()).isNotNull().isEmpty();
        assertThat(dto.docsAppliedToErrorHandling()).isNotNull().isEmpty();
        assertThat(dto.docsAppliedToValidation()).isNotNull().isEmpty();
        assertThat(dto.techStandardsGenerated()).isFalse();
    }

    /**
     * Test 4: OrganisationMapper.toEntity() maps all seven new fields correctly.
     */
    @Test
    @DisplayName("OrganisationMapper.toEntity() maps all seven new fields correctly")
    void testToEntityMapsAllSevenNewFields() {
        OrganisationDto dto = new OrganisationDto(
            "org-test-4",
            "Test Org",
            "Test description",
            List.of("all-sources-1.md"),
            List.of("tech-stack-1.md"),
            List.of("coding-styles-1.md"),
            List.of("conventions-1.md"),
            List.of("error-handling-1.md"),
            List.of("validation-1.md"),
            true
        );

        OrganisationEntity entity = mapper.toEntity(dto);

        assertThat(entity.getId()).isEqualTo("org-test-4");
        assertThat(entity.getName()).isEqualTo("Test Org");
        assertThat(entity.getDescription()).isEqualTo("Test description");
        assertThat(entity.getDocsAppliedToAllSources()).containsExactly("all-sources-1.md");
        assertThat(entity.getDocsAppliedToTechStack()).containsExactly("tech-stack-1.md");
        assertThat(entity.getDocsAppliedToCodingStyles()).containsExactly("coding-styles-1.md");
        assertThat(entity.getDocsAppliedToConventions()).containsExactly("conventions-1.md");
        assertThat(entity.getDocsAppliedToErrorHandling()).containsExactly("error-handling-1.md");
        assertThat(entity.getDocsAppliedToValidation()).containsExactly("validation-1.md");
        assertThat(entity.getTechStandardsGenerated()).isTrue();
    }

    /**
     * Test: OrganisationMapper.toDto() maps all seven new fields correctly.
     */
    @Test
    @DisplayName("OrganisationMapper.toDto() maps all seven new fields correctly")
    void testToDtoMapsAllSevenNewFields() {
        OrganisationEntity entity = OrganisationEntity.builder()
            .id("org-test-5")
            .name("Test Org")
            .description("Test description")
            .docsAppliedToAllSources(List.of("all-sources.md"))
            .docsAppliedToTechStack(List.of("tech-stack.md"))
            .docsAppliedToCodingStyles(List.of("coding-styles.md"))
            .docsAppliedToConventions(List.of("conventions.md"))
            .docsAppliedToErrorHandling(List.of("error-handling.md"))
            .docsAppliedToValidation(List.of("validation.md"))
            .techStandardsGenerated(true)
            .build();

        OrganisationDto dto = mapper.toDto(entity);

        assertThat(dto.id()).isEqualTo("org-test-5");
        assertThat(dto.name()).isEqualTo("Test Org");
        assertThat(dto.description()).isEqualTo("Test description");
        assertThat(dto.docsAppliedToAllSources()).containsExactly("all-sources.md");
        assertThat(dto.docsAppliedToTechStack()).containsExactly("tech-stack.md");
        assertThat(dto.docsAppliedToCodingStyles()).containsExactly("coding-styles.md");
        assertThat(dto.docsAppliedToConventions()).containsExactly("conventions.md");
        assertThat(dto.docsAppliedToErrorHandling()).containsExactly("error-handling.md");
        assertThat(dto.docsAppliedToValidation()).containsExactly("validation.md");
        assertThat(dto.techStandardsGenerated()).isTrue();
    }

    /**
     * Test: OrganisationMapper.toEntity() handles null DTO lists correctly.
     */
    @Test
    @DisplayName("OrganisationMapper.toEntity() handles null DTO lists correctly")
    void testToEntityHandlesNullDtoLists() {
        OrganisationDto dto = new OrganisationDto(
            "org-test-6",
            "Test Org",
            null,
            null, null, null, null, null, null,
            null
        );

        OrganisationEntity entity = mapper.toEntity(dto);

        assertThat(entity.getDocsAppliedToAllSources()).isNotNull().isEmpty();
        assertThat(entity.getDocsAppliedToTechStack()).isNotNull().isEmpty();
        assertThat(entity.getDocsAppliedToCodingStyles()).isNotNull().isEmpty();
        assertThat(entity.getDocsAppliedToConventions()).isNotNull().isEmpty();
        assertThat(entity.getDocsAppliedToErrorHandling()).isNotNull().isEmpty();
        assertThat(entity.getDocsAppliedToValidation()).isNotNull().isEmpty();
        assertThat(entity.getTechStandardsGenerated()).isFalse();
    }
}
