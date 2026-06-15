package com.example.architecturemodel.repository.relationship;

import com.example.architecturemodel.model.entity.IaCResourceBindingEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

/**
 * Spring Data repository for IaCResourceBindingEntity.
 *
 * Spec: 2026-05-05-infrastructure-terraform-discovery-readiness
 */
@Repository
public interface IaCResourceBindingRepository extends JpaRepository<IaCResourceBindingEntity, String> {

    List<IaCResourceBindingEntity> findByModelFileId(String modelFileId);

    void deleteByModelFileId(String modelFileId);
}
