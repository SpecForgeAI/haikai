package com.example.architecturemodel.service;

import com.example.architecturemodel.model.dto.DiscoveryCandidateDto;
import com.example.architecturemodel.model.dto.DiscoveryClusterDto;
import com.example.architecturemodel.model.dto.DiscoveryClusterMemberDto;
import com.example.architecturemodel.model.dto.DiscoveryEvidenceDto;
import com.example.architecturemodel.model.dto.DiscoveryRelationshipDto;
import com.example.architecturemodel.model.entity.DiscoveryCandidateEntity;
import com.example.architecturemodel.model.entity.DiscoveryClusterEntity;
import com.example.architecturemodel.model.entity.DiscoveryClusterMemberEntity;
import com.example.architecturemodel.model.entity.DiscoveryEvidenceEntity;
import com.example.architecturemodel.model.entity.DiscoveryRelationshipEntity;
import com.example.architecturemodel.repository.entity.DiscoveryCandidateRepository;
import com.example.architecturemodel.repository.entity.DiscoveryClusterRepository;
import com.example.architecturemodel.repository.entity.DiscoveryEvidenceRepository;
import com.example.architecturemodel.repository.entity.DiscoveryRelationshipRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.*;

/**
 * Service-level tests verifying upsert (ON CONFLICT DO UPDATE) semantics
 * for all four discovery entity types.
 *
 * These tests verify that when bulkCreate is called with IDs that already
 * exist in the database, the existing records are updated in place rather
 * than causing duplicate key violations.
 *
 * Spec: Discovery Refinement, Consolidation, and System Hardening (Increment 16)
 * Task Group 2: Idempotent Evidence, Relationship, Cluster, and Candidate Persistence
 */
@ExtendWith(MockitoExtension.class)
class DiscoveryUpsertServiceTest {

    @Mock
    private DiscoveryEvidenceRepository evidenceRepository;

    @Mock
    private DiscoveryRelationshipRepository relationshipRepository;

    @Mock
    private DiscoveryClusterRepository clusterRepository;

    @Mock
    private DiscoveryCandidateRepository candidateRepository;

    @Mock
    private org.springframework.jdbc.core.JdbcTemplate jdbcTemplate;

    @Mock
    private com.example.architecturemodel.service.DiscoveryRunArchitectureGuard runGuard;

    @InjectMocks
    private DiscoveryEvidenceService evidenceService;

    @InjectMocks
    private DiscoveryRelationshipService relationshipService;

    @InjectMocks
    private DiscoveryClusterService clusterService;

    @InjectMocks
    private DiscoveryCandidateService candidateService;

    private static final UUID RUN_ID = UUID.randomUUID();

    /**
     * Test 5: Evidence bulkCreate with duplicate IDs performs upsert (no duplicate row).
     *
     * When an evidence atom with the same ID is submitted twice, the second call
     * should detect the existing record via findAllById and update it rather than
     * creating a new row.
     */
    @Test
    @DisplayName("Test 5: Evidence bulkCreate with duplicate IDs performs upsert")
    void evidenceBulkCreate_withDuplicateIds_performsUpsert() {
        // Given: a stable ID that represents a deterministic evidence atom
        UUID stableId = UUID.randomUUID();
        Instant now = Instant.now();

        // The existing entity already in the database
        DiscoveryEvidenceEntity existingEntity = DiscoveryEvidenceEntity.builder()
            .id(stableId)
            .runId(RUN_ID)
            .repoUrl("https://github.com/org/repo")
            .filePath("src/App.java")
            .type("file_structure")
            .data(new HashMap<>(Map.of("oldKey", "oldValue")))
            .extractedAt(now)
            .build();

        // When findAllById is called, return the existing entity
        when(evidenceRepository.findAllById(List.of(stableId)))
            .thenReturn(List.of(existingEntity));

        // When saveAll is called, return whatever was passed in
        when(evidenceRepository.saveAll(anyList()))
            .thenAnswer(invocation -> invocation.getArgument(0));

        // The updated DTO with the same stable ID but different data
        DiscoveryEvidenceDto updatedDto = new DiscoveryEvidenceDto(
            stableId, RUN_ID, "https://github.com/org/repo",
            "src/App.java", "file_structure",
            Map.of("newKey", "newValue"),
            now.toString(), null, null
        );

        // When: bulkCreate is called with the same ID
        List<DiscoveryEvidenceDto> result = evidenceService.bulkCreate(RUN_ID, List.of(updatedDto));

        // Then: the existing entity was updated (not a new entity created)
        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<DiscoveryEvidenceEntity>> captor = ArgumentCaptor.forClass(List.class);
        verify(evidenceRepository).saveAll(captor.capture());
        List<DiscoveryEvidenceEntity> savedEntities = captor.getValue();

        assertThat(savedEntities).hasSize(1);
        // The saved entity should be the same object reference as the existing entity (updated in place)
        assertThat(savedEntities.get(0)).isSameAs(existingEntity);
        // And its data should be updated
        assertThat(savedEntities.get(0).getData()).containsEntry("newKey", "newValue");
    }

    /**
     * Test 6: Relationship bulkCreate with duplicate IDs performs upsert.
     */
    @Test
    @DisplayName("Test 6: Relationship bulkCreate with duplicate IDs performs upsert")
    void relationshipBulkCreate_withDuplicateIds_performsUpsert() {
        UUID stableId = UUID.randomUUID();
        UUID sourceAtomId = UUID.randomUUID();
        UUID targetAtomId = UUID.randomUUID();
        Instant now = Instant.now();

        // Existing entity
        DiscoveryRelationshipEntity existingEntity = DiscoveryRelationshipEntity.builder()
            .id(stableId)
            .runId(RUN_ID)
            .sourceAtomId(sourceAtomId)
            .targetAtomId(targetAtomId)
            .relationshipType("imports")
            .confidence(0.8)
            .data(new HashMap<>(Map.of("old", "data")))
            .inferredAt(now)
            .build();

        when(relationshipRepository.findAllById(List.of(stableId)))
            .thenReturn(List.of(existingEntity));
        when(relationshipRepository.saveAll(anyList()))
            .thenAnswer(invocation -> invocation.getArgument(0));

        // Updated DTO with same ID but higher confidence
        DiscoveryRelationshipDto updatedDto = new DiscoveryRelationshipDto(
            stableId, RUN_ID, sourceAtomId, targetAtomId,
            "imports", 0.95,
            Map.of("new", "data"),
            now.toString()
        );

        relationshipService.bulkCreate(RUN_ID, List.of(updatedDto));

        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<DiscoveryRelationshipEntity>> captor = ArgumentCaptor.forClass(List.class);
        verify(relationshipRepository).saveAll(captor.capture());
        List<DiscoveryRelationshipEntity> savedEntities = captor.getValue();

        assertThat(savedEntities).hasSize(1);
        assertThat(savedEntities.get(0)).isSameAs(existingEntity);
        assertThat(savedEntities.get(0).getConfidence()).isEqualTo(0.95);
        assertThat(savedEntities.get(0).getData()).containsEntry("new", "data");
    }

    /**
     * Test 7: Cluster bulkCreate with duplicate IDs performs upsert.
     */
    @Test
    @DisplayName("Test 7: Cluster bulkCreate with duplicate IDs performs upsert")
    void clusterBulkCreate_withDuplicateIds_performsUpsert() {
        UUID stableId = UUID.randomUUID();
        Instant now = Instant.now();

        // Existing entity with old members
        DiscoveryClusterEntity existingEntity = DiscoveryClusterEntity.builder()
            .id(stableId)
            .runId(RUN_ID)
            .clusterType("service_boundary")
            .name("OldName")
            .confidence(0.7)
            .data(new HashMap<>(Map.of("old", "data")))
            .formedAt(now)
            .members(new ArrayList<>(List.of(
                DiscoveryClusterMemberEntity.builder()
                    .id(UUID.randomUUID())
                    .clusterId(stableId)
                    .memberType("atom")
                    .memberId(UUID.randomUUID())
                    .build()
            )))
            .build();

        when(clusterRepository.findAllById(List.of(stableId)))
            .thenReturn(List.of(existingEntity));
        // Cluster bulkCreate now saves shells via saveAllAndFlush (members are
        // batch-inserted via JdbcTemplate afterwards).
        when(clusterRepository.saveAllAndFlush(anyList()))
            .thenAnswer(invocation -> invocation.getArgument(0));

        // Updated DTO with same ID but new name and members
        UUID newMemberId = UUID.randomUUID();
        DiscoveryClusterDto updatedDto = new DiscoveryClusterDto(
            stableId, RUN_ID, "service_boundary", "NewName", 0.9,
            List.of(new DiscoveryClusterMemberDto(null, stableId, "atom", newMemberId)),
            Map.of("new", "data"),
            now.toString()
        );

        clusterService.bulkCreate(RUN_ID, List.of(updatedDto));

        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<DiscoveryClusterEntity>> captor = ArgumentCaptor.forClass(List.class);
        verify(clusterRepository).saveAllAndFlush(captor.capture());
        List<DiscoveryClusterEntity> savedEntities = captor.getValue();

        assertThat(savedEntities).hasSize(1);
        assertThat(savedEntities.get(0)).isSameAs(existingEntity);
        assertThat(savedEntities.get(0).getName()).isEqualTo("NewName");
        assertThat(savedEntities.get(0).getConfidence()).isEqualTo(0.9);
        assertThat(savedEntities.get(0).getData()).containsEntry("new", "data");
    }

    /**
     * Test 8: Candidate bulkCreate with duplicate IDs performs upsert.
     */
    @Test
    @DisplayName("Test 8: Candidate bulkCreate with duplicate IDs performs upsert")
    void candidateBulkCreate_withDuplicateIds_performsUpsert() {
        UUID stableId = UUID.randomUUID();
        Instant now = Instant.now();

        // Existing entity
        DiscoveryCandidateEntity existingEntity = DiscoveryCandidateEntity.builder()
            .id(stableId)
            .runId(RUN_ID)
            .candidateType("service")
            .name("OldService")
            .confidence(0.6)
            .status("proposed")
            .sourceClusterIds(new ArrayList<>(List.of("cluster-1")))
            .data(new HashMap<>(Map.of("old", "data")))
            .synthesizedAt(now)
            .reviewStatus("pending_review")
            .build();

        when(candidateRepository.findAllById(List.of(stableId)))
            .thenReturn(List.of(existingEntity));
        when(candidateRepository.saveAll(anyList()))
            .thenAnswer(invocation -> invocation.getArgument(0));

        // Updated DTO with same ID but updated name and confidence
        DiscoveryCandidateDto updatedDto = new DiscoveryCandidateDto(
            stableId, RUN_ID, "service", "NewService", 0.85,
            "proposed",
            List.of("cluster-1", "cluster-2"),
            Map.of("new", "data"),
            now.toString(),
            null, // parentCandidateId
            "pending_review", null, null, null, null,
            null // operation
        );

        candidateService.bulkCreate(RUN_ID, List.of(updatedDto));

        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<DiscoveryCandidateEntity>> captor = ArgumentCaptor.forClass(List.class);
        verify(candidateRepository).saveAll(captor.capture());
        List<DiscoveryCandidateEntity> savedEntities = captor.getValue();

        assertThat(savedEntities).hasSize(1);
        assertThat(savedEntities.get(0)).isSameAs(existingEntity);
        assertThat(savedEntities.get(0).getName()).isEqualTo("NewService");
        assertThat(savedEntities.get(0).getConfidence()).isEqualTo(0.85);
        assertThat(savedEntities.get(0).getSourceClusterIds()).containsExactly("cluster-1", "cluster-2");
    }
}
