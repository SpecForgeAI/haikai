package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.DataStoreInstanceEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

/**
 * Spring Data repository for DataStoreInstanceEntity.
 *
 * Spec: 2026-05-04-infrastructure-domain-backend-foundation
 */
@Repository
public interface DataStoreInstanceRepository extends JpaRepository<DataStoreInstanceEntity, String> {

    List<DataStoreInstanceEntity> findByModelFileId(String modelFileId);

    void deleteByModelFileId(String modelFileId);
}
