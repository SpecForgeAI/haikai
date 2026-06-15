package com.example.architecturemodel.service.migration;

import com.example.architecturemodel.exception.ConflictException;
import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.migration.MissingInputResolutionCreateRequest;
import com.example.architecturemodel.model.dto.migration.MissingInputResolutionDto;
import com.example.architecturemodel.model.entity.MissingInputResolutionEntity;
import com.example.architecturemodel.repository.entity.MissingInputResolutionRepository;
import com.example.architecturemodel.service.MissingInputKeyHasher;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * Service layer for {@code missing_input_resolutions}: CRUD plus the audit-
 * preserving soft-delete used by the cross-story matcher (Task Group 3 layers
 * the cascade on top of this).
 *
 * <p>Spec: Missing Input Resolver Flow (2026-05-20) -- Task Group 2.</p>
 *
 * <p>Spec 2026-05-20: Bulk-Resolve OAS/WSDL Parser -- Task Group 3 added the
 * {@link #createWithSource(UUID, MissingInputResolutionCreateRequest, String, UUID)}
 * overload that stamps the provenance columns {@code resolution_source} and
 * {@code project_artifact_id} added in changeset 151. The existing
 * {@link #create(UUID, MissingInputResolutionCreateRequest)} method preserves
 * manual-entry callers unchanged by defaulting to
 * {@code resolution_source = 'manual'} and {@code project_artifact_id = null}.</p>
 *
 * <h2>Key derivation</h2>
 * The create path accepts either a pre-computed {@code missingInputKey} (the
 * typical frontend path, where the key is already known from the spec's
 * {@code missing_input_keys_json}) OR per-type canonical descriptor fields
 * that this service hashes through {@link MissingInputKeyHasher}. Exactly one
 * of the two paths must produce a non-empty key.
 *
 * <h2>Active-uniqueness</h2>
 * One active resolution per {@code (projectId, missingInputKey)}, enforced
 * cooperatively by:
 * <ol>
 *   <li>This service's pre-insert check
 *       ({@link MissingInputResolutionRepository#findByProjectIdAndMissingInputKeyAndSoftDeletedFalse}).</li>
 *   <li>The DB-level partial unique index {@code ux_mir_project_key_active}.</li>
 * </ol>
 * Conflicts return {@link ConflictException} (mapped to HTTP 409) so the
 * frontend can route to a "reset existing first" UX.
 *
 * <h2>Soft-delete posture (this group)</h2>
 * {@link #softDelete(UUID, UUID, String)} flips {@code soft_deleted=true} and
 * stamps the audit channels but does NOT trigger the dependent-spec cascade.
 * Task Group 3 wires the cascade on top of this hook -- this method must
 * remain narrow so the matcher / cascade-coordinator can compose around it.
 *
 * <h2>Type vocabulary</h2>
 * The DB CHECK constraint {@code chk_mir_type} is the source of truth, but the
 * service-layer pre-check in {@link #validateType(String)} short-circuits with
 * a friendly {@link IllegalArgumentException} before the DB rejects the row.
 *
 * <h2>Boxed-types posture</h2>
 * Every field on the DTOs and the entity is a boxed reference type per
 * {@code project_primitive_double_dto_overwrite.md}; the service never coerces
 * to primitives.
 *
 * <h2>Conditional-on-feature</h2>
 * Wired behind {@code app.features.include-database} (default TRUE) mirroring
 * the standing pattern (see {@link EpicCapturedDecisionService}). Test-only
 * "no DB" profiles can disable this without breaking the bean graph.
 */
@Service
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class MissingInputResolutionService {

    /** Canonical {@code missing_input_type} vocabulary -- mirrors DB CHECK chk_mir_type. */
    public static final String TYPE_API_CONTRACT = "api_contract";
    public static final String TYPE_MAPPING = "mapping";
    public static final String TYPE_TARGET_ELEMENT = "target_element";

    public static final Set<String> ALLOWED_TYPES = Set.of(
        TYPE_API_CONTRACT, TYPE_MAPPING, TYPE_TARGET_ELEMENT);

    /**
     * Default value for {@link MissingInputResolutionEntity#getResolutionSource()}
     * when the create path is invoked WITHOUT an explicit source (the manual-
     * entry path). Open-vocabulary stamp; the DB column has no CHECK
     * constraint by design (see entity javadoc).
     *
     * <p>Spec 2026-05-20: Bulk-Resolve OAS/WSDL Parser -- Task Group 3.</p>
     */
    public static final String RESOLUTION_SOURCE_MANUAL = "manual";

    /**
     * Stamp written by the parse-files endpoint (Task Group 4) when a
     * resolution is created from an OAS/WSDL upload.
     *
     * <p>Spec 2026-05-20: Bulk-Resolve OAS/WSDL Parser -- Task Group 3.</p>
     */
    public static final String RESOLUTION_SOURCE_OAS_WSDL_UPLOAD = "oas_wsdl_upload";

    private final MissingInputResolutionRepository repository;
    private final MissingInputKeyHasher hasher;

    /**
     * POST create: one ACTIVE resolution per {@code (projectId, missingInputKey)}.
     *
     * <p>Convenience overload that defaults provenance columns to
     * {@code resolution_source = 'manual'} and {@code project_artifact_id = null}.
     * Existing manual-entry callers (the bulk-resolve modal manual path and the
     * single-row create endpoint) keep this entry point unchanged.</p>
     *
     * <p>Conflict semantics: if an active resolution already exists for the
     * tuple, throw {@link ConflictException} (HTTP 409). The frontend is
     * expected to surface a "Reset the existing resolution first" affordance
     * to the user; AMS does not silently update the existing row.</p>
     *
     * @param projectId  owning project UUID (required)
     * @param request    create request -- key OR canonical descriptor fields
     * @return           the persisted DTO (with stamped {@code resolved_at} /
     *                   {@code resolved_by})
     * @throws IllegalArgumentException  on missing required fields or invalid type
     * @throws ConflictException         on duplicate active resolution
     */
    @Transactional
    public MissingInputResolutionDto create(
            UUID projectId,
            MissingInputResolutionCreateRequest request) {
        return createWithSource(projectId, request, RESOLUTION_SOURCE_MANUAL, null);
    }

    /**
     * POST create with explicit provenance columns.
     *
     * <p>Used by the parse-files endpoint (Task Group 4) so the new
     * {@code resolution_source} + {@code project_artifact_id} columns
     * (changeset 151) are stamped on every row originating from an OAS/WSDL
     * upload. The single-row create path defers to this overload via
     * {@link #create(UUID, MissingInputResolutionCreateRequest)}.</p>
     *
     * @param projectId          owning project UUID (required)
     * @param request            create request -- key OR canonical descriptor fields
     * @param resolutionSource   open-vocabulary provenance stamp; null/blank
     *                           tolerated -> column left null. The service-
     *                           layer convention is to pass either
     *                           {@link #RESOLUTION_SOURCE_MANUAL} or
     *                           {@link #RESOLUTION_SOURCE_OAS_WSDL_UPLOAD}.
     * @param projectArtifactId  optional back-reference to the
     *                           {@code project_artifact} row holding the
     *                           uploaded OAS/WSDL bytes; null on manual-entry
     *                           rows.
     * @return                   the persisted DTO (with stamped {@code resolved_at} /
     *                           {@code resolved_by})
     * @throws IllegalArgumentException  on missing required fields or invalid type
     * @throws ConflictException         on duplicate active resolution
     *
     * Spec 2026-05-20: Bulk-Resolve OAS/WSDL Parser -- Task Group 3
     */
    @Transactional
    public MissingInputResolutionDto createWithSource(
            UUID projectId,
            MissingInputResolutionCreateRequest request,
            String resolutionSource,
            UUID projectArtifactId) {
        requireProjectId(projectId);
        if (request == null) {
            throw new IllegalArgumentException("Request body required");
        }
        if (request.resolvedBy() == null || request.resolvedBy().isBlank()) {
            throw new IllegalArgumentException("resolvedBy is required");
        }
        validateType(request.missingInputType());

        String key = resolveKey(request);
        if (key == null || key.isBlank()) {
            throw new IllegalArgumentException(
                "missingInputKey is required (either pass it directly or pass "
                + "the per-type canonical descriptor fields so the service can "
                + "compute it via MissingInputKeyHasher)");
        }

        Optional<MissingInputResolutionEntity> existing = repository
            .findByProjectIdAndMissingInputKeyAndSoftDeletedFalse(projectId, key);
        if (existing.isPresent()) {
            log.info(
                "[diag-ams] missing_input_resolution conflict projectId={} key={} type={} existingId={}",
                shortPrefix(projectId), key, request.missingInputType(), existing.get().getId());
            throw new ConflictException(
                "An active missing-input resolution already exists for project "
                + shortPrefix(projectId) + " and key " + key
                + " (id=" + existing.get().getId() + "); reset the existing"
                + " resolution before creating a new one");
        }

        // Normalise resolutionSource: blank -> null (preserve column-null
        // semantics for callers that explicitly pass empty). The default-
        // applied 'manual' stamp arrives via the create(...) overload above.
        String effectiveSource = (resolutionSource == null || resolutionSource.isBlank())
            ? null
            : resolutionSource;

        Instant now = Instant.now();
        MissingInputResolutionEntity entity = MissingInputResolutionEntity.builder()
            .id(UUID.randomUUID())
            .projectId(projectId)
            .missingInputKey(key)
            .missingInputType(request.missingInputType())
            .resolutionPayloadJson(request.resolutionPayload())
            .resolvedAt(now)
            .resolvedBy(request.resolvedBy())
            .softDeleted(Boolean.FALSE)
            .resolutionSource(effectiveSource)
            .projectArtifactId(projectArtifactId)
            .createdAt(now)
            .updatedAt(now)
            .build();

        MissingInputResolutionEntity saved = repository.save(entity);
        log.info(
            "[diag-ams] missing_input_resolution created id={} projectId={} key={} type={} resolvedBy={} source={} artifactId={}",
            saved.getId(), shortPrefix(projectId), key, request.missingInputType(),
            request.resolvedBy(), effectiveSource, projectArtifactId);
        return toDto(saved);
    }

    /**
     * GET list: active resolutions for a project, ordered by {@code resolved_at DESC}
     * (most-recently-resolved first). Caller-level filters (by {@code type} /
     * {@code key}) live on the controller and re-use this list.
     *
     * @param projectId  owning project UUID (required)
     * @return           active resolution DTOs (empty list if none)
     */
    @Transactional(readOnly = true)
    public List<MissingInputResolutionDto> list(UUID projectId) {
        requireProjectId(projectId);
        List<MissingInputResolutionEntity> rows =
            repository.findByProjectIdAndSoftDeletedFalse(projectId);
        if (rows == null || rows.isEmpty()) {
            return List.of();
        }
        // Defensive sort -- the DB-level partial index covers (project_id,
        // missing_input_key) and the optimiser may return any order. The
        // contract is "newest first".
        List<MissingInputResolutionEntity> sorted = new ArrayList<>(rows);
        sorted.sort(Comparator.comparing(
            MissingInputResolutionEntity::getResolvedAt,
            Comparator.nullsLast(Comparator.reverseOrder())));
        List<MissingInputResolutionDto> out = new ArrayList<>(sorted.size());
        for (MissingInputResolutionEntity row : sorted) {
            out.add(toDto(row));
        }
        return out;
    }

    /**
     * DELETE (soft): set {@code soft_deleted=true}, stamp {@code soft_deleted_at}
     * and {@code soft_deleted_by}. Returns the audited DTO so the controller
     * can hand the snapshot to the caller without a follow-up fetch.
     *
     * <p>This method DELIBERATELY does NOT cascade to dependent specs. Task
     * Group 3 wires the cross-story cascade on top of this hook (see
     * {@code MissingInputResolutionCascadeService} -- forthcoming). Keeping
     * the cascade out of this method preserves the composable boundary.</p>
     *
     * <p>Idempotency: re-running soft-delete on an already-soft-deleted row
     * refreshes the {@code soft_deleted_at} / {@code soft_deleted_by} audit
     * channel. This matches the standing audit-trail-preservation rule (we
     * want the most recent reset stamped, even if the row was already in the
     * reset state) and is harmless because the dependent-spec cascade (Task
     * Group 3) is keyed off the key + projectId, not off this row's id.</p>
     *
     * @param projectId      owning project UUID (required, used for scope check)
     * @param resolutionId   id of the resolution to soft-delete
     * @param deletedBy      audit channel: user/principal performing the reset
     * @return               the audited DTO post-soft-delete
     * @throws ResourceNotFoundException  if the row does not exist or belongs
     *                                    to a different project
     */
    @Transactional
    public MissingInputResolutionDto softDelete(
            UUID projectId,
            UUID resolutionId,
            String deletedBy) {
        requireProjectId(projectId);
        if (resolutionId == null) {
            throw new IllegalArgumentException("resolutionId is required");
        }
        if (deletedBy == null || deletedBy.isBlank()) {
            throw new IllegalArgumentException("deletedBy is required");
        }

        MissingInputResolutionEntity row = repository.findById(resolutionId)
            .orElseThrow(() -> new ResourceNotFoundException(
                "Missing-input resolution " + resolutionId + " not found"));

        // Project-scope enforcement: cross-project reads / writes masquerade
        // as 404, matching the discovery-child convention.
        if (!projectId.equals(row.getProjectId())) {
            throw new ResourceNotFoundException(
                "Missing-input resolution " + resolutionId
                    + " not found for project " + shortPrefix(projectId));
        }

        Instant now = Instant.now();
        row.setSoftDeleted(Boolean.TRUE);
        row.setSoftDeletedAt(now);
        row.setSoftDeletedBy(deletedBy);
        row.setUpdatedAt(now);

        MissingInputResolutionEntity saved = repository.save(row);
        log.info(
            "[diag-ams] missing_input_resolution soft_deleted id={} projectId={} key={} deletedBy={}",
            saved.getId(), shortPrefix(projectId), saved.getMissingInputKey(), deletedBy);
        return toDto(saved);
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    /**
     * Resolve the key from the request: explicit {@code missingInputKey} wins;
     * otherwise compute from {@code canonicalDescriptor} (if supplied) or from
     * the per-type canonical descriptor fields.
     */
    private String resolveKey(MissingInputResolutionCreateRequest request) {
        if (request.missingInputKey() != null && !request.missingInputKey().isBlank()) {
            return request.missingInputKey().trim();
        }
        String type = request.missingInputType();
        if (request.canonicalDescriptor() != null && !request.canonicalDescriptor().isBlank()) {
            return hasher.computeKey(type, request.canonicalDescriptor());
        }
        if (TYPE_API_CONTRACT.equals(type)) {
            String descriptor = hasher.canonicalDescriptorForApiContract(
                request.serviceName(), request.operationName());
            return hasher.computeKey(type, descriptor);
        }
        if (TYPE_MAPPING.equals(type)) {
            String descriptor = hasher.canonicalDescriptorForMapping(
                request.sourceElementId(), request.targetElementId());
            return hasher.computeKey(type, descriptor);
        }
        if (TYPE_TARGET_ELEMENT.equals(type)) {
            String descriptor = hasher.canonicalDescriptorForArchElement(
                request.targetElementLogicalName());
            return hasher.computeKey(type, descriptor);
        }
        return null;
    }

    private void validateType(String type) {
        if (type == null || type.isBlank()) {
            throw new IllegalArgumentException("missingInputType is required");
        }
        if (!ALLOWED_TYPES.contains(type)) {
            throw new IllegalArgumentException(
                "missingInputType must be one of " + ALLOWED_TYPES + "; got '" + type + "'");
        }
    }

    private static void requireProjectId(UUID projectId) {
        if (projectId == null) {
            throw new IllegalArgumentException("projectId is required");
        }
    }

    private MissingInputResolutionDto toDto(MissingInputResolutionEntity row) {
        return new MissingInputResolutionDto(
            row.getId(),
            row.getProjectId(),
            row.getMissingInputKey(),
            row.getMissingInputType(),
            row.getResolutionPayloadJson(),
            row.getResolvedAt(),
            row.getResolvedBy(),
            row.getSoftDeleted(),
            row.getSoftDeletedAt(),
            row.getSoftDeletedBy(),
            row.getCreatedAt(),
            row.getUpdatedAt()
        );
    }

    private static String shortPrefix(UUID id) {
        if (id == null) return "00000000";
        String s = id.toString();
        return s.substring(0, Math.min(8, s.length()));
    }
}
