package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.InfrastructurePointEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

/**
 * Spring Data repository for InfrastructurePointEntity.
 *
 * Provides standard CRUD operations and finder methods for infrastructure points.
 * Created by Task Group 2 (entity layer) so that the constraint test
 * (InfrastructurePointConstraintTest) can be activated; full repository
 * coverage with deleteByModelFileId is finalised in Task Group 4.
 *
 * Spec: 2026-05-04-infrastructure-domain-backend-foundation
 */
@Repository
public interface InfrastructurePointRepository extends JpaRepository<InfrastructurePointEntity, String> {

    List<InfrastructurePointEntity> findByModelFileId(String modelFileId);

    void deleteByModelFileId(String modelFileId);
}
