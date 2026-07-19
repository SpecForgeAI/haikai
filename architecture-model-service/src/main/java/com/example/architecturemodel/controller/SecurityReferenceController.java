package com.example.architecturemodel.controller;

import com.example.architecturemodel.model.dto.security.CveEnrichmentRequest;
import com.example.architecturemodel.model.dto.security.CveRecordDto;
import com.example.architecturemodel.model.dto.security.CweRecordDto;
import com.example.architecturemodel.service.security.SecurityReferenceService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
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

/**
 * World-fact reference endpoints (Security health dashboard, 2026-07-19,
 * Spec 1 of 3): CVE enrichment queue + apply (driven by the gateway OSV
 * bridge) and CWE lookups. Globally scoped -- world facts are not
 * project-bound.
 *
 * <p>Base path: {@code /api/model/security}. Enrichment NEVER touches
 * {@code security_findings}; ingest never blocks on enrichment.</p>
 */
@RestController
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequestMapping("/api/model/security")
@RequiredArgsConstructor
@Slf4j
public class SecurityReferenceController {

    private final SecurityReferenceService referenceService;

    /** The enrichment work queue: pending CVE stubs, oldest first. */
    @GetMapping("/cves/pending")
    public ResponseEntity<List<CveRecordDto>> listPendingCves(
            @RequestParam(required = false, defaultValue = "100") int limit) {
        return ResponseEntity.ok(referenceService.listPendingCves(limit));
    }

    /** One CVE record (stub or enriched). 404 when unknown. */
    @GetMapping("/cves/{cveId}")
    public ResponseEntity<CveRecordDto> getCve(@PathVariable String cveId) {
        CveRecordDto dto = referenceService.getCve(cveId);
        return dto == null ? ResponseEntity.notFound().build() : ResponseEntity.ok(dto);
    }

    /** Apply world facts onto one CVE record (gateway OSV bridge). */
    @PostMapping("/cves/{cveId}/enrichment")
    public ResponseEntity<CveRecordDto> applyCveEnrichment(
            @PathVariable String cveId,
            @RequestBody(required = false) CveEnrichmentRequest request) {
        log.debug("POST /security/cves/{}/enrichment status={}",
            cveId, request != null ? request.enrichmentStatus() : null);
        return ResponseEntity.ok(referenceService.applyCveEnrichment(cveId, request));
    }

    /** Batch CWE lookup ({@code ids} comma-separated, e.g. {@code CWE-89,CWE-770}). */
    @GetMapping("/cwes")
    public ResponseEntity<List<CweRecordDto>> listCwes(@RequestParam String ids) {
        List<String> idList = Arrays.stream(ids.split(",")).map(String::trim).toList();
        return ResponseEntity.ok(referenceService.listCwes(idList));
    }
}
