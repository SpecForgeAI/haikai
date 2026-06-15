package com.example.architecturemodel.service;

import com.example.architecturemodel.mapper.ProductDefinitionMapper;
import com.example.architecturemodel.model.dto.ProductDefinitionDto;
import com.example.architecturemodel.model.entity.ProductDefinitionEntity;
import com.example.architecturemodel.repository.ProductDefinitionRepository;
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
 * Unit tests for ProductDefinitionService.
 *
 * Tests the upsert business logic and validation rules.
 * Fills critical test coverage gaps identified in Task Group 4 (Test Review and Gap Analysis).
 *
 * Spec: Increment 1 -- Add Product Tab + Minimal ProductDefinition (UI + DB only)
 * Task Group 4: Test Review and Gap Analysis (Task 4.3)
 */
@ExtendWith(MockitoExtension.class)
class ProductDefinitionServiceTest {

    @Mock
    private ProductDefinitionRepository productDefinitionRepository;

    @Spy
    private ProductDefinitionMapper productDefinitionMapper = new ProductDefinitionMapper();

    @InjectMocks
    private ProductDefinitionService productDefinitionService;

    private UUID testProjectId;

    @BeforeEach
    void setUp() {
        testProjectId = UUID.randomUUID();
    }

    /**
     * Gap Test 1: Service upsert creates new entity when none exists for projectId.
     *
     * Verifies that when no ProductDefinition exists for the given projectId,
     * the service creates a brand new entity with a generated UUID, the given
     * projectId, the trimmed productName, and timestamp fields.
     */
    @Test
    @DisplayName("upsert creates new entity when none exists for projectId")
    void testUpsertCreatesNewEntityWhenNoneExists() {
        // Given - no existing definition for this project
        when(productDefinitionRepository.findByProjectId(testProjectId))
            .thenReturn(Optional.empty());
        when(productDefinitionRepository.save(any(ProductDefinitionEntity.class)))
            .thenAnswer(invocation -> invocation.getArgument(0));

        // When
        ProductDefinitionDto result = productDefinitionService.upsert(testProjectId, "New Product");

        // Then - verify a new entity was created with correct fields
        assertThat(result).isNotNull();
        assertThat(result.id()).isNotNull();
        assertThat(result.projectId()).isEqualTo(testProjectId);
        assertThat(result.productName()).isEqualTo("New Product");
        assertThat(result.createdAt()).isNotNull();
        assertThat(result.updatedAt()).isNotNull();

        // Verify save was called with a new entity
        ArgumentCaptor<ProductDefinitionEntity> captor = ArgumentCaptor.forClass(ProductDefinitionEntity.class);
        verify(productDefinitionRepository).save(captor.capture());
        ProductDefinitionEntity savedEntity = captor.getValue();
        assertThat(savedEntity.getProjectId()).isEqualTo(testProjectId);
        assertThat(savedEntity.getProductName()).isEqualTo("New Product");
        assertThat(savedEntity.getCreatedAt()).isNotNull();
    }

    /**
     * Gap Test 2: Service upsert updates existing entity when one already exists for projectId.
     *
     * Verifies that when a ProductDefinition already exists for the given projectId,
     * the service updates the productName and updatedAt fields on the existing entity
     * rather than creating a new one.
     */
    @Test
    @DisplayName("upsert updates existing entity when one already exists for projectId")
    void testUpsertUpdatesExistingEntityWhenOneExists() {
        // Given - an existing definition for this project
        UUID existingId = UUID.randomUUID();
        Instant originalCreatedAt = Instant.parse("2026-02-12T08:00:00Z");
        Instant originalUpdatedAt = Instant.parse("2026-02-12T08:00:00Z");

        ProductDefinitionEntity existingEntity = ProductDefinitionEntity.builder()
            .id(existingId)
            .projectId(testProjectId)
            .productName("Original Name")
            .createdAt(originalCreatedAt)
            .updatedAt(originalUpdatedAt)
            .build();

        when(productDefinitionRepository.findByProjectId(testProjectId))
            .thenReturn(Optional.of(existingEntity));
        when(productDefinitionRepository.save(any(ProductDefinitionEntity.class)))
            .thenAnswer(invocation -> invocation.getArgument(0));

        // When
        ProductDefinitionDto result = productDefinitionService.upsert(testProjectId, "Updated Name");

        // Then - verify the existing entity was updated, not replaced
        assertThat(result).isNotNull();
        assertThat(result.id()).isEqualTo(existingId); // Same ID as existing
        assertThat(result.projectId()).isEqualTo(testProjectId);
        assertThat(result.productName()).isEqualTo("Updated Name");
        assertThat(result.createdAt()).isEqualTo(originalCreatedAt); // createdAt unchanged
        assertThat(result.updatedAt()).isAfter(originalUpdatedAt); // updatedAt changed

        // Verify the same entity was updated and saved
        ArgumentCaptor<ProductDefinitionEntity> captor = ArgumentCaptor.forClass(ProductDefinitionEntity.class);
        verify(productDefinitionRepository).save(captor.capture());
        ProductDefinitionEntity savedEntity = captor.getValue();
        assertThat(savedEntity.getId()).isEqualTo(existingId);
        assertThat(savedEntity.getProductName()).isEqualTo("Updated Name");
    }

    /**
     * Gap Test 3: Service validates productName is non-blank.
     *
     * Verifies that the service throws IllegalArgumentException when
     * productName is null, empty, or whitespace-only.
     */
    @Test
    @DisplayName("upsert throws IllegalArgumentException when productName is blank")
    void testUpsertThrowsWhenProductNameIsBlank() {
        // Null
        assertThatThrownBy(() -> productDefinitionService.upsert(testProjectId, null))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("Product name is required");

        // Empty
        assertThatThrownBy(() -> productDefinitionService.upsert(testProjectId, ""))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("Product name is required");

        // Whitespace only
        assertThatThrownBy(() -> productDefinitionService.upsert(testProjectId, "   "))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("Product name is required");

        // Verify repository was never called
        verify(productDefinitionRepository, never()).save(any());
    }
}
