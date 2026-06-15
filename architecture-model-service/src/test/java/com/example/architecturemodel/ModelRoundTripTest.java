package com.example.architecturemodel;

import com.example.architecturemodel.model.dto.*;
import com.example.architecturemodel.model.dto.diagram.*;
import com.example.architecturemodel.model.dto.entity.*;
import com.example.architecturemodel.model.dto.relationship.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;

import java.io.IOException;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Tests JSON serialization/deserialization round-trip to ensure
 * DTO structure matches frontend TypeScript types exactly.
 */
class ModelRoundTripTest {

    private ObjectMapper objectMapper;

    @BeforeEach
    void setUp() {
        objectMapper = new ObjectMapper();
        objectMapper.setPropertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE);
        objectMapper.registerModule(new JavaTimeModule());
    }

    @Test
    void testModelJsonRoundTrip() throws IOException {
        // Load test model from JSON
        ClassPathResource resource = new ClassPathResource("test-model.json");
        ArchitectureModelDto model = objectMapper.readValue(resource.getInputStream(), ArchitectureModelDto.class);

        // Serialize back to JSON
        String json = objectMapper.writeValueAsString(model);

        // Deserialize again
        ArchitectureModelDto roundTripped = objectMapper.readValue(json, ArchitectureModelDto.class);

        // Verify structure preserved
        assertNotNull(roundTripped);
        assertNotNull(roundTripped.metaModel());
        assertNotNull(roundTripped.diagrams());

        // Verify entities
        MetaModelEntitiesDto entities = roundTripped.metaModel().entities();
        assertEquals(1, entities.businessUsers().size());
        assertEquals(1, entities.businessProcesses().size());
        assertEquals(1, entities.processActivities().size());
        assertEquals(1, entities.businessPoints().size());
        assertEquals(1, entities.applications().size());
        assertEquals(1, entities.appComponents().size());
        assertEquals(1, entities.services().size());
        assertEquals(1, entities.interfaces().size());
        assertEquals(1, entities.endpoints().size());
        assertEquals(1, entities.applicationPoints().size());
        assertEquals(1, entities.logicalDataEntities().size());
        assertEquals(2, entities.logicalDataAttributes().size());
        assertEquals(1, entities.physicalDataEntities().size());
        assertEquals(1, entities.physicalDataAttributes().size());
        assertEquals(1, entities.interactions().size());
        assertEquals(1, entities.appBusinessPoints().size());

        // Verify relationships
        MetaModelRelationshipsDto relationships = roundTripped.metaModel().relationships();
        assertEquals(1, relationships.businessUserBusinessPoints().size());
        assertEquals(1, relationships.applicationPointBusinessPoints().size());
        assertEquals(1, relationships.logicalDataEntityRelationships().size());
        assertEquals(1, relationships.logicalDataEntityPhysicalDataEntities().size());
        assertEquals(1, relationships.logicalDataAttributePhysicalDataAttributes().size());
        assertEquals(1, relationships.dataMovements().size());
        assertEquals(1, relationships.interfaceLogicalEntities().size());

        // Verify diagrams
        assertEquals(1, roundTripped.diagrams().size());
        DiagramDto diagram = roundTripped.diagrams().get(0);
        assertEquals(1, diagram.diagramNodes().size());
        assertEquals(1, diagram.diagramEdges().size());
        assertEquals(1, diagram.decorations().size());
        assertEquals(1, diagram.interactionEdges().size());
    }

    @Test
    void testBusinessUserFieldNames() throws IOException {
        String json = "{\"id\":\"bu-1\",\"name\":\"Test User\",\"description\":\"Desc\",\"tags\":\"tag1\"}";
        BusinessUserDto dto = objectMapper.readValue(json, BusinessUserDto.class);

        assertEquals("bu-1", dto.id());
        assertEquals("Test User", dto.name());
        assertEquals("Desc", dto.description());
        assertEquals("tag1", dto.tags());
    }

    @Test
    void testProcessActivityFieldNames() throws IOException {
        String json = "{" +
            "\"id\":\"pa-1\"," +
            "\"business_process_id\":\"bp-1\"," +
            "\"name\":\"Activity\"," +
            "\"description\":\"Desc\"," +
            "\"sequence_order\":1," +
            "\"frequency\":\"DAILY\"," +
            "\"actor_hint\":\"END_USER\"," +
            "\"user_interaction_level\":\"SIGNIFICANT\"," +
            "\"tags\":\"tag\"," +
            "\"valid_from\":\"2024-Q1\"," +
            "\"valid_to\":null" +
            "}";

        ProcessActivityDto dto = objectMapper.readValue(json, ProcessActivityDto.class);

        assertEquals("pa-1", dto.id());
        assertEquals("bp-1", dto.businessProcessId());
        assertEquals("END_USER", dto.actorHint());
        assertEquals("SIGNIFICANT", dto.userInteractionLevel());
        assertEquals("DAILY", dto.frequency());
        assertEquals(1, dto.sequenceOrder());
        assertEquals("2024-Q1", dto.validFrom());
        assertNull(dto.validTo());
    }

    @Test
    void testDiagramNodeWithStyleOverride() throws IOException {
        String json = "{" +
            "\"id\":\"dn-1\"," +
            "\"entity_type\":\"APPLICATION\"," +
            "\"entity_id\":\"app-1\"," +
            "\"pos_x\":100.0," +
            "\"pos_y\":200.0," +
            "\"width\":150.0," +
            "\"height\":80.0," +
            "\"auto_size\":false," +
            "\"z_index\":5," +
            "\"parent_node_id\":null," +
            "\"style_override\":{\"borderRadius\":\"5px\",\"opacity\":0.8}," +
            "\"render_style\":\"erd\"," +
            "\"embedded_attribute_ids\":[\"attr-1\",\"attr-2\"]" +
            "}";

        DiagramNodeDto dto = objectMapper.readValue(json, DiagramNodeDto.class);

        assertEquals("dn-1", dto.id());
        assertEquals("APPLICATION", dto.entityType());
        assertEquals(100.0, dto.posX());
        assertEquals(200.0, dto.posY());
        assertFalse(dto.autoSize());
        assertEquals(5, dto.zIndex());
        assertNotNull(dto.styleOverride());
        assertEquals("5px", dto.styleOverride().get("borderRadius"));
        assertEquals(0.8, dto.styleOverride().get("opacity"));
        assertEquals("erd", dto.renderStyle());
        assertEquals(2, dto.embeddedAttributeIds().size());
    }

    @Test
    void testDiagramEdgeWithEdgePoints() throws IOException {
        String json = "{" +
            "\"id\":\"de-1\"," +
            "\"relationship_type\":\"DATA_MOVEMENT\"," +
            "\"relationship_id\":\"dm-1\"," +
            "\"source_node_id\":\"dn-1\"," +
            "\"target_node_id\":\"dn-2\"," +
            "\"edge_points\":[" +
            "  {\"id\":\"ep-1\",\"sequence_order\":0,\"pos_x\":100.0,\"pos_y\":100.0}," +
            "  {\"id\":\"ep-2\",\"sequence_order\":1,\"pos_x\":200.0,\"pos_y\":100.0}," +
            "  {\"id\":\"ep-3\",\"sequence_order\":2,\"pos_x\":200.0,\"pos_y\":200.0}" +
            "]," +
            "\"arrow_end\":\"ARROW\"," +
            "\"subType\":\"MAIN\"," +
            "\"z_index\":110" +
            "}";

        DiagramEdgeDto dto = objectMapper.readValue(json, DiagramEdgeDto.class);

        assertEquals("de-1", dto.id());
        assertEquals("DATA_MOVEMENT", dto.relationshipType());
        assertEquals(3, dto.edgePoints().size());
        assertEquals("ep-1", dto.edgePoints().get(0).id());
        assertEquals(0, dto.edgePoints().get(0).sequenceOrder());
        assertEquals(100.0, dto.edgePoints().get(0).posX());
        assertEquals("MAIN", dto.subType());
        assertEquals(110, dto.zIndex());
    }

    @Test
    void testDecorationLineType() throws IOException {
        String json = "{" +
            "\"id\":\"dec-1\"," +
            "\"type\":\"ARROW_SINGLE\"," +
            "\"line_points\":[" +
            "  {\"x\":0.0,\"y\":0.0}," +
            "  {\"x\":100.0,\"y\":50.0}," +
            "  {\"x\":200.0,\"y\":0.0}" +
            "]," +
            "\"line_color\":\"#FF0000\"," +
            "\"arrow_end\":\"ARROW\"" +
            "}";

        DecorationDto dto = objectMapper.readValue(json, DecorationDto.class);

        assertEquals("dec-1", dto.id());
        assertEquals("ARROW_SINGLE", dto.type());
        assertEquals(3, dto.linePoints().size());
        assertEquals(0.0, dto.linePoints().get(0).x());
        assertEquals(0.0, dto.linePoints().get(0).y());
        assertEquals(100.0, dto.linePoints().get(1).x());
        assertEquals("#FF0000", dto.lineColor());
        assertEquals("ARROW", dto.arrowEnd());
    }

    @Test
    void testInteractionEdge() throws IOException {
        String json = "{" +
            "\"id\":\"ie-1\"," +
            "\"interaction_id\":\"int-1\"," +
            "\"relationship_type\":\"USER_INTERACTION\"," +
            "\"source_node_id\":\"dn-1\"," +
            "\"target_node_id\":\"dn-2\"," +
            "\"edge_points\":[{\"id\":\"ep-1\",\"sequence_order\":0,\"pos_x\":50.0,\"pos_y\":50.0}]," +
            "\"label_text\":\"User Flow\"," +
            "\"user_node_id\":\"dn-user\"," +
            "\"user_link_edge_points\":[{\"id\":\"ulep-1\",\"sequence_order\":0,\"pos_x\":25.0,\"pos_y\":25.0}]," +
            "\"line_style\":\"dotted\"" +
            "}";

        DiagramInteractionEdgeDto dto = objectMapper.readValue(json, DiagramInteractionEdgeDto.class);

        assertEquals("ie-1", dto.id());
        assertEquals("int-1", dto.interactionId());
        assertEquals("USER_INTERACTION", dto.relationshipType());
        assertEquals("User Flow", dto.labelText());
        assertEquals("dn-user", dto.userNodeId());
        assertEquals(1, dto.userLinkEdgePoints().size());
        assertEquals("dotted", dto.lineStyle());
    }

    @Test
    void testTemporalFieldsPreserved() throws IOException {
        String json = "{" +
            "\"id\":\"app-1\"," +
            "\"name\":\"Test App\"," +
            "\"description\":\"Desc\"," +
            "\"app_type\":\"WEB\"," +
            "\"status\":\"ACTIVE\"," +
            "\"tags\":\"\"," +
            "\"valid_from\":\"2024-Q1\"," +
            "\"valid_to\":\"2025-Q4\"" +
            "}";

        ApplicationDto dto = objectMapper.readValue(json, ApplicationDto.class);

        assertEquals("2024-Q1", dto.validFrom());
        assertEquals("2025-Q4", dto.validTo());

        // Round trip
        String serialized = objectMapper.writeValueAsString(dto);
        assertTrue(serialized.contains("\"valid_from\":\"2024-Q1\""));
        assertTrue(serialized.contains("\"valid_to\":\"2025-Q4\""));
    }

    @Test
    void testNullableFieldsHandling() throws IOException {
        // Test with minimal fields
        String json = "{" +
            "\"id\":\"lde-1\"," +
            "\"name\":\"Entity\"," +
            "\"description\":null," +
            "\"tags\":null," +
            "\"valid_from\":null," +
            "\"valid_to\":null" +
            "}";

        LogicalDataEntityDto dto = objectMapper.readValue(json, LogicalDataEntityDto.class);

        assertEquals("lde-1", dto.id());
        assertEquals("Entity", dto.name());
        assertNull(dto.description());
        assertNull(dto.validFrom());
        assertNull(dto.validTo());
    }
}
