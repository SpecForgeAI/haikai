package com.example.architecturemodel.repository.relationship;

import com.example.architecturemodel.model.entity.LoadBalancerResourceRouteEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

/**
 * Spring Data repository for LoadBalancerResourceRouteEntity (R3).
 *
 * Spec: 2026-05-04-infrastructure-domain-backend-foundation
 */
@Repository
public interface LoadBalancerResourceRouteRepository extends JpaRepository<LoadBalancerResourceRouteEntity, String> {

    List<LoadBalancerResourceRouteEntity> findByModelFileId(String modelFileId);

    void deleteByModelFileId(String modelFileId);
}
