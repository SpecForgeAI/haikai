package com.example.architecturemodel.repository.apibehaviour;

import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourBaselineEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

/**
 * Spring Data repository for {@link ApiBehaviourBaselineEntity}.
 *
 * <p>Spec: API Behaviour Baseline Capture Service (2026-05-15) — Task Group 1
 * (initial finders). API Test Harness — Target-Side Capture (2026-05-25) —
 * Task Group 1 ({@link #findByPairedWithBaselineId} + the kind-filtered
 * finder).</p>
 */
@Repository
public interface ApiBehaviourBaselineRepository
        extends JpaRepository<ApiBehaviourBaselineEntity, UUID> {

    /**
     * List baselines for a (project, architecture) pair, newest first.
     */
    List<ApiBehaviourBaselineEntity>
        findByProjectIdAndArchitectureIdOrderByCreatedAtDesc(
            UUID projectId, UUID architectureId);

    /**
     * List all baselines tied to a single capture session (e.g. multiple
     * draft baselines saved off the same run).
     */
    List<ApiBehaviourBaselineEntity>
        findBySessionIdOrderByCreatedAtAsc(UUID sessionId);

    /**
     * List target-side baselines paired with the given source current-state
     * baseline, newest first. Used by the pairing-read endpoint added in
     * Task Group 2 (Spec #5's diff UI is the eventual consumer).
     */
    List<ApiBehaviourBaselineEntity>
        findByPairedWithBaselineIdOrderByCreatedAtDesc(UUID pairedWithBaselineId);

    /**
     * List baselines for a (project, architecture) pair filtered by kind
     * (e.g. {@code 'current'} for the source-baseline picker in the target
     * replay wizard, {@code 'target'} for the diff UI). Newest first.
     */
    List<ApiBehaviourBaselineEntity>
        findByProjectIdAndArchitectureIdAndKindOrderByCreatedAtDesc(
            UUID projectId, UUID architectureId, String kind);
}
