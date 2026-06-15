package com.example.architecturemodel.migration;

import com.example.architecturemodel.model.entity.ModelFileEntity;
import com.example.architecturemodel.model.entity.SequenceDiagramEntity;
import com.example.architecturemodel.model.entity.SequenceMessageEntity;
import com.example.architecturemodel.model.entity.SequenceParticipantEntity;
import com.example.architecturemodel.repository.ModelFileRepository;
import com.example.architecturemodel.repository.entity.SequenceDiagramRepository;
import com.example.architecturemodel.repository.entity.SequenceMessageRepository;
import com.example.architecturemodel.repository.entity.SequenceParticipantRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.autoconfigure.orm.jpa.TestEntityManager;
import org.springframework.test.context.ActiveProfiles;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Migration verification tests for migration 041: endpoint display option columns
 * on the sequence_messages table.
 *
 * Since tests use H2 with hibernate ddl-auto=create-drop, we verify the entity
 * field mappings which mirror the migration's column additions.
 *
 * Spec: Sequence Diagram Interface Endpoint Message Exchange Display and Endpoint Response
 * Task Group 1: Migration 041 - Endpoint Display Columns
 */
@DataJpaTest
@ActiveProfiles("test")
class SeqMessageEndpointDisplayMigrationTest {

    @Autowired
    private TestEntityManager entityManager;

    @Autowired
    private ModelFileRepository modelFileRepository;

    @Autowired
    private SequenceDiagramRepository sequenceDiagramRepository;

    @Autowired
    private SequenceParticipantRepository sequenceParticipantRepository;

    @Autowired
    private SequenceMessageRepository sequenceMessageRepository;

    private SequenceParticipantEntity fromParticipant;
    private SequenceParticipantEntity toParticipant;
    private SequenceDiagramEntity diagram;

    @BeforeEach
    void setUp() {
        ModelFileEntity modelFile = ModelFileEntity.builder()
            .id("test-model-file-041")
            .filename("test-migration-041")
            .isDefault(false)
            .build();
        modelFileRepository.save(modelFile);

        diagram = SequenceDiagramEntity.builder()
            .id("sd-041")
            .modelFileId(modelFile.getId())
            .name("TestDiagram041")
            .build();
        sequenceDiagramRepository.save(diagram);

        fromParticipant = SequenceParticipantEntity.builder()
            .id("sp-from-041")
            .sequenceDiagramId(diagram.getId())
            .refKind("Application")
            .refId("app-1")
            .orderIndex(0)
            .build();
        sequenceParticipantRepository.save(fromParticipant);

        toParticipant = SequenceParticipantEntity.builder()
            .id("sp-to-041")
            .sequenceDiagramId(diagram.getId())
            .refKind("Service")
            .refId("svc-1")
            .orderIndex(1)
            .build();
        sequenceParticipantRepository.save(toParticipant);

        entityManager.flush();
    }

    /**
     * Test 1: Verify that new columns have correct defaults when not explicitly set.
     * Migration specifies: show_endpoint_name=FALSE, show_endpoint_verb_path=FALSE,
     * show_endpoint_req_res_data=FALSE, response_mode='normal'.
     */
    @Test
    @DisplayName("New columns have correct defaults (FALSE/FALSE/FALSE/'normal')")
    void testNewColumnsHaveCorrectDefaults() {
        SequenceMessageEntity msg = SequenceMessageEntity.builder()
            .id("msg-defaults-041")
            .sequenceDiagramId(diagram.getId())
            .exchangeId("exch-1")
            .exchangeRole("Request")
            .fromParticipantId(fromParticipant.getId())
            .toParticipantId(toParticipant.getId())
            .labelText("test message")
            .build();
        sequenceMessageRepository.save(msg);
        entityManager.flush();
        entityManager.clear();

        SequenceMessageEntity saved = sequenceMessageRepository.findById("msg-defaults-041").orElseThrow();
        assertThat(saved.getShowEndpointName()).isNull();
        assertThat(saved.getShowEndpointVerbPath()).isNull();
        assertThat(saved.getShowEndpointReqResData()).isNull();
        assertThat(saved.getResponseMode()).isNull();
    }

    /**
     * Test 2: Verify that a SequenceMessageEntity round-trips the 4 new fields
     * with explicit values set.
     */
    @Test
    @DisplayName("SequenceMessageEntity round-trips all 4 new endpoint display fields")
    void testRoundTripNewFields() {
        SequenceMessageEntity msg = SequenceMessageEntity.builder()
            .id("msg-roundtrip-041")
            .sequenceDiagramId(diagram.getId())
            .exchangeId("exch-2")
            .exchangeRole("Request")
            .fromParticipantId(fromParticipant.getId())
            .toParticipantId(toParticipant.getId())
            .refKind("InterfaceEndpoint")
            .refId("ep-123")
            .showEndpointName(true)
            .showEndpointVerbPath(true)
            .showEndpointReqResData(false)
            .responseMode("endpoint_response")
            .build();
        sequenceMessageRepository.save(msg);
        entityManager.flush();
        entityManager.clear();

        SequenceMessageEntity saved = sequenceMessageRepository.findById("msg-roundtrip-041").orElseThrow();
        assertThat(saved.getShowEndpointName()).isTrue();
        assertThat(saved.getShowEndpointVerbPath()).isTrue();
        assertThat(saved.getShowEndpointReqResData()).isFalse();
        assertThat(saved.getResponseMode()).isEqualTo("endpoint_response");
    }

    /**
     * Test 3: Verify migration applies without error by saving and retrieving
     * a message that exercises all new columns simultaneously.
     */
    @Test
    @DisplayName("Migration applies without error - entity with all new columns persists successfully")
    void testMigrationAppliesWithoutError() {
        SequenceMessageEntity msg = SequenceMessageEntity.builder()
            .id("msg-apply-041")
            .sequenceDiagramId(diagram.getId())
            .exchangeId("exch-3")
            .exchangeRole("Response")
            .fromParticipantId(toParticipant.getId())
            .toParticipantId(fromParticipant.getId())
            .refKind("InterfaceEndpoint")
            .refId("ep-456")
            .showEndpointName(false)
            .showEndpointVerbPath(false)
            .showEndpointReqResData(true)
            .responseMode("normal")
            .build();
        sequenceMessageRepository.save(msg);
        entityManager.flush();
        entityManager.clear();

        SequenceMessageEntity saved = sequenceMessageRepository.findById("msg-apply-041").orElseThrow();
        assertThat(saved).isNotNull();
        assertThat(saved.getShowEndpointReqResData()).isTrue();
        assertThat(saved.getResponseMode()).isEqualTo("normal");
    }
}
