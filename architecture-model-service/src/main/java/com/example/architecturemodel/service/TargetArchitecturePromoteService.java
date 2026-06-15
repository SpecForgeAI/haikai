package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ArchitectureNotFoundException;
import com.example.architecturemodel.exception.ConflictException;
import com.example.architecturemodel.mapper.ArchitectureMapper;
import com.example.architecturemodel.model.dto.ArchitectureDto;
import com.example.architecturemodel.model.dto.MarkStaleResponse;
import com.example.architecturemodel.model.dto.PromoteTargetArchitectureResponse;
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

import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

/**
 * Promotes a draft target architecture to active and demotes the prior
 * active target to {@code draft_state='draft'} with a "(superseded YYYY-MM-DD)"
 * suffix on the renamed row.
 *
 * <p><b>Returns an impact-preview count</b>: the number of
 * {@code migration_story_spec_generations} rows that the promote transition
 * marked stale. The UI confirm modal renders this number BEFORE the user
 * confirms; per spec.md the preview MUST equal the actual stale-marked count
 * when no concurrent writes intervene (the same endpoint computes both -- no
 * dry-run round trip).</p>
 *
 * <h3>Changed-element set</h3>
 * <p>The changed-element set is computed from
 * {@code architecture_element_mappings}: every source-element-id that has a
 * mapping into the PRIOR active target but a different (or missing) mapping
 * into the NEW active target. When no prior active target exists, the
 * changed set is the set of source-element-ids covered by the new active's
 * mappings (every spec referencing those elements becomes stale because
 * mappings just appeared).</p>
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
public class TargetArchitecturePromoteService {

    static final String SUPERSEDED_SUFFIX_PREFIX = " (superseded ";
    static final String SUPERSEDED_SUFFIX_SUFFIX = ")";

    /**
     * The four user-visible supertype tables surfaced by the Mark-Decommissioned
     * UX and the only tables counted by {@link #aggregateElementCounts(List)}.
     * Mirrors the constant of the same name on
     * {@link TargetArchitectureDecommissionService} -- kept in lock-step by hand
     * (the Four-Spec Hardening Pass spec deliberately scopes the count to the
     * four supertype tables, per Q2 override option b).
     */
    static final List<String> ELEMENT_COUNT_SUPERTYPE_TABLES = List.of(
        "application_components",
        "interfaces",
        "data_entity_points",
        "infrastructure_points"
    );

    private final ArchitectureRepository architectureRepository;
    private final ArchitectureTagRepository architectureTagRepository;
    private final ArchitectureMapper architectureMapper;
    private final ArchitectureElementMappingRepository mappingRepository;
    private final TargetArchitectureStaleMarkService staleMarkService;
    private final JdbcTemplate jdbcTemplate;

    public TargetArchitecturePromoteService(
            ArchitectureRepository architectureRepository,
            ArchitectureTagRepository architectureTagRepository,
            ArchitectureMapper architectureMapper,
            ArchitectureElementMappingRepository mappingRepository,
            TargetArchitectureStaleMarkService staleMarkService,
            JdbcTemplate jdbcTemplate) {
        this.architectureRepository = architectureRepository;
        this.architectureTagRepository = architectureTagRepository;
        this.architectureMapper = architectureMapper;
        this.mappingRepository = mappingRepository;
        this.staleMarkService = staleMarkService;
        this.jdbcTemplate = jdbcTemplate;
    }

    /**
     * Promote the requested draft target to active.
     *
     * @param projectId      the project the architecture belongs to
     * @param targetArchId   the draft target architecture id to promote
     * @return updated DTO + impact-preview count
     * @throws ArchitectureNotFoundException when the architecture id is missing
     *         or belongs to a different project
     * @throws IllegalArgumentException      when the architecture is not a
     *         {@code kind='target'} row, or is already active
     */
    @Transactional
    public PromoteTargetArchitectureResponse promote(UUID projectId, UUID targetArchId) {
        Objects.requireNonNull(projectId, "projectId is required");
        Objects.requireNonNull(targetArchId, "targetArchId is required");

        ArchitectureEntity draft = loadInProject(projectId, targetArchId);
        if (!"target".equalsIgnoreCase(draft.getKind())) {
            throw new IllegalArgumentException(
                "Architecture " + targetArchId + " is not a target architecture (kind="
                    + draft.getKind() + ")");
        }
        if ("active".equalsIgnoreCase(draft.getDraftState())) {
            throw new IllegalArgumentException(
                "Architecture " + targetArchId + " is already the active target");
        }

        // Resolve the prior active target (if any).
        ArchitectureEntity priorActive = architectureRepository
            .findFirstByProjectIdAndKindAndDraftStateAndArchivedFalseOrderByCreatedAtDesc(
                projectId, "target", "active")
            .orElse(null);

        // Compute the changed-element set BEFORE the transition so the
        // returned count matches what the UI saw on preview.
        Set<String> changedElementIds = computeChangedElementIds(
            projectId,
            priorActive == null ? null : priorActive.getId(),
            targetArchId);

        log.info(
            "promote: project={}, draftToPromote={}, priorActive={}, changedElementCount={}",
            projectId, targetArchId,
            priorActive == null ? null : priorActive.getId(),
            changedElementIds.size());

        // Demote the prior active to draft + rename it with the suffix.
        UUID priorActiveId = null;
        if (priorActive != null) {
            priorActiveId = priorActive.getId();
            renameWithSupersededSuffix(projectId, priorActive);
            priorActive.setDraftState("draft");
            architectureRepository.save(priorActive);
        }

        // Promote the draft to active.
        draft.setDraftState("active");
        ArchitectureEntity saved = architectureRepository.save(draft);

        // Fire the stale-mark (always on promote).
        MarkStaleResponse markResult = staleMarkService.markStaleForPromote(
            projectId,
            saved.getId(),
            changedElementIds);

        ArchitectureDto dto = architectureMapper.toDto(
            saved,
            architectureTagRepository.findByArchitectureId(saved.getId()));

        return new PromoteTargetArchitectureResponse(
            dto, priorActiveId, markResult.markedCount());
    }

    /**
     * Dry-run companion to {@link #promote(UUID, UUID)}.
     *
     * <p>Computes the impact-preview count WITHOUT committing the promote
     * transition. The UI confirm modal calls this to render
     * "Promoting this draft will mark N specs stale. Continue?" BEFORE the
     * user clicks Promote. Per spec, when no concurrent writes intervene the
     * preview count equals the actual stale-marked count returned by
     * {@link #promote(UUID, UUID)} on the subsequent confirm call.</p>
     *
     * <p>Runs under {@code @Transactional(readOnly = true)}: same validation
     * surface as the commit path (kind, draft_state, project scope), but no
     * row mutation.</p>
     *
     * @param projectId      the project the architecture belongs to
     * @param targetArchId   the draft target architecture id to preview
     * @return DTO of the draft (unchanged) + computed impact-preview count
     * @throws ArchitectureNotFoundException when the architecture id is missing
     *         or belongs to a different project
     * @throws IllegalArgumentException      when the architecture is not a
     *         {@code kind='target'} row, or is already active
     */
    @Transactional(readOnly = true)
    public PromoteTargetArchitectureResponse previewPromote(UUID projectId, UUID targetArchId) {
        Objects.requireNonNull(projectId, "projectId is required");
        Objects.requireNonNull(targetArchId, "targetArchId is required");

        ArchitectureEntity draft = loadInProject(projectId, targetArchId);
        if (!"target".equalsIgnoreCase(draft.getKind())) {
            throw new IllegalArgumentException(
                "Architecture " + targetArchId + " is not a target architecture (kind="
                    + draft.getKind() + ")");
        }
        if ("active".equalsIgnoreCase(draft.getDraftState())) {
            throw new IllegalArgumentException(
                "Architecture " + targetArchId + " is already the active target");
        }

        ArchitectureEntity priorActive = architectureRepository
            .findFirstByProjectIdAndKindAndDraftStateAndArchivedFalseOrderByCreatedAtDesc(
                projectId, "target", "active")
            .orElse(null);

        Set<String> changedElementIds = computeChangedElementIds(
            projectId,
            priorActive == null ? null : priorActive.getId(),
            targetArchId);

        int previewCount = staleMarkService.countSpecsCoveringElements(
            projectId, changedElementIds);

        ArchitectureDto dto = architectureMapper.toDto(
            draft,
            architectureTagRepository.findByArchitectureId(draft.getId()));

        log.info(
            "previewPromote: project={}, draftToPromote={}, priorActive={}, "
                + "changedElementCount={}, previewSpecsCount={}",
            projectId, targetArchId,
            priorActive == null ? null : priorActive.getId(),
            changedElementIds.size(), previewCount);

        return new PromoteTargetArchitectureResponse(
            dto, priorActive == null ? null : priorActive.getId(), previewCount);
    }

    /**
     * Soft-delete a target architecture by setting {@code archived=true}.
     * Rejected with 409 when the architecture is the current active target.
     *
     * @param projectId    the project the architecture belongs to
     * @param targetArchId the target architecture id to delete
     * @throws ArchitectureNotFoundException when missing / cross-project
     * @throws ConflictException             when {@code draft_state='active'}
     * @throws IllegalArgumentException      when not {@code kind='target'}
     */
    @Transactional
    public void delete(UUID projectId, UUID targetArchId, boolean force) {
        Objects.requireNonNull(projectId, "projectId is required");
        Objects.requireNonNull(targetArchId, "targetArchId is required");

        ArchitectureEntity arch = loadInProject(projectId, targetArchId);
        if (!"target".equalsIgnoreCase(arch.getKind())) {
            throw new IllegalArgumentException(
                "Architecture " + targetArchId + " is not a target architecture");
        }
        boolean isActive = "active".equalsIgnoreCase(arch.getDraftState());
        if (isActive && !force) {
            // Default guard: the active target is referenced by downstream
            // surfaces, so deleting it is a deliberate act. The caller can pass
            // force=true (the UI confirms first) to clear it anyway -- needed to
            // wipe a project's target proposals and start over.
            throw new ConflictException(
                "Cannot delete the active target architecture; promote another draft "
                    + "first, or delete with force=true to clear it.");
        }
        if (isActive) {
            // Force-deleting the active target: drop its active flag too so no
            // archived row is left claiming 'active'. (The active-target resolver
            // already filters archived rows, but this keeps the state clean -- the
            // project simply has no active target until the user promotes one.)
            arch.setDraftState("draft");
        }
        arch.setArchived(true);
        architectureRepository.save(arch);
        log.info("Soft-deleted target architecture {} in project {} (wasActive={}, force={})",
            targetArchId, projectId, isActive, force);
    }

    /**
     * Lists every {@code kind='target'} architecture row in the project,
     * active-first then most-recent.
     *
     * <p><b>Four-Spec Hardening Pass (2026-05-25), Item 3:</b> populates the
     * new {@code elementCount} field on each returned DTO by issuing four
     * grouped SQL queries (one per user-visible supertype table) keyed on the
     * parent {@code model_files.architecture_id IN (:draftIds)}. The four
     * counts are aggregated in service code into a single {@code Long} per
     * draft.</p>
     *
     * <p>The count is routed through the canonical parent chain (JOIN
     * {@code model_files}) via {@link ArchitectureScopeResolver}, NOT the leaf
     * {@code architecture_id} column. This matters because
     * {@code infrastructure_points} (added by changesets 098..123, after the
     * changeset-089 {@code architecture_id} rollout) has <b>no
     * {@code architecture_id} column at all</b> — a leaf-column GROUP BY
     * raised {@code column "architecture_id" does not exist} on PostgreSQL.
     * The parent-chain form is uniformly correct for all four supertype tables
     * (every one carries {@code model_file_id}) and is drift-proof, matching
     * the read-path philosophy documented on {@link ArchitectureScopeResolver}.</p>
     */
    @Transactional(readOnly = true)
    public List<ArchitectureDto> listTargets(UUID projectId) {
        Objects.requireNonNull(projectId, "projectId is required");
        // Defensive mutable copy: the repository finder can hand back an
        // immutable List (and test mocks return List.of(...)), which the
        // in-place sort below would reject with UnsupportedOperationException.
        // Exclude soft-deleted (archived) rows so a "Delete" actually hides the
        // draft -- the finder itself does not filter on archived.
        List<ArchitectureEntity> rows = new ArrayList<>(architectureRepository
            .findByProjectIdAndKindOrderByCreatedAtDesc(projectId, "target")
            .stream()
            .filter(a -> !Boolean.TRUE.equals(a.getArchived()))
            .toList());
        // Active-first sort on top of the most-recent ordering.
        rows.sort((a, b) -> {
            boolean aActive = "active".equalsIgnoreCase(a.getDraftState());
            boolean bActive = "active".equalsIgnoreCase(b.getDraftState());
            if (aActive && !bActive) return -1;
            if (!aActive && bActive) return 1;
            return b.getCreatedAt().compareTo(a.getCreatedAt());
        });

        // Aggregate the per-draft element counts via the four grouped queries
        // (one per supertype table). Empty input list short-circuits so the
        // JDBC layer never receives an "IN ()" expression.
        List<UUID> draftIds = new ArrayList<>(rows.size());
        for (ArchitectureEntity row : rows) {
            draftIds.add(row.getId());
        }
        Map<UUID, Long> countsByArchId = aggregateElementCounts(draftIds);

        List<ArchitectureDto> out = new ArrayList<>(rows.size());
        for (ArchitectureEntity row : rows) {
            ArchitectureDto base = architectureMapper.toDto(
                row, architectureTagRepository.findByArchitectureId(row.getId()));
            // The mapper produces a 10-arg DTO (elementCount=null via the
            // backward-compatible constructor); copy it into the canonical
            // 11-arg form with the aggregated count.
            Long elementCount = countsByArchId.getOrDefault(row.getId(), 0L);
            out.add(new ArchitectureDto(
                base.id(),
                base.projectId(),
                base.name(),
                base.description(),
                base.tags(),
                base.archived(),
                base.kind(),
                base.draftState(),
                base.createdAt(),
                base.updatedAt(),
                elementCount
            ));
        }
        return out;
    }

    /**
     * Counts elements across the four user-visible supertype tables for the
     * supplied draft architecture ids.
     *
     * <p>Issues exactly four grouped SQL queries (one per supertype table),
     * each built by {@link ArchitectureScopeResolver#buildScopedGroupedCountClause}
     * of the form
     * {@code SELECT p.architecture_id, COUNT(*) FROM <table> t JOIN model_files p ON p.id = t.model_file_id WHERE p.architecture_id IN (?...) GROUP BY p.architecture_id},
     * and sums the per-table counts in service code keyed by
     * {@code architecture_id} into a single {@code Long} per draft.</p>
     *
     * <p>Returns an empty map when {@code draftIds} is empty so the JDBC
     * layer never receives a malformed {@code IN ()} expression.</p>
     *
     * @param draftIds the draft architecture ids whose elements are being counted
     * @return map from architecture id to the per-architecture element count
     *         (sum across the four supertype tables; never negative)
     */
    Map<UUID, Long> aggregateElementCounts(List<UUID> draftIds) {
        if (draftIds == null || draftIds.isEmpty()) {
            return Collections.emptyMap();
        }
        // Bind the draft architecture ids once -- shared by all four queries.
        Object[] bindArgs = new Object[draftIds.size()];
        for (int i = 0; i < draftIds.size(); i++) {
            bindArgs[i] = draftIds.get(i);
        }

        Map<UUID, Long> totals = new HashMap<>();
        for (String table : ELEMENT_COUNT_SUPERTYPE_TABLES) {
            // Route the grouped count through the canonical parent chain
            // (JOIN model_files) via ArchitectureScopeResolver rather than the
            // leaf architecture_id column. infrastructure_points (changesets
            // 098..123) has NO architecture_id column at all, so a leaf-column
            // GROUP BY raised "column architecture_id does not exist" on
            // PostgreSQL; the parent-chain form is uniformly correct for all
            // four supertype tables (every one carries model_file_id).
            String sql = ArchitectureScopeResolver.buildScopedGroupedCountClause(
                table, draftIds.size());
            jdbcTemplate.query(sql, (java.sql.ResultSet rs) -> {
                Object raw = rs.getObject("architecture_id");
                if (raw == null) {
                    return;
                }
                UUID archId = raw instanceof UUID
                    ? (UUID) raw
                    : UUID.fromString(raw.toString());
                long count = rs.getLong(2);
                totals.merge(archId, count, Long::sum);
            }, bindArgs);
        }
        return totals;
    }

    // -----------------------------------------------------------------------
    // Internal helpers
    // -----------------------------------------------------------------------

    /**
     * Computes the set of source-element-ids whose mapping target differs
     * between the prior active target and the new active target.
     *
     * <p>When the prior active target is null, the changed set is every
     * source-element-id covered by mappings into the new active target
     * (effectively: every element gained a mapping).</p>
     *
     * <p>The changed set is the keyspace passed to the stale-mark pipeline;
     * a spec referencing any of these element ids becomes stale.</p>
     */
    Set<String> computeChangedElementIds(
            UUID projectId,
            UUID priorActiveId,
            UUID newActiveId) {

        // Find all mappings into the NEW active target.
        List<ArchitectureElementMappingEntity> newMappings = mappingRepository.search(
            projectId, null, newActiveId, null, null, null, null, null);

        // Map source-element-id -> target-element-id on the NEW active.
        Map<String, String> newByElement = new HashMap<>();
        for (ArchitectureElementMappingEntity m : newMappings) {
            if (m.getSourceElementId() != null) {
                newByElement.put(m.getSourceElementId(), m.getTargetElementId());
            }
        }

        if (priorActiveId == null) {
            // No prior active: every source element covered by the new
            // mappings is a "changed" element (it had no mapping before).
            return new HashSet<>(newByElement.keySet());
        }

        // Find all mappings into the PRIOR active target.
        List<ArchitectureElementMappingEntity> priorMappings = mappingRepository.search(
            projectId, null, priorActiveId, null, null, null, null, null);

        Map<String, String> priorByElement = new HashMap<>();
        for (ArchitectureElementMappingEntity m : priorMappings) {
            if (m.getSourceElementId() != null) {
                priorByElement.put(m.getSourceElementId(), m.getTargetElementId());
            }
        }

        Set<String> changed = new HashSet<>();
        // Elements with a different target in new vs prior.
        for (Map.Entry<String, String> e : newByElement.entrySet()) {
            String priorTarget = priorByElement.get(e.getKey());
            if (priorTarget == null || !priorTarget.equals(e.getValue())) {
                changed.add(e.getKey());
            }
        }
        // Elements with a mapping in prior but not new (mapping disappeared).
        for (String src : priorByElement.keySet()) {
            if (!newByElement.containsKey(src)) {
                changed.add(src);
            }
        }
        return changed;
    }

    /**
     * Renames the prior active row with the " (superseded YYYY-MM-DD)"
     * suffix in a way that survives day-after re-promote (idempotency
     * skipped to keep the suffix loud; multi-promote on the same day
     * produces "(superseded 2026-05-20) (superseded 2026-05-20)" which is
     * acceptable per spec -- the rename is informational, not load-bearing).
     *
     * <p>Honours the project-scoped case-insensitive uniqueness constraint
     * on architecture names: if the suffixed name collides with another row
     * (vanishingly unlikely in practice), a numeric suffix is appended.</p>
     */
    void renameWithSupersededSuffix(UUID projectId, ArchitectureEntity priorActive) {
        String dateSuffix = LocalDate.now(ZoneOffset.UTC).toString();
        String base = priorActive.getName() == null ? "" : priorActive.getName();
        String candidate = base + SUPERSEDED_SUFFIX_PREFIX + dateSuffix + SUPERSEDED_SUFFIX_SUFFIX;

        int dedupe = 2;
        while (architectureRepository.existsByProjectIdAndNameIgnoreCaseAndIdNot(
                projectId, candidate, priorActive.getId())) {
            candidate = base + SUPERSEDED_SUFFIX_PREFIX + dateSuffix + " #"
                + String.format(Locale.ROOT, "%d", dedupe)
                + SUPERSEDED_SUFFIX_SUFFIX;
            dedupe++;
            if (dedupe > 50) {
                break;
            }
        }
        priorActive.setName(candidate);
    }

    /**
     * Loads an architecture by id, ensuring it belongs to the specified
     * project. Throws {@link ArchitectureNotFoundException} (mapped to 404)
     * when the architecture is missing or owned by a different project --
     * cross-project access is treated as "not found" to avoid leaking the
     * existence of architectures the caller cannot see.
     */
    private ArchitectureEntity loadInProject(UUID projectId, UUID architectureId) {
        ArchitectureEntity entity = architectureRepository.findById(architectureId)
            .orElseThrow(() -> new ArchitectureNotFoundException(
                "Architecture not found: " + architectureId));
        if (!projectId.equals(entity.getProjectId())) {
            throw new ArchitectureNotFoundException(
                "Architecture " + architectureId + " not found in project " + projectId);
        }
        return entity;
    }
}
