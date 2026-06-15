package com.example.architecturemodel.mapper;

import com.example.architecturemodel.model.dto.entity.DataEntityPointDto;
import com.example.architecturemodel.model.entity.DataEntityPointEntity;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for DataEntityPoint DTO and Entity mappings in EntityMapper.
 *
 * Tests bidirectional mapping between DataEntityPointDto and DataEntityPointEntity.
 *
 * Spec: Data Entity Point Superclass
 */
class DataEntityPointMapperTest {

    private EntityMapper entityMapper;

    @BeforeEach
    void setUp() {
        entityMapper = new EntityMapper();
    }

    @Test
    void testToDtoCorrectlyMapsAllEntityFields() {
        // Given: A complete DataEntityPointEntity
        DataEntityPointEntity entity = DataEntityPointEntity.builder()
            .id("dep_log_customer-entity")
            .modelFileId("model-file-123")
            .pointKind("LOGICAL_ENTITY")
            .logicalEntityId("logical-entity-customer")
            .physicalEntityId(null)
            .description("Point for Customer entity")
            .tags("domain:customer,type:core")
            .validFrom("2024-01-01")
            .validTo("2025-12-31")
            .build();

        // When: Map to DTO
        DataEntityPointDto dto = entityMapper.toDto(entity);

        // Then: All fields are correctly mapped
        assertThat(dto.id()).isEqualTo("dep_log_customer-entity");
        assertThat(dto.pointKind()).isEqualTo("LOGICAL_ENTITY");
        assertThat(dto.logicalEntityId()).isEqualTo("logical-entity-customer");
        assertThat(dto.physicalEntityId()).isNull();
        assertThat(dto.description()).isEqualTo("Point for Customer entity");
        assertThat(dto.tags()).isEqualTo("domain:customer,type:core");
        assertThat(dto.validFrom()).isEqualTo("2024-01-01");
        assertThat(dto.validTo()).isEqualTo("2025-12-31");
    }

    @Test
    void testToEntityCorrectlyMapsAllDtoFieldsWithModelFileId() {
        // Given: A complete DataEntityPointDto
        DataEntityPointDto dto = new DataEntityPointDto(
            "dep_phy_orders-table",
            "PHYSICAL_ENTITY",
            null,
            "physical-entity-orders",
            "Point for Orders table",
            "persistence:sql",
            "2024-06-01",
            null
        );
        String modelFileId = "model-file-456";

        // When: Map to Entity
        DataEntityPointEntity entity = entityMapper.toEntity(dto, modelFileId);

        // Then: All fields are correctly mapped including modelFileId
        assertThat(entity.getId()).isEqualTo("dep_phy_orders-table");
        assertThat(entity.getModelFileId()).isEqualTo("model-file-456");
        assertThat(entity.getPointKind()).isEqualTo("PHYSICAL_ENTITY");
        assertThat(entity.getLogicalEntityId()).isNull();
        assertThat(entity.getPhysicalEntityId()).isEqualTo("physical-entity-orders");
        assertThat(entity.getDescription()).isEqualTo("Point for Orders table");
        assertThat(entity.getTags()).isEqualTo("persistence:sql");
        assertThat(entity.getValidFrom()).isEqualTo("2024-06-01");
        assertThat(entity.getValidTo()).isNull();
    }

    @Test
    void testNullHandlingForOptionalFields() {
        // Given: A minimal DataEntityPointEntity with only required fields
        DataEntityPointEntity entity = DataEntityPointEntity.builder()
            .id("dep_log_minimal")
            .modelFileId("model-file-789")
            .pointKind("LOGICAL_ENTITY")
            .logicalEntityId("logical-entity-minimal")
            .physicalEntityId(null)
            .description(null)  // optional
            .tags(null)         // optional
            .validFrom(null)    // optional
            .validTo(null)      // optional
            .build();

        // When: Map to DTO
        DataEntityPointDto dto = entityMapper.toDto(entity);

        // Then: Optional fields are null
        assertThat(dto.id()).isEqualTo("dep_log_minimal");
        assertThat(dto.pointKind()).isEqualTo("LOGICAL_ENTITY");
        assertThat(dto.logicalEntityId()).isEqualTo("logical-entity-minimal");
        assertThat(dto.physicalEntityId()).isNull();
        assertThat(dto.description()).isNull();
        assertThat(dto.tags()).isNull();
        assertThat(dto.validFrom()).isNull();
        assertThat(dto.validTo()).isNull();
    }

    @Test
    void testBidirectionalMappingRoundTrip() {
        // Given: An original entity
        DataEntityPointEntity originalEntity = DataEntityPointEntity.builder()
            .id("dep_log_roundtrip")
            .modelFileId("model-file-rt")
            .pointKind("LOGICAL_ENTITY")
            .logicalEntityId("logical-rt")
            .physicalEntityId(null)
            .description("Round trip test")
            .tags("test:roundtrip")
            .validFrom("2024-01-01")
            .validTo("2024-12-31")
            .build();

        // When: Map entity -> dto -> entity
        DataEntityPointDto dto = entityMapper.toDto(originalEntity);
        DataEntityPointEntity reconstructedEntity = entityMapper.toEntity(dto, "model-file-rt");

        // Then: Reconstructed entity has same values (except modelFileId must be passed separately)
        assertThat(reconstructedEntity.getId()).isEqualTo(originalEntity.getId());
        assertThat(reconstructedEntity.getModelFileId()).isEqualTo(originalEntity.getModelFileId());
        assertThat(reconstructedEntity.getPointKind()).isEqualTo(originalEntity.getPointKind());
        assertThat(reconstructedEntity.getLogicalEntityId()).isEqualTo(originalEntity.getLogicalEntityId());
        assertThat(reconstructedEntity.getPhysicalEntityId()).isEqualTo(originalEntity.getPhysicalEntityId());
        assertThat(reconstructedEntity.getDescription()).isEqualTo(originalEntity.getDescription());
        assertThat(reconstructedEntity.getTags()).isEqualTo(originalEntity.getTags());
        assertThat(reconstructedEntity.getValidFrom()).isEqualTo(originalEntity.getValidFrom());
        assertThat(reconstructedEntity.getValidTo()).isEqualTo(originalEntity.getValidTo());
    }
}
