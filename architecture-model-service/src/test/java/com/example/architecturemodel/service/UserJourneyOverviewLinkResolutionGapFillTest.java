package com.example.architecturemodel.service;

import com.example.architecturemodel.model.dto.diagram.*;
import com.example.architecturemodel.model.entity.*;
import com.example.architecturemodel.repository.ModelFileRepository;
import com.example.architecturemodel.repository.diagram.DiagramRepository;
import com.example.architecturemodel.repository.entity.*;
import com.example.architecturemodel.repository.relationship.UserJourneyLinkRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.*;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.Mockito.when;

/**
 * Gap-fill tests for Task Group 6: Test Review and Critical Gap Fill.
 *
 * Spec: User Journey Overview Parent-Child Diagram Linking
 * Task 6.3: Strategic tests filling gaps in Task Groups 1-2 coverage.
 *
 * Gap 1: projectOverview() with zero journeys still returns valid empty DTO (regression guard)
 * Gap 2: Multiple nodes with mixed link statuses (LINKED, UNLINKED, AMBIGUOUS_RESOLVED) in a single overview
 * Gap 3: Diagrams with blank source_user_journey_id are skipped (defensive parsing edge case)
 * Gap 4: projectOverview() end-to-end produces correct link sub-records for multiple nodes
 */
@ExtendWith(MockitoExtension.class)
class UserJourneyOverviewLinkResolutionGapFillTest {

    @Mock
    private UserJourneyRepository userJourneyRepository;
    @Mock
    private UserJourneyLinkRepository userJourneyLinkRepository;
    @Mock
    private BusinessUserRepository businessUserRepository;
    @Mock
    private BusinessProcessRepository businessProcessRepository;
    @Mock
    private ActivityStepRepository activityStepRepository;
    @Mock
    private ModelFileRepository modelFileRepository;
    @Mock
    private DiagramRepository diagramRepository;

    private UserJourneyOverviewDiagramProjectionService service;

    private static final UUID PROJECT_ID = UUID.randomUUID();
    private static final UUID ARCHITECTURE_ID = UUID.randomUUID();
    private static final String MODEL_FILE_ID = "mf-001";
    private static final String BUSINESS_USER_ID = "bu-001";

    @BeforeEach
    void setUp() {
        service = new UserJourneyOverviewDiagramProjectionService(
            userJourneyRepository,
            userJourneyLinkRepository,
            businessUserRepository,
            businessProcessRepository,
            activityStepRepository,
            modelFileRepository,
            diagramRepository
        );
    }

    // ============================================================================
    // Gap 1: Zero journeys for a business user still returns valid empty DTO
    // (regression guard: early return path must still work after link resolution
    //  was added to the main path)
    // ============================================================================

    @Test
    @DisplayName("projectOverview() for a business user with zero journeys returns valid empty DTO")
    void projectOverview_zeroJourneys_returnsValidEmptyDto() {
        // Given: standard model file + business user, but no journeys for this user
        setupStandardProjection();

        // All journeys in the model file belong to a DIFFERENT business user
        UserJourneyEntity otherUserJourney = buildJourney("uj-other", "Other Journey", "bu-other", "bp-1");
        when(userJourneyRepository.findByModelFileId(MODEL_FILE_ID)).thenReturn(List.of(otherUserJourney));

        // When
        UserJourneyOverviewDiagramDto result = service.projectOverview(PROJECT_ID, ARCHITECTURE_ID, BUSINESS_USER_ID);

        // Then: valid empty DTO with no lanes, nodes, or edges
        assertThat(result).isNotNull();
        assertThat(result.diagramType()).isEqualTo("USER_JOURNEY_OVERVIEW");
        assertThat(result.version()).isEqualTo("1.0");
        assertThat(result.overview()).isNotNull();
        assertThat(result.overview().businessUserId()).isEqualTo(BUSINESS_USER_ID);
        assertThat(result.lanes()).isEmpty();
        assertThat(result.nodes()).isEmpty();
        assertThat(result.edges()).isEmpty();
    }

    // ============================================================================
    // Gap 2: Multiple nodes with mixed link statuses in one overview
    // ============================================================================

    @Test
    @DisplayName("Multiple nodes with mixed link statuses: LINKED, UNLINKED, and AMBIGUOUS_RESOLVED in same overview")
    void projectOverview_multipleNodes_mixedLinkStatuses() {
        // Given: 3 journeys for the same business user
        setupStandardProjection();

        UserJourneyEntity j1 = buildJourney("uj-1", "Journey One", BUSINESS_USER_ID, "bp-1");
        UserJourneyEntity j2 = buildJourney("uj-2", "Journey Two", BUSINESS_USER_ID, "bp-1");
        UserJourneyEntity j3 = buildJourney("uj-3", "Journey Three", BUSINESS_USER_ID, "bp-1");
        when(userJourneyRepository.findByModelFileId(MODEL_FILE_ID)).thenReturn(List.of(j1, j2, j3));

        BusinessProcessEntity bp1 = buildBP("bp-1", "Process One");
        when(businessProcessRepository.findAllById(anyCollection())).thenReturn(List.of(bp1));
        when(userJourneyLinkRepository.findByModelFileId(MODEL_FILE_ID)).thenReturn(List.of());
        when(activityStepRepository.findByUserJourneyId("uj-1")).thenReturn(List.of());
        when(activityStepRepository.findByUserJourneyId("uj-2")).thenReturn(List.of());
        when(activityStepRepository.findByUserJourneyId("uj-3")).thenReturn(List.of());

        // Child diagrams: uj-1 has exactly 1 match (LINKED), uj-2 has 0 matches (UNLINKED),
        // uj-3 has 2 matches (AMBIGUOUS_RESOLVED)
        DiagramEntity diagForJ1 = buildChildDiagram("diag-j1", "J1 Detail", "uj-1");
        DiagramEntity diagForJ3a = buildChildDiagram("diag-j3-a", "J3 Draft A", "uj-3");
        DiagramEntity diagForJ3z = buildChildDiagram("diag-j3-z", "J3 Draft Z", "uj-3");

        when(diagramRepository.findByModelFileIdAndDiagramType(MODEL_FILE_ID, "USER_JOURNEY"))
            .thenReturn(List.of(diagForJ1, diagForJ3a, diagForJ3z));

        // When
        UserJourneyOverviewDiagramDto result = service.projectOverview(PROJECT_ID, ARCHITECTURE_ID, BUSINESS_USER_ID);

        // Then: 3 nodes with correct mixed link statuses
        assertThat(result.nodes()).hasSize(3);

        // Build a map by node id for easier assertions (nodes are sorted alphabetically)
        Map<String, UserJourneyOverviewNodeDto> nodeMap = new HashMap<>();
        result.nodes().forEach(n -> nodeMap.put(n.id(), n));

        // uj-1: LINKED
        UserJourneyOverviewNodeDto.UserJourneyOverviewNodeLinkDto link1 = nodeMap.get("uj-1").link();
        assertThat(link1).isNotNull();
        assertThat(link1.linkStatus()).isEqualTo("LINKED");
        assertThat(link1.linkedDiagramId()).isEqualTo("diag-j1");

        // uj-2: UNLINKED
        UserJourneyOverviewNodeDto.UserJourneyOverviewNodeLinkDto link2 = nodeMap.get("uj-2").link();
        assertThat(link2).isNotNull();
        assertThat(link2.linkStatus()).isEqualTo("UNLINKED");
        assertThat(link2.linkedDiagramId()).isNull();

        // uj-3: AMBIGUOUS_RESOLVED, selects alphabetically last ID ("diag-j3-z")
        UserJourneyOverviewNodeDto.UserJourneyOverviewNodeLinkDto link3 = nodeMap.get("uj-3").link();
        assertThat(link3).isNotNull();
        assertThat(link3.linkStatus()).isEqualTo("AMBIGUOUS_RESOLVED");
        assertThat(link3.linkedDiagramId()).isEqualTo("diag-j3-z");
        assertThat(link3.linkedDiagramName()).isEqualTo("J3 Draft Z");
    }

    // ============================================================================
    // Gap 3: Diagram with blank source_user_journey_id is skipped
    // ============================================================================

    @Test
    @DisplayName("Diagrams with blank source_user_journey_id are skipped during resolution")
    void linkResolution_blankSourceJourneyId_diagramSkipped() {
        // Given
        setupStandardProjection();

        UserJourneyEntity j1 = buildJourney("uj-1", "Journey One", BUSINESS_USER_ID, "bp-1");
        when(userJourneyRepository.findByModelFileId(MODEL_FILE_ID)).thenReturn(List.of(j1));

        BusinessProcessEntity bp1 = buildBP("bp-1", "Process One");
        when(businessProcessRepository.findAllById(anyCollection())).thenReturn(List.of(bp1));
        when(userJourneyLinkRepository.findByModelFileId(MODEL_FILE_ID)).thenReturn(List.of());
        when(activityStepRepository.findByUserJourneyId("uj-1")).thenReturn(List.of());

        // A diagram with blank (whitespace only) source_user_journey_id
        Map<String, Object> syncBlock = new LinkedHashMap<>();
        syncBlock.put("source_user_journey_id", "   ");  // blank string

        Map<String, Object> content = new LinkedHashMap<>();
        content.put("diagram_type", "USER_JOURNEY");
        content.put("sync", syncBlock);

        Map<String, Object> typedContentJson = new LinkedHashMap<>();
        typedContentJson.put("type", "USER_JOURNEY");
        typedContentJson.put("version", 2);
        typedContentJson.put("content", content);

        DiagramEntity blankIdDiagram = DiagramEntity.builder()
            .id("diag-blank")
            .modelFileId(MODEL_FILE_ID)
            .name("Blank ID Diagram")
            .diagramType("USER_JOURNEY")
            .typedContentJson(typedContentJson)
            .build();

        when(diagramRepository.findByModelFileIdAndDiagramType(MODEL_FILE_ID, "USER_JOURNEY"))
            .thenReturn(List.of(blankIdDiagram));

        // When
        UserJourneyOverviewDiagramDto result = service.projectOverview(PROJECT_ID, ARCHITECTURE_ID, BUSINESS_USER_ID);

        // Then: diagram with blank ID should be skipped, so node is UNLINKED
        assertThat(result.nodes()).hasSize(1);
        UserJourneyOverviewNodeDto.UserJourneyOverviewNodeLinkDto link = result.nodes().get(0).link();
        assertThat(link.linkStatus()).isEqualTo("UNLINKED");
        assertThat(link.linkedDiagramId()).isNull();
    }

    // ============================================================================
    // Gap 4: End-to-end projection produces correct link sub-records
    // (ensures the full resolveChildDiagramMap -> resolveLink -> deriveNodes chain works)
    // ============================================================================

    @Test
    @DisplayName("End-to-end: projection service produces correct link sub-records from typed content parsing through to node DTO")
    void projectOverview_endToEnd_producesCorrectLinkSubRecords() {
        // Given: 2 journeys, one linked and one unlinked
        setupStandardProjection();

        UserJourneyEntity jLinked = buildJourney("uj-linked", "Linked Journey", BUSINESS_USER_ID, "bp-1");
        UserJourneyEntity jUnlinked = buildJourney("uj-unlinked", "Unlinked Journey", BUSINESS_USER_ID, "bp-1");
        when(userJourneyRepository.findByModelFileId(MODEL_FILE_ID)).thenReturn(List.of(jLinked, jUnlinked));

        BusinessProcessEntity bp1 = buildBP("bp-1", "Process One");
        when(businessProcessRepository.findAllById(anyCollection())).thenReturn(List.of(bp1));
        when(userJourneyLinkRepository.findByModelFileId(MODEL_FILE_ID)).thenReturn(List.of());
        when(activityStepRepository.findByUserJourneyId("uj-linked")).thenReturn(List.of());
        when(activityStepRepository.findByUserJourneyId("uj-unlinked")).thenReturn(List.of());

        // One child diagram with full typed content structure linked to uj-linked
        DiagramEntity childDiagram = buildChildDiagram("diag-child", "Linked Detail", "uj-linked");
        when(diagramRepository.findByModelFileIdAndDiagramType(MODEL_FILE_ID, "USER_JOURNEY"))
            .thenReturn(List.of(childDiagram));

        // When
        UserJourneyOverviewDiagramDto result = service.projectOverview(PROJECT_ID, ARCHITECTURE_ID, BUSINESS_USER_ID);

        // Then: verify both nodes have correct link sub-records
        assertThat(result.nodes()).hasSize(2);

        Map<String, UserJourneyOverviewNodeDto> nodeMap = new HashMap<>();
        result.nodes().forEach(n -> nodeMap.put(n.id(), n));

        // The linked journey should have LINKED status with correct child diagram details
        UserJourneyOverviewNodeDto linkedNode = nodeMap.get("uj-linked");
        assertThat(linkedNode).isNotNull();
        assertThat(linkedNode.link()).isNotNull();
        assertThat(linkedNode.link().linkStatus()).isEqualTo("LINKED");
        assertThat(linkedNode.link().linkedDiagramId()).isEqualTo("diag-child");
        assertThat(linkedNode.link().linkedDiagramName()).isEqualTo("Linked Detail");

        // The unlinked journey should have UNLINKED status with null diagram fields
        UserJourneyOverviewNodeDto unlinkedNode = nodeMap.get("uj-unlinked");
        assertThat(unlinkedNode).isNotNull();
        assertThat(unlinkedNode.link()).isNotNull();
        assertThat(unlinkedNode.link().linkStatus()).isEqualTo("UNLINKED");
        assertThat(unlinkedNode.link().linkedDiagramId()).isNull();
        assertThat(unlinkedNode.link().linkedDiagramName()).isNull();
    }

    // ============== Helper methods ==============

    private void setupStandardProjection() {
        ModelFileEntity modelFile = new ModelFileEntity();
        modelFile.setId(MODEL_FILE_ID);
        modelFile.setProjectId(PROJECT_ID);
        modelFile.setFilename("test-model.json");
        when(modelFileRepository.findByProjectIdAndArchitectureId(PROJECT_ID, ARCHITECTURE_ID)).thenReturn(Optional.of(modelFile));

        BusinessUserEntity businessUser = new BusinessUserEntity();
        businessUser.setId(BUSINESS_USER_ID);
        businessUser.setName("Test User");
        businessUser.setModelFileId(MODEL_FILE_ID);
        businessUser.setAbbreviation("TES");
        when(businessUserRepository.findById(BUSINESS_USER_ID)).thenReturn(Optional.of(businessUser));
    }

    private UserJourneyEntity buildJourney(String id, String name, String primaryBuId, String parentBpId) {
        UserJourneyEntity uj = new UserJourneyEntity();
        uj.setId(id);
        uj.setModelFileId(MODEL_FILE_ID);
        uj.setName(name);
        uj.setDescription("Description for " + name);
        uj.setPrimaryBusinessUserId(primaryBuId);
        uj.setParentBusinessProcessId(parentBpId);
        return uj;
    }

    private BusinessProcessEntity buildBP(String id, String name) {
        BusinessProcessEntity bp = new BusinessProcessEntity();
        bp.setId(id);
        bp.setName(name);
        bp.setModelFileId(MODEL_FILE_ID);
        return bp;
    }

    private DiagramEntity buildChildDiagram(String diagId, String diagName, String sourceJourneyId) {
        Map<String, Object> syncBlock = new LinkedHashMap<>();
        syncBlock.put("source_user_journey_id", sourceJourneyId);
        syncBlock.put("source_project_id", PROJECT_ID.toString());

        Map<String, Object> content = new LinkedHashMap<>();
        content.put("diagram_type", "USER_JOURNEY");
        content.put("sync", syncBlock);

        Map<String, Object> typedContentJson = new LinkedHashMap<>();
        typedContentJson.put("type", "USER_JOURNEY");
        typedContentJson.put("version", 2);
        typedContentJson.put("content", content);

        return DiagramEntity.builder()
            .id(diagId)
            .modelFileId(MODEL_FILE_ID)
            .name(diagName)
            .diagramType("USER_JOURNEY")
            .typedContentJson(typedContentJson)
            .build();
    }
}
