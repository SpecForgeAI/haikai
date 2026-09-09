package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.procbehaviour.ProcBehaviourScenarioEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

/** Proc behaviour scenarios (Stored Proc &amp; Function Behaviour Program, Spec 3). */
public interface ProcBehaviourScenarioRepository
        extends JpaRepository<ProcBehaviourScenarioEntity, UUID> {

    List<ProcBehaviourScenarioEntity> findBySessionId(UUID sessionId);

    List<ProcBehaviourScenarioEntity> findBySessionIdAndRoutineId(UUID sessionId, UUID routineId);
}
