package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ArchitectureNotFoundException;
import com.example.architecturemodel.model.dto.UnmappedCurrentElementDto;
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
 * Computes the "unmapped current elements" gap powering the right-side
 * warning panel in the target-architecture authoring workspace.
 *
 * <p>For a given current-architecture id (the one the user is editing
 * mappings against), returns every element on the four architecture-element
 * supertype tables that has NO row in {@code architecture_element_mappings}
 * pointing at the project's active target.</p>
 *
 * <p>Per spec.md the panel lets the user either:</p>
 * <ul>
 *   <li>open a target element to add a mapping, or</li>
 *   <li>click "mark decommissioned" which creates a target-side row +
 *       mapping atomically (Task Group 4).</li>
 * </ul>
 *
 * <h3>Query shape</h3>
 * <p>Pure JDBC LEFT JOIN per element table; the result-set is the union of
 * the four LEFT-JOIN gaps. The query is project-scoped via the
 * {@code architecture_element_mappings.project_id} predicate so a noisy
 * project's mappings do not contaminate another project's gap report.</p>
 *
 * <p>When the project has no active target row, every current element is
 * unmapped by definition; the query returns the full current-arch element
 * inventory.</p>
 *
 * <p>Spec: Target Architecture Authoring Flow (2026-05-20) -- Task Group 3.</p>
 */
@Service
@Slf4j
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
public class UnmappedCurrentElementsService {

    /**
     * The four architecture element supertype tables (matches
     * {@link TargetArchitectureSeedService#ELEMENT_SUPERTYPE_TABLES}).
     */
    static final List<String> ELEMENT_SUPERTYPE_TABLES = List.of(
        "application_components",
        "interfaces",
        "data_entity_points",
        "infrastructure_points"
    );

    private final ArchitectureRepository architectureRepository;
    private final JdbcTemplate jdbcTemplate;

    public UnmappedCurrentElementsService(
            ArchitectureRepository architectureRepository,
            JdbcTemplate jdbcTemplate) {
        this.architectureRepository = architectureRepository;
        this.jdbcTemplate = jdbcTemplate;
    }

    /**
     * Returns the LEFT JOIN gap: every element on the supertype tables tied
     * to {@code currentArchitectureId} that has no
     * {@code architecture_element_mappings} row connecting it to the
     * project's active target.
     *
     * @param projectId             the project the architecture belongs to
     * @param currentArchitectureId the current-arch id being authored against
     * @return list of unmapped elements; never null, may be empty
     * @throws ArchitectureNotFoundException when the architecture is missing
     *         or belongs to a different project
     */
    @Transactional(readOnly = true)
    public List<UnmappedCurrentElementDto> findUnmapped(
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

        // Scope to the caller-supplied target draft (the draft the architect is
        // viewing) so the panel reflects THAT draft's mappings. When omitted,
        // fall back to the project's active target. When neither resolves there
        // is no target to compare against -> return empty (the UI shows its
        // "select / promote a draft" gate) rather than reporting EVERY current
        // element as unmapped (the old null-guard bug).
        UUID effectiveTargetId = targetArchitectureId != null
            ? targetArchitectureId
            : architectureRepository
                .findFirstByProjectIdAndKindAndDraftStateAndArchivedFalseOrderByCreatedAtDesc(
                    projectId, "target", "active")
                .map(ArchitectureEntity::getId)
                .orElse(null);

        log.debug(
            "unmapped-current-elements: project={}, currentArch={}, targetArch={}, effectiveTarget={}",
            projectId, currentArchitectureId, targetArchitectureId, effectiveTargetId);

        if (effectiveTargetId == null) {
            return new ArrayList<>();
        }

        List<UnmappedCurrentElementDto> out = new ArrayList<>();
        for (String table : ELEMENT_SUPERTYPE_TABLES) {
            out.addAll(queryUnmappedForTable(
                table, projectId, currentArchitectureId, effectiveTargetId));
        }
        return out;
    }

    /**
     * Per-table LEFT JOIN gap. The {@code architecture_element_mappings}
     * predicate is scoped to a single (non-null) target architecture id -- the
     * draft the architect is viewing (or the active target fallback). The
     * caller guarantees a non-null target, so the previous
     * {@code (? IS NULL OR ...)} guard (which wiped all mappings when no active
     * target existed) is gone.
     */
    private List<UnmappedCurrentElementDto> queryUnmappedForTable(
            String table,
            UUID projectId,
            UUID currentArchitectureId,
            UUID activeTargetId) {

        // Architecture-scope read path (per spec
        // 2026-05-22-architecture-scope-via-parent-not-leaf): rather than
        // filtering on the element table's leaf architecture_id column, the
        // predicate routes via the model_files parent chain — semantically
        // equivalent to ArchitectureScopeResolver.buildScopedWherePredicate,
        // inlined here because the surrounding LEFT-JOIN-style query is
        // already structured around the model_file_id subquery. The
        // {@code WHERE architecture_id = ?} hit IS on model_files (the
        // canonical parent table), which is out-of-scope for the resolver
        // map by design.
        String sql =
            "SELECT t.id AS element_id, t.name AS element_name "
            + " FROM " + table + " t "
            + " WHERE t.model_file_id IN ("
            + "    SELECT id FROM model_files WHERE architecture_id = ?"
            + " ) "
            + " AND NOT EXISTS ("
            + "    SELECT 1 FROM architecture_element_mappings m "
            + "    WHERE m.project_id = ? "
            + "      AND m.source_element_type = ? "
            + "      AND m.source_element_id = CAST(t.id AS varchar) "
            + "      AND m.target_architecture_id = ? "
            + " ) "
            + " ORDER BY t.name ASC, t.id ASC";

        List<Map<String, Object>> rows;
        try {
            rows = jdbcTemplate.queryForList(
                sql,
                currentArchitectureId,
                projectId,
                table,
                activeTargetId);
        } catch (Exception ex) {
            // Defensive: log and return empty for this table so a single
            // schema irregularity does not crash the whole panel.
            log.warn("unmapped-current-elements: query failed for table {}: {}",
                table, ex.getMessage());
            return List.of();
        }

        List<UnmappedCurrentElementDto> out = new ArrayList<>(rows.size());
        for (Map<String, Object> row : rows) {
            Object id = row.get("element_id");
            Object name = row.get("element_name");
            if (id == null) {
                continue;
            }
            out.add(new UnmappedCurrentElementDto(
                id.toString(),
                table,
                name == null ? null : name.toString()));
        }
        return out;
    }
}
