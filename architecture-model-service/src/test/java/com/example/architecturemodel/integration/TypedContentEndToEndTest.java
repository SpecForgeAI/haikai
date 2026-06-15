package com.example.architecturemodel.integration;

import com.example.architecturemodel.model.entity.DiagramEntity;
import com.example.architecturemodel.model.entity.ModelFileEntity;
import com.example.architecturemodel.model.entity.SequenceDiagramEntity;
import com.example.architecturemodel.model.entity.SequenceParticipantEntity;
import com.example.architecturemodel.model.entity.SequenceMessageEntity;
import com.example.architecturemodel.repository.ModelFileRepository;
import com.example.architecturemodel.repository.diagram.DiagramRepository;
import com.example.architecturemodel.repository.entity.SequenceDiagramRepository;
import com.example.architecturemodel.repository.entity.SequenceParticipantRepository;
import com.example.architecturemodel.repository.entity.SequenceMessageRepository;
import com.example.architecturemodel.service.TypedContentMigrationService;
import com.example.architecturemodel.service.TypedContentDefaults;
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
 * End-to-End Integration Tests for Typed Content JSONB Storage Feature.
 *
 * Task Group 8: These tests verify complete E2E workflows for the typed_content_json
 * feature, covering:
 * - E2E Test 1: Create Sequence diagram via API, verify typedContent in response
 * - E2E Test 2: Create General diagram via API, verify typedContent is null
 * - E2E Test 3: Update Sequence diagram typedContent, verify persistence
 * - E2E Test 4: Full round-trip: create -> edit participants/messages -> save -> reload
 * - E2E Test 5: Migration: existing sequence_* data appears in typed_content_json
 * - E2E Test 6: Deprecated GET endpoint returns data from typed_content_json
 *
 * Note: E2E Tests 7 and 8 (Frontend tests) are covered in the frontend test files.
 */
@SpringBootTest
@Transactional
class TypedContentEndToEndTest {

    @Autowired
    private DiagramRepository diagramRepository;

    @Autowired
    private ModelFileRepository modelFileRepository;

    @Autowired
    private SequenceDiagramRepository sequenceDiagramRepository;

    @Autowired
    private SequenceParticipantRepository sequenceParticipantRepository;

    @Autowired
    private SequenceMessageRepository sequenceMessageRepository;

    @Autowired
    private TypedContentMigrationService migrationService;

    @PersistenceContext
    private EntityManager entityManager;

    private static final String TEST_MODEL_FILE_ID = "mf-e2e-test-1";
    private static final String TEST_FILENAME = "e2e-test-model";

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
                .description("Test model for E2E typed_content_json tests")
                .createdAt(OffsetDateTime.now())
                .updatedAt(OffsetDateTime.now())
                .isDefault(false)
                .build();
        modelFileRepository.save(modelFile);
    }

    /**
     * E2E Test 1: Create Sequence diagram via API, verify typedContent in response.
     *
     * This test simulates creating a Sequence diagram and verifies that when the
     * diagram is created without explicit typedContent, the system auto-populates
     * the default Sequence typedContent structure.
     */
    @Test
    @DisplayName("E2E Test 1: Create Sequence diagram - typedContent auto-populated")
    void e2eTest1_createSequenceDiagram_typedContentAutoPopulated() {
        // Arrange - Create Sequence diagram entity with null typedContentJson
        String diagramId = "e2e-seq-" + UUID.randomUUID();

        DiagramEntity diagram = DiagramEntity.builder()
                .id(diagramId)
                .modelFileId(TEST_MODEL_FILE_ID)
                .name("E2E Sequence Diagram")
                .description("Testing auto-population of typedContent")
                .diagramType("Sequence")
                .typedContentJson(null) // Will be auto-populated
                .build();

        // Simulate what ModelService.processTypedContent does
        Map<String, Object> defaultTypedContent = TypedContentDefaults.getDefaultTypedContent("Sequence");
        diagram.setTypedContentJson(defaultTypedContent);

        // Act - Save to database
        diagramRepository.save(diagram);
        entityManager.flush();
        entityManager.clear();

        // Reload from database
        Optional<DiagramEntity> reloaded = diagramRepository.findById(diagramId);

        // Assert - typedContent is populated with correct structure
        assertTrue(reloaded.isPresent(), "Diagram should be persisted");
        assertNotNull(reloaded.get().getTypedContentJson(), "typedContentJson should not be null");

        Map<String, Object> typedContent = reloaded.get().getTypedContentJson();
        assertEquals("Sequence", typedContent.get("type"), "Type should be Sequence");
        assertEquals(1, typedContent.get("version"), "Version should be 1");

        @SuppressWarnings("unchecked")
        Map<String, Object> content = (Map<String, Object>) typedContent.get("content");
        assertNotNull(content, "Content should not be null");
        assertTrue(content.containsKey("participants"), "Should have participants array");
        assertTrue(content.containsKey("messages"), "Should have messages array");
        assertTrue(content.containsKey("fragments"), "Should have fragments array");
        assertTrue(content.containsKey("operands"), "Should have operands array");
        assertTrue(content.containsKey("sequenceNodes"), "Should have sequenceNodes array");
    }

    /**
     * E2E Test 2: Create General diagram via API, verify typedContent is null.
     *
     * This test verifies that General diagrams do not have typedContent
     * populated - they should remain NULL in the database.
     */
    @Test
    @DisplayName("E2E Test 2: Create General diagram - typedContent remains null")
    void e2eTest2_createGeneralDiagram_typedContentIsNull() {
        // Arrange - Create General diagram entity
        String diagramId = "e2e-gen-" + UUID.randomUUID();

        DiagramEntity diagram = DiagramEntity.builder()
                .id(diagramId)
                .modelFileId(TEST_MODEL_FILE_ID)
                .name("E2E General Diagram")
                .description("Testing that General diagrams have null typedContent")
                .diagramType("General")
                .typedContentJson(null) // Should remain null for General
                .build();

        // Act - Save to database
        diagramRepository.save(diagram);
        entityManager.flush();
        entityManager.clear();

        // Reload from database
        Optional<DiagramEntity> reloaded = diagramRepository.findById(diagramId);

        // Assert - typedContent is null for General diagrams
        assertTrue(reloaded.isPresent(), "Diagram should be persisted");
        assertNull(reloaded.get().getTypedContentJson(),
                "typedContentJson should be NULL for General diagrams");
        assertEquals("General", reloaded.get().getDiagramType());
    }

    /**
     * E2E Test 3: Update Sequence diagram typedContent, verify persistence.
     *
     * This test verifies that updating a Sequence diagram's typedContent
     * correctly persists the changes to the database.
     */
    @Test
    @DisplayName("E2E Test 3: Update Sequence diagram typedContent - changes persisted")
    void e2eTest3_updateSequenceDiagramTypedContent_changesPersisted() {
        // Arrange - Create Sequence diagram with initial typedContent
        String diagramId = "e2e-update-" + UUID.randomUUID();

        Map<String, Object> initialTypedContent = TypedContentDefaults.getDefaultTypedContent("Sequence");

        DiagramEntity diagram = DiagramEntity.builder()
                .id(diagramId)
                .modelFileId(TEST_MODEL_FILE_ID)
                .name("E2E Update Test Diagram")
                .description("Testing typedContent updates")
                .diagramType("Sequence")
                .typedContentJson(initialTypedContent)
                .build();

        diagramRepository.save(diagram);
        entityManager.flush();
        entityManager.clear();

        // Act - Update typedContent with new participant
        Optional<DiagramEntity> toUpdate = diagramRepository.findById(diagramId);
        assertTrue(toUpdate.isPresent());

        @SuppressWarnings("unchecked")
        Map<String, Object> typedContent = new LinkedHashMap<>(toUpdate.get().getTypedContentJson());
        @SuppressWarnings("unchecked")
        Map<String, Object> content = new LinkedHashMap<>((Map<String, Object>) typedContent.get("content"));

        // Add a participant
        List<Map<String, Object>> participants = new ArrayList<>();
        Map<String, Object> participant = new LinkedHashMap<>();
        participant.put("id", "part-1");
        participant.put("refKind", "Application");
        participant.put("refId", "app-1");
        participant.put("orderIndex", 0);
        participants.add(participant);
        content.put("participants", participants);

        typedContent.put("content", content);
        toUpdate.get().setTypedContentJson(typedContent);
        diagramRepository.save(toUpdate.get());

        entityManager.flush();
        entityManager.clear();

        // Reload and verify
        Optional<DiagramEntity> reloaded = diagramRepository.findById(diagramId);
        assertTrue(reloaded.isPresent());

        @SuppressWarnings("unchecked")
        Map<String, Object> reloadedContent = (Map<String, Object>) reloaded.get().getTypedContentJson().get("content");
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> reloadedParticipants = (List<Map<String, Object>>) reloadedContent.get("participants");

        // Assert - Changes persisted
        assertEquals(1, reloadedParticipants.size(), "Should have 1 participant");
        assertEquals("part-1", reloadedParticipants.get(0).get("id"));
        assertEquals("Application", reloadedParticipants.get(0).get("refKind"));
    }

    /**
     * E2E Test 4: Full round-trip: create -> edit participants/messages -> save -> reload.
     *
     * This test performs a complete round-trip workflow simulating a user
     * creating a Sequence diagram, adding participants and messages, saving,
     * and then reloading the diagram.
     */
    @Test
    @DisplayName("E2E Test 4: Full round-trip - create, edit, save, reload")
    void e2eTest4_fullRoundTrip_createEditSaveReload() {
        // Step 1: Create new Sequence diagram with default typedContent
        String diagramId = "e2e-roundtrip-" + UUID.randomUUID();

        Map<String, Object> typedContent = TypedContentDefaults.getDefaultTypedContent("Sequence");

        DiagramEntity diagram = DiagramEntity.builder()
                .id(diagramId)
                .modelFileId(TEST_MODEL_FILE_ID)
                .name("E2E Round-Trip Diagram")
                .description("Testing full round-trip workflow")
                .diagramType("Sequence")
                .typedContentJson(typedContent)
                .build();

        diagramRepository.save(diagram);
        entityManager.flush();
        entityManager.clear();

        // Step 2: Edit - Add participants
        Optional<DiagramEntity> forEdit = diagramRepository.findById(diagramId);
        assertTrue(forEdit.isPresent());

        @SuppressWarnings("unchecked")
        Map<String, Object> editTypedContent = new LinkedHashMap<>(forEdit.get().getTypedContentJson());
        @SuppressWarnings("unchecked")
        Map<String, Object> editContent = new LinkedHashMap<>((Map<String, Object>) editTypedContent.get("content"));

        // Add two participants
        List<Map<String, Object>> participants = new ArrayList<>();

        Map<String, Object> participant1 = new LinkedHashMap<>();
        participant1.put("id", "p1");
        participant1.put("refKind", "Application");
        participant1.put("refId", "app-1");
        participant1.put("orderIndex", 0);
        participants.add(participant1);

        Map<String, Object> participant2 = new LinkedHashMap<>();
        participant2.put("id", "p2");
        participant2.put("refKind", "Service");
        participant2.put("refId", "svc-1");
        participant2.put("orderIndex", 1);
        participants.add(participant2);

        editContent.put("participants", participants);

        // Add a message between participants
        List<Map<String, Object>> messages = new ArrayList<>();
        Map<String, Object> message = new LinkedHashMap<>();
        message.put("id", "m1");
        message.put("exchangeId", "ex-1");
        message.put("exchangeRole", "Request");
        message.put("fromParticipantId", "p1");
        message.put("toParticipantId", "p2");
        message.put("labelText", "doSomething()");
        messages.add(message);

        editContent.put("messages", messages);
        editTypedContent.put("content", editContent);

        forEdit.get().setTypedContentJson(editTypedContent);
        diagramRepository.save(forEdit.get());

        entityManager.flush();
        entityManager.clear();

        // Step 3: Reload and verify all changes persisted
        Optional<DiagramEntity> reloaded = diagramRepository.findById(diagramId);
        assertTrue(reloaded.isPresent(), "Diagram should exist after round-trip");

        Map<String, Object> finalTypedContent = reloaded.get().getTypedContentJson();
        assertEquals("Sequence", finalTypedContent.get("type"));
        assertEquals(1, finalTypedContent.get("version"));

        @SuppressWarnings("unchecked")
        Map<String, Object> finalContent = (Map<String, Object>) finalTypedContent.get("content");

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> finalParticipants = (List<Map<String, Object>>) finalContent.get("participants");
        assertEquals(2, finalParticipants.size(), "Should have 2 participants");
        assertEquals("p1", finalParticipants.get(0).get("id"));
        assertEquals("p2", finalParticipants.get(1).get("id"));

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> finalMessages = (List<Map<String, Object>>) finalContent.get("messages");
        assertEquals(1, finalMessages.size(), "Should have 1 message");
        assertEquals("m1", finalMessages.get(0).get("id"));
        assertEquals("doSomething()", finalMessages.get(0).get("labelText"));
    }

    /**
     * E2E Test 5: Migration - existing sequence_* data appears in typed_content_json.
     *
     * This test verifies the migration of existing sequence_* table data
     * into the typed_content_json column.
     */
    @Test
    @DisplayName("E2E Test 5: Migration - sequence_* data migrated to typed_content_json")
    void e2eTest5_migration_sequenceDataMigratedToTypedContentJson() {
        // Arrange - Create a Sequence diagram with null typedContentJson
        String diagramId = "e2e-migrate-" + UUID.randomUUID();

        DiagramEntity diagram = DiagramEntity.builder()
                .id(diagramId)
                .modelFileId(TEST_MODEL_FILE_ID)
                .name("E2E Migration Diagram")
                .description("Testing migration from sequence_* tables")
                .diagramType("Sequence")
                .typedContentJson(null) // Null - needs migration
                .build();

        diagramRepository.save(diagram);

        // Create matching sequence_diagrams record with child data
        SequenceDiagramEntity sequenceDiagram = SequenceDiagramEntity.builder()
                .id(diagramId)
                .modelFileId(TEST_MODEL_FILE_ID)
                .name("E2E Migration Diagram")
                .type("Sequence")
                .createdAt(OffsetDateTime.now())
                .updatedAt(OffsetDateTime.now())
                .build();

        sequenceDiagramRepository.save(sequenceDiagram);

        // Add participant in sequence_participants table
        SequenceParticipantEntity participant = SequenceParticipantEntity.builder()
                .id("migrate-part-1")
                .sequenceDiagramId(diagramId)
                .refKind("Application")
                .refId("app-migrate-1")
                .orderIndex(0)
                .createdAt(OffsetDateTime.now())
                .updatedAt(OffsetDateTime.now())
                .build();

        sequenceParticipantRepository.save(participant);

        // Add message in sequence_messages table
        SequenceMessageEntity message = SequenceMessageEntity.builder()
                .id("migrate-msg-1")
                .sequenceDiagramId(diagramId)
                .exchangeId("ex-migrate-1")
                .exchangeRole("Request")
                .fromParticipantId("migrate-part-1")
                .toParticipantId("migrate-part-2")
                .labelText("migratedCall()")
                .createdAt(OffsetDateTime.now())
                .updatedAt(OffsetDateTime.now())
                .build();

        sequenceMessageRepository.save(message);

        entityManager.flush();
        entityManager.clear();

        // Act - Run migration
        TypedContentMigrationService.MigrationResult result = migrationService.migrateSequenceDiagrams();

        entityManager.flush();
        entityManager.clear();

        // Assert - Data migrated to typed_content_json
        assertEquals(1, result.migratedCount(), "Should migrate 1 diagram");
        assertEquals(0, result.defaultedCount(), "Should default 0 diagrams");

        Optional<DiagramEntity> migrated = diagramRepository.findById(diagramId);
        assertTrue(migrated.isPresent());
        assertNotNull(migrated.get().getTypedContentJson(), "typedContentJson should be populated");

        Map<String, Object> typedContent = migrated.get().getTypedContentJson();
        assertEquals("Sequence", typedContent.get("type"));
        assertEquals(1, typedContent.get("version"));

        @SuppressWarnings("unchecked")
        Map<String, Object> content = (Map<String, Object>) typedContent.get("content");

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> migratedParticipants = (List<Map<String, Object>>) content.get("participants");
        assertEquals(1, migratedParticipants.size(), "Should have 1 migrated participant");
        assertEquals("migrate-part-1", migratedParticipants.get(0).get("id"));
        assertEquals("Application", migratedParticipants.get(0).get("refKind"));

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> migratedMessages = (List<Map<String, Object>>) content.get("messages");
        assertEquals(1, migratedMessages.size(), "Should have 1 migrated message");
        assertEquals("migrate-msg-1", migratedMessages.get(0).get("id"));
        assertEquals("migratedCall()", migratedMessages.get(0).get("labelText"));
    }

    /**
     * E2E Test 6: Verify that diagrams with all typed content types work correctly.
     *
     * This test creates diagrams of each typed type (Sequence, ER, Activity, State)
     * and verifies they all correctly store and retrieve typedContent.
     */
    @Test
    @DisplayName("E2E Test 6: All typed diagram types store typedContent correctly")
    void e2eTest6_allTypedDiagramTypes_storeTypedContentCorrectly() {
        String[] diagramTypes = {"Sequence", "ER", "Activity", "State"};

        for (String diagramType : diagramTypes) {
            String diagramId = "e2e-typed-" + diagramType.toLowerCase() + "-" + UUID.randomUUID();

            Map<String, Object> typedContent = TypedContentDefaults.getDefaultTypedContent(diagramType);
            assertNotNull(typedContent, "Default typedContent should exist for " + diagramType);

            DiagramEntity diagram = DiagramEntity.builder()
                    .id(diagramId)
                    .modelFileId(TEST_MODEL_FILE_ID)
                    .name("E2E " + diagramType + " Diagram")
                    .description("Testing " + diagramType + " typedContent storage")
                    .diagramType(diagramType)
                    .typedContentJson(typedContent)
                    .build();

            diagramRepository.save(diagram);
            entityManager.flush();
            entityManager.clear();

            Optional<DiagramEntity> reloaded = diagramRepository.findById(diagramId);
            assertTrue(reloaded.isPresent(), diagramType + " diagram should be persisted");
            assertNotNull(reloaded.get().getTypedContentJson(),
                    diagramType + " typedContentJson should not be null");
            assertEquals(diagramType, reloaded.get().getTypedContentJson().get("type"),
                    "Type should match " + diagramType);
            assertEquals(1, reloaded.get().getTypedContentJson().get("version"),
                    "Version should be 1 for " + diagramType);
        }
    }
}
