package com.example.architecturemodel.dto;

import com.example.architecturemodel.model.dto.ProjectDto;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for ProjectDto JSON deserialization with @JsonAlias.
 *
 * Tests that ProjectDto accepts both camelCase and snake_case field names
 * during JSON deserialization, while maintaining snake_case output.
 *
 * Spec 2026-01-07: Fix ProjectDto JSON Deserialization
 * Task Group 1: Add @JsonAlias Annotations to ProjectDto
 */
class ProjectDtoTest {

    private ObjectMapper objectMapper;

    @BeforeEach
    void setUp() {
        // Configure ObjectMapper to match production configuration from application.yml
        objectMapper = new ObjectMapper();
        objectMapper.setPropertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE);
        objectMapper.registerModule(new JavaTimeModule());
        objectMapper.disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
    }

    @Nested
    @DisplayName("ProjectDto Deserialization Tests (Spec 2026-01-07)")
    class ProjectDtoDeserializationTests {

        @Test
        @DisplayName("deserializes camelCase field names correctly")
        void testDeserializesCamelCaseFieldNames() throws Exception {
            UUID projectId = UUID.fromString("550e8400-e29b-41d4-a716-446655440000");

            // JSON with camelCase field names (the problematic case)
            String camelCaseJson = """
                {
                    "id": "550e8400-e29b-41d4-a716-446655440000",
                    "name": "Test Project",
                    "projectParentFolder": "/path/to/project",
                    "isActive": true,
                    "createdAt": "2026-01-07T10:00:00Z",
                    "updatedAt": "2026-01-07T11:00:00Z"
                }
                """;

            ProjectDto result = objectMapper.readValue(camelCaseJson, ProjectDto.class);

            assertThat(result.id()).isEqualTo(projectId);
            assertThat(result.name()).isEqualTo("Test Project");
            assertThat(result.projectParentFolder()).isEqualTo("/path/to/project");
            assertThat(result.isActive()).isTrue();
            assertThat(result.createdAt()).isEqualTo(Instant.parse("2026-01-07T10:00:00Z"));
            assertThat(result.updatedAt()).isEqualTo(Instant.parse("2026-01-07T11:00:00Z"));
        }

        @Test
        @DisplayName("deserializes snake_case field names correctly (no regression)")
        void testDeserializesSnakeCaseFieldNames() throws Exception {
            UUID projectId = UUID.fromString("550e8400-e29b-41d4-a716-446655440001");

            // JSON with snake_case field names (existing behavior)
            String snakeCaseJson = """
                {
                    "id": "550e8400-e29b-41d4-a716-446655440001",
                    "name": "Snake Case Project",
                    "project_parent_folder": "/snake/case/path",
                    "is_active": false,
                    "created_at": "2026-01-07T08:00:00Z",
                    "updated_at": "2026-01-07T09:00:00Z"
                }
                """;

            ProjectDto result = objectMapper.readValue(snakeCaseJson, ProjectDto.class);

            assertThat(result.id()).isEqualTo(projectId);
            assertThat(result.name()).isEqualTo("Snake Case Project");
            assertThat(result.projectParentFolder()).isEqualTo("/snake/case/path");
            assertThat(result.isActive()).isFalse();
            assertThat(result.createdAt()).isEqualTo(Instant.parse("2026-01-07T08:00:00Z"));
            assertThat(result.updatedAt()).isEqualTo(Instant.parse("2026-01-07T09:00:00Z"));
        }

        @Test
        @DisplayName("deserializes mixed-case JSON input (some fields camelCase, some snake_case)")
        void testDeserializesMixedCaseFieldNames() throws Exception {
            UUID projectId = UUID.fromString("550e8400-e29b-41d4-a716-446655440002");

            // JSON with mixed camelCase and snake_case field names
            String mixedCaseJson = """
                {
                    "id": "550e8400-e29b-41d4-a716-446655440002",
                    "name": "Mixed Case Project",
                    "projectParentFolder": "/mixed/case/path",
                    "is_active": true,
                    "createdAt": "2026-01-07T12:00:00Z",
                    "updated_at": "2026-01-07T13:00:00Z"
                }
                """;

            ProjectDto result = objectMapper.readValue(mixedCaseJson, ProjectDto.class);

            assertThat(result.id()).isEqualTo(projectId);
            assertThat(result.name()).isEqualTo("Mixed Case Project");
            assertThat(result.projectParentFolder()).isEqualTo("/mixed/case/path");
            assertThat(result.isActive()).isTrue();
            assertThat(result.createdAt()).isEqualTo(Instant.parse("2026-01-07T12:00:00Z"));
            assertThat(result.updatedAt()).isEqualTo(Instant.parse("2026-01-07T13:00:00Z"));
        }

        @Test
        @DisplayName("id and name fields work without aliases (same in both conventions)")
        void testIdAndNameFieldsWorkWithoutAliases() throws Exception {
            // JSON where only id and name are provided (minimal fields)
            String minimalJson = """
                {
                    "id": "550e8400-e29b-41d4-a716-446655440003",
                    "name": "Minimal Project"
                }
                """;

            ProjectDto result = objectMapper.readValue(minimalJson, ProjectDto.class);

            assertThat(result.id()).isEqualTo(UUID.fromString("550e8400-e29b-41d4-a716-446655440003"));
            assertThat(result.name()).isEqualTo("Minimal Project");
            // Other fields should be null
            assertThat(result.projectParentFolder()).isNull();
            assertThat(result.isActive()).isNull();
            assertThat(result.createdAt()).isNull();
            assertThat(result.updatedAt()).isNull();
        }
    }

    @Nested
    @DisplayName("ProjectDto Serialization Tests (Backward Compatibility)")
    class ProjectDtoSerializationTests {

        @Test
        @DisplayName("serializes to snake_case field names (output format unchanged)")
        void testSerializesToSnakeCaseFieldNames() throws Exception {
            UUID projectId = UUID.fromString("550e8400-e29b-41d4-a716-446655440004");
            Instant createdAt = Instant.parse("2026-01-07T10:00:00Z");
            Instant updatedAt = Instant.parse("2026-01-07T11:00:00Z");

            ProjectDto dto = new ProjectDto(
                projectId,
                "Output Test Project",
                "/output/path",
                null,  // projectHierarchy
                null,  // organisationId
                null,  // repoUrl
                true,
                createdAt,
                updatedAt
            );

            String json = objectMapper.writeValueAsString(dto);

            // Verify snake_case field names in output
            assertThat(json).contains("\"project_parent_folder\":\"/output/path\"");
            assertThat(json).contains("\"is_active\":true");
            assertThat(json).contains("\"created_at\":\"2026-01-07T10:00:00Z\"");
            assertThat(json).contains("\"updated_at\":\"2026-01-07T11:00:00Z\"");

            // Verify NO camelCase field names in output
            assertThat(json).doesNotContain("\"projectParentFolder\"");
            assertThat(json).doesNotContain("\"isActive\"");
            assertThat(json).doesNotContain("\"createdAt\"");
            assertThat(json).doesNotContain("\"updatedAt\"");
        }
    }

    /**
     * Task Group 3: Additional edge case tests for test coverage gaps
     *
     * These tests cover edge cases identified during test review:
     * - Explicit null values in camelCase JSON
     * - isActive set to false in camelCase JSON (ensures false isn't treated as null)
     */
    @Nested
    @DisplayName("Edge Case Tests (Spec 2026-01-07 Task Group 3)")
    class EdgeCaseTests {

        @Test
        @DisplayName("handles explicit null values in camelCase JSON correctly")
        void testHandlesExplicitNullValuesInCamelCaseJson() throws Exception {
            // JSON with camelCase field names where some fields are explicitly null
            String camelCaseWithNulls = """
                {
                    "id": "550e8400-e29b-41d4-a716-446655440005",
                    "name": "Project With Nulls",
                    "projectParentFolder": null,
                    "isActive": null,
                    "createdAt": null,
                    "updatedAt": null
                }
                """;

            ProjectDto result = objectMapper.readValue(camelCaseWithNulls, ProjectDto.class);

            assertThat(result.id()).isEqualTo(UUID.fromString("550e8400-e29b-41d4-a716-446655440005"));
            assertThat(result.name()).isEqualTo("Project With Nulls");
            // Explicit null values should be preserved as null
            assertThat(result.projectParentFolder()).isNull();
            assertThat(result.isActive()).isNull();
            assertThat(result.createdAt()).isNull();
            assertThat(result.updatedAt()).isNull();
        }

        @Test
        @DisplayName("handles isActive=false in camelCase JSON (false not treated as null)")
        void testHandlesIsActiveFalseInCamelCaseJson() throws Exception {
            // This is important: ensure Boolean false is correctly deserialized
            // and not treated as null when using camelCase field name
            String camelCaseWithFalse = """
                {
                    "id": "550e8400-e29b-41d4-a716-446655440006",
                    "name": "Inactive Project",
                    "projectParentFolder": "/inactive/path",
                    "isActive": false,
                    "createdAt": "2026-01-07T10:00:00Z",
                    "updatedAt": "2026-01-07T11:00:00Z"
                }
                """;

            ProjectDto result = objectMapper.readValue(camelCaseWithFalse, ProjectDto.class);

            assertThat(result.id()).isEqualTo(UUID.fromString("550e8400-e29b-41d4-a716-446655440006"));
            assertThat(result.name()).isEqualTo("Inactive Project");
            assertThat(result.projectParentFolder()).isEqualTo("/inactive/path");
            // Critical: isActive should be false, NOT null
            assertThat(result.isActive()).isNotNull();
            assertThat(result.isActive()).isFalse();
            assertThat(result.createdAt()).isEqualTo(Instant.parse("2026-01-07T10:00:00Z"));
            assertThat(result.updatedAt()).isEqualTo(Instant.parse("2026-01-07T11:00:00Z"));
        }
    }
}
