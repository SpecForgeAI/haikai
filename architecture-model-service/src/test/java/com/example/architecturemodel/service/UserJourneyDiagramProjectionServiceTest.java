package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.diagram.*;
import com.example.architecturemodel.model.entity.*;
import com.example.architecturemodel.repository.ModelFileRepository;
import com.example.architecturemodel.repository.entity.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.*;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.Mockito.when;

/**
 * Unit tests for UserJourneyDiagramProjectionService.
 *
 * Spec: User Journey Temporary Diagram JSON Generation
 * Task Group 2: Repository Query, Projection Service, and Unit Tests
 */
@ExtendWith(MockitoExtension.class)
class UserJourneyDiagramProjectionServiceTest {

    @Mock
    private UserJourneyRepository userJourneyRepository;
    @Mock
    private ActivityStepRepository activityStepRepository;
    @Mock
    private ApplicationRepository applicationRepository;
    @Mock
    private ProcessActivityRepository processActivityRepository;
    @Mock
    private BusinessUserRepository businessUserRepository;
    @Mock
    private BusinessProcessRepository businessProcessRepository;
    @Mock
    private ModelFileRepository modelFileRepository;

    private UserJourneyDiagramProjectionService service;

    private static final UUID PROJECT_ID = UUID.randomUUID();
    private static final UUID ARCHITECTURE_ID = UUID.randomUUID();
    private static final String MODEL_FILE_ID = "mf-001";
    private static final String JOURNEY_ID = "uj-001";

    @BeforeEach
    void setUp() {
        service = new UserJourneyDiagramProjectionService(
            userJourneyRepository,
            activityStepRepository,
            applicationRepository,
            processActivityRepository,
            businessUserRepository,
            businessProcessRepository,
            modelFileRepository
        );
    }

    /**
     * Test 1: Single-lane journey -- one application across all steps.
     * Verify 1 lane, correct steps, no cross-lane edges.
     */
    @Test
    void projectSingleJourney_singleLane_producesCorrectDiagram() {
        // Given
        ModelFileEntity modelFile = buildModelFile();
        UserJourneyEntity journey = buildJourney(MODEL_FILE_ID, "bu-001", "bp-001");
        List<ActivityStepEntity> steps = List.of(
            buildStep("step-1", JOURNEY_ID, 1, "app-1", "pa-1", "bu-001"),
            buildStep("step-2", JOURNEY_ID, 2, "app-1", "pa-2", "bu-001")
        );

        setupMocks(modelFile, journey, steps);
        mockApplications(buildApp("app-1", "App One"));
        mockProcessActivities(buildPA("pa-1", "Activity 1"), buildPA("pa-2", "Activity 2"));
        mockBusinessUsersForSteps(buildBU("bu-001", "User One"));
        mockJourneyBusinessUser("bu-001", "User One");
        mockBusinessProcess("bp-001", "Process One");

        // When
        UserJourneyDiagramDto result = service.projectSingleJourney(PROJECT_ID, ARCHITECTURE_ID, JOURNEY_ID);

        // Then
        assertEquals("USER_JOURNEY", result.diagramType());
        assertEquals("1.0", result.version());
        assertEquals(1, result.lanes().size());
        assertEquals("app-1", result.lanes().get(0).id());
        assertEquals("App One", result.lanes().get(0).name());
        assertEquals(0, result.lanes().get(0).order());

        assertEquals(2, result.steps().size());
        assertEquals("step-1", result.steps().get(0).id());
        assertEquals("step-2", result.steps().get(1).id());

        // 1 edge for 2 steps, not cross-lane
        assertEquals(1, result.edges().size());
        assertFalse(result.edges().get(0).isCrossLane());
    }

    /**
     * Test 2: Multi-lane journey -- steps spanning 2+ applications.
     * Verify lane count and lane ordering by first occurrence.
     */
    @Test
    void projectSingleJourney_multiLane_lanesOrderedByFirstOccurrence() {
        // Given: app-2 appears at step 1, app-1 appears at step 2
        ModelFileEntity modelFile = buildModelFile();
        UserJourneyEntity journey = buildJourney(MODEL_FILE_ID, "bu-001", "bp-001");
        List<ActivityStepEntity> steps = List.of(
            buildStep("step-1", JOURNEY_ID, 1, "app-2", "pa-1", "bu-001"),
            buildStep("step-2", JOURNEY_ID, 2, "app-1", "pa-2", "bu-001"),
            buildStep("step-3", JOURNEY_ID, 3, "app-2", "pa-3", "bu-001")
        );

        setupMocks(modelFile, journey, steps);
        mockApplications(buildApp("app-1", "App One"), buildApp("app-2", "App Two"));
        mockProcessActivities(buildPA("pa-1", "Act 1"), buildPA("pa-2", "Act 2"), buildPA("pa-3", "Act 3"));
        mockBusinessUsersForSteps(buildBU("bu-001", "User One"));
        mockJourneyBusinessUser("bu-001", "User One");
        mockBusinessProcess("bp-001", "Process One");

        // When
        UserJourneyDiagramDto result = service.projectSingleJourney(PROJECT_ID, ARCHITECTURE_ID, JOURNEY_ID);

        // Then
        assertEquals(2, result.lanes().size());
        // app-2 first occurrence at order 1, app-1 first occurrence at order 2
        assertEquals("app-2", result.lanes().get(0).id());
        assertEquals(0, result.lanes().get(0).order());
        assertEquals("app-1", result.lanes().get(1).id());
        assertEquals(1, result.lanes().get(1).order());
    }

    /**
     * Test 3: Edge generation -- verify N-1 edges for N steps,
     * correct from/to IDs, and deterministic edge IDs.
     */
    @Test
    void projectSingleJourney_edgeGeneration_correctEdgesAndIds() {
        // Given: 3 steps -> 2 edges
        ModelFileEntity modelFile = buildModelFile();
        UserJourneyEntity journey = buildJourney(MODEL_FILE_ID, "bu-001", "bp-001");
        List<ActivityStepEntity> steps = List.of(
            buildStep("step-1", JOURNEY_ID, 1, "app-1", "pa-1", "bu-001"),
            buildStep("step-2", JOURNEY_ID, 2, "app-1", "pa-2", "bu-001"),
            buildStep("step-3", JOURNEY_ID, 3, "app-1", "pa-3", "bu-001")
        );

        setupMocks(modelFile, journey, steps);
        mockApplications(buildApp("app-1", "App One"));
        mockProcessActivities(buildPA("pa-1", "Act 1"), buildPA("pa-2", "Act 2"), buildPA("pa-3", "Act 3"));
        mockBusinessUsersForSteps(buildBU("bu-001", "User One"));
        mockJourneyBusinessUser("bu-001", "User One");
        mockBusinessProcess("bp-001", "Process One");

        // When
        UserJourneyDiagramDto result = service.projectSingleJourney(PROJECT_ID, ARCHITECTURE_ID, JOURNEY_ID);

        // Then
        assertEquals(2, result.edges().size());

        UserJourneyDiagramEdgeDto edge0 = result.edges().get(0);
        assertEquals("edge-" + JOURNEY_ID + "-1-2", edge0.id());
        assertEquals("step-1", edge0.fromStepId());
        assertEquals("step-2", edge0.toStepId());
        assertEquals(0, edge0.order());

        UserJourneyDiagramEdgeDto edge1 = result.edges().get(1);
        assertEquals("edge-" + JOURNEY_ID + "-2-3", edge1.id());
        assertEquals("step-2", edge1.fromStepId());
        assertEquals("step-3", edge1.toStepId());
        assertEquals(1, edge1.order());
    }

    /**
     * Test 4: Cross-lane detection -- verify is_cross_lane = true
     * when consecutive steps use different applications.
     */
    @Test
    void projectSingleJourney_crossLaneDetection_flaggedCorrectly() {
        // Given: step-1 in app-1, step-2 in app-2, step-3 in app-2
        ModelFileEntity modelFile = buildModelFile();
        UserJourneyEntity journey = buildJourney(MODEL_FILE_ID, "bu-001", "bp-001");
        List<ActivityStepEntity> steps = List.of(
            buildStep("step-1", JOURNEY_ID, 1, "app-1", "pa-1", "bu-001"),
            buildStep("step-2", JOURNEY_ID, 2, "app-2", "pa-2", "bu-001"),
            buildStep("step-3", JOURNEY_ID, 3, "app-2", "pa-3", "bu-001")
        );

        setupMocks(modelFile, journey, steps);
        mockApplications(buildApp("app-1", "App One"), buildApp("app-2", "App Two"));
        mockProcessActivities(buildPA("pa-1", "Act 1"), buildPA("pa-2", "Act 2"), buildPA("pa-3", "Act 3"));
        mockBusinessUsersForSteps(buildBU("bu-001", "User One"));
        mockJourneyBusinessUser("bu-001", "User One");
        mockBusinessProcess("bp-001", "Process One");

        // When
        UserJourneyDiagramDto result = service.projectSingleJourney(PROJECT_ID, ARCHITECTURE_ID, JOURNEY_ID);

        // Then
        assertEquals(2, result.edges().size());
        assertTrue(result.edges().get(0).isCrossLane(), "Edge from app-1 to app-2 should be cross-lane");
        assertFalse(result.edges().get(1).isCrossLane(), "Edge within app-2 should not be cross-lane");
    }

    /**
     * Test 5: Lane ordering tie-break -- two applications first appearing
     * at the same sequence_order should be sorted alphabetically by application_id.
     */
    @Test
    void projectSingleJourney_laneOrderingTieBreak_alphabeticalByAppId() {
        // Given: both apps first appear at sequence_order=1
        // step-a in app-zebra (seq 1), step-b in app-alpha (seq 1), step-c in app-zebra (seq 2)
        // With id fallback sort: step-a (id=step-a, seq=1) comes before step-b (id=step-b, seq=1)
        // So app-zebra first occurs at seq=1 via step-a, and app-alpha first occurs at seq=1 via step-b
        // Tie-break: alphabetical by app_id -> app-alpha before app-zebra
        ModelFileEntity modelFile = buildModelFile();
        UserJourneyEntity journey = buildJourney(MODEL_FILE_ID, "bu-001", "bp-001");
        List<ActivityStepEntity> steps = List.of(
            buildStep("step-a", JOURNEY_ID, 1, "app-zebra", "pa-1", "bu-001"),
            buildStep("step-b", JOURNEY_ID, 1, "app-alpha", "pa-2", "bu-001"),
            buildStep("step-c", JOURNEY_ID, 2, "app-zebra", "pa-3", "bu-001")
        );

        setupMocks(modelFile, journey, steps);
        mockApplications(buildApp("app-alpha", "Alpha App"), buildApp("app-zebra", "Zebra App"));
        mockProcessActivities(buildPA("pa-1", "Act 1"), buildPA("pa-2", "Act 2"), buildPA("pa-3", "Act 3"));
        mockBusinessUsersForSteps(buildBU("bu-001", "User One"));
        mockJourneyBusinessUser("bu-001", "User One");
        mockBusinessProcess("bp-001", "Process One");

        // When
        UserJourneyDiagramDto result = service.projectSingleJourney(PROJECT_ID, ARCHITECTURE_ID, JOURNEY_ID);

        // Then: both apps first appear at seq=1, tie-break alphabetical -> app-alpha first
        assertEquals(2, result.lanes().size());
        assertEquals("app-alpha", result.lanes().get(0).id());
        assertEquals(0, result.lanes().get(0).order());
        assertEquals("app-zebra", result.lanes().get(1).id());
        assertEquals(1, result.lanes().get(1).order());
    }

    /**
     * Test 6: Defensive name fallback -- step with null name falls back
     * to ProcessActivity name.
     */
    @Test
    void projectSingleJourney_nameNull_fallsBackToProcessActivityName() {
        // Given
        ModelFileEntity modelFile = buildModelFile();
        UserJourneyEntity journey = buildJourney(MODEL_FILE_ID, "bu-001", "bp-001");

        ActivityStepEntity step = buildStep("step-1", JOURNEY_ID, 1, "app-1", "pa-1", "bu-001");
        step.setName(null); // Force null name

        List<ActivityStepEntity> steps = List.of(step);

        setupMocks(modelFile, journey, steps);
        mockApplications(buildApp("app-1", "App One"));
        mockProcessActivities(buildPA("pa-1", "Fallback Activity Name"));
        mockBusinessUsersForSteps(buildBU("bu-001", "User One"));
        mockJourneyBusinessUser("bu-001", "User One");
        mockBusinessProcess("bp-001", "Process One");

        // When
        UserJourneyDiagramDto result = service.projectSingleJourney(PROJECT_ID, ARCHITECTURE_ID, JOURNEY_ID);

        // Then
        assertEquals(1, result.steps().size());
        assertEquals("Fallback Activity Name", result.steps().get(0).name());
    }

    /**
     * Test 7: Project scoping -- journey's modelFileId does not match
     * resolved model file, should throw ResourceNotFoundException.
     */
    @Test
    void projectSingleJourney_modelFileMismatch_throwsResourceNotFoundException() {
        // Given
        ModelFileEntity modelFile = buildModelFile(); // MODEL_FILE_ID
        UserJourneyEntity journey = buildJourney("different-model-file", "bu-001", "bp-001");

        when(modelFileRepository.findByProjectIdAndArchitectureId(PROJECT_ID, ARCHITECTURE_ID)).thenReturn(Optional.of(modelFile));
        when(userJourneyRepository.findById(JOURNEY_ID)).thenReturn(Optional.of(journey));

        // When/Then
        ResourceNotFoundException ex = assertThrows(ResourceNotFoundException.class,
            () -> service.projectSingleJourney(PROJECT_ID, ARCHITECTURE_ID, JOURNEY_ID));
        assertTrue(ex.getMessage().contains("does not belong to project"));
    }

    /**
     * Test 8: Empty steps -- journey with zero activity steps.
     * Verify empty lanes, steps, edges arrays.
     */
    @Test
    void projectSingleJourney_emptySteps_returnsEmptyArrays() {
        // Given
        ModelFileEntity modelFile = buildModelFile();
        UserJourneyEntity journey = buildJourney(MODEL_FILE_ID, "bu-001", "bp-001");

        setupMocks(modelFile, journey, List.of());
        // Only mock journey-level business user (findById), not batch (findAllById)
        // since empty steps means batch loading is skipped
        mockJourneyBusinessUser("bu-001", "User One");
        mockBusinessProcess("bp-001", "Process One");

        // When
        UserJourneyDiagramDto result = service.projectSingleJourney(PROJECT_ID, ARCHITECTURE_ID, JOURNEY_ID);

        // Then
        assertEquals("USER_JOURNEY", result.diagramType());
        assertEquals("1.0", result.version());
        assertNotNull(result.journey());
        assertTrue(result.lanes().isEmpty());
        assertTrue(result.steps().isEmpty());
        assertTrue(result.edges().isEmpty());
        assertNotNull(result.renderHints());
        assertEquals("VERTICAL", result.renderHints().laneAxis());
        assertEquals("LEFT_TO_RIGHT", result.renderHints().flowDirection());
        assertTrue(result.renderHints().showTitle());
    }

    // ============== Helper methods ==============

    private ModelFileEntity buildModelFile() {
        ModelFileEntity mf = new ModelFileEntity();
        mf.setId(MODEL_FILE_ID);
        mf.setProjectId(PROJECT_ID);
        mf.setFilename("test-model.json");
        return mf;
    }

    private UserJourneyEntity buildJourney(String modelFileId, String primaryBuId, String parentBpId) {
        UserJourneyEntity uj = new UserJourneyEntity();
        uj.setId(JOURNEY_ID);
        uj.setModelFileId(modelFileId);
        uj.setName("Test Journey");
        uj.setDescription("A test journey");
        uj.setPrimaryBusinessUserId(primaryBuId);
        uj.setParentBusinessProcessId(parentBpId);
        return uj;
    }

    private ActivityStepEntity buildStep(String id, String journeyId, int seqOrder,
                                          String appId, String paId, String buId) {
        ActivityStepEntity step = new ActivityStepEntity();
        step.setId(id);
        step.setModelFileId(MODEL_FILE_ID);
        step.setUserJourneyId(journeyId);
        step.setName("Step " + id);
        step.setDescription("Description for " + id);
        step.setSequenceOrder(seqOrder);
        step.setApplicationId(appId);
        step.setProcessActivityId(paId);
        step.setBusinessUserId(buId);
        return step;
    }

    private ApplicationEntity buildApp(String id, String name) {
        ApplicationEntity app = new ApplicationEntity();
        app.setId(id);
        app.setName(name);
        app.setModelFileId(MODEL_FILE_ID);
        return app;
    }

    private ProcessActivityEntity buildPA(String id, String name) {
        ProcessActivityEntity pa = new ProcessActivityEntity();
        pa.setId(id);
        pa.setName(name);
        pa.setModelFileId(MODEL_FILE_ID);
        return pa;
    }

    private BusinessUserEntity buildBU(String id, String name) {
        BusinessUserEntity bu = new BusinessUserEntity();
        bu.setId(id);
        bu.setName(name);
        bu.setModelFileId(MODEL_FILE_ID);
        return bu;
    }

    private BusinessProcessEntity buildBP(String id, String name) {
        BusinessProcessEntity bp = new BusinessProcessEntity();
        bp.setId(id);
        bp.setName(name);
        bp.setModelFileId(MODEL_FILE_ID);
        return bp;
    }

    private void setupMocks(ModelFileEntity modelFile, UserJourneyEntity journey,
                             List<ActivityStepEntity> steps) {
        when(modelFileRepository.findByProjectIdAndArchitectureId(PROJECT_ID, ARCHITECTURE_ID)).thenReturn(Optional.of(modelFile));
        when(userJourneyRepository.findById(JOURNEY_ID)).thenReturn(Optional.of(journey));
        when(activityStepRepository.findByUserJourneyId(JOURNEY_ID)).thenReturn(steps);
    }

    private void mockApplications(ApplicationEntity... apps) {
        when(applicationRepository.findAllById(anyCollection())).thenReturn(List.of(apps));
    }

    private void mockProcessActivities(ProcessActivityEntity... pas) {
        when(processActivityRepository.findAllById(anyCollection())).thenReturn(List.of(pas));
    }

    /**
     * Mock batch loading of step-level business users (findAllById).
     * Use only when there are steps with business user references.
     */
    private void mockBusinessUsersForSteps(BusinessUserEntity... bus) {
        when(businessUserRepository.findAllById(anyCollection())).thenReturn(List.of(bus));
    }

    /**
     * Mock journey-level primary business user resolution (findById).
     */
    private void mockJourneyBusinessUser(String id, String name) {
        BusinessUserEntity bu = buildBU(id, name);
        when(businessUserRepository.findById(id)).thenReturn(Optional.of(bu));
    }

    private void mockBusinessProcess(String id, String name) {
        BusinessProcessEntity bp = buildBP(id, name);
        when(businessProcessRepository.findById(id)).thenReturn(Optional.of(bp));
    }
}
