package com.example.architecturemodel.service;

import com.example.architecturemodel.model.dto.DiscoveryClusterDto;
import com.example.architecturemodel.model.dto.DiscoveryClusterMemberDto;
import com.example.architecturemodel.model.entity.DiscoveryClusterEntity;
import com.example.architecturemodel.model.entity.DiscoveryClusterMemberEntity;
import com.example.architecturemodel.repository.entity.DiscoveryClusterRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.*;
import java.util.stream.Collectors;

/**
 * Service for managing discovery clusters and their members.
 *
 * Provides bulk create (clusters with nested members), query (with optional
 * cluster type filter), count, and delete operations for Phase 1c cluster formation.
 * Clusters are scoped to a discovery run and group related evidence atoms
 * and/or relationships.
 *
 * The bulkCreate method persists cluster entities AND their member entities
 * together in a single transaction via CascadeType.ALL. Duplicate members
 * (same cluster_id, member_type, member_id) are deduplicated before persistence.
 *
 * The deleteByRunId method supports delete-and-recreate semantics for cluster
 * graph updates after adjudication. Cascade delete of members is handled by
 * CascadeType.ALL + orphanRemoval on the entity relationship.
 *
 * Data flow position: 1a atoms -> 1b relationships -> **1c clusters** -> 1d candidates
 *
 * Spec: Phase 1 Evidence Schema Backbone (Increment 7)
 * Task Group 3: Cluster + ClusterMember JPA Stack (1c)
 *
 * Extended: Phase 1c Clustering and Cluster Adjudication (Increment 9)
 * Task Group 6: deleteByRunId for Cluster JPA Stack
 *
 * Extended: Discovery Refinement, Consolidation, and System Hardening (Increment 16)
 * Task Group 2: Upsert semantics -- re-saving by stable ID updates rather than duplicates
 */
@Service
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class DiscoveryClusterService {

    private static final int MEMBER_BATCH_SIZE = 1000;

    private final DiscoveryClusterRepository clusterRepository;
    private final JdbcTemplate jdbcTemplate;

    private final DiscoveryRunArchitectureGuard runGuard;

    @Transactional
    public List<DiscoveryClusterDto> bulkCreateInArchitecture(
            UUID runId, UUID projectId, UUID architectureId, List<DiscoveryClusterDto> clusters) {
        runGuard.verify(runId, projectId, architectureId);
        return bulkCreate(runId, clusters);
    }

    @Transactional(readOnly = true)
    public List<DiscoveryClusterDto> getByRunIdInArchitecture(
            UUID runId, UUID projectId, UUID architectureId, String type) {
        runGuard.verify(runId, projectId, architectureId);
        return getByRunId(runId, type);
    }

    @Transactional(readOnly = true)
    public long countByRunIdInArchitecture(UUID runId, UUID projectId, UUID architectureId) {
        runGuard.verify(runId, projectId, architectureId);
        return countByRunId(runId);
    }

    @Transactional
    public long deleteByRunIdInArchitecture(UUID runId, UUID projectId, UUID architectureId) {
        runGuard.verify(runId, projectId, architectureId);
        return deleteByRunId(runId);
    }


    /**
     * Bulk create or update clusters with their members for a discovery run (upsert semantics).
     *
     * Maps each cluster DTO to an entity, including nested member entities.
     * Duplicate members within a cluster (same member_type and member_id) are
     * deduplicated before persistence. The runId from the path parameter is
     * used to override the DTO's runId for consistency.
     *
     * For clusters with IDs that already exist in the database, fields are updated
     * in place and members are replaced (upsert). For new IDs, clusters are inserted.
     * This ensures that re-persisting the same records by stable ID is a no-op
     * rather than causing duplicate key violations.
     *
     * @param runId the discovery run UUID (from the URL path)
     * @param clusters list of cluster DTOs (each including members) to persist
     * @return list of persisted cluster DTOs with their members
     */
    @Transactional
    public List<DiscoveryClusterDto> bulkCreate(UUID runId, List<DiscoveryClusterDto> clusters) {
        log.debug("Bulk upserting {} clusters for run: {}", clusters.size(), runId);

        // Phase 1: Map DTOs and collect member data separately for JDBC batch insert
        Map<UUID, List<DiscoveryClusterMemberEntity>> membersByClusterId = new LinkedHashMap<>();

        List<DiscoveryClusterEntity> entities = clusters.stream()
            .map(dto -> {
                UUID clusterId = dto.id() != null ? dto.id() : UUID.randomUUID();
                membersByClusterId.put(clusterId, deduplicateAndMapMembers(dto.members(), clusterId));

                return DiscoveryClusterEntity.builder()
                    .id(clusterId)
                    .runId(runId)
                    .clusterType(dto.clusterType())
                    .name(dto.name())
                    .confidence(dto.confidence())
                    .data(dto.data() != null ? new HashMap<>(dto.data()) : new HashMap<>())
                    .formedAt(dto.formedAt() != null ? Instant.parse(dto.formedAt()) : Instant.now())
                    .members(new ArrayList<>()) // Members handled via JDBC below
                    .build();
            })
            .collect(Collectors.toList());

        // Phase 2: Upsert cluster shells (without members)
        List<UUID> incomingIds = entities.stream()
            .map(DiscoveryClusterEntity::getId)
            .collect(Collectors.toList());
        Map<UUID, DiscoveryClusterEntity> existingMap = clusterRepository.findAllById(incomingIds)
            .stream()
            .collect(Collectors.toMap(DiscoveryClusterEntity::getId, e -> e));

        List<DiscoveryClusterEntity> toSave = new ArrayList<>();
        int updatedCount = 0;
        for (DiscoveryClusterEntity entity : entities) {
            DiscoveryClusterEntity existing = existingMap.get(entity.getId());
            if (existing != null) {
                existing.setRunId(entity.getRunId());
                existing.setClusterType(entity.getClusterType());
                existing.setName(entity.getName());
                existing.setConfidence(entity.getConfidence());
                existing.setData(entity.getData());
                existing.setFormedAt(entity.getFormedAt());
                existing.getMembers().clear(); // Orphan removal deletes old members on flush
                toSave.add(existing);
                updatedCount++;
            } else {
                toSave.add(entity);
            }
        }

        // Phase 3: Save cluster shells and flush to ensure FK target rows exist
        List<DiscoveryClusterEntity> saved = clusterRepository.saveAllAndFlush(toSave);
        log.debug("Saved {} cluster shells ({} updated, {} inserted)",
            saved.size(), updatedCount, saved.size() - updatedCount);

        // Phase 4: Batch-insert members via JDBC in chunks
        int totalMembers = membersByClusterId.values().stream().mapToInt(List::size).sum();
        log.debug("Batch-inserting {} total members across {} clusters", totalMembers, membersByClusterId.size());

        List<Object[]> allRows = new ArrayList<>(totalMembers);
        for (Map.Entry<UUID, List<DiscoveryClusterMemberEntity>> entry : membersByClusterId.entrySet()) {
            for (DiscoveryClusterMemberEntity member : entry.getValue()) {
                allRows.add(new Object[]{
                    member.getId(),
                    member.getClusterId(),
                    member.getMemberType(),
                    member.getMemberId()
                });
            }
        }

        if (!allRows.isEmpty()) {
            String insertSql = "INSERT INTO discovery_cluster_member (id, cluster_id, member_type, member_id) " +
                "VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING";
            for (int i = 0; i < allRows.size(); i += MEMBER_BATCH_SIZE) {
                int end = Math.min(i + MEMBER_BATCH_SIZE, allRows.size());
                jdbcTemplate.batchUpdate(insertSql, allRows.subList(i, end));
            }
            log.debug("Batch-inserted {} members for run: {}", totalMembers, runId);
        }

        // Phase 5: Build response DTOs from saved shells + member map
        return saved.stream()
            .map(entity -> {
                List<DiscoveryClusterMemberEntity> members =
                    membersByClusterId.getOrDefault(entity.getId(), List.of());
                List<DiscoveryClusterMemberDto> memberDtos = members.stream()
                    .map(this::toMemberDto)
                    .collect(Collectors.toList());
                return new DiscoveryClusterDto(
                    entity.getId(),
                    entity.getRunId(),
                    entity.getClusterType(),
                    entity.getName(),
                    entity.getConfidence(),
                    memberDtos,
                    entity.getData(),
                    entity.getFormedAt().toString()
                );
            })
            .collect(Collectors.toList());
    }

    /**
     * Get clusters by run ID with optional cluster type filter.
     *
     * @param runId the discovery run UUID
     * @param type optional cluster type filter (service_boundary, data_domain, etc.)
     * @return list of matching cluster DTOs with their members
     */
    @Transactional(readOnly = true)
    public List<DiscoveryClusterDto> getByRunId(UUID runId, String type) {
        log.debug("Getting clusters for run: {}, type filter: {}", runId, type);

        List<DiscoveryClusterEntity> entities;
        if (type != null && !type.isBlank()) {
            entities = clusterRepository.findByRunIdAndClusterType(runId, type);
        } else {
            entities = clusterRepository.findByRunId(runId);
        }

        return entities.stream()
            .map(this::toDto)
            .collect(Collectors.toList());
    }

    /**
     * Count clusters for a discovery run.
     *
     * @param runId the discovery run UUID
     * @return the number of clusters for the run
     */
    @Transactional(readOnly = true)
    public long countByRunId(UUID runId) {
        log.debug("Counting clusters for run: {}", runId);
        return clusterRepository.countByRunId(runId);
    }

    /**
     * Delete all clusters (and cascade-delete their members) for a discovery run.
     *
     * Counts existing clusters before deletion for the return value, then deletes
     * all clusters matching the run ID. Member entities are cascade-deleted via
     * CascadeType.ALL + orphanRemoval on the DiscoveryClusterEntity's @OneToMany
     * relationship.
     *
     * This supports delete-and-recreate semantics for cluster graph updates
     * after adjudication in Phase 1c.
     *
     * Spec: Phase 1c Clustering and Cluster Adjudication (Increment 9)
     * Task Group 6: deleteByRunId for Cluster JPA Stack
     *
     * @param runId the discovery run UUID
     * @return the number of clusters deleted
     */
    @Transactional
    public long deleteByRunId(UUID runId) {
        log.debug("Deleting clusters for run: {}", runId);
        int count = clusterRepository.deleteByRunIdNative(runId);
        log.debug("Deleted {} clusters for run: {}", count, runId);
        return count;
    }

    /**
     * Deduplicate members by (member_type, member_id) and map to entities.
     * Sets the clusterId on each member entity.
     */
    private List<DiscoveryClusterMemberEntity> deduplicateAndMapMembers(
            List<DiscoveryClusterMemberDto> memberDtos, UUID clusterId) {
        if (memberDtos == null || memberDtos.isEmpty()) {
            return new ArrayList<>();
        }

        Set<String> seen = new HashSet<>();
        List<DiscoveryClusterMemberEntity> result = new ArrayList<>();

        for (DiscoveryClusterMemberDto dto : memberDtos) {
            String key = dto.memberType() + ":" + dto.memberId();
            if (seen.add(key)) {
                result.add(DiscoveryClusterMemberEntity.builder()
                    .id(dto.id() != null ? dto.id() : UUID.randomUUID())
                    .clusterId(clusterId)
                    .memberType(dto.memberType())
                    .memberId(dto.memberId())
                    .build());
            }
        }

        return result;
    }

    /**
     * Convert cluster entity (with members) to DTO with ISO-8601 timestamp string.
     */
    private DiscoveryClusterDto toDto(DiscoveryClusterEntity entity) {
        List<DiscoveryClusterMemberDto> memberDtos = entity.getMembers() != null
            ? entity.getMembers().stream()
                .map(this::toMemberDto)
                .collect(Collectors.toList())
            : List.of();

        return new DiscoveryClusterDto(
            entity.getId(),
            entity.getRunId(),
            entity.getClusterType(),
            entity.getName(),
            entity.getConfidence(),
            memberDtos,
            entity.getData(),
            entity.getFormedAt().toString()
        );
    }

    /**
     * Convert cluster member entity to DTO.
     */
    private DiscoveryClusterMemberDto toMemberDto(DiscoveryClusterMemberEntity entity) {
        return new DiscoveryClusterMemberDto(
            entity.getId(),
            entity.getClusterId(),
            entity.getMemberType(),
            entity.getMemberId()
        );
    }
}
