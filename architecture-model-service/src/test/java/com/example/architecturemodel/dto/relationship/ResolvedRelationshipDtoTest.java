package com.example.architecturemodel.dto.relationship;

import com.example.architecturemodel.model.dto.ExpandResolveResponseDto;
import com.example.architecturemodel.model.dto.diagram.ResolvedDiagramSummary;
import com.example.architecturemodel.model.dto.entity.ResolvedEntitySummary;
import com.example.architecturemodel.model.dto.relationship.RelationshipEndpoint;
import com.example.architecturemodel.model.dto.relationship.ResolvedRelationshipDto;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Tests for ResolvedRelationshipDto and RelationshipEndpoint serialization with Jackson.
 * Verifies that @JsonProperty annotations produce expected snake_case JSON output.
 *
 * Spec: Context Bundles Auto-Include Relationships - Task Group 1
 */
class ResolvedRelationshipDtoTest {

    private ObjectMapper objectMapper;

    @BeforeEach
    void setUp() {
        objectMapper = new ObjectMapper();
    }

    /**
     * Test RelationshipEndpoint record serialization with all fields.
     * Verifies snake_case JSON property names.
     */
    @Test
    void relationshipEndpoint_serializesWithSnakeCaseProperties() throws Exception {
        // Arrange
        RelationshipEndpoint endpoint = new RelationshipEndpoint(
            "logicalDataEntities",
            "entity-123",
            "Customer"
        );

        // Act
        String json = objectMapper.writeValueAsString(endpoint);

        // Assert
        assertTrue(json.contains("\"entity_type\""), "Should contain entity_type with snake_case");
        assertTrue(json.contains("\"entity_id\""), "Should contain entity_id with snake_case");
        assertTrue(json.contains("\"name\""), "Should contain name field");
        assertTrue(json.contains("\"logicalDataEntities\""), "Should contain entity_type value");
        assertTrue(json.contains("\"entity-123\""), "Should contain entity_id value");
        assertTrue(json.contains("\"Customer\""), "Should contain name value");
    }

    /**
     * Test RelationshipEndpoint record deserialization from snake_case JSON.
     */
    @Test
    void relationshipEndpoint_deserializesFromSnakeCaseJson() throws Exception {
        // Arrange
        String json = """
            {
                "entity_type": "physicalDataEntities",
                "entity_id": "table-456",
                "name": "users_table"
            }
            """;

        // Act
        RelationshipEndpoint endpoint = objectMapper.readValue(json, RelationshipEndpoint.class);

        // Assert
        assertNotNull(endpoint);
        assertEquals("physicalDataEntities", endpoint.entityType());
        assertEquals("table-456", endpoint.entityId());
        assertEquals("users_table", endpoint.name());
    }

    /**
     * Test ResolvedRelationshipDto record serialization with all fields.
     * Verifies snake_case JSON property names including nested RelationshipEndpoint.
     */
    @Test
    void resolvedRelationshipDto_serializesWithSnakeCaseProperties() throws Exception {
        // Arrange
        RelationshipEndpoint from = new RelationshipEndpoint(
            "logicalDataEntities",
            "customer-entity",
            "Customer"
        );
        RelationshipEndpoint to = new RelationshipEndpoint(
            "logicalDataEntities",
            "order-entity",
            "Order"
        );
        Map<String, Object> summaryFields = new HashMap<>();
        summaryFields.put("cardinality", "ONE_TO_MANY");
        summaryFields.put("relationship_type", "ASSOCIATION");
        summaryFields.put("description", "Customer has many orders");

        ResolvedRelationshipDto dto = new ResolvedRelationshipDto(
            "rel-123",
            "association",
            from,
            to,
            "places",
            summaryFields
        );

        // Act
        String json = objectMapper.writeValueAsString(dto);

        // Assert
        assertTrue(json.contains("\"id\""), "Should contain id field");
        assertTrue(json.contains("\"type\""), "Should contain type field");
        assertTrue(json.contains("\"from\""), "Should contain from field");
        assertTrue(json.contains("\"to\""), "Should contain to field");
        assertTrue(json.contains("\"label\""), "Should contain label field");
        assertTrue(json.contains("\"summary_fields\""), "Should contain summary_fields with snake_case");
        assertTrue(json.contains("\"rel-123\""), "Should contain id value");
        assertTrue(json.contains("\"association\""), "Should contain type value");
        assertTrue(json.contains("\"entity_type\""), "Should contain nested entity_type");
        assertTrue(json.contains("\"Customer\""), "Should contain from name value");
        assertTrue(json.contains("\"Order\""), "Should contain to name value");
    }

    /**
     * Test ResolvedRelationshipDto deserialization from snake_case JSON.
     */
    @Test
    void resolvedRelationshipDto_deserializesFromSnakeCaseJson() throws Exception {
        // Arrange
        String json = """
            {
                "id": "rel-789",
                "type": "fk",
                "from": {
                    "entity_type": "physicalDataEntities",
                    "entity_id": "orders-table",
                    "name": "Orders"
                },
                "to": {
                    "entity_type": "physicalDataEntities",
                    "entity_id": "customers-table",
                    "name": "Customers"
                },
                "label": "belongs_to",
                "summary_fields": {
                    "cardinality": "MANY_TO_ONE",
                    "relationship_type": "DEPENDENCY"
                }
            }
            """;

        // Act
        ResolvedRelationshipDto dto = objectMapper.readValue(json, ResolvedRelationshipDto.class);

        // Assert
        assertNotNull(dto);
        assertEquals("rel-789", dto.id());
        assertEquals("fk", dto.type());
        assertEquals("belongs_to", dto.label());
        assertNotNull(dto.from());
        assertEquals("physicalDataEntities", dto.from().entityType());
        assertEquals("orders-table", dto.from().entityId());
        assertEquals("Orders", dto.from().name());
        assertNotNull(dto.to());
        assertEquals("physicalDataEntities", dto.to().entityType());
        assertEquals("customers-table", dto.to().entityId());
        assertEquals("Customers", dto.to().name());
        assertNotNull(dto.summaryFields());
        assertEquals("MANY_TO_ONE", dto.summaryFields().get("cardinality"));
        assertEquals("DEPENDENCY", dto.summaryFields().get("relationship_type"));
    }

    /**
     * Test summaryFields Map serialization with various value types.
     */
    @Test
    void resolvedRelationshipDto_summaryFieldsWithVariousTypes() throws Exception {
        // Arrange
        RelationshipEndpoint from = new RelationshipEndpoint("interfaces", "iface-1", "API");
        RelationshipEndpoint to = new RelationshipEndpoint("logicalDataEntities", "entity-1", "User");

        Map<String, Object> summaryFields = new HashMap<>();
        summaryFields.put("stringField", "value");
        summaryFields.put("intField", 42);
        summaryFields.put("boolField", true);
        summaryFields.put("nullField", null);

        ResolvedRelationshipDto dto = new ResolvedRelationshipDto(
            "rel-mixed",
            "schema_ref",
            from,
            to,
            "references",
            summaryFields
        );

        // Act
        String json = objectMapper.writeValueAsString(dto);

        // Assert
        assertTrue(json.contains("\"stringField\""), "Should contain stringField");
        assertTrue(json.contains("\"value\""), "Should contain string value");
        assertTrue(json.contains("42"), "Should contain int value");
        assertTrue(json.contains("true"), "Should contain boolean value");
    }

    /**
     * Test empty summaryFields Map handling for backward compatibility.
     */
    @Test
    void resolvedRelationshipDto_emptySummaryFieldsSerializesAsEmptyObject() throws Exception {
        // Arrange
        RelationshipEndpoint from = new RelationshipEndpoint("services", "svc-1", "UserService");
        RelationshipEndpoint to = new RelationshipEndpoint("interfaces", "iface-1", "UserAPI");

        ResolvedRelationshipDto dto = new ResolvedRelationshipDto(
            "rel-empty",
            "exposes",
            from,
            to,
            "exposes",
            Collections.emptyMap()
        );

        // Act
        String json = objectMapper.writeValueAsString(dto);

        // Assert
        assertTrue(json.contains("\"summary_fields\":{}") || json.contains("\"summary_fields\": {}"),
            "Empty summary_fields should serialize as empty object");
    }

    /**
     * Test ExpandResolveResponseDto with resolved_relationships field.
     * Verifies backward compatibility - empty list when no relationships exist.
     */
    @Test
    void expandResolveResponseDto_withResolvedRelationships_serializesCorrectly() throws Exception {
        // Arrange
        RelationshipEndpoint from = new RelationshipEndpoint("logicalDataEntities", "customer", "Customer");
        RelationshipEndpoint to = new RelationshipEndpoint("logicalDataEntities", "order", "Order");
        Map<String, Object> summaryFields = new HashMap<>();
        summaryFields.put("cardinality", "ONE_TO_MANY");

        ResolvedRelationshipDto relationship = new ResolvedRelationshipDto(
            "rel-1",
            "association",
            from,
            to,
            "has",
            summaryFields
        );

        ExpandResolveResponseDto response = new ExpandResolveResponseDto(
            List.of("logicalDataEntities::customer", "logicalDataEntities::order"),
            Collections.emptyList(),
            Collections.emptyList(),
            Collections.emptyList(),
            false,
            null,
            List.of(relationship)
        );

        // Act
        String json = objectMapper.writeValueAsString(response);

        // Assert
        assertTrue(json.contains("\"resolved_relationships\""),
            "Should contain resolved_relationships with snake_case");
        assertTrue(json.contains("\"rel-1\""), "Should contain relationship id");
        assertTrue(json.contains("\"association\""), "Should contain relationship type");
        assertTrue(json.contains("\"Customer\""), "Should contain from name");
        assertTrue(json.contains("\"Order\""), "Should contain to name");
    }

    /**
     * Test ExpandResolveResponseDto with empty relationships list for backward compatibility.
     */
    @Test
    void expandResolveResponseDto_emptyRelationships_serializesAsEmptyArray() throws Exception {
        // Arrange
        ExpandResolveResponseDto response = new ExpandResolveResponseDto(
            List.of("services::svc-1"),
            List.of("diagram-1"),
            Collections.emptyList(),
            Collections.emptyList(),
            false,
            null,
            Collections.emptyList()
        );

        // Act
        String json = objectMapper.writeValueAsString(response);

        // Assert
        assertTrue(json.contains("\"resolved_relationships\":[]") ||
                   json.contains("\"resolved_relationships\": []"),
            "Empty resolved_relationships should serialize as empty array");
    }

    /**
     * Test all supported relationship types serialize correctly.
     */
    @Test
    void resolvedRelationshipDto_allRelationshipTypes() throws Exception {
        // Arrange
        RelationshipEndpoint from = new RelationshipEndpoint("entities", "e1", "Entity1");
        RelationshipEndpoint to = new RelationshipEndpoint("entities", "e2", "Entity2");

        String[] relationshipTypes = {"fk", "association", "many_to_many", "uses", "exposes", "schema_ref", "contains"};

        for (String type : relationshipTypes) {
            ResolvedRelationshipDto dto = new ResolvedRelationshipDto(
                "rel-" + type,
                type,
                from,
                to,
                type + "_label",
                Collections.emptyMap()
            );

            // Act
            String json = objectMapper.writeValueAsString(dto);

            // Assert
            assertTrue(json.contains("\"type\":\"" + type + "\"") ||
                       json.contains("\"type\": \"" + type + "\""),
                "Should serialize relationship type: " + type);
        }
    }
}
