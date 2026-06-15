package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.DeploymentUnitEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

/**
 * Spring Data repository for DeploymentUnitEntity.
 *
 * Spec: 2026-05-04-infrastructure-domain-backend-foundation
 */
@Repository
public interface DeploymentUnitRepository extends JpaRepository<DeploymentUnitEntity, String> {

    List<DeploymentUnitEntity> findByModelFileId(String modelFileId);

    void deleteByModelFileId(String modelFileId);
}
