package com.example.architecturemodel.repository.relationship;

import com.example.architecturemodel.model.entity.ApplicationLoadBalancerExposureEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

/**
 * Spring Data repository for ApplicationLoadBalancerExposureEntity (XR4).
 *
 * Spec: 2026-05-05-infrastructure-cross-domain-integration
 */
@Repository
public interface ApplicationLoadBalancerExposureRepository
        extends JpaRepository<ApplicationLoadBalancerExposureEntity, String> {

    List<ApplicationLoadBalancerExposureEntity> findByModelFileId(String modelFileId);

    void deleteByModelFileId(String modelFileId);
}
