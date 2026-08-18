package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.mapper.SclMapper;
import com.example.architecturemodel.model.dto.SclContractDto;
import com.example.architecturemodel.model.dto.SclReachabilityItemDto;
import com.example.architecturemodel.model.dto.SclScanDto;
import com.example.architecturemodel.model.entity.SclContractEntity;
import com.example.architecturemodel.model.entity.SclReachabilityItemEntity;
import com.example.architecturemodel.model.entity.SclScanEntity;
import com.example.architecturemodel.model.entity.SclScanStatus;
import com.example.architecturemodel.repository.entity.SclContractRepository;
import com.example.architecturemodel.repository.entity.SclReachabilityItemRepository;
import com.example.architecturemodel.repository.entity.SclScanRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;

/**
 * Service for the SCL corpus persistence endpoints (Structural Contract
 * Language, 2026-08-18).
 *
 * <p>The tool mines legacy codebases into SCL contracts -- behaviour tables /
 * shape contracts / boundary contracts / fragments -- stored as OPAQUE JSON.
 * architecture-model-service is the store: contract bodies, roots, glosses,
 * scan stats and reachability signals are persisted and served verbatim and
 * are NEVER parsed here (mirroring the {@code config_snapshot} /
 * {@code report_json} precedent).</p>
 *
 * <p>Wraps {@link SclScanRepository}, {@link SclContractRepository} and
 * {@link SclReachabilityItemRepository} with the miner-facing surface:</p>
 * <ul>
 *   <li>Scan lifecycle: {@link #createScan(UUID, UUID)} /
 *       {@link #getLatestScan(UUID, UUID)} / {@link #listScans(UUID, UUID)} /
 *       {@link #updateScan(UUID, String, Map)} (null-guarded PATCH; status
 *       validated against {@link SclScanStatus#ALL}).</li>
 *   <li>Corpus writes: {@link #bulkUpsertContracts(UUID, List)} -- upsert
 *       keyed on (scan_id, contract_key); project/architecture ids are
 *       inherited from the scan row, never from the body.</li>
 *   <li>Corpus reads: {@link #listContracts(UUID, String, Integer, String, boolean)}
 *       (body-stripped when {@code includeBody=false} to keep list payloads
 *       light) / {@link #getContract(UUID, String)} (full body).</li>
 *   <li>Annotation pass: {@link #patchContractGloss(UUID, String, Map)} --
 *       gloss-only update for the LLM gloss writer.</li>
 *   <li>Reachability worklist: {@link #replaceReachability(UUID, List)}
 *       (replace-on-write per scan) / {@link #listReachability(UUID)} /
 *       {@link #patchReachabilityDisposition(UUID, String)} (triage verdict,
 *       vocabulary-validated; null reopens the item).</li>
 * </ul>
 *
 * <p>Status/disposition values are service-layer validated (no DB enum,
 * matching the AMS status-as-TEXT convention). Backed by Liquibase changeset
 * 224-scl-corpus.sql.</p>
 */
@Service
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class SclCorpusService {

    /**
     * Allowed reachability triage verdicts. Null is ALSO legal on the PATCH
     * (it reopens the item) but is not a member of this set.
     */
    public static final Set<String> ALLOWED_DISPOSITIONS = Set.of(
        "dead_code", "missed_entrypoint", "framework_invoked"
    );

    private final SclScanRepository scanRepository;
    private final SclContractRepository contractRepository;
    private final SclReachabilityItemRepository reachabilityItemRepository;
    private final SclMapper mapper;

    // ------------------------------------------------------------------
    // Scan lifecycle
    // ------------------------------------------------------------------

    /**
     * Create a new SCL scan for a (project, architecture), status
     * {@code in_progress}, fresh service-assigned UUID.
     *
     * @param projectId the project UUID (from the URL path)
     * @param architectureId the architecture UUID (from the URL path)
     * @return the persisted scan
     */
    @Transactional
    public SclScanDto createScan(UUID projectId, UUID architectureId) {
        SclScanEntity entity = SclScanEntity.builder()
            .id(UUID.randomUUID())
            .projectId(projectId)
            .architectureId(architectureId)
            .status(SclScanStatus.IN_PROGRESS)
            .build();
        SclScanEntity saved = scanRepository.save(entity);
        log.debug("[diag-ams] scl_scan created scanId={} projectId={} architectureId={}",
            saved.getId(), projectId, architectureId);
        return mapper.toDto(saved);
    }

    /**
     * The most recent scan for a (project, architecture), or empty when the
     * corpus has never been mined for the pair.
     *
     * @param projectId the project UUID
     * @param architectureId the architecture UUID
     * @return the latest scan, or empty
     */
    @Transactional(readOnly = true)
    public Optional<SclScanDto> getLatestScan(UUID projectId, UUID architectureId) {
        return scanRepository
            .findByProjectIdAndArchitectureIdOrderByCreatedAtDesc(projectId, architectureId)
            .stream()
            .findFirst()
            .map(mapper::toDto);
    }

    /**
     * One scan by id (2026-08-18: the gateway annotation pass and the
     * Structural Model tab read scans by explicit id).
     *
     * @param scanId the scan UUID
     * @return the scan, or empty when unknown
     */
    @Transactional(readOnly = true)
    public Optional<SclScanDto> getScan(UUID scanId) {
        return scanRepository.findById(scanId).map(mapper::toDto);
    }

    /**
     * All scans for a (project, architecture), newest first.
     *
     * @param projectId the project UUID
     * @param architectureId the architecture UUID
     * @return the scan history, newest first (empty list when none)
     */
    @Transactional(readOnly = true)
    public List<SclScanDto> listScans(UUID projectId, UUID architectureId) {
        return scanRepository
            .findByProjectIdAndArchitectureIdOrderByCreatedAtDesc(projectId, architectureId)
            .stream()
            .map(mapper::toDto)
            .toList();
    }

    /**
     * PATCH the scan: set {@code status} and/or {@code stats_json} with
     * null-guarded semantics (an omitted field leaves its column intact).
     *
     * @param scanId the scan UUID
     * @param status the new status, or null to leave unchanged
     * @param stats the new opaque stats payload, or null to leave unchanged
     * @return the updated scan
     * @throws ResourceNotFoundException if the scan does not exist
     * @throws IllegalArgumentException if a provided status is not in {@link SclScanStatus#ALL}
     */
    @Transactional
    public SclScanDto updateScan(UUID scanId, String status, Map<String, Object> stats) {
        SclScanEntity entity = scanRepository.findById(scanId)
            .orElseThrow(() -> new ResourceNotFoundException("SCL scan not found: " + scanId));
        if (status != null) {
            if (!SclScanStatus.ALL.contains(status)) {
                throw new IllegalArgumentException(
                    "Invalid SCL scan status: " + status + ". Allowed: " + SclScanStatus.ALL);
            }
            entity.setStatus(status);
        }
        if (stats != null) {
            entity.setStatsJson(stats);
        }
        SclScanEntity saved = scanRepository.save(entity);
        return mapper.toDto(saved);
    }

    // ------------------------------------------------------------------
    // Contract corpus
    // ------------------------------------------------------------------

    /**
     * Bulk-upsert a batch of contracts into a scan's corpus, keyed on
     * (scan_id, contract_key): an existing row is OVERWRITTEN in place
     * (body / gloss / fan_in / roots / hash / source fields + updated_at); a
     * new key inserts a fresh row with a fresh service-assigned UUID.
     * Project / architecture ids are inherited from the scan row -- the body's
     * values are never trusted.
     *
     * @param scanId the owning scan UUID
     * @param contracts the batch to upsert (null/empty is a no-op returning 0)
     * @return the number of upserted rows (inserts + overwrites)
     * @throws ResourceNotFoundException if the scan does not exist
     * @throws IllegalArgumentException if any entry has a blank contract_key
     *         or a null body_json (the message lists the offending entries)
     */
    @Transactional
    public int bulkUpsertContracts(UUID scanId, List<SclContractDto> contracts) {
        SclScanEntity scan = scanRepository.findById(scanId)
            .orElseThrow(() -> new ResourceNotFoundException("SCL scan not found: " + scanId));
        if (contracts == null || contracts.isEmpty()) {
            return 0;
        }

        // Validate the WHOLE batch before writing anything: reject blank keys
        // and bodiless contracts loudly, listing every offender.
        List<String> offenders = new ArrayList<>();
        for (int i = 0; i < contracts.size(); i++) {
            SclContractDto dto = contracts.get(i);
            String key = (dto != null) ? dto.contractKey() : null;
            if (dto == null || key == null || key.isBlank()) {
                offenders.add("[index " + i + ": blank contract_key]");
            } else if (dto.bodyJson() == null) {
                offenders.add(key + " (null body_json)");
            }
        }
        if (!offenders.isEmpty()) {
            throw new IllegalArgumentException(
                "Rejected SCL contract entries (blank contract_key or null body_json): "
                    + String.join(", ", offenders));
        }

        int upserted = 0;
        for (SclContractDto dto : contracts) {
            Optional<SclContractEntity> existing =
                contractRepository.findByScanIdAndContractKey(scanId, dto.contractKey());
            if (existing.isPresent()) {
                SclContractEntity entity = existing.get();
                entity.setSourcePath(dto.sourcePath());
                entity.setSourceSymbol(dto.sourceSymbol());
                entity.setContentHash(dto.contentHash());
                entity.setFanIn(dto.fanIn() != null ? dto.fanIn() : 0);
                entity.setRootsJson(dto.rootsJson());
                entity.setBodyJson(dto.bodyJson());
                entity.setGlossJson(dto.glossJson());
                contractRepository.save(entity);
            } else {
                SclContractEntity entity = mapper.toEntity(dto);
                entity.setId(UUID.randomUUID());
                entity.setScanId(scanId);
                entity.setProjectId(scan.getProjectId());
                entity.setArchitectureId(scan.getArchitectureId());
                contractRepository.save(entity);
            }
            upserted++;
        }
        log.debug("[diag-ams] scl_contract bulk-upsert scanId={} upserted={}", scanId, upserted);
        return upserted;
    }

    /**
     * List a scan's contracts. Filters compose: {@code kind} is applied at the
     * repository, then {@code minFanIn} and {@code q} (case-insensitive
     * substring over contract_key / source_symbol / source_path) are applied
     * in memory -- corpus sizes are thousands, not millions. When
     * {@code includeBody} is false the returned DTOs carry {@code body_json}
     * AND {@code gloss_json} as null to keep list payloads light.
     *
     * @param scanId the owning scan UUID
     * @param kind optional kind filter (null/blank = all kinds)
     * @param minFanIn optional inclusive fan-in floor (null = no floor)
     * @param q optional case-insensitive substring search (null/blank = no search)
     * @param includeBody whether to carry body_json/gloss_json on each entry
     * @return the matching contracts ordered by contractKey ascending
     */
    @Transactional(readOnly = true)
    public List<SclContractDto> listContracts(
            UUID scanId, String kind, Integer minFanIn, String q, boolean includeBody) {
        List<SclContractEntity> base = (kind != null && !kind.isBlank())
            ? contractRepository.findByScanIdAndKindOrderByContractKeyAsc(scanId, kind)
            : contractRepository.findByScanIdOrderByContractKeyAsc(scanId);

        String needle = (q != null && !q.isBlank()) ? q.toLowerCase(Locale.ROOT) : null;
        Function<SclContractEntity, SclContractDto> render =
            includeBody ? mapper::toDto : mapper::toDtoWithoutBody;
        return base.stream()
            .filter(c -> minFanIn == null
                || (c.getFanIn() != null && c.getFanIn() >= minFanIn))
            .filter(c -> needle == null
                || containsIgnoreCase(c.getContractKey(), needle)
                || containsIgnoreCase(c.getSourceSymbol(), needle)
                || containsIgnoreCase(c.getSourcePath(), needle))
            .map(render)
            .toList();
    }

    /**
     * One contract with its FULL opaque body, by (scan_id, contract_key).
     *
     * @param scanId the owning scan UUID
     * @param contractKey the miner's stable per-scan contract key
     * @return the full contract
     * @throws ResourceNotFoundException if no contract matches the pair
     */
    @Transactional(readOnly = true)
    public SclContractDto getContract(UUID scanId, String contractKey) {
        SclContractEntity entity = contractRepository
            .findByScanIdAndContractKey(scanId, contractKey)
            .orElseThrow(() -> new ResourceNotFoundException(
                "SCL contract not found: scan " + scanId + ", key " + contractKey));
        return mapper.toDto(entity);
    }

    /**
     * Gloss-only PATCH for the LLM annotation pass: overwrite
     * {@code gloss_json} on one contract, touching NOTHING else (body, roots,
     * hash, fan-in and source fields stay exactly as mined).
     *
     * @param scanId the owning scan UUID
     * @param contractKey the miner's stable per-scan contract key
     * @param gloss the new opaque gloss payload (null clears the gloss)
     * @return the updated contract (full body)
     * @throws ResourceNotFoundException if no contract matches the pair
     */
    @Transactional
    public SclContractDto patchContractGloss(
            UUID scanId, String contractKey, Map<String, Object> gloss) {
        SclContractEntity entity = contractRepository
            .findByScanIdAndContractKey(scanId, contractKey)
            .orElseThrow(() -> new ResourceNotFoundException(
                "SCL contract not found: scan " + scanId + ", key " + contractKey));
        entity.setGlossJson(gloss);
        SclContractEntity saved = contractRepository.save(entity);
        return mapper.toDto(saved);
    }

    // ------------------------------------------------------------------
    // Reachability worklist
    // ------------------------------------------------------------------

    /**
     * Replace a scan's reachability worklist wholesale: delete the existing
     * items and insert the fresh batch (fresh service-assigned UUIDs when the
     * body omits ids; {@code project_id} inherited from the scan row).
     *
     * @param scanId the owning scan UUID
     * @param items the fresh worklist (null/empty just clears the scan's items)
     * @return the number of inserted items
     * @throws ResourceNotFoundException if the scan does not exist
     */
    @Transactional
    public int replaceReachability(UUID scanId, List<SclReachabilityItemDto> items) {
        SclScanEntity scan = scanRepository.findById(scanId)
            .orElseThrow(() -> new ResourceNotFoundException("SCL scan not found: " + scanId));
        long deleted = reachabilityItemRepository.deleteByScanId(scanId);
        if (items == null || items.isEmpty()) {
            log.debug("[diag-ams] scl_reachability_item replace scanId={} deleted={} inserted=0",
                scanId, deleted);
            return 0;
        }
        List<SclReachabilityItemEntity> fresh = items.stream()
            .map(dto -> {
                SclReachabilityItemEntity entity = mapper.toEntity(dto);
                if (entity.getId() == null) {
                    entity.setId(UUID.randomUUID());
                }
                entity.setScanId(scanId);
                entity.setProjectId(scan.getProjectId());
                return entity;
            })
            .toList();
        List<SclReachabilityItemEntity> saved = reachabilityItemRepository.saveAll(fresh);
        log.debug("[diag-ams] scl_reachability_item replace scanId={} deleted={} inserted={}",
            scanId, deleted, saved.size());
        return saved.size();
    }

    /**
     * Every reachability item for a scan, ordered by source path.
     *
     * @param scanId the owning scan UUID
     * @return the scan's worklist (empty list when none)
     */
    @Transactional(readOnly = true)
    public List<SclReachabilityItemDto> listReachability(UUID scanId) {
        return reachabilityItemRepository.findByScanIdOrderBySourcePathAsc(scanId)
            .stream()
            .map(mapper::toDto)
            .toList();
    }

    /**
     * Set the triage verdict on one reachability item. Allowed:
     * {@code dead_code} | {@code missed_entrypoint} | {@code framework_invoked},
     * or null to REOPEN the item; anything else is rejected.
     *
     * @param itemId the reachability item UUID
     * @param disposition the verdict, or null to reopen
     * @return the updated item
     * @throws ResourceNotFoundException if the item does not exist
     * @throws IllegalArgumentException if the disposition is not in the vocabulary
     */
    @Transactional
    public SclReachabilityItemDto patchReachabilityDisposition(UUID itemId, String disposition) {
        SclReachabilityItemEntity entity = reachabilityItemRepository.findById(itemId)
            .orElseThrow(() -> new ResourceNotFoundException(
                "SCL reachability item not found: " + itemId));
        if (disposition != null && !ALLOWED_DISPOSITIONS.contains(disposition)) {
            throw new IllegalArgumentException(
                "Invalid SCL reachability disposition: " + disposition
                    + ". Allowed: " + ALLOWED_DISPOSITIONS + " (or null to reopen)");
        }
        entity.setDisposition(disposition);
        SclReachabilityItemEntity saved = reachabilityItemRepository.save(entity);
        return mapper.toDto(saved);
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private static boolean containsIgnoreCase(String haystack, String lowerCaseNeedle) {
        return haystack != null
            && haystack.toLowerCase(Locale.ROOT).contains(lowerCaseNeedle);
    }
}
