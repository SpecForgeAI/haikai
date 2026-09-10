package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.procbehaviour.ProcBehaviourCaptureEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

/** Proc behaviour captures (Stored Proc &amp; Function Behaviour Program, Spec 3). */
public interface ProcBehaviourCaptureRepository
        extends JpaRepository<ProcBehaviourCaptureEntity, UUID> {

    List<ProcBehaviourCaptureEntity> findBySessionId(UUID sessionId);

    List<ProcBehaviourCaptureEntity> findByScenarioId(UUID scenarioId);
}
