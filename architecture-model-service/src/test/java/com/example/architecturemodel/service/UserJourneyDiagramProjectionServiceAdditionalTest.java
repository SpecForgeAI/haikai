package com.example.architecturemodel.service;

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
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

/**
 * Additional unit tests for UserJourneyDiagramProjectionService.
 * Gap-fill tests identified during Task Group 4 review.
 *
 * Spec: User Journey Temporary Diagram JSON Generation
 * Task Group 4: Integration Tests, Test Review, and Regression
 */
@ExtendWith(MockitoExtension.class)
class UserJourneyDiagramProjectionServiceAdditionalTest {

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
     * Gap-fill Test 1: Step-level business user enrichment.
     * Verify each step has correct business_user_id and business_user_name,
     * including when step-level user differs from journey-level primary user.
     */
    @Test
    void projectSingleJourney_stepLevelBusinessUser_populatedCorrectly() {
        // Given: journey primary user is bu-001, but step-2 has a different user bu-002
        String journeyId = "uj-enrichment";
        ModelFileEntity modelFile = buildModelFile();
        UserJourneyEntity journey = buildJourney(journeyId, MODEL_FILE_ID, "bu-001", "bp-001");

        List<ActivityStepEntity> steps = List.of(
            buildStep("step-1", journeyId, 1, "app-1", "pa-1", "bu-001"),
            buildStep("step-2", journeyId, 2, "app-1", "pa-2", "bu-002")
        );

        setupMocks(modelFile, journey, journeyId, steps);
        mockApplications(buildApp("app-1", "App One"));
        mockProcessActivities(buildPA("pa-1", "Act 1"), buildPA("pa-2", "Act 2"));
        mockBusinessUsersForSteps(buildBU("bu-001", "User One"), buildBU("bu-002", "User Two"));
        mockJourneyBusinessUser("bu-001", "User One");
        mockBusinessProcess("bp-001", "Process One");

        // When
        UserJourneyDiagramDto result = service.projectSingleJourney(PROJECT_ID, ARCHITECTURE_ID, journeyId);

        // Then: step-1 has bu-001/User One, step-2 has bu-002/User Two
        assertEquals("bu-001", result.steps().get(0).businessUserId());
        assertEquals("User One", result.steps().get(0).businessUserName());
        assertEquals("bu-002", result.steps().get(1).businessUserId());
        assertEquals("User Two", result.steps().get(1).businessUserName());

        // Journey-level still shows primary user
        assertEquals("bu-001", result.journey().userRoleId());
        assertEquals("User One", result.journey().userRoleName());
    }

    /**
     * Gap-fill Test 2: projectAllJourneys with multiple journeys.
     * Verify each journey produces a complete independent diagram contract.
     */
    @Test
    void projectAllJourneys_multipleJourneys_eachProducesIndependentContract() {
        // Given: 2 journeys in the same model file
        ModelFileEntity modelFile = buildModelFile();

        UserJourneyEntity journey1 = buildJourney("uj-A", MODEL_FILE_ID, "bu-001", "bp-001");
        UserJourneyEntity journey2 = buildJourney("uj-B", MODEL_FILE_ID, "bu-001", "bp-001");

        List<ActivityStepEntity> steps1 = List.of(
            buildStep("step-a1", "uj-A", 1, "app-1", "pa-1", "bu-001")
        );
        List<ActivityStepEntity> steps2 = List.of(
            buildStep("step-b1", "uj-B", 1, "app-2", "pa-2", "bu-001"),
            buildStep("step-b2", "uj-B", 2, "app-2", "pa-3", "bu-001")
        );

        when(modelFileRepository.findByProjectIdAndArchitectureId(PROJECT_ID, ARCHITECTURE_ID)).thenReturn(Optional.of(modelFile));
        when(userJourneyRepository.findByModelFileId(MODEL_FILE_ID))
            .thenReturn(List.of(journey1, journey2));
        when(activityStepRepository.findByUserJourneyId("uj-A")).thenReturn(steps1);
        when(activityStepRepository.findByUserJourneyId("uj-B")).thenReturn(steps2);

        mockApplications(buildApp("app-1", "App One"), buildApp("app-2", "App Two"));
        mockProcessActivities(buildPA("pa-1", "Act 1"), buildPA("pa-2", "Act 2"), buildPA("pa-3", "Act 3"));
        mockBusinessUsersForSteps(buildBU("bu-001", "User One"));
        mockJourneyBusinessUser("bu-001", "User One");
        mockBusinessProcess("bp-001", "Process One");

        // When
        List<UserJourneyDiagramDto> results = service.projectAllJourneys(PROJECT_ID, ARCHITECTURE_ID);

        // Then
        assertEquals(2, results.size());

        // Journey A: 1 step, 1 lane, 0 edges
        UserJourneyDiagramDto diagramA = results.get(0);
        assertEquals("uj-A", diagramA.journey().id());
        assertEquals(1, diagramA.lanes().size());
        assertEquals(1, diagramA.steps().size());
        assertEquals(0, diagramA.edges().size());

        // Journey B: 2 steps, 1 lane, 1 edge
        UserJourneyDiagramDto diagramB = results.get(1);
        assertEquals("uj-B", diagramB.journey().id());
        assertEquals(1, diagramB.lanes().size());
        assertEquals(2, diagramB.steps().size());
        assertEquals(1, diagramB.edges().size());

        // Both have correct envelope
        for (UserJourneyDiagramDto d : results) {
            assertEquals("USER_JOURNEY", d.diagramType());
            assertEquals("1.0", d.version());
            assertNotNull(d.renderHints());
        }
    }

    /**
     * Gap-fill Test 3: Step ordering with duplicate sequence_order.
     * Verify deterministic fallback sort by id ascending.
     */
    @Test
    void projectSingleJourney_duplicateSequenceOrder_fallbackSortById() {
        // Given: 3 steps, two with the same sequence_order
        String journeyId = "uj-dup-order";
        ModelFileEntity modelFile = buildModelFile();
        UserJourneyEntity journey = buildJourney(journeyId, MODEL_FILE_ID, "bu-001", "bp-001");

        List<ActivityStepEntity> steps = List.of(
            buildStep("step-c", journeyId, 1, "app-1", "pa-1", "bu-001"),
            buildStep("step-a", journeyId, 1, "app-1", "pa-2", "bu-001"),
            buildStep("step-b", journeyId, 2, "app-1", "pa-3", "bu-001")
        );

        setupMocks(modelFile, journey, journeyId, steps);
        mockApplications(buildApp("app-1", "App One"));
        mockProcessActivities(buildPA("pa-1", "Act 1"), buildPA("pa-2", "Act 2"), buildPA("pa-3", "Act 3"));
        mockBusinessUsersForSteps(buildBU("bu-001", "User One"));
        mockJourneyBusinessUser("bu-001", "User One");
        mockBusinessProcess("bp-001", "Process One");

        // When
        UserJourneyDiagramDto result = service.projectSingleJourney(PROJECT_ID, ARCHITECTURE_ID, journeyId);

        // Then: steps ordered by sequence_order, then by id for ties
        // step-a (seq=1, id=step-a) before step-c (seq=1, id=step-c) before step-b (seq=2, id=step-b)
        assertEquals(3, result.steps().size());
        assertEquals("step-a", result.steps().get(0).id());
        assertEquals("step-c", result.steps().get(1).id());
        assertEquals("step-b", result.steps().get(2).id());
    }

    /**
     * Gap-fill Test 4: Render hints are always correct.
     * Verify static values VERTICAL, LEFT_TO_RIGHT, true are always present.
     */
    @Test
    void projectSingleJourney_renderHints_alwaysCorrect() {
        // Given: a journey with steps
        String journeyId = "uj-hints";
        ModelFileEntity modelFile = buildModelFile();
        UserJourneyEntity journey = buildJourney(journeyId, MODEL_FILE_ID, "bu-001", "bp-001");

        List<ActivityStepEntity> steps = List.of(
            buildStep("step-1", journeyId, 1, "app-1", "pa-1", "bu-001")
        );

        setupMocks(modelFile, journey, journeyId, steps);
        mockApplications(buildApp("app-1", "App One"));
        mockProcessActivities(buildPA("pa-1", "Act 1"));
        mockBusinessUsersForSteps(buildBU("bu-001", "User One"));
        mockJourneyBusinessUser("bu-001", "User One");
        mockBusinessProcess("bp-001", "Process One");

        // When
        UserJourneyDiagramDto result = service.projectSingleJourney(PROJECT_ID, ARCHITECTURE_ID, journeyId);

        // Then
        assertNotNull(result.renderHints());
        assertEquals("VERTICAL", result.renderHints().laneAxis());
        assertEquals("LEFT_TO_RIGHT", result.renderHints().flowDirection());
        assertTrue(result.renderHints().showTitle());
    }

    /**
     * Gap-fill Test 5: Edge ID determinism.
     * Verify edge IDs follow the format "edge-{journeyId}-{fromOrder}-{toOrder}".
     */
    @Test
    void projectSingleJourney_edgeIdDeterminism_consistentFormat() {
        // Given
        String journeyId = "uj-edge-ids";
        ModelFileEntity modelFile = buildModelFile();
        UserJourneyEntity journey = buildJourney(journeyId, MODEL_FILE_ID, "bu-001", "bp-001");

        List<ActivityStepEntity> steps = List.of(
            buildStep("step-1", journeyId, 10, "app-1", "pa-1", "bu-001"),
            buildStep("step-2", journeyId, 20, "app-2", "pa-2", "bu-001"),
            buildStep("step-3", journeyId, 30, "app-1", "pa-3", "bu-001")
        );

        setupMocks(modelFile, journey, journeyId, steps);
        mockApplications(buildApp("app-1", "App One"), buildApp("app-2", "App Two"));
        mockProcessActivities(buildPA("pa-1", "Act 1"), buildPA("pa-2", "Act 2"), buildPA("pa-3", "Act 3"));
        mockBusinessUsersForSteps(buildBU("bu-001", "User One"));
        mockJourneyBusinessUser("bu-001", "User One");
        mockBusinessProcess("bp-001", "Process One");

        // When
        UserJourneyDiagramDto result = service.projectSingleJourney(PROJECT_ID, ARCHITECTURE_ID, journeyId);

        // Then: edge IDs use sequence_order values, not step indices
        assertEquals(2, result.edges().size());
        assertEquals("edge-uj-edge-ids-10-20", result.edges().get(0).id());
        assertEquals("edge-uj-edge-ids-20-30", result.edges().get(1).id());

        // Verify from/to step IDs are correct
        assertEquals("step-1", result.edges().get(0).fromStepId());
        assertEquals("step-2", result.edges().get(0).toStepId());
        assertEquals("step-2", result.edges().get(1).fromStepId());
        assertEquals("step-3", result.edges().get(1).toStepId());
    }

    // ============== Helper methods ==============

    private ModelFileEntity buildModelFile() {
        ModelFileEntity mf = new ModelFileEntity();
        mf.setId(MODEL_FILE_ID);
        mf.setProjectId(PROJECT_ID);
        mf.setFilename("test-model.json");
        return mf;
    }

    private UserJourneyEntity buildJourney(String id, String modelFileId, String primaryBuId, String parentBpId) {
        UserJourneyEntity uj = new UserJourneyEntity();
        uj.setId(id);
        uj.setModelFileId(modelFileId);
        uj.setName("Journey " + id);
        uj.setDescription("Description for " + id);
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
                             String journeyId, List<ActivityStepEntity> steps) {
        when(modelFileRepository.findByProjectIdAndArchitectureId(PROJECT_ID, ARCHITECTURE_ID)).thenReturn(Optional.of(modelFile));
        when(userJourneyRepository.findById(journeyId)).thenReturn(Optional.of(journey));
        when(activityStepRepository.findByUserJourneyId(journeyId)).thenReturn(steps);
    }

    private void mockApplications(ApplicationEntity... apps) {
        when(applicationRepository.findAllById(anyCollection())).thenReturn(List.of(apps));
    }

    private void mockProcessActivities(ProcessActivityEntity... pas) {
        when(processActivityRepository.findAllById(anyCollection())).thenReturn(List.of(pas));
    }

    private void mockBusinessUsersForSteps(BusinessUserEntity... bus) {
        when(businessUserRepository.findAllById(anyCollection())).thenReturn(List.of(bus));
    }

    private void mockJourneyBusinessUser(String id, String name) {
        BusinessUserEntity bu = buildBU(id, name);
        when(businessUserRepository.findById(id)).thenReturn(Optional.of(bu));
    }

    private void mockBusinessProcess(String id, String name) {
        BusinessProcessEntity bp = buildBP(id, name);
        when(businessProcessRepository.findById(id)).thenReturn(Optional.of(bp));
    }
}
