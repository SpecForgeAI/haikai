package com.example.architecturemodel.controller.discovery;

import com.example.architecturemodel.mapper.discovery.EndpointDataEffectMapper;
import com.example.architecturemodel.model.dto.discovery.EndpointDataEffectDto;
import com.example.architecturemodel.repository.discovery.EndpointDataEffectRepository;
import com.example.architecturemodel.repository.ModelFileRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/**
 * REST read surface for {@code endpoint_data_effects} (Spec 2026-07-06-f —
 * T-SQL Affinity &amp; Consumer Revalidation; shared foundation with Spec H's
 * code-spec carriage read).
 *
 * <p>Two query modes on ONE endpoint:</p>
 * <ul>
 *   <li>{@code ?endpoint_ids=a,b,c} — all effects FOR a set of endpoints
 *       (the carriage/gate read).</li>
 *   <li>{@code ?data_entity_point_ids=dep_phy_x,dep_phy_y} — the REVERSE
 *       query: all effects — hence endpoints — touching the given tables /
 *       procs (indexed by changeset 209; the affected-consumer computation's
 *       core read). Callers resolve object NAMES to {@code dep_*} ids from
 *       the model read they already hold (physical entity id → name), so no
 *       name-join lives here.</li>
 * </ul>
 *
 * <p>Exactly one of the two params must be non-empty (400 otherwise — an
 * unfiltered dump of every effect row is never the right read). Ids are
 * globally unique row references produced by the caller's own architecture
 * model read; the path's project/architecture segments are routing
 * decoration, consistent with the sibling discovery controllers. snake_case
 * wire (AMS global default — no annotation needed).</p>
 */
@RestController
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequestMapping("/api/model/projects/{projectId}/architectures/{architectureId}")
@RequiredArgsConstructor
@Slf4j
public class EndpointDataEffectController {

    private final EndpointDataEffectRepository repository;
    private final ModelFileRepository modelFileRepository;

    /**
     * GET /api/model/projects/{p}/architectures/{a}/endpoint-data-effects/proc-calls
     *
     * <p>Every stored-proc CALL effect of the architecture (Stored Proc &amp;
     * Function Behaviour Program, Spec 2, 2026-09-09): the rows the code scan
     * minted with {@code path_metadata_json.proc_name}. Bounded by nature
     * (one row per endpoint→routine pair), so an architecture-wide read is
     * the right shape here — unlike the unfiltered table/entity dump the
     * general query refuses. 404 when the architecture has no model file.</p>
     */
    @GetMapping("/endpoint-data-effects/proc-calls")
    public ResponseEntity<List<EndpointDataEffectDto>> procCalls(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId) {
        return modelFileRepository.findByProjectIdAndArchitectureId(projectId, architectureId)
            .map(modelFile -> repository.findByModelFileId(modelFile.getId()).stream()
                .filter(e -> {
                    var meta = e.getPathMetadataJson();
                    Object procName = meta == null ? null : meta.get("proc_name");
                    return procName instanceof String s && !s.isBlank();
                })
                .map(EndpointDataEffectMapper::toDto)
                .toList())
            .map(ResponseEntity::ok)
            .orElseGet(() -> ResponseEntity.notFound().build());
    }

    /**
     * GET /api/model/projects/{p}/architectures/{a}/endpoint-data-effects
     */
    @GetMapping("/endpoint-data-effects")
    public ResponseEntity<List<EndpointDataEffectDto>> query(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @RequestParam(name = "endpoint_ids", required = false) List<String> endpointIds,
            @RequestParam(name = "data_entity_point_ids", required = false)
            List<String> dataEntityPointIds) {
        boolean byEndpoint = endpointIds != null && !endpointIds.isEmpty();
        boolean byDataEntity = dataEntityPointIds != null && !dataEntityPointIds.isEmpty();
        if (byEndpoint == byDataEntity) {
            // Neither or both — refuse rather than guess (or dump the world).
            return ResponseEntity.badRequest().build();
        }
        log.debug(
            "GET endpoint-data-effects project={} arch={} endpointIds={} dataEntityPointIds={}",
            projectId, architectureId,
            byEndpoint ? endpointIds.size() : 0,
            byDataEntity ? dataEntityPointIds.size() : 0);

        List<EndpointDataEffectDto> out = (byEndpoint
            ? repository.findByEndpointIdIn(endpointIds)
            : repository.findByDataEntityPointIdIn(dataEntityPointIds))
            .stream()
            .map(EndpointDataEffectMapper::toDto)
            .toList();
        return ResponseEntity.ok(out);
    }
}
