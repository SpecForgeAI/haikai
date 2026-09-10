package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.procbehaviour.ProcBehaviourDiagnosticEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

/** Proc behaviour diagnostics (Stored Proc &amp; Function Behaviour Program, Spec 3). */
public interface ProcBehaviourDiagnosticRepository
        extends JpaRepository<ProcBehaviourDiagnosticEntity, UUID> {

    List<ProcBehaviourDiagnosticEntity> findBySessionId(UUID sessionId);
}
