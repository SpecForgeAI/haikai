package com.example.architecturemodel.dto.entity;

import com.example.architecturemodel.model.dto.entity.ApplicationComponentDto;
import com.example.architecturemodel.model.dto.entity.ApplicationDto;
import com.example.architecturemodel.model.dto.entity.ServiceDto;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for entity DTO JSON serialization with new is_internal and tech_type fields.
 *
 * Spec: Sequence Diagram Participant Colour and Icons for Services and Components
 * Task Group 1: Entity and DTO Updates
 */
class EntityDtoSerializationTest {

    private ObjectMapper objectMapper;

    @BeforeEach
    void setUp() {
        // Configure ObjectMapper to match production configuration from application.yml
        objectMapper = new ObjectMapper();
        objectMapper.setPropertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE);
        // Register JavaTimeModule so java.time.Instant (introduced for the
        // Tech Hints LLM Resolution spec) serialises without "Java 8 date/time
        // type not supported by default" errors.
        objectMapper.registerModule(new JavaTimeModule());
        objectMapper.disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
    }

    @Test
    @DisplayName("ApplicationDto serializes is_internal field correctly")
    void applicationDto_shouldSerializeIsInternal() throws Exception {
        // Arrange
        ApplicationDto dto = new ApplicationDto(
            "app-1", "My App", "Description", "Web", "Active", "tag1", null, null, true, null
        );

        // Act
        String json = objectMapper.writeValueAsString(dto);

        // Assert - verify snake_case field name is_internal
        assertThat(json).contains("\"is_internal\":true");
        // Also verify with false value
        ApplicationDto dtoFalse = new ApplicationDto(
            "app-2", "External App", "Desc", "API", "Active", null, null, null, false, null
        );
        String jsonFalse = objectMapper.writeValueAsString(dtoFalse);
        assertThat(jsonFalse).contains("\"is_internal\":false");
    }

    @Test
    @DisplayName("ApplicationDto deserializes with missing is_internal (null handling)")
    void applicationDto_shouldDeserializeWithMissingIsInternal() throws Exception {
        // Arrange - JSON without is_internal field (backward compatibility)
        String json = """
            {
                "id": "app-1",
                "name": "My App",
                "description": "Description",
                "app_type": "Web",
                "status": "Active",
                "tags": "tag1"
            }
            """;

        // Act
        ApplicationDto result = objectMapper.readValue(json, ApplicationDto.class);

        // Assert - isInternal should be null when not present (frontend handles default)
        assertThat(result.id()).isEqualTo("app-1");
        assertThat(result.name()).isEqualTo("My App");
        assertThat(result.isInternal()).isNull();
    }

    @Test
    @DisplayName("ApplicationComponentDto serializes is_internal and tech_type fields correctly")
    void applicationComponentDto_shouldSerializeIsInternalAndTechType() throws Exception {
        // Arrange
        ApplicationComponentDto dto = new ApplicationComponentDto(
            "comp-1", "UI Component", "Description", "app-1", "tag1", null, null, true, "UI Tier"
        );

        // Act
        String json = objectMapper.writeValueAsString(dto);

        // Assert - verify snake_case field names
        assertThat(json).contains("\"is_internal\":true");
        assertThat(json).contains("\"tech_type\":\"UI Tier\"");

        // Test with other tech_type values
        ApplicationComponentDto dtoPersistence = new ApplicationComponentDto(
            "comp-2", "DB Component", "Desc", "app-1", null, null, null, false, "Persistence Tier"
        );
        String jsonPersistence = objectMapper.writeValueAsString(dtoPersistence);
        assertThat(jsonPersistence).contains("\"is_internal\":false");
        assertThat(jsonPersistence).contains("\"tech_type\":\"Persistence Tier\"");
    }

    @Test
    @DisplayName("ServiceDto serializes is_internal field correctly")
    void serviceDto_shouldSerializeIsInternal() throws Exception {
        // Arrange
        ServiceDto dto = new ServiceDto(
            "svc-1", "My Service", "Description", "app-1", "comp-1",
            "REST", "Java", null, null, "tag1", null, null, "pkg-1", true,
            null, null, null, null, null
        );

        // Act
        String json = objectMapper.writeValueAsString(dto);

        // Assert - verify snake_case field name is_internal
        assertThat(json).contains("\"is_internal\":true");

        // Also verify with false value (external service)
        ServiceDto dtoExternal = new ServiceDto(
            "svc-2", "External Service", "Desc", "app-1", null,
            "SOAP", "C#", null, null, null, null, null, null, false,
            null, null, null, null, null
        );
        String jsonExternal = objectMapper.writeValueAsString(dtoExternal);
        assertThat(jsonExternal).contains("\"is_internal\":false");
    }

    // ========================================================================
    // Tech Hints LLM Resolution (2026-04-20) - Task 1.1 Serialisation Test
    //
    // "ServiceDto serialisation test: coreTechResolved jsonb map preserved as
    //  nested JSON object, coreTechFrameworkPacks preserved as JSON array."
    // ========================================================================

    @Test
    @DisplayName("Task 1.1: ServiceDto serialises coreTechResolved as nested JSON object and coreTechFrameworkPacks as JSON array")
    void serviceDto_shouldSerialiseResolvedTechHintsFieldsAsNestedJson() throws Exception {
        // Arrange: populated resolved payload matching the spec shape
        Map<String, Object> resolvedPayload = Map.of(
            "languagePack", "java-21",
            "frameworkPacks", List.of("spring-boot-3"),
            "confirmationSentence", "Detected Java 21 service using Spring Boot 3.",
            "confidence", "high"
        );
        Instant resolvedAt = Instant.parse("2026-04-20T10:15:30.00Z");

        ServiceDto dto = new ServiceDto(
            "svc-resolve", "Orders", "Handles orders", "app-orders", null,
            "Microservice", "Java 21 (Spring Boot 3)",
            "https://github.com/acme/orders.git", "services/orders",
            null, null, null, null, true,
            resolvedPayload,
            "java-21",
            List.of("spring-boot-3"),
            "high",
            resolvedAt
        );

        // Act
        String json = objectMapper.writeValueAsString(dto);

        // Assert: top-level resolved fields use the expected snake_case names
        JsonNode root = objectMapper.readTree(json);

        // coreTechResolved renders as a nested JSON object (NOT a stringified payload)
        JsonNode resolvedNode = root.get("core_tech_resolved");
        assertThat(resolvedNode).isNotNull();
        assertThat(resolvedNode.isObject())
            .as("core_tech_resolved must serialise as a nested JSON object, not a string")
            .isTrue();
        assertThat(resolvedNode.get("languagePack").asText()).isEqualTo("java-21");
        assertThat(resolvedNode.get("confidence").asText()).isEqualTo("high");

        // coreTechFrameworkPacks renders as a JSON array of strings
        JsonNode packsNode = root.get("core_tech_framework_packs");
        assertThat(packsNode).isNotNull();
        assertThat(packsNode.isArray())
            .as("core_tech_framework_packs must serialise as a JSON array")
            .isTrue();
        assertThat(packsNode).hasSize(1);
        assertThat(packsNode.get(0).asText()).isEqualTo("spring-boot-3");

        // Scalar denormalised fields render with snake_case property names
        assertThat(root.get("core_tech_language_pack").asText()).isEqualTo("java-21");
        assertThat(root.get("core_tech_resolution_confidence").asText()).isEqualTo("high");
        assertThat(root.get("core_tech_resolved_at")).isNotNull();
    }

    @Test
    @DisplayName("Task 1.1: ServiceDto serialises null resolved fields as JSON nulls")
    void serviceDto_shouldSerialiseNullResolvedFieldsAsJsonNulls() throws Exception {
        ServiceDto dto = new ServiceDto(
            "svc-unresolved", "Legacy", "Unresolved service", "app-1", null,
            "REST", "Java",
            null, null, null, null, null, null, true,
            null, null, null, null, null
        );

        String json = objectMapper.writeValueAsString(dto);
        JsonNode root = objectMapper.readTree(json);

        assertThat(root.get("core_tech_resolved").isNull()).isTrue();
        assertThat(root.get("core_tech_language_pack").isNull()).isTrue();
        assertThat(root.get("core_tech_framework_packs").isNull()).isTrue();
        assertThat(root.get("core_tech_resolution_confidence").isNull()).isTrue();
        assertThat(root.get("core_tech_resolved_at").isNull()).isTrue();
    }
}
