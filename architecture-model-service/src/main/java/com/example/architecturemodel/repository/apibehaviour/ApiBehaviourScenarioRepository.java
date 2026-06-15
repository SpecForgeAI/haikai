package com.example.architecturemodel.repository.apibehaviour;

import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourScenarioEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

/**
 * Spring Data repository for {@link ApiBehaviourScenarioEntity}.
 *
 * <p>Spec: API Behaviour Baseline Capture Service (2026-05-15) — Task Group 1</p>
 */
@Repository
public interface ApiBehaviourScenarioRepository
        extends JpaRepository<ApiBehaviourScenarioEntity, UUID> {

    List<ApiBehaviourScenarioEntity>
        findBySessionIdOrderByCreatedAtAsc(UUID sessionId);

    List<ApiBehaviourScenarioEntity>
        findByOperationIdOrderByCreatedAtAsc(UUID operationId);
}
