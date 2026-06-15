package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.InfrastructureResourceEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

/**
 * Spring Data repository for InfrastructureResourceEntity.
 *
 * Spec: 2026-05-04-infrastructure-domain-backend-foundation
 */
@Repository
public interface InfrastructureResourceRepository extends JpaRepository<InfrastructureResourceEntity, String> {

    List<InfrastructureResourceEntity> findByModelFileId(String modelFileId);

    void deleteByModelFileId(String modelFileId);
}
