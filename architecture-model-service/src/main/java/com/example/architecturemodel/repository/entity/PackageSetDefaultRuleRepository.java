package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.PackageSetDefaultRuleEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

/**
 * Repository for PackageSetDefaultRule entities.
 *
 * Provides methods for managing default rules for package set auto-resolution.
 *
 * Spec: Package Set Standards Import (Iteration 6)
 */
@Repository
public interface PackageSetDefaultRuleRepository extends JpaRepository<PackageSetDefaultRuleEntity, String> {

    /**
     * Find all default rules for a model file, ordered by priority (descending).
     * Higher priority rules are checked first during resolution.
     *
     * @param modelFileId The model file ID
     * @return List of rules ordered by priority descending
     */
    List<PackageSetDefaultRuleEntity> findByModelFileIdOrderByPriorityDesc(String modelFileId);

    /**
     * Find a default rule by model file ID, standard source, and package set ID.
     * Used for deterministic upsert during import operations.
     *
     * @param modelFileId The model file ID
     * @param standardSource The standard source ("COMPANY" or "PROJECT")
     * @param packageSetId The package set ID
     * @return Optional containing the matching rule, or empty if not found
     */
    Optional<PackageSetDefaultRuleEntity> findByModelFileIdAndStandardSourceAndPackageSetId(
            String modelFileId, String standardSource, String packageSetId);

    /**
     * Delete all rules for a model file.
     *
     * @param modelFileId The model file ID
     */
    void deleteByModelFileId(String modelFileId);

    /**
     * Delete all rules for a specific standard source (COMPANY or PROJECT).
     * Used before re-importing from a specific source.
     *
     * @param modelFileId The model file ID
     * @param standardSource The standard source to delete rules for
     */
    void deleteByModelFileIdAndStandardSource(String modelFileId, String standardSource);
}
