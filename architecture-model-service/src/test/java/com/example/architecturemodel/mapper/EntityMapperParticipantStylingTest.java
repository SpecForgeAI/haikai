package com.example.architecturemodel.mapper;

import com.example.architecturemodel.model.dto.entity.ApplicationComponentDto;
import com.example.architecturemodel.model.dto.entity.ApplicationDto;
import com.example.architecturemodel.model.dto.entity.ServiceDto;
import com.example.architecturemodel.model.entity.ApplicationComponentEntity;
import com.example.architecturemodel.model.entity.ApplicationEntity;
import com.example.architecturemodel.model.entity.ServiceEntity;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for EntityMapper methods related to participant styling fields.
 *
 * Tests the mapping of is_internal and tech_type fields for:
 * - ApplicationEntity / ApplicationDto
 * - ApplicationComponentEntity / ApplicationComponentDto
 * - ServiceEntity / ServiceDto
 *
 * Spec: Sequence Diagram Participant Colour and Icons for Services and Components
 */
class EntityMapperParticipantStylingTest {

    private EntityMapper entityMapper;

    @BeforeEach
    void setUp() {
        entityMapper = new EntityMapper();
    }

    // ============================================================================
    // Test 1: toDto(ApplicationEntity) maps isInternal correctly
    // ============================================================================

    @Test
    void toDto_ApplicationEntity_shouldMapIsInternalCorrectly() {
        // Given: An ApplicationEntity with isInternal set to false (external)
        ApplicationEntity entity = ApplicationEntity.builder()
            .id("app-1")
            .modelFileId("model-file-123")
            .name("External CRM System")
            .description("Third-party CRM")
            .appType("Web")
            .status("Active")
            .tags("external,crm")
            .validFrom("2024-01-01")
            .validTo("2025-12-31")
            .isInternal(false)
            .build();

        // When: Map to DTO
        ApplicationDto dto = entityMapper.toDto(entity);

        // Then: isInternal is correctly mapped as false
        assertThat(dto.isInternal()).isFalse();
        assertThat(dto.id()).isEqualTo("app-1");
        assertThat(dto.name()).isEqualTo("External CRM System");
    }

    @Test
    void toDto_ApplicationEntity_shouldMapIsInternalAsTrue() {
        // Given: An ApplicationEntity with isInternal set to true (internal)
        ApplicationEntity entity = ApplicationEntity.builder()
            .id("app-2")
            .modelFileId("model-file-123")
            .name("Internal Order System")
            .isInternal(true)
            .build();

        // When: Map to DTO
        ApplicationDto dto = entityMapper.toDto(entity);

        // Then: isInternal is correctly mapped as true
        assertThat(dto.isInternal()).isTrue();
    }

    @Test
    void toDto_ApplicationEntity_shouldMapNullIsInternal() {
        // Given: An ApplicationEntity with isInternal not set (null)
        ApplicationEntity entity = ApplicationEntity.builder()
            .id("app-3")
            .modelFileId("model-file-123")
            .name("Legacy Application")
            .isInternal(null)
            .build();

        // When: Map to DTO
        ApplicationDto dto = entityMapper.toDto(entity);

        // Then: isInternal is null (default handling happens in toEntity)
        assertThat(dto.isInternal()).isNull();
    }

    // ============================================================================
    // Test 2: toEntity(ApplicationDto) maps isInternal with null default handling
    // ============================================================================

    @Test
    void toEntity_ApplicationDto_shouldMapIsInternalWithNullDefaultHandling() {
        // Given: An ApplicationDto with isInternal as null (missing field)
        ApplicationDto dto = new ApplicationDto(
            "app-null-internal",
            "Legacy App",
            "No is_internal field set",
            "Web",
            "Active",
            "legacy",
            null,
            null,
            null,  // isInternal is null
            null   // abbreviation
        );
        String modelFileId = "model-file-456";

        // When: Map to Entity
        ApplicationEntity entity = entityMapper.toEntity(dto, modelFileId);

        // Then: isInternal defaults to true
        assertThat(entity.getIsInternal()).isTrue();
        assertThat(entity.getId()).isEqualTo("app-null-internal");
        assertThat(entity.getModelFileId()).isEqualTo("model-file-456");
    }

    @Test
    void toEntity_ApplicationDto_shouldPreserveExplicitFalse() {
        // Given: An ApplicationDto with isInternal explicitly set to false
        ApplicationDto dto = new ApplicationDto(
            "app-external",
            "External System",
            "Third-party system",
            "Web",
            "Active",
            null,
            null,
            null,
            false,  // explicitly external
            null    // abbreviation
        );
        String modelFileId = "model-file-789";

        // When: Map to Entity
        ApplicationEntity entity = entityMapper.toEntity(dto, modelFileId);

        // Then: isInternal is preserved as false
        assertThat(entity.getIsInternal()).isFalse();
    }

    @Test
    void toEntity_ApplicationDto_shouldPreserveExplicitTrue() {
        // Given: An ApplicationDto with isInternal explicitly set to true
        ApplicationDto dto = new ApplicationDto(
            "app-internal",
            "Internal System",
            "Company system",
            "Web",
            "Active",
            null,
            null,
            null,
            true,  // explicitly internal
            null   // abbreviation
        );

        // When: Map to Entity
        ApplicationEntity entity = entityMapper.toEntity(dto, "model-file-abc");

        // Then: isInternal is preserved as true
        assertThat(entity.getIsInternal()).isTrue();
    }

    // ============================================================================
    // Test 3: toDto(ApplicationComponentEntity) maps isInternal and techType
    // ============================================================================

    @Test
    void toDto_ApplicationComponentEntity_shouldMapIsInternalAndTechType() {
        // Given: An ApplicationComponentEntity with both new fields set
        ApplicationComponentEntity entity = ApplicationComponentEntity.builder()
            .id("comp-ui-1")
            .modelFileId("model-file-123")
            .applicationId("app-1")
            .name("Customer Portal UI")
            .description("Frontend UI component")
            .tags("ui,frontend")
            .validFrom("2024-01-01")
            .validTo(null)
            .isInternal(true)
            .techType("UI Tier")
            .build();

        // When: Map to DTO
        ApplicationComponentDto dto = entityMapper.toDto(entity);

        // Then: Both fields are correctly mapped
        assertThat(dto.isInternal()).isTrue();
        assertThat(dto.techType()).isEqualTo("UI Tier");
        assertThat(dto.id()).isEqualTo("comp-ui-1");
        assertThat(dto.name()).isEqualTo("Customer Portal UI");
    }

    @Test
    void toDto_ApplicationComponentEntity_shouldMapExternalWithPersistenceTier() {
        // Given: An external persistence tier component
        ApplicationComponentEntity entity = ApplicationComponentEntity.builder()
            .id("comp-db-ext")
            .modelFileId("model-file-123")
            .applicationId("app-external")
            .name("External Database")
            .isInternal(false)
            .techType("Persistence Tier")
            .build();

        // When: Map to DTO
        ApplicationComponentDto dto = entityMapper.toDto(entity);

        // Then: Both fields are correctly mapped
        assertThat(dto.isInternal()).isFalse();
        assertThat(dto.techType()).isEqualTo("Persistence Tier");
    }

    @Test
    void toDto_ApplicationComponentEntity_shouldMapServiceTier() {
        // Given: A service tier component
        ApplicationComponentEntity entity = ApplicationComponentEntity.builder()
            .id("comp-svc-1")
            .modelFileId("model-file-123")
            .applicationId("app-1")
            .name("Order Processing Service")
            .isInternal(true)
            .techType("Service Tier")
            .build();

        // When: Map to DTO
        ApplicationComponentDto dto = entityMapper.toDto(entity);

        // Then: techType is correctly mapped
        assertThat(dto.isInternal()).isTrue();
        assertThat(dto.techType()).isEqualTo("Service Tier");
    }

    @Test
    void toDto_ApplicationComponentEntity_shouldMapNullFields() {
        // Given: A component with null values for new fields
        ApplicationComponentEntity entity = ApplicationComponentEntity.builder()
            .id("comp-legacy")
            .modelFileId("model-file-123")
            .applicationId("app-legacy")
            .name("Legacy Component")
            .isInternal(null)
            .techType(null)
            .build();

        // When: Map to DTO
        ApplicationComponentDto dto = entityMapper.toDto(entity);

        // Then: Null values are preserved in DTO
        assertThat(dto.isInternal()).isNull();
        assertThat(dto.techType()).isNull();
    }

    @Test
    void toEntity_ApplicationComponentDto_shouldApplyDefaultsForNullFields() {
        // Given: A DTO with null values for new fields (backward compatibility)
        ApplicationComponentDto dto = new ApplicationComponentDto(
            "comp-null-fields",
            "Legacy Component",
            "No new fields set",
            "app-legacy",
            null,
            null,
            null,
            null,  // isInternal is null
            null   // techType is null
        );

        // When: Map to Entity
        ApplicationComponentEntity entity = entityMapper.toEntity(dto, "model-file-xyz");

        // Then: Defaults are applied (isInternal=true, techType="Other")
        assertThat(entity.getIsInternal()).isTrue();
        assertThat(entity.getTechType()).isEqualTo("Other");
    }

    @Test
    void toEntity_ApplicationComponentDto_shouldPreserveExplicitValues() {
        // Given: A DTO with explicit values for new fields
        ApplicationComponentDto dto = new ApplicationComponentDto(
            "comp-explicit",
            "External UI Component",
            "Third-party UI",
            "app-external",
            null,
            null,
            null,
            false,          // explicitly external
            "UI Tier"       // explicitly UI Tier
        );

        // When: Map to Entity
        ApplicationComponentEntity entity = entityMapper.toEntity(dto, "model-file-abc");

        // Then: Explicit values are preserved
        assertThat(entity.getIsInternal()).isFalse();
        assertThat(entity.getTechType()).isEqualTo("UI Tier");
    }

    // ============================================================================
    // Test 4: toDto(ServiceEntity) maps isInternal correctly
    // ============================================================================

    @Test
    void toDto_ServiceEntity_shouldMapIsInternalCorrectly() {
        // Given: A ServiceEntity with isInternal set to false (external)
        ServiceEntity entity = ServiceEntity.builder()
            .id("svc-external")
            .modelFileId("model-file-123")
            .applicationId("app-1")
            .applicationComponentId("comp-1")
            .name("External Payment Gateway")
            .description("Third-party payment service")
            .serviceType("REST")
            .coreTech("Java")
            .tags("external,payment")
            .validFrom("2024-01-01")
            .validTo(null)
            .packageSetId(null)
            .isInternal(false)
            .build();

        // When: Map to DTO
        ServiceDto dto = entityMapper.toDto(entity);

        // Then: isInternal is correctly mapped as false
        assertThat(dto.isInternal()).isFalse();
        assertThat(dto.id()).isEqualTo("svc-external");
        assertThat(dto.name()).isEqualTo("External Payment Gateway");
    }

    @Test
    void toDto_ServiceEntity_shouldMapIsInternalAsTrue() {
        // Given: A ServiceEntity with isInternal set to true (internal)
        ServiceEntity entity = ServiceEntity.builder()
            .id("svc-internal")
            .modelFileId("model-file-123")
            .applicationId("app-1")
            .name("Order Service")
            .isInternal(true)
            .build();

        // When: Map to DTO
        ServiceDto dto = entityMapper.toDto(entity);

        // Then: isInternal is correctly mapped as true
        assertThat(dto.isInternal()).isTrue();
    }

    @Test
    void toDto_ServiceEntity_shouldMapNullIsInternal() {
        // Given: A ServiceEntity with isInternal not set (null - legacy data)
        ServiceEntity entity = ServiceEntity.builder()
            .id("svc-legacy")
            .modelFileId("model-file-123")
            .applicationId("app-1")
            .name("Legacy Service")
            .isInternal(null)
            .build();

        // When: Map to DTO
        ServiceDto dto = entityMapper.toDto(entity);

        // Then: isInternal is null (default handling happens in toEntity)
        assertThat(dto.isInternal()).isNull();
    }

    @Test
    void toEntity_ServiceDto_shouldApplyDefaultForNullIsInternal() {
        // Given: A ServiceDto with null isInternal (backward compatibility)
        ServiceDto dto = new ServiceDto(
            "svc-null-internal",
            "Legacy Service",
            "No is_internal field set",
            "app-legacy",
            null,
            "REST",
            "Java",
            null,  // repoLocation
            null,  // repoSubfolder
            null,
            null,
            null,
            null,
            null,  // isInternal is null
            null,  // coreTechResolved
            null,  // coreTechLanguagePack
            null,  // coreTechFrameworkPacks
            null,  // coreTechResolutionConfidence
            null   // coreTechResolvedAt
        );

        // When: Map to Entity
        ServiceEntity entity = entityMapper.toEntity(dto, "model-file-xyz");

        // Then: isInternal defaults to true
        assertThat(entity.getIsInternal()).isTrue();
        assertThat(entity.getId()).isEqualTo("svc-null-internal");
    }

    @Test
    void toEntity_ServiceDto_shouldPreserveExplicitFalse() {
        // Given: A ServiceDto with isInternal explicitly set to false
        ServiceDto dto = new ServiceDto(
            "svc-external-explicit",
            "External API",
            "Third-party integration",
            "app-1",
            "comp-1",
            "REST",
            "Python",
            null,  // repoLocation
            null,  // repoSubfolder
            null,
            null,
            null,
            null,
            false,  // explicitly external
            null,   // coreTechResolved
            null,   // coreTechLanguagePack
            null,   // coreTechFrameworkPacks
            null,   // coreTechResolutionConfidence
            null    // coreTechResolvedAt
        );

        // When: Map to Entity
        ServiceEntity entity = entityMapper.toEntity(dto, "model-file-abc");

        // Then: isInternal is preserved as false
        assertThat(entity.getIsInternal()).isFalse();
    }

    // ============================================================================
    // Round-trip Tests for Backward Compatibility
    // ============================================================================

    @Test
    void roundTrip_ApplicationWithIsInternal_shouldPreserveValue() {
        // Given: An ApplicationEntity with isInternal set
        ApplicationEntity originalEntity = ApplicationEntity.builder()
            .id("app-rt")
            .modelFileId("model-file-rt")
            .name("Round Trip App")
            .description("Test round trip")
            .appType("Web")
            .status("Active")
            .tags("test")
            .validFrom("2024-01-01")
            .validTo("2025-12-31")
            .isInternal(false)
            .build();

        // When: Round trip entity -> dto -> entity
        ApplicationDto dto = entityMapper.toDto(originalEntity);
        ApplicationEntity reconstructed = entityMapper.toEntity(dto, "model-file-rt");

        // Then: isInternal is preserved
        assertThat(reconstructed.getIsInternal()).isEqualTo(originalEntity.getIsInternal());
    }

    @Test
    void roundTrip_ApplicationComponentWithNewFields_shouldPreserveValues() {
        // Given: An ApplicationComponentEntity with new fields set
        ApplicationComponentEntity originalEntity = ApplicationComponentEntity.builder()
            .id("comp-rt")
            .modelFileId("model-file-rt")
            .applicationId("app-1")
            .name("Round Trip Component")
            .description("Test round trip")
            .tags("test")
            .validFrom("2024-01-01")
            .validTo(null)
            .isInternal(false)
            .techType("Persistence Tier")
            .build();

        // When: Round trip entity -> dto -> entity
        ApplicationComponentDto dto = entityMapper.toDto(originalEntity);
        ApplicationComponentEntity reconstructed = entityMapper.toEntity(dto, "model-file-rt");

        // Then: Both new fields are preserved
        assertThat(reconstructed.getIsInternal()).isEqualTo(originalEntity.getIsInternal());
        assertThat(reconstructed.getTechType()).isEqualTo(originalEntity.getTechType());
    }

    @Test
    void roundTrip_ServiceWithIsInternal_shouldPreserveValue() {
        // Given: A ServiceEntity with isInternal set
        ServiceEntity originalEntity = ServiceEntity.builder()
            .id("svc-rt")
            .modelFileId("model-file-rt")
            .applicationId("app-1")
            .applicationComponentId("comp-1")
            .name("Round Trip Service")
            .description("Test round trip")
            .serviceType("REST")
            .coreTech("Java")
            .tags("test")
            .validFrom("2024-01-01")
            .validTo(null)
            .packageSetId("pkg-1")
            .isInternal(false)
            .build();

        // When: Round trip entity -> dto -> entity
        ServiceDto dto = entityMapper.toDto(originalEntity);
        ServiceEntity reconstructed = entityMapper.toEntity(dto, "model-file-rt");

        // Then: isInternal is preserved
        assertThat(reconstructed.getIsInternal()).isEqualTo(originalEntity.getIsInternal());
    }
}
