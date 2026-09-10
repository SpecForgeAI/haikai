package com.example.architecturemodel.controller.procbehaviour;

import com.example.architecturemodel.model.entity.procbehaviour.ProcParityReportEntity;
import com.example.architecturemodel.repository.entity.ProcParityReportRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Proc-parity reports -- Stored Proc &amp; Function Behaviour Program, Spec 4
 * (changeset 231). The DB-native sibling of
 * {@code /data-parity-reports}: routine BEHAVIOUR rather than table contents.
 *
 * <pre>
 *   POST .../proc-parity-reports                                  -> 201 {id}
 *   GET  .../proc-parity-reports/{id}                             -> report | 404
 *   GET  .../proc-parity-reports/latest?routine_id=[&amp;purpose=]   -> report | 404
 *   GET  .../proc-parity-reports/latest-by-routine[?purpose=][&amp;pack_id=]
 *                                                                 -> {routine_id: {...}}
 * </pre>
 *
 * <p>The POST body is the comparator's snake_case report, stored VERBATIM in
 * {@code report_json}; {@code routine_id} / {@code baseline_id} /
 * {@code pack_id} / {@code translation_attempt_id} / {@code purpose} /
 * {@code summary.status} / {@code pair_id} / {@code ruleset_version} /
 * {@code summary} are LIFTED onto columns so the latest-per-routine read stays
 * a single cheap query.</p>
 *
 * <p>{@code /latest} and {@code /latest-by-routine} are literals and win over
 * the {@code /{reportId}} template on Spring's specificity ordering, so
 * neither word ever reaches the uuid converter.</p>
 */
@RestController
@RequestMapping("/api/projects/{projectId}/architectures/{architectureId}/proc-parity-reports")
@RequiredArgsConstructor
@Slf4j
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
public class ProcParityReportController {

    /**
     * Same-instant tie-break: an execution report is the authoritative one,
     * then the workbench loop's, then a manual run's.
     */
    private static final List<String> PURPOSE_PRIORITY = List.of(
        ProcParityReportEntity.PURPOSE_EXECUTION,
        ProcParityReportEntity.PURPOSE_WORKBENCH,
        ProcParityReportEntity.PURPOSE_MANUAL);

    private final ProcParityReportRepository repository;

    @PostMapping
    public ResponseEntity<Map<String, Object>> save(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @RequestBody Map<String, Object> report) {
        if (report == null || report.isEmpty()) {
            throw new IllegalArgumentException("request body is required");
        }
        UUID routineId = uuid(report.get("routine_id"));
        if (routineId == null) {
            throw new IllegalArgumentException("routine_id is required");
        }

        String purpose = report.get("purpose") instanceof String p && !p.isBlank()
            ? p
            : ProcParityReportEntity.PURPOSE_WORKBENCH;
        validateValue("purpose", purpose, ProcParityReportEntity.ALL_PURPOSES);

        Map<String, Object> summary = report.get("summary") instanceof Map<?, ?> s
            ? castMap(s)
            : Map.of();
        String status = summary.get("status") instanceof String st && !st.isBlank()
            ? st
            : ProcParityReportEntity.STATUS_UNVERIFIABLE;
        validateValue("summary.status", status, ProcParityReportEntity.ALL_STATUSES);

        ProcParityReportEntity saved = repository.save(ProcParityReportEntity.builder()
            .id(UUID.randomUUID())
            .projectId(projectId)
            .architectureId(architectureId)
            .packId(uuid(report.get("pack_id")))
            .routineId(routineId)
            .baselineId(uuid(report.get("baseline_id")))
            .translationAttemptId(uuid(report.get("translation_attempt_id")))
            .purpose(purpose)
            .status(status)
            .migrationPair(report.get("pair_id") instanceof String p ? p : null)
            .rulesetVersion(report.get("ruleset_version") instanceof Number n ? n.intValue() : null)
            .summaryJson(summary)
            .reportJson(report)
            .createdAt(Instant.now())
            .build());

        log.info("[diag-ams] op=proc_parity_report_saved arch={} routine={} purpose={} status={}",
            architectureId, routineId, purpose, status);

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("id", saved.getId());
        return ResponseEntity.status(HttpStatus.CREATED).body(body);
    }

    @GetMapping("/latest")
    public ResponseEntity<ProcParityReportEntity> latest(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @RequestParam(name = "routine_id") UUID routineId,
            @RequestParam(name = "purpose", required = false) String purpose) {
        return (purpose == null || purpose.isBlank()
            ? repository.findFirstByArchitectureIdAndRoutineIdOrderByCreatedAtDesc(
                architectureId, routineId)
            : repository.findFirstByArchitectureIdAndRoutineIdAndPurposeOrderByCreatedAtDesc(
                architectureId, routineId, purpose))
            .map(ResponseEntity::ok)
            .orElseGet(() -> ResponseEntity.notFound().build());
    }

    /**
     * The LATEST report per routine as a map keyed by {@code routine_id}. A
     * {@code purpose} (and/or {@code pack_id}) narrows the pool; without a
     * purpose the newest wins, and same-instant ties fall to
     * {@link #PURPOSE_PRIORITY}.
     */
    @GetMapping("/latest-by-routine")
    public Map<String, Object> latestByRoutine(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @RequestParam(name = "purpose", required = false) String purpose,
            @RequestParam(name = "pack_id", required = false) UUID packId) {
        Map<UUID, ProcParityReportEntity> best = new LinkedHashMap<>();
        for (ProcParityReportEntity row
                : repository.findByArchitectureIdOrderByCreatedAtDesc(architectureId)) {
            if (row.getRoutineId() == null) {
                continue;
            }
            if (purpose != null && !purpose.isBlank() && !purpose.equals(row.getPurpose())) {
                continue;
            }
            if (packId != null && !packId.equals(row.getPackId())) {
                continue;
            }
            best.merge(row.getRoutineId(), row, ProcParityReportController::preferred);
        }

        Map<String, Object> out = new LinkedHashMap<>();
        best.forEach((routineId, row) -> {
            Map<String, Object> entry = new LinkedHashMap<>();
            entry.put("id", row.getId());
            entry.put("status", row.getStatus());
            entry.put("purpose", row.getPurpose());
            entry.put("created_at", row.getCreatedAt());
            entry.put("summary_json", row.getSummaryJson());
            out.put(routineId.toString(), entry);
        });
        return out;
    }

    @GetMapping("/{reportId}")
    public ResponseEntity<ProcParityReportEntity> get(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @PathVariable UUID reportId) {
        return repository.findById(reportId)
            .filter(r -> architectureId.equals(r.getArchitectureId()))
            .map(ResponseEntity::ok)
            .orElseGet(() -> ResponseEntity.notFound().build());
    }

    /** Invalid body / enum value -- 400 with {@code {"error": ...}}, never a 500. */
    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<Map<String, Object>> handleBadRequest(IllegalArgumentException ex) {
        log.warn("[diag-ams] op=proc_parity_report_bad_request message={}", ex.getMessage());
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("error", ex.getMessage());
        return ResponseEntity.badRequest().body(body);
    }

    // -----------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------

    /** Newest wins; on an exact instant tie the purpose priority decides. */
    private static ProcParityReportEntity preferred(
        ProcParityReportEntity existing, ProcParityReportEntity candidate) {
        return Comparator
            .comparing(
                (ProcParityReportEntity r) -> r.getCreatedAt() == null ? Instant.EPOCH : r.getCreatedAt())
            .reversed()
            .thenComparingInt(r -> {
                int rank = PURPOSE_PRIORITY.indexOf(r.getPurpose());
                return rank < 0 ? PURPOSE_PRIORITY.size() : rank;
            })
            .compare(existing, candidate) <= 0 ? existing : candidate;
    }

    private static UUID uuid(Object raw) {
        if (raw instanceof UUID u) {
            return u;
        }
        if (raw instanceof String s && !s.isBlank()) {
            try {
                return UUID.fromString(s);
            } catch (IllegalArgumentException ex) {
                throw new IllegalArgumentException("not a uuid: '" + s + "'");
            }
        }
        return null;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> castMap(Map<?, ?> raw) {
        return (Map<String, Object>) raw;
    }

    private static void validateValue(String field, String value, Set<String> allowed) {
        if (!allowed.contains(value)) {
            throw new IllegalArgumentException(
                "Invalid " + field + " '" + value + "'; allowed values: " + allowed);
        }
    }
}
