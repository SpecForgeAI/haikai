package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ConflictException;
import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.mapper.DeliveryTeamMapper;
import com.example.architecturemodel.model.dto.DeliveryTeamDto;
import com.example.architecturemodel.model.entity.DeliveryTeamEntity;
import com.example.architecturemodel.repository.DeliveryTeamRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.Spy;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/**
 * Unit tests for DeliveryTeamService.
 *
 * Tests CRUD business logic and validation rules using Mockito.
 *
 * Spec: RM Increment 3 -- DeliveryTeam Entity (DB Only, No UI)
 * Task Group 3: DTO, Mapper, and Service (Task 3.4)
 */
@ExtendWith(MockitoExtension.class)
class DeliveryTeamServiceTest {

    @Mock
    private DeliveryTeamRepository deliveryTeamRepository;

    @Spy
    private DeliveryTeamMapper deliveryTeamMapper = new DeliveryTeamMapper();

    @InjectMocks
    private DeliveryTeamService deliveryTeamService;

    private UUID testProjectId;
    private UUID testTeamId;

    @BeforeEach
    void setUp() {
        testProjectId = UUID.randomUUID();
        testTeamId = UUID.randomUUID();
    }

    /**
     * Test 1: create with valid inputs generates UUID, builds entity, saves, and returns DTO.
     */
    @Test
    @DisplayName("create with valid inputs generates UUID, builds entity, saves, and returns DTO")
    void testCreateWithValidInputs() {
        // Given
        when(deliveryTeamRepository.existsByProjectIdAndNameIgnoreCase(any(UUID.class), anyString()))
            .thenReturn(false);
        when(deliveryTeamRepository.save(any(DeliveryTeamEntity.class)))
            .thenAnswer(invocation -> invocation.getArgument(0));

        // When
        DeliveryTeamDto result = deliveryTeamService.create(
            testProjectId, "Platform Team", "INTERNAL", "Handles platform services");

        // Then
        assertThat(result).isNotNull();
        assertThat(result.id()).isNotNull();
        assertThat(result.projectId()).isEqualTo(testProjectId);
        assertThat(result.name()).isEqualTo("Platform Team");
        assertThat(result.type()).isEqualTo("INTERNAL");
        assertThat(result.description()).isEqualTo("Handles platform services");
        assertThat(result.createdAt()).isNotNull();
        assertThat(result.updatedAt()).isNotNull();

        // Verify entity was built and saved correctly
        ArgumentCaptor<DeliveryTeamEntity> captor = ArgumentCaptor.forClass(DeliveryTeamEntity.class);
        verify(deliveryTeamRepository).save(captor.capture());
        DeliveryTeamEntity savedEntity = captor.getValue();
        assertThat(savedEntity.getId()).isNotNull();
        assertThat(savedEntity.getProjectId()).isEqualTo(testProjectId);
        assertThat(savedEntity.getName()).isEqualTo("Platform Team");
        assertThat(savedEntity.getType()).isEqualTo("INTERNAL");
    }

    /**
     * Test 2: create with duplicate name (case-insensitive) throws ConflictException.
     */
    @Test
    @DisplayName("create with duplicate name (case-insensitive) throws ConflictException")
    void testCreateWithDuplicateNameThrowsConflict() {
        // Given - a team with this name already exists
        when(deliveryTeamRepository.existsByProjectIdAndNameIgnoreCase(testProjectId, "Platform Team"))
            .thenReturn(true);

        // When / Then
        assertThatThrownBy(() ->
            deliveryTeamService.create(testProjectId, "Platform Team", "INTERNAL", null))
            .isInstanceOf(ConflictException.class)
            .hasMessageContaining("already exists");

        // Verify save was never called
        verify(deliveryTeamRepository, never()).save(any());
    }

    /**
     * Test 3: create with invalid type (not INTERNAL/EXTERNAL) throws IllegalArgumentException.
     */
    @Test
    @DisplayName("create with invalid type throws IllegalArgumentException")
    void testCreateWithInvalidTypeThrowsIllegalArgument() {
        // When / Then
        assertThatThrownBy(() ->
            deliveryTeamService.create(testProjectId, "Platform Team", "INVALID_TYPE", null))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("Invalid delivery team type");

        // Verify repository was never called
        verify(deliveryTeamRepository, never()).existsByProjectIdAndNameIgnoreCase(any(), anyString());
        verify(deliveryTeamRepository, never()).save(any());
    }

    /**
     * Test 4: create with blank name throws IllegalArgumentException;
     * name exceeding 120 chars throws IllegalArgumentException.
     */
    @Test
    @DisplayName("create with blank or too-long name throws IllegalArgumentException")
    void testCreateWithInvalidNameThrowsIllegalArgument() {
        // Null name
        assertThatThrownBy(() ->
            deliveryTeamService.create(testProjectId, null, "INTERNAL", null))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("name is required");

        // Empty name
        assertThatThrownBy(() ->
            deliveryTeamService.create(testProjectId, "", "INTERNAL", null))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("name is required");

        // Whitespace only
        assertThatThrownBy(() ->
            deliveryTeamService.create(testProjectId, "   ", "INTERNAL", null))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("name is required");

        // Name exceeding 120 chars
        String longName = "A".repeat(121);
        assertThatThrownBy(() ->
            deliveryTeamService.create(testProjectId, longName, "INTERNAL", null))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("must not exceed 120 characters");

        // Verify repository was never called
        verify(deliveryTeamRepository, never()).save(any());
    }

    /**
     * Test 5: update with valid inputs updates fields on existing entity and returns updated DTO;
     * update on non-existent team throws ResourceNotFoundException.
     */
    @Test
    @DisplayName("update with valid inputs updates existing entity; update on non-existent throws 404")
    void testUpdateBehavior() {
        // --- Part A: Successful update ---
        Instant originalCreatedAt = Instant.parse("2026-02-15T08:00:00Z");
        DeliveryTeamEntity existingEntity = DeliveryTeamEntity.builder()
            .id(testTeamId)
            .projectId(testProjectId)
            .name("Old Name")
            .type("INTERNAL")
            .description("Old description")
            .createdAt(originalCreatedAt)
            .updatedAt(originalCreatedAt)
            .build();

        when(deliveryTeamRepository.findById(testTeamId))
            .thenReturn(Optional.of(existingEntity));
        when(deliveryTeamRepository.findByProjectIdAndNameIgnoreCase(testProjectId, "New Name"))
            .thenReturn(Optional.empty());
        when(deliveryTeamRepository.save(any(DeliveryTeamEntity.class)))
            .thenAnswer(invocation -> invocation.getArgument(0));

        DeliveryTeamDto result = deliveryTeamService.update(
            testProjectId, testTeamId, "New Name", "EXTERNAL", "New description");

        assertThat(result).isNotNull();
        assertThat(result.id()).isEqualTo(testTeamId);
        assertThat(result.name()).isEqualTo("New Name");
        assertThat(result.type()).isEqualTo("EXTERNAL");
        assertThat(result.description()).isEqualTo("New description");

        // Verify the entity was updated in-place
        ArgumentCaptor<DeliveryTeamEntity> captor = ArgumentCaptor.forClass(DeliveryTeamEntity.class);
        verify(deliveryTeamRepository).save(captor.capture());
        DeliveryTeamEntity savedEntity = captor.getValue();
        assertThat(savedEntity.getId()).isEqualTo(testTeamId);
        assertThat(savedEntity.getName()).isEqualTo("New Name");
        assertThat(savedEntity.getType()).isEqualTo("EXTERNAL");

        // --- Part B: Update on non-existent team ---
        UUID nonExistentId = UUID.randomUUID();
        when(deliveryTeamRepository.findById(nonExistentId))
            .thenReturn(Optional.empty());

        assertThatThrownBy(() ->
            deliveryTeamService.update(testProjectId, nonExistentId, "Name", "INTERNAL", null))
            .isInstanceOf(ResourceNotFoundException.class)
            .hasMessageContaining("not found");
    }

    /**
     * Test 6: delete removes entity; delete on non-existent team throws ResourceNotFoundException.
     */
    @Test
    @DisplayName("delete removes entity; delete on non-existent throws ResourceNotFoundException")
    void testDeleteBehavior() {
        // --- Part A: Successful delete ---
        DeliveryTeamEntity existingEntity = DeliveryTeamEntity.builder()
            .id(testTeamId)
            .projectId(testProjectId)
            .name("Team To Delete")
            .type("INTERNAL")
            .build();

        when(deliveryTeamRepository.findById(testTeamId))
            .thenReturn(Optional.of(existingEntity));

        deliveryTeamService.delete(testProjectId, testTeamId);

        verify(deliveryTeamRepository).delete(existingEntity);

        // --- Part B: Delete on non-existent team ---
        UUID nonExistentId = UUID.randomUUID();
        when(deliveryTeamRepository.findById(nonExistentId))
            .thenReturn(Optional.empty());

        assertThatThrownBy(() ->
            deliveryTeamService.delete(testProjectId, nonExistentId))
            .isInstanceOf(ResourceNotFoundException.class)
            .hasMessageContaining("not found");
    }
}
