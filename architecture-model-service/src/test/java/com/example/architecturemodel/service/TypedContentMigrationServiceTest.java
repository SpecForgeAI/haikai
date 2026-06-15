package com.example.architecturemodel.service;

import com.example.architecturemodel.model.dto.entity.*;
import com.example.architecturemodel.model.entity.*;
import com.example.architecturemodel.repository.diagram.DiagramRepository;
import com.example.architecturemodel.repository.entity.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.OffsetDateTime;
import java.util.*;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/**
 * Tests for Task Group 4: Migrate Existing Sequence Data to typed_content_json.
 *
 * These tests verify:
 * 1. Migration copies existing sequence_* table data into typed_content_json
 * 2. Migration creates default empty Sequence typedContent when no sequence_diagrams record exists
 * 3. Migration is idempotent (skips diagrams with non-null typed_content_json)
 * 4. Migration logs counts correctly (migrated N, defaulted M)
 */
@ExtendWith(MockitoExtension.class)
class TypedContentMigrationServiceTest {

    @Mock private DiagramRepository diagramRepository;
    @Mock private SequenceDiagramRepository sequenceDiagramRepository;
    @Mock private SequenceParticipantRepository sequenceParticipantRepository;
    @Mock private SequenceMessageRepository sequenceMessageRepository;
    @Mock private SequenceFragmentRepository sequenceFragmentRepository;
    @Mock private SequenceOperandRepository sequenceOperandRepository;
    @Mock private SequenceNodeRepository sequenceNodeRepository;

    private TypedContentMigrationService migrationService;

    @BeforeEach
    void setUp() {
        migrationService = new TypedContentMigrationService(
            diagramRepository,
            sequenceDiagramRepository,
            sequenceParticipantRepository,
            sequenceMessageRepository,
            sequenceFragmentRepository,
            sequenceOperandRepository,
            sequenceNodeRepository
        );
    }

    /**
     * Test 1: Migration copies existing sequence_* table data into typed_content_json.
     *
     * When a Sequence diagram exists with data in the sequence_* tables,
     * the migration should copy that data into the diagrams.typed_content_json column.
     */
    @Test
    @DisplayName("Test 1: Migration copies existing sequence_* table data into typed_content_json")
    void testMigrationCopiesExistingSequenceData() {
        String diagramId = "seq-diagram-1";
        String modelFileId = "mf-1";
        String fragmentId = "frag-1";

        // Create a Sequence diagram entity with null typedContentJson (needs migration)
        DiagramEntity diagram = DiagramEntity.builder()
            .id(diagramId)
            .modelFileId(modelFileId)
            .name("Test Sequence Diagram")
            .diagramType("Sequence")
            .typedContentJson(null)  // Needs migration
            .build();

        // Create matching sequence_diagrams record
        SequenceDiagramEntity sequenceDiagram = SequenceDiagramEntity.builder()
            .id(diagramId)
            .modelFileId(modelFileId)
            .name("Test Sequence Diagram")
            .type("Sequence")
            .createdAt(OffsetDateTime.now())
            .updatedAt(OffsetDateTime.now())
            .build();

        // Create some sequence data
        SequenceParticipantEntity participant = SequenceParticipantEntity.builder()
            .id("part-1")
            .sequenceDiagramId(diagramId)
            .refKind("Application")
            .refId("app-1")
            .orderIndex(0)
            .createdAt(OffsetDateTime.now())
            .updatedAt(OffsetDateTime.now())
            .build();

        SequenceMessageEntity message = SequenceMessageEntity.builder()
            .id("msg-1")
            .sequenceDiagramId(diagramId)
            .exchangeId("ex-1")
            .exchangeRole("Request")
            .fromParticipantId("part-1")
            .toParticipantId("part-2")
            .labelText("Test Message")
            .createdAt(OffsetDateTime.now())
            .updatedAt(OffsetDateTime.now())
            .build();

        // Create a fragment so that operands will be queried
        SequenceFragmentEntity fragment = SequenceFragmentEntity.builder()
            .id(fragmentId)
            .sequenceDiagramId(diagramId)
            .fragmentKind("Loop")
            .labelText("Loop Fragment")
            .createdAt(OffsetDateTime.now())
            .updatedAt(OffsetDateTime.now())
            .build();

        SequenceOperandEntity operand = SequenceOperandEntity.builder()
            .id("op-1")
            .fragmentId(fragmentId)
            .guardExpression("i < 10")
            .operandIndex(0)
            .createdAt(OffsetDateTime.now())
            .updatedAt(OffsetDateTime.now())
            .build();

        // Set up mocks
        when(diagramRepository.findByDiagramTypeAndTypedContentJsonIsNull("Sequence"))
            .thenReturn(List.of(diagram));
        when(sequenceDiagramRepository.findById(diagramId))
            .thenReturn(Optional.of(sequenceDiagram));
        when(sequenceParticipantRepository.findBySequenceDiagramId(diagramId))
            .thenReturn(List.of(participant));
        when(sequenceMessageRepository.findBySequenceDiagramId(diagramId))
            .thenReturn(List.of(message));
        when(sequenceFragmentRepository.findBySequenceDiagramId(diagramId))
            .thenReturn(List.of(fragment));
        when(sequenceOperandRepository.findByFragmentId(fragmentId))
            .thenReturn(List.of(operand));
        when(sequenceNodeRepository.findBySequenceDiagramId(diagramId))
            .thenReturn(Collections.emptyList());
        when(diagramRepository.save(any(DiagramEntity.class)))
            .thenAnswer(inv -> inv.getArgument(0));

        // Run migration
        TypedContentMigrationService.MigrationResult result = migrationService.migrateSequenceDiagrams();

        // Verify diagram was saved with typed content
        ArgumentCaptor<DiagramEntity> captor = ArgumentCaptor.forClass(DiagramEntity.class);
        verify(diagramRepository).save(captor.capture());

        DiagramEntity savedDiagram = captor.getValue();
        assertNotNull(savedDiagram.getTypedContentJson(), "typedContentJson should not be null");

        Map<String, Object> typedContent = savedDiagram.getTypedContentJson();
        assertEquals("Sequence", typedContent.get("type"), "Type should be Sequence");
        assertEquals(1, typedContent.get("version"), "Version should be 1");

        @SuppressWarnings("unchecked")
        Map<String, Object> content = (Map<String, Object>) typedContent.get("content");
        assertNotNull(content, "Content should not be null");

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> participants = (List<Map<String, Object>>) content.get("participants");
        assertEquals(1, participants.size(), "Should have 1 participant");
        assertEquals("part-1", participants.get(0).get("id"), "Participant ID should match");
        assertEquals("Application", participants.get(0).get("refKind"), "Participant refKind should match");

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> messages = (List<Map<String, Object>>) content.get("messages");
        assertEquals(1, messages.size(), "Should have 1 message");
        assertEquals("msg-1", messages.get(0).get("id"), "Message ID should match");

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> fragments = (List<Map<String, Object>>) content.get("fragments");
        assertEquals(1, fragments.size(), "Should have 1 fragment");
        assertEquals(fragmentId, fragments.get(0).get("id"), "Fragment ID should match");

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> operands = (List<Map<String, Object>>) content.get("operands");
        assertEquals(1, operands.size(), "Should have 1 operand");
        assertEquals("op-1", operands.get(0).get("id"), "Operand ID should match");

        // Verify counts
        assertEquals(1, result.migratedCount(), "Should have migrated 1 diagram");
        assertEquals(0, result.defaultedCount(), "Should have defaulted 0 diagrams");
    }

    /**
     * Test 2: Migration creates default empty Sequence typedContent when no sequence_diagrams record exists.
     *
     * When a Sequence diagram exists in the diagrams table but has no matching
     * sequence_diagrams record, the migration should create default empty typedContent.
     */
    @Test
    @DisplayName("Test 2: Migration creates default empty Sequence typedContent when no sequence_diagrams record exists")
    void testMigrationCreatesDefaultWhenNoSequenceDiagramRecord() {
        String diagramId = "seq-diagram-orphan";
        String modelFileId = "mf-1";

        // Create a Sequence diagram entity with null typedContentJson (needs migration)
        DiagramEntity diagram = DiagramEntity.builder()
            .id(diagramId)
            .modelFileId(modelFileId)
            .name("Orphan Sequence Diagram")
            .diagramType("Sequence")
            .typedContentJson(null)  // Needs migration
            .build();

        // Set up mocks - no matching sequence_diagrams record
        when(diagramRepository.findByDiagramTypeAndTypedContentJsonIsNull("Sequence"))
            .thenReturn(List.of(diagram));
        when(sequenceDiagramRepository.findById(diagramId))
            .thenReturn(Optional.empty());  // No matching record
        when(diagramRepository.save(any(DiagramEntity.class)))
            .thenAnswer(inv -> inv.getArgument(0));

        // Run migration
        TypedContentMigrationService.MigrationResult result = migrationService.migrateSequenceDiagrams();

        // Verify diagram was saved with default typed content
        ArgumentCaptor<DiagramEntity> captor = ArgumentCaptor.forClass(DiagramEntity.class);
        verify(diagramRepository).save(captor.capture());

        DiagramEntity savedDiagram = captor.getValue();
        assertNotNull(savedDiagram.getTypedContentJson(), "typedContentJson should not be null");

        Map<String, Object> typedContent = savedDiagram.getTypedContentJson();
        assertEquals("Sequence", typedContent.get("type"), "Type should be Sequence");
        assertEquals(1, typedContent.get("version"), "Version should be 1");

        @SuppressWarnings("unchecked")
        Map<String, Object> content = (Map<String, Object>) typedContent.get("content");
        assertNotNull(content, "Content should not be null");

        // Verify all arrays are empty (default content)
        @SuppressWarnings("unchecked")
        List<?> participants = (List<?>) content.get("participants");
        assertTrue(participants.isEmpty(), "Participants should be empty");

        @SuppressWarnings("unchecked")
        List<?> messages = (List<?>) content.get("messages");
        assertTrue(messages.isEmpty(), "Messages should be empty");

        @SuppressWarnings("unchecked")
        List<?> fragments = (List<?>) content.get("fragments");
        assertTrue(fragments.isEmpty(), "Fragments should be empty");

        @SuppressWarnings("unchecked")
        List<?> operands = (List<?>) content.get("operands");
        assertTrue(operands.isEmpty(), "Operands should be empty");

        @SuppressWarnings("unchecked")
        List<?> sequenceNodes = (List<?>) content.get("sequenceNodes");
        assertTrue(sequenceNodes.isEmpty(), "SequenceNodes should be empty");

        // Verify counts
        assertEquals(0, result.migratedCount(), "Should have migrated 0 diagrams");
        assertEquals(1, result.defaultedCount(), "Should have defaulted 1 diagram");
    }

    /**
     * Test 3: Migration is idempotent (skips diagrams with non-null typed_content_json).
     *
     * When a Sequence diagram already has typed_content_json populated,
     * the migration should skip it (not returned by the query).
     */
    @Test
    @DisplayName("Test 3: Migration is idempotent (skips diagrams with non-null typed_content_json)")
    void testMigrationIsIdempotent() {
        // Set up mocks - no diagrams need migration (all have typed_content_json populated)
        when(diagramRepository.findByDiagramTypeAndTypedContentJsonIsNull("Sequence"))
            .thenReturn(Collections.emptyList());

        // Run migration
        TypedContentMigrationService.MigrationResult result = migrationService.migrateSequenceDiagrams();

        // Verify no saves occurred
        verify(diagramRepository, never()).save(any(DiagramEntity.class));

        // Verify counts
        assertEquals(0, result.migratedCount(), "Should have migrated 0 diagrams");
        assertEquals(0, result.defaultedCount(), "Should have defaulted 0 diagrams");
    }

    /**
     * Test 4: Migration logs counts correctly (migrated N, defaulted M).
     *
     * When running migration on a mix of diagrams (some with data, some without),
     * the counts should reflect the correct numbers.
     */
    @Test
    @DisplayName("Test 4: Migration logs counts correctly (migrated N, defaulted M)")
    void testMigrationLogsCountsCorrectly() {
        String diagramId1 = "seq-diagram-with-data";
        String diagramId2 = "seq-diagram-no-data";
        String diagramId3 = "seq-diagram-orphan";
        String modelFileId = "mf-1";

        // Create diagrams needing migration
        DiagramEntity diagram1 = DiagramEntity.builder()
            .id(diagramId1)
            .modelFileId(modelFileId)
            .name("Diagram With Data")
            .diagramType("Sequence")
            .typedContentJson(null)
            .build();

        DiagramEntity diagram2 = DiagramEntity.builder()
            .id(diagramId2)
            .modelFileId(modelFileId)
            .name("Diagram No Data")
            .diagramType("Sequence")
            .typedContentJson(null)
            .build();

        DiagramEntity diagram3 = DiagramEntity.builder()
            .id(diagramId3)
            .modelFileId(modelFileId)
            .name("Orphan Diagram")
            .diagramType("Sequence")
            .typedContentJson(null)
            .build();

        // Create sequence_diagrams records (diagram1 and diagram2 have records, diagram3 doesn't)
        SequenceDiagramEntity seqDiagram1 = SequenceDiagramEntity.builder()
            .id(diagramId1)
            .modelFileId(modelFileId)
            .name("Diagram With Data")
            .build();

        SequenceDiagramEntity seqDiagram2 = SequenceDiagramEntity.builder()
            .id(diagramId2)
            .modelFileId(modelFileId)
            .name("Diagram No Data")
            .build();

        // Create some sequence data for diagram1 only
        SequenceParticipantEntity participant = SequenceParticipantEntity.builder()
            .id("part-1")
            .sequenceDiagramId(diagramId1)
            .refKind("Application")
            .refId("app-1")
            .orderIndex(0)
            .createdAt(OffsetDateTime.now())
            .updatedAt(OffsetDateTime.now())
            .build();

        // Set up mocks
        when(diagramRepository.findByDiagramTypeAndTypedContentJsonIsNull("Sequence"))
            .thenReturn(List.of(diagram1, diagram2, diagram3));

        when(sequenceDiagramRepository.findById(diagramId1))
            .thenReturn(Optional.of(seqDiagram1));
        when(sequenceDiagramRepository.findById(diagramId2))
            .thenReturn(Optional.of(seqDiagram2));
        when(sequenceDiagramRepository.findById(diagramId3))
            .thenReturn(Optional.empty());  // No matching record

        // Diagram1 has data
        when(sequenceParticipantRepository.findBySequenceDiagramId(diagramId1))
            .thenReturn(List.of(participant));
        when(sequenceMessageRepository.findBySequenceDiagramId(diagramId1))
            .thenReturn(Collections.emptyList());
        when(sequenceFragmentRepository.findBySequenceDiagramId(diagramId1))
            .thenReturn(Collections.emptyList());
        when(sequenceNodeRepository.findBySequenceDiagramId(diagramId1))
            .thenReturn(Collections.emptyList());

        // Diagram2 has no data (empty arrays)
        when(sequenceParticipantRepository.findBySequenceDiagramId(diagramId2))
            .thenReturn(Collections.emptyList());
        when(sequenceMessageRepository.findBySequenceDiagramId(diagramId2))
            .thenReturn(Collections.emptyList());
        when(sequenceFragmentRepository.findBySequenceDiagramId(diagramId2))
            .thenReturn(Collections.emptyList());
        when(sequenceNodeRepository.findBySequenceDiagramId(diagramId2))
            .thenReturn(Collections.emptyList());

        when(diagramRepository.save(any(DiagramEntity.class)))
            .thenAnswer(inv -> inv.getArgument(0));

        // Run migration
        TypedContentMigrationService.MigrationResult result = migrationService.migrateSequenceDiagrams();

        // Verify 3 diagrams were saved
        verify(diagramRepository, times(3)).save(any(DiagramEntity.class));

        // Verify counts:
        // - diagram1 had sequence_diagrams record with data -> migrated (1)
        // - diagram2 had sequence_diagrams record but empty data -> still counts as migrated (2)
        // - diagram3 had no sequence_diagrams record -> defaulted (1)
        assertEquals(2, result.migratedCount(), "Should have migrated 2 diagrams (with sequence_diagrams records)");
        assertEquals(1, result.defaultedCount(), "Should have defaulted 1 diagram (no sequence_diagrams record)");
    }
}
