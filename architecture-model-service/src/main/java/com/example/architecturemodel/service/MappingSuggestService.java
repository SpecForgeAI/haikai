package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ArchitectureNotFoundException;
import com.example.architecturemodel.model.dto.MappingSuggestCandidate;
import com.example.architecturemodel.model.dto.MappingSuggestRequest;
import com.example.architecturemodel.model.dto.MappingSuggestResponse;
import com.example.architecturemodel.model.dto.MappingSuggestTargetSnapshot;
import com.example.architecturemodel.model.entity.ArchitectureEntity;
import com.example.architecturemodel.repository.ArchitectureRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

/**
 * Returns up to three current-architecture element candidates ranked by name
 * similarity for the target-element the user is shaping.
 *
 * <p><b>Read-only, no LLM.</b> AMS computes a simple name-similarity score
 * (exact match -> 1.0, substring -> 0.7, token-overlap weighted -> 0..0.6).
 * The gateway layer (Task Group 5) is responsible for the LLM rerank pass --
 * AMS deliberately keeps the read path deterministic and side-effect free so
 * the unit-test in Task Group 4 sub-task 4.1 can assert "no row mutations
 * across the call".</p>
 *
 * <h3>v1 design call (per spec sub-task 4.4 header)</h3>
 * <p>The endpoint exists on AMS so the contract is hosted on the AMS side
 * and the gateway proxy can simply forward + LLM-rerank. The alternative
 * (everything in gateway, AMS untouched) would have required the gateway
 * to maintain its own element index. Keeping the index query in AMS lets
 * AMS evolve the supertype tables without coordinating with gateway.</p>
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
public class MappingSuggestService {

    /** Mirrors the supertype-table list used by the other Group 4 services. */
    static final List<String> ELEMENT_SUPERTYPE_TABLES = List.of(
        "application_components",
        "interfaces",
        "data_entity_points",
        "infrastructure_points"
    );

    /** Confidence thresholds for the three score tiers. */
    static final double SCORE_EXACT_MATCH = 1.0;
    static final double SCORE_SUBSTRING_BASE = 0.7;
    static final double SCORE_TOKEN_OVERLAP_BASE = 0.0;
    static final double SCORE_TOKEN_OVERLAP_MAX = 0.6;

    private final ArchitectureRepository architectureRepository;
    private final JdbcTemplate jdbcTemplate;

    public MappingSuggestService(
            ArchitectureRepository architectureRepository,
            JdbcTemplate jdbcTemplate) {
        this.architectureRepository = architectureRepository;
        this.jdbcTemplate = jdbcTemplate;
    }

    /**
     * Returns up to {@link MappingSuggestRequest#MAX_CANDIDATES} candidate
     * current-architecture elements ranked by name similarity.
     *
     * @param projectId             the project the architecture belongs to
     * @param currentArchitectureId the current architecture to source
     *                              candidates from
     * @param request               the body carrying the target element
     *                              snapshot (only {@code name} +
     *                              {@code elementType} are consulted in v1)
     * @return up to three candidates; empty list when the snapshot has no
     *         name or the architecture has no elements of the relevant type
     * @throws ArchitectureNotFoundException when the architecture is missing
     *         or belongs to a different project
     * @throws IllegalArgumentException      when the request body is null
     */
    @Transactional(readOnly = true)
    public MappingSuggestResponse suggest(
            UUID projectId, UUID currentArchitectureId, MappingSuggestRequest request) {
        Objects.requireNonNull(projectId, "projectId is required");
        Objects.requireNonNull(currentArchitectureId, "currentArchitectureId is required");
        if (request == null) {
            throw new IllegalArgumentException("request body is required");
        }

        ArchitectureEntity arch = architectureRepository.findById(currentArchitectureId)
            .orElseThrow(() -> new ArchitectureNotFoundException(
                "Architecture not found: " + currentArchitectureId));
        if (!projectId.equals(arch.getProjectId())) {
            throw new ArchitectureNotFoundException(
                "Architecture " + currentArchitectureId
                    + " not found in project " + projectId);
        }

        MappingSuggestTargetSnapshot snapshot = request.targetElementSnapshot();
        if (snapshot == null || snapshot.name() == null || snapshot.name().isBlank()) {
            log.debug("mapping-suggest: empty snapshot name; returning no candidates");
            return new MappingSuggestResponse(List.of());
        }

        String targetName = snapshot.name().trim();
        String filterByType = (snapshot.elementType() != null && !snapshot.elementType().isBlank())
            ? snapshot.elementType()
            : null;

        log.debug("mapping-suggest: project={} currentArch={} targetName='{}' filterType={}",
            projectId, currentArchitectureId, targetName, filterByType);

        List<MappingSuggestCandidate> all = new ArrayList<>();
        for (String table : ELEMENT_SUPERTYPE_TABLES) {
            if (filterByType != null && !filterByType.equals(table)) {
                continue;
            }
            all.addAll(candidatesForTable(table, currentArchitectureId, targetName));
        }

        // Sort by descending confidence, then by name for deterministic order.
        all.sort(
            Comparator.comparing(MappingSuggestCandidate::confidence, Comparator.reverseOrder())
                .thenComparing(c -> c.name() == null ? "" : c.name())
                .thenComparing(MappingSuggestCandidate::elementId));

        if (all.size() > MappingSuggestRequest.MAX_CANDIDATES) {
            all = new ArrayList<>(all.subList(0, MappingSuggestRequest.MAX_CANDIDATES));
        }
        return new MappingSuggestResponse(all);
    }

    /**
     * Per-table candidate scan. Scores each row by simple name similarity
     * and returns only the rows with confidence > 0. Rows scoring zero
     * (no shared tokens at all) are dropped at this layer so the merge sort
     * stays small.
     */
    private List<MappingSuggestCandidate> candidatesForTable(
            String table, UUID currentArchitectureId, String targetName) {

        // Architecture-scope read path (per spec
        // 2026-05-22-architecture-scope-via-parent-not-leaf): predicate
        // routes via the model_files parent chain rather than the element
        // table's leaf architecture_id column. The {@code WHERE
        // architecture_id = ?} hit IS on model_files, which is the
        // canonical parent and therefore out-of-scope for the resolver
        // map.
        String sql =
            "SELECT t.id AS element_id, t.name AS element_name "
            + " FROM " + table + " t "
            + " WHERE t.model_file_id IN ("
            + "    SELECT id FROM model_files WHERE architecture_id = ?"
            + " )";

        List<Map<String, Object>> rows;
        try {
            rows = jdbcTemplate.queryForList(sql, currentArchitectureId);
        } catch (Exception ex) {
            log.warn("mapping-suggest: query failed for table {}: {}", table, ex.getMessage());
            return List.of();
        }

        String targetLower = targetName.toLowerCase(Locale.ROOT);
        Set<String> targetTokens = tokenise(targetLower);

        List<MappingSuggestCandidate> out = new ArrayList<>();
        for (Map<String, Object> row : rows) {
            Object id = row.get("element_id");
            Object name = row.get("element_name");
            if (id == null || name == null) {
                continue;
            }
            String candidateName = name.toString();
            double score = scoreNameSimilarity(candidateName, targetLower, targetTokens);
            if (score <= 0.0) {
                continue;
            }
            String rationale = buildRationale(candidateName, targetName, score);
            out.add(new MappingSuggestCandidate(
                id.toString(), table, candidateName, score, rationale));
        }
        return out;
    }

    /**
     * Score the candidate name against the target name. Three tiers:
     * <ul>
     *   <li>Exact match (case-insensitive): 1.0</li>
     *   <li>Substring (one contains the other): 0.7</li>
     *   <li>Otherwise: token-overlap ratio scaled to 0..0.6</li>
     * </ul>
     */
    double scoreNameSimilarity(String candidateName, String targetLower, Set<String> targetTokens) {
        if (candidateName == null || candidateName.isBlank()) {
            return 0.0;
        }
        String candidateLower = candidateName.toLowerCase(Locale.ROOT);
        if (candidateLower.equals(targetLower)) {
            return SCORE_EXACT_MATCH;
        }
        if (candidateLower.contains(targetLower) || targetLower.contains(candidateLower)) {
            return SCORE_SUBSTRING_BASE;
        }
        Set<String> candidateTokens = tokenise(candidateLower);
        if (candidateTokens.isEmpty() || targetTokens.isEmpty()) {
            return 0.0;
        }
        Set<String> intersection = new HashSet<>(candidateTokens);
        intersection.retainAll(targetTokens);
        if (intersection.isEmpty()) {
            return 0.0;
        }
        Set<String> union = new HashSet<>(candidateTokens);
        union.addAll(targetTokens);
        double jaccard = (double) intersection.size() / (double) union.size();
        return SCORE_TOKEN_OVERLAP_BASE + (jaccard * SCORE_TOKEN_OVERLAP_MAX);
    }

    private String buildRationale(String candidateName, String targetName, double score) {
        if (score >= SCORE_EXACT_MATCH) {
            return "Name exactly matches '" + candidateName + "'";
        }
        if (score >= SCORE_SUBSTRING_BASE) {
            return "Name overlaps with '" + candidateName + "'";
        }
        return "Some tokens shared with '" + candidateName + "' against '" + targetName + "'";
    }

    /**
     * Splits a name into lowercase non-empty word tokens. Splits on any
     * non-alphanumeric character so "Order Service" and "order-service"
     * tokenise identically.
     */
    static Set<String> tokenise(String lowercaseName) {
        if (lowercaseName == null || lowercaseName.isBlank()) {
            return Set.of();
        }
        Set<String> out = new HashSet<>();
        for (String part : lowercaseName.split("[^a-z0-9]+")) {
            if (!part.isBlank()) {
                out.add(part);
            }
        }
        return out;
    }
}
