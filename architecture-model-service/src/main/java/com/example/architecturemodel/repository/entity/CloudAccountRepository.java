package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.CloudAccountEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

/**
 * Spring Data repository for CloudAccountEntity.
 *
 * Spec: 2026-05-04-infrastructure-domain-backend-foundation
 */
@Repository
public interface CloudAccountRepository extends JpaRepository<CloudAccountEntity, String> {

    List<CloudAccountEntity> findByModelFileId(String modelFileId);

    void deleteByModelFileId(String modelFileId);
}
