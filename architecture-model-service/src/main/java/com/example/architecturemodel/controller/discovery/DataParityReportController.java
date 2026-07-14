package com.example.architecturemodel.controller.discovery;

import com.example.architecturemodel.model.entity.DataParityReportEntity;
import com.example.architecturemodel.repository.entity.DataParityReportRepository;
import com.example.architecturemodel.trace.HaikaiTrace;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/**
 * Data-parity reports — Spec P of the Data-Tier Oracle Program.
 *
 * <pre>
 *   POST /api/projects/{p}/architectures/{a}/data-parity-reports        (AMVS comparator)
 *   GET  /api/projects/{p}/architectures/{a}/data-parity-reports/latest (the migrate gate)
 * </pre>
 *
 * <p>The POST body is the comparator's snake_case report, stored verbatim in
 * {@code report_json}; the summary status / pair id / ruleset version are
 * lifted onto columns for the gate's cheap read. GET /latest returns 404
 * when no report exists — the gate treats that as
 * {@code data_parity_unverified} (fail-closed).</p>
 */
@RestController
@RequestMapping("/api/projects/{projectId}/architectures/{architectureId}/data-parity-reports")
@RequiredArgsConstructor
@Slf4j
public class DataParityReportController {

    private static final HaikaiTrace.Tracer TRACE = HaikaiTrace.forService("ams");

    private final DataParityReportRepository repository;

    @PostMapping
    public ResponseEntity<Map<String, Object>> save(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @RequestBody Map<String, Object> report) {
        String status = "unverifiable";
        Object summary = report.get("summary");
        if (summary instanceof Map<?, ?> s && s.get("status") instanceof String st && !st.isBlank()) {
            status = st;
        }
        String pairId = report.get("pair_id") instanceof String p ? p : null;
        Integer rulesetVersion =
            report.get("ruleset_version") instanceof Number n ? n.intValue() : null;

        DataParityReportEntity saved = repository.save(DataParityReportEntity.builder()
            .projectId(projectId)
            .architectureId(architectureId)
            .status(status)
            .migrationPair(pairId)
            .rulesetVersion(rulesetVersion)
            .reportJson(report)
            .build());

        log.info("[diag-ams] op=data_parity_report_saved project={} status={} pair={}",
            projectId.toString().substring(0, 8), status, pairId);
        TRACE.ok("data-parity report saved — status=" + status
                + (pairId != null ? " pair=" + pairId : ""),
            HaikaiTrace.Corr.of()
                .project(projectId.toString())
                .arch(architectureId.toString()));

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("id", saved.getId());
        return ResponseEntity.ok(body);
    }

    @GetMapping("/latest")
    public ResponseEntity<DataParityReportEntity> latest(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId) {
        return repository
            .findTopByProjectIdAndArchitectureIdOrderByCreatedAtDesc(projectId, architectureId)
            .map(ResponseEntity::ok)
            .orElseGet(() -> ResponseEntity.notFound().build());
    }
}
