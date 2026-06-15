package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.ComputeClusterEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

/**
 * Spring Data repository for ComputeClusterEntity.
 *
 * Created by Task Group 2 (entity layer) to support the constraint and mapping
 * tests; full repository coverage is finalised in Task Group 4.
 *
 * Spec: 2026-05-04-infrastructure-domain-backend-foundation
 */
@Repository
public interface ComputeClusterRepository extends JpaRepository<ComputeClusterEntity, String> {

    List<ComputeClusterEntity> findByModelFileId(String modelFileId);

    void deleteByModelFileId(String modelFileId);
}
