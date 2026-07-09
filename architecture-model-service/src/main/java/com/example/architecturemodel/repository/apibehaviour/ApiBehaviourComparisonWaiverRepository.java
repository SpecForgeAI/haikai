package com.example.architecturemodel.repository.apibehaviour;

import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourComparisonWaiverEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

/**
 * Repository for {@code api_behaviour_comparison_waivers}
 * (Spec 2026-07-06-j, changeset 206).
 */
@Repository
public interface ApiBehaviourComparisonWaiverRepository
        extends JpaRepository<ApiBehaviourComparisonWaiverEntity, UUID> {

    /** Effective set for a project: its own rows PLUS the global seeds. */
    List<ApiBehaviourComparisonWaiverEntity> findByProjectIdOrProjectIdIsNull(UUID projectId);
}
