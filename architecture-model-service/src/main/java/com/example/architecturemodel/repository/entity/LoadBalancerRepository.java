package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.LoadBalancerEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

/**
 * Spring Data repository for LoadBalancerEntity.
 *
 * Spec: 2026-05-04-infrastructure-domain-backend-foundation
 */
@Repository
public interface LoadBalancerRepository extends JpaRepository<LoadBalancerEntity, String> {

    List<LoadBalancerEntity> findByModelFileId(String modelFileId);

    void deleteByModelFileId(String modelFileId);
}
