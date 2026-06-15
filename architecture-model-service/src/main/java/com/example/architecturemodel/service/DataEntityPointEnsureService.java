package com.example.architecturemodel.service;

import com.example.architecturemodel.model.dto.entity.LogicalDataEntityDto;
import com.example.architecturemodel.model.dto.entity.PhysicalDataEntityDto;
import com.example.architecturemodel.model.entity.DataEntityPointEntity;
import com.example.architecturemodel.repository.entity.DataEntityPointRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * Service responsible for ensuring Data Entity Points exist for all Logical and Physical Data Entities.
 *
 * Data Entity Points act as polymorphic reference wrappers that enable future relationship tables
 * to point to either Logical or Physical Data Entities through a single foreign key.
 *
 * ID Generation Convention:
 * - Logical entities: "dep_log_" + logicalEntityId
 * - Physical entities: "dep_phy_" + physicalEntityId
 *
 * This service is idempotent - running it multiple times produces the same result with no duplicates.
 *
 * Spec: Data Entity Point Superclass
 */
@Service
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
public class DataEntityPointEnsureService {

    private static final Logger log = LoggerFactory.getLogger(DataEntityPointEnsureService.class);

    private static final String LOGICAL_PREFIX = "dep_log_";
    private static final String PHYSICAL_PREFIX = "dep_phy_";
    private static final String LOGICAL_ENTITY_KIND = "LOGICAL_ENTITY";
    private static final String PHYSICAL_ENTITY_KIND = "PHYSICAL_ENTITY";

    private final DataEntityPointRepository dataEntityPointRepository;

    public DataEntityPointEnsureService(DataEntityPointRepository dataEntityPointRepository) {
        this.dataEntityPointRepository = dataEntityPointRepository;
    }

    /**
     * Ensures Data Entity Points exist for all provided Logical and Physical Data Entities.
     *
     * For each entity:
     * - Looks up existing point by modelFileId + entity FK
     * - If not found, creates a new point with deterministic ID
     * - If found, validates invariants (exactly one FK set)
     *
     * @param modelFileId The model file ID
     * @param logicalEntities List of logical data entities (may be null or empty)
     * @param physicalEntities List of physical data entities (may be null or empty)
     * @return List of all ensured Data Entity Points
     * @throws IllegalStateException if an existing point violates the "exactly one FK" invariant
     */
    @Transactional
    public List<DataEntityPointEntity> ensureDataEntityPoints(
            String modelFileId,
            List<LogicalDataEntityDto> logicalEntities,
            List<PhysicalDataEntityDto> physicalEntities) {

        List<DataEntityPointEntity> results = new ArrayList<>();

        // Process logical entities
        if (logicalEntities != null) {
            for (LogicalDataEntityDto logicalEntity : logicalEntities) {
                DataEntityPointEntity point = ensureLogicalEntityPoint(modelFileId, logicalEntity);
                results.add(point);
            }
        }

        // Process physical entities
        if (physicalEntities != null) {
            for (PhysicalDataEntityDto physicalEntity : physicalEntities) {
                DataEntityPointEntity point = ensurePhysicalEntityPoint(modelFileId, physicalEntity);
                results.add(point);
            }
        }

        log.debug("Ensured {} data entity points for modelFileId={}", results.size(), modelFileId);
        return results;
    }

    /**
     * Ensures a Data Entity Point exists for a logical data entity.
     */
    private DataEntityPointEntity ensureLogicalEntityPoint(String modelFileId, LogicalDataEntityDto logicalEntity) {
        String logicalEntityId = logicalEntity.id();

        Optional<DataEntityPointEntity> existing = dataEntityPointRepository
            .findByModelFileIdAndLogicalEntityId(modelFileId, logicalEntityId);

        if (existing.isPresent()) {
            DataEntityPointEntity existingPoint = existing.get();
            validateExactlyOneFkSet(existingPoint);
            log.trace("Found existing data entity point for logical entity: {}", logicalEntityId);
            return existingPoint;
        }

        // Create new point with deterministic ID
        String pointId = LOGICAL_PREFIX + logicalEntityId;
        DataEntityPointEntity newPoint = DataEntityPointEntity.builder()
            .id(pointId)
            .modelFileId(modelFileId)
            .pointKind(LOGICAL_ENTITY_KIND)
            .logicalEntityId(logicalEntityId)
            .physicalEntityId(null)
            .build();

        DataEntityPointEntity saved = dataEntityPointRepository.save(newPoint);
        log.debug("Created data entity point for logical entity: {} -> {}", logicalEntityId, pointId);
        return saved;
    }

    /**
     * Ensures a Data Entity Point exists for a physical data entity.
     */
    private DataEntityPointEntity ensurePhysicalEntityPoint(String modelFileId, PhysicalDataEntityDto physicalEntity) {
        String physicalEntityId = physicalEntity.id();

        Optional<DataEntityPointEntity> existing = dataEntityPointRepository
            .findByModelFileIdAndPhysicalEntityId(modelFileId, physicalEntityId);

        if (existing.isPresent()) {
            DataEntityPointEntity existingPoint = existing.get();
            validateExactlyOneFkSet(existingPoint);
            log.trace("Found existing data entity point for physical entity: {}", physicalEntityId);
            return existingPoint;
        }

        // Create new point with deterministic ID
        String pointId = PHYSICAL_PREFIX + physicalEntityId;
        DataEntityPointEntity newPoint = DataEntityPointEntity.builder()
            .id(pointId)
            .modelFileId(modelFileId)
            .pointKind(PHYSICAL_ENTITY_KIND)
            .logicalEntityId(null)
            .physicalEntityId(physicalEntityId)
            .build();

        DataEntityPointEntity saved = dataEntityPointRepository.save(newPoint);
        log.debug("Created data entity point for physical entity: {} -> {}", physicalEntityId, pointId);
        return saved;
    }

    /**
     * Validates that exactly one FK is set on the point (invariant enforcement).
     *
     * @throws IllegalStateException if both FKs are set or neither is set
     */
    private void validateExactlyOneFkSet(DataEntityPointEntity point) {
        boolean hasLogical = point.getLogicalEntityId() != null;
        boolean hasPhysical = point.getPhysicalEntityId() != null;

        if (hasLogical && hasPhysical) {
            throw new IllegalStateException(
                "Data Entity Point invariant violation: both logical_entity_id and physical_entity_id are set. " +
                "Point ID: " + point.getId());
        }

        if (!hasLogical && !hasPhysical) {
            throw new IllegalStateException(
                "Data Entity Point invariant violation: neither logical_entity_id nor physical_entity_id is set. " +
                "Point ID: " + point.getId());
        }
    }
}
