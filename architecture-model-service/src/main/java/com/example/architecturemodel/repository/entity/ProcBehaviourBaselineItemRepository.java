package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.procbehaviour.ProcBehaviourBaselineItemEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

/** Proc behaviour baseline items (Stored Proc &amp; Function Behaviour Program, Spec 3). */
public interface ProcBehaviourBaselineItemRepository
        extends JpaRepository<ProcBehaviourBaselineItemEntity, UUID> {

    List<ProcBehaviourBaselineItemEntity> findByBaselineId(UUID baselineId);

    List<ProcBehaviourBaselineItemEntity> findByBaselineIdAndRoutineId(UUID baselineId, UUID routineId);
}
