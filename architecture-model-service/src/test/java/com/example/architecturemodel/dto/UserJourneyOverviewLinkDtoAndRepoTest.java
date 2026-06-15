package com.example.architecturemodel.dto;

import com.example.architecturemodel.model.dto.diagram.UserJourneyOverviewNodeDto;
import com.example.architecturemodel.model.dto.diagram.UserJourneyOverviewNodeDto.UserJourneyOverviewNodeLinkDto;
import com.example.architecturemodel.model.dto.diagram.UserJourneyOverviewNodeDto.UserJourneyOverviewNodeMetadataDto;
import com.example.architecturemodel.model.entity.DiagramEntity;
import com.example.architecturemodel.repository.diagram.DiagramRepository;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

/**
 * Focused tests for Task Group 1: Repository Query and DTO Contract.
 *
 * Spec: User Journey Overview Parent-Child Diagram Linking
 * Task 1.1: 4 focused tests for the new repository method and DTO structure.
 *
 * Test 1: findByModelFileIdAndDiagramType returns only USER_JOURNEY diagrams for a given modelFileId
 * Test 2: findByModelFileIdAndDiagramType returns empty list when no diagrams of given type exist
 * Test 3: UserJourneyOverviewNodeLinkDto serializes correctly with @JsonProperty annotations
 * Test 4: UserJourneyOverviewNodeDto includes link sub-record in JSON output and it is never null
 */
@ExtendWith(MockitoExtension.class)
class UserJourneyOverviewLinkDtoAndRepoTest {

    @Mock
    private DiagramRepository diagramRepository;

    private ObjectMapper objectMapper;

    @BeforeEach
    void setUp() {
        objectMapper = new ObjectMapper();
    }

    // ============================================================================
    // Test 1: findByModelFileIdAndDiagramType returns only USER_JOURNEY diagrams
    // ============================================================================

    @Test
    @DisplayName("findByModelFileIdAndDiagramType returns only USER_JOURNEY diagrams for a given modelFileId")
    void findByModelFileIdAndDiagramType_returnsOnlyUserJourneyDiagrams() {
        // Given: repository returns 2 USER_JOURNEY diagrams for the model file
        DiagramEntity ujDiag1 = DiagramEntity.builder()
            .id("diag-uj-1").modelFileId("mf-001").name("Journey A")
            .diagramType("USER_JOURNEY").build();
        DiagramEntity ujDiag2 = DiagramEntity.builder()
            .id("diag-uj-2").modelFileId("mf-001").name("Journey B")
            .diagramType("USER_JOURNEY").build();

        when(diagramRepository.findByModelFileIdAndDiagramType("mf-001", "USER_JOURNEY"))
            .thenReturn(List.of(ujDiag1, ujDiag2));

        // When
        List<DiagramEntity> result = diagramRepository.findByModelFileIdAndDiagramType("mf-001", "USER_JOURNEY");

        // Then: only USER_JOURNEY diagrams returned
        assertThat(result).hasSize(2);
        assertThat(result).allSatisfy(d -> assertThat(d.getDiagramType()).isEqualTo("USER_JOURNEY"));
        assertThat(result.get(0).getId()).isEqualTo("diag-uj-1");
        assertThat(result.get(1).getId()).isEqualTo("diag-uj-2");
    }

    // ============================================================================
    // Test 2: findByModelFileIdAndDiagramType returns empty list when no matches
    // ============================================================================

    @Test
    @DisplayName("findByModelFileIdAndDiagramType returns empty list when no diagrams of given type exist")
    void findByModelFileIdAndDiagramType_returnsEmptyListWhenNoMatchingType() {
        // Given: repository returns empty list (no USER_JOURNEY diagrams for this model file)
        when(diagramRepository.findByModelFileIdAndDiagramType("mf-002", "USER_JOURNEY"))
            .thenReturn(List.of());

        // When
        List<DiagramEntity> result = diagramRepository.findByModelFileIdAndDiagramType("mf-002", "USER_JOURNEY");

        // Then
        assertThat(result).isEmpty();
    }

    // ============================================================================
    // Test 3: UserJourneyOverviewNodeLinkDto serializes correctly with @JsonProperty
    // ============================================================================

    @Test
    @DisplayName("UserJourneyOverviewNodeLinkDto serializes correctly with @JsonProperty annotations")
    void linkDto_serializesWithSnakeCaseJsonPropertyAnnotations() throws Exception {
        // Given: a LINKED link sub-record
        UserJourneyOverviewNodeLinkDto linkDto = new UserJourneyOverviewNodeLinkDto(
            "diag-child-001", "Child Journey Diagram", "LINKED"
        );

        // When
        String json = objectMapper.writeValueAsString(linkDto);
        JsonNode root = objectMapper.readTree(json);

        // Then: snake_case keys from @JsonProperty annotations
        assertThat(root.has("linked_diagram_id")).isTrue();
        assertThat(root.get("linked_diagram_id").asText()).isEqualTo("diag-child-001");

        assertThat(root.has("linked_diagram_name")).isTrue();
        assertThat(root.get("linked_diagram_name").asText()).isEqualTo("Child Journey Diagram");

        assertThat(root.has("link_status")).isTrue();
        assertThat(root.get("link_status").asText()).isEqualTo("LINKED");

        // Verify camelCase is NOT present
        assertThat(root.has("linkedDiagramId")).isFalse();
        assertThat(root.has("linkedDiagramName")).isFalse();
        assertThat(root.has("linkStatus")).isFalse();
    }

    // ============================================================================
    // Test 4: UserJourneyOverviewNodeDto includes link sub-record in JSON output
    //         and it is never null
    // ============================================================================

    @Test
    @DisplayName("UserJourneyOverviewNodeDto includes link sub-record in JSON output and it is never null")
    void nodeDto_includesLinkSubRecordInJsonOutput_neverNull() throws Exception {
        // Given: a node with an UNLINKED link sub-record (default state)
        UserJourneyOverviewNodeLinkDto linkDto = new UserJourneyOverviewNodeLinkDto(
            null, null, "UNLINKED"
        );
        UserJourneyOverviewNodeMetadataDto metadata = new UserJourneyOverviewNodeMetadataDto(
            3, 2, 1, 0
        );
        UserJourneyOverviewNodeDto node = new UserJourneyOverviewNodeDto(
            "uj-001", "bp-001", "Test Journey", "A test journey",
            "bu-001", "Test User", "bp-001", "Process One",
            metadata, linkDto
        );

        // When
        String json = objectMapper.writeValueAsString(node);
        JsonNode root = objectMapper.readTree(json);

        // Then: link sub-record is present in JSON output
        assertThat(root.has("link")).isTrue();
        JsonNode linkNode = root.get("link");
        assertThat(linkNode.isNull()).isFalse();

        // link_status is always populated
        assertThat(linkNode.has("link_status")).isTrue();
        assertThat(linkNode.get("link_status").asText()).isEqualTo("UNLINKED");

        // linked_diagram_id and linked_diagram_name are null for UNLINKED
        assertThat(linkNode.has("linked_diagram_id")).isTrue();
        assertThat(linkNode.get("linked_diagram_id").isNull()).isTrue();

        assertThat(linkNode.has("linked_diagram_name")).isTrue();
        assertThat(linkNode.get("linked_diagram_name").isNull()).isTrue();

        // Verify the link sub-record getter on the record itself is not null
        assertThat(node.link()).isNotNull();
        assertThat(node.link().linkStatus()).isEqualTo("UNLINKED");
    }
}
