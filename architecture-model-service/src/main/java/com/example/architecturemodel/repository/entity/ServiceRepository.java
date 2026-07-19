package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.ServiceEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface ServiceRepository extends JpaRepository<ServiceEntity, String> {

    List<ServiceEntity> findByModelFileId(String modelFileId);

    void deleteByModelFileId(String modelFileId);

    // Security health dashboard (2026-07-19, service-level association):
    // descendant expansion for ancestor-aware register filtering.
    List<ServiceEntity> findByApplicationId(String applicationId);

    List<ServiceEntity> findByApplicationComponentId(String applicationComponentId);
}
