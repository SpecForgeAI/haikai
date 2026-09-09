package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.procbehaviour.ProcBehaviourBaselineEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/** Proc behaviour baselines (Stored Proc &amp; Function Behaviour Program, Spec 3). */
public interface ProcBehaviourBaselineRepository
        extends JpaRepository<ProcBehaviourBaselineEntity, UUID> {

    List<ProcBehaviourBaselineEntity> findByArchitectureIdOrderByCreatedAtDesc(UUID architectureId);

    /** The single pinned baseline for a kind -- ONE per (architecture, kind). */
    Optional<ProcBehaviourBaselineEntity> findFirstByArchitectureIdAndKindAndStatus(
        UUID architectureId, String kind, String status);
}
