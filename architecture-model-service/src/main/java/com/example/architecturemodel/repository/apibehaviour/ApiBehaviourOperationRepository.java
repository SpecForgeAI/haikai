package com.example.architecturemodel.repository.apibehaviour;

import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourOperationEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

/**
 * Spring Data repository for {@link ApiBehaviourOperationEntity}.
 *
 * <p>Spec: API Behaviour Baseline Capture Service (2026-05-15) — Task Group 1</p>
 */
@Repository
public interface ApiBehaviourOperationRepository
        extends JpaRepository<ApiBehaviourOperationEntity, UUID> {

    /**
     * List operations for a session in stable insertion order.
     */
    List<ApiBehaviourOperationEntity>
        findBySessionIdOrderByCreatedAtAsc(UUID sessionId);
}
