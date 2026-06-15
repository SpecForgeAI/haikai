package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.SubnetEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

/**
 * Spring Data repository for SubnetEntity.
 *
 * Spec: 2026-05-04-infrastructure-domain-backend-foundation
 */
@Repository
public interface SubnetRepository extends JpaRepository<SubnetEntity, String> {

    List<SubnetEntity> findByModelFileId(String modelFileId);

    void deleteByModelFileId(String modelFileId);
}
