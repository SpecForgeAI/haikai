package com.example.architecturemodel.repository.relationship;

import com.example.architecturemodel.model.entity.ApplicationComputeDeploymentEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

/**
 * Spring Data repository for ApplicationComputeDeploymentEntity (XR1).
 *
 * Spec: 2026-05-05-infrastructure-cross-domain-integration
 */
@Repository
public interface ApplicationComputeDeploymentRepository
        extends JpaRepository<ApplicationComputeDeploymentEntity, String> {

    List<ApplicationComputeDeploymentEntity> findByModelFileId(String modelFileId);

    void deleteByModelFileId(String modelFileId);
}
