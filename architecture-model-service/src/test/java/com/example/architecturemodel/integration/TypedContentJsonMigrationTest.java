package com.example.architecturemodel.integration;

import com.example.architecturemodel.model.entity.DiagramEntity;
import com.example.architecturemodel.model.entity.ModelFileEntity;
import com.example.architecturemodel.repository.ModelFileRepository;
import com.example.architecturemodel.repository.diagram.DiagramRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.annotation.Transactional;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import java.time.OffsetDateTime;
import java.util.*;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Integration tests for Task Group 1: Schema Migration - Add typed_content_json Column.
 *
 * These tests verify that the typed_content_json JSONB column works correctly:
 * 1. Column exists and can be accessed via the entity
 * 2. JSONB data can be inserted and retrieved correctly
 * 3. NULL values are allowed for General diagrams
 *
 * Note: These tests use H2 with Hibernate's create-drop mode, which generates
 * the schema from entity annotations. The actual Liquibase migration is tested
 * against PostgreSQL in production/staging environments.
 */
@SpringBootTest
@Transactional
class TypedContentJsonMigrationTest {

    @Autowired
    private DiagramRepository diagramRepository;

    @Autowired
    private ModelFileRepository modelFileRepository;

    @PersistenceContext
    private EntityManager entityManager;

    private static final String TEST_MODEL_FILE_ID = "mf-migration-test-1";
    private static final String TEST_FILENAME = "migration-test-model";

    @BeforeEach
    void setUp() {
        // Ensure test model file exists
        if (!modelFileRepository.existsById(TEST_MODEL_FILE_ID)) {
            createTestModelFile();
        }
    }

    private void createTestModelFile() {
        ModelFileEntity modelFile = ModelFileEntity.builder()
                .id(TEST_MODEL_FILE_ID)
                .filename(TEST_FILENAME)
                .description("Test model for typed_content_json migration tests")
                .createdAt(OffsetDateTime.now())
                .updatedAt(OffsetDateTime.now())
                .isDefault(false)
                .build();
        modelFileRepository.save(modelFile);
    }

    /**
     * Test 1: Verify typed_content_json column exists after migration.
     *
     * This test verifies that a DiagramEntity can be saved and retrieved
     * with the typedContentJson field, proving the column exists in the schema.
     */
    @Test
    @DisplayName("Test 1: Verify column exists - can save and retrieve diagram with typedContentJson field")
    void testColumnExists_canSaveAndRetrieveDiagramWithTypedContentJson() {
        // Arrange - Create a diagram with typed content
        String diagramId = "diagram-test-" + UUID.randomUUID().toString();

        Map<String, Object> typedContent = new HashMap<>();
        typedContent.put("type", "Sequence");
        typedContent.put("version", 1);

        Map<String, Object> content = new HashMap<>();
        content.put("participants", new ArrayList<>());
        content.put("messages", new ArrayList<>());
        typedContent.put("content", content);

        DiagramEntity diagram = DiagramEntity.builder()
                .id(diagramId)
                .modelFileId(TEST_MODEL_FILE_ID)
                .name("Test Sequence Diagram")
                .description("Testing typed_content_json column")
                .diagramType("Sequence")
                .typedContentJson(typedContent)
                .build();

        // Act - Save and retrieve
        diagramRepository.save(diagram);
        entityManager.flush();
        entityManager.clear(); // Clear cache to force database read

        Optional<DiagramEntity> retrieved = diagramRepository.findById(diagramId);

        // Assert - Column exists and is accessible
        assertTrue(retrieved.isPresent(), "Diagram should be retrievable");
        assertNotNull(retrieved.get().getTypedContentJson(),
                "typedContentJson field should be accessible, proving column exists");
    }

    /**
     * Test 2: Verify JSONB data can be inserted and retrieved correctly.
     *
     * This test verifies that complex JSON structures matching the typed content
     * envelope schema can be stored and retrieved with data integrity.
     */
    @Test
    @DisplayName("Test 2: Verify JSONB data can be inserted and retrieved with correct structure")
    void testJsonbDataInsertAndRetrieve_preservesComplexStructure() {
        // Arrange - Create a Sequence diagram with full typed content envelope
        String diagramId = "diagram-test-" + UUID.randomUUID().toString();

        Map<String, Object> typedContent = new HashMap<>();
        typedContent.put("type", "Sequence");
        typedContent.put("version", 1);

        Map<String, Object> content = new HashMap<>();

        // Add participants array with nested object
        List<Map<String, Object>> participants = new ArrayList<>();
        Map<String, Object> participant = new HashMap<>();
        participant.put("id", "participant-1");
        participant.put("name", "User");
        participant.put("refKind", "Class");
        participant.put("refId", "class-1");
        participant.put("orderIndex", 0);
        participants.add(participant);
        content.put("participants", participants);

        // Add messages array with nested object
        List<Map<String, Object>> messages = new ArrayList<>();
        Map<String, Object> message = new HashMap<>();
        message.put("id", "message-1");
        message.put("name", "login()");
        message.put("sourceParticipantId", "participant-1");
        message.put("targetParticipantId", "participant-2");
        message.put("orderIndex", 0);
        messages.add(message);
        content.put("messages", messages);

        // Add empty arrays for other sequence elements
        content.put("fragments", new ArrayList<>());
        content.put("operands", new ArrayList<>());
        content.put("sequenceNodes", new ArrayList<>());

        typedContent.put("content", content);

        DiagramEntity diagram = DiagramEntity.builder()
                .id(diagramId)
                .modelFileId(TEST_MODEL_FILE_ID)
                .name("Full Sequence Diagram")
                .description("Testing full JSONB structure")
                .diagramType("Sequence")
                .typedContentJson(typedContent)
                .build();

        // Act - Save and retrieve
        diagramRepository.save(diagram);
        entityManager.flush();
        entityManager.clear(); // Clear cache to force database read

        Optional<DiagramEntity> retrieved = diagramRepository.findById(diagramId);

        // Assert - All data preserved correctly
        assertTrue(retrieved.isPresent(), "Diagram should be retrievable");

        Map<String, Object> retrievedContent = retrieved.get().getTypedContentJson();
        assertNotNull(retrievedContent, "typedContentJson should not be null");

        // Verify envelope structure
        assertEquals("Sequence", retrievedContent.get("type"));
        assertEquals(1, retrievedContent.get("version"));

        // Verify content structure
        @SuppressWarnings("unchecked")
        Map<String, Object> innerContent = (Map<String, Object>) retrievedContent.get("content");
        assertNotNull(innerContent, "content object should exist");

        // Verify participants array
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> retrievedParticipants = (List<Map<String, Object>>) innerContent.get("participants");
        assertNotNull(retrievedParticipants, "participants array should exist");
        assertEquals(1, retrievedParticipants.size(), "should have 1 participant");
        assertEquals("User", retrievedParticipants.get(0).get("name"));

        // Verify messages array
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> retrievedMessages = (List<Map<String, Object>>) innerContent.get("messages");
        assertNotNull(retrievedMessages, "messages array should exist");
        assertEquals(1, retrievedMessages.size(), "should have 1 message");
        assertEquals("login()", retrievedMessages.get(0).get("name"));

        // Verify empty arrays are preserved
        @SuppressWarnings("unchecked")
        List<?> fragments = (List<?>) innerContent.get("fragments");
        assertNotNull(fragments, "fragments array should exist");
        assertEquals(0, fragments.size(), "fragments should be empty");
    }

    /**
     * Test 3: Verify NULL is allowed for General diagrams.
     *
     * General diagrams have no type-specific content, so typed_content_json
     * should be NULL. This test verifies the column is nullable.
     */
    @Test
    @DisplayName("Test 3: Verify NULL is allowed for General diagrams")
    void testNullAllowed_forGeneralDiagrams() {
        // Arrange - Create a General diagram with no typed content
        String generalDiagramId = "diagram-general-" + UUID.randomUUID().toString();

        DiagramEntity generalDiagram = DiagramEntity.builder()
                .id(generalDiagramId)
                .modelFileId(TEST_MODEL_FILE_ID)
                .name("General Diagram")
                .description("A general diagram with no typed content")
                .diagramType("General")
                .typedContentJson(null) // Explicitly null for General diagrams
                .build();

        // Act - Save and retrieve
        diagramRepository.save(generalDiagram);
        entityManager.flush();
        entityManager.clear(); // Clear cache to force database read

        Optional<DiagramEntity> retrieved = diagramRepository.findById(generalDiagramId);

        // Assert - NULL is allowed and preserved
        assertTrue(retrieved.isPresent(), "Diagram should be retrievable");
        assertNull(retrieved.get().getTypedContentJson(),
                "typedContentJson should be NULL for General diagrams");
        assertEquals("General", retrieved.get().getDiagramType());

        // Also verify we can save another diagram with typed content after saving one with null
        // This ensures the null handling doesn't corrupt the column
        String erDiagramId = "diagram-er-" + UUID.randomUUID().toString();

        Map<String, Object> typedContent = new HashMap<>();
        typedContent.put("type", "ER");
        typedContent.put("version", 1);

        Map<String, Object> content = new HashMap<>();
        content.put("entityRefs", new ArrayList<>());
        content.put("relationshipRefs", new ArrayList<>());
        typedContent.put("content", content);

        DiagramEntity erDiagram = DiagramEntity.builder()
                .id(erDiagramId)
                .modelFileId(TEST_MODEL_FILE_ID)
                .name("ER Diagram")
                .description("An ER diagram with typed content")
                .diagramType("ER")
                .typedContentJson(typedContent)
                .build();

        diagramRepository.save(erDiagram);
        entityManager.flush();
        entityManager.clear();

        Optional<DiagramEntity> retrievedEr = diagramRepository.findById(erDiagramId);

        assertTrue(retrievedEr.isPresent());
        assertNotNull(retrievedEr.get().getTypedContentJson(),
                "typedContentJson should not be NULL for ER diagrams");
        assertEquals("ER", retrievedEr.get().getTypedContentJson().get("type"));
    }
}
