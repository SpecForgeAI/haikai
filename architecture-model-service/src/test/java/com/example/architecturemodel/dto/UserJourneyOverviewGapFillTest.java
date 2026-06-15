package com.example.architecturemodel.dto;

import com.example.architecturemodel.model.dto.diagram.*;
import com.example.architecturemodel.model.entity.*;
import com.example.architecturemodel.repository.ModelFileRepository;
import com.example.architecturemodel.repository.diagram.DiagramRepository;
import com.example.architecturemodel.repository.entity.*;
import com.example.architecturemodel.repository.relationship.UserJourneyLinkRepository;
import com.example.architecturemodel.service.UserJourneyOverviewDiagramProjectionService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.*;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

/**
 * Gap-fill tests for the User Journey Overview projection service.
 *
 * Spec 2026-04-07: User Journey Overview Parent Diagram Generation
 * Task Group 8: Test Review and Gap Analysis
 *
 * Placed in the dto package to avoid compilation issues from pre-existing
 * broken test files in the service and controller packages.
 *
 * Fills two critical gaps identified in TG1-7 tests:
 *
 * Gap 1: Verify that journeys with zero activity steps produce step_count=0
 *         and application_count=0 in node metadata (existing tests mock empty
 *         step lists but never assert the metadata values for those nodes).
 *
 * Gap 2: Verify lane ordering with 5+ BPs plus Unassigned -- ensures
 *         alphabetical ordering is robust beyond the 2-lane case tested in TG2.
 */
@ExtendWith(MockitoExtension.class)
class UserJourneyOverviewGapFillTest {

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
    private static final String MODEL_FILE_ID = "mf-gap";
    private static final String BUSINESS_USER_ID = "bu-gap";

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
    // Gap 1: Journeys with zero activity steps yield step_count=0,
    //        application_count=0 in metadata
    // ============================================================================

    @Test
    @DisplayName("Gap 1: Node metadata has step_count=0 and application_count=0 when journey has no activity steps")
    void projectOverview_zeroActivitySteps_metadataShowsZeros() {
        // Given: one journey with no activity steps
        ModelFileEntity modelFile = buildModelFile();
        when(modelFileRepository.findByProjectIdAndArchitectureId(PROJECT_ID, ARCHITECTURE_ID)).thenReturn(Optional.of(modelFile));

        BusinessUserEntity bu = buildBU(BUSINESS_USER_ID, "Gap User");
        when(businessUserRepository.findById(BUSINESS_USER_ID)).thenReturn(Optional.of(bu));

        UserJourneyEntity j1 = buildJourney("uj-zero", "Empty Journey", BUSINESS_USER_ID, "bp-1");
        when(userJourneyRepository.findByModelFileId(MODEL_FILE_ID)).thenReturn(List.of(j1));

        BusinessProcessEntity bp = buildBP("bp-1", "Process A");
        when(businessProcessRepository.findAllById(anyCollection())).thenReturn(List.of(bp));

        when(userJourneyLinkRepository.findByModelFileId(MODEL_FILE_ID)).thenReturn(List.of());
        // Zero steps
        when(activityStepRepository.findByUserJourneyId("uj-zero")).thenReturn(List.of());

        // No child diagrams for link resolution
        when(diagramRepository.findByModelFileIdAndDiagramType(eq(MODEL_FILE_ID), eq("USER_JOURNEY")))
            .thenReturn(List.of());

        // When
        UserJourneyOverviewDiagramDto result = service.projectOverview(PROJECT_ID, ARCHITECTURE_ID, BUSINESS_USER_ID);

        // Then: verify metadata explicitly shows zeros
        assertEquals(1, result.nodes().size());
        UserJourneyOverviewNodeDto node = result.nodes().get(0);
        assertEquals(0, node.metadata().stepCount(), "step_count should be 0 for journey with no activity steps");
        assertEquals(0, node.metadata().applicationCount(), "application_count should be 0 for journey with no activity steps");
        assertEquals(0, node.metadata().relationshipInCount(), "relationship_in_count should be 0 when no links");
        assertEquals(0, node.metadata().relationshipOutCount(), "relationship_out_count should be 0 when no links");
    }

    // ============================================================================
    // Gap 2: Lane ordering with 5+ BPs plus Unassigned lane
    // ============================================================================

    @Test
    @DisplayName("Gap 2: 5 named lanes plus Unassigned are ordered alphabetically with Unassigned last")
    void projectOverview_manyLanes_alphabeticalWithUnassignedLast() {
        // Given: 6 journeys across 5 BPs + 1 unassigned
        ModelFileEntity modelFile = buildModelFile();
        when(modelFileRepository.findByProjectIdAndArchitectureId(PROJECT_ID, ARCHITECTURE_ID)).thenReturn(Optional.of(modelFile));

        BusinessUserEntity bu = buildBU(BUSINESS_USER_ID, "Lane Test User");
        when(businessUserRepository.findById(BUSINESS_USER_ID)).thenReturn(Optional.of(bu));

        // 5 named BPs + 1 unassigned journey
        UserJourneyEntity j1 = buildJourney("uj-1", "J1", BUSINESS_USER_ID, "bp-echo");
        UserJourneyEntity j2 = buildJourney("uj-2", "J2", BUSINESS_USER_ID, "bp-alpha");
        UserJourneyEntity j3 = buildJourney("uj-3", "J3", BUSINESS_USER_ID, "bp-charlie");
        UserJourneyEntity j4 = buildJourney("uj-4", "J4", BUSINESS_USER_ID, "bp-bravo");
        UserJourneyEntity j5 = buildJourney("uj-5", "J5", BUSINESS_USER_ID, "bp-delta");
        UserJourneyEntity j6 = buildJourney("uj-6", "J6", BUSINESS_USER_ID, null); // unassigned

        when(userJourneyRepository.findByModelFileId(MODEL_FILE_ID))
            .thenReturn(List.of(j1, j2, j3, j4, j5, j6));

        BusinessProcessEntity bpAlpha = buildBP("bp-alpha", "Alpha Process");
        BusinessProcessEntity bpBravo = buildBP("bp-bravo", "Bravo Process");
        BusinessProcessEntity bpCharlie = buildBP("bp-charlie", "Charlie Process");
        BusinessProcessEntity bpDelta = buildBP("bp-delta", "Delta Process");
        BusinessProcessEntity bpEcho = buildBP("bp-echo", "Echo Process");
        when(businessProcessRepository.findAllById(anyCollection()))
            .thenReturn(List.of(bpAlpha, bpBravo, bpCharlie, bpDelta, bpEcho));

        when(userJourneyLinkRepository.findByModelFileId(MODEL_FILE_ID)).thenReturn(List.of());
        for (int i = 1; i <= 6; i++) {
            when(activityStepRepository.findByUserJourneyId("uj-" + i)).thenReturn(List.of());
        }

        // No child diagrams for link resolution
        when(diagramRepository.findByModelFileIdAndDiagramType(eq(MODEL_FILE_ID), eq("USER_JOURNEY")))
            .thenReturn(List.of());

        // When
        UserJourneyOverviewDiagramDto result = service.projectOverview(PROJECT_ID, ARCHITECTURE_ID, BUSINESS_USER_ID);

        // Then: 6 lanes total, 5 named alphabetically + Unassigned last
        assertEquals(6, result.lanes().size());
        assertEquals("Alpha Process", result.lanes().get(0).name());
        assertEquals(0, result.lanes().get(0).order());
        assertEquals("Bravo Process", result.lanes().get(1).name());
        assertEquals(1, result.lanes().get(1).order());
        assertEquals("Charlie Process", result.lanes().get(2).name());
        assertEquals(2, result.lanes().get(2).order());
        assertEquals("Delta Process", result.lanes().get(3).name());
        assertEquals(3, result.lanes().get(3).order());
        assertEquals("Echo Process", result.lanes().get(4).name());
        assertEquals(4, result.lanes().get(4).order());
        assertEquals("Unassigned", result.lanes().get(5).name());
        assertEquals("unassigned", result.lanes().get(5).id());
        assertEquals(5, result.lanes().get(5).order());
    }

    // ============== Helper methods ==============

    private ModelFileEntity buildModelFile() {
        ModelFileEntity mf = new ModelFileEntity();
        mf.setId(MODEL_FILE_ID);
        mf.setProjectId(PROJECT_ID);
        mf.setFilename("gap-model.json");
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
}
