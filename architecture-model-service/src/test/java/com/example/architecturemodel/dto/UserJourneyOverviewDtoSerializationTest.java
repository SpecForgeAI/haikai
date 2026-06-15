package com.example.architecturemodel.dto;

import com.example.architecturemodel.model.dto.diagram.UserJourneyOverviewDiagramDto;
import com.example.architecturemodel.model.dto.diagram.UserJourneyOverviewEdgeDto;
import com.example.architecturemodel.model.dto.diagram.UserJourneyOverviewHeaderDto;
import com.example.architecturemodel.model.dto.diagram.UserJourneyOverviewLaneDto;
import com.example.architecturemodel.model.dto.diagram.UserJourneyOverviewNodeDto;
import com.example.architecturemodel.model.dto.diagram.UserJourneyOverviewNodeDto.UserJourneyOverviewNodeMetadataDto;
import com.example.architecturemodel.model.dto.diagram.UserJourneyOverviewNodeDto.UserJourneyOverviewNodeLinkDto;
import com.example.architecturemodel.model.dto.diagram.UserJourneyOverviewRenderHintsDto;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Tests for the User Journey Overview DTO records: round-trip instantiation
 * and JSON serialization verifying correct snake_case keys per contract v1.
 *
 * Spec: User Journey Overview Parent Diagram Generation (Task Group 1, Task 1.1)
 */
class UserJourneyOverviewDtoSerializationTest {

    private ObjectMapper objectMapper;

    private static final UserJourneyOverviewNodeLinkDto DEFAULT_UNLINKED =
        new UserJourneyOverviewNodeLinkDto(null, null, "UNLINKED");

    @BeforeEach
    void setUp() {
        objectMapper = new ObjectMapper();
    }

    // ============================================================================
    // Test 1: UserJourneyOverviewDiagramDto record round-trip
    // ============================================================================

    @Test
    @DisplayName("UserJourneyOverviewDiagramDto round-trip -- instantiate with all fields, verify getters return correct values")
    void overviewDiagramDto_roundTrip() {
        UserJourneyOverviewHeaderDto header = new UserJourneyOverviewHeaderDto(
            "bu-001", "Customer Rep", "Customer Rep Journey Overview"
        );
        UserJourneyOverviewLaneDto lane = new UserJourneyOverviewLaneDto("bp-001", "Onboarding", 0);
        UserJourneyOverviewNodeDto node = new UserJourneyOverviewNodeDto(
            "uj-001", "bp-001", "Registration", "User registers an account",
            "bu-001", "Customer Rep", "bp-001", "Onboarding",
            new UserJourneyOverviewNodeMetadataDto(5, 3, 1, 2),
            DEFAULT_UNLINKED
        );
        UserJourneyOverviewEdgeDto edge = new UserJourneyOverviewEdgeDto(
            "link-001", "uj-001", "uj-002", "SEQUENTIAL", "Next Step", "Goes to next step"
        );
        UserJourneyOverviewRenderHintsDto hints = new UserJourneyOverviewRenderHintsDto(
            "VERTICAL", "LEFT_TO_RIGHT", true, true, true, true
        );

        UserJourneyOverviewDiagramDto dto = new UserJourneyOverviewDiagramDto(
            "USER_JOURNEY_OVERVIEW", "1.0", header,
            List.of(lane), List.of(node), List.of(edge), hints
        );

        assertThat(dto.diagramType()).isEqualTo("USER_JOURNEY_OVERVIEW");
        assertThat(dto.version()).isEqualTo("1.0");
        assertThat(dto.overview()).isEqualTo(header);
        assertThat(dto.overview().businessUserId()).isEqualTo("bu-001");
        assertThat(dto.overview().businessUserName()).isEqualTo("Customer Rep");
        assertThat(dto.overview().title()).isEqualTo("Customer Rep Journey Overview");
        assertThat(dto.lanes()).hasSize(1);
        assertThat(dto.lanes().get(0).id()).isEqualTo("bp-001");
        assertThat(dto.lanes().get(0).name()).isEqualTo("Onboarding");
        assertThat(dto.lanes().get(0).order()).isEqualTo(0);
        assertThat(dto.nodes()).hasSize(1);
        assertThat(dto.nodes().get(0).id()).isEqualTo("uj-001");
        assertThat(dto.nodes().get(0).laneId()).isEqualTo("bp-001");
        assertThat(dto.nodes().get(0).metadata().stepCount()).isEqualTo(5);
        assertThat(dto.edges()).hasSize(1);
        assertThat(dto.edges().get(0).sourceNodeId()).isEqualTo("uj-001");
        assertThat(dto.edges().get(0).targetNodeId()).isEqualTo("uj-002");
        assertThat(dto.renderHints()).isEqualTo(hints);
        assertThat(dto.renderHints().laneAxis()).isEqualTo("VERTICAL");
        assertThat(dto.renderHints().flowDirection()).isEqualTo("LEFT_TO_RIGHT");
    }

    // ============================================================================
    // Test 2: UserJourneyOverviewDiagramDto JSON serialization produces correct
    //         snake_case keys
    // ============================================================================

    @Test
    @DisplayName("UserJourneyOverviewDiagramDto JSON serialization produces correct snake_case keys")
    void overviewDiagramDto_jsonSerialization_snakeCaseKeys() throws Exception {
        UserJourneyOverviewHeaderDto header = new UserJourneyOverviewHeaderDto(
            "bu-002", "Admin User", "Admin User Journey Overview"
        );
        UserJourneyOverviewLaneDto lane = new UserJourneyOverviewLaneDto("bp-010", "Administration", 0);
        UserJourneyOverviewNodeDto node = new UserJourneyOverviewNodeDto(
            "uj-010", "bp-010", "Manage Users", "Admin manages user accounts",
            "bu-002", "Admin User", "bp-010", "Administration",
            new UserJourneyOverviewNodeMetadataDto(3, 2, 0, 1),
            DEFAULT_UNLINKED
        );
        UserJourneyOverviewEdgeDto edge = new UserJourneyOverviewEdgeDto(
            "link-010", "uj-010", "uj-011", "DEPENDS_ON", "Depends", "Dependency"
        );
        UserJourneyOverviewRenderHintsDto hints = new UserJourneyOverviewRenderHintsDto(
            "VERTICAL", "LEFT_TO_RIGHT", true, true, false, true
        );

        UserJourneyOverviewDiagramDto dto = new UserJourneyOverviewDiagramDto(
            "USER_JOURNEY_OVERVIEW", "1.0", header,
            List.of(lane), List.of(node), List.of(edge), hints
        );

        String json = objectMapper.writeValueAsString(dto);
        JsonNode root = objectMapper.readTree(json);

        // Top-level snake_case keys
        assertThat(root.has("diagram_type")).isTrue();
        assertThat(root.get("diagram_type").asText()).isEqualTo("USER_JOURNEY_OVERVIEW");
        assertThat(root.has("version")).isTrue();
        assertThat(root.get("version").asText()).isEqualTo("1.0");
        assertThat(root.has("overview")).isTrue();
        assertThat(root.has("lanes")).isTrue();
        assertThat(root.has("nodes")).isTrue();
        assertThat(root.has("edges")).isTrue();
        assertThat(root.has("render_hints")).isTrue();

        // Verify camelCase is NOT present at top level
        assertThat(root.has("diagramType")).isFalse();
        assertThat(root.has("renderHints")).isFalse();

        // Verify overview sub-object uses snake_case keys
        JsonNode overviewNode = root.get("overview");
        assertThat(overviewNode.has("business_user_id")).isTrue();
        assertThat(overviewNode.has("business_user_name")).isTrue();
        assertThat(overviewNode.has("title")).isTrue();
        assertThat(overviewNode.has("businessUserId")).isFalse();
        assertThat(overviewNode.has("businessUserName")).isFalse();
    }

    // ============================================================================
    // Test 3: UserJourneyOverviewNodeDto metadata sub-object serializes correctly
    // ============================================================================

    @Test
    @DisplayName("UserJourneyOverviewNodeDto metadata sub-object serializes with correct snake_case keys")
    void overviewNodeDto_metadataSerialization() throws Exception {
        UserJourneyOverviewNodeMetadataDto metadata = new UserJourneyOverviewNodeMetadataDto(
            8, 4, 2, 3
        );
        UserJourneyOverviewNodeDto node = new UserJourneyOverviewNodeDto(
            "uj-020", "bp-020", "Checkout", "Customer completes checkout",
            "bu-003", "Shopper", "bp-020", "Sales",
            metadata,
            DEFAULT_UNLINKED
        );

        String json = objectMapper.writeValueAsString(node);
        JsonNode root = objectMapper.readTree(json);

        // Node-level snake_case keys
        assertThat(root.has("id")).isTrue();
        assertThat(root.has("lane_id")).isTrue();
        assertThat(root.has("name")).isTrue();
        assertThat(root.has("description")).isTrue();
        assertThat(root.has("primary_business_user_id")).isTrue();
        assertThat(root.has("primary_business_user_name")).isTrue();
        assertThat(root.has("parent_business_process_id")).isTrue();
        assertThat(root.has("parent_business_process_name")).isTrue();
        assertThat(root.has("metadata")).isTrue();

        // Verify camelCase is NOT present
        assertThat(root.has("laneId")).isFalse();
        assertThat(root.has("primaryBusinessUserId")).isFalse();
        assertThat(root.has("primaryBusinessUserName")).isFalse();
        assertThat(root.has("parentBusinessProcessId")).isFalse();
        assertThat(root.has("parentBusinessProcessName")).isFalse();

        // Metadata sub-object snake_case keys
        JsonNode metadataNode = root.get("metadata");
        assertThat(metadataNode.has("step_count")).isTrue();
        assertThat(metadataNode.get("step_count").asInt()).isEqualTo(8);
        assertThat(metadataNode.has("application_count")).isTrue();
        assertThat(metadataNode.get("application_count").asInt()).isEqualTo(4);
        assertThat(metadataNode.has("relationship_in_count")).isTrue();
        assertThat(metadataNode.get("relationship_in_count").asInt()).isEqualTo(2);
        assertThat(metadataNode.has("relationship_out_count")).isTrue();
        assertThat(metadataNode.get("relationship_out_count").asInt()).isEqualTo(3);

        // Verify camelCase is NOT present in metadata
        assertThat(metadataNode.has("stepCount")).isFalse();
        assertThat(metadataNode.has("applicationCount")).isFalse();
        assertThat(metadataNode.has("relationshipInCount")).isFalse();
        assertThat(metadataNode.has("relationshipOutCount")).isFalse();
    }

    // ============================================================================
    // Test 4: UserJourneyOverviewRenderHintsDto serializes with correct field names
    // ============================================================================

    @Test
    @DisplayName("UserJourneyOverviewRenderHintsDto serializes with correct snake_case field names")
    void overviewRenderHintsDto_serialization() throws Exception {
        UserJourneyOverviewRenderHintsDto hints = new UserJourneyOverviewRenderHintsDto(
            "VERTICAL", "LEFT_TO_RIGHT", true, true, false, true
        );

        String json = objectMapper.writeValueAsString(hints);
        JsonNode root = objectMapper.readTree(json);

        // All render hints snake_case keys present
        assertThat(root.has("lane_axis")).isTrue();
        assertThat(root.get("lane_axis").asText()).isEqualTo("VERTICAL");
        assertThat(root.has("flow_direction")).isTrue();
        assertThat(root.get("flow_direction").asText()).isEqualTo("LEFT_TO_RIGHT");
        assertThat(root.has("show_title")).isTrue();
        assertThat(root.get("show_title").asBoolean()).isTrue();
        assertThat(root.has("show_lane_headers")).isTrue();
        assertThat(root.get("show_lane_headers").asBoolean()).isTrue();
        assertThat(root.has("show_node_description")).isTrue();
        assertThat(root.get("show_node_description").asBoolean()).isFalse();
        assertThat(root.has("show_relationship_labels")).isTrue();
        assertThat(root.get("show_relationship_labels").asBoolean()).isTrue();

        // Verify camelCase is NOT present
        assertThat(root.has("laneAxis")).isFalse();
        assertThat(root.has("flowDirection")).isFalse();
        assertThat(root.has("showTitle")).isFalse();
        assertThat(root.has("showLaneHeaders")).isFalse();
        assertThat(root.has("showNodeDescription")).isFalse();
        assertThat(root.has("showRelationshipLabels")).isFalse();
    }
}
