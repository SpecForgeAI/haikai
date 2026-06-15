package com.example.architecturemodel.service;

import com.example.architecturemodel.mapper.OrganisationMapper;
import com.example.architecturemodel.model.dto.OrganisationDto;
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

import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/**
 * Tests for OrganisationService with String ID types.
 *
 * Validates that the service correctly:
 * - Generates "org-" prefixed IDs
 * - Accepts String parameters for getOrganisationById
 * - Handles String IDs throughout the service layer
 *
 * Spec: Organisation ID Type Change (UUID to TEXT)
 * Task Group 4: Service Updates
 */
@ExtendWith(MockitoExtension.class)
class OrganisationServiceTextIdTest {

    @Mock
    private OrganisationRepository organisationRepository;

    @Spy
    private OrganisationMapper organisationMapper = new OrganisationMapper();

    @InjectMocks
    private OrganisationService organisationService;

    @Test
    @DisplayName("createOrganisation generates 'org-' prefixed ID")
    void testCreateOrganisationGeneratesPrefixedId() {
        // Given
        when(organisationRepository.existsByNameIgnoreCase("New Org")).thenReturn(false);
        when(organisationRepository.save(any(OrganisationEntity.class))).thenAnswer(invocation -> invocation.getArgument(0));

        // When
        OrganisationDto result = organisationService.createOrganisation("New Org", "Description");

        // Then
        assertThat(result.id()).isNotNull();
        assertThat(result.id()).startsWith("org-");
        assertThat(result.id()).hasSize("org-".length() + 36); // "org-" + UUID length

        // Verify saved entity has prefixed ID
        ArgumentCaptor<OrganisationEntity> captor = ArgumentCaptor.forClass(OrganisationEntity.class);
        verify(organisationRepository).save(captor.capture());
        assertThat(captor.getValue().getId()).startsWith("org-");
    }

    @Test
    @DisplayName("getOrganisationById accepts String parameter")
    void testGetOrganisationByIdAcceptsStringParameter() {
        // Given: An organisation with String ID
        String orgId = "org-" + UUID.randomUUID().toString();
        OrganisationEntity entity = OrganisationEntity.builder()
            .id(orgId)
            .name("Test Org")
            .description("Test description")
            .build();
        when(organisationRepository.findById(orgId)).thenReturn(Optional.of(entity));

        // When
        OrganisationDto result = organisationService.getOrganisationById(orgId);

        // Then
        assertThat(result).isNotNull();
        assertThat(result.id()).isEqualTo(orgId);
        assertThat(result.name()).isEqualTo("Test Org");
        verify(organisationRepository).findById(orgId);
    }

    @Test
    @DisplayName("Organisation lookup by ID returns correct organisation")
    void testOrganisationLookupByIdReturnsCorrectOrganisation() {
        // Given: Multiple organisations with different IDs
        String orgId1 = "org-" + UUID.randomUUID().toString();
        String orgId2 = "org-" + UUID.randomUUID().toString();

        OrganisationEntity entity1 = OrganisationEntity.builder()
            .id(orgId1)
            .name("First Org")
            .build();

        when(organisationRepository.findById(orgId1)).thenReturn(Optional.of(entity1));

        // When: Lookup by first ID
        OrganisationDto result1 = organisationService.getOrganisationById(orgId1);

        // Then: Returns correct organisation
        assertThat(result1.id()).isEqualTo(orgId1);
        assertThat(result1.name()).isEqualTo("First Org");
    }

    @Test
    @DisplayName("Created organisation ID format is consistent")
    void testCreatedOrganisationIdFormatConsistent() {
        // Given
        when(organisationRepository.existsByNameIgnoreCase(anyString())).thenReturn(false);
        when(organisationRepository.save(any(OrganisationEntity.class))).thenAnswer(invocation -> invocation.getArgument(0));

        // When: Create multiple organisations
        OrganisationDto org1 = organisationService.createOrganisation("Org 1", null);
        OrganisationDto org2 = organisationService.createOrganisation("Org 2", null);

        // Then: All IDs follow same format
        assertThat(org1.id()).matches("org-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}");
        assertThat(org2.id()).matches("org-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}");

        // And: IDs are unique
        assertThat(org1.id()).isNotEqualTo(org2.id());
    }

    @Test
    @DisplayName("String ID is preserved through service and repository layers")
    void testStringIdPreservedThroughLayers() {
        // Given: A specific organisation ID
        String specificId = "org-12345678-1234-1234-1234-123456789abc";
        OrganisationEntity entity = OrganisationEntity.builder()
            .id(specificId)
            .name("Preserved ID Org")
            .build();
        when(organisationRepository.findById(specificId)).thenReturn(Optional.of(entity));

        // When
        OrganisationDto result = organisationService.getOrganisationById(specificId);

        // Then: ID is exactly preserved
        assertThat(result.id()).isEqualTo(specificId);
    }
}
