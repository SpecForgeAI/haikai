package com.example.architecturemodel.repository.relationship;

import com.example.architecturemodel.model.entity.DeploymentUnitComputeResourceEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

/**
 * Spring Data repository for DeploymentUnitComputeResourceEntity (R2).
 *
 * Created by Task Group 2 (entity layer) to support the entity mapping tests
 * (specifically the JSONB runtime_config round-trip); full repository coverage
 * is finalised in Task Group 4.
 *
 * Spec: 2026-05-04-infrastructure-domain-backend-foundation
 */
@Repository
public interface DeploymentUnitComputeResourceRepository extends JpaRepository<DeploymentUnitComputeResourceEntity, String> {

    List<DeploymentUnitComputeResourceEntity> findByModelFileId(String modelFileId);

    void deleteByModelFileId(String modelFileId);
}
