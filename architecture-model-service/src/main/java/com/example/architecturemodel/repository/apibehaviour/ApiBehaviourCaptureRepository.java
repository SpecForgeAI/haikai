package com.example.architecturemodel.repository.apibehaviour;

import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourCaptureEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

/**
 * Spring Data repository for {@link ApiBehaviourCaptureEntity}.
 *
 * <p>Captures use {@code capturedAt} (not {@code createdAt}) for ordering —
 * the entity has only the {@code captured_at} timestamp per the spec column
 * list. The intent of the task spec's "order by created_at" is "stable
 * insertion order"; {@code capturedAt} fulfils the same role here.</p>
 *
 * <p>Spec: API Behaviour Baseline Capture Service (2026-05-15) — Task Group 1</p>
 */
@Repository
public interface ApiBehaviourCaptureRepository
        extends JpaRepository<ApiBehaviourCaptureEntity, UUID> {

    List<ApiBehaviourCaptureEntity>
        findBySessionIdOrderByCapturedAtAsc(UUID sessionId);

    List<ApiBehaviourCaptureEntity>
        findByScenarioIdOrderByCapturedAtAsc(UUID scenarioId);

    /**
     * All accepted captures for a session — used by the save-as-baseline
     * flow which only freezes accepted rows.
     */
    List<ApiBehaviourCaptureEntity>
        findBySessionIdAndAcceptedTrueOrderByCapturedAtAsc(UUID sessionId);
}
