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

    /**
     * Batch endpoint-side read (Spec 2026-07-06-f): all effects for a set of
     * endpoints in one query — the code-spec carriage / gate read.
     */
    List<EndpointDataEffectEntity> findByEndpointIdIn(java.util.Collection<String> endpointIds);

    /**
     * REVERSE query (Spec 2026-07-06-f, indexed by changeset 209): all
     * effects — hence endpoints — touching the given data-entity points
     * ({@code dep_phy_*} tables / procs, {@code dep_log_*} logical entities).
     * The affected-consumer computation's core read.
     */
    List<EndpointDataEffectEntity> findByDataEntityPointIdIn(
        java.util.Collection<String> dataEntityPointIds);

    void deleteByModelFileId(String modelFileId);
}
