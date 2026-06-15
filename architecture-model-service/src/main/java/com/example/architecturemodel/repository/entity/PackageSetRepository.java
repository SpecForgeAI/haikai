package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.PackageSetEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

/**
 * Repository for PackageSet entities.
 *
 * Extended with methods for Package Set Standards Import:
 * - findByModelFileIdAndStandardSourceAndStandardKey for upsert lookup
 *
 * Spec: Package Set Standards Import (Iteration 6)
 */
@Repository
public interface PackageSetRepository extends JpaRepository<PackageSetEntity, String> {

    List<PackageSetEntity> findByModelFileId(String modelFileId);

    void deleteByModelFileId(String modelFileId);

    /**
     * Find a package set by model file ID, standard source, and standard key.
     * Used for deterministic upsert during import operations.
     *
     * @param modelFileId The model file ID
     * @param standardSource The standard source ("COMPANY" or "PROJECT")
     * @param standardKey The standard key (e.g., "JavaCrud")
     * @return Optional containing the matching package set, or empty if not found
     */
    Optional<PackageSetEntity> findByModelFileIdAndStandardSourceAndStandardKey(
            String modelFileId, String standardSource, String standardKey);
}
