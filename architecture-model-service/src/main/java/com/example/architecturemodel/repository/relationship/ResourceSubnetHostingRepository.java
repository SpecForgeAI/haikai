package com.example.architecturemodel.repository.relationship;

import com.example.architecturemodel.model.entity.ResourceSubnetHostingEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

/**
 * Spring Data repository for ResourceSubnetHostingEntity (R1).
 *
 * Created by Task Group 2 (entity layer) to support the entity mapping tests;
 * full repository coverage is finalised in Task Group 4.
 *
 * Spec: 2026-05-04-infrastructure-domain-backend-foundation
 */
@Repository
public interface ResourceSubnetHostingRepository extends JpaRepository<ResourceSubnetHostingEntity, String> {

    List<ResourceSubnetHostingEntity> findByModelFileId(String modelFileId);

    void deleteByModelFileId(String modelFileId);
}
