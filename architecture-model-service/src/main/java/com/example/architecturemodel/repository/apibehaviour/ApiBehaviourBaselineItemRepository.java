package com.example.architecturemodel.repository.apibehaviour;

import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourBaselineItemEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

/**
 * Spring Data repository for {@link ApiBehaviourBaselineItemEntity}.
 *
 * <p>Spec: API Behaviour Baseline Capture Service (2026-05-15) — Task Group 1</p>
 */
@Repository
public interface ApiBehaviourBaselineItemRepository
        extends JpaRepository<ApiBehaviourBaselineItemEntity, UUID> {

    /**
     * List baseline items in stable insertion order.
     */
    List<ApiBehaviourBaselineItemEntity>
        findByBaselineIdOrderByCreatedAtAsc(UUID baselineId);
}
