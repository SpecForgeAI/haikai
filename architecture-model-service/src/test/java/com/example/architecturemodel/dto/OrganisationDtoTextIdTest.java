package com.example.architecturemodel.dto;

import com.example.architecturemodel.model.dto.OrganisationDto;
import com.example.architecturemodel.model.dto.OrganisationListItemDto;
import com.example.architecturemodel.model.dto.ProjectDto;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Tests for DTO serialization/deserialization with String ID types.
 *
 * Validates that DTOs correctly serialize and deserialize String IDs
 * after the UUID to TEXT migration.
 *
 * Spec: Organisation ID Type Change (UUID to TEXT)
 * Task Group 3: DTO Updates
 */
class OrganisationDtoTextIdTest {

    private ObjectMapper objectMapper;

    @BeforeEach
    void setUp() {
        objectMapper = new ObjectMapper();
        objectMapper.registerModule(new JavaTimeModule());
        objectMapper.setPropertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE);
    }

    @Test
    @DisplayName("OrganisationDto serializes with String id")
    void testOrganisationDtoSerializesWithStringId() throws Exception {
        // Given: An OrganisationDto with String id
        String orgId = "org-" + UUID.randomUUID().toString();
        OrganisationDto dto = new OrganisationDto(
            orgId, "Test Org", "Description",
            null, null, null, null, null, null, null
        );

        // When: Serialize to JSON
        String json = objectMapper.writeValueAsString(dto);

        // Then: JSON contains the String id
        assertThat(json).contains("\"id\":\"" + orgId + "\"");
        assertThat(json).contains("org-");
    }

    @Test
    @DisplayName("OrganisationListItemDto serializes with String id")
    void testOrganisationListItemDtoSerializesWithStringId() throws Exception {
        // Given: An OrganisationListItemDto with String id
        String orgId = "org-" + UUID.randomUUID().toString();
        OrganisationListItemDto dto = new OrganisationListItemDto(orgId, "List Item Org");

        // When: Serialize to JSON
        String json = objectMapper.writeValueAsString(dto);

        // Then: JSON contains the String id
        assertThat(json).contains("\"id\":\"" + orgId + "\"");
    }

    @Test
    @DisplayName("ProjectDto serializes with String organisationId")
    void testProjectDtoSerializesWithStringOrganisationId() throws Exception {
        // Given: A ProjectDto with String organisationId
        String orgId = "org-" + UUID.randomUUID().toString();
        UUID projectId = UUID.randomUUID();
        Instant now = Instant.now();

        ProjectDto dto = new ProjectDto(
            projectId,
            "Test Project",
            "/test/path",
            "hierarchy",
            orgId,
            null,  // repoUrl
            true,
            now,
            now
        );

        // When: Serialize to JSON
        String json = objectMapper.writeValueAsString(dto);

        // Then: JSON contains the String organisationId
        assertThat(json).contains("\"organisation_id\":\"" + orgId + "\"");
    }

    @Test
    @DisplayName("JSON deserialization works with prefixed string IDs")
    void testJsonDeserializationWithPrefixedStringIds() throws Exception {
        // Given: JSON with prefixed string ID
        String orgId = "org-" + UUID.randomUUID().toString();
        String json = String.format(
            "{\"id\":\"%s\",\"name\":\"Deserialized Org\",\"description\":\"Test\"}",
            orgId
        );

        // When: Deserialize from JSON
        OrganisationDto dto = objectMapper.readValue(json, OrganisationDto.class);

        // Then: DTO has correct String id
        assertThat(dto.id()).isEqualTo(orgId);
        assertThat(dto.id()).startsWith("org-");
        assertThat(dto.name()).isEqualTo("Deserialized Org");
    }
}
