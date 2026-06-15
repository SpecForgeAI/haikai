package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ConflictException;
import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.mapper.OrganisationMapper;
import com.example.architecturemodel.model.dto.OrganisationDto;
import com.example.architecturemodel.model.dto.OrganisationListItemDto;
import com.example.architecturemodel.model.entity.OrganisationEntity;
import com.example.architecturemodel.repository.OrganisationRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.Spy;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/**
 * Unit tests for OrganisationService.
 *
 * Tests business logic and validation rules.
 *
 * Spec 2026-01-18: Organisations Iteration 1 - Add Organisation Model + Project FK + APIs
 * Spec 2026-01-18: Organisation ID Type Change (UUID to TEXT) - Updated to use String IDs
 * Spec 2026-01-31: Organisation Model + DB + API DTOs - Added case-insensitive uniqueness tests
 * Task Group 2: Service Layer - Organisation Service Implementation
 * Task Group 4: Service Layer Updates for Case-Insensitive Uniqueness
 */
@ExtendWith(MockitoExtension.class)
class OrganisationServiceTest {

    @Mock
    private OrganisationRepository organisationRepository;

    @Spy
    private OrganisationMapper organisationMapper = new OrganisationMapper();

    @InjectMocks
    private OrganisationService organisationService;

    private OrganisationEntity testEntity;
    private String testId;

    @BeforeEach
    void setUp() {
        testId = "org-" + UUID.randomUUID().toString();
        testEntity = OrganisationEntity.builder()
            .id(testId)
            .name("Test Organisation")
            .description("Test description")
            .build();
    }

    @Test
    @DisplayName("createOrganisation with valid name creates organisation with org- prefixed ID")
    void testCreateOrganisationWithValidName() {
        // Given
        when(organisationRepository.existsByNameIgnoreCase("New Org")).thenReturn(false);
        when(organisationRepository.save(any(OrganisationEntity.class))).thenAnswer(invocation -> {
            OrganisationEntity entity = invocation.getArgument(0);
            return entity;
        });

        // When
        OrganisationDto result = organisationService.createOrganisation("New Org", "A new organisation");

        // Then
        assertThat(result).isNotNull();
        assertThat(result.name()).isEqualTo("New Org");
        assertThat(result.description()).isEqualTo("A new organisation");
        assertThat(result.id()).isNotNull();
        assertThat(result.id()).startsWith("org-");

        ArgumentCaptor<OrganisationEntity> captor = ArgumentCaptor.forClass(OrganisationEntity.class);
        verify(organisationRepository).save(captor.capture());
        assertThat(captor.getValue().getName()).isEqualTo("New Org");
        assertThat(captor.getValue().getId()).startsWith("org-");
    }

    @Test
    @DisplayName("createOrganisation with duplicate name throws ConflictException (case-insensitive)")
    void testCreateOrganisationDuplicateNameThrowsConflict() {
        // Given - use case-insensitive check
        when(organisationRepository.existsByNameIgnoreCase("Existing Org")).thenReturn(true);

        // When/Then
        assertThatThrownBy(() -> organisationService.createOrganisation("Existing Org", null))
            .isInstanceOf(ConflictException.class)
            .hasMessageContaining("already exists")
            .hasMessageContaining("case-insensitive");

        verify(organisationRepository, never()).save(any());
    }

    @Test
    @DisplayName("createOrganisation with blank name throws IllegalArgumentException")
    void testCreateOrganisationBlankNameThrows400() {
        // When/Then
        assertThatThrownBy(() -> organisationService.createOrganisation("", null))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("Organisation name is required");

        assertThatThrownBy(() -> organisationService.createOrganisation("   ", null))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("Organisation name is required");

        assertThatThrownBy(() -> organisationService.createOrganisation(null, null))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("Organisation name is required");

        verify(organisationRepository, never()).save(any());
    }

    @Test
    @DisplayName("listOrganisations returns ordered list")
    void testListOrganisationsReturnsOrderedList() {
        // Given
        OrganisationEntity org1 = OrganisationEntity.builder()
            .id("org-" + UUID.randomUUID().toString())
            .name("Alpha")
            .build();
        OrganisationEntity org2 = OrganisationEntity.builder()
            .id("org-" + UUID.randomUUID().toString())
            .name("Beta")
            .build();
        when(organisationRepository.findAllByOrderByNameAsc()).thenReturn(List.of(org1, org2));

        // When
        List<OrganisationListItemDto> result = organisationService.listOrganisations();

        // Then
        assertThat(result).hasSize(2);
        assertThat(result.get(0).name()).isEqualTo("Alpha");
        assertThat(result.get(1).name()).isEqualTo("Beta");
        assertThat(result.get(0).id()).startsWith("org-");
        assertThat(result.get(1).id()).startsWith("org-");
    }

    @Test
    @DisplayName("getOrganisationByName returns organisation when found")
    void testGetOrganisationByNameReturnsWhenFound() {
        // Given
        when(organisationRepository.findByName("Test Organisation")).thenReturn(Optional.of(testEntity));

        // When
        OrganisationDto result = organisationService.getOrganisationByName("Test Organisation");

        // Then
        assertThat(result).isNotNull();
        assertThat(result.id()).isEqualTo(testId);
        assertThat(result.name()).isEqualTo("Test Organisation");
        assertThat(result.description()).isEqualTo("Test description");
    }

    @Test
    @DisplayName("getOrganisationByName throws ResourceNotFoundException when not found")
    void testGetOrganisationByNameThrowsWhenNotFound() {
        // Given
        when(organisationRepository.findByName("Non-Existent")).thenReturn(Optional.empty());

        // When/Then
        assertThatThrownBy(() -> organisationService.getOrganisationByName("Non-Existent"))
            .isInstanceOf(ResourceNotFoundException.class)
            .hasMessageContaining("Organisation not found with name");
    }

    @Test
    @DisplayName("getOrganisationById returns organisation when found")
    void testGetOrganisationByIdReturnsWhenFound() {
        // Given
        when(organisationRepository.findById(testId)).thenReturn(Optional.of(testEntity));

        // When
        OrganisationDto result = organisationService.getOrganisationById(testId);

        // Then
        assertThat(result).isNotNull();
        assertThat(result.id()).isEqualTo(testId);
        assertThat(result.name()).isEqualTo("Test Organisation");
    }

    @Test
    @DisplayName("getOrganisationById throws ResourceNotFoundException when not found")
    void testGetOrganisationByIdThrowsWhenNotFound() {
        // Given
        String nonExistentId = "org-" + UUID.randomUUID().toString();
        when(organisationRepository.findById(nonExistentId)).thenReturn(Optional.empty());

        // When/Then
        assertThatThrownBy(() -> organisationService.getOrganisationById(nonExistentId))
            .isInstanceOf(ResourceNotFoundException.class)
            .hasMessageContaining("Organisation not found with id");
    }

    // ============================================================================
    // Task Group 4: New tests for case-insensitive uniqueness
    // ============================================================================

    /**
     * Test 1: createOrganisation throws ConflictException when name differs only by case.
     */
    @Test
    @DisplayName("createOrganisation throws ConflictException when name differs only by case")
    void testCreateOrganisationThrowsConflictForCaseDifferentName() {
        // Given - "acme" exists, trying to create "ACME"
        when(organisationRepository.existsByNameIgnoreCase("ACME")).thenReturn(true);

        // When/Then
        assertThatThrownBy(() -> organisationService.createOrganisation("ACME", null))
            .isInstanceOf(ConflictException.class)
            .hasMessageContaining("already exists")
            .hasMessageContaining("case-insensitive");

        verify(organisationRepository, never()).save(any());
    }

    /**
     * Test 2: ConflictException message contains "(case-insensitive)" text.
     */
    @Test
    @DisplayName("ConflictException message contains '(case-insensitive)' text")
    void testConflictExceptionMessageContainsCaseInsensitiveText() {
        // Given
        when(organisationRepository.existsByNameIgnoreCase("Acme Corp")).thenReturn(true);

        // When/Then
        assertThatThrownBy(() -> organisationService.createOrganisation("Acme Corp", null))
            .isInstanceOf(ConflictException.class)
            .hasMessageContaining("(case-insensitive)");
    }

    /**
     * Test 3: createOrganisation initializes new fields with defaults when not provided.
     */
    @Test
    @DisplayName("createOrganisation initializes new fields with defaults when not provided")
    void testCreateOrganisationInitializesNewFieldsWithDefaults() {
        // Given
        when(organisationRepository.existsByNameIgnoreCase("New Org")).thenReturn(false);
        when(organisationRepository.save(any(OrganisationEntity.class))).thenAnswer(invocation -> {
            return invocation.getArgument(0);
        });

        // When
        OrganisationDto result = organisationService.createOrganisation("New Org", "Description");

        // Then - verify new fields have default values
        assertThat(result.docsAppliedToAllSources()).isNotNull().isEmpty();
        assertThat(result.docsAppliedToTechStack()).isNotNull().isEmpty();
        assertThat(result.docsAppliedToCodingStyles()).isNotNull().isEmpty();
        assertThat(result.docsAppliedToConventions()).isNotNull().isEmpty();
        assertThat(result.docsAppliedToErrorHandling()).isNotNull().isEmpty();
        assertThat(result.docsAppliedToValidation()).isNotNull().isEmpty();
        assertThat(result.techStandardsGenerated()).isFalse();
    }

    /**
     * Test 4: Existing organisation retrieval includes new fields with default values.
     */
    @Test
    @DisplayName("getOrganisationById includes new fields with default values")
    void testGetOrganisationByIdIncludesNewFieldsWithDefaults() {
        // Given - entity with default values for new fields
        OrganisationEntity entityWithDefaults = OrganisationEntity.builder()
            .id(testId)
            .name("Test Organisation")
            .description("Test description")
            .build();
        when(organisationRepository.findById(testId)).thenReturn(Optional.of(entityWithDefaults));

        // When
        OrganisationDto result = organisationService.getOrganisationById(testId);

        // Then - new fields should have default values via mapper
        assertThat(result.docsAppliedToAllSources()).isNotNull().isEmpty();
        assertThat(result.docsAppliedToTechStack()).isNotNull().isEmpty();
        assertThat(result.docsAppliedToCodingStyles()).isNotNull().isEmpty();
        assertThat(result.docsAppliedToConventions()).isNotNull().isEmpty();
        assertThat(result.docsAppliedToErrorHandling()).isNotNull().isEmpty();
        assertThat(result.docsAppliedToValidation()).isNotNull().isEmpty();
        assertThat(result.techStandardsGenerated()).isFalse();
    }

    /**
     * Test: getOrganisationById returns organisation with populated new fields.
     */
    @Test
    @DisplayName("getOrganisationById returns organisation with populated new fields")
    void testGetOrganisationByIdReturnsPopulatedNewFields() {
        // Given - entity with populated new fields
        OrganisationEntity entityWithFields = OrganisationEntity.builder()
            .id(testId)
            .name("Test Organisation")
            .description("Test description")
            .docsAppliedToAllSources(List.of("doc1.md"))
            .docsAppliedToTechStack(List.of("tech.md"))
            .docsAppliedToCodingStyles(List.of("style.md"))
            .docsAppliedToConventions(List.of("conv.md"))
            .docsAppliedToErrorHandling(List.of("err.md"))
            .docsAppliedToValidation(List.of("valid.md"))
            .techStandardsGenerated(true)
            .build();
        when(organisationRepository.findById(testId)).thenReturn(Optional.of(entityWithFields));

        // When
        OrganisationDto result = organisationService.getOrganisationById(testId);

        // Then
        assertThat(result.docsAppliedToAllSources()).containsExactly("doc1.md");
        assertThat(result.docsAppliedToTechStack()).containsExactly("tech.md");
        assertThat(result.docsAppliedToCodingStyles()).containsExactly("style.md");
        assertThat(result.docsAppliedToConventions()).containsExactly("conv.md");
        assertThat(result.docsAppliedToErrorHandling()).containsExactly("err.md");
        assertThat(result.docsAppliedToValidation()).containsExactly("valid.md");
        assertThat(result.techStandardsGenerated()).isTrue();
    }
}
