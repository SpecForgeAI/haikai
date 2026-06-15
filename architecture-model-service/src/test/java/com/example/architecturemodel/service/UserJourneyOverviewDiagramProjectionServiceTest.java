package com.example.architecturemodel.service;

import com.example.architecturemodel.model.dto.diagram.*;
import com.example.architecturemodel.model.entity.*;
import com.example.architecturemodel.repository.ModelFileRepository;
import com.example.architecturemodel.repository.diagram.DiagramRepository;
import com.example.architecturemodel.repository.entity.*;
import com.example.architecturemodel.repository.relationship.UserJourneyLinkRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.*;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

/**
 * Unit tests for UserJourneyOverviewDiagramProjectionService.
 *
 * Spec: User Journey Overview Parent Diagram Generation
 * Task Group 2: Projection Service
 */
@ExtendWith(MockitoExtension.class)
class UserJourneyOverviewDiagramProjectionServiceTest {

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

    /**
     * Test 1: Given a business user with 3 journeys across 2 business processes,
     * verify 2 lanes (alphabetical by BP name), 3 nodes (alphabetical within lanes),
     * correct lane assignments.
     */
    @Test
    void projectOverview_3journeys2BPs_produces2LanesAlphabeticalAnd3Nodes() {
        // Given
        ModelFileEntity modelFile = buildModelFile();
        when(modelFileRepository.findByProjectIdAndArchitectureId(PROJECT_ID, ARCHITECTURE_ID)).thenReturn(Optional.of(modelFile));

        BusinessUserEntity businessUser = buildBU(BUSINESS_USER_ID, "Test User");
        when(businessUserRepository.findById(BUSINESS_USER_ID)).thenReturn(Optional.of(businessUser));

        // 3 journeys: "Charlie" in BP "Zebra Process", "Alpha" and "Beta" in BP "Alpha Process"
        UserJourneyEntity j1 = buildJourney("uj-1", "Charlie Journey", BUSINESS_USER_ID, "bp-zebra");
        UserJourneyEntity j2 = buildJourney("uj-2", "Alpha Journey", BUSINESS_USER_ID, "bp-alpha");
        UserJourneyEntity j3 = buildJourney("uj-3", "Beta Journey", BUSINESS_USER_ID, "bp-alpha");
        // Also add a journey belonging to a different user -- should be excluded
        UserJourneyEntity otherUserJourney = buildJourney("uj-other", "Other Journey", "bu-other", "bp-alpha");

        when(userJourneyRepository.findByModelFileId(MODEL_FILE_ID))
            .thenReturn(List.of(j1, j2, j3, otherUserJourney));

        BusinessProcessEntity bpAlpha = buildBP("bp-alpha", "Alpha Process");
        BusinessProcessEntity bpZebra = buildBP("bp-zebra", "Zebra Process");
        when(businessProcessRepository.findAllById(anyCollection()))
            .thenReturn(List.of(bpAlpha, bpZebra));

        when(userJourneyLinkRepository.findByModelFileId(MODEL_FILE_ID)).thenReturn(List.of());
        when(activityStepRepository.findByUserJourneyId("uj-1")).thenReturn(List.of());
        when(activityStepRepository.findByUserJourneyId("uj-2")).thenReturn(List.of());
        when(activityStepRepository.findByUserJourneyId("uj-3")).thenReturn(List.of());

        // No child diagrams for link resolution
        when(diagramRepository.findByModelFileIdAndDiagramType(eq(MODEL_FILE_ID), eq("USER_JOURNEY")))
            .thenReturn(List.of());

        // When
        UserJourneyOverviewDiagramDto result = service.projectOverview(PROJECT_ID, ARCHITECTURE_ID, BUSINESS_USER_ID);

        // Then
        assertEquals("USER_JOURNEY_OVERVIEW", result.diagramType());
        assertEquals("1.0", result.version());

        // 2 lanes, alphabetical: Alpha Process (order 0), Zebra Process (order 1)
        assertEquals(2, result.lanes().size());
        assertEquals("bp-alpha", result.lanes().get(0).id());
        assertEquals("Alpha Process", result.lanes().get(0).name());
        assertEquals(0, result.lanes().get(0).order());
        assertEquals("bp-zebra", result.lanes().get(1).id());
        assertEquals("Zebra Process", result.lanes().get(1).name());
        assertEquals(1, result.lanes().get(1).order());

        // 3 nodes total
        assertEquals(3, result.nodes().size());

        // Within Alpha Process lane: Alpha Journey (uj-2) before Beta Journey (uj-3) alphabetically
        assertEquals("uj-2", result.nodes().get(0).id());
        assertEquals("Alpha Journey", result.nodes().get(0).name());
        assertEquals("bp-alpha", result.nodes().get(0).laneId());

        assertEquals("uj-3", result.nodes().get(1).id());
        assertEquals("Beta Journey", result.nodes().get(1).name());
        assertEquals("bp-alpha", result.nodes().get(1).laneId());

        // Within Zebra Process lane: Charlie Journey (uj-1)
        assertEquals("uj-1", result.nodes().get(2).id());
        assertEquals("Charlie Journey", result.nodes().get(2).name());
        assertEquals("bp-zebra", result.nodes().get(2).laneId());
    }

    /**
     * Test 2: Journeys with null parentBusinessProcessId get "Unassigned" lane placed last.
     */
    @Test
    void projectOverview_nullParentBP_createsUnassignedLaneLast() {
        // Given
        ModelFileEntity modelFile = buildModelFile();
        when(modelFileRepository.findByProjectIdAndArchitectureId(PROJECT_ID, ARCHITECTURE_ID)).thenReturn(Optional.of(modelFile));

        BusinessUserEntity businessUser = buildBU(BUSINESS_USER_ID, "Test User");
        when(businessUserRepository.findById(BUSINESS_USER_ID)).thenReturn(Optional.of(businessUser));

        // One journey in a BP, one with null parentBusinessProcessId
        UserJourneyEntity j1 = buildJourney("uj-1", "Assigned Journey", BUSINESS_USER_ID, "bp-1");
        UserJourneyEntity j2 = buildJourney("uj-2", "Unassigned Journey", BUSINESS_USER_ID, null);

        when(userJourneyRepository.findByModelFileId(MODEL_FILE_ID)).thenReturn(List.of(j1, j2));

        BusinessProcessEntity bp1 = buildBP("bp-1", "My Process");
        when(businessProcessRepository.findAllById(anyCollection())).thenReturn(List.of(bp1));

        when(userJourneyLinkRepository.findByModelFileId(MODEL_FILE_ID)).thenReturn(List.of());
        when(activityStepRepository.findByUserJourneyId("uj-1")).thenReturn(List.of());
        when(activityStepRepository.findByUserJourneyId("uj-2")).thenReturn(List.of());

        // No child diagrams for link resolution
        when(diagramRepository.findByModelFileIdAndDiagramType(eq(MODEL_FILE_ID), eq("USER_JOURNEY")))
            .thenReturn(List.of());

        // When
        UserJourneyOverviewDiagramDto result = service.projectOverview(PROJECT_ID, ARCHITECTURE_ID, BUSINESS_USER_ID);

        // Then: 2 lanes -- "My Process" first, "Unassigned" last
        assertEquals(2, result.lanes().size());
        assertEquals("bp-1", result.lanes().get(0).id());
        assertEquals("My Process", result.lanes().get(0).name());
        assertEquals(0, result.lanes().get(0).order());

        assertEquals("unassigned", result.lanes().get(1).id());
        assertEquals("Unassigned", result.lanes().get(1).name());
        assertEquals(1, result.lanes().get(1).order());

        // Verify the unassigned journey's lane_id
        UserJourneyOverviewNodeDto unassignedNode = result.nodes().stream()
            .filter(n -> n.id().equals("uj-2")).findFirst().orElseThrow();
        assertEquals("unassigned", unassignedNode.laneId());
    }

    /**
     * Test 3: 2 journeys connected by USER_JOURNEY_LINK produce 1 edge with correct
     * source/target, type, label.
     */
    @Test
    void projectOverview_linkedJourneys_producesEdge() {
        // Given
        ModelFileEntity modelFile = buildModelFile();
        when(modelFileRepository.findByProjectIdAndArchitectureId(PROJECT_ID, ARCHITECTURE_ID)).thenReturn(Optional.of(modelFile));

        BusinessUserEntity businessUser = buildBU(BUSINESS_USER_ID, "Test User");
        when(businessUserRepository.findById(BUSINESS_USER_ID)).thenReturn(Optional.of(businessUser));

        UserJourneyEntity j1 = buildJourney("uj-1", "Source Journey", BUSINESS_USER_ID, "bp-1");
        UserJourneyEntity j2 = buildJourney("uj-2", "Target Journey", BUSINESS_USER_ID, "bp-1");

        when(userJourneyRepository.findByModelFileId(MODEL_FILE_ID)).thenReturn(List.of(j1, j2));

        BusinessProcessEntity bp1 = buildBP("bp-1", "Process One");
        when(businessProcessRepository.findAllById(anyCollection())).thenReturn(List.of(bp1));

        UserJourneyLinkEntity link = buildLink("link-1", "uj-1", "uj-2", "USER_JOURNEY_LINK", "Handoff", "Handoff description");
        when(userJourneyLinkRepository.findByModelFileId(MODEL_FILE_ID)).thenReturn(List.of(link));

        when(activityStepRepository.findByUserJourneyId("uj-1")).thenReturn(List.of());
        when(activityStepRepository.findByUserJourneyId("uj-2")).thenReturn(List.of());

        // No child diagrams for link resolution
        when(diagramRepository.findByModelFileIdAndDiagramType(eq(MODEL_FILE_ID), eq("USER_JOURNEY")))
            .thenReturn(List.of());

        // When
        UserJourneyOverviewDiagramDto result = service.projectOverview(PROJECT_ID, ARCHITECTURE_ID, BUSINESS_USER_ID);

        // Then
        assertEquals(1, result.edges().size());
        UserJourneyOverviewEdgeDto edge = result.edges().get(0);
        assertEquals("link-1", edge.id());
        assertEquals("uj-1", edge.sourceNodeId());
        assertEquals("uj-2", edge.targetNodeId());
        assertEquals("USER_JOURNEY_LINK", edge.relationshipType());
        assertEquals("Handoff", edge.label());
        assertEquals("Handoff description", edge.description());
    }

    /**
     * Test 4: 0 matching journeys returns empty valid structure (header populated, empty arrays).
     */
    @Test
    void projectOverview_noMatchingJourneys_returnsEmptyValidStructure() {
        // Given
        ModelFileEntity modelFile = buildModelFile();
        when(modelFileRepository.findByProjectIdAndArchitectureId(PROJECT_ID, ARCHITECTURE_ID)).thenReturn(Optional.of(modelFile));

        BusinessUserEntity businessUser = buildBU(BUSINESS_USER_ID, "Test User");
        when(businessUserRepository.findById(BUSINESS_USER_ID)).thenReturn(Optional.of(businessUser));

        // Only journeys belonging to a different user
        UserJourneyEntity otherJourney = buildJourney("uj-other", "Other Journey", "bu-other", "bp-1");
        when(userJourneyRepository.findByModelFileId(MODEL_FILE_ID)).thenReturn(List.of(otherJourney));

        // When
        UserJourneyOverviewDiagramDto result = service.projectOverview(PROJECT_ID, ARCHITECTURE_ID, BUSINESS_USER_ID);

        // Then
        assertEquals("USER_JOURNEY_OVERVIEW", result.diagramType());
        assertEquals("1.0", result.version());
        assertNotNull(result.overview());
        assertEquals(BUSINESS_USER_ID, result.overview().businessUserId());
        assertEquals("Test User", result.overview().businessUserName());
        assertEquals("Test User Journey Overview", result.overview().title());
        assertTrue(result.lanes().isEmpty());
        assertTrue(result.nodes().isEmpty());
        assertTrue(result.edges().isEmpty());
        assertNotNull(result.renderHints());
    }

    /**
     * Test 5: Node metadata computed correctly -- step_count from ActivityStepRepository,
     * application_count as distinct application IDs from activity steps,
     * relationship_in_count and relationship_out_count from filtered link set.
     */
    @Test
    void projectOverview_nodeMetadata_computedCorrectly() {
        // Given
        ModelFileEntity modelFile = buildModelFile();
        when(modelFileRepository.findByProjectIdAndArchitectureId(PROJECT_ID, ARCHITECTURE_ID)).thenReturn(Optional.of(modelFile));

        BusinessUserEntity businessUser = buildBU(BUSINESS_USER_ID, "Test User");
        when(businessUserRepository.findById(BUSINESS_USER_ID)).thenReturn(Optional.of(businessUser));

        // 2 journeys, j1 has links out, j2 has links in
        UserJourneyEntity j1 = buildJourney("uj-1", "Source Journey", BUSINESS_USER_ID, "bp-1");
        UserJourneyEntity j2 = buildJourney("uj-2", "Target Journey", BUSINESS_USER_ID, "bp-1");

        when(userJourneyRepository.findByModelFileId(MODEL_FILE_ID)).thenReturn(List.of(j1, j2));

        BusinessProcessEntity bp1 = buildBP("bp-1", "Process One");
        when(businessProcessRepository.findAllById(anyCollection())).thenReturn(List.of(bp1));

        // j1 has 3 activity steps across 2 distinct applications
        ActivityStepEntity step1 = buildStep("step-1", "uj-1", "app-a");
        ActivityStepEntity step2 = buildStep("step-2", "uj-1", "app-b");
        ActivityStepEntity step3 = buildStep("step-3", "uj-1", "app-a");
        when(activityStepRepository.findByUserJourneyId("uj-1")).thenReturn(List.of(step1, step2, step3));

        // j2 has 1 activity step
        ActivityStepEntity step4 = buildStep("step-4", "uj-2", "app-c");
        when(activityStepRepository.findByUserJourneyId("uj-2")).thenReturn(List.of(step4));

        // 2 links: j1 -> j2 (twice, simulating two different links)
        UserJourneyLinkEntity link1 = buildLink("link-1", "uj-1", "uj-2", "USER_JOURNEY_LINK", "Link 1", null);
        UserJourneyLinkEntity link2 = buildLink("link-2", "uj-1", "uj-2", "USER_JOURNEY_LINK", "Link 2", null);
        when(userJourneyLinkRepository.findByModelFileId(MODEL_FILE_ID)).thenReturn(List.of(link1, link2));

        // No child diagrams for link resolution
        when(diagramRepository.findByModelFileIdAndDiagramType(eq(MODEL_FILE_ID), eq("USER_JOURNEY")))
            .thenReturn(List.of());

        // When
        UserJourneyOverviewDiagramDto result = service.projectOverview(PROJECT_ID, ARCHITECTURE_ID, BUSINESS_USER_ID);

        // Then -- verify j1 metadata
        UserJourneyOverviewNodeDto node1 = result.nodes().stream()
            .filter(n -> n.id().equals("uj-1")).findFirst().orElseThrow();
        assertEquals(3, node1.metadata().stepCount(), "j1 step_count should be 3");
        assertEquals(2, node1.metadata().applicationCount(), "j1 application_count should be 2 distinct apps");
        assertEquals(0, node1.metadata().relationshipInCount(), "j1 has no incoming links");
        assertEquals(2, node1.metadata().relationshipOutCount(), "j1 has 2 outgoing links");

        // Then -- verify j2 metadata
        UserJourneyOverviewNodeDto node2 = result.nodes().stream()
            .filter(n -> n.id().equals("uj-2")).findFirst().orElseThrow();
        assertEquals(1, node2.metadata().stepCount(), "j2 step_count should be 1");
        assertEquals(1, node2.metadata().applicationCount(), "j2 application_count should be 1");
        assertEquals(2, node2.metadata().relationshipInCount(), "j2 has 2 incoming links");
        assertEquals(0, node2.metadata().relationshipOutCount(), "j2 has no outgoing links");
    }

    /**
     * Test 6: Links where one end is NOT the selected user's journey are excluded.
     */
    @Test
    void projectOverview_linksOutsideSelectedUser_areExcluded() {
        // Given
        ModelFileEntity modelFile = buildModelFile();
        when(modelFileRepository.findByProjectIdAndArchitectureId(PROJECT_ID, ARCHITECTURE_ID)).thenReturn(Optional.of(modelFile));

        BusinessUserEntity businessUser = buildBU(BUSINESS_USER_ID, "Test User");
        when(businessUserRepository.findById(BUSINESS_USER_ID)).thenReturn(Optional.of(businessUser));

        UserJourneyEntity j1 = buildJourney("uj-1", "My Journey", BUSINESS_USER_ID, "bp-1");
        UserJourneyEntity otherJourney = buildJourney("uj-other", "Other Journey", "bu-other", "bp-1");

        when(userJourneyRepository.findByModelFileId(MODEL_FILE_ID)).thenReturn(List.of(j1, otherJourney));

        BusinessProcessEntity bp1 = buildBP("bp-1", "Process One");
        when(businessProcessRepository.findAllById(anyCollection())).thenReturn(List.of(bp1));

        // Link from my journey to other user's journey -- should be excluded
        UserJourneyLinkEntity link1 = buildLink("link-1", "uj-1", "uj-other", "USER_JOURNEY_LINK", "Cross-user", null);
        // Link from other user's journey to my journey -- should also be excluded
        UserJourneyLinkEntity link2 = buildLink("link-2", "uj-other", "uj-1", "USER_JOURNEY_LINK", "Cross-user reverse", null);

        when(userJourneyLinkRepository.findByModelFileId(MODEL_FILE_ID)).thenReturn(List.of(link1, link2));
        when(activityStepRepository.findByUserJourneyId("uj-1")).thenReturn(List.of());

        // No child diagrams for link resolution
        when(diagramRepository.findByModelFileIdAndDiagramType(eq(MODEL_FILE_ID), eq("USER_JOURNEY")))
            .thenReturn(List.of());

        // When
        UserJourneyOverviewDiagramDto result = service.projectOverview(PROJECT_ID, ARCHITECTURE_ID, BUSINESS_USER_ID);

        // Then: no edges because both links have one end outside the selected user's journeys
        assertEquals(1, result.nodes().size());  // only uj-1
        assertTrue(result.edges().isEmpty(), "Links where one end is not the selected user's journey should be excluded");
    }

    // ============== Helper methods ==============

    private ModelFileEntity buildModelFile() {
        ModelFileEntity mf = new ModelFileEntity();
        mf.setId(MODEL_FILE_ID);
        mf.setProjectId(PROJECT_ID);
        mf.setFilename("test-model.json");
        return mf;
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

    private BusinessUserEntity buildBU(String id, String name) {
        BusinessUserEntity bu = new BusinessUserEntity();
        bu.setId(id);
        bu.setName(name);
        bu.setModelFileId(MODEL_FILE_ID);
        bu.setAbbreviation(name.substring(0, Math.min(3, name.length())).toUpperCase());
        return bu;
    }

    private BusinessProcessEntity buildBP(String id, String name) {
        BusinessProcessEntity bp = new BusinessProcessEntity();
        bp.setId(id);
        bp.setName(name);
        bp.setModelFileId(MODEL_FILE_ID);
        return bp;
    }

    private UserJourneyLinkEntity buildLink(String id, String sourceId, String targetId,
                                              String type, String label, String description) {
        UserJourneyLinkEntity link = new UserJourneyLinkEntity();
        link.setId(id);
        link.setModelFileId(MODEL_FILE_ID);
        link.setSourceUserJourneyId(sourceId);
        link.setTargetUserJourneyId(targetId);
        link.setRelationshipType(type);
        link.setLabel(label);
        link.setDescription(description);
        return link;
    }

    private ActivityStepEntity buildStep(String id, String journeyId, String appId) {
        ActivityStepEntity step = new ActivityStepEntity();
        step.setId(id);
        step.setModelFileId(MODEL_FILE_ID);
        step.setUserJourneyId(journeyId);
        step.setName("Step " + id);
        step.setApplicationId(appId);
        step.setProcessActivityId("pa-1");
        step.setBusinessUserId(BUSINESS_USER_ID);
        step.setSequenceOrder(1);
        return step;
    }
}
