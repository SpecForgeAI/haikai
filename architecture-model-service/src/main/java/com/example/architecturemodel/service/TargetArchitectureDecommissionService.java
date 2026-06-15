package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ArchitectureNotFoundException;
import com.example.architecturemodel.exception.ConflictException;
import com.example.architecturemodel.model.dto.MarkDecommissionedRequest;
import com.example.architecturemodel.model.dto.MarkDecommissionedResponse;
import com.example.architecturemodel.model.entity.ArchitectureElementMappingEntity;
import com.example.architecturemodel.model.entity.ArchitectureEntity;
import com.example.architecturemodel.repository.ArchitectureRepository;
import com.example.architecturemodel.repository.entity.ArchitectureElementMappingRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

/**
 * Writes a decommissioned target-side row + the matching
 * {@code architecture_element_mappings} row in a single atomic transaction.
 *
 * <p>Invoked from the unmapped-elements panel: the user clicks "mark
 * decommissioned" on a current-architecture element with no mapping into the
 * active target, and the service:</p>
 *
 * <ol>
 *   <li>Resolves the project's active target architecture (rejects with 422
 *       {@link ConflictException} when no active target exists -- the user
 *       must promote a draft first).</li>
 *   <li>Resolves the source element's parent FKs (application_id /
 *       service_id / etc.) so the new target-side row can be inserted with
 *       FKs that satisfy the supertype table's constraints.</li>
 *   <li>Resolves an existing model_file_id on the active target
 *       architecture so the new row joins the target's element inventory.</li>
 *   <li>Inserts a new row into the supertype table with
 *       {@code provenance='user-authored'} and
 *       {@code decommissioning_status='decommissioned'}.</li>
 *   <li>Inserts an {@code architecture_element_mappings} row with
 *       {@code mapping_type='decommissioned'},
 *       {@code createdByTask='unmapped-panel-mark-decom'}.</li>
 * </ol>
 *
 * <p>Both writes execute in a single {@code @Transactional} block so partial
 * state never persists.</p>
 *
 * <h3>Why the four supertypes are handled identically</h3>
 *
 * <p>The four supertype tables ({@code application_components},
 * {@code interfaces}, {@code data_entity_points},
 * {@code infrastructure_points}) all carry the same {@code provenance} +
 * {@code decommissioning_status} columns (changeset 145). Per-table FK
 * shape differs (application_components needs application_id;
 * interfaces needs service_id; data_entity_points needs point_kind +
 * one-of logical/physical entity FK; infrastructure_points needs
 * point_kind + the relevant FK) so the service builds the INSERT
 * statement per element type. The SELECT to harvest source FKs is
 * dynamically generated from the element type so the same code path
 * services all four tables.</p>
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
public class TargetArchitectureDecommissionService {

    /**
     * Supertype tables that participate in the target-arch authoring flow.
     * Mirrors {@code TargetArchitectureSeedService#ELEMENT_SUPERTYPE_TABLES}.
     */
    static final Set<String> ELEMENT_SUPERTYPE_TABLES = Set.of(
        "application_components",
        "interfaces",
        "data_entity_points",
        "infrastructure_points"
    );

    /** Status default applied to the new mapping row. Matches the seed-clone path. */
    static final String MAPPING_STATUS_DEFAULT = "active";

    private final ArchitectureRepository architectureRepository;
    private final ArchitectureElementMappingRepository mappingRepository;
    private final JdbcTemplate jdbcTemplate;

    public TargetArchitectureDecommissionService(
            ArchitectureRepository architectureRepository,
            ArchitectureElementMappingRepository mappingRepository,
            JdbcTemplate jdbcTemplate) {
        this.architectureRepository = architectureRepository;
        this.mappingRepository = mappingRepository;
        this.jdbcTemplate = jdbcTemplate;
    }

    /**
     * Marks a current-architecture element as decommissioned in the active
     * target architecture.
     *
     * @param projectId      the project the architectures belong to
     * @param targetArchId   id of the target architecture to insert the
     *                       new target-side row on (typically the project's
     *                       active target; the controller URL carries it
     *                       so the operation is explicit)
     * @param request        the source element identity + (optional)
     *                       source-architecture id
     * @return identifiers of the new target-side row + new mapping row
     * @throws ArchitectureNotFoundException when {@code targetArchId} is
     *         missing, cross-project, or not kind='target'
     * @throws ConflictException             when the target architecture is
     *         archived OR when the existing mapping pair already exists
     * @throws IllegalArgumentException      when the request body is
     *         malformed (missing currentElementId / currentElementType)
     */
    @Transactional
    public MarkDecommissionedResponse markDecommissioned(
            UUID projectId, UUID targetArchId, MarkDecommissionedRequest request) {
        Objects.requireNonNull(projectId, "projectId is required");
        Objects.requireNonNull(targetArchId, "targetArchId is required");
        Objects.requireNonNull(request, "request body is required");

        String currentElementId = request.currentElementId();
        String currentElementType = request.currentElementType();
        if (currentElementId == null || currentElementId.isBlank()) {
            throw new IllegalArgumentException("currentElementId is required");
        }
        if (currentElementType == null || currentElementType.isBlank()) {
            throw new IllegalArgumentException("currentElementType is required");
        }
        if (!ELEMENT_SUPERTYPE_TABLES.contains(currentElementType)) {
            throw new IllegalArgumentException(
                "currentElementType must be one of " + ELEMENT_SUPERTYPE_TABLES
                    + " (received: " + currentElementType + ")");
        }

        ArchitectureEntity targetArch = architectureRepository.findById(targetArchId)
            .orElseThrow(() -> new ArchitectureNotFoundException(
                "Architecture not found: " + targetArchId));
        if (!projectId.equals(targetArch.getProjectId())) {
            throw new ArchitectureNotFoundException(
                "Architecture " + targetArchId + " not found in project " + projectId);
        }
        if (Boolean.TRUE.equals(targetArch.getArchived())) {
            throw new ConflictException(
                "Cannot decommission against an archived target architecture: " + targetArchId);
        }
        if (!"target".equalsIgnoreCase(targetArch.getKind())) {
            throw new IllegalArgumentException(
                "Architecture " + targetArchId + " is not a target architecture (kind="
                    + targetArch.getKind() + ")");
        }

        // Resolve the source architecture id: either the caller supplies one,
        // or we use the project's canonical current architecture.
        UUID sourceArchId = request.currentArchitectureId();
        if (sourceArchId == null) {
            sourceArchId = architectureRepository
                .findFirstByProjectIdAndArchivedFalseOrderByCreatedAtAsc(projectId)
                .map(ArchitectureEntity::getId)
                .orElseThrow(() -> new ArchitectureNotFoundException(
                    "Project " + projectId + " has no current architecture to anchor the mapping"));
        }

        // Read the source element row (name + parent FKs) from the supertype
        // table. If the row is missing we cannot synthesise the target-side
        // row, so the call fails loudly.
        Map<String, Object> sourceRow = readSourceElementRow(currentElementType, currentElementId);

        // Resolve a model_file_id on the target architecture so the new row
        // joins the target's element inventory.
        String targetModelFileId = resolveTargetModelFileId(targetArchId);

        // Insert the new target-side row with provenance + decom flags.
        String newElementId = UUID.randomUUID().toString();
        insertTargetSideRow(currentElementType, newElementId, targetModelFileId, sourceRow);

        // Insert the mapping row.
        Instant now = Instant.now();
        ArchitectureElementMappingEntity mapping = ArchitectureElementMappingEntity.builder()
            .id(UUID.randomUUID())
            .projectId(projectId)
            .sourceArchitectureId(sourceArchId)
            .targetArchitectureId(targetArchId)
            .sourceElementType(currentElementType)
            .sourceElementId(currentElementId)
            .targetElementType(currentElementType)
            .targetElementId(newElementId)
            .mappingType(MarkDecommissionedRequest.MAPPING_TYPE_DECOMMISSIONED)
            .status(MAPPING_STATUS_DEFAULT)
            .createdByTask(MarkDecommissionedRequest.MARK_DECOM_CREATED_BY_TASK)
            .createdAt(now)
            .updatedAt(now)
            .build();
        ArchitectureElementMappingEntity saved = mappingRepository.saveAndFlush(mapping);

        log.info("mark-decommissioned: project={} targetArch={} sourceElement={}/{} newTargetElement={} mappingId={}",
            projectId, targetArchId, currentElementType, currentElementId,
            newElementId, saved.getId());

        return new MarkDecommissionedResponse(newElementId, currentElementType, saved.getId());
    }

    /**
     * Reads the source element row from the supertype table, returning the
     * name and any parent-FK columns the supertype requires. Throws when the
     * row is missing.
     */
    Map<String, Object> readSourceElementRow(String elementType, String elementId) {
        // SELECT * so we get every column the supertype defines; the per-table
        // INSERT below picks out the ones it needs.
        String sql = "SELECT * FROM " + elementType + " WHERE id = ?";
        List<Map<String, Object>> rows = jdbcTemplate.queryForList(sql, elementId);
        if (rows.isEmpty()) {
            throw new ArchitectureNotFoundException(
                "Element not found in table " + elementType + ": " + elementId);
        }
        return rows.get(0);
    }

    /**
     * Resolves a model_file_id on the target architecture (first row by
     * created_at). When the target has no model file yet, the service throws
     * 422: the active target was promoted but has no model files at all, which
     * is a data-integrity gap the user must surface before decommissioning.
     */
    String resolveTargetModelFileId(UUID targetArchId) {
        // The {@code WHERE architecture_id = ?} hit IS on model_files, the
        // canonical parent of the 53 element tables and explicitly
        // out-of-scope for the ArchitectureScopeResolver per spec
        // 2026-05-22-architecture-scope-via-parent-not-leaf — the leaf
        // architecture_id column on model_files IS the source of truth
        // for the architecture binding (it is owned by ModelFileEntity's
        // JPA-managed architectureId field, no parent chain to derive
        // from).
        List<Map<String, Object>> rows = jdbcTemplate.queryForList(
            "SELECT id FROM model_files WHERE architecture_id = ? ORDER BY id ASC LIMIT 1",
            targetArchId);
        if (rows.isEmpty()) {
            throw new ConflictException(
                "Target architecture " + targetArchId + " has no model files; cannot insert target-side row");
        }
        Object id = rows.get(0).get("id");
        if (id == null) {
            throw new ConflictException(
                "Target architecture " + targetArchId + " has a model_files row with NULL id");
        }
        return id.toString();
    }

    /**
     * Inserts a new row into the supertype table for the given element type.
     *
     * <p>Per-table INSERT shape (kept narrow on purpose -- only required
     * columns + the two authoring-metadata columns + name + description /
     * tags carried over from the source):</p>
     *
     * <ul>
     *   <li>{@code application_components}: (id, model_file_id, application_id,
     *       name, description, provenance, decommissioning_status)</li>
     *   <li>{@code interfaces}: (id, model_file_id, service_id, name,
     *       description, provenance, decommissioning_status)</li>
     *   <li>{@code data_entity_points}: (id, model_file_id, point_kind,
     *       logical_entity_id, physical_entity_id, description, provenance,
     *       decommissioning_status)</li>
     *   <li>{@code infrastructure_points}: (id, model_file_id, point_kind,
     *       name, description, provenance, decommissioning_status)</li>
     * </ul>
     */
    void insertTargetSideRow(
            String elementType,
            String newElementId,
            String targetModelFileId,
            Map<String, Object> sourceRow) {
        switch (elementType) {
            case "application_components":
                jdbcTemplate.update(
                    "INSERT INTO application_components "
                        + "(id, model_file_id, application_id, name, description, provenance, decommissioning_status) "
                        + "VALUES (?, ?, ?, ?, ?, ?, ?)",
                    newElementId,
                    targetModelFileId,
                    str(sourceRow.get("application_id")),
                    str(sourceRow.get("name")),
                    str(sourceRow.get("description")),
                    MarkDecommissionedRequest.PROVENANCE_USER_AUTHORED,
                    MarkDecommissionedRequest.DECOM_STATUS_DECOMMISSIONED);
                return;
            case "interfaces":
                jdbcTemplate.update(
                    "INSERT INTO interfaces "
                        + "(id, model_file_id, service_id, name, description, provenance, decommissioning_status) "
                        + "VALUES (?, ?, ?, ?, ?, ?, ?)",
                    newElementId,
                    targetModelFileId,
                    str(sourceRow.get("service_id")),
                    str(sourceRow.get("name")),
                    str(sourceRow.get("description")),
                    MarkDecommissionedRequest.PROVENANCE_USER_AUTHORED,
                    MarkDecommissionedRequest.DECOM_STATUS_DECOMMISSIONED);
                return;
            case "data_entity_points":
                jdbcTemplate.update(
                    "INSERT INTO data_entity_points "
                        + "(id, model_file_id, point_kind, logical_entity_id, physical_entity_id, description, provenance, decommissioning_status) "
                        + "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    newElementId,
                    targetModelFileId,
                    str(sourceRow.get("point_kind")),
                    str(sourceRow.get("logical_entity_id")),
                    str(sourceRow.get("physical_entity_id")),
                    str(sourceRow.get("description")),
                    MarkDecommissionedRequest.PROVENANCE_USER_AUTHORED,
                    MarkDecommissionedRequest.DECOM_STATUS_DECOMMISSIONED);
                return;
            case "infrastructure_points":
                jdbcTemplate.update(
                    "INSERT INTO infrastructure_points "
                        + "(id, model_file_id, point_kind, name, description, provenance, decommissioning_status) "
                        + "VALUES (?, ?, ?, ?, ?, ?, ?)",
                    newElementId,
                    targetModelFileId,
                    str(sourceRow.get("point_kind")),
                    str(sourceRow.get("name")),
                    str(sourceRow.get("description")),
                    MarkDecommissionedRequest.PROVENANCE_USER_AUTHORED,
                    MarkDecommissionedRequest.DECOM_STATUS_DECOMMISSIONED);
                return;
            default:
                throw new IllegalArgumentException(
                    "Unsupported element type: " + elementType);
        }
    }

    private static String str(Object value) {
        return value == null ? null : value.toString();
    }
}
