package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.ApplicationPointEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface ApplicationPointRepository extends JpaRepository<ApplicationPointEntity, String> {

    List<ApplicationPointEntity> findByModelFileId(String modelFileId);

    void deleteByModelFileId(String modelFileId);

    /**
     * Look up an ApplicationPoint by the canonical targeting tuple
     * {@code (model_file_id, target_type, target_ref_id)}.
     *
     * <p>Used by Fix #5 (synthetic-placeholder removal): the
     * discovery-service resolves a real AP UUID for a Service / Library
     * before pushing a {@code source_application_point_id} FK value to
     * {@code code_unit_dependencies}, instead of using a synthetic
     * {@code service:svc-xxx} / {@code library:lib-xxx} placeholder.</p>
     *
     * <p>The {@code target_type} CHECK constraint allows
     * {@code SERVICE | CLASS | METHOD | LIBRARY}; this method is the single
     * lookup channel used by the new {@code by-target} endpoint.</p>
     */
    Optional<ApplicationPointEntity> findByModelFileIdAndTargetTypeAndTargetRefId(
        String modelFileId, String targetType, String targetRefId);
}
