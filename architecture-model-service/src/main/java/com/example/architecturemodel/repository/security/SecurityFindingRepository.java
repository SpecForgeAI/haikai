package com.example.architecturemodel.repository.security;

import com.example.architecturemodel.model.entity.security.SecurityFindingEntity;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;
import java.util.UUID;

/**
 * Repository for {@code security_findings} (Security health dashboard,
 * 2026-07-19; entity_id generalization 2026-07-19 second wave).
 *
 * <p>{@link #search} is the parameterized Findings-Register query: every filter
 * is nullable (null = not applied), mirroring
 * {@code VulnerabilityRepository.search}. The {@code unmatched_only} axis is
 * expressed by passing {@code matchStatus='unmatched'}; deep-links from the
 * Overview diagram arrive as an application / component / service scope that
 * the service expands into the descendant {@code entityIds} set.</p>
 */
public interface SecurityFindingRepository
        extends JpaRepository<SecurityFindingEntity, UUID> {

    List<SecurityFindingEntity> findByReportId(UUID reportId);

    long countByReportId(UUID reportId);

    /**
     * Parameterized register search over one report's findings. Null filters
     * are skipped; {@code text} is a case-insensitive contains over title /
     * description / linking value / location.
     *
     * <p>Entity scoping is ANCESTOR-AWARE (changeset 213): the service expands
     * the requested application / component / service filter into the full
     * descendant {@code entityIds} set and passes it here.
     * {@code entityIdsEmpty=true} disables the entity filter -- the list must
     * then still be NON-EMPTY (a sentinel element), because Hibernate rejects
     * an empty IN list.</p>
     *
     * <p>The {@code CAST(:text AS STRING)} inside CONCAT is load-bearing on
     * PostgreSQL: a null bind parameter inside CONCAT has no inferable type
     * there ("function lower(bytea) does not exist" -&gt; HTTP 500 on the
     * no-filter register read), while the H2 test profile tolerates it.
     * Mirrors the same deliberate cast in
     * {@code VulnerabilityRepository.search}.</p>
     */
    @Query("""
        SELECT f FROM SecurityFindingEntity f
        WHERE f.reportId = :reportId
          AND (:entityIdsEmpty = TRUE OR f.entityId IN :entityIds)
          AND (:matchStatus IS NULL OR f.matchStatus = :matchStatus)
          AND (:severity IS NULL OR f.severity = :severity)
          AND (:level IS NULL OR f.level = :level)
          AND (
            :text IS NULL
            OR LOWER(COALESCE(f.title, '')) LIKE LOWER(CONCAT('%', CAST(:text AS STRING), '%'))
            OR LOWER(COALESCE(f.description, '')) LIKE LOWER(CONCAT('%', CAST(:text AS STRING), '%'))
            OR LOWER(COALESCE(f.linkingValue, '')) LIKE LOWER(CONCAT('%', CAST(:text AS STRING), '%'))
            OR LOWER(COALESCE(f.location, '')) LIKE LOWER(CONCAT('%', CAST(:text AS STRING), '%'))
          )
        """)
    Page<SecurityFindingEntity> search(@Param("reportId") UUID reportId,
                                       @Param("entityIdsEmpty") boolean entityIdsEmpty,
                                       @Param("entityIds") Collection<String> entityIds,
                                       @Param("matchStatus") String matchStatus,
                                       @Param("severity") String severity,
                                       @Param("level") String level,
                                       @Param("text") String text,
                                       Pageable pageable);

    /**
     * The Overview rollup: severity counts grouped by the finding's resolved
     * entity (changeset 213 -- level-generic; null {@code entityId} = the
     * Not-matched bucket). One query; name resolution and ancestor aggregation
     * happen in the service / frontend.
     */
    @Query("""
        SELECT f.entityId, f.severity, COUNT(f)
        FROM SecurityFindingEntity f
        WHERE f.reportId = :reportId
        GROUP BY f.entityId, f.severity
        """)
    List<Object[]> rollupByEntityAndSeverity(@Param("reportId") UUID reportId);
}
