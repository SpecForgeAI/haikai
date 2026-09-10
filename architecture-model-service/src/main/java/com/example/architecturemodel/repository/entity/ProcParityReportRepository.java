package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.procbehaviour.ProcParityReportEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Spring Data JPA Repository for {@link ProcParityReportEntity} -- the
 * proc-parity comparator reports (changeset 231, Stored Proc &amp; Function
 * Behaviour Program, Spec 4).
 *
 * <p>Two shapes of read: the LATEST report for one routine (the workbench row
 * verdict and the {@code PROC.REC.01} predicate) and the newest-first stream
 * for an architecture, which the controller folds into a latest-per-routine
 * map. Purpose / pack narrowing happens in the controller so the finder
 * surface stays small.</p>
 */
@Repository
public interface ProcParityReportRepository extends JpaRepository<ProcParityReportEntity, UUID> {

    /** Every report for an architecture, newest first (folded per routine). */
    List<ProcParityReportEntity> findByArchitectureIdOrderByCreatedAtDesc(UUID architectureId);

    /** The latest report for one routine, any purpose. */
    Optional<ProcParityReportEntity> findFirstByArchitectureIdAndRoutineIdOrderByCreatedAtDesc(
        UUID architectureId, UUID routineId);

    /** The latest report for one routine, narrowed to a purpose. */
    Optional<ProcParityReportEntity>
        findFirstByArchitectureIdAndRoutineIdAndPurposeOrderByCreatedAtDesc(
            UUID architectureId, UUID routineId, String purpose);
}
