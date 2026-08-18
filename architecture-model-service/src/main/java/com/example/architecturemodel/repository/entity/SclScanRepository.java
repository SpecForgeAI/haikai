package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.SclScanEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

/**
 * Spring Data JPA Repository for {@link SclScanEntity}.
 *
 * Provides CRUD operations plus the (project, architecture)-scoped scan-list
 * lookup backing the "latest scan" read. Backed by the composite index
 * {@code idx_scl_scan_project_arch} from changeset 224.
 *
 * Spec: SCL corpus persistence (Structural Contract Language) (2026-08-18).
 */
@Repository
public interface SclScanRepository extends JpaRepository<SclScanEntity, UUID> {

    /**
     * All SCL scans for a (project, architecture) pair, newest first. Element
     * zero is the "latest scan" the corpus reads default to.
     *
     * @param projectId the project UUID
     * @param architectureId the architecture UUID
     * @return matching scans ordered by createdAt descending
     */
    List<SclScanEntity> findByProjectIdAndArchitectureIdOrderByCreatedAtDesc(
        UUID projectId, UUID architectureId);
}
