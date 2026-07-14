package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.DataParityReportEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

public interface DataParityReportRepository extends JpaRepository<DataParityReportEntity, UUID> {

    /** The migrate gate's read: the LATEST report for a (project, architecture). */
    Optional<DataParityReportEntity> findTopByProjectIdAndArchitectureIdOrderByCreatedAtDesc(
        UUID projectId, UUID architectureId);
}
