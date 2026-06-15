package com.example.architecturemodel.service.migration;

import com.example.architecturemodel.model.dto.migration.MissingInputResolutionCreateRequest;
import com.example.architecturemodel.model.entity.MigrationStorySpecGenerationEntity;
import com.example.architecturemodel.model.entity.MigrationStorySpecGenerationStatus;
import com.example.architecturemodel.repository.entity.MigrationStorySpecGenerationRepository;
import com.example.architecturemodel.service.MissingInputKeyHasher;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Bulk resolution service for the Missing Input Resolver Flow.
 *
 * <p>Spec: Missing Input Resolver Flow (2026-05-20) -- Task Group 3.5.</p>
 *
 * <h2>Why a separate service from {@link MissingInputResolutionService}</h2>
 * The single-key {@code create} flow and the bulk preview / commit flow share
 * the same persistence primitive but have very different transactional and
 * presentation contracts:
 * <ul>
 *   <li>Single-key {@code create}: one resolution per call, raises 409 on
 *       conflict, returns the audited DTO.</li>
 *   <li>Bulk preview ({@code commit=false}): NEVER writes, returns a structured
 *       preview describing what WOULD be inserted -- including the
 *       affected-spec cross-reference per key.</li>
 *   <li>Bulk commit ({@code commit=true}): single transaction, all-or-nothing.
 *       A duplicate-key collision aborts the transaction (no partial writes)
 *       so the caller can roll up and retry.</li>
 * </ul>
 *
 * <h2>Upload parse scope (v1)</h2>
 * V1 accepts the structured form of an upload: a list of {@code items}, each
 * carrying a per-type canonical descriptor. The OAS / WSDL / mapping-bundle
 * parsers themselves live downstream (Task Group 5 / 6); this service expects
 * the already-enumerated items so the v1 surface stays narrow and the parsers
 * can evolve independently. Each item shape:
 * <ul>
 *   <li>{@code api_contract}   -- {@code { type, serviceName, operationName, payload }}</li>
 *   <li>{@code mapping}        -- {@code { type, sourceElementId, targetElementId, payload }}</li>
 *   <li>{@code target_element} -- {@code { type, targetElementLogicalName, payload }}</li>
 * </ul>
 * The {@code payload} field, when present, is forwarded verbatim to the
 * resolution row's {@code resolutionPayloadJson} column.
 *
 * <h2>Intersection with active missing keys</h2>
 * Only items whose key intersects with at least one project-scoped
 * {@code missing_input_keys_json} entry are surfaced in the response. Items
 * with no matching spec are silently dropped (preview returns 0 affected
 * specs for them and they are NOT written on commit). This keeps the preview
 * surface focused on actionable items and avoids littering the resolutions
 * table with orphan rows.
 */
@Service
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class MissingInputResolutionBulkService {

    private final MissingInputResolutionService resolutionService;
    private final MigrationStorySpecGenerationRepository specRepository;
    private final MissingInputKeyHasher hasher;

    /**
     * Bulk preview / commit for an enumerated list of resolution items.
     *
     * <p>When {@code commit=false} (the default), NO writes occur and the
     * response is preview-only. When {@code commit=true}, every preview item
     * is inserted via {@link MissingInputResolutionService#create} in a single
     * transaction.</p>
     *
     * @param projectId    owning project UUID (required)
     * @param items        the per-item descriptors (see class-level javadoc)
     * @param commit       {@code true} to insert; {@code false} for preview
     * @param resolvedBy   audit channel: user/principal performing the bulk
     *                     action (required when {@code commit=true})
     * @return             the bulk-resolve response with preview rows + the
     *                     {@code previewOnly} flag
     */
    @Transactional
    public BulkResolveResponse bulkResolve(
            UUID projectId,
            List<BulkResolveItem> items,
            Boolean commit,
            String resolvedBy) {
        if (projectId == null) {
            throw new IllegalArgumentException("projectId is required");
        }
        boolean isCommit = Boolean.TRUE.equals(commit);
        if (isCommit && (resolvedBy == null || resolvedBy.isBlank())) {
            throw new IllegalArgumentException(
                "resolvedBy is required when commit=true");
        }
        if (items == null || items.isEmpty()) {
            return new BulkResolveResponse(List.of(), !isCommit);
        }

        // Step 1: hash each item and accumulate (item, key) pairs. Items that
        // produce a null/blank key (malformed / unknown type) are dropped.
        List<HashedItem> hashed = new ArrayList<>(items.size());
        for (BulkResolveItem item : items) {
            String key = hashItem(item);
            if (key == null) {
                log.debug(
                    "[diag-ams] missing_input_bulk dropped_item projectId={} type={} reason=hash_null",
                    shortPrefix(projectId), item == null ? null : item.type());
                continue;
            }
            hashed.add(new HashedItem(item, key));
        }
        if (hashed.isEmpty()) {
            return new BulkResolveResponse(List.of(), !isCommit);
        }

        // Step 2: pull every spec in the project and intersect keys. We
        // surface only items whose key matches at least one
        // missing_input_keys_json entry in the project.
        List<MigrationStorySpecGenerationEntity> projectSpecs =
            specRepository.findByProjectId(projectId);
        Map<String, List<UUID>> keyToAffectedSpecIds = new LinkedHashMap<>();
        if (projectSpecs != null) {
            for (MigrationStorySpecGenerationEntity spec : projectSpecs) {
                if (spec == null) continue;
                if (!MigrationStorySpecGenerationStatus.INSUFFICIENT_CONTEXT
                        .equals(spec.getStatus())) continue;
                List<String> keys = spec.getMissingInputKeysJson();
                if (keys == null || keys.isEmpty()) continue;
                for (String k : keys) {
                    if (k == null) continue;
                    keyToAffectedSpecIds
                        .computeIfAbsent(k, kk -> new ArrayList<>())
                        .add(spec.getId());
                }
            }
        }

        // Step 3: build preview rows for items that intersect with at least
        // one spec. De-duplicate by key so a list with two identical items
        // produces one preview row.
        Set<String> seenKeys = new LinkedHashSet<>();
        List<BulkResolvePreviewRow> previewRows = new ArrayList<>();
        for (HashedItem hi : hashed) {
            if (!seenKeys.add(hi.key)) continue;
            List<UUID> affected = keyToAffectedSpecIds.getOrDefault(hi.key, List.of());
            if (affected.isEmpty()) continue;
            previewRows.add(new BulkResolvePreviewRow(
                hi.key,
                hi.item.type(),
                descriptorFor(hi.item),
                Collections.unmodifiableList(new ArrayList<>(affected)),
                hi.item.payload()));
        }

        if (!isCommit) {
            log.info(
                "[diag-ams] missing_input_bulk preview projectId={} itemsIn={} previewRows={}",
                shortPrefix(projectId), items.size(), previewRows.size());
            return new BulkResolveResponse(previewRows, true);
        }

        // Step 4: commit. Single transaction (the surrounding @Transactional).
        // We delegate to MissingInputResolutionService.create per row so the
        // unique-active-per-(project,key) precheck applies. A duplicate-key
        // conflict aborts the whole transaction -- ALL-or-nothing per spec.md
        // line 33.
        for (BulkResolvePreviewRow row : previewRows) {
            MissingInputResolutionCreateRequest req = new MissingInputResolutionCreateRequest(
                /* missingInputKey */ row.key(),
                /* missingInputType */ row.missingInputType(),
                /* canonicalDescriptor */ null,
                null, null, null, null, null,
                row.resolutionPayload(),
                resolvedBy);
            resolutionService.create(projectId, req);
        }
        log.info(
            "[diag-ams] missing_input_bulk commit projectId={} itemsIn={} inserted={}",
            shortPrefix(projectId), items.size(), previewRows.size());
        return new BulkResolveResponse(previewRows, false);
    }

    private String hashItem(BulkResolveItem item) {
        if (item == null) return null;
        if (item.type() == null) return null;
        String type = item.type().toLowerCase().trim();
        switch (type) {
            case MissingInputResolutionService.TYPE_API_CONTRACT -> {
                if (item.serviceName() == null && item.operationName() == null) return null;
                String d = hasher.canonicalDescriptorForApiContract(
                    item.serviceName(), item.operationName());
                return hasher.computeKey(type, d);
            }
            case MissingInputResolutionService.TYPE_MAPPING -> {
                if (item.sourceElementId() == null && item.targetElementId() == null) {
                    return null;
                }
                String d = hasher.canonicalDescriptorForMapping(
                    item.sourceElementId(), item.targetElementId());
                return hasher.computeKey(type, d);
            }
            case MissingInputResolutionService.TYPE_TARGET_ELEMENT -> {
                if (item.targetElementLogicalName() == null) return null;
                String d = hasher.canonicalDescriptorForArchElement(
                    item.targetElementLogicalName());
                return hasher.computeKey(type, d);
            }
            default -> {
                return null;
            }
        }
    }

    private static String descriptorFor(BulkResolveItem item) {
        if (item == null || item.type() == null) return "";
        String type = item.type().toLowerCase().trim();
        return switch (type) {
            case MissingInputResolutionService.TYPE_API_CONTRACT ->
                (item.serviceName() == null ? "" : item.serviceName())
                    + "::"
                    + (item.operationName() == null ? "" : item.operationName());
            case MissingInputResolutionService.TYPE_MAPPING ->
                (item.sourceElementId() == null ? "" : item.sourceElementId())
                    + "->"
                    + (item.targetElementId() == null ? "" : item.targetElementId());
            case MissingInputResolutionService.TYPE_TARGET_ELEMENT ->
                item.targetElementLogicalName() == null ? "" : item.targetElementLogicalName();
            default -> "";
        };
    }

    private static String shortPrefix(UUID id) {
        if (id == null) return "00000000";
        String s = id.toString();
        return s.substring(0, Math.min(8, s.length()));
    }

    private record HashedItem(BulkResolveItem item, String key) {}

    // -----------------------------------------------------------------------
    // Public request / response shapes
    // -----------------------------------------------------------------------

    /**
     * One enumerated bulk-resolve item. The controller layer (Task Group 4)
     * will accept an upload payload and explode it into one of these per
     * operation / mapping pair / target element.
     */
    public record BulkResolveItem(
        String type,
        String serviceName,
        String operationName,
        String sourceElementId,
        String targetElementId,
        String targetElementLogicalName,
        Map<String, Object> payload
    ) {}

    /**
     * One preview row, keyed by the stable 16-hex-char missing-input key, with
     * the resolved type, a human-readable descriptor, and the list of
     * spec-generation ids the resolution would affect.
     */
    public record BulkResolvePreviewRow(
        String key,
        String missingInputType,
        String descriptor,
        List<UUID> affectedSpecIds,
        Map<String, Object> resolutionPayload
    ) {}

    /**
     * Bulk-resolve response. {@code previewOnly=true} on preview;
     * {@code previewOnly=false} when {@code commit=true} was supplied and
     * resolutions were written (the preview rows describe what WAS inserted).
     */
    public record BulkResolveResponse(
        List<BulkResolvePreviewRow> resolutions,
        Boolean previewOnly
    ) {}
}
