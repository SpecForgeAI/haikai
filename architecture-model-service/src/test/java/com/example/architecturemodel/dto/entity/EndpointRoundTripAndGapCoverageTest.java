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
 * Additional gap-coverage tests for Endpoint request/response data feature.
 *
 * Spec: Metamodel Interface Endpoint - Add Request/Response Data and Simplify Endpoints Table
 * Task Group 4: Test Review and End-to-End Verification (Task 4.3)
 */
class EndpointRoundTripAndGapCoverageTest {

    private ObjectMapper objectMapper;
    private EntityMapper entityMapper;

    @BeforeEach
    void setUp() {
        objectMapper = new ObjectMapper();
        entityMapper = new EntityMapper();
    }

    /**
     * Gap test 1: Round-trip - create DTO with FK fields set, map to entity, map back to DTO,
     * verify fields persist correctly through the full cycle.
     */
    @Test
    @DisplayName("Round-trip: DTO -> Entity -> DTO preserves request/response data entity point IDs")
    void roundTrip_shouldPreserveNewFkFields() {
        EndpointDto originalDto = new EndpointDto(
            "ep-rt-1", "Create Order", "Creates an order", "ifc-1", "REST",
            "/api/orders", "HTTP", "POST", "Inbound",
            "2026-01-01", "2026-12-31", "dep-req-order", "dep-res-order",
            null, null
        );

        EndpointEntity entity = entityMapper.toEntity(originalDto, "mf-rt");
        EndpointDto roundTrippedDto = entityMapper.toDto(entity);

        assertThat(roundTrippedDto.requestDataEntityPointId()).isEqualTo("dep-req-order");
        assertThat(roundTrippedDto.responseDataEntityPointId()).isEqualTo("dep-res-order");
        assertThat(roundTrippedDto.id()).isEqualTo("ep-rt-1");
        assertThat(roundTrippedDto.name()).isEqualTo("Create Order");
    }

    /**
     * Gap test 2: Create endpoint DTO without the new FK fields (null),
     * verify they default to null through entity mapping.
     */
    @Test
    @DisplayName("Endpoint without FK fields defaults to null for request/response data entity point IDs")
    void nullFkFields_shouldDefaultToNull() {
        EndpointDto dto = new EndpointDto(
            "ep-null-1", "List Users", "Lists users", "ifc-2", "REST",
            "/api/users", "HTTP", "GET", "Inbound",
            null, null, null, null,
            null, null
        );

        EndpointEntity entity = entityMapper.toEntity(dto, "mf-null");

        assertThat(entity.getRequestDataEntityPointId()).isNull();
        assertThat(entity.getResponseDataEntityPointId()).isNull();

        EndpointDto resultDto = entityMapper.toDto(entity);
        assertThat(resultDto.requestDataEntityPointId()).isNull();
        assertThat(resultDto.responseDataEntityPointId()).isNull();
    }

    /**
     * Gap test 3: Verify removed fields (lifecycle_status, version, tags) are absent
     * from JSON serialized API response format.
     */
    @Test
    @DisplayName("API response JSON does not contain removed fields even when entity has them")
    void apiResponse_shouldNotContainRemovedFields() throws Exception {
        // Entity still has the old fields on the DB model
        EndpointEntity entity = EndpointEntity.builder()
            .id("ep-removed-1")
            .modelFileId("mf-1")
            .interfaceId("ifc-1")
            .name("Get Users")
            .lifecycleStatus("Active")
            .version("1.0")
            .tags("important,api")
            .requestDataEntityPointId("dep-1")
            .responseDataEntityPointId("dep-2")
            .build();

        // Map to DTO (which no longer has removed fields)
        EndpointDto dto = entityMapper.toDto(entity);
        String json = objectMapper.writeValueAsString(dto);

        assertThat(json).doesNotContain("lifecycle_status");
        assertThat(json).doesNotContain("\"version\"");
        assertThat(json).doesNotContain("\"tags\"");
        // But new fields ARE present
        assertThat(json).contains("\"request_data_entity_point_id\"");
        assertThat(json).contains("\"response_data_entity_point_id\"");
    }

    /**
     * Gap test 4: Verify JSON deserialization of EndpointDto with new fields works correctly
     * (simulates receiving API request payload).
     */
    @Test
    @DisplayName("JSON deserialization creates EndpointDto with request/response data entity point IDs")
    void jsonDeserialization_shouldPopulateNewFields() throws Exception {
        String json = """
            {
              "id": "ep-deser-1",
              "name": "Update Order",
              "description": "Updates order",
              "interface_id": "ifc-1",
              "endpoint_type": "REST",
              "path_or_address": "/api/orders/{id}",
              "protocol": "HTTP",
              "operation_verb": "PUT",
              "direction": "Inbound",
              "valid_from": null,
              "valid_to": null,
              "request_data_entity_point_id": "dep-req-update",
              "response_data_entity_point_id": "dep-res-update"
            }
            """;

        EndpointDto dto = objectMapper.readValue(json, EndpointDto.class);

        assertThat(dto.requestDataEntityPointId()).isEqualTo("dep-req-update");
        assertThat(dto.responseDataEntityPointId()).isEqualTo("dep-res-update");
    }
}
