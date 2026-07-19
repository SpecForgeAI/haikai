package com.example.architecturemodel.controller;

import com.example.architecturemodel.model.dto.security.IngestSecurityFindingsRequest;
import com.example.architecturemodel.model.dto.security.SecurityFindingReportDto;
import com.example.architecturemodel.model.dto.security.SecurityIngestSummaryDto;
import com.example.architecturemodel.model.dto.security.SecurityRegisterResponse;
import com.example.architecturemodel.model.dto.security.SecurityRollupDto;
import com.example.architecturemodel.service.security.SecurityFindingIngestionService;
import com.example.architecturemodel.service.security.SecurityRegisterService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Arrays;
import java.util.List;
import java.util.UUID;

/**
 * REST controller for the department-level security store (Security health
 * dashboard, 2026-07-19, Spec 1 of 3). Mirrors {@link VulnerabilityController}:
 * feature gate, project/architecture-scoped mapping, snake_case wire.
 *
 * <p>Base path:
 * {@code /api/model/projects/{projectId}/architectures/{architectureId}/security}.
 * Distinct from and untouching the migration-workflow
 * {@code .../vulnerabilities} surface.</p>
 *
 * <h2>Endpoints</h2>
 * <ul>
 *   <li>{@code POST .../reports} -- ingest a wizard-completed upload (all files
 *       appended, attribution resolved) as a new latest snapshot.</li>
 *   <li>{@code GET .../reports} -- upload history, newest first (the compact
 *       "Load previous" modal).</li>
 *   <li>{@code GET .../register} -- the parameterized Findings Register
 *       (filters + column set + paging; {@code report_id} absent = latest).</li>
 *   <li>{@code GET .../rollup} -- severity counts per application + the
 *       Not-matched bucket (the Overview diagram's render-time circles).</li>
 * </ul>
 */
@RestController
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequestMapping("/api/model/projects/{projectId}/architectures/{architectureId}/security")
@RequiredArgsConstructor
@Slf4j
public class SecurityFindingController {

    private final SecurityFindingIngestionService ingestionService;
    private final SecurityRegisterService registerService;

    /** Ingest one wizard-completed upload as a new latest report snapshot. */
    @PostMapping("/reports")
    public ResponseEntity<SecurityIngestSummaryDto> ingestReport(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @RequestBody IngestSecurityFindingsRequest request) {
        log.debug("POST .../security/reports project={} architecture={} level={} files={} rows={}",
            projectId, architectureId,
            request != null ? request.associationLevel() : null,
            request != null && request.originalFilenames() != null
                ? request.originalFilenames().size() : 0,
            request != null && request.rows() != null ? request.rows().size() : 0);
        SecurityIngestSummaryDto summary =
            ingestionService.ingest(projectId, architectureId, request);
        return ResponseEntity.status(HttpStatus.CREATED).body(summary);
    }

    /** Upload history, newest first. */
    @GetMapping("/reports")
    public ResponseEntity<List<SecurityFindingReportDto>> listReports(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId) {
        return ResponseEntity.ok(registerService.listReportHistory(projectId, architectureId));
    }

    /**
     * The parameterized Findings Register. {@code columns} is a comma-separated
     * subset of the flattened vocabulary (unknown names ignored; empty falls
     * back to the default set) -- the future register-configurability UI speaks
     * this same contract. Entity filters are ANCESTOR-AWARE (most specific of
     * service &gt; component &gt; application wins and expands to its
     * descendants -- an application filter matches service-attributed findings
     * under that application).
     */
    @GetMapping("/register")
    public ResponseEntity<SecurityRegisterResponse> register(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @RequestParam(name = "report_id", required = false) UUID reportId,
            @RequestParam(name = "application_id", required = false) String applicationId,
            @RequestParam(name = "application_component_id", required = false)
                String applicationComponentId,
            @RequestParam(name = "service_id", required = false) String serviceId,
            @RequestParam(name = "match_status", required = false) String matchStatus,
            @RequestParam(required = false) String severity,
            @RequestParam(required = false) String text,
            @RequestParam(required = false) String columns,
            @RequestParam(required = false, defaultValue = "0") int page,
            @RequestParam(required = false, defaultValue = "50") int size) {
        List<String> columnList = columns == null || columns.isBlank()
            ? null
            : Arrays.stream(columns.split(",")).map(String::trim).toList();
        return ResponseEntity.ok(registerService.register(
            projectId, architectureId, reportId,
            applicationId, applicationComponentId, serviceId,
            matchStatus, severity, text,
            columnList, page, size));
    }

    /** Severity counts per application + Not-matched bucket (Overview circles). */
    @GetMapping("/rollup")
    public ResponseEntity<SecurityRollupDto> rollup(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @RequestParam(name = "report_id", required = false) UUID reportId) {
        return ResponseEntity.ok(registerService.rollup(projectId, architectureId, reportId));
    }
}
