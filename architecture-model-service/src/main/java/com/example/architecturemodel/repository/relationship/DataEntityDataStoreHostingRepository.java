package com.example.architecturemodel.repository.relationship;

import com.example.architecturemodel.model.entity.DataEntityDataStoreHostingEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

/**
 * Spring Data repository for DataEntityDataStoreHostingEntity (XR2).
 *
 * Spec: 2026-05-05-infrastructure-cross-domain-integration
 */
@Repository
public interface DataEntityDataStoreHostingRepository
        extends JpaRepository<DataEntityDataStoreHostingEntity, String> {

    List<DataEntityDataStoreHostingEntity> findByModelFileId(String modelFileId);

    void deleteByModelFileId(String modelFileId);
}
