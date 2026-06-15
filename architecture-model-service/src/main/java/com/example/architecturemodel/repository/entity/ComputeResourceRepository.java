package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.ComputeResourceEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

/**
 * Spring Data repository for ComputeResourceEntity.
 *
 * Created by Task Group 2 (entity layer) to support the constraint and mapping
 * tests; full repository coverage is finalised in Task Group 4.
 *
 * Spec: 2026-05-04-infrastructure-domain-backend-foundation
 */
@Repository
public interface ComputeResourceRepository extends JpaRepository<ComputeResourceEntity, String> {

    List<ComputeResourceEntity> findByModelFileId(String modelFileId);

    void deleteByModelFileId(String modelFileId);
}
