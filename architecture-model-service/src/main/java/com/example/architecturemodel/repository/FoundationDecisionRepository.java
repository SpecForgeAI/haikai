package com.example.architecturemodel.repository;

import com.example.architecturemodel.model.entity.FoundationDecisionEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

/**
 * Spring Data repository for {@link FoundationDecisionEntity}.
 *
 * <p>Spec: Foundations &amp; Scope program, Spec 1 (2026-08-22).</p>
 */
@Repository
public interface FoundationDecisionRepository
        extends JpaRepository<FoundationDecisionEntity, String> {

    List<FoundationDecisionEntity>
        findByProjectIdAndArchitectureIdOrderByDecisionKeyAsc(
            String projectId, String architectureId);

    Optional<FoundationDecisionEntity>
        findByProjectIdAndArchitectureIdAndDecisionKey(
            String projectId, String architectureId, String decisionKey);
}
