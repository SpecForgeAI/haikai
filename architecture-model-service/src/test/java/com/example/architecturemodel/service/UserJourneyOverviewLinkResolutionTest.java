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
 * Focused tests for Task Group 2: Link Resolution Logic in Projection Service.
 *
 * Spec: User Journey Overview Parent-Child Diagram Linking
 * Task 2.1: 6 focused tests for link resolution behavior.
 *
 * Test 1: Zero matching child diagrams produces UNLINKED status with null diagram fields
 * Test 2: Exactly one matching child diagram produces LINKED with correct diagram id and name
 * Test 3: Multiple matching child diagrams produces AMBIGUOUS_RESOLVED, selecting alphabetically last ID
 * Test 4: Diagrams with null typedContentJson are skipped during resolution (v1 diagrams)
 * Test 5: Diagrams with null content or null sync block in typedContentJson are skipped
 * Test 6: Link resolution uses the same modelFileId as the projection scope (no cross-project linking)
 */
@ExtendWith(MockitoExtension.class)
class UserJourneyOverviewLinkResolutionTest {

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
    // Test 1: Zero matching child diagrams produces UNLINKED
    // ============================================================================

    @Test
    @DisplayName("Zero matching child diagrams for a node produces UNLINKED status with null diagram fields")
    void linkResolution_zeroMatches_producesUnlinked() {
        // Given: standard setup with one journey, but NO child USER_JOURNEY diagrams
        setupStandardProjection();

        UserJourneyEntity j1 = buildJourney("uj-1", "Journey One", BUSINESS_USER_ID, "bp-1");
        when(userJourneyRepository.findByModelFileId(MODEL_FILE_ID)).thenReturn(List.of(j1));

        BusinessProcessEntity bp1 = buildBP("bp-1", "Process One");
        when(businessProcessRepository.findAllById(anyCollection())).thenReturn(List.of(bp1));
        when(userJourneyLinkRepository.findByModelFileId(MODEL_FILE_ID)).thenReturn(List.of());
        when(activityStepRepository.findByUserJourneyId("uj-1")).thenReturn(List.of());

        // No child diagrams at all
        when(diagramRepository.findByModelFileIdAndDiagramType(MODEL_FILE_ID, "USER_JOURNEY"))
            .thenReturn(List.of());

        // When
        UserJourneyOverviewDiagramDto result = service.projectOverview(PROJECT_ID, ARCHITECTURE_ID, BUSINESS_USER_ID);

        // Then
        assertThat(result.nodes()).hasSize(1);
        UserJourneyOverviewNodeDto.UserJourneyOverviewNodeLinkDto link = result.nodes().get(0).link();
        assertThat(link).isNotNull();
        assertThat(link.linkStatus()).isEqualTo("UNLINKED");
        assertThat(link.linkedDiagramId()).isNull();
        assertThat(link.linkedDiagramName()).isNull();
    }

    // ============================================================================
    // Test 2: Exactly one matching child diagram produces LINKED
    // ============================================================================

    @Test
    @DisplayName("Exactly one matching child diagram produces LINKED status with correct diagram id and name")
    void linkResolution_oneMatch_producesLinked() {
        // Given
        setupStandardProjection();

        UserJourneyEntity j1 = buildJourney("uj-1", "Journey One", BUSINESS_USER_ID, "bp-1");
        when(userJourneyRepository.findByModelFileId(MODEL_FILE_ID)).thenReturn(List.of(j1));

        BusinessProcessEntity bp1 = buildBP("bp-1", "Process One");
        when(businessProcessRepository.findAllById(anyCollection())).thenReturn(List.of(bp1));
        when(userJourneyLinkRepository.findByModelFileId(MODEL_FILE_ID)).thenReturn(List.of());
        when(activityStepRepository.findByUserJourneyId("uj-1")).thenReturn(List.of());

        // One child diagram linked to uj-1
        DiagramEntity childDiagram = buildChildDiagram("diag-child-1", "Journey One Detail", "uj-1");
        when(diagramRepository.findByModelFileIdAndDiagramType(MODEL_FILE_ID, "USER_JOURNEY"))
            .thenReturn(List.of(childDiagram));

        // When
        UserJourneyOverviewDiagramDto result = service.projectOverview(PROJECT_ID, ARCHITECTURE_ID, BUSINESS_USER_ID);

        // Then
        assertThat(result.nodes()).hasSize(1);
        UserJourneyOverviewNodeDto.UserJourneyOverviewNodeLinkDto link = result.nodes().get(0).link();
        assertThat(link).isNotNull();
        assertThat(link.linkStatus()).isEqualTo("LINKED");
        assertThat(link.linkedDiagramId()).isEqualTo("diag-child-1");
        assertThat(link.linkedDiagramName()).isEqualTo("Journey One Detail");
    }

    // ============================================================================
    // Test 3: Multiple matching child diagrams produces AMBIGUOUS_RESOLVED
    // ============================================================================

    @Test
    @DisplayName("Multiple matching child diagrams produces AMBIGUOUS_RESOLVED, selecting alphabetically last ID")
    void linkResolution_multipleMatches_producesAmbiguousResolved_selectsAlphabeticallyLastId() {
        // Given
        setupStandardProjection();

        UserJourneyEntity j1 = buildJourney("uj-1", "Journey One", BUSINESS_USER_ID, "bp-1");
        when(userJourneyRepository.findByModelFileId(MODEL_FILE_ID)).thenReturn(List.of(j1));

        BusinessProcessEntity bp1 = buildBP("bp-1", "Process One");
        when(businessProcessRepository.findAllById(anyCollection())).thenReturn(List.of(bp1));
        when(userJourneyLinkRepository.findByModelFileId(MODEL_FILE_ID)).thenReturn(List.of());
        when(activityStepRepository.findByUserJourneyId("uj-1")).thenReturn(List.of());

        // Two child diagrams both linked to uj-1
        DiagramEntity diagA = buildChildDiagram("diag-a", "Journey One Draft A", "uj-1");
        DiagramEntity diagZ = buildChildDiagram("diag-z", "Journey One Draft Z", "uj-1");
        when(diagramRepository.findByModelFileIdAndDiagramType(MODEL_FILE_ID, "USER_JOURNEY"))
            .thenReturn(List.of(diagA, diagZ));

        // When
        UserJourneyOverviewDiagramDto result = service.projectOverview(PROJECT_ID, ARCHITECTURE_ID, BUSINESS_USER_ID);

        // Then: "diag-z" is alphabetically last, so it should be selected
        assertThat(result.nodes()).hasSize(1);
        UserJourneyOverviewNodeDto.UserJourneyOverviewNodeLinkDto link = result.nodes().get(0).link();
        assertThat(link).isNotNull();
        assertThat(link.linkStatus()).isEqualTo("AMBIGUOUS_RESOLVED");
        assertThat(link.linkedDiagramId()).isEqualTo("diag-z");
        assertThat(link.linkedDiagramName()).isEqualTo("Journey One Draft Z");
    }

    // ============================================================================
    // Test 4: Diagrams with null typedContentJson are skipped
    // ============================================================================

    @Test
    @DisplayName("Diagrams with null typedContentJson are skipped during resolution (v1 diagrams)")
    void linkResolution_nullTypedContentJson_diagramSkipped() {
        // Given
        setupStandardProjection();

        UserJourneyEntity j1 = buildJourney("uj-1", "Journey One", BUSINESS_USER_ID, "bp-1");
        when(userJourneyRepository.findByModelFileId(MODEL_FILE_ID)).thenReturn(List.of(j1));

        BusinessProcessEntity bp1 = buildBP("bp-1", "Process One");
        when(businessProcessRepository.findAllById(anyCollection())).thenReturn(List.of(bp1));
        when(userJourneyLinkRepository.findByModelFileId(MODEL_FILE_ID)).thenReturn(List.of());
        when(activityStepRepository.findByUserJourneyId("uj-1")).thenReturn(List.of());

        // A v1 diagram with null typedContentJson -- should be skipped
        DiagramEntity v1Diagram = DiagramEntity.builder()
            .id("diag-v1")
            .modelFileId(MODEL_FILE_ID)
            .name("V1 Journey Diagram")
            .diagramType("USER_JOURNEY")
            .typedContentJson(null)
            .build();

        when(diagramRepository.findByModelFileIdAndDiagramType(MODEL_FILE_ID, "USER_JOURNEY"))
            .thenReturn(List.of(v1Diagram));

        // When
        UserJourneyOverviewDiagramDto result = service.projectOverview(PROJECT_ID, ARCHITECTURE_ID, BUSINESS_USER_ID);

        // Then: no match because the v1 diagram was skipped, so UNLINKED
        assertThat(result.nodes()).hasSize(1);
        UserJourneyOverviewNodeDto.UserJourneyOverviewNodeLinkDto link = result.nodes().get(0).link();
        assertThat(link.linkStatus()).isEqualTo("UNLINKED");
        assertThat(link.linkedDiagramId()).isNull();
    }

    // ============================================================================
    // Test 5: Diagrams with null content or null sync block are skipped
    // ============================================================================

    @Test
    @DisplayName("Diagrams with null content or null sync block in typedContentJson are skipped")
    void linkResolution_nullContentOrNullSync_diagramsSkipped() {
        // Given
        setupStandardProjection();

        UserJourneyEntity j1 = buildJourney("uj-1", "Journey One", BUSINESS_USER_ID, "bp-1");
        when(userJourneyRepository.findByModelFileId(MODEL_FILE_ID)).thenReturn(List.of(j1));

        BusinessProcessEntity bp1 = buildBP("bp-1", "Process One");
        when(businessProcessRepository.findAllById(anyCollection())).thenReturn(List.of(bp1));
        when(userJourneyLinkRepository.findByModelFileId(MODEL_FILE_ID)).thenReturn(List.of());
        when(activityStepRepository.findByUserJourneyId("uj-1")).thenReturn(List.of());

        // Diagram with typedContentJson but no "content" key
        DiagramEntity noContent = DiagramEntity.builder()
            .id("diag-no-content")
            .modelFileId(MODEL_FILE_ID)
            .name("No Content Diagram")
            .diagramType("USER_JOURNEY")
            .typedContentJson(Map.of("type", "USER_JOURNEY", "version", 1))
            .build();

        // Diagram with "content" but no "sync" key
        Map<String, Object> contentNoSync = new HashMap<>();
        contentNoSync.put("diagram_type", "USER_JOURNEY");
        // no "sync" key
        DiagramEntity noSync = DiagramEntity.builder()
            .id("diag-no-sync")
            .modelFileId(MODEL_FILE_ID)
            .name("No Sync Diagram")
            .diagramType("USER_JOURNEY")
            .typedContentJson(Map.of("type", "USER_JOURNEY", "version", 1, "content", contentNoSync))
            .build();

        when(diagramRepository.findByModelFileIdAndDiagramType(MODEL_FILE_ID, "USER_JOURNEY"))
            .thenReturn(List.of(noContent, noSync));

        // When
        UserJourneyOverviewDiagramDto result = service.projectOverview(PROJECT_ID, ARCHITECTURE_ID, BUSINESS_USER_ID);

        // Then: both diagrams skipped, so UNLINKED
        assertThat(result.nodes()).hasSize(1);
        UserJourneyOverviewNodeDto.UserJourneyOverviewNodeLinkDto link = result.nodes().get(0).link();
        assertThat(link.linkStatus()).isEqualTo("UNLINKED");
        assertThat(link.linkedDiagramId()).isNull();
    }

    // ============================================================================
    // Test 6: Link resolution uses the same modelFileId as projection scope
    // ============================================================================

    @Test
    @DisplayName("Link resolution uses the same modelFileId as the projection scope (no cross-project linking)")
    void linkResolution_useSameModelFileIdAsProjectionScope() {
        // Given: standard setup with a specific model file ID
        setupStandardProjection();

        UserJourneyEntity j1 = buildJourney("uj-1", "Journey One", BUSINESS_USER_ID, "bp-1");
        when(userJourneyRepository.findByModelFileId(MODEL_FILE_ID)).thenReturn(List.of(j1));

        BusinessProcessEntity bp1 = buildBP("bp-1", "Process One");
        when(businessProcessRepository.findAllById(anyCollection())).thenReturn(List.of(bp1));
        when(userJourneyLinkRepository.findByModelFileId(MODEL_FILE_ID)).thenReturn(List.of());
        when(activityStepRepository.findByUserJourneyId("uj-1")).thenReturn(List.of());

        // Child diagram in the SAME model file that matches uj-1
        DiagramEntity sameModelDiag = buildChildDiagram("diag-same", "Same Model Journey", "uj-1");

        // The repository is called with the correct model file ID (MODEL_FILE_ID)
        when(diagramRepository.findByModelFileIdAndDiagramType(MODEL_FILE_ID, "USER_JOURNEY"))
            .thenReturn(List.of(sameModelDiag));

        // When
        UserJourneyOverviewDiagramDto result = service.projectOverview(PROJECT_ID, ARCHITECTURE_ID, BUSINESS_USER_ID);

        // Then: the child diagram from the same model file is resolved as LINKED
        assertThat(result.nodes()).hasSize(1);
        UserJourneyOverviewNodeDto.UserJourneyOverviewNodeLinkDto link = result.nodes().get(0).link();
        assertThat(link.linkStatus()).isEqualTo("LINKED");
        assertThat(link.linkedDiagramId()).isEqualTo("diag-same");
        assertThat(link.linkedDiagramName()).isEqualTo("Same Model Journey");
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

    /**
     * Build a child USER_JOURNEY DiagramEntity with properly structured typedContentJson
     * containing sync.source_user_journey_id matching the given journeyId.
     *
     * Follows the UserJourneySyncService pattern:
     *   typedContentJson -> "content" (Map) -> "sync" (Map) -> "source_user_journey_id" (String)
     */
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
