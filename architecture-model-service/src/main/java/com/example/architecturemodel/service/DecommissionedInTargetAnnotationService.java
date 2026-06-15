package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ArchitectureNotFoundException;
import com.example.architecturemodel.model.dto.DecommissionedInTargetAnnotationDto;
import com.example.architecturemodel.model.entity.ArchitectureEntity;
import com.example.architecturemodel.repository.ArchitectureRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

/**
 * Computes the DERIVED "decommissioned in target" annotation on
 * current-architecture elements.
 *
 * <p>Per spec.md the current architecture has no
 * {@code decommissioning_status} column of its own -- decommissioning is
 * target-side only. The frontend nevertheless needs to surface a "this
 * current element is decommissioned in the active target" chip on each
 * affected row. This service computes that chip at read time using two
 * conditions:</p>
 *
 * <ol>
 *   <li><b>No mapping to active target:</b> the current element has zero
 *       {@code architecture_element_mappings} rows pointing into the active
 *       target. (Same gap surfaced by
 *       {@link UnmappedCurrentElementsService}, but rendered as a
 *       "decommissioned" chip rather than an "unmapped" panel row.)</li>
 *   <li><b>All mappings decommissioned:</b> the current element HAS at least
 *       one mapping into the active target, but EVERY such target-side row
 *       has {@code decommissioning_status='decommissioned'}.</li>
 * </ol>
 *
 * <p><b>Endpoint placement decision (sub-task 4.3):</b> implemented as a
 * sibling endpoint
 * {@code GET /api/projects/{projectId}/architectures/{archId}/decommissioned-in-target-annotations}
 * rather than extending {@code unmapped-current-elements}. The two contracts
 * answer distinct questions (see DTO header) and the SQL paths differ
 * enough that keeping them separate avoids overloading the simpler
 * endpoint.</p>
 *
 * <p>When the project has no active target architecture, EVERY current
 * element is "no-mapping-to-active-target" by definition: the endpoint
 * returns the full inventory in that case.</p>
 *
 * <p>Spec: Target Architecture Authoring Flow (2026-05-20) -- Task Group 4.</p>
 */
@Service
@Slf4j
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
public class DecommissionedInTargetAnnotationService {

    /** Mirrors {@link UnmappedCurrentElementsService#ELEMENT_SUPERTYPE_TABLES}. */
    static final List<String> ELEMENT_SUPERTYPE_TABLES = List.of(
        "application_components",
        "interfaces",
        "data_entity_points",
        "infrastructure_points"
    );

    private final ArchitectureRepository architectureRepository;
    private final JdbcTemplate jdbcTemplate;

    public DecommissionedInTargetAnnotationService(
            ArchitectureRepository architectureRepository,
            JdbcTemplate jdbcTemplate) {
        this.architectureRepository = architectureRepository;
        this.jdbcTemplate = jdbcTemplate;
    }

    /**
     * Computes the derived annotation list for a current architecture.
     *
     * @param projectId             the project the architecture belongs to
     * @param currentArchitectureId the current-architecture id to compute
     *                              annotations against
     * @return list of annotations; never null, may be empty
     * @throws ArchitectureNotFoundException when the architecture is missing
     *         or belongs to a different project
     */
    @Transactional(readOnly = true)
    public List<DecommissionedInTargetAnnotationDto> findAnnotations(
            UUID projectId, UUID currentArchitectureId, UUID targetArchitectureId) {
        Objects.requireNonNull(projectId, "projectId is required");
        Objects.requireNonNull(currentArchitectureId, "currentArchitectureId is required");

        ArchitectureEntity arch = architectureRepository.findById(currentArchitectureId)
            .orElseThrow(() -> new ArchitectureNotFoundException(
                "Architecture not found: " + currentArchitectureId));
        if (!projectId.equals(arch.getProjectId())) {
            throw new ArchitectureNotFoundException(
                "Architecture " + currentArchitectureId
                    + " not found in project " + projectId);
        }

        // Scope to the caller-supplied target draft (the draft being viewed),
        // else fall back to the active target. When neither resolves there is no
        // target to compare against -> return empty rather than annotating EVERY
        // current element "decommissioned in target" (the old null-guard bug).
        UUID effectiveTargetId = targetArchitectureId != null
            ? targetArchitectureId
            : architectureRepository
                .findFirstByProjectIdAndKindAndDraftStateAndArchivedFalseOrderByCreatedAtDesc(
                    projectId, "target", "active")
                .map(ArchitectureEntity::getId)
                .orElse(null);

        log.debug("decommissioned-in-target-annotations: project={}, currentArch={}, targetArch={}, effectiveTarget={}",
            projectId, currentArchitectureId, targetArchitectureId, effectiveTargetId);

        if (effectiveTargetId == null) {
            return new ArrayList<>();
        }

        List<DecommissionedInTargetAnnotationDto> out = new ArrayList<>();
        for (String table : ELEMENT_SUPERTYPE_TABLES) {
            out.addAll(annotationsForTable(
                table, projectId, currentArchitectureId, effectiveTargetId));
        }
        return out;
    }

    /**
     * Per-table query that returns the annotated rows for a single
     * supertype table. Uses a single SQL statement that classifies each row
     * by the reason vocabulary (no mapping vs. all-mappings-decommissioned).
     *
     * <p>When {@code activeTargetId} is null, every current element on the
     * table is "no-mapping-to-active-target". The {@code activeTargetId IS
     * NULL OR ...} guard mirrors the same null-handling that
     * {@link UnmappedCurrentElementsService} uses.</p>
     */
    private List<DecommissionedInTargetAnnotationDto> annotationsForTable(
            String table,
            UUID projectId,
            UUID currentArchitectureId,
            UUID activeTargetId) {

        String sql =
            "SELECT t.id AS element_id, "
            + "       t.name AS element_name, "
            + "       (SELECT COUNT(*) FROM architecture_element_mappings m "
            + "         WHERE m.project_id = ? "
            + "           AND m.source_element_type = ? "
            + "           AND m.source_element_id = CAST(t.id AS varchar) "
            + "           AND m.target_architecture_id = ?"
            + "       ) AS total_mappings, "
            + "       (SELECT COUNT(*) FROM architecture_element_mappings m "
            + "          JOIN " + table + " tgt ON tgt.id = m.target_element_id "
            + "         WHERE m.project_id = ? "
            + "           AND m.source_element_type = ? "
            + "           AND m.source_element_id = CAST(t.id AS varchar) "
            + "           AND m.target_architecture_id = ? "
            + "           AND tgt.decommissioning_status = 'decommissioned' "
            + "       ) AS decommissioned_mappings "
            + " FROM " + table + " t "
            + " WHERE t.model_file_id IN ( "
            + "    SELECT id FROM model_files WHERE architecture_id = ? "
            + " ) "
            + " ORDER BY t.name ASC, t.id ASC";

        List<Map<String, Object>> rows;
        try {
            rows = jdbcTemplate.queryForList(
                sql,
                projectId, table, activeTargetId,
                projectId, table, activeTargetId,
                currentArchitectureId);
        } catch (Exception ex) {
            log.warn("decommissioned-in-target-annotations: query failed for table {}: {}",
                table, ex.getMessage());
            return List.of();
        }

        List<DecommissionedInTargetAnnotationDto> out = new ArrayList<>(rows.size());
        for (Map<String, Object> row : rows) {
            Object id = row.get("element_id");
            Object name = row.get("element_name");
            long total = toLong(row.get("total_mappings"));
            long decommissioned = toLong(row.get("decommissioned_mappings"));
            if (id == null) {
                continue;
            }
            String reason;
            if (total == 0) {
                reason = DecommissionedInTargetAnnotationDto.REASON_NO_MAPPING;
            } else if (decommissioned == total) {
                reason = DecommissionedInTargetAnnotationDto.REASON_ALL_DECOMMISSIONED;
            } else {
                // Element has at least one non-decommissioned mapping into
                // the active target -- it is NOT decommissioned-in-target.
                continue;
            }
            out.add(new DecommissionedInTargetAnnotationDto(
                id.toString(),
                table,
                name == null ? null : name.toString(),
                reason));
        }
        return out;
    }

    private static long toLong(Object value) {
        if (value == null) {
            return 0L;
        }
        if (value instanceof Number n) {
            return n.longValue();
        }
        try {
            return Long.parseLong(value.toString());
        } catch (NumberFormatException ignored) {
            return 0L;
        }
    }
}
