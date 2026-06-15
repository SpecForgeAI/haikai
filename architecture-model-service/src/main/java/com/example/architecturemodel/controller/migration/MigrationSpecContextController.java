package com.example.architecturemodel.controller.migration;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.migration.MigrationSpecContextDto;
import com.example.architecturemodel.model.dto.migration.MigrationSpecContextRequestDto;
import com.example.architecturemodel.service.migration.MigrationSpecContextResolver;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;
import java.util.UUID;

/**
 * REST controller for the focused-migration-context endpoint used by the PM
 * shape-spec batch generator (A-5).
 *
 * <p>Distinct from {@link MigrationDiscoveryContextController} (project-level
 * base context); this endpoint returns a per-story bounded payload keyed by
 * {@code workItemId} + {@code bookItemId} with one populated block per
 * requested context-type. Supported context-types:
 * {@code service|api|soap|data|infrastructure|test_pack}.</p>
 *
 * <p>Missing-input semantics: the resolver returns HTTP 200 with the partial
 * DTO + {@code missingInputs[]} populated when required detail is absent --
 * the gateway decides between an {@code insufficient_context} per-story result
 * and an LLM attempt. 4xx is reserved for hard input errors (missing
 * {@code workItemId}, missing {@code contextTypes}); 404 covers unknown
 * project / WorkItem identifiers.</p>
 *
 * <p>Spec: PM Migration Shape-Spec Batch Generation (2026-05-19) -- Task Group 7.</p>
 */
@RestController
@RequestMapping("/api/projects/{projectId}/migration-spec-context")
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class MigrationSpecContextController {

    private final MigrationSpecContextResolver resolver;

    @PostMapping
    public ResponseEntity<?> resolve(
            @PathVariable UUID projectId,
            @RequestBody MigrationSpecContextRequestDto request) {
        final long start = System.currentTimeMillis();
        try {
            MigrationSpecContextDto dto = resolver.resolve(projectId, request);
            int blocks = dto.returnedContextTypes() == null ? 0 : dto.returnedContextTypes().size();
            int missing = dto.missingInputs() == null ? 0 : dto.missingInputs().size();
            log.info(
                "[diag-ams] spec_generation op=focused_context project={} elapsed_ms={} blocks={} missingInputs={}",
                shortPrefix(projectId),
                System.currentTimeMillis() - start,
                blocks,
                missing);
            return ResponseEntity.ok(dto);
        } catch (ResourceNotFoundException e) {
            log.info("[diag-ams] spec_generation op=focused_context project={} status=404 reason={}",
                shortPrefix(projectId), e.getMessage());
            return ResponseEntity.notFound().build();
        } catch (IllegalArgumentException e) {
            log.warn("[diag-ams] spec_generation op=focused_context project={} status=400 reason={}",
                shortPrefix(projectId), e.getMessage());
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    private static String shortPrefix(UUID id) {
        if (id == null) return "00000000";
        String s = id.toString();
        return s.substring(0, Math.min(8, s.length()));
    }
}
