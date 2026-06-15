package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.dto.entity.UICharacteristicDto;
import com.example.architecturemodel.model.entity.ModelFileEntity;
import com.example.architecturemodel.model.entity.UICharacteristicEntity;
import com.example.architecturemodel.repository.ModelFileRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Repository integration tests for UICharacteristicRepository.
 *
 * Tests CRUD operations for the ui_characteristics table.
 *
 * Spec: UI Characteristics
 */
@DataJpaTest
@ActiveProfiles("test")
class UICharacteristicRepositoryTest {

    @Autowired
    private UICharacteristicRepository uiCharacteristicRepository;

    @Autowired
    private ModelFileRepository modelFileRepository;

    private String modelFileId;

    @BeforeEach
    void setUp() {
        // Create a model file for FK constraint
        ModelFileEntity modelFile = ModelFileEntity.builder()
            .id("test-model-file-id")
            .filename("test-model.json")
            .isDefault(false)
            .createdAt(OffsetDateTime.now())
            .updatedAt(OffsetDateTime.now())
            .build();
        modelFileRepository.save(modelFile);
        modelFileId = modelFile.getId();
    }

    @Test
    void testEntityCreationAndFieldMapping() {
        // Given: A UI characteristic entity with all fields populated
        UICharacteristicEntity entity = UICharacteristicEntity.builder()
            .id("ui-char-1")
            .modelFileId(modelFileId)
            .uiId("app-point-1")
            .type("business_feature")
            .key("customer_management")
            .name("Customer Management Feature")
            .description("Allows users to manage customer records")
            .evidence("Based on user story US-123")
            .build();

        // When: Save the entity
        uiCharacteristicRepository.save(entity);

        // Then: Can retrieve and verify all fields
        Optional<UICharacteristicEntity> found = uiCharacteristicRepository.findById("ui-char-1");
        assertThat(found).isPresent();
        UICharacteristicEntity retrieved = found.get();
        assertThat(retrieved.getId()).isEqualTo("ui-char-1");
        assertThat(retrieved.getModelFileId()).isEqualTo(modelFileId);
        assertThat(retrieved.getUiId()).isEqualTo("app-point-1");
        assertThat(retrieved.getType()).isEqualTo("business_feature");
        assertThat(retrieved.getKey()).isEqualTo("customer_management");
        assertThat(retrieved.getName()).isEqualTo("Customer Management Feature");
        assertThat(retrieved.getDescription()).isEqualTo("Allows users to manage customer records");
        assertThat(retrieved.getEvidence()).isEqualTo("Based on user story US-123");
    }

    @Test
    void testFindByModelFileIdReturnsCorrectEntities() {
        // Given: Multiple UI characteristics for the same model file
        UICharacteristicEntity entity1 = UICharacteristicEntity.builder()
            .id("ui-char-1")
            .modelFileId(modelFileId)
            .uiId("app-point-1")
            .type("business_feature")
            .name("Feature 1")
            .build();
        UICharacteristicEntity entity2 = UICharacteristicEntity.builder()
            .id("ui-char-2")
            .modelFileId(modelFileId)
            .uiId("app-point-2")
            .type("ui_capability")
            .name("Capability 1")
            .build();
        uiCharacteristicRepository.saveAll(List.of(entity1, entity2));

        // When: Find by model file ID
        List<UICharacteristicEntity> results = uiCharacteristicRepository.findByModelFileId(modelFileId);

        // Then: Both entities are returned
        assertThat(results).hasSize(2);
        assertThat(results).extracting(UICharacteristicEntity::getId)
            .containsExactlyInAnyOrder("ui-char-1", "ui-char-2");
    }

    @Test
    void testDeleteByModelFileIdCascadesProperly() {
        // Given: Multiple UI characteristics
        UICharacteristicEntity entity1 = UICharacteristicEntity.builder()
            .id("ui-char-1")
            .modelFileId(modelFileId)
            .uiId("app-point-1")
            .type("business_feature")
            .name("Feature 1")
            .build();
        UICharacteristicEntity entity2 = UICharacteristicEntity.builder()
            .id("ui-char-2")
            .modelFileId(modelFileId)
            .uiId("app-point-2")
            .type("ui_capability")
            .name("Capability 1")
            .build();
        uiCharacteristicRepository.saveAll(List.of(entity1, entity2));
        assertThat(uiCharacteristicRepository.findByModelFileId(modelFileId)).hasSize(2);

        // When: Delete by model file ID
        uiCharacteristicRepository.deleteByModelFileId(modelFileId);

        // Then: All characteristics are deleted
        assertThat(uiCharacteristicRepository.findByModelFileId(modelFileId)).isEmpty();
    }

    @Test
    void testFindByUiIdFindsCharacteristicsByApplicationPoint() {
        // Given: Multiple UI characteristics with different UI IDs
        UICharacteristicEntity entity1 = UICharacteristicEntity.builder()
            .id("ui-char-1")
            .modelFileId(modelFileId)
            .uiId("app-point-1")
            .type("business_feature")
            .name("Feature 1")
            .build();
        UICharacteristicEntity entity2 = UICharacteristicEntity.builder()
            .id("ui-char-2")
            .modelFileId(modelFileId)
            .uiId("app-point-1")
            .type("ui_capability")
            .name("Capability 1")
            .build();
        UICharacteristicEntity entity3 = UICharacteristicEntity.builder()
            .id("ui-char-3")
            .modelFileId(modelFileId)
            .uiId("app-point-2")
            .type("technical_shape")
            .name("Shape 1")
            .build();
        uiCharacteristicRepository.saveAll(List.of(entity1, entity2, entity3));

        // When: Find by UI ID
        List<UICharacteristicEntity> results = uiCharacteristicRepository.findByUiId("app-point-1");

        // Then: Only characteristics for app-point-1 are returned
        assertThat(results).hasSize(2);
        assertThat(results).extracting(UICharacteristicEntity::getId)
            .containsExactlyInAnyOrder("ui-char-1", "ui-char-2");
    }

    @Test
    void testDtoToEntityAndEntityToDtoMapping() {
        // Given: A DTO with all fields
        UICharacteristicDto dto = new UICharacteristicDto(
            "ui-char-1",
            "app-point-1",
            "interaction_complexity",
            "high_complexity",
            "Complex Interaction",
            "Requires multiple steps",
            "Based on user testing"
        );

        // When: Map DTO to Entity
        UICharacteristicEntity entity = UICharacteristicEntity.builder()
            .id(dto.id())
            .modelFileId(modelFileId)
            .uiId(dto.uiId())
            .type(dto.type())
            .key(dto.key())
            .name(dto.name())
            .description(dto.description())
            .evidence(dto.evidence())
            .build();

        // Save and retrieve
        uiCharacteristicRepository.save(entity);
        UICharacteristicEntity retrieved = uiCharacteristicRepository.findById("ui-char-1").orElseThrow();

        // Then: Map Entity back to DTO and verify
        UICharacteristicDto mappedDto = new UICharacteristicDto(
            retrieved.getId(),
            retrieved.getUiId(),
            retrieved.getType(),
            retrieved.getKey(),
            retrieved.getName(),
            retrieved.getDescription(),
            retrieved.getEvidence()
        );

        assertThat(mappedDto.id()).isEqualTo(dto.id());
        assertThat(mappedDto.uiId()).isEqualTo(dto.uiId());
        assertThat(mappedDto.type()).isEqualTo(dto.type());
        assertThat(mappedDto.key()).isEqualTo(dto.key());
        assertThat(mappedDto.name()).isEqualTo(dto.name());
        assertThat(mappedDto.description()).isEqualTo(dto.description());
        assertThat(mappedDto.evidence()).isEqualTo(dto.evidence());
    }

    @Test
    void testEntityWithNullableFieldsAllowsNullValues() {
        // Given: An entity with only required fields (nullable fields are null)
        UICharacteristicEntity entity = UICharacteristicEntity.builder()
            .id("ui-char-minimal")
            .modelFileId(modelFileId)
            .uiId("app-point-1")
            .type("technical_shape")
            .name("Minimal Characteristic")
            // key, description, and evidence are intentionally null
            .build();

        // When: Save and retrieve
        uiCharacteristicRepository.save(entity);
        UICharacteristicEntity retrieved = uiCharacteristicRepository.findById("ui-char-minimal").orElseThrow();

        // Then: Nullable fields are null
        assertThat(retrieved.getKey()).isNull();
        assertThat(retrieved.getDescription()).isNull();
        assertThat(retrieved.getEvidence()).isNull();
        // Required fields are present
        assertThat(retrieved.getId()).isEqualTo("ui-char-minimal");
        assertThat(retrieved.getModelFileId()).isEqualTo(modelFileId);
        assertThat(retrieved.getUiId()).isEqualTo("app-point-1");
        assertThat(retrieved.getType()).isEqualTo("technical_shape");
        assertThat(retrieved.getName()).isEqualTo("Minimal Characteristic");
    }
}
