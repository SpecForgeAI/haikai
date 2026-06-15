package com.example.architecturemodel.repository.discovery;

import com.example.architecturemodel.model.entity.discovery.EndpointDataEffectEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

/**
 * Repository for {@code endpoint_data_effects}. Modelled on
 * {@code InterfaceLogicalEntityRepository}: model-file-scoped read +
 * delete-all, plus an {@code endpoint_id} lookup.
 *
 * <p>Spec: Endpoint&rarr;Data-Effect Call Graph for Discovery
 * (2026-05-29) -- Task Group 1.</p>
 */
@Repository
public interface EndpointDataEffectRepository extends JpaRepository<EndpointDataEffectEntity, String> {

    List<EndpointDataEffectEntity> findByModelFileId(String modelFileId);

    List<EndpointDataEffectEntity> findByEndpointId(String endpointId);

    void deleteByModelFileId(String modelFileId);
}
