package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.EnvironmentEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

/**
 * Spring Data repository for EnvironmentEntity.
 *
 * Created by Task Group 2 (entity layer) so the constraint and mapping tests
 * can build FK target rows; full repository coverage is finalised in Task
 * Group 4.
 *
 * Spec: 2026-05-04-infrastructure-domain-backend-foundation
 */
@Repository
public interface EnvironmentRepository extends JpaRepository<EnvironmentEntity, String> {

    List<EnvironmentEntity> findByModelFileId(String modelFileId);

    void deleteByModelFileId(String modelFileId);
}
