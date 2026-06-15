package com.example.architecturemodel.dto;

import com.example.architecturemodel.model.dto.interface_discovery.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.Arrays;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Tests for Interface Discovery DTOs - verifies JSON serialization,
 * null handling, and deterministic ordering.
 */
class InterfaceDiscoveryDtoTest {

    private ObjectMapper objectMapper;

    @BeforeEach
    void setUp() {
        objectMapper = new ObjectMapper();
    }

    /**
     * Test 1: InterfaceSummaryDto JSON serialization
     * Verifies that all fields serialize correctly with proper naming.
     */
    @Test
    void testInterfaceSummaryDtoJsonSerialization() throws Exception {
        InterfaceSummaryDto dto = new InterfaceSummaryDto(
            "ifc-001",
            "Customer API",
            "REST",
            "svc-001",
            "Customer Service",
            "app-001",
            "Customer Portal",
            5
        );

        String json = objectMapper.writeValueAsString(dto);

        // Verify field names in JSON
        assertTrue(json.contains("\"interfaceId\":\"ifc-001\""));
        assertTrue(json.contains("\"interfaceName\":\"Customer API\""));
        assertTrue(json.contains("\"interfaceType\":\"REST\""));
        assertTrue(json.contains("\"serviceId\":\"svc-001\""));
        assertTrue(json.contains("\"serviceName\":\"Customer Service\""));
        assertTrue(json.contains("\"applicationId\":\"app-001\""));
        assertTrue(json.contains("\"applicationName\":\"Customer Portal\""));
        assertTrue(json.contains("\"endpointCount\":5"));

        // Round-trip deserialization
        InterfaceSummaryDto deserialized = objectMapper.readValue(json, InterfaceSummaryDto.class);
        assertEquals(dto, deserialized);
    }

    /**
     * Test 2: InterfaceOasContextDto JSON serialization with nested objects
     * Verifies the @JsonProperty("interface") annotation works correctly
     * and nested objects serialize properly.
     */
    @Test
    void testInterfaceOasContextDtoJsonSerializationWithNestedObjects() throws Exception {
        InterfaceDetailDto interfaceInfo = new InterfaceDetailDto(
            "ifc-001",
            "Customer API",
            "Handles customer operations",
            "REST",
            "https://spec.example.com/customer-api",
            "customer,api",
            "2024-Q1",
            null
        );

        ServiceDetailDto service = new ServiceDetailDto(
            "svc-001",
            "Customer Service",
            "Customer domain service",
            "BACKEND",
            "microservice"
        );

        ApplicationDetailDto application = new ApplicationDetailDto(
            "app-001",
            "Customer Portal",
            "Main customer facing application",
            "WEB",
            "ACTIVE",
            "portal,customer"
        );

        InterfaceEndpointDto endpoint = new InterfaceEndpointDto(
            "ep-001",
            "Get Customer",
            "Retrieves customer by ID",
            "REST",
            "/customers/{id}",
            "HTTPS",
            "GET",
            "INBOUND",
            "ACTIVE",
            "1.0",
            "read",
            "2024-Q1"
        );

        LogicalAttributeDto attribute = new LogicalAttributeDto(
            "attr-001",
            "customerId",
            "Unique customer identifier",
            "STRING",
            true,
            false,
            "primary"
        );

        LogicalEntitySchemaDto logicalEntity = new LogicalEntitySchemaDto(
            "le-001",
            "Customer",
            "Customer entity",
            "domain",
            "2024-Q1",
            null,
            List.of(attribute)
        );

        InterfaceOasContextDto dto = new InterfaceOasContextDto(
            interfaceInfo,
            service,
            application,
            List.of(endpoint),
            List.of(logicalEntity),
            null
        );

        String json = objectMapper.writeValueAsString(dto);

        // Verify "interface" field name (not "interfaceInfo")
        assertTrue(json.contains("\"interface\":{"));
        assertFalse(json.contains("\"interfaceInfo\""));

        // Verify nested objects are present
        assertTrue(json.contains("\"service\":{"));
        assertTrue(json.contains("\"application\":{"));
        assertTrue(json.contains("\"endpoints\":["));
        assertTrue(json.contains("\"logicalEntities\":["));
        assertTrue(json.contains("\"attributes\":["));

        // Verify some nested field values
        assertTrue(json.contains("\"id\":\"ifc-001\""));
        assertTrue(json.contains("\"name\":\"Customer API\""));
        assertTrue(json.contains("\"serviceType\":\"BACKEND\""));
        assertTrue(json.contains("\"appType\":\"WEB\""));
        assertTrue(json.contains("\"operationVerb\":\"GET\""));
        assertTrue(json.contains("\"isPrimaryKey\":true"));

        // Round-trip deserialization
        InterfaceOasContextDto deserialized = objectMapper.readValue(json, InterfaceOasContextDto.class);
        assertEquals(dto.interfaceInfo(), deserialized.interfaceInfo());
        assertEquals(dto.service(), deserialized.service());
        assertEquals(dto.application(), deserialized.application());
        assertEquals(dto.endpoints().size(), deserialized.endpoints().size());
        assertEquals(dto.logicalEntities().size(), deserialized.logicalEntities().size());
    }

    /**
     * Test 3: Null handling for optional fields
     * Verifies that nullable fields serialize as null and don't cause errors.
     */
    @Test
    void testNullHandlingForOptionalFields() throws Exception {
        // InterfaceSummaryDto with null optional fields
        InterfaceSummaryDto summaryDto = new InterfaceSummaryDto(
            "ifc-001",
            "Standalone API",
            "REST",
            null,  // serviceId
            null,  // serviceName
            null,  // applicationId
            null,  // applicationName
            0
        );

        String summaryJson = objectMapper.writeValueAsString(summaryDto);
        assertTrue(summaryJson.contains("\"serviceId\":null"));
        assertTrue(summaryJson.contains("\"serviceName\":null"));
        assertTrue(summaryJson.contains("\"applicationId\":null"));
        assertTrue(summaryJson.contains("\"applicationName\":null"));

        InterfaceSummaryDto deserializedSummary = objectMapper.readValue(summaryJson, InterfaceSummaryDto.class);
        assertNull(deserializedSummary.serviceId());
        assertNull(deserializedSummary.serviceName());

        // InterfaceDetailDto with null optional fields
        InterfaceDetailDto detailDto = new InterfaceDetailDto(
            "ifc-002",
            "Minimal Interface",
            null,  // description
            null,  // interfaceType
            null,  // specLink
            null,  // tags
            null,  // validFrom
            null   // validTo
        );

        String detailJson = objectMapper.writeValueAsString(detailDto);
        assertTrue(detailJson.contains("\"description\":null"));
        assertTrue(detailJson.contains("\"interfaceType\":null"));
        assertTrue(detailJson.contains("\"specLink\":null"));

        // InterfaceOasContextDto with null service, application, and notes
        InterfaceOasContextDto contextDto = new InterfaceOasContextDto(
            detailDto,
            null,  // service
            null,  // application
            List.of(),
            List.of(),
            null   // notes
        );

        String contextJson = objectMapper.writeValueAsString(contextDto);
        assertTrue(contextJson.contains("\"service\":null"));
        assertTrue(contextJson.contains("\"application\":null"));
        assertTrue(contextJson.contains("\"notes\":null"));

        InterfaceOasContextDto deserializedContext = objectMapper.readValue(contextJson, InterfaceOasContextDto.class);
        assertNull(deserializedContext.service());
        assertNull(deserializedContext.application());
        assertNull(deserializedContext.notes());

        // LogicalAttributeDto with null boolean fields
        LogicalAttributeDto attrDto = new LogicalAttributeDto(
            "attr-001",
            "fieldName",
            null,  // description
            null,  // dataType
            null,  // isPrimaryKey
            null,  // isNullable
            null   // tags
        );

        String attrJson = objectMapper.writeValueAsString(attrDto);
        assertTrue(attrJson.contains("\"isPrimaryKey\":null"));
        assertTrue(attrJson.contains("\"isNullable\":null"));

        LogicalAttributeDto deserializedAttr = objectMapper.readValue(attrJson, LogicalAttributeDto.class);
        assertNull(deserializedAttr.isPrimaryKey());
        assertNull(deserializedAttr.isNullable());
    }

    /**
     * Test 4: Deterministic ordering in collections
     * Verifies that lists maintain their order during serialization/deserialization.
     */
    @Test
    void testDeterministicOrderingInCollections() throws Exception {
        // Create endpoints with specific ordering
        InterfaceEndpointDto ep1 = new InterfaceEndpointDto(
            "ep-001", "Delete Customer", null, null, "/customers/{id}", null,
            "DELETE", null, null, null, null, null
        );
        InterfaceEndpointDto ep2 = new InterfaceEndpointDto(
            "ep-002", "Get Customer", null, null, "/customers/{id}", null,
            "GET", null, null, null, null, null
        );
        InterfaceEndpointDto ep3 = new InterfaceEndpointDto(
            "ep-003", "List Customers", null, null, "/customers", null,
            "GET", null, null, null, null, null
        );
        InterfaceEndpointDto ep4 = new InterfaceEndpointDto(
            "ep-004", "Create Customer", null, null, "/customers", null,
            "POST", null, null, null, null, null
        );

        List<InterfaceEndpointDto> endpoints = Arrays.asList(ep1, ep2, ep3, ep4);

        // Create logical attributes in specific order
        LogicalAttributeDto attr1 = new LogicalAttributeDto(
            "attr-001", "id", null, "STRING", true, false, null
        );
        LogicalAttributeDto attr2 = new LogicalAttributeDto(
            "attr-002", "email", null, "STRING", false, true, null
        );
        LogicalAttributeDto attr3 = new LogicalAttributeDto(
            "attr-003", "name", null, "STRING", false, false, null
        );

        List<LogicalAttributeDto> attributes = Arrays.asList(attr1, attr2, attr3);

        LogicalEntitySchemaDto entity1 = new LogicalEntitySchemaDto(
            "le-001", "Customer", null, null, null, null, attributes
        );
        LogicalEntitySchemaDto entity2 = new LogicalEntitySchemaDto(
            "le-002", "Address", null, null, null, null, List.of()
        );

        List<LogicalEntitySchemaDto> entities = Arrays.asList(entity1, entity2);

        InterfaceDetailDto interfaceInfo = new InterfaceDetailDto(
            "ifc-001", "Test API", null, null, null, null, null, null
        );

        InterfaceOasContextDto dto = new InterfaceOasContextDto(
            interfaceInfo,
            null,
            null,
            endpoints,
            entities,
            null
        );

        String json = objectMapper.writeValueAsString(dto);

        // Deserialize and verify order is preserved
        InterfaceOasContextDto deserialized = objectMapper.readValue(json, InterfaceOasContextDto.class);

        // Verify endpoints order
        assertEquals(4, deserialized.endpoints().size());
        assertEquals("ep-001", deserialized.endpoints().get(0).id());
        assertEquals("DELETE", deserialized.endpoints().get(0).operationVerb());
        assertEquals("ep-002", deserialized.endpoints().get(1).id());
        assertEquals("GET", deserialized.endpoints().get(1).operationVerb());
        assertEquals("ep-003", deserialized.endpoints().get(2).id());
        assertEquals("ep-004", deserialized.endpoints().get(3).id());
        assertEquals("POST", deserialized.endpoints().get(3).operationVerb());

        // Verify logical entities order
        assertEquals(2, deserialized.logicalEntities().size());
        assertEquals("le-001", deserialized.logicalEntities().get(0).id());
        assertEquals("Customer", deserialized.logicalEntities().get(0).name());
        assertEquals("le-002", deserialized.logicalEntities().get(1).id());
        assertEquals("Address", deserialized.logicalEntities().get(1).name());

        // Verify attributes order within entity
        assertEquals(3, deserialized.logicalEntities().get(0).attributes().size());
        assertEquals("attr-001", deserialized.logicalEntities().get(0).attributes().get(0).id());
        assertEquals("id", deserialized.logicalEntities().get(0).attributes().get(0).name());
        assertEquals("attr-002", deserialized.logicalEntities().get(0).attributes().get(1).id());
        assertEquals("email", deserialized.logicalEntities().get(0).attributes().get(1).name());
        assertEquals("attr-003", deserialized.logicalEntities().get(0).attributes().get(2).id());
        assertEquals("name", deserialized.logicalEntities().get(0).attributes().get(2).name());

        // Verify OasNotesDto collection order
        OasNotesDto notes = new OasNotesDto(
            Arrays.asList("/api/v1", "/api/v2", "/api"),
            Arrays.asList("https://api.example.com", "https://staging.example.com")
        );

        String notesJson = objectMapper.writeValueAsString(notes);
        OasNotesDto deserializedNotes = objectMapper.readValue(notesJson, OasNotesDto.class);

        assertEquals(3, deserializedNotes.basePathCandidates().size());
        assertEquals("/api/v1", deserializedNotes.basePathCandidates().get(0));
        assertEquals("/api/v2", deserializedNotes.basePathCandidates().get(1));
        assertEquals("/api", deserializedNotes.basePathCandidates().get(2));

        assertEquals(2, deserializedNotes.serverUrlCandidates().size());
        assertEquals("https://api.example.com", deserializedNotes.serverUrlCandidates().get(0));
        assertEquals("https://staging.example.com", deserializedNotes.serverUrlCandidates().get(1));
    }
}
