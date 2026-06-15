package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.LocationEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

/**
 * Spring Data repository for LocationEntity.
 *
 * Spec: 2026-05-04-infrastructure-domain-backend-foundation
 */
@Repository
public interface LocationRepository extends JpaRepository<LocationEntity, String> {

    List<LocationEntity> findByModelFileId(String modelFileId);

    void deleteByModelFileId(String modelFileId);
}
