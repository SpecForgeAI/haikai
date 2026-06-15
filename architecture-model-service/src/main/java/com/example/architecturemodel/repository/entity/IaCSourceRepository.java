package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.IaCSourceEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

/**
 * Spring Data repository for IaCSourceEntity.
 *
 * Spec: 2026-05-05-infrastructure-terraform-discovery-readiness
 */
@Repository
public interface IaCSourceRepository extends JpaRepository<IaCSourceEntity, String> {

    List<IaCSourceEntity> findByModelFileId(String modelFileId);

    void deleteByModelFileId(String modelFileId);
}
