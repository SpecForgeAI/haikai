package com.example.architecturemodel.controller;

import com.example.architecturemodel.model.dto.security.SecurityFindingReportDto;
import com.example.architecturemodel.model.dto.security.SecurityLinkingAliasDto;
import com.example.architecturemodel.model.dto.security.UpsertSecurityAliasesRequest;
import com.example.architecturemodel.service.security.SecurityAliasService;
import com.example.architecturemodel.service.security.SecurityRegisterService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/**
 * Project-scoped wizard-support endpoints (Security health dashboard,
 * 2026-07-19, Spec 1 of 3): the value-matcher alias memory + the
 * column-mapping prefill read. Project scope (not architecture) -- an
 * organisation's scanner naming is stable across architectures.
 *
 * <p>Base path: {@code /api/model/projects/{projectId}/security}.</p>
 */
@RestController
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequestMapping("/api/model/projects/{projectId}/security")
@RequiredArgsConstructor
@Slf4j
public class SecurityAliasController {

    private final SecurityAliasService aliasService;
    private final SecurityRegisterService registerService;

    /** The taught aliases for a level (wizard auto-resolution input). */
    @GetMapping("/aliases")
    public ResponseEntity<List<SecurityLinkingAliasDto>> listAliases(
            @PathVariable UUID projectId,
            @RequestParam(required = false) String level) {
        return ResponseEntity.ok(aliasService.list(projectId, level));
    }

    /** Batch-teach confirmed pairings from the wizard's value matcher. */
    @PutMapping("/aliases")
    public ResponseEntity<List<SecurityLinkingAliasDto>> upsertAliases(
            @PathVariable UUID projectId,
            @RequestBody UpsertSecurityAliasesRequest request) {
        return ResponseEntity.ok(aliasService.upsert(projectId, request));
    }

    /**
     * The wizard's prefill: the project's most recent report (column mapping +
     * association level). 204 when the project has never uploaded.
     */
    @GetMapping("/reports/latest")
    public ResponseEntity<SecurityFindingReportDto> latestReportForPrefill(
            @PathVariable UUID projectId) {
        SecurityFindingReportDto latest = registerService.latestReportForPrefill(projectId);
        return latest == null ? ResponseEntity.noContent().build() : ResponseEntity.ok(latest);
    }
}
