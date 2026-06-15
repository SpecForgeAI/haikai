package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.DataEntityPointEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

/**
 * Spring Data repository for DataEntityPointEntity.
 *
 * Provides standard CRUD operations and finder methods for data entity points.
 *
 * Spec: Data Entity Point Superclass
 */
@Repository
public interface DataEntityPointRepository extends JpaRepository<DataEntityPointEntity, String> {

    /**
     * Finds all data entity points for a given model file.
     *
     * @param modelFileId The model file ID
     * @return List of data entity points for the model file
     */
    List<DataEntityPointEntity> findByModelFileId(String modelFileId);

    /**
     * Finds a data entity point by model file ID and logical entity ID.
     *
     * @param modelFileId The model file ID
     * @param logicalEntityId The logical data entity ID
     * @return Optional containing the data entity point if found
     */
    Optional<DataEntityPointEntity> findByModelFileIdAndLogicalEntityId(String modelFileId, String logicalEntityId);

    /**
     * Finds a data entity point by model file ID and physical entity ID.
     *
     * @param modelFileId The model file ID
     * @param physicalEntityId The physical data entity ID
     * @return Optional containing the data entity point if found
     */
    Optional<DataEntityPointEntity> findByModelFileIdAndPhysicalEntityId(String modelFileId, String physicalEntityId);

    /**
     * Deletes all data entity points for a given model file.
     *
     * @param modelFileId The model file ID
     */
    void deleteByModelFileId(String modelFileId);
}
