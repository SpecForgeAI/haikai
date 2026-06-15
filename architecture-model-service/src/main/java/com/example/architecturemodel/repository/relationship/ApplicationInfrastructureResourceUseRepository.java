package com.example.architecturemodel.repository.relationship;

import com.example.architecturemodel.model.entity.ApplicationInfrastructureResourceUseEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

/**
 * Spring Data repository for ApplicationInfrastructureResourceUseEntity (XR3).
 *
 * Spec: 2026-05-05-infrastructure-cross-domain-integration
 */
@Repository
public interface ApplicationInfrastructureResourceUseRepository
        extends JpaRepository<ApplicationInfrastructureResourceUseEntity, String> {

    List<ApplicationInfrastructureResourceUseEntity> findByModelFileId(String modelFileId);

    void deleteByModelFileId(String modelFileId);
}
