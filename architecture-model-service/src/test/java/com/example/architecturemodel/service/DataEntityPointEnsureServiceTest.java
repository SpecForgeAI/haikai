package com.example.architecturemodel.service;

import com.example.architecturemodel.model.dto.entity.LogicalDataEntityDto;
import com.example.architecturemodel.model.dto.entity.PhysicalDataEntityDto;
import com.example.architecturemodel.model.entity.DataEntityPointEntity;
import com.example.architecturemodel.repository.entity.DataEntityPointRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Collections;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/**
 * Unit tests for DataEntityPointEnsureService.
 *
 * Tests the ensure service for automatic creation of Data Entity Points.
 *
 * Spec: Data Entity Point Superclass
 */
@ExtendWith(MockitoExtension.class)
class DataEntityPointEnsureServiceTest {

    @Mock
    private DataEntityPointRepository dataEntityPointRepository;

    @InjectMocks
    private DataEntityPointEnsureService ensureService;

    private static final String MODEL_FILE_ID = "test-model-file-id";

    @BeforeEach
    void setUp() {
        // Reset mocks before each test
    }

    @Test
    void testCreatesDepLogIdForLogicalEntity() {
        // Given: A logical entity
        LogicalDataEntityDto logicalEntity = new LogicalDataEntityDto(
            "logical-entity-customer",
            "Customer",
            "Customer entity",
            "domain:customer",
            null,
            null,
            null
        );

        when(dataEntityPointRepository.findByModelFileIdAndLogicalEntityId(MODEL_FILE_ID, "logical-entity-customer"))
            .thenReturn(Optional.empty());
        when(dataEntityPointRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        // When: Ensure data entity points
        List<DataEntityPointEntity> results = ensureService.ensureDataEntityPoints(
            MODEL_FILE_ID,
            List.of(logicalEntity),
            null
        );

        // Then: Point is created with dep_log_ prefix
        assertThat(results).hasSize(1);
        assertThat(results.get(0).getId()).isEqualTo("dep_log_logical-entity-customer");
        assertThat(results.get(0).getPointKind()).isEqualTo("LOGICAL_ENTITY");
        assertThat(results.get(0).getLogicalEntityId()).isEqualTo("logical-entity-customer");
        assertThat(results.get(0).getPhysicalEntityId()).isNull();

        // Verify save was called
        ArgumentCaptor<DataEntityPointEntity> captor = ArgumentCaptor.forClass(DataEntityPointEntity.class);
        verify(dataEntityPointRepository).save(captor.capture());
        assertThat(captor.getValue().getId()).startsWith("dep_log_");
    }

    @Test
    void testCreatesDepPhyIdForPhysicalEntity() {
        // Given: A physical entity
        PhysicalDataEntityDto physicalEntity = new PhysicalDataEntityDto(
            "physical-entity-orders",
            "orders_table",
            "Orders table",
            "TABLE",
            "postgres",
            "persistence:sql",
            null,
            null,
            null
        , null, null);

        when(dataEntityPointRepository.findByModelFileIdAndPhysicalEntityId(MODEL_FILE_ID, "physical-entity-orders"))
            .thenReturn(Optional.empty());
        when(dataEntityPointRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        // When: Ensure data entity points
        List<DataEntityPointEntity> results = ensureService.ensureDataEntityPoints(
            MODEL_FILE_ID,
            null,
            List.of(physicalEntity)
        );

        // Then: Point is created with dep_phy_ prefix
        assertThat(results).hasSize(1);
        assertThat(results.get(0).getId()).isEqualTo("dep_phy_physical-entity-orders");
        assertThat(results.get(0).getPointKind()).isEqualTo("PHYSICAL_ENTITY");
        assertThat(results.get(0).getLogicalEntityId()).isNull();
        assertThat(results.get(0).getPhysicalEntityId()).isEqualTo("physical-entity-orders");

        // Verify save was called
        ArgumentCaptor<DataEntityPointEntity> captor = ArgumentCaptor.forClass(DataEntityPointEntity.class);
        verify(dataEntityPointRepository).save(captor.capture());
        assertThat(captor.getValue().getId()).startsWith("dep_phy_");
    }

    @Test
    void testIdempotencyRunningTwiceProducesSameResult() {
        // Given: A logical entity
        LogicalDataEntityDto logicalEntity = new LogicalDataEntityDto(
            "logical-entity-idempotent",
            "IdempotentEntity",
            "Test entity",
            null,
            null,
            null,
            null
        );

        // Existing point in DB
        DataEntityPointEntity existingPoint = DataEntityPointEntity.builder()
            .id("dep_log_logical-entity-idempotent")
            .modelFileId(MODEL_FILE_ID)
            .pointKind("LOGICAL_ENTITY")
            .logicalEntityId("logical-entity-idempotent")
            .physicalEntityId(null)
            .build();

        // First call - point doesn't exist
        when(dataEntityPointRepository.findByModelFileIdAndLogicalEntityId(MODEL_FILE_ID, "logical-entity-idempotent"))
            .thenReturn(Optional.empty())
            .thenReturn(Optional.of(existingPoint)); // Second call - point exists

        when(dataEntityPointRepository.save(any())).thenReturn(existingPoint);

        // When: Run twice
        List<DataEntityPointEntity> results1 = ensureService.ensureDataEntityPoints(
            MODEL_FILE_ID,
            List.of(logicalEntity),
            null
        );

        List<DataEntityPointEntity> results2 = ensureService.ensureDataEntityPoints(
            MODEL_FILE_ID,
            List.of(logicalEntity),
            null
        );

        // Then: Both produce same result
        assertThat(results1).hasSize(1);
        assertThat(results2).hasSize(1);
        assertThat(results1.get(0).getId()).isEqualTo(results2.get(0).getId());

        // Verify save was only called once (second time uses existing)
        verify(dataEntityPointRepository, times(1)).save(any());
    }

    @Test
    void testDoesNotRecreateExistingPoints() {
        // Given: A logical entity with existing point
        LogicalDataEntityDto logicalEntity = new LogicalDataEntityDto(
            "logical-entity-existing",
            "ExistingEntity",
            "Test entity",
            null,
            null,
            null,
            null
        );

        DataEntityPointEntity existingPoint = DataEntityPointEntity.builder()
            .id("dep_log_logical-entity-existing")
            .modelFileId(MODEL_FILE_ID)
            .pointKind("LOGICAL_ENTITY")
            .logicalEntityId("logical-entity-existing")
            .physicalEntityId(null)
            .build();

        when(dataEntityPointRepository.findByModelFileIdAndLogicalEntityId(MODEL_FILE_ID, "logical-entity-existing"))
            .thenReturn(Optional.of(existingPoint));

        // When: Ensure data entity points
        List<DataEntityPointEntity> results = ensureService.ensureDataEntityPoints(
            MODEL_FILE_ID,
            List.of(logicalEntity),
            null
        );

        // Then: Returns existing point, no save called
        assertThat(results).hasSize(1);
        assertThat(results.get(0)).isEqualTo(existingPoint);

        verify(dataEntityPointRepository, never()).save(any());
    }

    @Test
    void testHandlesEmptyEntityListsGracefully() {
        // When: Ensure data entity points with empty lists
        List<DataEntityPointEntity> results1 = ensureService.ensureDataEntityPoints(
            MODEL_FILE_ID,
            Collections.emptyList(),
            Collections.emptyList()
        );

        List<DataEntityPointEntity> results2 = ensureService.ensureDataEntityPoints(
            MODEL_FILE_ID,
            null,
            null
        );

        // Then: Returns empty list
        assertThat(results1).isEmpty();
        assertThat(results2).isEmpty();

        verify(dataEntityPointRepository, never()).save(any());
    }

    @Test
    void testThrowsExceptionIfPointExistsWithBothFKsSet() {
        // Given: A logical entity
        LogicalDataEntityDto logicalEntity = new LogicalDataEntityDto(
            "logical-entity-invalid",
            "InvalidEntity",
            "Test entity",
            null,
            null,
            null,
            null
        );

        // Invalid existing point with BOTH FKs set
        DataEntityPointEntity invalidPoint = DataEntityPointEntity.builder()
            .id("dep_log_logical-entity-invalid")
            .modelFileId(MODEL_FILE_ID)
            .pointKind("LOGICAL_ENTITY")
            .logicalEntityId("logical-entity-invalid")
            .physicalEntityId("some-physical-id")  // INVALID: both FKs set
            .build();

        when(dataEntityPointRepository.findByModelFileIdAndLogicalEntityId(MODEL_FILE_ID, "logical-entity-invalid"))
            .thenReturn(Optional.of(invalidPoint));

        // When/Then: Should throw exception
        assertThatThrownBy(() -> ensureService.ensureDataEntityPoints(
            MODEL_FILE_ID,
            List.of(logicalEntity),
            null
        ))
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("Data Entity Point invariant violation")
            .hasMessageContaining("both logical_entity_id and physical_entity_id are set");
    }

    @Test
    void testProcessesMultipleEntitiesOfBothTypes() {
        // Given: Multiple logical and physical entities
        LogicalDataEntityDto logical1 = new LogicalDataEntityDto(
            "log-1", "Entity1", "Desc 1", null, null, null,
            null
        );
        LogicalDataEntityDto logical2 = new LogicalDataEntityDto(
            "log-2", "Entity2", "Desc 2", null, null, null,
            null
        );
        PhysicalDataEntityDto physical1 = new PhysicalDataEntityDto(
            "phy-1", "Table1", "Desc 1", "TABLE", "db", null, null, null, null
        , null, null);

        when(dataEntityPointRepository.findByModelFileIdAndLogicalEntityId(any(), any()))
            .thenReturn(Optional.empty());
        when(dataEntityPointRepository.findByModelFileIdAndPhysicalEntityId(any(), any()))
            .thenReturn(Optional.empty());
        when(dataEntityPointRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        // When: Ensure data entity points
        List<DataEntityPointEntity> results = ensureService.ensureDataEntityPoints(
            MODEL_FILE_ID,
            List.of(logical1, logical2),
            List.of(physical1)
        );

        // Then: Three points created
        assertThat(results).hasSize(3);

        // Verify IDs
        assertThat(results.stream().map(DataEntityPointEntity::getId))
            .containsExactlyInAnyOrder("dep_log_log-1", "dep_log_log-2", "dep_phy_phy-1");

        // Verify save was called 3 times
        verify(dataEntityPointRepository, times(3)).save(any());
    }
}
