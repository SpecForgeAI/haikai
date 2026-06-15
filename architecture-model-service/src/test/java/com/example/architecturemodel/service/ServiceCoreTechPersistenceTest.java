package com.example.architecturemodel.service;

import com.example.architecturemodel.model.dto.entity.ServiceDto;
import com.example.architecturemodel.model.entity.ServiceEntity;
import com.example.architecturemodel.mapper.EntityMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Tests for Service core_tech column persistence.
 *
 * Spec: Add Service.Core Tech Column and Change Service Type to Free-Text
 * Task Group 1: Database Migration tests
 * Task Group 2: JPA Entity and DTO tests
 */
class ServiceCoreTechPersistenceTest {

    private EntityMapper entityMapper;

    @BeforeEach
    void setUp() {
        entityMapper = new EntityMapper();
    }

    // ============================================================================
    // Task Group 1: Database Migration Tests (2 tests)
    // ============================================================================

    /**
     * Test 1.1: Verify core_tech field is included in ServiceEntity to ServiceDto conversion.
     * This verifies that the coreTech field is properly mapped when converting entity to DTO.
     */
    @Test
    @DisplayName("Test 1.1: ServiceEntity with coreTech maps to ServiceDto with core_tech")
    void testServiceEntityWithCoreTechMapsToDto() {
        // Given: A ServiceEntity with coreTech populated
        ServiceEntity entity = ServiceEntity.builder()
                .id("svc-001")
                .modelFileId("model-001")
                .applicationId("app-001")
                .applicationComponentId("comp-001")
                .name("Order Service")
                .description("Handles order processing")
                .serviceType("Backend")
                .coreTech("Java, Spring Boot, PostgreSQL")
                .tags("backend,orders")
                .validFrom("2026-Q1")
                .validTo(null)
                .build();

        // When: Converting to DTO
        ServiceDto dto = entityMapper.toDto(entity);

        // Then: The core_tech field should be populated
        assertNotNull(dto, "DTO should not be null");
        assertEquals("svc-001", dto.id());
        assertEquals("Order Service", dto.name());
        assertEquals("Java, Spring Boot, PostgreSQL", dto.coreTech(),
                "coreTech should be mapped from entity to DTO");
    }

    /**
     * Test 1.2: Verify null core_tech is handled gracefully.
     * This verifies that when coreTech is null, the mapping handles it without errors.
     */
    @Test
    @DisplayName("Test 1.2: ServiceEntity with null coreTech maps to ServiceDto with null core_tech")
    void testServiceEntityWithNullCoreTechMapsToDto() {
        // Given: A ServiceEntity with coreTech as null
        ServiceEntity entity = ServiceEntity.builder()
                .id("svc-002")
                .modelFileId("model-001")
                .applicationId("app-001")
                .name("Legacy Service")
                .description("A legacy service")
                .serviceType("Legacy")
                .coreTech(null)  // null coreTech
                .tags("legacy")
                .build();

        // When: Converting to DTO
        ServiceDto dto = entityMapper.toDto(entity);

        // Then: The core_tech field should be null
        assertNotNull(dto, "DTO should not be null");
        assertNull(dto.coreTech(), "coreTech should be null when not set");
    }

    // ============================================================================
    // Task Group 2: JPA Entity and DTO Tests (3 tests)
    // ============================================================================

    /**
     * Test 2.1: Verify ServiceDto with core_tech maps to ServiceEntity with coreTech.
     * This verifies that the core_tech JSON property maps correctly to the entity field.
     */
    @Test
    @DisplayName("Test 2.1: ServiceDto with core_tech maps to ServiceEntity with coreTech")
    void testServiceDtoWithCoreTechMapsToEntity() {
        // Given: A ServiceDto with core_tech populated
        ServiceDto dto = new ServiceDto(
                "svc-003",
                "Payment Service",
                "Handles payments",
                "app-001",
                "comp-001",
                "Microservice",
                "Kotlin, Ktor, Redis",
                null,  // repoLocation
                null,  // repoSubfolder
                "payments,finance",
                "2026-Q2",
                null,
                null,
                null,
                null, null, null, null, null  // 5 new resolved fields
        );

        // When: Converting to entity
        ServiceEntity entity = entityMapper.toEntity(dto, "model-001");

        // Then: The coreTech field should be populated
        assertNotNull(entity, "Entity should not be null");
        assertEquals("svc-003", entity.getId());
        assertEquals("Payment Service", entity.getName());
        assertEquals("Kotlin, Ktor, Redis", entity.getCoreTech(),
                "coreTech should be mapped from DTO to entity");
        assertEquals("model-001", entity.getModelFileId());
    }

    /**
     * Test 2.2: Verify round-trip conversion preserves core_tech field.
     * This verifies that converting DTO -> Entity -> DTO preserves all data.
     */
    @Test
    @DisplayName("Test 2.2: Round-trip DTO -> Entity -> DTO preserves core_tech")
    void testRoundTripPreservesCoreTech() {
        // Given: A ServiceDto with all fields populated
        ServiceDto originalDto = new ServiceDto(
                "svc-004",
                "Analytics Service",
                "Data analytics",
                "app-002",
                null,  // no component
                "Data Processing",
                "Python, FastAPI, ClickHouse",
                null,  // repoLocation
                null,  // repoSubfolder
                "analytics,data",
                "2026-Q1",
                "2027-Q4",
                null,
                null,
                null, null, null, null, null  // 5 new resolved fields
        );

        // When: Converting to entity and back to DTO
        ServiceEntity entity = entityMapper.toEntity(originalDto, "model-002");
        ServiceDto roundTripDto = entityMapper.toDto(entity);

        // Then: All fields should be preserved
        assertEquals(originalDto.id(), roundTripDto.id());
        assertEquals(originalDto.name(), roundTripDto.name());
        assertEquals(originalDto.description(), roundTripDto.description());
        assertEquals(originalDto.applicationId(), roundTripDto.applicationId());
        assertEquals(originalDto.appComponentId(), roundTripDto.appComponentId());
        assertEquals(originalDto.serviceType(), roundTripDto.serviceType());
        assertEquals(originalDto.coreTech(), roundTripDto.coreTech(),
                "core_tech should be preserved through round-trip conversion");
        assertEquals(originalDto.tags(), roundTripDto.tags());
        assertEquals(originalDto.validFrom(), roundTripDto.validFrom());
        assertEquals(originalDto.validTo(), roundTripDto.validTo());
    }

    /**
     * Test 2.3: Verify ServiceEntity builder includes coreTech field.
     * This verifies that the Lombok @Builder annotation includes the new field.
     */
    @Test
    @DisplayName("Test 2.3: ServiceEntity builder supports coreTech field")
    void testServiceEntityBuilderSupportsCoreTech() {
        // Given/When: Building a ServiceEntity with coreTech
        ServiceEntity entity = ServiceEntity.builder()
                .id("svc-005")
                .modelFileId("model-003")
                .applicationId("app-003")
                .name("Notification Service")
                .coreTech("Go, gRPC, Kafka")
                .build();

        // Then: The coreTech should be set
        assertNotNull(entity);
        assertEquals("Go, gRPC, Kafka", entity.getCoreTech(),
                "Builder should support setting coreTech field");
    }

    // ============================================================================
    // Task Group 1: Tech Hints LLM Resolution - Round-Trip Tests
    // Spec: Tech Hints LLM Resolution (2026-04-20)
    //
    // Covers Task 1.1:
    // "EntityMapper round-trip test: all 5 new fields (populated + null)
    //  round-trip unchanged between ServiceEntity and ServiceDto."
    // ============================================================================

    /**
     * Round-trip DTO -> Entity -> DTO with all 5 new resolved-state fields
     * populated. Verifies that the jsonb map, the framework-pack list, the
     * denormalised language pack, the confidence enum, and the resolved-at
     * timestamp are all preserved unchanged across the bidirectional mapping.
     */
    @Test
    @DisplayName("Task 1.1: Round-trip preserves all 5 resolved tech-hints fields (populated)")
    void roundTrip_preservesAllFiveResolvedFields_whenPopulated() {
        // Given: A resolved tech-hints payload matching the spec shape
        Map<String, Object> resolvedPayload = Map.of(
            "language", Map.of("name", "Java", "version", "21"),
            "frameworks", List.of(Map.of("name", "Spring Boot", "version", "3")),
            "languagePack", "java-21",
            "frameworkPacks", List.of("spring-boot-3"),
            "confirmationSentence", "Detected Java 21 service using Spring Boot 3.",
            "repoCrossCheck", Map.of("status", "confirmed", "note", "pom.xml confirms Spring Boot 3."),
            "confidence", "high"
        );
        Instant resolvedAt = Instant.parse("2026-04-20T10:15:30.00Z");

        ServiceDto originalDto = new ServiceDto(
            "svc-tech-hints-populated",
            "Orders Service",
            "Handles order creation",
            "app-orders",
            null,
            "Microservice",
            "Java 21 (Spring Boot 3)",
            "https://github.com/acme/orders.git",
            "services/orders",
            "orders",
            null,
            null,
            null,
            true,
            resolvedPayload,
            "java-21",
            List.of("spring-boot-3"),
            "high",
            resolvedAt
        );

        // When: Round-trip through Entity and back
        ServiceEntity entity = entityMapper.toEntity(originalDto, "model-tech-hints");
        ServiceDto roundTripDto = entityMapper.toDto(entity);

        // Then: All 5 new fields are preserved unchanged
        assertEquals(resolvedPayload, roundTripDto.coreTechResolved(),
            "coreTechResolved jsonb map should round-trip unchanged");
        assertEquals("java-21", roundTripDto.coreTechLanguagePack(),
            "coreTechLanguagePack should round-trip unchanged");
        assertEquals(List.of("spring-boot-3"), roundTripDto.coreTechFrameworkPacks(),
            "coreTechFrameworkPacks list should round-trip unchanged");
        assertEquals("high", roundTripDto.coreTechResolutionConfidence(),
            "coreTechResolutionConfidence should round-trip unchanged");
        assertEquals(resolvedAt, roundTripDto.coreTechResolvedAt(),
            "coreTechResolvedAt should round-trip unchanged");

        // And: Pre-existing fields still round-trip correctly
        assertEquals("svc-tech-hints-populated", roundTripDto.id());
        assertEquals("Java 21 (Spring Boot 3)", roundTripDto.coreTech());
        assertEquals("https://github.com/acme/orders.git", roundTripDto.repoLocation());
        assertEquals("services/orders", roundTripDto.repoSubfolder());
    }

    /**
     * Round-trip DTO -> Entity -> DTO with all 5 new resolved-state fields NULL.
     * This is the "unresolved row" shape and is the state every legacy row
     * will have until it is re-saved; the discovery tier gate reads this NULL
     * state as the rejection signal.
     */
    @Test
    @DisplayName("Task 1.1: Round-trip preserves all 5 resolved tech-hints fields (NULL)")
    void roundTrip_preservesAllFiveResolvedFields_whenNull() {
        ServiceDto originalDto = new ServiceDto(
            "svc-tech-hints-unresolved",
            "Legacy Service",
            "Service pre-dating tech-hints resolution",
            "app-legacy",
            null,
            "REST",
            "Java",
            null,
            null,
            null,
            null,
            null,
            null,
            true,
            null,   // coreTechResolved
            null,   // coreTechLanguagePack
            null,   // coreTechFrameworkPacks
            null,   // coreTechResolutionConfidence
            null    // coreTechResolvedAt
        );

        // When
        ServiceEntity entity = entityMapper.toEntity(originalDto, "model-legacy");
        ServiceDto roundTripDto = entityMapper.toDto(entity);

        // Then: NULL values are preserved on all 5 new fields
        assertNull(roundTripDto.coreTechResolved(),
            "coreTechResolved should remain NULL");
        assertNull(roundTripDto.coreTechLanguagePack(),
            "coreTechLanguagePack should remain NULL");
        assertNull(roundTripDto.coreTechFrameworkPacks(),
            "coreTechFrameworkPacks should remain NULL (not empty list)");
        assertNull(roundTripDto.coreTechResolutionConfidence(),
            "coreTechResolutionConfidence should remain NULL");
        assertNull(roundTripDto.coreTechResolvedAt(),
            "coreTechResolvedAt should remain NULL");

        // And: Pre-existing fields still round-trip correctly
        assertEquals("svc-tech-hints-unresolved", roundTripDto.id());
        assertEquals("Java", roundTripDto.coreTech());
    }
}
