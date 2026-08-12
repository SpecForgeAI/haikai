package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.DataMigrationReportEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

public interface DataMigrationReportRepository extends JpaRepository<DataMigrationReportEntity, UUID> {

    /** The diagnosis read: the LATEST load report for a (project, architecture). */
    Optional<DataMigrationReportEntity> findTopByProjectIdAndArchitectureIdOrderByCreatedAtDesc(
        UUID projectId, UUID architectureId);
}
