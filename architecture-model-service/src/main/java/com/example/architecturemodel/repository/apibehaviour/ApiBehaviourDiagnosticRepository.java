package com.example.architecturemodel.repository.apibehaviour;

import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourDiagnosticEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

/**
 * Spring Data repository for {@link ApiBehaviourDiagnosticEntity}.
 *
 * <p>Spec: API Behaviour Baseline Capture Service (2026-05-15) — Task Group 1</p>
 */
@Repository
public interface ApiBehaviourDiagnosticRepository
        extends JpaRepository<ApiBehaviourDiagnosticEntity, UUID> {

    List<ApiBehaviourDiagnosticEntity>
        findBySessionIdOrderByCreatedAtAsc(UUID sessionId);
}
