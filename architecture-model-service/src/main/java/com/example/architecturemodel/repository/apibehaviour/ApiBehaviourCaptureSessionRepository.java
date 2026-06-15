package com.example.architecturemodel.repository.apibehaviour;

import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourCaptureSessionEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

/**
 * Spring Data repository for {@link ApiBehaviourCaptureSessionEntity}.
 *
 * <p>Spec: API Behaviour Baseline Capture Service (2026-05-15) — Task Group 1
 * (initial finders). API Test Harness — Target-Side Capture (2026-05-25) —
 * Task Group 1 (kind-filtered finder).</p>
 */
@Repository
public interface ApiBehaviourCaptureSessionRepository
        extends JpaRepository<ApiBehaviourCaptureSessionEntity, UUID> {

    /**
     * List sessions for a (project, architecture) pair, newest first.
     */
    List<ApiBehaviourCaptureSessionEntity>
        findByProjectIdAndArchitectureIdOrderByCreatedAtDesc(
            UUID projectId, UUID architectureId);

    /**
     * List all sessions for a project (used by project-scoped views).
     */
    List<ApiBehaviourCaptureSessionEntity>
        findByProjectIdOrderByCreatedAtDesc(UUID projectId);

    /**
     * Used by startup-reconciliation in the new service: any session whose
     * persisted status was {@code running} when the process restarted lost
     * its in-memory secrets and must be marked {@code failed} with
     * {@code error_message='secrets_lost_during_run'}.
     */
    List<ApiBehaviourCaptureSessionEntity> findByStatus(String status);

    /**
     * List sessions for a (project, architecture) pair filtered by kind
     * (e.g. {@code 'current'} for the legacy current-state session list,
     * {@code 'target'} for the new target-side replay session list).
     * Newest first.
     */
    List<ApiBehaviourCaptureSessionEntity>
        findByProjectIdAndArchitectureIdAndKindOrderByCreatedAtDesc(
            UUID projectId, UUID architectureId, String kind);
}
