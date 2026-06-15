package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.mapper.DiagramMapper;
import com.example.architecturemodel.model.dto.diagram.*;
import com.example.architecturemodel.model.entity.DiagramEntity;
import com.example.architecturemodel.repository.diagram.DiagramRepository;
import com.example.architecturemodel.util.UserJourneyDiagramHashUtil;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.*;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

/**
 * Unit tests for UserJourneyDiagramHashUtil and UserJourneySyncService.
 *
 * Spec: User Journey One-Way Sync from Meta-Model
 * Task Group 1: Hash Utility and Sync Service
 */
@ExtendWith(MockitoExtension.class)
class UserJourneySyncServiceTest {

    @Mock
    private DiagramRepository diagramRepository;

    @Mock
    private UserJourneyDiagramProjectionService projectionService;

    @Mock
    private DiagramMapper diagramMapper;

    @InjectMocks
    private UserJourneySyncService syncService;

    private static final UUID PROJECT_ID = UUID.randomUUID();
    private static final UUID ARCHITECTURE_ID = UUID.randomUUID();
    private static final String DIAGRAM_ID = "diag-001";
    private static final String JOURNEY_ID = "uj-001";

    private UserJourneyDiagramDto sampleDiagram;
    private String sampleHash;

    @BeforeEach
    void setUp() {
        sampleDiagram = buildSampleDiagram();
        sampleHash = UserJourneyDiagramHashUtil.computeCanonicalHash(sampleDiagram);
    }

    // ========================================================================
    // Test 1: computeCanonicalHash produces consistent SHA-256 for same input
    // ========================================================================

    @Test
    void computeCanonicalHash_producesConsistentHashForSameInput() {
        UserJourneyDiagramDto dto = buildSampleDiagram();

        String hash1 = UserJourneyDiagramHashUtil.computeCanonicalHash(dto);
        String hash2 = UserJourneyDiagramHashUtil.computeCanonicalHash(dto);

        assertThat(hash1).isNotNull();
        assertThat(hash1).isNotEmpty();
        assertThat(hash1).isEqualTo(hash2);
        // SHA-256 produces 64 hex characters
        assertThat(hash1).hasSize(64);
    }

    // ========================================================================
    // Test 2: computeCanonicalHash produces different hashes for different inputs
    // ========================================================================

    @Test
    void computeCanonicalHash_producesDifferentHashForDifferentInput() {
        UserJourneyDiagramDto dto1 = buildSampleDiagram();

        // Build a different diagram with a changed step name
        UserJourneyDiagramDto dto2 = new UserJourneyDiagramDto(
            "USER_JOURNEY", "1.0",
            new UserJourneyDiagramJourneyDto(JOURNEY_ID, "Test Journey", "desc",
                "bu-001", "User One", "bp-001", "Process One"),
            List.of(new UserJourneyDiagramLaneDto("app-1", "App One", 0)),
            List.of(new UserJourneyDiagramStepDto("step-1", JOURNEY_ID, 1, "app-1",
                "pa-1", "Act 1", "CHANGED Step Name", null, "Desc 1", "bu-001", "User One", null, null)),
            List.of(),
            new UserJourneyDiagramRenderHintsDto("VERTICAL", "LEFT_TO_RIGHT", true)
        );

        String hash1 = UserJourneyDiagramHashUtil.computeCanonicalHash(dto1);
        String hash2 = UserJourneyDiagramHashUtil.computeCanonicalHash(dto2);

        assertThat(hash1).isNotEqualTo(hash2);
    }

    // ========================================================================
    // Test 3: checkSyncStatus returns IN_SYNC when hashes match
    // ========================================================================

    @Test
    void checkSyncStatus_returnsInSync_whenHashesMatch() {
        DiagramEntity entity = buildV2DiagramEntity(sampleHash);
        when(diagramRepository.findById(DIAGRAM_ID)).thenReturn(Optional.of(entity));
        // The sync block carries no source_architecture_id; the service derives the
        // architecture id from source_project_id (Default architecture UUID == project UUID).
        when(projectionService.projectSingleJourney(PROJECT_ID, PROJECT_ID, JOURNEY_ID)).thenReturn(sampleDiagram);

        UserJourneySyncStatusResponse response = syncService.checkSyncStatus(PROJECT_ID, ARCHITECTURE_ID, DIAGRAM_ID);

        assertThat(response.syncStatus()).isEqualTo("IN_SYNC");
        assertThat(response.staleReason()).isNull();
        assertThat(response.lastSyncedAt()).isNotNull();
        assertThat(response.lastSyncedHash()).isEqualTo(sampleHash);
    }

    // ========================================================================
    // Test 4: checkSyncStatus returns STALE when hashes differ
    // ========================================================================

    @Test
    void checkSyncStatus_returnsStale_whenHashesDiffer() {
        // Save with a different hash than what the projection will produce
        DiagramEntity entity = buildV2DiagramEntity("oldhash000000000000000000000000000000000000000000000000000000000");
        when(diagramRepository.findById(DIAGRAM_ID)).thenReturn(Optional.of(entity));
        // The sync block carries no source_architecture_id; the service derives the
        // architecture id from source_project_id (Default architecture UUID == project UUID).
        when(projectionService.projectSingleJourney(PROJECT_ID, PROJECT_ID, JOURNEY_ID)).thenReturn(sampleDiagram);

        UserJourneySyncStatusResponse response = syncService.checkSyncStatus(PROJECT_ID, ARCHITECTURE_ID, DIAGRAM_ID);

        assertThat(response.syncStatus()).isEqualTo("STALE");
        assertThat(response.staleReason()).isEqualTo("Meta-model data has changed since last sync");
    }

    // ========================================================================
    // Test 5: checkSyncStatus returns BROKEN_SOURCE when projection throws
    // ========================================================================

    @Test
    void checkSyncStatus_returnsBrokenSource_whenProjectionThrows() {
        DiagramEntity entity = buildV2DiagramEntity(sampleHash);
        when(diagramRepository.findById(DIAGRAM_ID)).thenReturn(Optional.of(entity));
        // The sync block carries no source_architecture_id; the service derives the
        // architecture id from source_project_id (Default architecture UUID == project UUID).
        when(projectionService.projectSingleJourney(PROJECT_ID, PROJECT_ID, JOURNEY_ID))
            .thenThrow(new ResourceNotFoundException("User journey not found: " + JOURNEY_ID));

        UserJourneySyncStatusResponse response = syncService.checkSyncStatus(PROJECT_ID, ARCHITECTURE_ID, DIAGRAM_ID);

        assertThat(response.syncStatus()).isEqualTo("BROKEN_SOURCE");
        assertThat(response.staleReason()).contains("User journey not found");
    }

    // ========================================================================
    // Test 6: checkSyncStatus returns UNLINKED for v1 diagrams
    // ========================================================================

    @Test
    void checkSyncStatus_returnsUnlinked_forV1Diagram() {
        // v1 diagram: typedContentJson has content but no sync block
        Map<String, Object> content = new LinkedHashMap<>();
        content.put("diagram_type", "USER_JOURNEY");
        content.put("version", "1.0");
        content.put("journey", Map.of("id", JOURNEY_ID, "name", "Test"));
        content.put("lanes", List.of());
        content.put("steps", List.of());
        content.put("edges", List.of());
        // No "sync" key -- this is a v1 diagram

        Map<String, Object> typedContentJson = new LinkedHashMap<>();
        typedContentJson.put("type", "USER_JOURNEY");
        typedContentJson.put("version", 1);
        typedContentJson.put("content", content);

        DiagramEntity entity = DiagramEntity.builder()
            .id(DIAGRAM_ID)
            .modelFileId("mf-001")
            .name("V1 Diagram")
            .diagramType("USER_JOURNEY")
            .typedContentJson(typedContentJson)
            .build();

        when(diagramRepository.findById(DIAGRAM_ID)).thenReturn(Optional.of(entity));

        UserJourneySyncStatusResponse response = syncService.checkSyncStatus(PROJECT_ID, ARCHITECTURE_ID, DIAGRAM_ID);

        assertThat(response.syncStatus()).isEqualTo("UNLINKED");
        assertThat(response.staleReason()).isNull();
        assertThat(response.lastSyncedAt()).isNull();
        assertThat(response.lastSyncedHash()).isNull();
    }

    // ============== Helper methods ==============

    private UserJourneyDiagramDto buildSampleDiagram() {
        return new UserJourneyDiagramDto(
            "USER_JOURNEY", "1.0",
            new UserJourneyDiagramJourneyDto(JOURNEY_ID, "Test Journey", "A test journey",
                "bu-001", "User One", "bp-001", "Process One"),
            List.of(new UserJourneyDiagramLaneDto("app-1", "App One", 0)),
            List.of(
                new UserJourneyDiagramStepDto("step-1", JOURNEY_ID, 1, "app-1",
                    "pa-1", "Act 1", "Step 1", null, "Desc 1", "bu-001", "User One", null, null),
                new UserJourneyDiagramStepDto("step-2", JOURNEY_ID, 2, "app-1",
                    "pa-2", "Act 2", "Step 2", null, "Desc 2", "bu-001", "User One", null, null)
            ),
            List.of(
                new UserJourneyDiagramEdgeDto("edge-" + JOURNEY_ID + "-1-2", "step-1", "step-2", 0, false)
            ),
            new UserJourneyDiagramRenderHintsDto("VERTICAL", "LEFT_TO_RIGHT", true)
        );
    }

    private DiagramEntity buildV2DiagramEntity(String hash) {
        Map<String, Object> syncBlock = new LinkedHashMap<>();
        syncBlock.put("source_user_journey_id", JOURNEY_ID);
        syncBlock.put("source_project_id", PROJECT_ID.toString());
        syncBlock.put("source_model_file_id", null);
        syncBlock.put("source_projection_version", "1.0");
        syncBlock.put("last_synced_at", "2026-04-03T10:00:00Z");
        syncBlock.put("last_synced_hash", hash);
        syncBlock.put("sync_status", "IN_SYNC");
        syncBlock.put("stale_reason", null);

        Map<String, Object> content = new LinkedHashMap<>();
        content.put("diagram_type", "USER_JOURNEY");
        content.put("version", "1.0");
        content.put("journey", Map.of("id", JOURNEY_ID, "name", "Test Journey"));
        content.put("lanes", List.of());
        content.put("steps", List.of());
        content.put("edges", List.of());
        content.put("sync", syncBlock);

        Map<String, Object> typedContentJson = new LinkedHashMap<>();
        typedContentJson.put("type", "USER_JOURNEY");
        typedContentJson.put("version", 2);
        typedContentJson.put("content", content);

        return DiagramEntity.builder()
            .id(DIAGRAM_ID)
            .modelFileId("mf-001")
            .name("Saved Journey Diagram")
            .diagramType("USER_JOURNEY")
            .typedContentJson(typedContentJson)
            .build();
    }
}
