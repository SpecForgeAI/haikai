package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.PhysicalDataAttributeEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface PhysicalDataAttributeRepository extends JpaRepository<PhysicalDataAttributeEntity, String> {

    List<PhysicalDataAttributeEntity> findByModelFileId(String modelFileId);

    /**
     * Finds all physical data attributes for a given physical data entity.
     * Used for data entity bundle expansion to include attributes when expanding
     * with entity_with_attributes_and_relationships bundle type.
     *
     * @param physicalEntityId the physical data entity ID
     * @return list of physical data attributes belonging to the entity
     *
     * Spec: Context Bundles Backend Expansion - Task Group 6
     */
    List<PhysicalDataAttributeEntity> findByPhysicalEntityId(String physicalEntityId);

    void deleteByModelFileId(String modelFileId);
}
