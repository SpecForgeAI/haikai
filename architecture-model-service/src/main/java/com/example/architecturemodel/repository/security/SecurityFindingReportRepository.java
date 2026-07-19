package com.example.architecturemodel.repository.security;

import com.example.architecturemodel.model.entity.security.SecurityFindingReportEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Repository for {@code security_finding_reports} (Security health dashboard,
 * 2026-07-19, Spec 1 of 3). Snapshot-list lifecycle: one latest per
 * {@code (project_id, architecture_id)}, full history retained.
 */
public interface SecurityFindingReportRepository
        extends JpaRepository<SecurityFindingReportEntity, UUID> {

    /** The current latest report for the scope (Overview + Register default read). */
    Optional<SecurityFindingReportEntity> findFirstByProjectIdAndArchitectureIdAndIsLatestTrue(
        UUID projectId, UUID architectureId);

    /** Upload history, newest first (the compact "Load previous" modal). */
    List<SecurityFindingReportEntity> findByProjectIdAndArchitectureIdOrderByUploadedAtDesc(
        UUID projectId, UUID architectureId);

    /**
     * The most recent report for the whole PROJECT regardless of architecture --
     * the wizard's column-mapping / level prefill source (an organisation's
     * scanner format is stable across architectures).
     */
    Optional<SecurityFindingReportEntity> findFirstByProjectIdOrderByUploadedAtDesc(
        UUID projectId);
}
