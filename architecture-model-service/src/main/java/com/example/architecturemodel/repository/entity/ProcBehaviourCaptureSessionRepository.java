package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.procbehaviour.ProcBehaviourCaptureSessionEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

/** Proc behaviour capture sessions (Stored Proc &amp; Function Behaviour Program, Spec 3). */
public interface ProcBehaviourCaptureSessionRepository
        extends JpaRepository<ProcBehaviourCaptureSessionEntity, UUID> {

    List<ProcBehaviourCaptureSessionEntity> findByArchitectureIdOrderByCreatedAtDesc(UUID architectureId);
}
