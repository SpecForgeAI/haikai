package com.example.architecturemodel.runner;

import com.example.architecturemodel.model.dto.entity.LogicalDataEntityDto;
import com.example.architecturemodel.model.dto.entity.PhysicalDataEntityDto;
import com.example.architecturemodel.model.entity.DataEntityPointEntity;
import com.example.architecturemodel.model.entity.LogicalDataEntityEntity;
import com.example.architecturemodel.model.entity.ModelFileEntity;
import com.example.architecturemodel.model.entity.PhysicalDataEntityEntity;
import com.example.architecturemodel.repository.ModelFileRepository;
import com.example.architecturemodel.repository.entity.LogicalDataEntityRepository;
import com.example.architecturemodel.repository.entity.PhysicalDataEntityRepository;
import com.example.architecturemodel.service.DataEntityPointEnsureService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.stream.Collectors;

/**
 * Application startup runner that ensures Data Entity Points exist for all
 * Logical and Physical Data Entities in the database.
 *
 * This is a safety net that runs on application startup to catch any edge cases
 * not covered by the Liquibase migration (021-data-entity-points-backfill.sql).
 *
 * The runner is:
 * - Idempotent: Running multiple times produces no duplicates
 * - Non-destructive: Never deletes existing Data Entity Points
 * - Configurable: Can be disabled via `app.data-entity-points.startup-ensure=false`
 *
 * This component is only active when database is enabled
 * (app.features.include-database=true or not set). When database is disabled,
 * this bean is not created, preventing UnsatisfiedDependencyException for
 * repository dependencies.
 *
 * Spec: Data Entity Point Backfill and Legacy Snapshot Compatibility
 * Task Group 3: Startup Backfill Runner
 *
 * Spec 2026-01-19: Disable Database Feature Flag
 */
@Component
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class DataEntityPointBackfillRunner implements ApplicationRunner {

    private final ModelFileRepository modelFileRepository;
    private final LogicalDataEntityRepository logicalDataEntityRepository;
    private final PhysicalDataEntityRepository physicalDataEntityRepository;
    private final DataEntityPointEnsureService dataEntityPointEnsureService;

    @Value("${app.data-entity-points.startup-ensure:true}")
    private boolean startupEnsureEnabled;

    @Override
    public void run(ApplicationArguments args) {
        if (!startupEnsureEnabled) {
            log.info("Data Entity Point startup backfill is disabled via configuration");
            return;
        }

        log.info("Running Data Entity Point startup backfill...");

        int modelFilesProcessed = 0;

        try {
            // Query all model files
            List<ModelFileEntity> modelFiles = modelFileRepository.findAll();

            for (ModelFileEntity modelFile : modelFiles) {
                String modelFileId = modelFile.getId();

                // Load logical entities for this model file
                List<LogicalDataEntityEntity> logicalEntities =
                    logicalDataEntityRepository.findByModelFileId(modelFileId);

                // Load physical entities for this model file
                List<PhysicalDataEntityEntity> physicalEntities =
                    physicalDataEntityRepository.findByModelFileId(modelFileId);

                if (logicalEntities.isEmpty() && physicalEntities.isEmpty()) {
                    continue; // Skip model files with no data entities
                }

                // Convert entities to DTOs for the ensure service
                List<LogicalDataEntityDto> logicalDtos = logicalEntities.stream()
                    .map(this::toLogicalDto)
                    .collect(Collectors.toList());

                List<PhysicalDataEntityDto> physicalDtos = physicalEntities.stream()
                    .map(this::toPhysicalDto)
                    .collect(Collectors.toList());

                // Call ensure service - this is idempotent
                List<DataEntityPointEntity> ensuredPoints =
                    dataEntityPointEnsureService.ensureDataEntityPoints(
                        modelFileId,
                        logicalDtos,
                        physicalDtos
                    );

                modelFilesProcessed++;
            }

            log.info("Data Entity Point startup backfill complete: processed {} model files",
                modelFilesProcessed);

        } catch (Exception e) {
            log.error("Data Entity Point startup backfill failed: {}", e.getMessage(), e);
            // Don't fail application startup - backfill failure is not fatal
            // The migration should have already handled most cases
        }
    }

    /**
     * Converts a LogicalDataEntityEntity to LogicalDataEntityDto.
     */
    private LogicalDataEntityDto toLogicalDto(LogicalDataEntityEntity entity) {
        return new LogicalDataEntityDto(
            entity.getId(),
            entity.getName(),
            entity.getDescription(),
            entity.getTags(),
            entity.getValidFrom(),
            entity.getValidTo(),
            entity.getSourceProvenance()
        );
    }

    /**
     * Converts a PhysicalDataEntityEntity to PhysicalDataEntityDto.
     */
    private PhysicalDataEntityDto toPhysicalDto(PhysicalDataEntityEntity entity) {
        return new PhysicalDataEntityDto(
            entity.getId(),
            entity.getName(),
            entity.getDescription(),
            entity.getPhysicalType(),
            entity.getDatabaseName(),
            entity.getTags(),
            entity.getValidFrom(),
            entity.getValidTo(),
            entity.getConstraintsMetadata()
        );
    }
}
