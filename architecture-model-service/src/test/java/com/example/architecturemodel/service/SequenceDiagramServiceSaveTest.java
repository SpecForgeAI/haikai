package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.entity.*;
import com.example.architecturemodel.model.entity.*;
import com.example.architecturemodel.repository.diagram.DiagramRepository;
import com.example.architecturemodel.repository.entity.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.*;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/**
 * Tests for SequenceDiagramService save functionality.
 * Focused tests for PUT /api/sequence-diagrams/{id}/content endpoint.
 *
 * UPDATED FOR TYPED CONTENT MIGRATION:
 * These tests now verify that the service writes to diagrams.typed_content_json
 * instead of the sequence_* tables.
 */
@ExtendWith(MockitoExtension.class)
class SequenceDiagramServiceSaveTest {

    @Mock private DiagramRepository diagramRepository;
    @Mock private SequenceDiagramRepository sequenceDiagramRepository;
    @Mock private SequenceParticipantRepository sequenceParticipantRepository;
    @Mock private SequenceMessageRepository sequenceMessageRepository;
    @Mock private SequenceFragmentRepository sequenceFragmentRepository;
    @Mock private SequenceOperandRepository sequenceOperandRepository;
    @Mock private SequenceNodeRepository sequenceNodeRepository;

    private SequenceDiagramService sequenceDiagramService;

    @BeforeEach
    void setUp() {
        sequenceDiagramService = new SequenceDiagramService(
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
     * Test 1: PUT /api/sequence-diagrams/{id}/content with valid full payload
     * Verifies that a complete sequence diagram with all children is saved to typed_content_json.
     */
    @Test
    void saveSequenceDiagramContent_validFullPayload_savesToTypedContentJson() {
        // Arrange
        String diagramId = "sd-1";
        DiagramEntity existingDiagram = createDiagramEntity(diagramId, "Test Diagram", "Sequence");
        when(diagramRepository.findById(diagramId)).thenReturn(Optional.of(existingDiagram));
        when(diagramRepository.save(any(DiagramEntity.class))).thenAnswer(inv -> inv.getArgument(0));

        // Create full DTO payload
        SequenceDiagramDto inputDto = new SequenceDiagramDto(
            diagramId,
            "mf-1",
            "Test Diagram",
            "Sequence",
            List.of(new SequenceParticipantDto("p-1", "Application", "app-1", 0)),
            List.of(new SequenceMessageDto("m-1", "ex-1", "Request", "p-1", "p-2", "Method", "method-1", null, null, null, null, null, null)),
            Collections.emptyList(),
            Collections.emptyList(),
            List.of(new SequenceNodeDto("n-1", "Message", "m-1", null, 0, null, null))
        );

        // Act
        SequenceDiagramDto result = sequenceDiagramService.saveSequenceDiagramContent(diagramId, inputDto);

        // Assert
        assertNotNull(result);
        assertEquals(diagramId, result.id());

        // Verify diagram was saved with typed_content_json
        ArgumentCaptor<DiagramEntity> captor = ArgumentCaptor.forClass(DiagramEntity.class);
        verify(diagramRepository).save(captor.capture());

        DiagramEntity savedDiagram = captor.getValue();
        assertNotNull(savedDiagram.getTypedContentJson());
        assertEquals("Sequence", savedDiagram.getTypedContentJson().get("type"));
        assertEquals(1, savedDiagram.getTypedContentJson().get("version"));

        @SuppressWarnings("unchecked")
        Map<String, Object> content = (Map<String, Object>) savedDiagram.getTypedContentJson().get("content");
        assertNotNull(content);

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> participants = (List<Map<String, Object>>) content.get("participants");
        assertEquals(1, participants.size());
        assertEquals("p-1", participants.get(0).get("id"));

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> messages = (List<Map<String, Object>>) content.get("messages");
        assertEquals(1, messages.size());
        assertEquals("m-1", messages.get(0).get("id"));
    }

    /**
     * Test 2: Validation rejection for invalid participant ref_kind
     * Verifies that an invalid ref_kind for a participant throws IllegalArgumentException.
     */
    @Test
    void saveSequenceDiagramContent_invalidParticipantRefKind_throwsException() {
        // Arrange
        String diagramId = "sd-1";
        DiagramEntity existingDiagram = createDiagramEntity(diagramId, "Test Diagram", "Sequence");
        when(diagramRepository.findById(diagramId)).thenReturn(Optional.of(existingDiagram));

        // Create DTO with invalid participant ref_kind
        SequenceDiagramDto inputDto = new SequenceDiagramDto(
            diagramId,
            "mf-1",
            "Test Diagram",
            "Sequence",
            List.of(new SequenceParticipantDto("p-1", "InvalidRefKind", "app-1", 0)),
            Collections.emptyList(),
            Collections.emptyList(),
            Collections.emptyList(),
            Collections.emptyList()
        );

        // Act & Assert
        IllegalArgumentException exception = assertThrows(
            IllegalArgumentException.class,
            () -> sequenceDiagramService.saveSequenceDiagramContent(diagramId, inputDto)
        );

        assertTrue(exception.getMessage().contains("Invalid participant ref_kind"));
        assertTrue(exception.getMessage().contains("InvalidRefKind"));
    }

    /**
     * Test 3: Validation rejection for message content one-of constraint violation
     * Verifies that a message with both ref_kind/ref_id AND label_text throws exception.
     */
    @Test
    void saveSequenceDiagramContent_messageContentOneOfViolation_throwsException() {
        // Arrange
        String diagramId = "sd-1";
        DiagramEntity existingDiagram = createDiagramEntity(diagramId, "Test Diagram", "Sequence");
        when(diagramRepository.findById(diagramId)).thenReturn(Optional.of(existingDiagram));

        // Create DTO with message that has both ref_kind/ref_id AND label_text
        SequenceDiagramDto inputDto = new SequenceDiagramDto(
            diagramId,
            "mf-1",
            "Test Diagram",
            "Sequence",
            List.of(new SequenceParticipantDto("p-1", "Application", "app-1", 0)),
            List.of(new SequenceMessageDto("m-1", "ex-1", "Request", "p-1", "p-2", "Method", "method-1", "Also has text", null, null, null, null, null)),
            Collections.emptyList(),
            Collections.emptyList(),
            Collections.emptyList()
        );

        // Act & Assert
        IllegalArgumentException exception = assertThrows(
            IllegalArgumentException.class,
            () -> sequenceDiagramService.saveSequenceDiagramContent(diagramId, inputDto)
        );

        assertTrue(exception.getMessage().contains("cannot have both"));
    }

    /**
     * Test 4: Save overwrites existing typed_content_json
     * Verifies that saving new content replaces existing content in typed_content_json.
     */
    @Test
    void saveSequenceDiagramContent_overwritesExistingTypedContent() {
        // Arrange
        String diagramId = "sd-1";

        // Create existing typed content
        Map<String, Object> existingContent = new LinkedHashMap<>();
        existingContent.put("participants", new ArrayList<>());
        existingContent.put("messages", new ArrayList<>());
        existingContent.put("fragments", new ArrayList<>());
        existingContent.put("operands", new ArrayList<>());
        existingContent.put("sequenceNodes", new ArrayList<>());

        Map<String, Object> existingTypedContent = new LinkedHashMap<>();
        existingTypedContent.put("type", "Sequence");
        existingTypedContent.put("version", 1);
        existingTypedContent.put("content", existingContent);

        DiagramEntity existingDiagram = createDiagramEntity(diagramId, "Test Diagram", "Sequence");
        existingDiagram.setTypedContentJson(existingTypedContent);

        when(diagramRepository.findById(diagramId)).thenReturn(Optional.of(existingDiagram));
        when(diagramRepository.save(any(DiagramEntity.class))).thenAnswer(inv -> inv.getArgument(0));

        // Create DTO with new fragment
        SequenceDiagramDto inputDto = new SequenceDiagramDto(
            diagramId,
            "mf-1",
            "Test Diagram",
            "Sequence",
            Collections.emptyList(),
            Collections.emptyList(),
            List.of(new SequenceFragmentDto("f-new", "Alternative", "New Fragment")),
            List.of(new SequenceOperandDto("op-1", "f-new", "condition1", 0),
                    new SequenceOperandDto("op-2", "f-new", "condition2", 1)),
            Collections.emptyList()
        );

        // Act
        SequenceDiagramDto result = sequenceDiagramService.saveSequenceDiagramContent(diagramId, inputDto);

        // Assert - verify new content was saved
        ArgumentCaptor<DiagramEntity> captor = ArgumentCaptor.forClass(DiagramEntity.class);
        verify(diagramRepository).save(captor.capture());

        DiagramEntity savedDiagram = captor.getValue();
        @SuppressWarnings("unchecked")
        Map<String, Object> content = (Map<String, Object>) savedDiagram.getTypedContentJson().get("content");

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> fragments = (List<Map<String, Object>>) content.get("fragments");
        assertEquals(1, fragments.size());
        assertEquals("f-new", fragments.get(0).get("id"));

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> operands = (List<Map<String, Object>>) content.get("operands");
        assertEquals(2, operands.size());
    }

    /**
     * Test 5: 404 response for non-existent diagram ID
     * Verifies that saving to a non-existent diagram throws ResourceNotFoundException.
     */
    @Test
    void saveSequenceDiagramContent_nonExistentDiagram_throws404() {
        // Arrange
        String diagramId = "non-existent";
        when(diagramRepository.findById(diagramId)).thenReturn(Optional.empty());

        SequenceDiagramDto inputDto = new SequenceDiagramDto(
            diagramId,
            "mf-1",
            "Test Diagram",
            "Sequence",
            Collections.emptyList(),
            Collections.emptyList(),
            Collections.emptyList(),
            Collections.emptyList(),
            Collections.emptyList()
        );

        // Act & Assert
        ResourceNotFoundException exception = assertThrows(
            ResourceNotFoundException.class,
            () -> sequenceDiagramService.saveSequenceDiagramContent(diagramId, inputDto)
        );

        assertTrue(exception.getMessage().contains(diagramId));
    }

    /**
     * Test 6: Validation rejection for invalid node_kind constraint
     * Verifies that a node with invalid message_id/fragment_id combination throws exception.
     */
    @Test
    void saveSequenceDiagramContent_invalidNodeKindConstraint_throwsException() {
        // Arrange
        String diagramId = "sd-1";
        DiagramEntity existingDiagram = createDiagramEntity(diagramId, "Test Diagram", "Sequence");
        when(diagramRepository.findById(diagramId)).thenReturn(Optional.of(existingDiagram));

        // Create DTO with a Message node that has no message_id (invalid)
        SequenceDiagramDto inputDto = new SequenceDiagramDto(
            diagramId,
            "mf-1",
            "Test Diagram",
            "Sequence",
            Collections.emptyList(),
            Collections.emptyList(),
            Collections.emptyList(),
            Collections.emptyList(),
            List.of(new SequenceNodeDto("n-1", "Message", null, null, 0, null, null)) // Invalid: Message node without message_id
        );

        // Act & Assert
        IllegalArgumentException exception = assertThrows(
            IllegalArgumentException.class,
            () -> sequenceDiagramService.saveSequenceDiagramContent(diagramId, inputDto)
        );

        assertTrue(exception.getMessage().contains("message_id is required"));
    }

    /**
     * Test 7: Non-Sequence diagram returns error
     * Verifies that trying to save to a non-Sequence diagram throws IllegalArgumentException.
     */
    @Test
    void saveSequenceDiagramContent_nonSequenceDiagram_throwsException() {
        // Arrange
        String diagramId = "er-diagram-1";
        DiagramEntity existingDiagram = createDiagramEntity(diagramId, "ER Diagram", "ER");
        when(diagramRepository.findById(diagramId)).thenReturn(Optional.of(existingDiagram));

        SequenceDiagramDto inputDto = new SequenceDiagramDto(
            diagramId,
            "mf-1",
            "Test Diagram",
            "Sequence",
            Collections.emptyList(),
            Collections.emptyList(),
            Collections.emptyList(),
            Collections.emptyList(),
            Collections.emptyList()
        );

        // Act & Assert
        IllegalArgumentException exception = assertThrows(
            IllegalArgumentException.class,
            () -> sequenceDiagramService.saveSequenceDiagramContent(diagramId, inputDto)
        );

        assertTrue(exception.getMessage().contains("not a Sequence diagram"));
    }

    // ============================================================================
    // Helper methods
    // ============================================================================

    private DiagramEntity createDiagramEntity(String id, String name, String diagramType) {
        return DiagramEntity.builder()
            .id(id)
            .modelFileId("mf-1")
            .name(name)
            .diagramType(diagramType)
            .build();
    }
}
