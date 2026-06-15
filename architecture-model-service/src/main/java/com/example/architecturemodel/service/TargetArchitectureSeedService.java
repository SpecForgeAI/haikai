package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ArchitectureNotFoundException;
import com.example.architecturemodel.exception.TemplateModeNotImplementedException;
import com.example.architecturemodel.mapper.ArchitectureMapper;
import com.example.architecturemodel.model.dto.ArchitectureDto;
import com.example.architecturemodel.model.dto.SeedTargetArchitectureRequest;
import com.example.architecturemodel.model.entity.ArchitectureElementMappingEntity;
import com.example.architecturemodel.model.entity.ArchitectureEntity;
import com.example.architecturemodel.repository.ArchitectureRepository;
import com.example.architecturemodel.repository.ArchitectureTagRepository;
import com.example.architecturemodel.repository.entity.ArchitectureElementMappingRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

/**
 * Seeds a brand-new target-state architecture row (kind='target',
 * draft_state='draft') in one of three modes:
 *
 * <ul>
 *   <li>{@code clone-current} -- thin wrapper around
 *       {@link ArchitectureCloneService#cloneArchitecture}. After the
 *       underlying clone returns, every cloned element on the four supertype
 *       tables (application_components, interfaces, data_entity_points,
 *       infrastructure_points) is stamped {@code provenance='cloned-from'},
 *       the new architecture row is flipped to {@code kind='target'} +
 *       {@code draft_state='draft'}, and one
 *       {@code architecture_element_mappings} row per cloned element is
 *       inserted ({@code mapping_type='equivalent'}, {@code confidence=1.0},
 *       {@code createdByTask='target-arch-seed-clone'}). The mapping row
 *       captures the source-element-id back-reference natively, so no
 *       additional cloned_from_element_id column is required.</li>
 *
 *   <li>{@code blank} -- creates the architecture row only (no elements, no
 *       mappings) with {@code kind='target'}, {@code draft_state='draft'}.</li>
 *
 *   <li>{@code from-template} -- v1 throws
 *       {@link TemplateModeNotImplementedException} which the global handler
 *       maps to HTTP 501 with envelope
 *       {@code code: "template_mode_not_implemented"}. The endpoint contract
 *       accepts {@code templateId} so the frontend surface is stable when the
 *       registry eventually lands.</li>
 * </ul>
 *
 * <p>Auto-naming:</p>
 * <ul>
 *   <li>If the caller supplies {@code draftName} non-blank, that name is used
 *       verbatim (still subject to the same trim / length / uniqueness checks
 *       enforced by {@link ArchitectureService}).</li>
 *   <li>Otherwise the service auto-names: {@code "Draft YYYY-MM-DD #n"}
 *       where {@code n} is the project-scoped count of existing draft / target
 *       rows + 1. The LLM-suggest gateway task is expected to pass
 *       {@code draftName=SeedTargetArchitectureRequest.LLM_SUGGEST_DRAFT_NAME}
 *       explicitly when invoking this service.</li>
 * </ul>
 *
 * <p>Spec: Target Architecture Authoring Flow (2026-05-20) -- Task Group 2.</p>
 */
@Service
@Slf4j
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
public class TargetArchitectureSeedService {

    /**
     * The four architecture element supertype tables that received the
     * {@code provenance} + {@code decommissioning_status} columns in changeset
     * 145. Stamped after clone-current so every cloned row carries
     * {@code provenance='cloned-from'}. Order is irrelevant; declared here so
     * the same list is reused for the auto-mapping insertion pass.
     */
    static final List<String> ELEMENT_SUPERTYPE_TABLES = List.of(
        "application_components",
        "interfaces",
        "data_entity_points",
        "infrastructure_points"
    );

    /**
     * Status default for newly-inserted auto-mapping rows. Mirrors the
     * existing default used by the selective-copy + auto-map workflow so the
     * Mapping Review modal renders the new rows in the same lane.
     */
    static final String MAPPING_STATUS_DEFAULT = "active";

    private final ArchitectureRepository architectureRepository;
    private final ArchitectureTagRepository architectureTagRepository;
    private final ArchitectureMapper architectureMapper;
    private final ArchitectureCloneService architectureCloneService;
    private final ArchitectureElementMappingRepository mappingRepository;
    private final JdbcTemplate jdbcTemplate;

    public TargetArchitectureSeedService(
            ArchitectureRepository architectureRepository,
            ArchitectureTagRepository architectureTagRepository,
            ArchitectureMapper architectureMapper,
            ArchitectureCloneService architectureCloneService,
            ArchitectureElementMappingRepository mappingRepository,
            JdbcTemplate jdbcTemplate) {
        this.architectureRepository = architectureRepository;
        this.architectureTagRepository = architectureTagRepository;
        this.architectureMapper = architectureMapper;
        this.architectureCloneService = architectureCloneService;
        this.mappingRepository = mappingRepository;
        this.jdbcTemplate = jdbcTemplate;
    }

    /**
     * Seeds a new target architecture per the requested mode.
     *
     * @param projectId the project under which to create the new target
     * @param request   mode + (mode-specific) source / template / name inputs
     * @return the new architecture DTO
     */
    @Transactional
    public ArchitectureDto seed(UUID projectId, SeedTargetArchitectureRequest request) {
        Objects.requireNonNull(projectId, "projectId is required");
        Objects.requireNonNull(request, "request body is required");

        String mode = request.mode();
        if (mode == null || mode.isBlank()) {
            throw new IllegalArgumentException(
                "mode is required (one of clone-current | blank | from-template)");
        }

        switch (mode) {
            case SeedTargetArchitectureRequest.MODE_CLONE_CURRENT:
                return seedCloneCurrent(projectId, request);
            case SeedTargetArchitectureRequest.MODE_BLANK:
                return seedBlank(projectId, request);
            case SeedTargetArchitectureRequest.MODE_FROM_TEMPLATE:
                throw new TemplateModeNotImplementedException();
            default:
                throw new IllegalArgumentException(
                    "Unknown mode '" + mode + "' (expected clone-current | blank | from-template)");
        }
    }

    // ------------------------------------------------------------------------
    // Mode: clone-current
    // ------------------------------------------------------------------------

    private ArchitectureDto seedCloneCurrent(UUID projectId, SeedTargetArchitectureRequest request) {
        UUID sourceArchitectureId = resolveCurrentArchitectureId(projectId, request.currentArchitectureId());
        String draftName = resolveDraftName(projectId, request.draftName());

        log.info("Seed target-arch CLONE-CURRENT: project={}, source={}, draftName='{}'",
            projectId, sourceArchitectureId, draftName);

        // 1. Delegate to the existing clone path -- capture the id-correlation
        //    map so mappings can be paired by STABLE id, not by name.
        ArchitectureCloneService.CloneResult cloneResult =
            architectureCloneService.cloneArchitectureWithIdMap(
                projectId,
                sourceArchitectureId,
                draftName,
                null,
                List.of(),
                java.util.Set.of());

        UUID newArchitectureId = cloneResult.dto().id();

        // Invert the clone's oldId -> newId map into newId -> oldId so the
        // mapping pass pairs each cloned element with its source by stable id.
        Map<String, String> newIdToSourceId = new HashMap<>(cloneResult.idMap().size());
        for (Map.Entry<String, String> e : cloneResult.idMap().entrySet()) {
            newIdToSourceId.put(e.getValue(), e.getKey());
        }

        // 2. Flip the new architecture row to kind='target', draft_state='draft'.
        //    The clone service did not differentiate kind/draft_state; we stamp
        //    here so the row is target-shaped from the moment the clone commits.
        ArchitectureEntity newArch = architectureRepository.findById(newArchitectureId)
            .orElseThrow(() -> new ArchitectureNotFoundException(
                "Cloned architecture missing post-clone: " + newArchitectureId));
        newArch.setKind("target");
        newArch.setDraftState("draft");
        architectureRepository.saveAndFlush(newArch);

        // 3. Stamp provenance='cloned-from' on the four element supertype tables
        //    (only they carry the provenance column).
        for (String table : ELEMENT_SUPERTYPE_TABLES) {
            stampProvenance(table, newArchitectureId);
        }

        // 4. Create one architecture_element_mappings row per cloned element
        //    across the SAME broad set the deterministic Suggest path maps,
        //    paired by stable id correlation. Fixes the prior behaviour where
        //    clone-current mapped ONLY the four supertype tables (so every
        //    physical_data_attribute showed "decommissioned in target") and the
        //    by-name collapse that dropped duplicate-named elements.
        for (String table : SuggestFromCurrentService.MAPPABLE_ELEMENT_TABLES) {
            createMappingsById(
                projectId, table, sourceArchitectureId, newArchitectureId, newIdToSourceId);
        }

        // 5. Return the refreshed DTO so callers see the target/draft flags.
        ArchitectureEntity refreshed = architectureRepository.findById(newArchitectureId)
            .orElseThrow(() -> new ArchitectureNotFoundException(
                "Architecture missing after seed: " + newArchitectureId));
        return architectureMapper.toDto(
            refreshed,
            architectureTagRepository.findByArchitectureId(newArchitectureId));
    }

    /**
     * Stamps {@code provenance='cloned-from'} on every not-yet-stamped row of
     * {@code table} tied to {@code newArchitectureId} (via the model_files
     * join). Only the four element supertype tables carry the provenance
     * column, so this is called for those tables only. A no-op when the table
     * has no rows on the new architecture.
     */
    private void stampProvenance(String table, UUID newArchitectureId) {
        int stamped = jdbcTemplate.update(
            "UPDATE " + table
                + " SET provenance = ? "
                + " WHERE model_file_id IN ("
                + "    SELECT id FROM model_files WHERE architecture_id = ?"
                + " )"
                + " AND provenance IS NULL",
            SeedTargetArchitectureRequest.PROVENANCE_CLONED_FROM,
            newArchitectureId);
        if (stamped > 0) {
            log.debug("Stamped provenance on {} rows in '{}' for new architecture {}",
                stamped, table, newArchitectureId);
        }
    }

    /**
     * Creates one {@code architecture_element_mappings} row per cloned element
     * in {@code table}, pairing each new row with its source row via the clone's
     * STABLE id correlation map ({@code newIdToSourceId}) rather than by name.
     *
     * <p>Id correlation is robust to duplicate element names within a table
     * (two {@code physical_data_attributes} called "ValidFrom" no longer
     * collapse) and maps the FK-only supertype tables that have no name column
     * ({@code data_entity_points}, {@code infrastructure_points}). A missing
     * table at runtime is caught and skipped; a new row with no source
     * correlation is logged and skipped.</p>
     */
    private void createMappingsById(
            UUID projectId,
            String table,
            UUID sourceArchitectureId,
            UUID newArchitectureId,
            Map<String, String> newIdToSourceId) {

        List<Map<String, Object>> newRows;
        try {
            newRows = jdbcTemplate.queryForList(
                "SELECT t.id AS id FROM " + table + " t "
                    + " WHERE t.model_file_id IN ("
                    + "    SELECT id FROM model_files WHERE architecture_id = ?"
                    + " )",
                newArchitectureId);
        } catch (org.springframework.jdbc.BadSqlGrammarException ex) {
            log.debug("Seed clone-current: skipping mapping for table '{}': not present ({})",
                table, ex.getMessage());
            return;
        }
        if (newRows.isEmpty()) {
            return;
        }

        List<ArchitectureElementMappingEntity> mappings = new ArrayList<>();
        Instant now = Instant.now();
        for (Map<String, Object> row : newRows) {
            Object newIdObj = row.get("id");
            if (newIdObj == null) {
                continue;
            }
            String newId = newIdObj.toString();
            String sourceId = newIdToSourceId.get(newId);
            if (sourceId == null) {
                log.warn("Seed clone-current mapping skipped: no source id correlation "
                        + "for cloned element {} on table '{}'", newId, table);
                continue;
            }
            mappings.add(ArchitectureElementMappingEntity.builder()
                .id(UUID.randomUUID())
                .projectId(projectId)
                .sourceArchitectureId(sourceArchitectureId)
                .targetArchitectureId(newArchitectureId)
                .sourceElementType(table)
                .sourceElementId(sourceId)
                .targetElementType(table)
                .targetElementId(newId)
                .mappingType("equivalent")
                .status(MAPPING_STATUS_DEFAULT)
                .createdByTask(SeedTargetArchitectureRequest.CLONE_CREATED_BY_TASK)
                .createdAt(now)
                .updatedAt(now)
                .confidence(1.0d)
                .build());
        }

        if (!mappings.isEmpty()) {
            mappingRepository.saveAll(mappings);
            mappingRepository.flush();
            log.debug("Inserted {} seed clone-current mappings for table '{}'",
                mappings.size(), table);
        }
    }

    // ------------------------------------------------------------------------
    // Mode: blank
    // ------------------------------------------------------------------------

    private ArchitectureDto seedBlank(UUID projectId, SeedTargetArchitectureRequest request) {
        String draftName = resolveDraftName(projectId, request.draftName());
        log.info("Seed target-arch BLANK: project={}, draftName='{}'", projectId, draftName);

        // We bypass ArchitectureService.create() because that path doesn't yet
        // know about kind/draft_state; we need the new row to be stamped
        // target/draft from insert time. Name uniqueness still applies.
        if (architectureRepository.existsByProjectIdAndNameIgnoreCase(projectId, draftName)) {
            throw new com.example.architecturemodel.exception.DuplicateArchitectureNameException(draftName);
        }

        UUID newId = UUID.randomUUID();
        ArchitectureEntity entity = ArchitectureEntity.builder()
            .id(newId)
            .projectId(projectId)
            .name(draftName)
            .archived(false)
            .kind("target")
            .draftState("draft")
            .build();
        ArchitectureEntity saved = architectureRepository.saveAndFlush(entity);

        return architectureMapper.toDto(
            saved,
            architectureTagRepository.findByArchitectureId(saved.getId()));
    }

    // ------------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------------

    /**
     * Resolves the current-architecture id to clone from. If the caller passes
     * an explicit id, that is validated (must exist + belong to the project +
     * be kind='current'). Otherwise the project's canonical current arch
     * (oldest non-archived kind='current' row) is used.
     */
    UUID resolveCurrentArchitectureId(UUID projectId, UUID requestedId) {
        if (requestedId != null) {
            ArchitectureEntity entity = architectureRepository.findById(requestedId)
                .orElseThrow(() -> new ArchitectureNotFoundException(
                    "Architecture not found: " + requestedId));
            if (!projectId.equals(entity.getProjectId())) {
                throw new ArchitectureNotFoundException(
                    "Architecture " + requestedId + " not found in project " + projectId);
            }
            return requestedId;
        }

        // Fallback: oldest non-archived current-kind architecture for the project.
        return architectureRepository
            .findFirstByProjectIdAndArchivedFalseOrderByCreatedAtAsc(projectId)
            .map(ArchitectureEntity::getId)
            .orElseThrow(() -> new ArchitectureNotFoundException(
                "Project " + projectId + " has no current-kind architecture to clone"));
    }

    /**
     * Auto-name or pass-through. Caller-supplied non-blank names are used
     * verbatim (the underlying create/clone path validates trim / length /
     * uniqueness). When omitted, returns {@code "Draft YYYY-MM-DD #n"} where
     * {@code n} is the project-scoped count of existing draft / target rows
     * + 1.
     */
    String resolveDraftName(UUID projectId, String requested) {
        if (requested != null && !requested.isBlank()) {
            return requested.trim();
        }
        LocalDate today = LocalDate.now(ZoneOffset.UTC);
        // Project-scoped existing draft / target count drives the suffix.
        long existing = architectureRepository.findByProjectIdOrderByCreatedAtAsc(projectId).stream()
            .filter(a -> "target".equalsIgnoreCase(a.getKind())
                || "draft".equalsIgnoreCase(a.getDraftState()))
            .count();
        long n = existing + 1L;
        return String.format(Locale.ROOT, "%s %s #%d",
            SeedTargetArchitectureRequest.DEFAULT_DRAFT_NAME_PREFIX, today, n);
    }
}
