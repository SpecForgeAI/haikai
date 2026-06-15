package com.example.architecturemodel.dto.entity;

import com.example.architecturemodel.mapper.EntityMapper;
import com.example.architecturemodel.model.dto.entity.EndpointDto;
import com.example.architecturemodel.model.entity.EndpointEntity;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for EndpointDto serialization and EntityMapper endpoint mapping.
 *
 * Spec: Metamodel Interface Endpoint - Add Request/Response Data and Simplify Endpoints Table
 * Task Group 2: Entity, DTO, and Mapper Updates
 */
class EndpointDtoSerializationTest {

    private ObjectMapper objectMapper;
    private EntityMapper entityMapper;

    @BeforeEach
    void setUp() {
        objectMapper = new ObjectMapper();
        entityMapper = new EntityMapper();
    }

    @Test
    @DisplayName("EndpointDto serialization includes request_data_entity_point_id and response_data_entity_point_id")
    void endpointDto_shouldSerializeNewFields() throws Exception {
        EndpointDto dto = new EndpointDto(
            "ep-1", "Get Users", "desc", "ifc-1", "REST",
            "/users", "HTTP", "GET", "Inbound",
            null, null, "dep-req-1", "dep-res-1",
            null, null
        );

        String json = objectMapper.writeValueAsString(dto);

        assertThat(json).contains("\"request_data_entity_point_id\":\"dep-req-1\"");
        assertThat(json).contains("\"response_data_entity_point_id\":\"dep-res-1\"");
    }

    @Test
    @DisplayName("EndpointDto serialization does NOT include lifecycle_status, version, or tags")
    void endpointDto_shouldNotSerializeRemovedFields() throws Exception {
        EndpointDto dto = new EndpointDto(
            "ep-1", "Get Users", "desc", "ifc-1", "REST",
            "/users", "HTTP", "GET", "Inbound",
            null, null, null, null,
            null, null
        );

        String json = objectMapper.writeValueAsString(dto);

        assertThat(json).doesNotContain("lifecycle_status");
        assertThat(json).doesNotContain("\"version\"");
        assertThat(json).doesNotContain("\"tags\"");
    }

    @Test
    @DisplayName("EntityMapper.toDto(EndpointEntity) maps new fields correctly")
    void entityMapper_toDto_shouldMapNewFields() {
        EndpointEntity entity = EndpointEntity.builder()
            .id("ep-1")
            .modelFileId("mf-1")
            .interfaceId("ifc-1")
            .name("Get Users")
            .description("desc")
            .endpointType("REST")
            .pathOrAddress("/users")
            .protocol("HTTP")
            .operationVerb("GET")
            .direction("Inbound")
            .validFrom("2026-01-01")
            .validTo("2026-12-31")
            .requestDataEntityPointId("dep-req-1")
            .responseDataEntityPointId("dep-res-1")
            .build();

        EndpointDto dto = entityMapper.toDto(entity);

        assertThat(dto.requestDataEntityPointId()).isEqualTo("dep-req-1");
        assertThat(dto.responseDataEntityPointId()).isEqualTo("dep-res-1");
        assertThat(dto.validFrom()).isEqualTo("2026-01-01");
        assertThat(dto.validTo()).isEqualTo("2026-12-31");
    }

    @Test
    @DisplayName("EntityMapper.toEntity(EndpointDto) maps new fields correctly")
    void entityMapper_toEntity_shouldMapNewFields() {
        EndpointDto dto = new EndpointDto(
            "ep-1", "Get Users", "desc", "ifc-1", "REST",
            "/users", "HTTP", "GET", "Inbound",
            "2026-01-01", "2026-12-31", "dep-req-1", "dep-res-1",
            null, null
        );

        EndpointEntity entity = entityMapper.toEntity(dto, "mf-1");

        assertThat(entity.getRequestDataEntityPointId()).isEqualTo("dep-req-1");
        assertThat(entity.getResponseDataEntityPointId()).isEqualTo("dep-res-1");
        assertThat(entity.getModelFileId()).isEqualTo("mf-1");
        assertThat(entity.getValidFrom()).isEqualTo("2026-01-01");
        assertThat(entity.getValidTo()).isEqualTo("2026-12-31");
    }
}
