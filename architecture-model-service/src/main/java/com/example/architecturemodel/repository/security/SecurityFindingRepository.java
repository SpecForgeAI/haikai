package com.example.architecturemodel.repository.security;

import com.example.architecturemodel.model.entity.security.SecurityFindingEntity;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.UUID;

/**
 * Repository for {@code security_findings} (Security health dashboard,
 * 2026-07-19, Spec 1 of 3).
 *
 * <p>{@link #search} is the parameterized Findings-Register query: every filter
 * is nullable (null = not applied), mirroring
 * {@code VulnerabilityRepository.search}. The {@code unmatched_only} axis is
 * expressed by passing {@code matchStatus='unmatched'}; deep-links from the
 * Overview diagram pass {@code applicationId}.</p>
 */
public interface SecurityFindingRepository
        extends JpaRepository<SecurityFindingEntity, UUID> {

    List<SecurityFindingEntity> findByReportId(UUID reportId);

    long countByReportId(UUID reportId);

    /**
     * Parameterized register search over one report's findings. Null filters
     * are skipped; {@code text} is a case-insensitive contains over title /
     * description / linking value / location.
     */
    @Query("""
        SELECT f FROM SecurityFindingEntity f
        WHERE f.reportId = :reportId
          AND (:applicationId IS NULL OR f.applicationId = :applicationId)
          AND (:matchStatus IS NULL OR f.matchStatus = :matchStatus)
          AND (:severity IS NULL OR f.severity = :severity)
          AND (:level IS NULL OR f.level = :level)
          AND (:text IS NULL
               OR LOWER(COALESCE(f.title, '')) LIKE LOWER(CONCAT('%', :text, '%'))
               OR LOWER(COALESCE(f.description, '')) LIKE LOWER(CONCAT('%', :text, '%'))
               OR LOWER(COALESCE(f.linkingValue, '')) LIKE LOWER(CONCAT('%', :text, '%'))
               OR LOWER(COALESCE(f.location, '')) LIKE LOWER(CONCAT('%', :text, '%')))
        """)
    Page<SecurityFindingEntity> search(@Param("reportId") UUID reportId,
                                       @Param("applicationId") String applicationId,
                                       @Param("matchStatus") String matchStatus,
                                       @Param("severity") String severity,
                                       @Param("level") String level,
                                       @Param("text") String text,
                                       Pageable pageable);

    /**
     * The Overview rollup: severity counts grouped by resolved application
     * (null {@code applicationId} = the Not-matched bucket). One query, counts
     * assembled in the service.
     */
    @Query("""
        SELECT f.applicationId, f.severity, COUNT(f)
        FROM SecurityFindingEntity f
        WHERE f.reportId = :reportId
        GROUP BY f.applicationId, f.severity
        """)
    List<Object[]> rollupByApplicationAndSeverity(@Param("reportId") UUID reportId);
}
