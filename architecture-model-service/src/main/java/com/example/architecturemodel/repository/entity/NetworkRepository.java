package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.NetworkEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

/**
 * Spring Data repository for NetworkEntity.
 *
 * Spec: 2026-05-04-infrastructure-domain-backend-foundation
 */
@Repository
public interface NetworkRepository extends JpaRepository<NetworkEntity, String> {

    List<NetworkEntity> findByModelFileId(String modelFileId);

    void deleteByModelFileId(String modelFileId);
}
