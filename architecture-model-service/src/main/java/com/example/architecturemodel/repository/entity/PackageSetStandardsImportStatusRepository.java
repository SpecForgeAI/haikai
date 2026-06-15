package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.PackageSetStandardsImportStatusEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;

/**
 * Repository for PackageSetStandardsImportStatus entities.
 *
 * Provides methods for tracking import history and status.
 *
 * Spec: Package Set Standards Import (Iteration 6)
 */
@Repository
public interface PackageSetStandardsImportStatusRepository extends JpaRepository<PackageSetStandardsImportStatusEntity, String> {

    /**
     * Find the most recent import status for a model file.
     * Returns the status with the latest imported_at timestamp.
     *
     * @param modelFileId The model file ID
     * @return Optional containing the most recent status, or empty if no imports
     */
    Optional<PackageSetStandardsImportStatusEntity> findFirstByModelFileIdOrderByImportedAtDesc(String modelFileId);

    /**
     * Delete all import status records for a model file.
     *
     * @param modelFileId The model file ID
     */
    void deleteByModelFileId(String modelFileId);
}
