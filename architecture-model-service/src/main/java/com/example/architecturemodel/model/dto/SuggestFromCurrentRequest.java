package com.example.architecturemodel.model.dto;

import com.example.architecturemodel.jackson.CamelCaseWire;

import java.util.UUID;

/**
 * Body for {@code POST /api/projects/{projectId}/target-architectures/suggest-from-current}.
 *
 * <p>Marked {@code @CamelCaseWire} because the target-state UI speaks camelCase.</p>
 *
 * <p>The {@code currentArchitectureId} is captured at click time on the
 * client so a mid-flight architecture switch cannot redirect the clone to
 * the wrong source. The server uses ONLY this id for Phase 1 (load + empty
 * check), Phase 2 (deep-clone delegate) and Phase 3 (mapping-row source
 * attribution); any "active architecture" header / session value is ignored
 * to keep the clone deterministic against the user's intent at click time.</p>
 *
 * @param currentArchitectureId required; the source current architecture to
 *                              clone into a new target draft
 */
@CamelCaseWire
public record SuggestFromCurrentRequest(
    UUID currentArchitectureId
) {
}
