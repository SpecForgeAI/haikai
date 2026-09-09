package com.example.architecturemodel.controller.discovery;

import com.example.architecturemodel.model.dto.UpsertDbRoutinesRequest;
import com.example.architecturemodel.model.entity.discovery.DbRoutineEntity;
import com.example.architecturemodel.repository.entity.DbRoutineRepository;
import com.example.architecturemodel.service.discovery.DbRoutineService;
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

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

/**
 * Routine catalog -- Stored Proc &amp; Function Behaviour Program, Spec 1.
 *
 * <pre>
 *   GET /api/projects/{p}/architectures/{a}/db-routines[?kind=procedure|function|trigger]
 *   GET /api/projects/{p}/architectures/{a}/db-routines/{id}
 *   PUT /api/projects/{p}/architectures/{a}/db-routines/bulk   (discovery DB scan)
 * </pre>
 *
 * <p>Entities are returned verbatim; the AMS snake_case default renders
 * {@code paramsJson} as {@code params_json} etc. The bulk PUT is the ONLY
 * writer (facts from the scan, never a review flow).</p>
 */
@RestController
@RequestMapping("/api/projects/{projectId}/architectures/{architectureId}/db-routines")
@RequiredArgsConstructor
@Slf4j
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
public class DbRoutineController {

    private final DbRoutineRepository repository;
    private final DbRoutineService service;

    @GetMapping
    public List<DbRoutineEntity> list(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @RequestParam(name = "kind", required = false) String kind) {
        if (kind != null && !kind.isBlank()) {
            return repository.findByArchitectureIdAndRoutineKindOrderBySchemaNameAscRoutineNameAsc(
                architectureId, kind.toLowerCase(Locale.ROOT));
        }
        return repository.findByArchitectureIdOrderBySchemaNameAscRoutineNameAsc(architectureId);
    }

    @GetMapping("/{id}")
    public ResponseEntity<DbRoutineEntity> get(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @PathVariable UUID id) {
        return repository.findById(id)
            .filter(r -> architectureId.equals(r.getArchitectureId()))
            .map(ResponseEntity::ok)
            .orElseGet(() -> ResponseEntity.notFound().build());
    }

    @PutMapping("/bulk")
    public ResponseEntity<Map<String, Object>> bulkUpsert(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @RequestBody UpsertDbRoutinesRequest request) {
        int upserted = service.bulkUpsert(projectId, architectureId, request);
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("upserted", upserted);
        return ResponseEntity.ok(body);
    }
}
